#!/usr/bin/env npx tsx
/**
 * Orchestrate VoyageOps Couchbase demo cluster setup from a laptop.
 * Order: schema → eventing → seed data → vector indexes (after embeddings exist).
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import {
  CAPELLA_EVENTING_MANUAL_DOC,
  capellaEventingLaptopMessage,
  isCapellaCluster,
} from './lib/eventing-deploy.ts';
import { resolveFromRepo } from './lib/repo-root.ts';

const SEED_SCRIPTS = [
  'scripts/load-guests-backup.ts',
  'scripts/load-bookings-backup.ts',
  'scripts/seed-action-catalog.ts',
  'scripts/seed-agent-data.ts',
  'scripts/seed-intelligence-data.ts',
  'scripts/seed-excursions-data.ts',
  'scripts/demo-reset-incidents.ts',
];

function parseArgs(argv: string[]) {
  const flags = new Set(argv);
  const driver = argv.find((arg) => arg.startsWith('--driver='))?.split('=')[1] ?? 'rest';
  const anyPhase =
    flags.has('--schema-only')
    || flags.has('--eventing-only')
    || flags.has('--seed-only')
    || flags.has('--vector-indexes-only');

  return {
    dryRun: flags.has('--dry-run'),
    schemaOnly: flags.has('--schema-only'),
    eventingOnly: flags.has('--eventing-only'),
    seedOnly: flags.has('--seed-only'),
    vectorOnly: flags.has('--vector-indexes-only'),
    skipSeed: flags.has('--skip-seed'),
    skipEventing: flags.has('--skip-eventing'),
    requireEventing: flags.has('--require-eventing'),
    fullRun: !anyPhase,
    eventingDriver: driver === 'cli' ? 'cli' : 'rest',
  };
}

function shouldSkipEventingPhase(opts: {
  skipEventing: boolean;
  requireEventing: boolean;
  eventingOnly: boolean;
}): boolean {
  if (opts.skipEventing) return true;
  if (opts.requireEventing) return false;
  // Full pipeline on Capella: skip laptop Eventing; use --eventing-only to run setup-eventing (fails fast).
  if (isCapellaCluster() && !opts.eventingOnly) return true;
  return false;
}

function logSkippedEventingPhase(reason: 'flag' | 'capella') {
  console.log('\n=== Phase 2: Eventing functions (skipped) ===');
  if (reason === 'flag') {
    console.log('  --skip-eventing set; deploy functions manually if needed.');
  } else {
    console.log(`  ${capellaEventingLaptopMessage()}`);
  }
  console.log(`  Manual steps: ${CAPELLA_EVENTING_MANUAL_DOC}`);
}

function runNpxScript(scriptPath: string, extraArgs: string[] = []): Promise<void> {
  const absolute = resolveFromRepo(scriptPath);
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', absolute, ...extraArgs], {
      cwd: resolveFromRepo('.'),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function phaseSchema(dryRun: boolean) {
  console.log('\n=== Phase 1: Schema (scopes, collections, primary indexes) ===');
  await runNpxScript('scripts/setup-cluster-schema.ts', dryRun ? ['--dry-run'] : []);
}

async function phaseEventing(dryRun: boolean, driver: string) {
  console.log('\n=== Phase 2: Eventing functions ===');
  const args = dryRun ? ['--dry-run'] : [];
  if (driver === 'cli') args.push('--driver=cli');
  await runNpxScript('scripts/setup-eventing.ts', args);
}

const SEED_SCRIPT_ARGS: Record<string, string[]> = {
  'scripts/demo-reset-incidents.ts': ['--seed-if-empty'],
};

async function phaseSeed() {
  console.log('\n=== Phase 3: Seed data (existing scripts) ===');
  for (const script of SEED_SCRIPTS) {
    console.log(`\n--- ${script} ---`);
    await runNpxScript(script, SEED_SCRIPT_ARGS[script] ?? []);
  }
}

async function phaseVectorIndexes(dryRun: boolean) {
  console.log('\n=== Phase 4: Vector indexes (after seed) ===');
  await runNpxScript('scripts/setup-vector-indexes.ts', dryRun ? ['--dry-run'] : []);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('VoyageOps cluster setup orchestrator');
  if (opts.dryRun) {
    console.log('(dry-run where supported — seed phase still lists scripts only if --seed-only with dry-run, skipped)');
  }

  const runSchema = opts.fullRun || opts.schemaOnly;
  const runEventing = opts.fullRun || opts.eventingOnly;
  const runSeed = (opts.fullRun && !opts.skipSeed) || opts.seedOnly;
  const runVector = (opts.fullRun && !opts.skipSeed) || opts.vectorOnly;

  if (opts.dryRun && runSeed) {
    console.log('\nSeed scripts (not executed in --dry-run):');
    SEED_SCRIPTS.forEach((s) => console.log(`  npx tsx ${s}`));
  }

  if (runSchema) await phaseSchema(opts.dryRun);
  if (runEventing) {
    const skip = shouldSkipEventingPhase(opts);
    if (skip) {
      logSkippedEventingPhase(opts.skipEventing ? 'flag' : 'capella');
    } else {
      await phaseEventing(opts.dryRun, opts.eventingDriver);
    }
  }
  if (runSeed && !opts.dryRun) await phaseSeed();
  if (runVector) await phaseVectorIndexes(opts.dryRun);

  console.log('\nCluster setup finished.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
