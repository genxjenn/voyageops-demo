// src/api/routes.ts
import express from 'express';
import { db } from '../lib/couchbase.ts';

const router = express.Router();

const VECTOR_INDEX_CONFIG = [
  {
    fieldName: 'vector_category_incidents',
    indexNames: [
      process.env.CB_VECTOR_INDEX_CATEGORY,
      'hyperscale_voGuestIncidentOpenAI_vector_category_incidents',
      'vector_category_incidents',
      'idx_incidents_vec_category',
      'idx_vector_category_incidents',
    ].filter(Boolean) as string[],
  },
  {
    fieldName: 'vector_type_incidents',
    indexNames: [
      process.env.CB_VECTOR_INDEX_TYPE,
      'hyperscale_voGuestIncidentOpenAI_vector_type_incidents',
      'vector_type_incidents',
      'idx_incidents_vec_type',
      'idx_vector_type_incidents',
    ].filter(Boolean) as string[],
  },
  {
    fieldName: 'vector_desc_incidents',
    indexNames: [
      process.env.CB_VECTOR_INDEX_DESC,
      'hyperscale_voGuestIncidentOpenAI_vector_desc_incidents',
      'vector_desc_incidents',
      'idx_incidents_vec_desc',
      'idx_vector_desc_incidents',
    ].filter(Boolean) as string[],
  },
];
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

function tokenizeText(input: string) {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
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

async function getQueryEmbedding(query: string) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY (or OPENAI_KEY) is missing');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: query,
      model: OPENAI_EMBED_MODEL,
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
    const q = `SELECT g.* FROM voyageops.guests.guests g ORDER BY g.name ASC`;
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

// API: Vector-powered agent query
router.post('/agent-query', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const agentType = String(req.body?.agentType || 'guest-recovery');

    if (!query) {
      return res.status(400).json({ error: 'query required' });
    }

    if (agentType !== 'guest-recovery') {
      return res.status(400).json({ error: 'agent-query currently supports guest-recovery only' });
    }

    const { embedding, embeddingSource } = await resolveQueryEmbedding(query);
    const { hits, successfulIndexes, attemptedIndexes } = await searchIncidentsByVectorIndexes(embedding, 8);

    let incidents: any[] = [];
    let retrievalMode: 'vector-index' | 'vector-fallback' = 'vector-index';

    if (hits.length > 0) {
      const keys = hits.map(hit => hit.id);
      const scoreById = new Map(hits.map(hit => [hit.id, hit.score]));

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

    const guestIds = Array.from(new Set(incidents.map((i: any) => i.guestId).filter(Boolean)));
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

    const lines = incidents.map((incident: any, idx: number) => {
      const guest = guestsById.get(incident.guestId);
      const guestName = guest?.fullName || guest?.name || incident.guestId || 'Unknown guest';
      const incidentId = incident.incidentId || incident.id || incident.docId || `incident-${idx + 1}`;
      const score = typeof incident.vectorScore === 'number' ? incident.vectorScore.toFixed(4) : 'n/a';
      return `${idx + 1}. **${incidentId}** | ${String(incident.severity || 'unknown').toUpperCase()} | ${guestName}\n   ${incident.type || 'Unknown type'}: ${incident.category || 'Unknown category'}\n   ${incident.description || 'No description'}\n   Similarity: ${score}`;
    });

    const response = [
      `### Vector Retrieval Results`,
      ``,
      `Query: _${query}_`,
      `Retrieval mode: **${retrievalMode}**`,
      successfulIndexes.length > 0 ? `Vector indexes used: ${successfulIndexes.join(', ')}` : `Vector indexes used: none (fallback computed from stored vectors)`,
      ``,
      lines.length > 0 ? lines.join('\n\n') : `No semantically similar incidents were found.`,
    ].join('\n');

    res.json({
      response,
      incidents,
      metadata: {
        embeddingSource,
        retrievalMode,
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
    const candidateKeys = ['ship_info::current', 'IOS-001'];

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
