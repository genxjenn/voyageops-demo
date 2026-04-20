import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

const BUCKET = process.env.COUCHBASE_BUCKET || 'voyageops';
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

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
      if (attempt === maxAttempts) {
        break;
      }
      const backoffMs = 500 * 2 ** (attempt - 1);
      console.warn(`Embedding attempt ${attempt}/${maxAttempts} failed. Retrying in ${backoffMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Embedding generation failed after retries');
}

async function backfillIncidentEmbeddings(): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    console.log('Skipping embedding backfill: OPENAI_API_KEY not set.');
    return 0;
  }

  const query = `
    SELECT META(i).id AS incidentId,
           i.category,
           i.type,
           i.description,
           i.vector_category_incidents IS MISSING AS needsCategory,
           i.vector_type_incidents IS MISSING AS needsType,
           i.vector_desc_incidents IS MISSING AS needsDesc
    FROM \`${BUCKET}\`.guests.incidents AS i
    WHERE i.vector_category_incidents IS MISSING
       OR i.vector_type_incidents IS MISSING
       OR i.vector_desc_incidents IS MISSING
  `;

  const result = await db.cluster.query(query, { timeout: 30000 });
  const rows = result.rows as Array<{
    incidentId: string;
    category: string;
    type: string;
    description: string;
    needsCategory: boolean;
    needsType: boolean;
    needsDesc: boolean;
  }>;

  if (rows.length === 0) {
    return 0;
  }

  console.log(`Backfilling embeddings for ${rows.length} incident(s)...`);
  let updated = 0;

  for (const row of rows) {
    const patch: Record<string, number[]> = {};

    if (row.needsCategory && row.category) {
      patch.vector_category_incidents = await getEmbeddingWithRetry(row.category);
    }
    if (row.needsType && row.type) {
      patch.vector_type_incidents = await getEmbeddingWithRetry(row.type);
    }
    if (row.needsDesc && row.description) {
      patch.vector_desc_incidents = await getEmbeddingWithRetry(row.description);
    }

    if (Object.keys(patch).length > 0) {
      const existing = await db.incidents.get(row.incidentId);
      await db.incidents.upsert(row.incidentId, { ...existing.content, ...patch });
      updated += 1;
    }
  }

  return updated;
}

function isMissingKeyspaceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /keyspace|collection|scope|not found|does not exist/i.test(message);
}

async function collectionExists(scopeName: string, collectionName: string): Promise<boolean> {
  try {
    await db.cluster.query(
      `
      SELECT RAW 1
      FROM \`${BUCKET}\`.\`${scopeName}\`.\`${collectionName}\`
      LIMIT 1
      `,
      { timeout: 5000 },
    );
    return true;
  } catch (error) {
    if (isMissingKeyspaceError(error)) {
      return false;
    }
    throw error;
  }
}

async function collectionCount(scopeName: string, collectionName: string): Promise<number> {
  const result = await db.cluster.query(
    `
    SELECT RAW COUNT(1)
    FROM \`${BUCKET}\`.\`${scopeName}\`.\`${collectionName}\`
    `,
    { timeout: 10000 },
  );
  return Number(result.rows[0] ?? 0);
}

async function seedIncidentsFromDataFileIfEmpty(): Promise<number> {
  const incidentCount = await collectionCount('guests', 'incidents');
  if (incidentCount > 0) {
    return 0;
  }

  const dataPath = path.resolve(process.cwd(), 'data/voyageops.guests.incidents');
  const raw = await readFile(dataPath, 'utf8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let upserted = 0;
  for (const line of lines) {
    const doc = JSON.parse(line) as Record<string, unknown>;
    const id = String(doc.incidentId || '').trim();
    if (!id) continue;
    await db.incidents.upsert(id, doc);
    upserted += 1;
  }

  return upserted;
}

async function resetAllIncidentsToOpen(): Promise<number> {
  const resetQuery = `
    UPDATE voyageops.guests.incidents AS i
    SET i.status = "open",
        i.updatedAt = NOW_STR()
    RETURNING RAW META(i).id
  `;

  const result = await db.cluster.query(resetQuery, { timeout: 20000 });
  const rows = result.rows as string[];
  return rows.length;
}

async function enqueueAllOpenIncidents(): Promise<number> {
  const enqueueQuery = `
    UPSERT INTO \`${BUCKET}\`.agent.agent_runs (KEY runId, VALUE runDoc)
    SELECT META(i).id || "::guest-recovery" AS runId,
           {
             "runId": META(i).id || "::guest-recovery",
             "agentType": "guest-recovery",
             "guestId": i.guestId,
             "incidentId": META(i).id,
             "status": "pending",
             "lastProcessedStep": "demo_reset_requeued",
             "query": IFMISSINGORNULL(i.description, ""),
             "createdAt": NOW_STR(),
             "updatedAt": NOW_STR()
           } AS runDoc
    FROM \`${BUCKET}\`.guests.incidents AS i
    WHERE LOWER(IFMISSINGORNULL(i.status, "open")) = "open"
      AND i.guestId IS NOT MISSING
      AND i.guestId != ""
  `;

  await db.cluster.query(enqueueQuery, { timeout: 30000 });

  const countQuery = `
    SELECT RAW COUNT(1)
    FROM \`${BUCKET}\`.agent.agent_runs AS r
    WHERE r.agentType = "guest-recovery"
      AND r.status = "pending"
  `;
  const countResult = await db.cluster.query(countQuery, { timeout: 10000 });
  return Number(countResult.rows[0] ?? 0);
}

async function purgeCollection(scopeName: string, collectionName: string): Promise<number> {
  const result = await db.cluster.query(
    `
    DELETE FROM \`${BUCKET}\`.\`${scopeName}\`.\`${collectionName}\` AS d
    RETURNING RAW META(d).id
    `,
    { timeout: 20000 },
  );

  return (result.rows as string[]).length;
}

async function countDistinctAgentRunIncidents(): Promise<number> {
  const countQuery = `
    SELECT RAW COUNT(1)
    FROM (
      SELECT DISTINCT r.incidentId
      FROM voyageops.agent.agent_runs AS r
      WHERE r.incidentId IS NOT MISSING
        AND r.incidentId != ""
    ) AS x
  `;

  const result = await db.cluster.query(countQuery, { timeout: 10000 });
  return Number(result.rows[0] ?? 0);
}

async function main() {
  await initCouchbase();
  const shouldRequeue = process.argv.includes('--requeue');

  const incidentsExists = await collectionExists('guests', 'incidents');
  const agentRunsExists = await collectionExists('agent', 'agent_runs');
  const actionProposalsExists = await collectionExists('agent', 'action_proposals');
  const actionExecutionsExists = await collectionExists('agent', 'action_executions');

  if (incidentsExists) {
    const seeded = await seedIncidentsFromDataFileIfEmpty();
    if (seeded > 0) {
      console.log(`Seeded incidents from data/voyageops.guests.incidents: ${seeded}`);
    }

    const backfilled = await backfillIncidentEmbeddings();
    if (backfilled > 0) {
      console.log(`Backfilled embeddings for ${backfilled} incident(s).`);
    }

    const reopenedCount = await resetAllIncidentsToOpen();
    console.log(`Incidents reset to open: ${reopenedCount}`);
  } else {
    console.log('Skipping incident reset: guests.incidents collection does not exist in this cluster.');
  }

  if (actionProposalsExists) {
    const deletedProposals = await purgeCollection('agent', 'action_proposals');
    console.log(`Deleted action_proposals docs: ${deletedProposals}`);
  } else {
    console.log('Skipping proposal cleanup: agent.action_proposals collection does not exist in this cluster.');
  }

  if (agentRunsExists) {
    const deletedRuns = await purgeCollection('agent', 'agent_runs');
    console.log(`Deleted agent_runs docs: ${deletedRuns}`);

    if (shouldRequeue && incidentsExists) {
      const requeuedPending = await enqueueAllOpenIncidents();
      console.log(`Requeued guest-recovery pending runs: ${requeuedPending}`);
    } else if (!shouldRequeue) {
      console.log('Left agent_runs empty. Use --requeue to enqueue pending runs intentionally.');
    }
  } else {
    console.log('Skipping run cleanup: agent.agent_runs collection does not exist in this cluster.');
  }

  if (actionExecutionsExists) {
    const deletedExecutions = await purgeCollection('agent', 'action_executions');
    console.log(`Deleted action_executions docs: ${deletedExecutions}`);
  } else {
    console.log('Skipping execution cleanup: agent.action_executions collection does not exist in this cluster.');
  }
}

main().catch((error) => {
  console.error('Failed to reset demo incidents:', error);
  process.exit(1);
});
