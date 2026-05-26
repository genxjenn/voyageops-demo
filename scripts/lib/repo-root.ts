import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `scripts/`). */
export const REPO_ROOT = path.resolve(scriptsDir, '../..');

export function resolveFromRepo(...segments: string[]) {
  return path.resolve(REPO_ROOT, ...segments);
}
