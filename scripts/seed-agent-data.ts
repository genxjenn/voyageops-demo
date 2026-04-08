import 'dotenv/config';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

type AgentType = 'guest-recovery';

type ActionCatalogSeed = {
  actionId: string;
  label: string;
  description: string;
  agentType: AgentType;
  incidentType: string;
  incidentCategory: string;
  loyaltyTier: 'any' | 'silver' | 'gold' | 'platinum';
  active: boolean;
};

type PlaybookSeed = {
  playbookId: string;
  title: string;
  description: string;
  agentType: AgentType;
  incidentType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  loyaltyTier: 'any' | 'silver' | 'gold' | 'platinum';
  actionIds: string[];
  active: boolean;
};

type PolicyRuleSeed = {
  ruleId: string;
  agentType: AgentType;
  name: string;
  incidentType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  priority: number;
  enabled: boolean;
  conditions: Record<string, unknown>;
  directives: Record<string, unknown>;
};

const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

const actionCatalogSeeds: ActionCatalogSeed[] = [
  {
    actionId: 'gr_dining_priority_rebook',
    label: 'Priority dining rebook',
    description: 'Move guest to earliest premium dining slot and remove queue friction.',
    agentType: 'guest-recovery',
    incidentType: 'service-delay',
    incidentCategory: 'dining',
    loyaltyTier: 'any',
    active: true,
  },
  {
    actionId: 'gr_complimentary_specialty_dining',
    label: 'Complimentary specialty dining',
    description: 'Offer one complimentary specialty dining reservation within 24 hours.',
    agentType: 'guest-recovery',
    incidentType: 'service-delay',
    incidentCategory: 'dining',
    loyaltyTier: 'gold',
    active: true,
  },
  {
    actionId: 'gr_luggage_priority_search',
    label: 'Priority luggage search',
    description: 'Trigger cross-deck lost-item search with 30-minute SLA updates.',
    agentType: 'guest-recovery',
    incidentType: 'lost-item',
    incidentCategory: 'luggage',
    loyaltyTier: 'any',
    active: true,
  },
  {
    actionId: 'gr_bridge_followup_call',
    label: 'Bridge follow-up call',
    description: 'Senior crew member calls guest with personalized recovery summary.',
    agentType: 'guest-recovery',
    incidentType: 'service-escalation',
    incidentCategory: 'guest-relations',
    loyaltyTier: 'platinum',
    active: true,
  },
  {
    actionId: 'gr_spa_credit_50',
    label: '$50 spa credit',
    description: 'Issue a goodwill spa credit with same-day redeemability.',
    agentType: 'guest-recovery',
    incidentType: 'amenity-failure',
    incidentCategory: 'hospitality',
    loyaltyTier: 'silver',
    active: true,
  },
  {
    actionId: 'gr_cabin_amenity_refresh',
    label: 'Cabin amenity refresh',
    description: 'Deliver amenities package and concierge note to cabin.',
    agentType: 'guest-recovery',
    incidentType: 'housekeeping-gap',
    incidentCategory: 'cabin',
    loyaltyTier: 'any',
    active: true,
  },
  {
    actionId: 'gr_internet_day_pass',
    label: 'One-day internet pass',
    description: 'Provide one-day premium internet pass as low-friction apology.',
    agentType: 'guest-recovery',
    incidentType: 'service-delay',
    incidentCategory: 'hospitality',
    loyaltyTier: 'any',
    active: true,
  },
  {
    actionId: 'gr_excursion_partial_refund',
    label: 'Partial excursion refund',
    description: 'Apply partial refund for disrupted or shortened excursion.',
    agentType: 'guest-recovery',
    incidentType: 'excursion-disruption',
    incidentCategory: 'excursions',
    loyaltyTier: 'any',
    active: true,
  },
  {
    actionId: 'gr_children_activity_voucher',
    label: 'Children activity voucher',
    description: 'Offer family-focused onboard activity voucher to recover schedule impact.',
    agentType: 'guest-recovery',
    incidentType: 'family-disruption',
    incidentCategory: 'family-experience',
    loyaltyTier: 'any',
    active: true,
  },
  {
    actionId: 'gr_executive_lounge_access',
    label: 'Executive lounge access',
    description: 'Grant temporary lounge access for premium guest recovery.',
    agentType: 'guest-recovery',
    incidentType: 'service-escalation',
    incidentCategory: 'guest-relations',
    loyaltyTier: 'platinum',
    active: true,
  },
];

const playbookSeeds: PlaybookSeed[] = [
  {
    playbookId: 'pb_gr_dining_delay_standard',
    title: 'Dining delay standard recovery',
    description: 'Resolve moderate dining delays with quick rebooking and small-value compensation.',
    agentType: 'guest-recovery',
    incidentType: 'service-delay',
    severity: 'medium',
    loyaltyTier: 'any',
    actionIds: ['gr_dining_priority_rebook', 'gr_internet_day_pass'],
    active: true,
  },
  {
    playbookId: 'pb_gr_dining_delay_vip',
    title: 'Dining delay premium recovery',
    description: 'High-touch recovery for loyalty guests impacted by dining operations.',
    agentType: 'guest-recovery',
    incidentType: 'service-delay',
    severity: 'high',
    loyaltyTier: 'gold',
    actionIds: ['gr_dining_priority_rebook', 'gr_complimentary_specialty_dining', 'gr_bridge_followup_call'],
    active: true,
  },
  {
    playbookId: 'pb_gr_lost_item_fast_track',
    title: 'Lost item fast-track',
    description: 'Accelerated lost-item flow with proactive communication milestones.',
    agentType: 'guest-recovery',
    incidentType: 'lost-item',
    severity: 'high',
    loyaltyTier: 'any',
    actionIds: ['gr_luggage_priority_search', 'gr_bridge_followup_call'],
    active: true,
  },
  {
    playbookId: 'pb_gr_family_disruption',
    title: 'Family disruption goodwill',
    description: 'Family-first service recovery plan balancing schedule and value protection.',
    agentType: 'guest-recovery',
    incidentType: 'family-disruption',
    severity: 'medium',
    loyaltyTier: 'any',
    actionIds: ['gr_children_activity_voucher', 'gr_cabin_amenity_refresh'],
    active: true,
  },
  {
    playbookId: 'pb_gr_excursion_disruption',
    title: 'Excursion disruption compensation',
    description: 'Compensate disrupted excursions while preserving sentiment for future bookings.',
    agentType: 'guest-recovery',
    incidentType: 'excursion-disruption',
    severity: 'high',
    loyaltyTier: 'any',
    actionIds: ['gr_excursion_partial_refund', 'gr_bridge_followup_call'],
    active: true,
  },
  {
    playbookId: 'pb_gr_vip_escalation',
    title: 'VIP escalation containment',
    description: 'Contain reputational risk for premium guests with personalized and rapid actions.',
    agentType: 'guest-recovery',
    incidentType: 'service-escalation',
    severity: 'critical',
    loyaltyTier: 'platinum',
    actionIds: ['gr_bridge_followup_call', 'gr_executive_lounge_access', 'gr_complimentary_specialty_dining'],
    active: true,
  },
];

const policyRuleSeeds: PolicyRuleSeed[] = [
  {
    ruleId: 'pr_gr_budget_medium',
    agentType: 'guest-recovery',
    name: 'Medium severity max goodwill budget',
    incidentType: 'service-delay',
    severity: 'medium',
    priority: 100,
    enabled: true,
    conditions: { maxCompensationUsd: 75 },
    directives: { requireManagerApprovalAboveUsd: 50 },
  },
  {
    ruleId: 'pr_gr_budget_high',
    agentType: 'guest-recovery',
    name: 'High severity max goodwill budget',
    incidentType: 'service-escalation',
    severity: 'high',
    priority: 100,
    enabled: true,
    conditions: { maxCompensationUsd: 200 },
    directives: { requireManagerApprovalAboveUsd: 100 },
  },
  {
    ruleId: 'pr_gr_vip_exception',
    agentType: 'guest-recovery',
    name: 'VIP exception threshold',
    incidentType: 'service-escalation',
    severity: 'critical',
    priority: 90,
    enabled: true,
    conditions: { loyaltyTierIn: ['gold', 'platinum'] },
    directives: { allowEscalatedOffers: true, requiresDutyOfficerApproval: true },
  },
  {
    ruleId: 'pr_gr_refund_guardrail',
    agentType: 'guest-recovery',
    name: 'Excursion refund guardrail',
    incidentType: 'excursion-disruption',
    severity: 'high',
    priority: 95,
    enabled: true,
    conditions: { maxRefundPct: 0.5 },
    directives: { documentReasonCode: true },
  },
  {
    ruleId: 'pr_gr_repeat_incident_boost',
    agentType: 'guest-recovery',
    name: 'Repeat incident escalation',
    incidentType: 'service-delay',
    severity: 'high',
    priority: 80,
    enabled: true,
    conditions: { incidentsWithin72hGte: 2 },
    directives: { forceSeniorContact: true },
  },
  {
    ruleId: 'pr_gr_minor_incident_fastpath',
    agentType: 'guest-recovery',
    name: 'Low severity fast-path approval',
    incidentType: 'housekeeping-gap',
    severity: 'low',
    priority: 110,
    enabled: true,
    conditions: { maxCompensationUsd: 25 },
    directives: { autoApproveBelowUsd: 25 },
  },
];

async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY (or OPENAI_KEY) is missing');
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

function buildActionEmbeddingText(action: ActionCatalogSeed) {
  return [
    `actionId: ${action.actionId}`,
    `label: ${action.label}`,
    `description: ${action.description}`,
    `incidentType: ${action.incidentType}`,
    `incidentCategory: ${action.incidentCategory}`,
    `loyaltyTier: ${action.loyaltyTier}`,
  ].join(' | ');
}

function buildPlaybookEmbeddingText(playbook: PlaybookSeed) {
  return [
    `playbookId: ${playbook.playbookId}`,
    `title: ${playbook.title}`,
    `description: ${playbook.description}`,
    `incidentType: ${playbook.incidentType}`,
    `severity: ${playbook.severity}`,
    `loyaltyTier: ${playbook.loyaltyTier}`,
    `actionIds: ${playbook.actionIds.join(',')}`,
  ].join(' | ');
}

async function seedPolicyRules() {
  const policyRules = db.bucket.scope('agent').collection('policy_rules');
  const now = new Date().toISOString();

  for (const rule of policyRuleSeeds) {
    const key = `policy_rules::${rule.ruleId}`;
    await policyRules.upsert(key, {
      ...rule,
      createdAt: now,
      updatedAt: now,
    });
  }

  return policyRuleSeeds.length;
}

async function seedActionCatalog() {
  const actionCatalog = db.bucket.scope('agent').collection('action_catalog');
  const now = new Date().toISOString();

  let count = 0;
  for (const action of actionCatalogSeeds) {
    const embedding = await getEmbedding(buildActionEmbeddingText(action));
    const key = `action_catalog::${action.actionId}`;

    await actionCatalog.upsert(key, {
      ...action,
      embedding,
      createdAt: now,
      updatedAt: now,
    });

    count += 1;
    console.log(`Seeded action_catalog ${count}/${actionCatalogSeeds.length}: ${action.actionId}`);
  }

  return count;
}

async function seedPlaybooks() {
  const playbooks = db.bucket.scope('agent').collection('playbooks');
  const now = new Date().toISOString();

  let count = 0;
  for (const playbook of playbookSeeds) {
    const embedding = await getEmbedding(buildPlaybookEmbeddingText(playbook));
    const key = `playbooks::${playbook.playbookId}`;

    await playbooks.upsert(key, {
      ...playbook,
      embedding,
      createdAt: now,
      updatedAt: now,
    });

    count += 1;
    console.log(`Seeded playbooks ${count}/${playbookSeeds.length}: ${playbook.playbookId}`);
  }

  return count;
}

async function main() {
  await initCouchbase();

  console.log('Seeding voyageops.agent collections...');
  const policyRulesCount = await seedPolicyRules();
  const actionCatalogCount = await seedActionCatalog();
  const playbooksCount = await seedPlaybooks();

  console.log('Seeding complete.');
  console.log(`policy_rules: ${policyRulesCount}`);
  console.log(`action_catalog: ${actionCatalogCount}`);
  console.log(`playbooks: ${playbooksCount}`);
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
