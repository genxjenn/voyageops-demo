import 'dotenv/config';
import { initCouchbase, db } from '../src/lib/couchbase.ts';
import { excursions } from '../src/data/mockData.ts';

const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is missing');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      model: OPENAI_EMBED_MODEL,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding API returned an invalid vector');
  }

  return embedding as number[];
}

function buildExcursionEmbeddingText(excursion: (typeof excursions)[number]): string {
  return [
    `name: ${excursion.name}`,
    `port: ${excursion.port}`,
    `vendor: ${excursion.vendor}`,
    `status: ${excursion.status}`,
  ].join(' | ');
}

async function seedExcursions() {
  let count = 0;

  for (const excursion of excursions) {
    const now = new Date().toISOString();
    const embedding = await getEmbedding(buildExcursionEmbeddingText(excursion));
    const key = `excursion::${excursion.id}`;
    await db.excursions.upsert(key, {
      excursionId: excursion.id,
      ...excursion,
      embedding,
      createdAt: now,
      updatedAt: now,
    });
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