#!/usr/bin/env npx tsx
/**
 * Deploy VoyageOps Guest Recovery Eventing functions (REST default, or couchbase-cli).
 */
import 'dotenv/config';
import {
  assertLaptopEventingDeploySupported,
  deployFunctionViaCli,
  deployFunctionViaRest,
  getEventingBaseUrl,
  isCapellaCluster,
  loadEventingManifest,
} from './lib/eventing-deploy.ts';

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const driver = argv.find((arg) => arg.startsWith('--driver='))?.split('=')[1] ?? 'rest';
  const only = argv.find((arg) => arg.startsWith('--function='))?.split('=')[1];
  return { dryRun, driver: driver === 'cli' ? 'cli' as const : 'rest' as const, only };
}

async function main() {
  const { dryRun, driver, only } = parseArgs(process.argv.slice(2));
  const manifest = loadEventingManifest();
  const ordered = manifest.deployOrder
    .map((name) => manifest.functions.find((fn) => fn.name === name))
    .filter((fn): fn is NonNullable<typeof fn> => Boolean(fn));

  const toDeploy = only ? ordered.filter((fn) => fn.name === only) : ordered;
  if (toDeploy.length === 0) {
    throw new Error(only ? `No function named ${only} in eventing.manifest.json` : 'No functions in manifest');
  }

  console.log(`VoyageOps Eventing setup (driver=${driver})`);
  if (!dryRun) assertLaptopEventingDeploySupported();
  if (isCapellaCluster() && process.env.COUCHBASE_EVENTING_FORCE === 'true') {
    console.warn('  COUCHBASE_EVENTING_FORCE=true — attempting laptop deploy against Capella (may time out).');
  }
  if (driver === 'rest') {
    console.log(`  Eventing REST base URL: ${getEventingBaseUrl()}`);
    if (process.env.COUCHBASE_EVENTING_HOST?.includes('://')) {
      console.warn(
        '  Warning: COUCHBASE_EVENTING_HOST should be hostname only (no https://). Use the Capella cluster host or leave unset to derive from COUCHBASE_ENDPOINT.',
      );
    }
  }
  console.log('  Requires cluster admin (or Eventing manage) credentials.\n');

  for (const fn of toDeploy) {
    console.log(`Function: ${fn.name}`);
    if (driver === 'cli') {
      await deployFunctionViaCli(fn, { dryRun });
    } else {
      await deployFunctionViaRest(fn, { dryRun });
    }
  }

  console.log('\nEventing setup complete.');
  console.log('Validate: SELECT status, COUNT(1) AS count FROM voyageops.agent.agent_runs GROUP BY status;');
  console.log('If REST deploy fails from a laptop, use --driver=cli or deploy via Capella UI (see docs/README.manual-setup.md).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
