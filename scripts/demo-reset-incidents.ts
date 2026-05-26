import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

const BUCKET = process.env.COUCHBASE_BUCKET || 'voyageops';
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

type ResetArgs = {
  shouldRequeue: boolean;
  forceRebuildEmbeddings: boolean;
  targetIncidentId?: string;
  shouldShowHelp: boolean;
  allowGlobalReset: boolean;
  /** First-time setup: load incidents from data file when collection is empty (no purge). */
  seedIfEmpty: boolean;
};

function getArgValue(argv: string[], key: string): string | undefined {
  const exactPrefix = `${key}=`;
  const exact = argv.find((arg) => arg.startsWith(exactPrefix));
  if (exact) {
    const value = exact.slice(exactPrefix.length).trim();
    return value || undefined;
  }

  const index = argv.findIndex((arg) => arg === key);
  if (index >= 0 && index + 1 < argv.length) {
    const value = argv[index + 1].trim();
    return value || undefined;
  }

  return undefined;
}

function parseArgs(argv: string[]): ResetArgs {
  const targetIncidentId = getArgValue(argv, '--incidentId') ?? getArgValue(argv, '--incident-id');
  return {
    shouldRequeue: argv.includes('--requeue'),
    forceRebuildEmbeddings: argv.includes('--rebuild-embeddings') || argv.includes('--force-embeddings'),
    targetIncidentId,
    shouldShowHelp: argv.includes('--help') || argv.includes('-h'),
    allowGlobalReset: argv.includes('--all'),
    seedIfEmpty: argv.includes('--seed-if-empty'),
  };
}

function printUsage(): void {
  console.log('Usage: npm run demo:reset-incidents -- [--incidentId <id>] [--requeue] [--all] [--seed-if-empty] [--rebuild-embeddings]');
  console.log('');
  console.log('Examples:');
  console.log('  Targeted reset + requeue one incident:');
  console.log('    npm run demo:reset-incidents -- --incidentId IN_IOS-114_204 --requeue');
  console.log('  Global reset (destructive) + requeue all open incidents:');
  console.log('    npm run demo:reset-incidents -- --all --requeue');
  console.log('');
  console.log('  First-time cluster seed (load incidents only when collection is empty):');
  console.log('    npm run demo:reset-incidents -- --seed-if-empty');
  console.log('');
  console.log('Safety: Destructive reset requires --all. Without --incidentId, --all, or --seed-if-empty, this script exits without changes.');
}

async function runSeedIfEmptyFlow(): Promise<void> {
  const incidentsExists = await collectionExists('guests', 'incidents');
  if (!incidentsExists) {
    console.log('Skipping incident seed: guests.incidents collection does not exist in this cluster.');
    return;
  }

  const seeded = await seedIncidentsFromDataFileIfEmpty();
  if (seeded > 0) {
    console.log(`Seeded incidents from data/voyageops.guests.incidents: ${seeded}`);
    const backfilled = await backfillIncidentEmbeddings(false);
    if (backfilled > 0) {
      console.log(`Backfilled embeddings for ${backfilled} incident(s).`);
    }
    const agentRunsExists = await collectionExists('agent', 'agent_runs');
    if (agentRunsExists) {
      const pending = await enqueueAllOpenIncidents();
      console.log(`Enqueued guest-recovery pending runs (${pending} pending total).`);
    }
    return;
  }

  const count = await collectionCount('guests', 'incidents');
  console.log(`Incidents collection already has ${count} document(s); no seed needed.`);
  console.log('For a full reload: npm run demo:reset-incidents -- --all');
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

async function backfillIncidentEmbeddings(forceRebuildEmbeddings = false): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    console.log('Skipping embedding backfill: OPENAI_API_KEY not set.');
    return 0;
  }

  const query = `
    SELECT META(i).id AS incidentId,
           i.category,
           i.type,
           i.description,
           ($forceRebuildEmbeddings OR i.vector_category_incidents IS MISSING) AS needsCategory,
           ($forceRebuildEmbeddings OR i.vector_type_incidents IS MISSING) AS needsType,
           ($forceRebuildEmbeddings OR i.vector_desc_incidents IS MISSING) AS needsDesc
    FROM \`${BUCKET}\`.guests.incidents AS i
    WHERE $forceRebuildEmbeddings
       OR i.vector_category_incidents IS MISSING
       OR i.vector_type_incidents IS MISSING
       OR i.vector_desc_incidents IS MISSING
  `;

  const result = await db.cluster.query(query, {
    timeout: 30000,
    parameters: { forceRebuildEmbeddings },
  });
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

  const modeLabel = forceRebuildEmbeddings ? 'Rebuilding' : 'Backfilling';
  console.log(`${modeLabel} embeddings for ${rows.length} incident(s)...`);
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

  return upsertIncidentsFromDataFile();
}

async function upsertIncidentsFromDataFile(): Promise<number> {
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

async function upsertTargetedIncidentFromDataFile(targetIncidentId: string): Promise<number> {
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
    if (id === targetIncidentId) {
      await db.incidents.upsert(id, doc);
      upserted += 1;
      break; // Found it, no need to process the rest
    }
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

async function purgeIncidentsCollection(): Promise<number> {
  const result = await db.cluster.query(
    `
    DELETE FROM \`${BUCKET}\`.guests.incidents AS i
    RETURNING RAW META(i).id
    `,
    { timeout: 30000 },
  );
  return (result.rows as string[]).length;
}

async function resetIncidentToOpen(incidentId: string): Promise<number> {
  const resetQuery = `
    UPDATE voyageops.guests.incidents AS i
    SET i.status = "open",
        i.updatedAt = NOW_STR()
    WHERE META(i).id = $incidentId
    RETURNING RAW META(i).id
  `;

  const result = await db.cluster.query(resetQuery, {
    timeout: 20000,
    parameters: { incidentId },
  });
  return (result.rows as string[]).length;
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

async function enqueueSingleIncident(incidentId: string): Promise<number> {
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
    WHERE META(i).id = $incidentId
      AND i.guestId IS NOT MISSING
      AND i.guestId != ""
    RETURNING RAW META().id
  `;

  const result = await db.cluster.query(enqueueQuery, {
    timeout: 30000,
    parameters: { incidentId },
  });

  return (result.rows as string[]).length;
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

async function purgeCollectionByIncident(
  scopeName: string,
  collectionName: string,
  incidentId: string,
): Promise<number> {
  const result = await db.cluster.query(
    `
    DELETE FROM \`${BUCKET}\`.\`${scopeName}\`.\`${collectionName}\` AS d
    WHERE d.incidentId = $incidentId
    RETURNING RAW META(d).id
    `,
    {
      timeout: 20000,
      parameters: { incidentId },
    },
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
  const args = parseArgs(process.argv.slice(2));
  const isTargeted = Boolean(args.targetIncidentId);

  if (args.shouldShowHelp) {
    printUsage();
    return;
  }

  if (args.seedIfEmpty && !isTargeted && !args.allowGlobalReset) {
    await runSeedIfEmptyFlow();
    return;
  }

  if (!isTargeted && !args.allowGlobalReset) {
    console.log('No scope selected. Provide --incidentId <id> for targeted reset, --all for global reset, or --seed-if-empty for first-time load.');
    console.log('Run with --help for usage.');
    return;
  }

  const incidentsExists = await collectionExists('guests', 'incidents');
  const agentRunsExists = await collectionExists('agent', 'agent_runs');
  const actionProposalsExists = await collectionExists('agent', 'action_proposals');
  const actionExecutionsExists = await collectionExists('agent', 'action_executions');
  const chatSessionsExists = await collectionExists('agent', 'chat_sessions');
  const chatMessagesExists = await collectionExists('agent', 'chat_messages');

  const workerDistinctIncidentCountBefore = agentRunsExists ? await countDistinctAgentRunIncidents() : 0;
  if (workerDistinctIncidentCountBefore > 0) {
    console.log(
      `Note: ${workerDistinctIncidentCountBefore} incident(s) currently have agent_runs docs. ` +
      'If the worker loop is running, it may recreate proposals/runs during this reset.',
    );
  }

  if (isTargeted && !args.shouldRequeue) {
    console.log('Note: --incidentId was provided without --requeue. No pending run will be enqueued.');
  }

  // Cleanup first so resets/reloads happen on a clean slate.
  if (actionProposalsExists) {
    const deletedProposals = isTargeted
      ? await purgeCollectionByIncident('agent', 'action_proposals', String(args.targetIncidentId))
      : await purgeCollection('agent', 'action_proposals');
    console.log(`Deleted action_proposals docs: ${deletedProposals}`);
  } else {
    console.log('Skipping proposal cleanup: agent.action_proposals collection does not exist in this cluster.');
  }

  if (agentRunsExists) {
    const deletedRuns = isTargeted
      ? await purgeCollectionByIncident('agent', 'agent_runs', String(args.targetIncidentId))
      : await purgeCollection('agent', 'agent_runs');
    console.log(`Deleted agent_runs docs: ${deletedRuns}`);
  } else {
    console.log('Skipping run cleanup: agent.agent_runs collection does not exist in this cluster.');
  }

  if (actionExecutionsExists) {
    const deletedExecutions = isTargeted
      ? await purgeCollectionByIncident('agent', 'action_executions', String(args.targetIncidentId))
      : await purgeCollection('agent', 'action_executions');
    console.log(`Deleted action_executions docs: ${deletedExecutions}`);
  } else {
    console.log('Skipping execution cleanup: agent.action_executions collection does not exist in this cluster.');
  }

  if (chatSessionsExists) {
    if (isTargeted) {
      console.log('Skipped chat_sessions cleanup in targeted mode.');
    } else {
      const deletedSessions = await purgeCollection('agent', 'chat_sessions');
      console.log(`Deleted chat_sessions docs: ${deletedSessions}`);
    }
  } else {
    console.log('Skipping chat session cleanup: agent.chat_sessions collection does not exist in this cluster.');
  }

  if (chatMessagesExists) {
    if (isTargeted) {
      console.log('Skipped chat_messages cleanup in targeted mode.');
    } else {
      const deletedMessages = await purgeCollection('agent', 'chat_messages');
      console.log(`Deleted chat_messages docs: ${deletedMessages}`);
    }
  } else {
    console.log('Skipping chat message cleanup: agent.chat_messages collection does not exist in this cluster.');
  }

  // Incidents are reset/reloaded after cleanup.
  if (incidentsExists) {
    if (isTargeted) {
      if (args.forceRebuildEmbeddings) {
        console.log('Ignoring --rebuild-embeddings/--force-embeddings in targeted mode to avoid rebuilding all incident vectors.');
      }

      // Physically delete the specific incident and reload it from the seed data file
      try {
        await db.incidents.remove(String(args.targetIncidentId));
        console.log(`Physically deleted target incident: ${args.targetIncidentId}`);
      } catch (e: any) {
        if (e.message && !e.message.includes('document not found')) {
          console.warn(`Could not delete incident ${args.targetIncidentId}:`, e.message);
        }
      }

      const reloadedCount = await upsertTargetedIncidentFromDataFile(String(args.targetIncidentId));
      console.log(`Reloaded target incident from data file: ${reloadedCount} (${args.targetIncidentId})`);
    } else if (args.allowGlobalReset) {
      // Physically delete ALL incidents and reload them from the seed data file
      const deletedIncidents = await purgeIncidentsCollection();
      console.log(`Physically deleted incidents before reload: ${deletedIncidents}`);
      
      const reloaded = await upsertIncidentsFromDataFile();
      console.log(`Reloaded incidents from data/voyageops.guests.incidents: ${reloaded}`);
    } else {
      const seeded = await seedIncidentsFromDataFileIfEmpty();
      if (seeded > 0) {
        console.log(`Seeded incidents from data/voyageops.guests.incidents: ${seeded}`);
      }
    }

    if (!isTargeted && args.allowGlobalReset) {
      const backfilled = await backfillIncidentEmbeddings(args.forceRebuildEmbeddings);
      if (backfilled > 0) {
        if (args.forceRebuildEmbeddings) {
          console.log(`Rebuilt embeddings for ${backfilled} incident(s).`);
        } else {
          console.log(`Backfilled embeddings for ${backfilled} incident(s).`);
        }
      }
    }
  } else {
    console.log('Skipping incident reset: guests.incidents collection does not exist in this cluster.');
  }

  // Requeue happens last, intentionally.
  if (agentRunsExists) {
    if (args.shouldRequeue && incidentsExists) {
      if (isTargeted) {
        const requeuedTarget = await enqueueSingleIncident(String(args.targetIncidentId));
        console.log(`Requeued guest-recovery pending runs for ${args.targetIncidentId}: ${requeuedTarget}`);
      } else {
        const requeuedPending = await enqueueAllOpenIncidents();
        console.log(`Requeued guest-recovery pending runs: ${requeuedPending}`);
      }
    } else if (!args.shouldRequeue) {
      console.log('Left agent_runs empty. Use --requeue to enqueue pending runs intentionally.');
    }
  }
}

main().catch((error) => {
  console.error('Failed to reset demo incidents:', error);
  process.exit(1);
});
