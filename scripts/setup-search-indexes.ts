#!/usr/bin/env npx tsx
/**
 * Deploy Couchbase Search (FTS) hybrid vector indexes for Guest Recovery.
 * Run AFTER seed-agent-data.ts (playbooks need embedding vectors in documents).
 *
 * GSI vector indexes (Query service) are created by setup-vector-indexes.ts.
 * The Python worker uses these Search indexes via cluster.search().
 */
import 'dotenv/config';
import { initCouchbase, db } from '../src/lib/couchbase.ts';
import { deploySearchIndexesFromManifest } from './lib/search-index-deploy.ts';

async function warnIfPlaybooksEmpty(force: boolean) {
  if (force) return;
  await initCouchbase();
  try {
    const result = await db.cluster.query(
      'SELECT COUNT(1) AS c FROM voyageops.agent.playbooks LIMIT 1',
      { timeout: 30_000 },
    );
    const count = Number((result.rows as { c?: number }[])?.[0]?.c ?? 0);
    if (count === 0) {
      console.warn('  Warning: voyageops.agent.playbooks is empty. Run seed-agent-data.ts first, or pass --force.');
    }
  } catch {
    console.warn('  Warning: could not count playbooks.');
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

  console.log('VoyageOps Search index setup (hybrid FTS + vector for worker)');
  if (!dryRun) {
    await warnIfPlaybooksEmpty(force);
  }

  const summary = await deploySearchIndexesFromManifest({ dryRun });
  console.log('\nSearch index setup complete.');
  console.log(
    `  Created: ${summary.created}, updated: ${summary.updated}, skipped (dry-run): ${summary.skipped}`,
  );
  console.log('  Wait for index status Ready in Capella Search UI before running npm run demo:worker.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
