import 'dotenv/config';
import { initCouchbase, db } from '../src/lib/couchbase.ts';
import { excursions } from '../src/data/mockData.ts';

function toExcursionDoc(excursion: (typeof excursions)[number]) {
  const now = new Date().toISOString();

  return {
    excursionId: excursion.id,
    ...excursion,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedExcursions() {
  let count = 0;

  for (const excursion of excursions) {
    const key = `excursion::${excursion.id}`;
    await db.excursions.upsert(key, toExcursionDoc(excursion));
    count += 1;
    console.log(`Seeded excursions ${count}/${excursions.length}: ${excursion.id}`);
  }

  return count;
}

async function main() {
  await initCouchbase();

  console.log('Seeding voyageops.excursions.excursions...');
  const excursionCount = await seedExcursions();

  console.log('Seeding complete.');
  console.log(`excursions: ${excursionCount}`);
}

main().catch((error) => {
  console.error('Excursions seed failed:', error);
  process.exit(1);
});