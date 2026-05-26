import fs from 'node:fs';
import { resolveFromRepo } from './repo-root.ts';
import { isCapellaCluster, normalizeEventingHost, resolveClusterHost } from './eventing-deploy.ts';

export const SEARCH_INDEX_MANUAL_JSON = 'database/search-indexes/voAgent_vector_playbooks_embedding.json';
export const SEARCH_INDEX_CAPELLA_IMPORT_JSON =
  'database/search-indexes/voAgent_capella_import.json';

export type SearchIndexManifestEntry = {
  name: string;
  scope: string;
  collection: string;
  definitionFile: string;
  envVar?: string;
};

export type SearchIndexManifest = {
  bucket: string;
  deployOrder: string[];
  indexes: SearchIndexManifestEntry[];
};

export function loadSearchIndexManifest(
  manifestPath = resolveFromRepo('database/search-indexes.manifest.json'),
): SearchIndexManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SearchIndexManifest;
}

export function getSearchBaseUrl(): string {
  const endpoint = process.env.COUCHBASE_ENDPOINT || '';
  const host =
    normalizeEventingHost(process.env.COUCHBASE_SEARCH_HOST || '')
    || resolveClusterHost();
  if (!host) {
    throw new Error('Set COUCHBASE_SEARCH_HOST or COUCHBASE_ENDPOINT for Search index deploy.');
  }
  const port = process.env.COUCHBASE_SEARCH_PORT?.trim() || '8094';
  const useTls =
    process.env.COUCHBASE_SEARCH_USE_TLS === 'true'
    || /^couchbases:\/\//i.test(endpoint);
  const scheme = useTls ? 'https' : 'http';
  return `${scheme}://${host}:${port}`;
}

function getAuthHeader(): string {
  const user = process.env.COUCHBASE_USER || process.env.COUCHBASE_CLI_USERNAME;
  const password = process.env.COUCHBASE_PASSWORD || process.env.COUCHBASE_CLI_PASSWORD;
  if (!user || !password) {
    throw new Error('COUCHBASE_USER and COUCHBASE_PASSWORD (or COUCHBASE_CLI_*) are required for Search index deploy.');
  }
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function searchFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getSearchBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: getAuthHeader(),
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(url, { ...init, headers });
}

export function capellaSearchLaptopMessage(): string {
  return [
    'Capella does not expose the Search admin API (port 8094) to laptops.',
    `Import in Capella UI → Search → Import index: ${SEARCH_INDEX_CAPELLA_IMPORT_JSON}`,
    `(localhost REST deploy uses ${SEARCH_INDEX_MANUAL_JSON})`,
    'Set CB_PLAYBOOK_VECTOR_INDEX to the short name; worker resolves scoped names like voyageops.agent.<name>.',
    'Or rely on the GSI playbook vector index (worker SQL++ fallback when no Search index).',
  ].join('\n');
}

export function shouldSkipLaptopSearchDeploy(): boolean {
  return isCapellaCluster() && process.env.COUCHBASE_SEARCH_FORCE !== 'true';
}

function scopedIndexPath(bucket: string, scope: string, indexName: string): string {
  return `/api/bucket/${encodeURIComponent(bucket)}/scope/${encodeURIComponent(scope)}/index/${encodeURIComponent(indexName)}`;
}

export async function deploySearchIndex(
  entry: SearchIndexManifestEntry,
  bucket: string,
  options: { dryRun?: boolean } = {},
): Promise<'created' | 'updated' | 'skipped'> {
  const definitionPath = resolveFromRepo(entry.definitionFile);
  const definition = JSON.parse(fs.readFileSync(definitionPath, 'utf8')) as Record<string, unknown>;
  const indexName = String(definition.name ?? entry.name);

  if (options.dryRun) {
    console.log(`[dry-run] Would deploy Search index ${indexName} on ${bucket}.${entry.scope}.${entry.collection}`);
    return 'skipped';
  }

  const path = scopedIndexPath(bucket, entry.scope, indexName);
  const existing = await searchFetch(path, { method: 'GET' });
  const exists = existing.ok;

  const response = await searchFetch(path, {
    method: 'PUT',
    body: JSON.stringify(definition),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Search index ${indexName} deploy failed (${response.status}): ${body}`);
  }

  console.log(`  ${exists ? 'Updated' : 'Created'} Search index: ${indexName} (${bucket}.${entry.scope}.${entry.collection})`);
  if (entry.envVar) {
    console.log(`    Set ${entry.envVar}=${indexName} in .env for the guest recovery worker.`);
  }
  return exists ? 'updated' : 'created';
}

export async function deploySearchIndexesFromManifest(
  options: { dryRun?: boolean } = {},
): Promise<{ created: number; updated: number; skipped: number }> {
  const manifest = loadSearchIndexManifest();
  const bucket = process.env.COUCHBASE_BUCKET?.trim() || manifest.bucket;
  const byName = new Map(manifest.indexes.map((idx) => [idx.name, idx]));
  const summary = { created: 0, updated: 0, skipped: 0 };

  if (shouldSkipLaptopSearchDeploy()) {
    console.log(`  ${capellaSearchLaptopMessage()}\n`);
    summary.skipped = manifest.deployOrder.length;
    return summary;
  }

  console.log(`  Search REST base URL: ${getSearchBaseUrl()}`);
  console.log('  Requires cluster admin (or Search manage) credentials.\n');

  for (const name of manifest.deployOrder) {
    const entry = byName.get(name);
    if (!entry) {
      throw new Error(`Search index ${name} missing from search-indexes.manifest.json`);
    }
    console.log(`Search index: ${entry.name}`);
    const result = await deploySearchIndex(entry, bucket, options);
    if (result === 'created') summary.created += 1;
    else if (result === 'updated') summary.updated += 1;
    else summary.skipped += 1;
  }

  return summary;
}
