import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveFromRepo } from './repo-root.ts';

export type EventingBinding = {
  alias: string;
  bucket: string;
  scope: string;
  collection: string;
  access: 'r' | 'rw';
};

export type EventingFunctionManifest = {
  name: string;
  handlerFile: string;
  source: { bucket: string; scope: string; collection: string };
  metadata: { bucket: string; scope: string; collection: string };
  bindings: EventingBinding[];
};

export type EventingManifest = {
  bucket: string;
  deployOrder: string[];
  functions: EventingFunctionManifest[];
};

export function loadEventingManifest(manifestPath = resolveFromRepo('database/eventing.manifest.json')): EventingManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as EventingManifest;
}

export function buildFunctionDefinition(fn: EventingFunctionManifest, appcode: string) {
  return {
    appname: fn.name,
    appcode,
    version: 'evt-7.2.0-0000-ce',
    depcfg: {
      metadata_bucket: fn.metadata.bucket,
      metadata_scope: fn.metadata.scope,
      metadata_collection: fn.metadata.collection,
      source_bucket: fn.source.bucket,
      source_scope: fn.source.scope,
      source_collection: fn.source.collection,
      buckets: fn.bindings.map((binding) => ({
        alias: binding.alias,
        bucket_name: binding.bucket,
        scope_name: binding.scope,
        collection_name: binding.collection,
        access: binding.access,
      })),
    },
    settings: {
      deployment_status: false,
      processing_status: false,
      dcp_stream_boundary: 'from_now',
      language_compatibility: '7.2.0',
      description: `VoyageOps demo — ${fn.name}`,
    },
  };
}

/** Strip scheme/port/path so host is a bare hostname (avoids `http://https://...` URLs). */
export function normalizeEventingHost(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withoutScheme = trimmed.replace(/^couchbases?:\/\//i, '').replace(/^https?:\/\//i, '');
  return withoutScheme.split(',')[0].split('/')[0].split(':')[0].split('?')[0];
}

const CAPELLA_HOST_PATTERN = /\.cloud\.couchbase\.com$/i;

export const CAPELLA_EVENTING_MANUAL_DOC = 'docs/README.manual-setup.md';

/** Host from COUCHBASE_EVENTING_HOST or COUCHBASE_ENDPOINT (no port). */
export function resolveClusterHost(): string {
  const endpoint = process.env.COUCHBASE_ENDPOINT || '';
  return (
    normalizeEventingHost(process.env.COUCHBASE_EVENTING_HOST || '')
    || normalizeEventingHost(endpoint)
  );
}

/** True when endpoint targets Couchbase Capella (DBaaS). */
export function isCapellaCluster(): boolean {
  return CAPELLA_HOST_PATTERN.test(resolveClusterHost());
}

export function capellaEventingLaptopMessage(): string {
  return [
    'Capella does not expose the Eventing admin API (port 8096) to laptops.',
    `Deploy functions in the Capella UI — see ${CAPELLA_EVENTING_MANUAL_DOC} (section 5).`,
    'Then continue setup: npm run demo:setup-cluster -- --seed-only',
  ].join('\n');
}

/** Block laptop REST/CLI Eventing deploy against Capella unless COUCHBASE_EVENTING_FORCE=true. */
export function assertLaptopEventingDeploySupported(): void {
  if (!isCapellaCluster() || process.env.COUCHBASE_EVENTING_FORCE === 'true') return;
  throw new Error(capellaEventingLaptopMessage());
}

export function getEventingBaseUrl(): string {
  const endpoint = process.env.COUCHBASE_ENDPOINT || '';
  const host =
    normalizeEventingHost(process.env.COUCHBASE_EVENTING_HOST || '')
    || normalizeEventingHost(endpoint);
  if (!host) {
    throw new Error('Set COUCHBASE_EVENTING_HOST or COUCHBASE_ENDPOINT for Eventing REST deploy.');
  }
  const port = process.env.COUCHBASE_EVENTING_PORT?.trim() || '8096';
  const useTls =
    process.env.COUCHBASE_EVENTING_USE_TLS === 'true'
    || /^couchbases:\/\//i.test(endpoint);
  const scheme = useTls ? 'https' : 'http';
  return `${scheme}://${host}:${port}`;
}

function parseHostFromEndpoint(endpoint: string): string {
  return normalizeEventingHost(endpoint);
}

function getAuthHeader(): string {
  const user = process.env.COUCHBASE_USER || process.env.COUCHBASE_CLI_USERNAME;
  const password = process.env.COUCHBASE_PASSWORD || process.env.COUCHBASE_CLI_PASSWORD;
  if (!user || !password) {
    throw new Error('COUCHBASE_USER and COUCHBASE_PASSWORD (or COUCHBASE_CLI_*) are required for Eventing deploy.');
  }
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function eventingFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getEventingBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: getAuthHeader(),
    ...(init.headers as Record<string, string> | undefined),
  };

  return fetch(url, { ...init, headers });
}

export async function deployFunctionViaRest(fn: EventingFunctionManifest, options: { dryRun?: boolean } = {}) {
  const appcode = fs.readFileSync(resolveFromRepo(fn.handlerFile), 'utf8');
  const definition = buildFunctionDefinition(fn, appcode);

  if (options.dryRun) {
    console.log(`[dry-run] Would deploy Eventing function ${fn.name} via REST`);
    return;
  }

  const createRes = await eventingFetch(`/api/v1/functions/${encodeURIComponent(fn.name)}`, {
    method: 'POST',
    body: JSON.stringify(definition),
  });

  if (!createRes.ok && createRes.status !== 409) {
    const body = await createRes.text();
    if (createRes.status === 400 && /exist/i.test(body)) {
      await updateExistingFunction(fn, appcode);
    } else {
      throw new Error(`Eventing create ${fn.name} failed (${createRes.status}): ${body}`);
    }
  } else if (createRes.ok) {
    console.log(`  Created function definition: ${fn.name}`);
  } else {
    await updateExistingFunction(fn, appcode);
  }

  const deployRes = await eventingFetch(`/api/v1/functions/${encodeURIComponent(fn.name)}/deploy`, {
    method: 'POST',
  });
  if (!deployRes.ok) {
    const settingsRes = await eventingFetch(`/api/v1/functions/${encodeURIComponent(fn.name)}/settings`, {
      method: 'POST',
      body: JSON.stringify({ deployment_status: true, processing_status: true }),
    });
    if (!settingsRes.ok) {
      const body = await deployRes.text();
      const settingsBody = await settingsRes.text();
      throw new Error(
        `Eventing deploy ${fn.name} failed. deploy: ${body}; settings: ${settingsBody}`,
      );
    }
  }

  console.log(`  Deployed and resumed: ${fn.name}`);
}

async function updateExistingFunction(fn: EventingFunctionManifest, appcode: string) {
  const appcodeRes = await eventingFetch(`/api/v1/functions/${encodeURIComponent(fn.name)}/appcode`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: appcode,
  });
  if (!appcodeRes.ok) {
    const text = await appcodeRes.text();
    throw new Error(`Eventing appcode update ${fn.name} failed: ${text}`);
  }

  const definition = buildFunctionDefinition(fn, appcode);
  const configRes = await eventingFetch(`/api/v1/functions/${encodeURIComponent(fn.name)}`, {
    method: 'POST',
    body: JSON.stringify(definition),
  });
  if (!configRes.ok) {
    const text = await configRes.text();
    console.warn(`  Warning: full definition refresh for ${fn.name}: ${text}`);
  } else {
    console.log(`  Updated function definition: ${fn.name}`);
  }
}

export async function deployFunctionViaCli(
  fn: EventingFunctionManifest,
  options: { dryRun?: boolean } = {},
) {
  const appcode = fs.readFileSync(resolveFromRepo(fn.handlerFile), 'utf8');
  const definition = buildFunctionDefinition(fn, appcode);
  const generatedDir = resolveFromRepo('database/generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  const outPath = path.join(generatedDir, `${fn.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(definition, null, 2));

  const cluster = process.env.COUCHBASE_CLI_CLUSTER
    || process.env.COUCHBASE_ENDPOINT?.replace(/^couchbases:\/\//i, 'couchbase://').replace(/^couchbase:\/\//i, 'couchbase://')
    || `couchbase://${parseHostFromEndpoint(process.env.COUCHBASE_ENDPOINT || '127.0.0.1')}`;
  const user = process.env.COUCHBASE_CLI_USERNAME || process.env.COUCHBASE_USER || '';
  const password = process.env.COUCHBASE_CLI_PASSWORD || process.env.COUCHBASE_PASSWORD || '';

  const args = [
    'eventing-function',
    '--cluster',
    cluster,
    '--username',
    user,
    '--password',
    password,
    'deploy',
    '--name',
    fn.name,
    '--file',
    outPath,
  ];

  if (options.dryRun) {
    console.log(`[dry-run] couchbase-cli ${args.join(' ')}`);
    return;
  }

  await runCommand('couchbase-cli', args);
  console.log(`  Deployed via CLI: ${fn.name} (${outPath})`);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
