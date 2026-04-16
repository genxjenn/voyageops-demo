// Author: jenn.lewis@couchbase.com

// VoyageOps Demo Guest Data Load Script for Setting up New Env

// 
// Usage:
// npm run demo:load-guests
// npm run demo:load-guests -- --upsert
// 
import 'dotenv/config';
import { DocumentExistsError } from 'couchbase';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

type GuestDoc = {
  guestId: string;
  fullName?: string;
  loyaltyTier?: string;
  loyaltyNumber?: string | number;
  cabinNumber?: string | number;
  bookingId?: string;
  onboardSpend?: number;
  sailingHistoryAvg?: number;
  [key: string]: unknown;
};

function sanitizeBackupLine(rawLine: string): string {
  // Backup export may contain doubled opening quotes for field names, e.g. ""firstName".
  return rawLine.replace(/""([A-Za-z0-9_]+)"\s*:/g, '"$1":');
}

function parseGuestLine(rawLine: string, lineNumber: number): GuestDoc | null {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = sanitizeBackupLine(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized);
  } catch (error) {
    throw new Error(
      `Line ${lineNumber}: invalid JSON${error instanceof Error ? ` (${error.message})` : ''}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Line ${lineNumber}: parsed value is not an object`);
  }

  const doc = parsed as GuestDoc;
  if (!doc.guestId || typeof doc.guestId !== 'string' || !doc.guestId.trim()) {
    throw new Error(`Line ${lineNumber}: missing guestId`);
  }

  doc.guestId = doc.guestId.trim();

  return doc;
}

async function main() {
  const filePath = resolve(process.cwd(), 'data/voyageops.guests.guests');
  const mode = process.argv.includes('--upsert') ? 'upsert' : 'insert';

  await initCouchbase();

  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];

    try {
      const guest = parseGuestLine(line, lineNumber);
      if (!guest) {
        continue;
      }

      // Key is always the required guestId value.
      const key = guest.guestId;

      if (mode === 'upsert') {
        await db.guests.upsert(key, guest);
        inserted += 1;
        continue;
      }

      try {
        await db.guests.insert(key, guest);
        inserted += 1;
      } catch (error) {
        if (error instanceof DocumentExistsError) {
          skipped += 1;
        } else {
          throw error;
        }
      }
    } catch (error) {
      failed += 1;
      const details = error instanceof Error ? error.message : String(error);
      console.error(`Failed at line ${lineNumber}: ${details}`);
    }
  }

  console.log('Guest backup load complete.');
  console.log(`Mode: ${mode}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped existing: ${skipped}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Guest backup load failed:', error);
  process.exit(1);
});
