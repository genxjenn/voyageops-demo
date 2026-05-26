#!/usr/bin/env npx tsx
/**
 * Vector indexes for Guest Recovery — run AFTER seed scripts populate embeddings.
 * Creates Query GSI vector indexes (SQL++) and Search hybrid indexes (FTS) for the worker.
 */
import 'dotenv/config';
import { resolveFromRepo } from './lib/repo-root.ts';
import { runSqlFile } from './lib/run-sql-file.ts';
import { deploySearchIndexesFromManifest } from './lib/search-index-deploy.ts';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

const VECTOR_SQL = resolveFromRepo('database/create.vector.indexes.sql');

const RECOMMENDED_ENV = `
Add or verify these in .env (names must match database/create.vector.indexes.sql):

CB_VECTOR_INDEX_CATEGORY=voGuestIncident_vector_category_incidents
CB_VECTOR_INDEX_TYPE=voGuestIncident_vector_type_incidents
CB_VECTOR_INDEX_DESC=voGuestIncident_vector_desc_incidents
CB_PLAYBOOK_VECTOR_INDEX=voAgent_vector_playbooks_embedding
CB_VECTOR_INDEX_OUTCOMES=voAgent_vector_outcomes_embedding
`;

async function warnIfCollectionsEmpty(force: boolean) {
  if (force) return;

  await initCouchbase();
  const checks = [
    { label: 'voyageops.guests.incidents', query: 'SELECT COUNT(1) AS c FROM voyageops.guests.incidents LIMIT 1' },
    { label: 'voyageops.agent.action_catalog', query: 'SELECT COUNT(1) AS c FROM voyageops.agent.action_catalog LIMIT 1' },
  ];

  for (const { label, query } of checks) {
    try {
      const result = await db.cluster.query(query, { timeout: 30_000 });
      const count = Number((result.rows as { c?: number }[])?.[0]?.c ?? 0);
      if (count === 0) {
        console.warn(`  Warning: ${label} appears empty. Run seed scripts before vector indexes, or pass --force.`);
      }
    } catch {
      console.warn(`  Warning: could not count documents in ${label}.`);
    }
  }
}

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  };
}

async function main() {
  const { dryRun, force } = parseArgs(process.argv.slice(2));

  console.log('VoyageOps vector index setup (post-seed)');
  if (!dryRun) {
    await warnIfCollectionsEmpty(force);
  }

  console.log('\n--- Query GSI vector indexes (SQL++) ---');
  const summary = await runSqlFile(VECTOR_SQL, {
    dryRun,
    queryTimeoutMs: 300_000,
    skipVectorIndexIfNoEmbeddings: true,
    continueOnVectorTrainingFailure: true,
  });
  const total = summary.executed + summary.skipped + summary.failed;
  console.log(
    `  GSI: created ${summary.executed}, skipped ${summary.skipped}, failed ${summary.failed} (${total} statements)`,
  );
  if (summary.executed > 0) {
    console.log(
      '  Note: voAgent_vector_outcomes_embedding may stay non-Ready until voyageops.agent.outcomes has documents with embedding.',
    );
  }

  console.log('\n--- Search hybrid indexes (FTS + vector, guest recovery worker) ---');
  let searchSummary = { created: 0, updated: 0, skipped: 0 };
  try {
    searchSummary = await deploySearchIndexesFromManifest({ dryRun });
  } catch (error) {
    console.warn(`  Search deploy failed (GSI playbook index still usable via worker fallback): ${error}`);
    searchSummary.skipped = 1;
  }
  console.log(
    `  Search: created ${searchSummary.created}, updated ${searchSummary.updated}, skipped ${searchSummary.skipped}`,
  );

  console.log('\nVector index setup complete.');
  console.log(RECOMMENDED_ENV);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
