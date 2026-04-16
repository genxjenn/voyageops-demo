// Author: jenn.lewis@couchbase.com

// VoyageOps Demo Booking Data Load Script for Setting up New Env
//
// Usage:
// npm run demo:load-bookings
// npm run demo:load-bookings -- --upsert
//
import 'dotenv/config';
import { DocumentExistsError } from 'couchbase';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

type BookingDoc = {
  bookingId: string;
  guestId?: string;
  voyageNumber?: string;
  cabinType?: string;
  departureDate?: string;
  shipName?: string;
  status?: string;
  totalValue?: string | number;
  [key: string]: unknown;
};

function sanitizeBackupLine(rawLine: string): string {
  // Backup export may contain doubled opening quotes for field names, e.g. ""departureDate".
  return rawLine.replace(/""([A-Za-z0-9_]+)"\s*:/g, '"$1":');
}

function parseBookingLine(rawLine: string, lineNumber: number): BookingDoc | null {
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

  const doc = parsed as BookingDoc;
  if (!doc.bookingId || typeof doc.bookingId !== 'string' || !doc.bookingId.trim()) {
    throw new Error(`Line ${lineNumber}: missing bookingId`);
  }

  doc.bookingId = doc.bookingId.trim();

  return doc;
}

async function main() {
  const filePath = resolve(process.cwd(), 'data/voyageops.guests.bookings');
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
      const booking = parseBookingLine(line, lineNumber);
      if (!booking) {
        continue;
      }

      // Key is always the required bookingId value.
      const key = booking.bookingId;

      if (mode === 'upsert') {
        await db.bookings.upsert(key, booking);
        inserted += 1;
        continue;
      }

      try {
        await db.bookings.insert(key, booking);
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

  console.log('Booking backup load complete.');
  console.log(`Mode: ${mode}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped existing: ${skipped}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Booking backup load failed:', error);
  process.exit(1);
});
