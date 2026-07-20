#!/usr/bin/env npx tsx
/**
 * Couchbase Agent Catalog (agentc) setup — initializes, indexes, and publishes the
 * guest_recovery prompt/tool catalog. Requires `agentc` installed in .venv (see
 * backend/python/guest_recovery/requirements.txt) and a clean git working tree
 * (agentc index refuses to run otherwise).
 *
 * https://docs.couchbase.com/ai/build/integrate-agent-with-catalog.html
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { resolveFromRepo } from './lib/repo-root.ts';

const VENV_PYTHON = resolveFromRepo('.venv/bin/python');
const VENV_AGENTC = resolveFromRepo('.venv/bin/agentc');
const GUEST_RECOVERY_DIR = resolveFromRepo('backend/python/guest_recovery');

function resolveRootCertificate(): string {
  if (process.env.AGENT_CATALOG_CONN_ROOT_CERTIFICATE) {
    return process.env.AGENT_CATALOG_CONN_ROOT_CERTIFICATE;
  }
  // Capella certs are signed by a public CA, so the certifi bundle validates without a manual download.
  return execFileSync(VENV_PYTHON, ['-c', 'import certifi; print(certifi.where())']).toString().trim();
}

function runAgentc(args: string[]) {
  console.log(`\n$ agentc ${args.join(' ')}`);
  execFileSync(VENV_AGENTC, args, {
    cwd: resolveFromRepo('.'),
    stdio: 'inherit',
    env: {
      ...process.env,
      AGENT_CATALOG_CONN_ROOT_CERTIFICATE: resolveRootCertificate(),
    },
  });
}

function main() {
  const bucket = process.env.AGENT_CATALOG_BUCKET || 'voyageops';

  runAgentc(['init', '--bucket', bucket]);
  runAgentc(['index', GUEST_RECOVERY_DIR]);
  runAgentc(['publish', '--bucket', bucket]);

  console.log('\nAgent Catalog setup complete.');
}

main();
