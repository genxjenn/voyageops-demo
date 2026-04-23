import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

type IncidentDoc = Record<string, unknown> & {
  incidentId: string;
  guestId: string;
  description?: string;
  category?: string;
  type?: string;
};

type ParsedArgs = {
  filePath: string;
  mode: 'insert' | 'upsert';
  backfillEmbeddings: boolean;
  showHelp: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let filePath = '';
  let mode: 'insert' | 'upsert' = 'upsert';
  let backfillEmbeddings = true;
  const showHelp = argv.includes('--help') || argv.includes('-h');

  if (!showHelp) {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];

      if (arg === '--file' || arg === '-f') {
        filePath = argv[i + 1] ?? '';
        i += 1;
        continue;
      }

      if (arg === '--insert-only') {
        mode = 'insert';
        continue;
      }

      if (arg === '--no-embeddings') {
        backfillEmbeddings = false;
      }
    }

    if (!filePath.trim()) {
      throw new Error('Missing required --file argument. Example: npm run demo:load-incidents-for-recovery -- --file data/my-incidents.ndjson');
    }
  }

  return {
    filePath: filePath.trim() ? path.resolve(process.cwd(), filePath.trim()) : '',
    mode,
    backfillEmbeddings,
    showHelp,
  };
}

function printUsage(): void {
  console.log('Usage: npm run demo:load-incidents-for-recovery -- --file <path> [options]');
  console.log('');
  console.log('Required:');
  console.log('  --file, -f <path>    Path to incident file (JSON object, JSON array, or NDJSON)');
  console.log('');
  console.log('Options:');
  console.log('  --insert-only        Fail if incident document already exists (default: upsert/overwrite)');
  console.log('  --no-embeddings      Skip OpenAI vector generation for category/type/description fields');
  console.log('  --help, -h           Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  Load a single incident JSON file and auto-generate embeddings:');
  console.log('    npm run demo:load-incidents-for-recovery -- --file data/my-incident.json');
  console.log('');
  console.log('  Load an NDJSON file without overwriting existing docs:');
  console.log('    npm run demo:load-incidents-for-recovery -- --file data/incidents.ndjson --insert-only');
  console.log('');
  console.log('  Load and skip embedding generation (faster, requires vectors already in file):');
  console.log('    npm run demo:load-incidents-for-recovery -- --file data/incidents.ndjson --no-embeddings');
  console.log('');
  console.log('File formats accepted:');
  console.log('  • Single JSON object  { "incidentId": "...", "guestId": "...", ... }');
  console.log('  • JSON array          [{ ... }, { ... }]');
  console.log('  • NDJSON              one JSON object per line');
  console.log('');
  console.log('Required fields per incident: incidentId, guestId');
  console.log('Required for embedding generation: category, type, description');
  console.log('');
  console.log('After loading, incidents are automatically enqueued as pending agent_runs.');
  console.log('Start the worker if not already running: npm run demo:worker');
}

function parseIncidentFile(raw: string): IncidentDoc[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Accept JSON array/object files first, then fall back to NDJSON.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => normalizeIncident(item));
      }
      return [normalizeIncident(parsed)];
    } catch {
      // Continue into NDJSON parsing path.
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeIncident(JSON.parse(line)));
}

function normalizeIncident(input: unknown): IncidentDoc {
  if (!input || typeof input !== 'object') {
    throw new Error('Incident entry is not a JSON object');
  }

  const doc = { ...(input as Record<string, unknown>) };
  const incidentId = String(doc.incidentId ?? '').trim();
  const guestId = String(doc.guestId ?? '').trim();

  if (!incidentId) {
    throw new Error('Incident entry is missing incidentId');
  }
  if (!guestId) {
    throw new Error(`Incident ${incidentId} is missing guestId`);
  }

  doc.incidentId = incidentId;
  doc.guestId = guestId;

  // Make docs safe for demo reset/worker processing.
  doc.status = String(doc.status ?? 'open').trim() || 'open';
  if (!doc.createdAt) doc.createdAt = new Date().toISOString();
  doc.updatedAt = new Date().toISOString();

  return doc as IncidentDoc;
}

async function getEmbedding(text: string): Promise<number[]> {
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
      input: text,
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

async function getEmbeddingWithRetry(text: string, maxAttempts = 4): Promise<number[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await getEmbedding(text);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;

      const backoffMs = 500 * 2 ** (attempt - 1);
      console.warn(`Embedding attempt ${attempt}/${maxAttempts} failed. Retrying in ${backoffMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Embedding generation failed after retries');
}

async function maybeBackfillVectors(doc: IncidentDoc, enabled: boolean): Promise<IncidentDoc> {
  if (!enabled) return doc;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required to generate vector_category_incidents, vector_type_incidents, and vector_desc_incidents');
  }

  const next = { ...doc };

  const category = typeof next.category === 'string' ? next.category.trim() : '';
  const type = typeof next.type === 'string' ? next.type.trim() : '';
  const description = typeof next.description === 'string' ? next.description.trim() : '';

  if (!category || !type || !description) {
    throw new Error(
      `Incident ${next.incidentId} must include category, type, and description to generate vector fields`,
    );
  }

  if (!Array.isArray(next.vector_category_incidents) && typeof next.category === 'string' && next.category.trim()) {
    next.vector_category_incidents = await getEmbeddingWithRetry(category);
  }

  if (!Array.isArray(next.vector_type_incidents) && typeof next.type === 'string' && next.type.trim()) {
    next.vector_type_incidents = await getEmbeddingWithRetry(type);
  }

  if (!Array.isArray(next.vector_desc_incidents) && typeof next.description === 'string' && next.description.trim()) {
    next.vector_desc_incidents = await getEmbeddingWithRetry(description);
  }

  return next;
}

async function clearPriorRunState(incidentIds: string[]): Promise<void> {
  if (incidentIds.length === 0) return;

  await db.cluster.query(
    `
    DELETE FROM voyageops.agent.action_executions AS e
    WHERE e.incidentId IN $incidentIds
    `,
    { parameters: { incidentIds }, timeout: 15000 },
  );

  await db.cluster.query(
    `
    DELETE FROM voyageops.agent.action_proposals AS p
    WHERE p.incidentId IN $incidentIds
    `,
    { parameters: { incidentIds }, timeout: 15000 },
  );

  await db.cluster.query(
    `
    DELETE FROM voyageops.agent.agent_runs AS r
    WHERE r.incidentId IN $incidentIds
    `,
    { parameters: { incidentIds }, timeout: 15000 },
  );
}

async function enqueueRuns(incidents: IncidentDoc[]): Promise<number> {
  let enqueued = 0;

  for (const incident of incidents) {
    const runId = `${incident.incidentId}::guest-recovery`;
    const now = new Date().toISOString();

    await db.agentRuns.upsert(runId, {
      runId,
      agentType: 'guest-recovery',
      guestId: incident.guestId,
      incidentId: incident.incidentId,
      status: 'pending',
      lastProcessedStep: 'custom_incident_load',
      query: String(incident.description ?? ''),
      createdAt: now,
      updatedAt: now,
    });

    enqueued += 1;
  }

  return enqueued;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    printUsage();
    return;
  }

  await initCouchbase();

  const raw = await readFile(args.filePath, 'utf8');
  const parsedIncidents = parseIncidentFile(raw);

  if (parsedIncidents.length === 0) {
    console.log(`No incidents found in ${args.filePath}`);
    return;
  }

  const preparedIncidents: IncidentDoc[] = [];
  for (const incident of parsedIncidents) {
    preparedIncidents.push(await maybeBackfillVectors(incident, args.backfillEmbeddings));
  }

  let inserted = 0;
  let upserted = 0;
  for (const incident of preparedIncidents) {
    if (args.mode === 'insert') {
      await db.incidents.insert(incident.incidentId, incident);
      inserted += 1;
    } else {
      await db.incidents.upsert(incident.incidentId, incident);
      upserted += 1;
    }
  }

  const incidentIds = preparedIncidents.map((i) => i.incidentId);
  await clearPriorRunState(incidentIds);
  const enqueued = await enqueueRuns(preparedIncidents);

  console.log('Custom incident load complete.');
  console.log(`File: ${args.filePath}`);
  console.log(`Incidents parsed: ${parsedIncidents.length}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Upserted: ${upserted}`);
  console.log(`Runs enqueued: ${enqueued}`);

  console.log('If the worker loop is not running, start it with: npm run demo:worker');
}

main().catch((error) => {
  console.error('Failed to load custom incidents for recovery:', error);
  process.exit(1);
});
