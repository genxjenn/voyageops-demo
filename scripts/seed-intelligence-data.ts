import 'dotenv/config';
import { initCouchbase, db } from '../src/lib/couchbase.ts';
import {
  agentRecommendations,
  dashboardKPIs,
  guestRecoveryTimeline,
  onboardOpsTimeline,
  portDisruptionTimeline,
  shipInfo,
} from '../src/data/mockData.ts';

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

function buildRecommendationEmbeddingText(rec: (typeof agentRecommendations)[number]): string {
  return [
    `title: ${rec.title}`,
    `summary: ${rec.summary}`,
    `reasoning: ${rec.reasoning}`,
    `agentType: ${rec.agentType}`,
  ].join(' | ');
}

function buildTimelineEmbeddingText(event: (typeof guestRecoveryTimeline)[number]): string {
  return [
    `title: ${event.title}`,
    `description: ${event.description}`,
    `type: ${event.type}`,
    `actor: ${event.actor}`,
  ].join(' | ');
}

function toRecommendationDoc(recommendation: (typeof agentRecommendations)[number]) {
  return {
    ...recommendation,
    updatedAt: recommendation.createdAt,
  };
}

function toTimelineDoc(
  agentType: 'guest-recovery' | 'port-disruption' | 'onboard-ops',
  event: (typeof guestRecoveryTimeline)[number],
) {
  return {
    ...event,
    agentType,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  };
}

function toKpiDoc(kpi: (typeof dashboardKPIs)[number], index: number) {
  const now = new Date().toISOString();
  return {
    kpiId: `kpi-${index + 1}`,
    ...kpi,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedRecommendations() {
  let count = 0;

  for (const recommendation of agentRecommendations) {
    const embedding = await getEmbedding(buildRecommendationEmbeddingText(recommendation));
    const key = `recommendation::${recommendation.id}`;
    await db.recommendations.upsert(key, {
      ...toRecommendationDoc(recommendation),
      embedding,
    });
    count += 1;
    console.log(`Seeded recommendations ${count}/${agentRecommendations.length}: ${recommendation.id}`);
  }

  return count;
}

async function seedTimelineEvents() {
  const timelines = [
    { agentType: 'guest-recovery' as const, events: guestRecoveryTimeline },
    { agentType: 'port-disruption' as const, events: portDisruptionTimeline },
    { agentType: 'onboard-ops' as const, events: onboardOpsTimeline },
  ];

  let count = 0;

  for (const timeline of timelines) {
    for (const event of timeline.events) {
      const embedding = await getEmbedding(buildTimelineEmbeddingText(event));
      const key = `timeline::${timeline.agentType}::${event.id}`;
      await db.timeline.upsert(key, {
        ...toTimelineDoc(timeline.agentType, event),
        embedding,
      });
      count += 1;
      console.log(`Seeded timeline ${count}: ${timeline.agentType} ${event.id}`);
    }
  }

  return count;
}

async function seedKpis() {
  let count = 0;

  for (const [index, kpi] of dashboardKPIs.entries()) {
    const doc = toKpiDoc(kpi, index);
    const key = `kpi::${doc.kpiId}`;
    await db.kpis.upsert(key, doc);
    count += 1;
    console.log(`Seeded KPIs ${count}/${dashboardKPIs.length}: ${doc.kpiId}`);
  }

  return count;
}

async function seedShipInfo() {
  const now = new Date().toISOString();
  const key = 'ship_info::current';

  await db.shipInfo.upsert(key, {
    shipId: 'MS-ACME-VOYAGER',
    ...shipInfo,
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Seeded ship info: ${key}`);
  return 1;
}

async function main() {
  await initCouchbase();

  console.log('Seeding voyageops.intelligence collections...');
  const recommendationCount = await seedRecommendations();
  const timelineCount = await seedTimelineEvents();
  const kpiCount = await seedKpis();
  const shipInfoCount = await seedShipInfo();

  console.log('Seeding complete.');
  console.log(`recommendations: ${recommendationCount}`);
  console.log(`timeline_events: ${timelineCount}`);
  console.log(`kpis: ${kpiCount}`);
  console.log(`ship_info: ${shipInfoCount}`);
}

main().catch((error) => {
  console.error('Intelligence seed failed:', error);
  process.exit(1);
});