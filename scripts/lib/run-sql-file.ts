import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Cluster } from 'couchbase';
import { initCouchbase, db } from '../../src/lib/couchbase.ts';

export type SqlRunSummary = {
  file: string;
  executed: number;
  skipped: number;
  failed: number;
};

const IDEMPOTENT_PATTERNS = [
  /already exists/i,
  /duplicate/i,
  /index.*already/i,
  /EEXIST/i,
  /12009/i,
  /12025/i,
  /collection already exists/i,
  /scope already exists/i,
  /Scope with name.*already exists/i,
];

export type ParsedDdl =
  | { kind: 'scope'; bucket: string; scope: string }
  | { kind: 'collection'; bucket: string; scope: string; collection: string }
  | {
    kind: 'index';
    bucket: string;
    scope: string;
    collection: string;
    indexName: string;
    isVector: boolean;
    /** VECTOR index field, e.g. embedding or vector_category_incidents */
    vectorField?: string;
  };

export const OUTCOMES_VECTOR_INDEX_NAME = 'voAgent_vector_outcomes_embedding';

/** Couchbase SDK often surfaces nested first_error_message (e.g. scope already exists). */
export function extractQueryErrorMessage(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current != null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      if (current.message) parts.push(current.message);
      const withContext = current as Error & {
        cause?: unknown;
        context?: { http_response_body?: string };
      };
      if (withContext.context?.http_response_body) {
        parts.push(withContext.context.http_response_body);
      }
      const cause = withContext.cause;
      if (cause && typeof cause === 'object') {
        const c = cause as Record<string, unknown>;
        if (typeof c.first_error_message === 'string') parts.push(c.first_error_message);
        if (typeof c.message === 'string') parts.push(String(c.message));
      }
      current = cause;
    } else if (typeof current === 'object') {
      const c = current as Record<string, unknown>;
      if (typeof c.first_error_message === 'string') parts.push(c.first_error_message);
      if (typeof c.message === 'string') parts.push(String(c.message));
      current = c.cause;
    } else {
      break;
    }
  }

  return parts.join(' ');
}

/** Parse CREATE DDL from demo SQL files (scopes, collections, indexes). */
export function parseCreateDdlStatement(stmt: string): ParsedDdl | null {
  const norm = stmt.replace(/\s+/g, ' ').trim();

  let m = norm.match(/^CREATE SCOPE (\w+)\.(\w+)(?: IF NOT EXISTS)?$/i);
  if (m) return { kind: 'scope', bucket: m[1], scope: m[2] };

  m = norm.match(/^CREATE COLLECTION (\w+)\.(\w+)\.(\w+)(?: IF NOT EXISTS)?$/i);
  if (m) return { kind: 'collection', bucket: m[1], scope: m[2], collection: m[3] };

  m = norm.match(
    /^CREATE VECTOR INDEX (\w+) IF NOT EXISTS ON (\w+)\.(\w+)\.(\w+)\((\w+) VECTOR\)/i,
  );
  if (m) {
    return {
      kind: 'index',
      bucket: m[2],
      scope: m[3],
      collection: m[4],
      indexName: m[1],
      isVector: true,
      vectorField: m[5],
    };
  }

  m = norm.match(
    /^CREATE (VECTOR )?INDEX (\w+) IF NOT EXISTS ON (\w+)\.(\w+)\.(\w+)/i,
  );
  if (m) {
    return {
      kind: 'index',
      bucket: m[3],
      scope: m[4],
      collection: m[5],
      indexName: m[2],
      isVector: Boolean(m[1]),
    };
  }

  m = norm.match(/^CREATE PRIMARY INDEX (\w+) IF NOT EXISTS ON (\w+)\.(\w+)\.(\w+)/i);
  if (m) {
    return {
      kind: 'index',
      bucket: m[2],
      scope: m[3],
      collection: m[4],
      indexName: m[1],
      isVector: false,
    };
  }

  m = norm.match(/^CREATE INDEX (\w+) IF NOT EXISTS ON (\w+)\.(\w+)\.(\w+)/i);
  if (m) {
    return {
      kind: 'index',
      bucket: m[2],
      scope: m[3],
      collection: m[4],
      indexName: m[1],
      isVector: false,
    };
  }

  return null;
}

function normalizeKeyspaceId(keyspaceId: string): string {
  return keyspaceId.replace(/^default:/i, '').trim();
}

function ddlKey(parsed: ParsedDdl): string {
  switch (parsed.kind) {
    case 'scope':
      return `scope:${parsed.bucket}.${parsed.scope}`;
    case 'collection':
      return `collection:${parsed.bucket}.${parsed.scope}.${parsed.collection}`;
    case 'index':
      return `index:${parsed.indexName}|${parsed.bucket}.${parsed.scope}.${parsed.collection}`;
  }
}

function inferBucketFromStatements(statements: string[]): string {
  for (const stmt of statements) {
    const parsed = parseCreateDdlStatement(stmt);
    if (parsed) return parsed.bucket;
  }
  const fromEnv = process.env.COUCHBASE_BUCKET?.trim();
  if (fromEnv && /^[\w-]+$/.test(fromEnv)) return fromEnv;
  return 'voyageops';
}

function pickIndexNameFromRow(row: Record<string, unknown>): string | undefined {
  for (const key of ['name', 'index_name', 'indexName']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

type IndexParsed = Extract<ParsedDdl, { kind: 'index' }>;

function indexKeyspaceId(parsed: IndexParsed): string {
  return `${parsed.bucket}.${parsed.scope}.${parsed.collection}`;
}

/** Probe planner when system:indexes is empty or unavailable for this role. */
async function probeIndexExists(
  cluster: Cluster,
  parsed: IndexParsed,
  timeoutMs: number,
): Promise<boolean> {
  const q =
    `EXPLAIN SELECT META().id FROM \`${parsed.bucket}\`.\`${parsed.scope}\`.\`${parsed.collection}\``
    + ` USE INDEX (\`${parsed.indexName}\`) USING GSI LIMIT 1`;
  try {
    await cluster.query(q, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

class ClusterCatalog {
  private readonly scopes = new Set<string>();
  private readonly collections = new Set<string>();
  /** `indexName|bucket.scope.collection` from system:indexes */
  private readonly indexKeys = new Set<string>();

  static async load(cluster: Cluster, bucket: string, timeoutMs: number): Promise<ClusterCatalog> {
    const cat = new ClusterCatalog();
    const safeBucket = bucket.replace(/[^\w-]/g, '');

    try {
      const keyspaces = await cluster.query('SELECT * FROM system:keyspaces', { timeout: timeoutMs });
      for (const row of keyspaces.rows as Record<string, unknown>[]) {
        cat.ingestKeyspaceRow(row, safeBucket);
      }
    } catch {
      // keyspace catalog optional; index probe still works
    }

    const indexQueries = [
      'SELECT `name`, `keyspace_id` FROM system:indexes',
      'SELECT RAW name FROM system:indexes WHERE name IS NOT MISSING',
      'SELECT * FROM system:indexes',
    ];
    for (const q of indexQueries) {
      try {
        const indexes = await cluster.query(q, { timeout: timeoutMs });
        for (const row of indexes.rows as unknown[]) {
          if (typeof row === 'string') {
            continue;
          }
          if (row && typeof row === 'object') {
            const record = row as Record<string, unknown>;
            const name = pickIndexNameFromRow(record);
            const keyspaceId = normalizeKeyspaceId(String(record.keyspace_id ?? ''));
            if (name && keyspaceId) cat.indexKeys.add(`${name}|${keyspaceId}`);
          }
        }
        if (cat.indexKeys.size > 0) break;
      } catch {
        // try next query shape
      }
    }

    return cat;
  }

  private ingestKeyspaceRow(row: Record<string, unknown>, targetBucket: string): void {
    let bucket = String(row.bucket ?? '').trim();
    let scope = String(row.scope ?? '').trim();
    const name = row.name != null ? String(row.name).trim() : '';

    if (!bucket && row.id) {
      const id = normalizeKeyspaceId(String(row.id));
      const parts = id.split(/[.:]/).filter(Boolean);
      if (parts.length >= 2) {
        bucket = parts[0];
        scope = parts[1];
      }
    }

    if (bucket !== targetBucket || !scope) return;
    this.scopes.add(`${bucket}.${scope}`);
    if (name) {
      this.collections.add(`${bucket}.${scope}.${name}`);
    }
  }

  async exists(cluster: Cluster, parsed: ParsedDdl, timeoutMs: number): Promise<boolean> {
    switch (parsed.kind) {
      case 'scope':
        return this.scopes.has(`${parsed.bucket}.${parsed.scope}`);
      case 'collection':
        return this.collections.has(`${parsed.bucket}.${parsed.scope}.${parsed.collection}`);
      case 'index':
        if (this.indexKeys.has(`${parsed.indexName}|${indexKeyspaceId(parsed)}`)) return true;
        return probeIndexExists(cluster, parsed, timeoutMs);
    }
  }

  record(parsed: ParsedDdl): void {
    switch (parsed.kind) {
      case 'scope':
        this.scopes.add(`${parsed.bucket}.${parsed.scope}`);
        break;
      case 'collection':
        this.collections.add(`${parsed.bucket}.${parsed.scope}.${parsed.collection}`);
        this.scopes.add(`${parsed.bucket}.${parsed.scope}`);
        break;
      case 'index':
        this.indexKeys.add(`${parsed.indexName}|${indexKeyspaceId(parsed)}`);
        break;
    }
  }

  indexCount(): number {
    return this.indexKeys.size;
  }
}

export function parseSqlStatements(sqlText: string): string[] {
  const withoutBlockComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = withoutBlockComments.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('--');
  });

  const joined = lines.join('\n');
  return joined
    .split(';')
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

function isIdempotentError(message: string): boolean {
  return IDEMPOTENT_PATTERNS.some((pattern) => pattern.test(message));
}

function isVectorTrainingDataError(message: string): boolean {
  return /ErrTraining|centroids required to train|not enough/i.test(message);
}

/** Count docs with the indexed vector field populated. */
export async function countVectorFieldDocs(
  cluster: Cluster,
  bucket: string,
  scope: string,
  collection: string,
  field: string,
  timeoutMs: number,
): Promise<number> {
  const q =
    `SELECT COUNT(1) AS c FROM \`${bucket}\`.\`${scope}\`.\`${collection}\``
    + ` WHERE \`${field}\` IS NOT MISSING`;
  const result = await cluster.query(q, { timeout: timeoutMs });
  return Number((result.rows as { c?: number }[])?.[0]?.c ?? 0);
}

function isOutcomesVectorIndex(parsed: ParsedDdl): boolean {
  return parsed.kind === 'index'
    && parsed.indexName === OUTCOMES_VECTOR_INDEX_NAME;
}

export async function runSqlFile(
  filePath: string,
  options: {
    dryRun?: boolean;
    queryTimeoutMs?: number;
    /** Skip CREATE VECTOR INDEX when keyspace has no embedding vectors (IVF training needs data). */
    skipVectorIndexIfNoEmbeddings?: boolean;
    /** Log vector training failures as SKIP and continue (e.g. empty outcomes collection). */
    continueOnVectorTrainingFailure?: boolean;
  } = {},
): Promise<SqlRunSummary> {
  const absolutePath = path.resolve(filePath);
  const sqlText = fs.readFileSync(absolutePath, 'utf8');
  const statements = parseSqlStatements(sqlText);
  const summary: SqlRunSummary = {
    file: absolutePath,
    executed: 0,
    skipped: 0,
    failed: 0,
  };

  if (options.dryRun) {
    console.log(`[dry-run] ${absolutePath} (${statements.length} statements)`);
    const bucket = inferBucketFromStatements(statements);
    statements.forEach((stmt, index) => {
      const parsed = parseCreateDdlStatement(stmt);
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 120);
      const tag = parsed ? `[${ddlKey(parsed)}]` : '';
      console.log(`  ${index + 1}. ${preview}${stmt.length > 120 ? '…' : ''} ${tag}`);
    });
    console.log(`  (dry-run: bucket context ${bucket}; existence not checked)`);
    return summary;
  }

  await initCouchbase();
  const timeout = options.queryTimeoutMs ?? 120_000;
  const bucket = inferBucketFromStatements(statements);
  const catalog = await ClusterCatalog.load(db.cluster, bucket, timeout);
  const catalogHint = catalog.indexCount() > 0
    ? `${catalog.indexCount()} from system:indexes`
    : 'system:indexes empty — using EXPLAIN probe per index';
  console.log(`  Catalog: ${catalogHint} (bucket ${bucket})`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const label = stmt.replace(/\s+/g, ' ').slice(0, 80);
    const parsed = parseCreateDdlStatement(stmt);

    if (parsed && await catalog.exists(db.cluster, parsed, timeout)) {
      summary.skipped += 1;
      console.warn(`  SKIP [${i + 1}/${statements.length}] ${label} — already exists`);
      continue;
    }

    if (
      options.skipVectorIndexIfNoEmbeddings
      && parsed?.kind === 'index'
      && parsed.isVector
      && parsed.vectorField
      && !isOutcomesVectorIndex(parsed)
    ) {
      const vectorCount = await countVectorFieldDocs(
        db.cluster,
        parsed.bucket,
        parsed.scope,
        parsed.collection,
        parsed.vectorField,
        timeout,
      );
      if (vectorCount === 0) {
        summary.skipped += 1;
        console.warn(
          `  SKIP [${i + 1}/${statements.length}] ${label} — no documents with ${parsed.vectorField} in ${parsed.bucket}.${parsed.scope}.${parsed.collection}`,
        );
        continue;
      }
    }

    try {
      await db.cluster.query(stmt, { timeout });
      if (parsed) catalog.record(parsed);
      summary.executed += 1;
      console.log(`  OK [${i + 1}/${statements.length}] ${label}`);
    } catch (error) {
      const message = extractQueryErrorMessage(error);
      if (isIdempotentError(message)) {
        if (parsed) catalog.record(parsed);
        summary.skipped += 1;
        console.warn(`  SKIP [${i + 1}/${statements.length}] ${label} — already exists`);
        continue;
      }
      if (
        options.continueOnVectorTrainingFailure
        && parsed?.isVector
        && isVectorTrainingDataError(message)
      ) {
        summary.skipped += 1;
        if (parsed && isOutcomesVectorIndex(parsed)) {
          console.warn(
            `  PENDING [${i + 1}/${statements.length}] ${label} — index created; stays building until outcomes documents include embeddings, then Ready (green) in Indexes UI`,
          );
        } else {
          console.warn(
            `  PENDING [${i + 1}/${statements.length}] ${label} — insufficient vector data for training; add documents then rebuild or re-run setup`,
          );
        }
        continue;
      }
      summary.failed += 1;
      console.error(`  FAIL [${i + 1}/${statements.length}] ${label}`);
      console.error(message);
      throw error;
    }
  }

  return summary;
}

export async function runSqlFiles(
  filePaths: string[],
  options: { dryRun?: boolean; queryTimeoutMs?: number } = {},
): Promise<SqlRunSummary[]> {
  const results: SqlRunSummary[] = [];
  for (const filePath of filePaths) {
    console.log(`\nRunning SQL: ${filePath}`);
    results.push(await runSqlFile(filePath, options));
  }
  return results;
}
