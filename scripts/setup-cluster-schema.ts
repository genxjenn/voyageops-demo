#!/usr/bin/env npx tsx
/**
 * Base Couchbase schema for VoyageOps demo (scopes, collections, primary indexes).
 * Does NOT create vector indexes — run setup-vector-indexes.ts after seed data.
 */
import { resolveFromRepo } from './lib/repo-root.ts';
import { runSqlFiles } from './lib/run-sql-file.ts';

const SCHEMA_FILES = [
  'database/core.scope.sql',
  'database/agent.scope.sql',
  'database/prepForEventing.sql',
];

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const fileArg = argv.find((arg) => arg.startsWith('--file='));
  const singleFile = fileArg ? fileArg.slice('--file='.length) : undefined;
  return { dryRun, singleFile };
}

async function main() {
  const { dryRun, singleFile } = parseArgs(process.argv.slice(2));
  const files = singleFile ? [singleFile] : SCHEMA_FILES.map((f) => resolveFromRepo(f));

  console.log('VoyageOps cluster schema setup (no vector indexes)');
  const results = await runSqlFiles(files, { dryRun });

  const totals = results.reduce(
    (acc, row) => ({
      executed: acc.executed + row.executed,
      skipped: acc.skipped + row.skipped,
      failed: acc.failed + row.failed,
    }),
    { executed: 0, skipped: 0, failed: 0 },
  );

  const total = totals.executed + totals.skipped + totals.failed;
  console.log('\nSchema setup complete.');
  console.log(
    `  Created: ${totals.executed}, skipped (already exists): ${totals.skipped}, failed: ${totals.failed} (${total} statements)`,
  );
  console.log('Next: npm run demo:setup-eventing, then seed data, then npm run demo:setup-vector-indexes');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
