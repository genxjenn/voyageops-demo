import 'dotenv/config';
import * as fs from 'fs';
import * as readline from 'readline';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

type ActionCatalogEntry = {
  actionId: string;
  label: string;
  description: string;
  agentType: string;
  incidentType: string;
  incidentCategory: string;
  collection?: string;
  loyaltyTier: string | string[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  embedding?: number[];
};

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
      model: OPENAI_EMBEDDING_MODEL,
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

function buildActionEmbeddingText(action: ActionCatalogEntry): string {
  const tiers = Array.isArray(action.loyaltyTier) 
    ? action.loyaltyTier.join(',') 
    : action.loyaltyTier;

  return [
    `description: ${action.description}`,
    `incidentType: ${action.incidentType}`,
    `incidentCategory: ${action.incidentCategory}`,
    `loyaltyTier: ${tiers}`,
  ].join(' | ');
}

async function readActionCatalogFile(filePath: string): Promise<ActionCatalogEntry[]> {
  const actions: ActionCatalogEntry[] = [];

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    stream.on('error', (error) => {
      reject(error);
    });

    rl.on('line', (line) => {
      if (line.trim()) {
        try {
          const action = JSON.parse(line) as ActionCatalogEntry;
          // Seed every catalog action so playbook actionIds always resolve.
          actions.push(action);
        } catch (error) {
          console.warn(`Skipped invalid JSON line: ${line.substring(0, 50)}...`);
        }
      }
    });

    rl.on('close', () => {
      resolve(actions);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

async function seedActionCatalogExtended(filePath: string) {
  const actionCatalog = db.bucket.scope('agent').collection('action_catalog');
  const now = new Date().toISOString();

  console.log(`Loading action catalog from: ${filePath}`);
  const actions = await readActionCatalogFile(filePath);
  console.log(`Loaded ${actions.length} new actions\n`);

  if (actions.length === 0) {
    throw new Error('No valid action_catalog records found in input file.');
  }

  let count = 0;
  const failed: string[] = [];

  for (const action of actions) {
    try {
      // Generate embedding for the action
      const embeddingText = buildActionEmbeddingText(action);
      const embedding = await getEmbedding(embeddingText);

      // Prepare document
      const key = `action_catalog::${action.actionId}`;
      const document: ActionCatalogEntry = {
        ...action,
        collection: 'voyageops.agent.action_catalog',
        embedding,
        createdAt: action.createdAt || now,
        updatedAt: now,
      };

      // Upsert to Couchbase
      await actionCatalog.upsert(key, document);

      count += 1;
      const tierStr = Array.isArray(action.loyaltyTier) 
        ? action.loyaltyTier.join(', ')
        : action.loyaltyTier;
      console.log(
        `✓ Seeded ${count}/${actions.length}: ${action.actionId} (${tierStr})`
      );

      // Small delay to avoid rate limiting on embedding API
      if (count % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`✗ Failed to seed ${action.actionId}: ${errorMsg}`);
      failed.push(action.actionId);
    }
  }

  return { count, failed };
}

async function main() {
  try {
    await initCouchbase();
    console.log('Connected to Couchbase\n');

    const filePath = 'data/voyageops.agent.action_catalog';
    const result = await seedActionCatalogExtended(filePath);

    console.log('\n=== Seeding Complete ===');
    console.log(`Successfully seeded: ${result.count} actions`);
    if (result.failed.length > 0) {
      console.log(`Failed: ${result.failed.length}`);
      console.log(`Failed actionIds: ${result.failed.join(', ')}`);
    }
  } catch (error) {
    console.error('Fatal error during seeding:', error);
    process.exit(1);
  }
}

main();
