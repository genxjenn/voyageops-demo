// src/api/routes.ts
import express from 'express';
import type { Response } from 'express';
import { db } from '../lib/couchbase.ts';

const router = express.Router();

// ── Worker activity log (in-memory ring buffer + SSE broadcast) ──────────────

const WORKER_LOG_MAX = 150;

interface WorkerLogEntry {
  id: string;
  ts: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  runId?: string;
  proposalId?: string;
  step?: string;
}

const workerLogs: WorkerLogEntry[] = [];
const sseClients = new Set<Response>();

function broadcastLog(entry: WorkerLogEntry) {
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* client disconnected */ }
  }
}

// POST /api/worker-logs  — called by the Python worker
router.post('/worker-logs', (req, res) => {
  const { level = 'info', message, runId, proposalId, step } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const entry: WorkerLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString(),
    level,
    message: String(message),
    ...(runId && { runId: String(runId) }),
    ...(proposalId && { proposalId: String(proposalId) }),
    ...(step && { step: String(step) }),
  };

  workerLogs.push(entry);
  if (workerLogs.length > WORKER_LOG_MAX) workerLogs.shift();
  broadcastLog(entry);

  return res.status(201).json({ ok: true });
});

// GET /api/worker-logs  — fetch recent history (initial load)
router.get('/worker-logs', (_req, res) => {
  res.json(workerLogs.slice(-50));
});

// GET /api/worker-logs/stream  — SSE stream for live activity feed
router.get('/worker-logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Replay last 50 entries so the UI hydrates immediately on (re)connect.
  for (const entry of workerLogs.slice(-50)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const VECTOR_INDEX_CONFIG = [
  {
    fieldName: 'vector_category_incidents',
    indexNames: [getRequiredEnv('CB_VECTOR_INDEX_CATEGORY')],
  },
  {
    fieldName: 'vector_type_incidents',
    indexNames: [getRequiredEnv('CB_VECTOR_INDEX_TYPE')],
  },
  {
    fieldName: 'vector_desc_incidents',
    indexNames: [getRequiredEnv('CB_VECTOR_INDEX_DESC')],
  },
];
const OPENAI_EMBEDDING_MODEL = getRequiredEnv('OPENAI_EMBEDDING_MODEL');

function tokenizeText(input: string) {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function extractIncidentIdFromQuery(query: string) {
  // Supports IDs like IN_IOS-114_237 and IN_IOS-114_237::guest-recovery
  const match = query.match(/\bIN_[A-Z0-9-]+_[A-Z0-9-]+(?:::[A-Za-z0-9_-]+)?\b/i);
  return match ? match[0] : undefined;
}

function extractGuestIdFromQuery(query: string) {
  // Supports IDs like guest222
  const match = query.match(/\bguest\d+\b/i);
  return match ? match[0].toLowerCase() : undefined;
}

async function getQueryEmbeddingFromIncidentCorpus(query: string) {
  const tokens = tokenizeText(query);
  const corpusQuery = `
    SELECT i.*
    FROM voyageops.guests.incidents i
    WHERE i.vector_desc_incidents IS NOT MISSING
    LIMIT 300
  `;
  const result = await db.cluster.query(corpusQuery, { timeout: 10000 });

  if (!result.rows.length) {
    throw new Error('No incident vectors are available for fallback embedding');
  }

  let bestDoc = result.rows[0];
  let bestScore = -1;

  for (const row of result.rows as any[]) {
    const searchable = `${row.type || ''} ${row.category || ''} ${row.description || ''}`;
    const rowTokens = tokenizeText(searchable);
    let overlap = 0;
    tokens.forEach(token => {
      if (rowTokens.has(token)) {
        overlap += 1;
      }
    });

    if (overlap > bestScore) {
      bestScore = overlap;
      bestDoc = row;
    }
  }

  const embedding = bestDoc.vector_desc_incidents;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Fallback incident vector is invalid');
  }

  return embedding as number[];
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function formatCurrency(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return '$0';
  }

  return numeric.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function buildGuestRecoveryChatResponse(params: {
  query: string;
  incidents: any[];
  guestsById: Map<string, any>;
  retrievalMode: 'vector-index' | 'vector-fallback';
  proposal?: any;
  requestedIncidentId?: string;
  incidentLookupStatus?: 'found' | 'not-found';
  requestedGuestId?: string;
  guestLookupStatus?: 'found' | 'not-found';
}) {
  const {
    query,
    incidents,
    guestsById,
    proposal,
    requestedIncidentId,
    incidentLookupStatus,
    requestedGuestId,
    guestLookupStatus,
  } = params;
  const primaryIncident = incidents[0];

  if (requestedGuestId && guestLookupStatus === 'not-found') {
    return [
      '### Guest Recovery Assessment',
      '',
      `I could not find guest **${requestedGuestId}** in the current guest dataset.`,
      '',
      'I do not want to redirect you to an unrelated recovery case.',
      '',
      'If you share the correct guest ID, I can retrieve that guest\'s latest incident and response plan.',
    ].join('\n');
  }

  if (requestedGuestId && guestLookupStatus === 'found' && !primaryIncident) {
    const requestedGuest = guestsById.get(requestedGuestId);
    const requestedGuestName = requestedGuest?.fullName || requestedGuest?.name || requestedGuestId;
    return [
      '### Guest Recovery Assessment',
      '',
      `I found **${requestedGuestName}** (${requestedGuestId}), but there are no incidents for this guest right now.`,
      '',
      'No response plan exists yet because there is no active incident tied to this guest.',
    ].join('\n');
  }

  if (!primaryIncident) {
    return [
      '### Guest Recovery Assessment',
      '',
      `I did not find a strong guest-recovery match for _${query}_.`,
      '',
      'Try asking about a guest name, a recovery preference, or an incident type so I can ground the recommendation in a live case.',
    ].join('\n');
  }

  if (requestedIncidentId && incidentLookupStatus === 'not-found') {
    return [
      '### Guest Recovery Assessment',
      '',
      `I could not find incident **${requestedIncidentId}** in the current incident dataset.`,
      '',
      'I do not want to guess or redirect you to an unrelated case.',
      '',
      'If you share the correct incident ID, guest name, or incident type/category, I can provide an exact recovery recommendation for that request.',
    ].join('\n');
  }

  const guest = guestsById.get(primaryIncident.guestId);
  const guestName = guest?.fullName || guest?.name || primaryIncident.guestId || 'Unknown guest';
  const severity = String(primaryIncident.severity || 'unknown').toUpperCase();
  const loyaltyTier = String(guest?.loyaltyTier || 'GOLD').toUpperCase();
  const spend = formatCurrency(guest?.onboardSpend ?? 0);
  const topThemes = Array.from(new Set(incidents.slice(0, 3).map((incident) => `${incident.type || 'unknown'} / ${incident.category || 'unknown'}`)));
  const operatorIntent: string[] = [];
  const normalizedQuery = query.toLowerCase();

  if (/(budget|cheaper|lower|cost|smaller gesture|less expensive)/.test(normalizedQuery)) {
    operatorIntent.push('keep compensation proportional and cost-aware');
  }
  if (/(vip|upgrade|premium|concierge|white glove|personal)/.test(normalizedQuery)) {
    operatorIntent.push('raise the service level for a higher-touch recovery');
  }
  if (/(urgent|fast|expedite|immediately|asap)/.test(normalizedQuery)) {
    operatorIntent.push('accelerate outreach and service recovery timing');
  }
  if (/(call|follow up|follow-up|apology|contact)/.test(normalizedQuery)) {
    operatorIntent.push('add a direct human follow-up step');
  }

  const searchablePrimary = `${primaryIncident.incidentId || ''} ${primaryIncident.type || ''} ${primaryIncident.category || ''} ${primaryIncident.description || ''} ${guestName}`;
  const primaryTokens = tokenizeText(searchablePrimary);
  const queryTokens = tokenizeText(query);
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (primaryTokens.has(token)) {
      overlap += 1;
    }
  });

  const vectorScore = Number(primaryIncident.vectorScore ?? 0);
  const hasExplicitIncidentRequest = Boolean(requestedIncidentId);
  const weakSemanticMatch = !hasExplicitIncidentRequest && vectorScore < 0.18 && overlap < 2;

  if (weakSemanticMatch) {
    const candidates = incidents.slice(0, 3).map((incident) => {
      const candidateGuest = guestsById.get(incident.guestId);
      const candidateGuestName = candidateGuest?.fullName || candidateGuest?.name || incident.guestId || 'Unknown guest';
      const candidateId = incident.incidentId || incident.id || incident.docId || 'unknown';
      return `- ${candidateId} | ${candidateGuestName} | ${incident.type || 'unknown'} / ${incident.category || 'unknown'} | ${String(incident.severity || 'unknown').toUpperCase()}`;
    }).join('\n');

    return [
      '### Guest Recovery Assessment',
      '',
      'I could not confidently map your question to one specific incident.',
      '',
      'I do not want to fabricate a recommendation for the wrong case.',
      '',
      '**Closest incident candidates**',
      candidates || '- No close candidates found.',
      '',
      'Please provide the incident ID, guest name, or a bit more detail and I will target the exact incident you asked about.',
    ].join('\n');
  }

  const currentPlan = proposal?.actions?.length
    ? proposal.actions.map((action: any) => `- ${action.label}${action.estimatedValue ? ` (${formatCurrency(action.estimatedValue)})` : ''}`).join('\n')
    : '- No worker-generated proposal exists yet for this incident.';

  const reasoningBullets = [
    `Guest value context: ${guestName} is ${loyaltyTier} with approximately ${spend} in onboard spend.`,
    `Incident urgency: ${severity} severity ${primaryIncident.type || 'incident'} in ${primaryIncident.category || 'unknown category'}.`,
    topThemes.length > 0 ? `Comparable patterns retrieved: ${topThemes.join('; ')}.` : null,
    operatorIntent.length > 0 ? `Operator guidance detected: ${operatorIntent.join('; ')}.` : 'No refinement preference was stated, so I would keep the current service-recovery posture.',
  ].filter(Boolean);

  const nextMove = operatorIntent.length > 0
    ? `If you want, I can refine the visible plan toward these goals: ${operatorIntent.join('; ')}.`
    : 'If you want to steer the plan, ask for a lower-cost, faster, or more VIP-style recovery and I will adapt the recommendation framing.';

  return [
    '### Guest Recovery Assessment',
    '',
    `I am focusing on **${guestName}** and incident **${primaryIncident.incidentId || primaryIncident.id || primaryIncident.docId || 'unknown'}**.`,
    '',
    '**What I am weighing**',
    reasoningBullets.map((bullet) => `- ${bullet}`).join('\n'),
    '',
    '**Current plan on file**',
    currentPlan,
    '',
    '**How I would adjust it**',
    nextMove,
  ].join('\n');
}

async function getQueryEmbedding(query: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: query,
      model: OPENAI_EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    throw new Error('Embedding API returned an invalid vector');
  }

  return embedding as number[];
}

async function resolveQueryEmbedding(query: string) {
  try {
    const embedding = await getQueryEmbedding(query);
    return { embedding, embeddingSource: 'openai' as const };
  } catch (error) {
    console.warn('OpenAI embedding unavailable, using incident-corpus fallback:', error instanceof Error ? error.message : String(error));
    const embedding = await getQueryEmbeddingFromIncidentCorpus(query);
    return { embedding, embeddingSource: 'incident-corpus-fallback' as const };
  }
}

async function searchIncidentsByVectorIndexes(queryEmbedding: number[], limit: number) {
  const aggregated = new Map<string, { id: string; score: number; sources: string[] }>();
  const successfulIndexes: string[] = [];
  const attemptedIndexes: string[] = [];

  await Promise.all(
    VECTOR_INDEX_CONFIG.map(async ({ indexNames, fieldName }) => {
      for (const indexName of indexNames) {
        attemptedIndexes.push(indexName);

        try {
          const vectorSql = `
            SELECT META(i).id AS docId,
                   APPROX_VECTOR_DISTANCE(i.${fieldName}, $vector, "L2") AS distance
            FROM voyageops.guests.incidents i
            USE INDEX (\`${indexName}\` USING GSI)
            WHERE i.${fieldName} IS NOT MISSING
            ORDER BY distance ASC
            LIMIT $limit
          `;

          const result = await db.cluster.query(vectorSql, {
            parameters: {
              vector: queryEmbedding,
              limit,
            },
            timeout: 10000,
            raw: {
              use_cbo: true,
            },
          });

          successfulIndexes.push(indexName);

          for (const row of result.rows as any[]) {
            const rowId = String(row.docId || '');
            if (!rowId) continue;

            const current = aggregated.get(rowId);
            const distance = Number(row.distance ?? 0);
            const score = Number.isFinite(distance) ? 1 / (1 + Math.max(0, distance)) : 0;

            if (!current || score > current.score) {
              aggregated.set(rowId, { id: rowId, score, sources: [indexName] });
            } else if (!current.sources.includes(indexName)) {
              current.sources.push(indexName);
            }
          }

          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Vector index query failed for ${indexName}:`, message);
        }
      }
    }),
  );

  const hits = Array.from(aggregated.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { hits, successfulIndexes, attemptedIndexes };
}

async function searchIncidentsByVectorFieldsFallback(queryEmbedding: number[], limit: number) {
  const fallbackQuery = `
    SELECT META(i).id AS docId, i.*
    FROM voyageops.guests.incidents i
    WHERE i.vector_desc_incidents IS NOT MISSING
      AND i.vector_type_incidents IS NOT MISSING
      AND i.vector_category_incidents IS NOT MISSING
    LIMIT 400
  `;
  const result = await db.cluster.query(fallbackQuery, { timeout: 10000 });

  const scored = result.rows
    .map((row: any) => {
      const desc = cosineSimilarity(queryEmbedding, row.vector_desc_incidents ?? []);
      const type = cosineSimilarity(queryEmbedding, row.vector_type_incidents ?? []);
      const category = cosineSimilarity(queryEmbedding, row.vector_category_incidents ?? []);
      const score = desc * 0.6 + type * 0.25 + category * 0.15;
      return { ...row, vectorScore: score };
    })
    .sort((a: any, b: any) => b.vectorScore - a.vectorScore)
    .slice(0, limit);

  return scored;
}

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      message: 'API server is running and Couchbase is connected' 
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ status: 'error', error: String(error) });
  }
});

// API: KPIs
router.get('/dashboard/kpis', async (req, res) => {
  try {
    const q = `SELECT meta().id, k.* FROM voyageops.intelligence.kpis k`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load KPIs' });
  }
});

// API: Guest by ID (with incidents)
router.get('/guests', async (req, res) => {
  try {
    const q = `
      SELECT
        g.*,
        (
          SELECT RAW b.voyageNumber
          FROM voyageops.guests.bookings b
          WHERE b.guestId = g.guestId
        ) AS voyageNumbers
      FROM voyageops.guests.guests g
      ORDER BY g.name ASC
    `;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load guests' });
  }
});

// API: Guest by ID (with incidents)
router.get('/guests/:id', async (req, res) => {
  try {
    const guestId = req.params.id;
    const guestDoc = await db.guests.get(guestId);
    const incidentsQ = `
      SELECT i.* FROM voyageops.guests.incidents i
      WHERE i.guestId = $guestId
      ORDER BY i.createdAt DESC`;
    const incidents = await db.cluster.query(incidentsQ, { parameters: { guestId } });
    res.json({ guest: guestDoc.value, incidents: incidents.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load guest' });
  }
});

// API: Incidents list
router.get('/incidents', async (req, res) => {
  try {
    const severity = req.query.severity;
    const status = req.query.status;
    const guestId = req.query.guestId;
    const filterParts: string[] = [];
    const params: any = {};
    if (severity) { filterParts.push('i.severity = $severity'); params.severity = severity; }
    if (status) { filterParts.push('i.status = $status'); params.status = status; }
    if (guestId) { filterParts.push('i.guestId = $guestId'); params.guestId = guestId; }

    const where = filterParts.length ? `WHERE ${filterParts.join(' AND ')}` : '';
    const q = `SELECT i.* FROM voyageops.guests.incidents i ${where} ORDER BY i.createdAt DESC LIMIT 1000`;
    const result = await db.cluster.query(q, { parameters: params, timeout: 10000 });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load incidents' });
  }
});

// API: Server-side prioritized guest incidents for Guest Recovery top-10 list
router.get('/incidents/prioritized', async (req, res) => {
  try {
    const q = `
      WITH scored AS (
        SELECT META(i).id AS incidentDocId,
               i AS incident,
               META(g).id AS guestDocId,
               g AS guest,
               ROUND(
                 IFMISSINGORNULL(g.onboardSpend, 0)
                 * CASE LOWER(IFMISSINGORNULL(i.severity, 'low'))
                     WHEN 'critical' THEN 4
                     WHEN 'high' THEN 3
                     WHEN 'medium' THEN 2
                     ELSE 1
                   END
                 * CASE LOWER(IFMISSINGORNULL(i.status, 'open'))
                     WHEN 'open' THEN 1.2
                     WHEN 'reviewing' THEN 1.1
                     WHEN 'approved' THEN 1.0
                     WHEN 'executed' THEN 0.8
                     WHEN 'closed' THEN 0.2
                     WHEN 'pending' THEN 1.0
                     ELSE 1.0
                   END
                 * CASE UPPER(IFMISSINGORNULL(g.loyaltyTier, 'GOLD'))
                     WHEN 'DIAMOND' THEN 2.0
                     WHEN 'ELITE PLATINUM' THEN 1.5
                     WHEN 'EMERALD' THEN 1.3
                     WHEN 'PLATINUM' THEN 1.1
                     ELSE 1.0
                   END
                 * 0.25,
                 0
               ) AS potential
        FROM voyageops.guests.incidents i
        JOIN voyageops.guests.guests g ON i.guestId = META(g).id
        WHERE LOWER(IFMISSINGORNULL(i.status, 'open')) != 'closed'
      ),
      dedup AS (
        SELECT scored.*,
               ROW_NUMBER() OVER (
                 PARTITION BY IFMISSINGORNULL(scored.incident.guestId, scored.guestDocId)
                 ORDER BY scored.potential DESC
               ) AS rankPerGuest
        FROM scored
      )
      SELECT OBJECT_PUT(dedup.incident, 'incidentId', IFMISSINGORNULL(dedup.incident.incidentId, dedup.incidentDocId)) AS incident,
             OBJECT_PUT(dedup.guest, 'guestId', IFMISSINGORNULL(dedup.guest.guestId, dedup.guestDocId)) AS guest,
             dedup.potential
      FROM dedup
      WHERE dedup.rankPerGuest = 1
      ORDER BY dedup.potential DESC
      LIMIT 10
    `;

    const result = await db.cluster.query(q, { timeout: 10000 });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load prioritized incidents' });
  }
});

// API: Excursions
router.get('/excursions', async (req, res) => {
  try {
    const q = `SELECT e.* FROM voyageops.excursions.excursions e ORDER BY e.date DESC`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load excursions' });
  }
});

// API: Venues
router.get('/venues', async (req, res) => {
  try {
    const q = `SELECT v.* FROM voyageops.operations.venues v ORDER BY v.currentOccupancy DESC`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load venues' });
  }
});

// API: Recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const agentType = req.query.agentType;
    const where = agentType ? 'WHERE r.agentType = $agentType' : '';
    const params = agentType ? { agentType } : {};
    const q = `SELECT r.* FROM voyageops.intelligence.recommendations r ${where} ORDER BY r.createdAt DESC`;
    const result = await db.cluster.query(q, { parameters: params });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

// API: Action proposals (worker-generated, per guest or incident)
router.get('/action-proposals', async (req, res) => {
  try {
    const guestId = req.query.guestId as string | undefined;
    const incidentId = req.query.incidentId as string | undefined;
    const filterParts: string[] = [];
    const params: any = {};
    if (guestId) { filterParts.push('p.guestId = $guestId'); params.guestId = guestId; }
    if (incidentId) { filterParts.push('p.incidentId = $incidentId'); params.incidentId = incidentId; }
    const where = filterParts.length ? `WHERE ${filterParts.join(' AND ')}` : '';
    const q = `SELECT META(p).id AS _key, p.* FROM voyageops.agent.action_proposals p ${where} ORDER BY p.createdAt DESC LIMIT 50`;
    const result = await db.cluster.query(q, { parameters: params, timeout: 10000 });
    res.json(result.rows);
  } catch (error) {
    const message = String((error as any)?.message || error || '');
    const missingIndex = message.includes('No index available on keyspace') && message.includes('action_proposals');

    if (!missingIndex) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to load action proposals' });
    }

    try {
      // Fallback path for clusters without a N1QL index on agent.action_proposals.
      // We can still resolve proposal docs via proposalId references stored on agent_runs.
      const guestId = req.query.guestId as string | undefined;
      const incidentId = req.query.incidentId as string | undefined;
      const runFilterParts: string[] = ['r.proposalId IS NOT MISSING'];
      const runParams: any = {};

      if (guestId) {
        runFilterParts.push('r.guestId = $guestId');
        runParams.guestId = guestId;
      }
      if (incidentId) {
        runFilterParts.push('r.incidentId = $incidentId');
        runParams.incidentId = incidentId;
      }

      const runsQuery = `
        SELECT r.proposalId, r.updatedAt
        FROM voyageops.agent.agent_runs r
        WHERE ${runFilterParts.join(' AND ')}
        ORDER BY r.updatedAt DESC
        LIMIT 100
      `;

      const runsResult = await db.cluster.query(runsQuery, { parameters: runParams, timeout: 10000 });
      const orderedProposalIds = Array.from(
        new Set(
          (runsResult.rows as any[])
            .map((row) => String(row.proposalId || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 50);

      const proposalFetches = await Promise.allSettled(
        orderedProposalIds.map(async (proposalId) => {
          const doc = await db.actionProposals.get(proposalId);
          return {
            _key: proposalId,
            ...(doc.content as Record<string, unknown> & { createdAt?: string }),
          };
        }),
      );

      const proposals = proposalFetches
        .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

      return res.json(proposals);
    } catch (fallbackError) {
      console.error(fallbackError);
      return res.status(500).json({ error: 'Failed to load action proposals' });
    }
  }
});

// API: Vector-powered agent query
router.post('/agent-query', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const agentType = String(req.body?.agentType || 'guest-recovery');
    const requestedIncidentId = extractIncidentIdFromQuery(query);
    const requestedGuestId = extractGuestIdFromQuery(query);

    if (!query) {
      return res.status(400).json({ error: 'query required' });
    }

    if (agentType !== 'guest-recovery') {
      return res.status(400).json({ error: 'agent-query currently supports guest-recovery only' });
    }

    let embeddingSource: 'openai' | 'incident-corpus-fallback' | 'guest-direct' = 'guest-direct';
    let successfulIndexes: string[] = [];
    let attemptedIndexes: string[] = [];

    let incidents: any[] = [];
    let retrievalMode: 'vector-index' | 'vector-fallback' = 'vector-index';
    let guestLookupStatus: 'found' | 'not-found' | undefined;

    if (requestedGuestId) {
      const requestedGuestResult = await db.cluster.query(
        `
        SELECT g.*
        FROM voyageops.guests.guests g
        WHERE g.guestId = $guestId OR LOWER(META(g).id) = $guestId
        LIMIT 1
        `,
        {
          parameters: { guestId: requestedGuestId },
          timeout: 10000,
        },
      );

      guestLookupStatus = requestedGuestResult.rows.length > 0 ? 'found' : 'not-found';

      retrievalMode = 'vector-fallback';
      const guestIncidentResult = await db.cluster.query(
        `
        SELECT META(i).id AS docId, i.*
        FROM voyageops.guests.incidents i
        WHERE LOWER(i.guestId) = $guestId
        ORDER BY i.updatedAt DESC
        LIMIT 8
        `,
        {
          parameters: { guestId: requestedGuestId },
          timeout: 10000,
        },
      );

      incidents = guestIncidentResult.rows.map((row: any) => ({ ...row, vectorScore: 1 }));
    } else {
      const embeddingResult = await resolveQueryEmbedding(query);
      embeddingSource = embeddingResult.embeddingSource;
      const embedding = embeddingResult.embedding;
      const vectorHits = await searchIncidentsByVectorIndexes(embedding, 8);
      successfulIndexes = vectorHits.successfulIndexes;
      attemptedIndexes = vectorHits.attemptedIndexes;

      if (vectorHits.hits.length > 0) {
        const keys = vectorHits.hits.map(hit => hit.id);
        const scoreById = new Map(vectorHits.hits.map(hit => [hit.id, hit.score]));

        const incidentDocs = await db.cluster.query(
          `SELECT META(i).id AS docId, i.* FROM voyageops.guests.incidents i USE KEYS $keys`,
          { parameters: { keys } },
        );

        incidents = incidentDocs.rows
          .map((row: any) => ({ ...row, vectorScore: Number(scoreById.get(row.docId) || 0) }))
          .sort((a: any, b: any) => b.vectorScore - a.vectorScore)
          .slice(0, 8);
      } else {
        retrievalMode = 'vector-fallback';
        incidents = await searchIncidentsByVectorFieldsFallback(embedding, 8);
      }
    }

    let incidentLookupStatus: 'found' | 'not-found' | undefined;
    if (requestedIncidentId) {
      const exactIncidentResult = await db.cluster.query(
        `
        SELECT META(i).id AS docId, i.*
        FROM voyageops.guests.incidents i
        WHERE i.incidentId = $incidentId OR META(i).id = $incidentId
        LIMIT 1
        `,
        {
          parameters: { incidentId: requestedIncidentId },
          timeout: 10000,
        },
      );

      if (exactIncidentResult.rows.length > 0) {
        incidentLookupStatus = 'found';
        const exact = { ...exactIncidentResult.rows[0], vectorScore: 1 };
        const exactId = String(exact.docId || exact.incidentId || exact.id || '');
        const existingIds = new Set(incidents.map((incident: any) => String(incident.docId || incident.incidentId || incident.id || '')));
        if (!existingIds.has(exactId)) {
          incidents = [exact, ...incidents].slice(0, 8);
        }
      } else {
        incidentLookupStatus = 'not-found';
      }
    }

    const guestIds = Array.from(new Set(incidents.map((i: any) => i.guestId).filter(Boolean)));
    if (requestedGuestId && !guestIds.includes(requestedGuestId)) {
      guestIds.push(requestedGuestId);
    }
    const guestsById = new Map<string, any>();
    if (guestIds.length > 0) {
      const guestsResult = await db.cluster.query(
        `SELECT g.* FROM voyageops.guests.guests g WHERE g.guestId IN $guestIds`,
        { parameters: { guestIds } },
      );
      guestsResult.rows.forEach((g: any) => {
        if (g.guestId) {
          guestsById.set(g.guestId, g);
        }
      });
    }

    const topIncidentId = incidents[0]?.incidentId || incidents[0]?.id || incidents[0]?.docId;
    let proposal: any | undefined;
    if (topIncidentId) {
      const proposalResult = await db.cluster.query(
        `
        SELECT p.*
        FROM voyageops.agent.action_proposals p
        WHERE p.incidentId = $incidentId
        ORDER BY p.createdAt DESC
        LIMIT 1
        `,
        { parameters: { incidentId: topIncidentId }, timeout: 10000 },
      );
      proposal = proposalResult.rows[0];
    }

    const response = buildGuestRecoveryChatResponse({
      query,
      incidents,
      guestsById,
      retrievalMode,
      proposal,
      requestedIncidentId,
      incidentLookupStatus,
      requestedGuestId,
      guestLookupStatus,
    });

    res.json({
      response,
      incidents,
      metadata: {
        embeddingSource,
        retrievalMode,
        requestedIncidentId,
        incidentLookupStatus,
        requestedGuestId,
        guestLookupStatus,
        indexesAttempted: attemptedIndexes,
        indexesUsed: successfulIndexes,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to run vector agent query' });
  }
});

// API: Recommendation state update
router.patch('/recommendations/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });

    await db.recommendations.mutateIn(id, [
      { type: 'replace', path: 'status', value: status },
      { type: 'replace', path: 'updatedAt', value: new Date().toISOString() },
    ]);
    const updated = await db.recommendations.get(id);
    res.json(updated.value);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update recommendation' });
  }
});

// API: Timeline
router.get('/timeline/:agentType', async (req, res) => {
  try {
    const agentType = req.params.agentType;
    const q = `
      SELECT t.* FROM voyageops.intelligence.timeline_events t
      WHERE t.agentType = $agentType
      ORDER BY t.timestamp DESC
    `;
    const result = await db.cluster.query(q, { parameters: { agentType } });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// API: Ship info
router.get('/ship-info', async (req, res) => {
  try {
    const candidateKeys = ['ship_info::current'];

    for (const key of candidateKeys) {
      try {
        const doc = await db.shipInfo.get(key);
        return res.json(doc.value);
      } catch (readError) {
        if (!(readError instanceof Error) || !readError.message.includes('document not found')) {
          throw readError;
        }
      }
    }

    const fallbackQuery = `
      SELECT s.*
      FROM voyageops.intelligence.ship_info s
      LIMIT 1
    `;
    const fallbackResult = await db.cluster.query(fallbackQuery);

    if (fallbackResult.rows.length > 0) {
      return res.json(fallbackResult.rows[0]);
    }

    res.status(404).json({ error: 'ship info not found' });
  } catch (error) {
    if (error instanceof Error && error.message.includes('document not found')) {
      res.status(404).json({ error: 'ship info not found' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Failed to load ship info' });
    }
  }
});

export default router;
