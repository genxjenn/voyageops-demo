import 'dotenv/config';
import { initCouchbase, db } from '../src/lib/couchbase.ts';

type AgentType = 'guest-recovery';

type PlaybookSeed = {
  playbookId: string;
  title: string;
  description: string;
  agentType: AgentType;
  incidentType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  loyaltyTier: string | string[];
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
  // ── Top-5 incident coverage: dining complaint ─────────────────────────────
  {
    playbookId: 'pb_gr_dining_complaint_vip',
    title: 'Critical dining complaint — VIP recovery',
    description:
      'Immediate premium service recovery for DIAMOND and ELITE PLATINUM guests with critical dining service failures, including personal chef experiences, onboard credit, and future cruise compensation.',
    agentType: 'guest-recovery',
    incidentType: 'dining complaint',
    severity: 'critical',
    loyaltyTier: ['diamond', 'elite platinum'],
    actionIds: [
      'gr_gourmet_dining_package_vip',
      'gr_private_dining_event_vip',
      'gr_chef_table_reservation_vip',
      'gr_onboard_credit_premium_vip',
      'gr_future_cruise_credit_vip',
      'gr_specialty_beverage_credit_vip',
    ],
    active: true,
  },
  {
    playbookId: 'pb_gr_dining_complaint_std',
    title: 'Dining complaint standard recovery',
    description:
      'Service recovery for dining failures and complaints across all guest tiers, prioritizing prompt rebooking, complimentary dining, and a follow-up call.',
    agentType: 'guest-recovery',
    incidentType: 'dining complaint',
    severity: 'high',
    loyaltyTier: 'any',
    actionIds: [
      'gr_dining_priority_rebook',
      'gr_priority_dining_reservation_std',
      'gr_complimentary_specialty_dining',
      'gr_meal_plan_extension_std',
      'gr_onboard_credit_premium_std',
      'gr_bridge_followup_call',
      'gr_specialty_dessert_credit_std',
    ],
    active: true,
  },
  // ── Top-5 incident coverage: maint-failure ───────────────────────────────
  {
    playbookId: 'pb_gr_maint_failure_vip',
    title: 'Critical cabin failure — VIP recovery',
    description:
      'Urgent relocation and premium compensation for DIAMOND and ELITE PLATINUM guests affected by critical cabin mechanical or system failures such as HVAC, plumbing, or electrical outages.',
    agentType: 'guest-recovery',
    incidentType: 'maint-failure',
    severity: 'critical',
    loyaltyTier: ['diamond', 'elite platinum'],
    actionIds: [
      'gr_room_suite_upgrade_comp',
      'gr_suite_upgrade_ultra_vip',
      'gr_priority_cabin_services_vip',
      'gr_concierge_priority_vip',
      'gr_onboard_credit_premium_vip',
      'gr_future_cruise_credit_vip',
      'gr_cabin_upgrade_coupon_vip',
    ],
    active: true,
  },
  // ── Top-5 incident coverage: excursion-disruption (VIP) ──────────────────
  {
    playbookId: 'pb_gr_excursion_disruption_vip',
    title: 'Excursion disruption — VIP recovery',
    description:
      'Elevated shore excursion recovery with premium rebooking, priority tender access, and future cruise compensation for DIAMOND, ELITE PLATINUM, and EMERALD loyalty guests.',
    agentType: 'guest-recovery',
    incidentType: 'excursion-disruption',
    severity: 'high',
    loyaltyTier: ['diamond', 'elite platinum', 'emerald'],
    actionIds: [
      'gr_excursion_partial_refund',
      'gr_shore_excursion_premium_vip',
      'gr_priority_shore_excursion_vip',
      'gr_priority_tender_service_vip',
      'gr_onboard_credit_premium_vip',
      'gr_future_cruise_credit_vip',
      'gr_airfare_credit_vip',
    ],
    active: true,
  },
  // ── Top-5 incident coverage: lost-item (VIP) ────────────────────────────
  {
    playbookId: 'pb_gr_lost_item_vip',
    title: 'Lost item — VIP fast-track recovery',
    description:
      'Expedited lost luggage and valuables recovery with dedicated concierge support, temporary comfort upgrade, and premium onboard and future cruise compensation for VIP guests.',
    agentType: 'guest-recovery',
    incidentType: 'lost-item',
    severity: 'high',
    loyaltyTier: ['diamond', 'elite platinum', 'emerald'],
    actionIds: [
      'gr_luggage_priority_search',
      'gr_room_suite_upgrade_comp',
      'gr_concierge_priority_vip',
      'gr_onboard_credit_premium_vip',
      'gr_future_cruise_credit_vip',
      'gr_specialty_service_credit_vip',
    ],
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
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

function buildPolicyRuleEmbeddingText(rule: PolicyRuleSeed) {
  return [
    `name: ${rule.name}`,
    `incidentType: ${rule.incidentType}`,
    `severity: ${rule.severity}`,
    `agentType: ${rule.agentType}`,
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
  const playbooksCount = await seedPlaybooks();

  console.log('Seeding complete.');
  console.log(`policy_rules: ${policyRulesCount}`);
  console.log(`playbooks: ${playbooksCount}`);
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
