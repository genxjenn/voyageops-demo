// src/api/routes.ts
import 'dotenv/config';
import express from 'express';
import type { Response } from 'express';
import { db } from '../lib/couchbase.ts';

const router = express.Router();

// ── Worker activity log (in-memory ring buffer + SSE broadcast) ──────────────

const WORKER_LOG_MAX = 150;

interface WorkerLogEntry {
  id: string;
  ts: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  runId?: string;
  proposalId?: string;
  step?: string;
}

const workerLogs: WorkerLogEntry[] = [];
const sseClients = new Set<Response>();

interface ChatTurn {
  sessionId: string;
  role: 'user' | 'assistant';
  message: string;
  createdAt: string;
  agentType: string;
  messageId?: string;
  incidentId?: string;
  guestId?: string;
}

interface ChatSessionState {
  sessionId: string;
  agentType: string;
  lastIncidentId?: string;
  lastGuestId?: string;
}

function broadcastLog(entry: WorkerLogEntry) {
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* client disconnected */ }
  }
}

// POST /api/worker-logs  — called by the Python worker
router.post('/worker-logs', (req, res) => {
  const { level = 'info', message, runId, proposalId, step } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const entry: WorkerLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString(),
    level,
    message: String(message),
    ...(runId && { runId: String(runId) }),
    ...(proposalId && { proposalId: String(proposalId) }),
    ...(step && { step: String(step) }),
  };

  workerLogs.push(entry);
  if (workerLogs.length > WORKER_LOG_MAX) workerLogs.shift();
  broadcastLog(entry);

  return res.status(201).json({ ok: true });
});

// GET /api/worker-logs  — fetch recent history (initial load)
router.get('/worker-logs', (_req, res) => {
  res.json(workerLogs.slice(-50));
});

// GET /api/worker-logs/stream  — SSE stream for live activity feed
router.get('/worker-logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Replay last 50 entries so the UI hydrates immediately on (re)connect.
  for (const entry of workerLogs.slice(-50)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const VECTOR_INDEX_CONFIG = [
  {
    fieldName: 'vector_category_incidents',
    indexNames: [getRequiredEnv('CB_VECTOR_INDEX_CATEGORY')],
  },
  {
    fieldName: 'vector_type_incidents',
    indexNames: [getRequiredEnv('CB_VECTOR_INDEX_TYPE')],
  },
  {
    fieldName: 'vector_desc_incidents',
    indexNames: [getRequiredEnv('CB_VECTOR_INDEX_DESC')],
  },
];
const OPENAI_EMBEDDING_MODEL = getRequiredEnv('OPENAI_EMBEDDING_MODEL');
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

interface PolicyRuleRecord {
  ruleId: string;
  name: string;
  description?: string;
  priority?: number;
  incidentType?: string;
  severity?: string;
  constraints?: Record<string, unknown>;
}

interface ActionCatalogRecord {
  actionId: string;
  label: string;
  description?: string;
  incidentType?: string | string[];
  incidentCategory?: string | string[];
  loyaltyTier?: string | string[];
}

interface PlanAdjustmentResponse {
  assessmentHeadline: string;
  whatIAmWeighing: string[];
  currentPlanOnFile: string[];
  howIWouldAdjust: string[];
  followUpActions: string[];
  riskNotes: string[];
  confidence: number;
  citations: string[];
}

function tokenizeText(input: string) {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function normalizeLower(input: unknown) {
  return String(input || '').trim().toLowerCase();
}

function includesMatch(field: unknown, expected: string) {
  const target = normalizeLower(expected);
  if (!target) return true;
  if (Array.isArray(field)) {
    return field.some((entry) => normalizeLower(entry) === target || normalizeLower(entry) === 'any');
  }
  const normalizedField = normalizeLower(field);
  return !normalizedField || normalizedField === target || normalizedField === 'any';
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function toBoundedBulletList(value: unknown, minItems = 1, maxItems = 6) {
  const items = toStringArray(value).slice(0, maxItems);
  if (items.length < minItems) {
    throw new Error(`Expected at least ${minItems} bullet item(s)`);
  }
  return items;
}

function parseConfidence(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error('LLM confidence must be numeric');
  }
  return Math.min(1, Math.max(0, num));
}

function validatePlanAdjustmentPayload(
  payload: unknown,
  allowedActionIds: Set<string>,
  availableCitationIds: Set<string>,
  options?: {
    incidentType?: string;
    hasDefinedActions?: boolean;
    hasDefinedPlaybooks?: boolean;
  },
) {
  const data = (payload as Record<string, unknown>) || {};
  const assessmentHeadline = String(data.assessmentHeadline || '').trim();
  if (!assessmentHeadline) {
    throw new Error('LLM payload missing assessmentHeadline');
  }

  const citations = toBoundedBulletList(data.citations, 1, 12);

  const currentPlanOnFile = toBoundedBulletList(data.currentPlanOnFile, 1, 8);
  const howIWouldAdjust = toBoundedBulletList(data.howIWouldAdjust, 1, 8);
  const whatIAmWeighing = toBoundedBulletList(data.whatIAmWeighing, 2, 8);
  const followUpActions = toBoundedBulletList(data.followUpActions, 1, 8);
  const riskNotes = toBoundedBulletList(data.riskNotes, 1, 8);

  const referencedActions = howIWouldAdjust
    .map((line) => {
      const m = line.match(/\[(gr_[a-z0-9_\-]+)\]/i);
      return m ? m[1] : undefined;
    })
    .filter((value): value is string => Boolean(value));
  const unknownActions = referencedActions.filter((actionId) => !allowedActionIds.has(actionId));
  if (unknownActions.length > 0) {
    throw new Error(`LLM payload referenced unknown action IDs: ${unknownActions.join(', ')}`);
  }

  const incidentType = normalizeLower(options?.incidentType);
  const hasDefinedActions = Boolean(options?.hasDefinedActions);
  const hasDefinedPlaybooks = Boolean(options?.hasDefinedPlaybooks);
  const combinedText = [
    assessmentHeadline,
    ...currentPlanOnFile,
    ...howIWouldAdjust,
    ...followUpActions,
    ...riskNotes,
  ].join(' ').toLowerCase();

  if (incidentType === 'safety' && !hasDefinedActions) {
    if (!/no\s+defined\s+action|no\s+catalog\s+action|no\s+existing\s+action/.test(combinedText)) {
      throw new Error('Safety response must explicitly state that no defined actions exist for this incident type');
    }

    if (/(future\s+cruise\s+credit|refund|voucher|compensation|upgrade|discount|onboard\s+credit)/.test(combinedText)) {
      throw new Error('Safety response cannot recommend compensation-style actions when no defined actions exist');
    }
  }

  if (!hasDefinedActions && !/no\s+defined\s+action|no\s+catalog\s+action|no\s+existing\s+action/.test(combinedText)) {
    throw new Error('Response must explicitly state that no defined catalog actions exist for this incident context');
  }

  if (!hasDefinedPlaybooks && !/no\s+defined\s+playbook|no\s+existing\s+playbook|not\s+covered\s+by\s+playbook/.test(combinedText)) {
    throw new Error('Response must explicitly state that no defined playbook exists for this incident context');
  }

  return {
    assessmentHeadline,
    whatIAmWeighing,
    currentPlanOnFile,
    howIWouldAdjust,
    followUpActions,
    riskNotes,
    confidence: parseConfidence(data.confidence),
    citations,
  } as PlanAdjustmentResponse;
}

function renderPlanAdjustmentMarkdown(params: {
  incident: any;
  guest: any;
  response: PlanAdjustmentResponse;
}) {
  const { incident, guest, response } = params;
  const guestName = guest?.fullName || guest?.name || incident?.guestId || 'Unknown guest';
  const incidentId = incident?.incidentId || incident?.id || incident?.docId || 'unknown';

  return [
    '### Guest Recovery Assessment',
    '',
    `I am focusing on **${guestName}** and incident **${incidentId}**.`,
    `_${incident?.type || 'Unknown type'} / ${incident?.category || 'Unknown category'}_${incident?.description ? ` — ${incident.description}` : ''}`,
    '',
    `**${response.assessmentHeadline}**`,
    '',
    '**What I am weighing**',
    response.whatIAmWeighing.map((line) => `- ${line}`).join('\n'),
    '',
    '**Current plan on file**',
    response.currentPlanOnFile.map((line) => `- ${line}`).join('\n'),
    '',
    '**How I would adjust it**',
    response.howIWouldAdjust.map((line) => `- ${line}`).join('\n'),
    '',
    '**Follow-up actions**',
    response.followUpActions.map((line) => `- ${line}`).join('\n'),
    '',
    '**Risk notes**',
    response.riskNotes.map((line) => `- ${line}`).join('\n'),
    '',
    `**Confidence:** ${Math.round(response.confidence * 100)}%`,
    `**Citations:** ${response.citations.join(', ')}`,
  ].join('\n');
}

function renderGuardrailedFallbackMarkdown(params: {
  incident: any;
  guest: any;
  proposal?: any;
  hasDefinedActions: boolean;
  hasDefinedPlaybooks: boolean;
  llmFailureDetail: string;
}) {
  const {
    incident,
    guest,
    proposal,
    hasDefinedActions,
    hasDefinedPlaybooks,
    llmFailureDetail,
  } = params;

  const guestName = guest?.fullName || guest?.name || incident?.guestId || 'Unknown guest';
  const incidentId = incident?.incidentId || incident?.id || incident?.docId || 'unknown';
  const incidentType = normalizeLower(incident?.type) || 'unknown';

  const currentPlan = proposal?.actions?.length
    ? proposal.actions.map((action: any) => `- ${action.label}${action.estimatedValue ? ` (${formatCurrency(action.estimatedValue)})` : ''}`).join('\n')
    : '- No worker-generated proposal exists yet for this incident.';

  const adjustmentBullets = !hasDefinedActions
    ? [
      'No defined catalog actions exist for this incident context; use manual safety-containment workflow only.',
      'Assign a duty manager and open immediate guest welfare outreach with frequent status check-ins.',
      'Escalate to operations governance to define and approve a new safety action/playbook entry for this pattern.',
    ]
    : [
      'Use currently allowed actions and keep recommendations tightly scoped to approved catalog entries only.',
      'Prioritize rapid outreach ownership and documented checkpoints until the incident is stabilized.',
    ];

  const followUpBullets = !hasDefinedPlaybooks
    ? [
      'There is no defined playbook for this incident type/context; proceed with manual incident command oversight.',
      'Capture final timeline, decisions, and outcomes so a formal playbook can be authored after closure.',
    ]
    : [
      'Apply the relevant playbook sequence and log each step transition in the incident record.',
    ];

  return [
    '### Guest Recovery Assessment',
    '',
    `I am focusing on **${guestName}** and incident **${incidentId}**.`,
    `_${incident?.type || 'Unknown type'} / ${incident?.category || 'Unknown category'}_${incident?.description ? ` — ${incident.description}` : ''}`,
    '',
    '**Fallback mode was used because the LLM output did not pass backend guardrails.**',
    '',
    '**What I am weighing**',
    `- Incident type context: ${incidentType}.`,
    `- LLM validation failure detail: ${llmFailureDetail}.`,
    '',
    '**Current plan on file**',
    currentPlan,
    '',
    '**How I would adjust it**',
    adjustmentBullets.map((line) => `- ${line}`).join('\n'),
    '',
    '**Follow-up actions**',
    followUpBullets.map((line) => `- ${line}`).join('\n'),
    '',
    '**Risk notes**',
    '- Avoid compensation-style recommendations when no defined safety catalog actions exist.',
    '- Use manual containment and governance escalation until catalog/playbook coverage is added.',
    '',
    '**Confidence:** 62%',
  ].join('\n');
}

async function loadPolicyRulesForContext(incident: any) {
  const incidentType = String(incident?.type || '').trim();
  const severity = String(incident?.severity || '').trim();
  const result = await db.cluster.query(
    `
    SELECT r.ruleId, r.name, r.description, r.priority, r.incidentType, r.severity, r.constraints
    FROM voyageops.agent.policy_rules r
    WHERE r.enabled = true
      AND LOWER(r.agentType) = 'guest-recovery'
      AND (r.incidentType IS MISSING OR LOWER(r.incidentType) = LOWER($incidentType))
      AND (r.severity IS MISSING OR LOWER(r.severity) = LOWER($severity))
    ORDER BY r.priority DESC
    LIMIT 25
    `,
    {
      parameters: { incidentType, severity },
      timeout: 10000,
    },
  );
  return (result.rows as any[]).map((row) => ({
    ruleId: String(row.ruleId || ''),
    name: String(row.name || ''),
    description: row.description ? String(row.description) : undefined,
    priority: Number(row.priority || 0),
    incidentType: row.incidentType ? String(row.incidentType) : undefined,
    severity: row.severity ? String(row.severity) : undefined,
    constraints: typeof row.constraints === 'object' && row.constraints ? row.constraints as Record<string, unknown> : undefined,
  })) as PolicyRuleRecord[];
}

async function loadAllowedActionsForContext(incident: any, guest: any) {
  const incidentType = String(incident?.type || '').trim();
  const incidentCategory = String(incident?.category || '').trim();
  const loyaltyTier = String(guest?.loyaltyTier || '').trim();

  const result = await db.cluster.query(
    `
    SELECT a.actionId, a.label, a.description, a.incidentType, a.incidentCategory, a.loyaltyTier
    FROM voyageops.agent.action_catalog a
    WHERE a.active = true
    LIMIT 300
    `,
    { timeout: 10000 },
  );

  return (result.rows as any[])
    .filter((row) => {
      const typeField = row.incidentType;
      if (Array.isArray(typeField)) {
        return typeField.length > 0;
      }
      return Boolean(String(typeField || '').trim());
    })
    .filter((row) => includesMatch(row.incidentType, incidentType))
    .filter((row) => includesMatch(row.incidentCategory, incidentCategory))
    .filter((row) => includesMatch(row.loyaltyTier, loyaltyTier))
    .map((row) => ({
      actionId: String(row.actionId || ''),
      label: String(row.label || ''),
      description: row.description ? String(row.description) : undefined,
      incidentType: row.incidentType as string | string[] | undefined,
      incidentCategory: row.incidentCategory as string | string[] | undefined,
      loyaltyTier: row.loyaltyTier as string | string[] | undefined,
    }))
    .filter((row) => Boolean(row.actionId));
}

async function loadPlaybookIdsForContext(incident: any, guest: any) {
  const incidentType = String(incident?.type || '').trim();
  const severity = String(incident?.severity || '').trim();
  const loyaltyTier = String(guest?.loyaltyTier || '').trim();

  const result = await db.cluster.query(
    `
    SELECT META(pb).id AS playbookId, pb.incidentType, pb.severity, pb.loyaltyTier
    FROM voyageops.agent.playbooks pb
    WHERE pb.active = true
    LIMIT 300
    `,
    { timeout: 10000 },
  );

  return (result.rows as any[])
    .filter((row) => {
      const typeField = row.incidentType;
      if (Array.isArray(typeField)) {
        return typeField.length > 0;
      }
      return Boolean(String(typeField || '').trim());
    })
    .filter((row) => includesMatch(row.incidentType, incidentType))
    .filter((row) => includesMatch(row.severity, severity))
    .filter((row) => includesMatch(row.loyaltyTier, loyaltyTier))
    .map((row) => String(row.playbookId || '').trim())
    .filter(Boolean);
}

async function runPlanAdjustmentLlm(params: {
  query: string;
  incident: any;
  guest: any;
  proposal: any;
  recentTurns: ChatTurn[];
  policyRules: PolicyRuleRecord[];
  allowedActions: ActionCatalogRecord[];
  playbookIds: string[];
  requestedIncidentId?: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const allowedActionIds = new Set(params.allowedActions.map((action) => action.actionId));
  const proposalActions = Array.isArray(params.proposal?.actions)
    ? params.proposal.actions.map((action: any) => ({
      actionId: String(action?.actionId || ''),
      label: String(action?.label || ''),
      description: action?.description ? String(action.description) : undefined,
      estimatedValue: action?.estimatedValue,
    }))
    : [];
  const compatibleProposalActions = proposalActions.filter((action) => allowedActionIds.has(action.actionId));
  const hasDefinedActions = params.allowedActions.length > 0;
  const hasDefinedPlaybooks = params.playbookIds.length > 0;
  const incidentType = String(params.incident?.type || '').trim();

  const contextBundle = {
    chatMemory: {
      sessionId: params.recentTurns[0]?.sessionId || undefined,
      chatSessionDocId: params.recentTurns[0]?.sessionId || undefined,
      relatedChatMessageDocIds: params.recentTurns
        .map((turn) => turn.messageId)
        .filter((messageId): messageId is string => Boolean(messageId)),
    },
    requestedIncidentId: params.requestedIncidentId,
    incomingUserMessage: params.query,
    incident: {
      incidentId: params.incident?.incidentId || params.incident?.id || params.incident?.docId,
      guestId: params.incident?.guestId,
      type: params.incident?.type,
      category: params.incident?.category,
      severity: params.incident?.severity,
      status: params.incident?.status,
      description: params.incident?.description,
      createdAt: params.incident?.createdAt,
      updatedAt: params.incident?.updatedAt,
    },
    guest: {
      guestId: params.guest?.guestId,
      fullName: params.guest?.fullName || params.guest?.name,
      loyaltyTier: params.guest?.loyaltyTier,
      onboardSpend: params.guest?.onboardSpend,
      bookingId: params.guest?.bookingId,
    },
    proposal: params.proposal
      ? {
        proposalId: params.proposal?.proposalId,
        status: params.proposal?.status,
        summary: params.proposal?.summary,
        reasoning: params.proposal?.reasoning,
        compatibility: {
          hasDefinedActions,
          compatibleActionCount: compatibleProposalActions.length,
          incompatibleActionCount: Math.max(0, proposalActions.length - compatibleProposalActions.length),
          note: compatibleProposalActions.length > 0
            ? 'proposal contains compatible action(s) for current catalog constraints'
            : 'proposal actions are not compatible with currently defined catalog actions for this incident context',
        },
        actions: compatibleProposalActions,
      }
      : null,
    guardrails: {
      incidentType,
      hasDefinedActions,
      hasDefinedPlaybooks,
      mustStateNoDefinedActionsWhenEmpty: normalizeLower(incidentType) === 'safety' && !hasDefinedActions,
      mustStateNoDefinedPlaybooksWhenEmpty: !hasDefinedPlaybooks,
      prohibitedWhenNoDefinedActions: [
        'future cruise credit',
        'refund',
        'voucher',
        'compensation',
        'upgrade',
        'onboard credit',
      ],
    },
    recentTurns: params.recentTurns.slice(-10).map((turn) => ({
      role: turn.role,
      message: turn.message,
      incidentId: turn.incidentId,
      guestId: turn.guestId,
      createdAt: turn.createdAt,
      messageId: turn.messageId,
    })),
    policyRules: params.policyRules,
    playbookIds: params.playbookIds,
    allowedActions: params.allowedActions,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'guest_recovery_plan_adjustment',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'assessmentHeadline',
              'whatIAmWeighing',
              'currentPlanOnFile',
              'howIWouldAdjust',
              'followUpActions',
              'riskNotes',
              'confidence',
              'citations',
            ],
            properties: {
              assessmentHeadline: { type: 'string' },
              whatIAmWeighing: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
              currentPlanOnFile: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
              howIWouldAdjust: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
              followUpActions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
              riskNotes: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              citations: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
            },
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are a Guest Recovery operations copilot.',
            'Use only the provided JSON context. Do not invent guest, incident, policy, proposal, or action facts.',
            'If referencing a known actionId, include it in square brackets like [gr_action_id].',
            'Only reference action IDs from allowedActions.',
            'Citations must include IDs from the provided context (incidentId, proposalId, ruleId, actionId, chat_session doc id, chat_message doc id).',
            'If guardrails.mustStateNoDefinedActionsWhenEmpty is true, explicitly state there are no defined catalog actions for this incident context and provide safety-containment steps only.',
            'If guardrails.mustStateNoDefinedPlaybooksWhenEmpty is true, explicitly state there is no defined playbook for this incident type/context.',
            'When no defined actions are available, do not recommend compensation-style actions such as credits, refunds, vouchers, or upgrades.',
            'When incident types are not covered in action catalog or playbooks, call that out directly before giving any next-step guidance.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(contextBundle),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM API returned empty response content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM API did not return valid JSON');
  }

  const availableCitationIds = new Set<string>();
  const incidentId = String(contextBundle.incident.incidentId || '').trim();
  if (incidentId) availableCitationIds.add(incidentId);
  const guestId = String(contextBundle.incident.guestId || '').trim();
  if (guestId) availableCitationIds.add(guestId);
  const chatSessionDocId = String(contextBundle.chatMemory.chatSessionDocId || '').trim();
  if (chatSessionDocId) availableCitationIds.add(chatSessionDocId);
  const proposalId = String(contextBundle.proposal?.proposalId || '').trim();
  if (proposalId) availableCitationIds.add(proposalId);
  contextBundle.policyRules.forEach((rule) => { if (rule.ruleId) availableCitationIds.add(rule.ruleId); });
  contextBundle.playbookIds.forEach((playbookId) => { if (playbookId) availableCitationIds.add(playbookId); });
  contextBundle.allowedActions.forEach((action) => { if (action.actionId) availableCitationIds.add(action.actionId); });
  contextBundle.recentTurns.forEach((turn) => { if (turn.messageId) availableCitationIds.add(String(turn.messageId)); });
  contextBundle.chatMemory.relatedChatMessageDocIds.forEach((messageId) => availableCitationIds.add(String(messageId)));

  const validated = validatePlanAdjustmentPayload(parsed, allowedActionIds, availableCitationIds, {
    incidentType: contextBundle.incident.type,
    hasDefinedActions,
    hasDefinedPlaybooks,
  });

  return {
    validated,
    contextBundle,
  };
}

function normalizeQueryForIdParsing(query: string) {
  // Normalize common unicode dash variants so IDs like IN_IOS–114_216 parse reliably.
  return query.replace(/[\u2010-\u2015\u2212]/g, '-');
}

function extractIncidentIdFromQuery(query: string) {
  // Supports IDs like IN_IOS-114_237 and IN_IOS-114_237::guest-recovery
  const normalized = normalizeQueryForIdParsing(query);
  const match = normalized.match(/\bIN_[A-Z0-9-]+_[A-Z0-9-]+(?:::[A-Za-z0-9_-]+)?\b/i);
  return match ? match[0] : undefined;
}

function extractGuestIdFromQuery(query: string) {
  // Supports IDs like guest222
  const normalized = normalizeQueryForIdParsing(query);
  const match = normalized.match(/\bguest\d+\b/i);
  return match ? match[0].toLowerCase() : undefined;
}

function buildChatMessageDocId(sessionId: string) {
  return `chatmsg::${sessionId}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`;
}

async function loadRecentChatTurns(sessionId: string, agentType: string, limit = 8): Promise<ChatTurn[]> {
  try {
    const result = await db.cluster.query(
      `
      SELECT m.sessionId, m.role, m.message, m.createdAt, m.agentType, m.messageId, m.incidentId, m.guestId
      FROM voyageops.agent.chat_messages m
      WHERE m.sessionId = $sessionId
        AND m.agentType = $agentType
      ORDER BY m.createdAt DESC, m.messageId DESC
      LIMIT $limit
      `,
      {
        parameters: { sessionId, agentType, limit },
        timeout: 10000,
      },
    );

    return (result.rows as any[])
      .map((row) => {
        const role: ChatTurn['role'] = row.role === 'assistant' ? 'assistant' : 'user';
        return {
          sessionId: String(row.sessionId || sessionId),
          role,
          message: String(row.message || ''),
          createdAt: String(row.createdAt || new Date().toISOString()),
          agentType: String(row.agentType || agentType),
          messageId: row.messageId ? String(row.messageId) : undefined,
          incidentId: row.incidentId ? String(row.incidentId) : undefined,
          guestId: row.guestId ? String(row.guestId) : undefined,
        };
      })
      .reverse();
  } catch (error) {
    console.warn('Chat memory unavailable (chat_messages query failed):', error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function loadChatSessionState(sessionId: string, agentType: string): Promise<ChatSessionState | null> {
  try {
    const doc = await db.bucket.scope('agent').collection('chat_sessions').get(sessionId);
    const content = (doc.content as Record<string, unknown>) || {};
    if (String(content.agentType || '') !== agentType) {
      return null;
    }
    return {
      sessionId,
      agentType,
      lastIncidentId: content.lastIncidentId ? String(content.lastIncidentId) : undefined,
      lastGuestId: content.lastGuestId ? String(content.lastGuestId) : undefined,
    };
  } catch {
    return null;
  }
}

async function persistChatTurn(turn: ChatTurn) {
  const messageDocId = buildChatMessageDocId(turn.sessionId);
  const now = new Date().toISOString();

  try {
    await db.bucket.scope('agent').collection('chat_messages').upsert(messageDocId, {
      messageId: messageDocId,
      sessionId: turn.sessionId,
      role: turn.role,
      message: turn.message,
      createdAt: turn.createdAt,
      agentType: turn.agentType,
      incidentId: turn.incidentId,
      guestId: turn.guestId,
    });

    const sessionsCollection = db.bucket.scope('agent').collection('chat_sessions');
    let existing: Record<string, unknown> = {};
    try {
      const existingDoc = await sessionsCollection.get(turn.sessionId);
      existing = (existingDoc.content as Record<string, unknown>) || {};
    } catch {
      existing = {};
    }

    await sessionsCollection.upsert(turn.sessionId, {
      ...existing,
      sessionId: turn.sessionId,
      agentType: turn.agentType,
      createdAt: String(existing.createdAt || now),
      updatedAt: now,
      lastIncidentId: turn.incidentId || existing.lastIncidentId,
      lastGuestId: turn.guestId || existing.lastGuestId,
      lastRole: turn.role,
      lastMessagePreview: turn.message.slice(0, 280),
    });
  } catch (error) {
    console.warn('Chat memory unavailable (chat_messages/chat_sessions upsert failed):', error instanceof Error ? error.message : String(error));
  }
}

function resolveIncidentIdFromTurns(recentTurns: ChatTurn[]) {
  for (let i = recentTurns.length - 1; i >= 0; i -= 1) {
    const turn = recentTurns[i];
    if (turn.incidentId) return turn.incidentId;
    const parsed = extractIncidentIdFromQuery(turn.message || '');
    if (parsed) return parsed;
  }
  return undefined;
}

function resolveGuestIdFromTurns(recentTurns: ChatTurn[]) {
  for (let i = recentTurns.length - 1; i >= 0; i -= 1) {
    const turn = recentTurns[i];
    if (turn.guestId) return turn.guestId;
    const parsed = extractGuestIdFromQuery(turn.message || '');
    if (parsed) return parsed;
  }
  return undefined;
}

async function getQueryEmbeddingFromIncidentCorpus(query: string) {
  const tokens = tokenizeText(query);
  const corpusQuery = `
    SELECT i.*
    FROM voyageops.guests.incidents i
    WHERE i.vector_desc_incidents IS NOT MISSING
    LIMIT 300
  `;
  const result = await db.cluster.query(corpusQuery, { timeout: 10000 });

  if (!result.rows.length) {
    throw new Error('No incident vectors are available for fallback embedding');
  }

  let bestDoc = result.rows[0];
  let bestScore = -1;

  for (const row of result.rows as any[]) {
    const searchable = `${row.type || ''} ${row.category || ''} ${row.description || ''}`;
    const rowTokens = tokenizeText(searchable);
    let overlap = 0;
    tokens.forEach(token => {
      if (rowTokens.has(token)) {
        overlap += 1;
      }
    });

    if (overlap > bestScore) {
      bestScore = overlap;
      bestDoc = row;
    }
  }

  const embedding = bestDoc.vector_desc_incidents;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Fallback incident vector is invalid');
  }

  return embedding as number[];
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function formatCurrency(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return '$0';
  }

  return numeric.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function buildGuestRecoveryChatResponse(params: {
  query: string;
  incidents: any[];
  guestsById: Map<string, any>;
  retrievalMode: 'vector-index' | 'vector-fallback';
  recentTurns?: ChatTurn[];
  proposal?: any;
  requestedIncidentId?: string;
  incidentLookupStatus?: 'found' | 'not-found';
  requestedGuestId?: string;
  guestLookupStatus?: 'found' | 'not-found';
}) {
  const {
    query,
    incidents,
    guestsById,
    proposal,
    recentTurns,
    requestedIncidentId,
    incidentLookupStatus,
    requestedGuestId,
    guestLookupStatus,
  } = params;
  const primaryIncident = incidents[0];

  if (requestedGuestId && guestLookupStatus === 'not-found') {
    return [
      '### Guest Recovery Assessment',
      '',
      `I could not find guest **${requestedGuestId}** in the current guest dataset.`,
      '',
      'I do not want to redirect you to an unrelated recovery case.',
      '',
      'If you share the correct guest ID, I can retrieve that guest\'s latest incident and response plan.',
    ].join('\n');
  }

  if (requestedGuestId && guestLookupStatus === 'found' && !primaryIncident) {
    const requestedGuest = guestsById.get(requestedGuestId);
    const requestedGuestName = requestedGuest?.fullName || requestedGuest?.name || requestedGuestId;
    return [
      '### Guest Recovery Assessment',
      '',
      `I found **${requestedGuestName}** (${requestedGuestId}), but there are no incidents for this guest right now.`,
      '',
      'No response plan exists yet because there is no active incident tied to this guest.',
    ].join('\n');
  }

  if (!primaryIncident) {
    return [
      '### Guest Recovery Assessment',
      '',
      `I did not find a strong guest-recovery match for _${query}_.`,
      '',
      'Try asking about a guest name, a recovery preference, or an incident type so I can ground the recommendation in a live case.',
    ].join('\n');
  }

  if (requestedIncidentId && incidentLookupStatus === 'not-found') {
    return [
      '### Guest Recovery Assessment',
      '',
      `I could not find incident **${requestedIncidentId}** in the current incident dataset.`,
      '',
      'I do not want to guess or redirect you to an unrelated case.',
      '',
      'If you share the correct incident ID, guest name, or incident type/category, I can provide an exact recovery recommendation for that request.',
    ].join('\n');
  }

  const guest = guestsById.get(primaryIncident.guestId);
  const guestName = guest?.fullName || guest?.name || primaryIncident.guestId || 'Unknown guest';
  const severity = String(primaryIncident.severity || 'unknown').toUpperCase();
  const loyaltyTier = String(guest?.loyaltyTier || 'GOLD').toUpperCase();
  const spend = formatCurrency(guest?.onboardSpend ?? 0);
  const topThemes = Array.from(new Set(incidents.slice(0, 3).map((incident) => `${incident.type || 'unknown'} / ${incident.category || 'unknown'}`)));
  const operatorIntent: string[] = [];
  const recentContextText = (recentTurns || [])
    .slice(-6)
    .map((turn) => turn.message)
    .join(' ');
  const normalizedQuery = `${recentContextText} ${query}`.toLowerCase();

  if (/(budget|cheaper|lower|cost|smaller gesture|less expensive)/.test(normalizedQuery)) {
    operatorIntent.push('keep compensation proportional and cost-aware');
  }
  if (/(vip|upgrade|premium|concierge|white glove|personal)/.test(normalizedQuery)) {
    operatorIntent.push('raise the service level for a higher-touch recovery');
  }
  if (/(urgent|fast|faster|expedite|expedited|accelerat\w*|immediately|asap)/.test(normalizedQuery)) {
    operatorIntent.push('accelerate outreach and service recovery timing');
  }
  if (/(outreach|call|follow up|follow-up|followup|apology|contact|reach out|reach-out)/.test(normalizedQuery)) {
    operatorIntent.push('add a direct human follow-up step');
  }

  const searchablePrimary = `${primaryIncident.incidentId || ''} ${primaryIncident.type || ''} ${primaryIncident.category || ''} ${primaryIncident.description || ''} ${guestName}`;
  const primaryTokens = tokenizeText(searchablePrimary);
  const queryTokens = tokenizeText(query);
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (primaryTokens.has(token)) {
      overlap += 1;
    }
  });

  const vectorScore = Number(primaryIncident.vectorScore ?? 0);
  const hasExplicitIncidentRequest = Boolean(requestedIncidentId);
  const weakSemanticMatch = !hasExplicitIncidentRequest && vectorScore < 0.18 && overlap < 2;

  if (weakSemanticMatch) {
    const candidates = incidents.slice(0, 3).map((incident) => {
      const candidateGuest = guestsById.get(incident.guestId);
      const candidateGuestName = candidateGuest?.fullName || candidateGuest?.name || incident.guestId || 'Unknown guest';
      const candidateId = incident.incidentId || incident.id || incident.docId || 'unknown';
      return `- ${candidateId} | ${candidateGuestName} | ${incident.type || 'unknown'} / ${incident.category || 'unknown'} | ${String(incident.severity || 'unknown').toUpperCase()}`;
    }).join('\n');

    return [
      '### Guest Recovery Assessment',
      '',
      'I could not confidently map your question to one specific incident.',
      '',
      'I do not want to fabricate a recommendation for the wrong case.',
      '',
      '**Closest incident candidates**',
      candidates || '- No close candidates found.',
      '',
      'Please provide the incident ID, guest name, or a bit more detail and I will target the exact incident you asked about.',
    ].join('\n');
  }

  const currentPlan = proposal?.actions?.length
    ? proposal.actions.map((action: any) => `- ${action.label}${action.estimatedValue ? ` (${formatCurrency(action.estimatedValue)})` : ''}`).join('\n')
    : '- No worker-generated proposal exists yet for this incident.';

  const reasoningBullets = [
    `Guest value context: ${guestName} is ${loyaltyTier} with approximately ${spend} in onboard spend.`,
    `Incident urgency: ${severity} severity ${primaryIncident.type || 'incident'} in ${primaryIncident.category || 'unknown category'}.`,
    topThemes.length > 0 ? `Comparable patterns retrieved: ${topThemes.join('; ')}.` : null,
    operatorIntent.length > 0 ? `Operator guidance detected: ${operatorIntent.join('; ')}.` : 'No refinement preference was stated, so I would keep the current service-recovery posture.',
  ].filter(Boolean);

  const adjustmentBullets: string[] = [];
  if (operatorIntent.includes('accelerate outreach and service recovery timing')) {
    adjustmentBullets.push('Open outreach within 15 minutes with a named owner and callback window.');
    adjustmentBullets.push('Set a 60-minute status checkpoint and escalate to duty manager if unresolved.');
  }
  if (operatorIntent.includes('add a direct human follow-up step')) {
    adjustmentBullets.push('Add a concierge or guest-services follow-up call after the first update.');
  }
  if (operatorIntent.includes('keep compensation proportional and cost-aware')) {
    adjustmentBullets.push('Use a lower-cost goodwill option first, then escalate only if sentiment remains negative.');
  }
  if (operatorIntent.includes('raise the service level for a higher-touch recovery')) {
    adjustmentBullets.push('Upgrade to a higher-touch recovery owner and premium service script.');
  }

  const nextMove = adjustmentBullets.length > 0
    ? adjustmentBullets.map((bullet) => `- ${bullet}`).join('\n')
    : 'If you want to steer the plan, ask for a lower-cost, faster, or more VIP-style recovery and I will adapt the recommendation framing.';

  return [
    '### Guest Recovery Assessment',
    '',
    `I am focusing on **${guestName}** and incident **${primaryIncident.incidentId || primaryIncident.id || primaryIncident.docId || 'unknown'}**.`,
    `_${primaryIncident.type || 'Unknown type'} / ${primaryIncident.category || 'Unknown category'}_${primaryIncident.description ? ` — ${primaryIncident.description}` : ''}`,
    '',
    '**What I am weighing**',
    reasoningBullets.map((bullet) => `- ${bullet}`).join('\n'),
    '',
    '**Current plan on file**',
    currentPlan,
    '',
    '**How I would adjust it**',
    nextMove,
  ].join('\n');
}

async function getQueryEmbedding(query: string) {
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
      input: query,
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

async function resolveQueryEmbedding(query: string) {
  try {
    const embedding = await getQueryEmbedding(query);
    return { embedding, embeddingSource: 'openai' as const };
  } catch (error) {
    console.warn('OpenAI embedding unavailable, using incident-corpus fallback:', error instanceof Error ? error.message : String(error));
    const embedding = await getQueryEmbeddingFromIncidentCorpus(query);
    return { embedding, embeddingSource: 'incident-corpus-fallback' as const };
  }
}

async function searchIncidentsByVectorIndexes(queryEmbedding: number[], limit: number) {
  const aggregated = new Map<string, { id: string; score: number; sources: string[] }>();
  const successfulIndexes: string[] = [];
  const attemptedIndexes: string[] = [];

  await Promise.all(
    VECTOR_INDEX_CONFIG.map(async ({ indexNames, fieldName }) => {
      for (const indexName of indexNames) {
        attemptedIndexes.push(indexName);

        try {
          const vectorSql = `
            SELECT META(i).id AS docId,
                   APPROX_VECTOR_DISTANCE(i.${fieldName}, $vector, "L2") AS distance
            FROM voyageops.guests.incidents i
            USE INDEX (\`${indexName}\` USING GSI)
            WHERE i.${fieldName} IS NOT MISSING
            ORDER BY distance ASC
            LIMIT $limit
          `;

          const result = await db.cluster.query(vectorSql, {
            parameters: {
              vector: queryEmbedding,
              limit,
            },
            timeout: 10000,
            raw: {
              use_cbo: true,
            },
          });

          successfulIndexes.push(indexName);

          for (const row of result.rows as any[]) {
            const rowId = String(row.docId || '');
            if (!rowId) continue;

            const current = aggregated.get(rowId);
            const distance = Number(row.distance ?? 0);
            const score = Number.isFinite(distance) ? 1 / (1 + Math.max(0, distance)) : 0;

            if (!current || score > current.score) {
              aggregated.set(rowId, { id: rowId, score, sources: [indexName] });
            } else if (!current.sources.includes(indexName)) {
              current.sources.push(indexName);
            }
          }

          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Vector index query failed for ${indexName}:`, message);
        }
      }
    }),
  );

  const hits = Array.from(aggregated.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { hits, successfulIndexes, attemptedIndexes };
}

async function searchIncidentsByVectorFieldsFallback(queryEmbedding: number[], limit: number) {
  const fallbackQuery = `
    SELECT META(i).id AS docId, i.*
    FROM voyageops.guests.incidents i
    WHERE i.vector_desc_incidents IS NOT MISSING
      AND i.vector_type_incidents IS NOT MISSING
      AND i.vector_category_incidents IS NOT MISSING
    LIMIT 400
  `;
  const result = await db.cluster.query(fallbackQuery, { timeout: 10000 });

  const scored = result.rows
    .map((row: any) => {
      const desc = cosineSimilarity(queryEmbedding, row.vector_desc_incidents ?? []);
      const type = cosineSimilarity(queryEmbedding, row.vector_type_incidents ?? []);
      const category = cosineSimilarity(queryEmbedding, row.vector_category_incidents ?? []);
      const score = desc * 0.6 + type * 0.25 + category * 0.15;
      return { ...row, vectorScore: score };
    })
    .sort((a: any, b: any) => b.vectorScore - a.vectorScore)
    .slice(0, limit);

  return scored;
}

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      message: 'API server is running and Couchbase is connected' 
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ status: 'error', error: String(error) });
  }
});

// API: KPIs
router.get('/dashboard/kpis', async (req, res) => {
  try {
    const q = `SELECT meta().id, k.* FROM voyageops.intelligence.kpis k`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load KPIs' });
  }
});

// API: Guest by ID (with incidents)
router.get('/guests', async (req, res) => {
  try {
    const q = `
      SELECT
        g.*,
        (
          SELECT RAW b.voyageNumber
          FROM voyageops.guests.bookings b
          WHERE b.guestId = g.guestId
        ) AS voyageNumbers
      FROM voyageops.guests.guests g
      ORDER BY g.name ASC
    `;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load guests' });
  }
});

// API: Guest by ID (with incidents)
router.get('/guests/:id', async (req, res) => {
  try {
    const guestId = req.params.id;
    const guestDoc = await db.guests.get(guestId);
    const incidentsQ = `
      SELECT i.* FROM voyageops.guests.incidents i
      WHERE i.guestId = $guestId
      ORDER BY i.createdAt DESC`;
    const incidents = await db.cluster.query(incidentsQ, { parameters: { guestId } });
    res.json({ guest: guestDoc.value, incidents: incidents.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load guest' });
  }
});

// API: Incidents list
router.get('/incidents', async (req, res) => {
  try {
    const severity = req.query.severity;
    const status = req.query.status;
    const guestId = req.query.guestId;
    const filterParts: string[] = [];
    const params: any = {};
    if (severity) { filterParts.push('i.severity = $severity'); params.severity = severity; }
    if (status) { filterParts.push('i.status = $status'); params.status = status; }
    if (guestId) { filterParts.push('i.guestId = $guestId'); params.guestId = guestId; }

    const where = filterParts.length ? `WHERE ${filterParts.join(' AND ')}` : '';
    const q = `SELECT i.* FROM voyageops.guests.incidents i ${where} ORDER BY i.createdAt DESC LIMIT 1000`;
    const result = await db.cluster.query(q, { parameters: params, timeout: 10000 });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load incidents' });
  }
});

// API: Server-side prioritized guest incidents for Guest Recovery top-10 list
router.get('/incidents/prioritized', async (req, res) => {
  try {
    const q = `
      WITH scored AS (
        SELECT META(i).id AS incidentDocId,
               i AS incident,
               META(g).id AS guestDocId,
               g AS guest,
               ROUND(
                 IFMISSINGORNULL(g.onboardSpend, 0)
                 * CASE LOWER(IFMISSINGORNULL(i.severity, 'low'))
                     WHEN 'critical' THEN 4
                     WHEN 'high' THEN 3
                     WHEN 'medium' THEN 2
                     ELSE 1
                   END
                 * CASE LOWER(IFMISSINGORNULL(i.status, 'open'))
                     WHEN 'open' THEN 1.2
                     WHEN 'reviewing' THEN 1.1
                     WHEN 'approved' THEN 1.0
                     WHEN 'executed' THEN 0.8
                     WHEN 'closed' THEN 0.2
                     WHEN 'pending' THEN 1.0
                     ELSE 1.0
                   END
                 * CASE UPPER(IFMISSINGORNULL(g.loyaltyTier, 'GOLD'))
                     WHEN 'DIAMOND' THEN 2.0
                     WHEN 'ELITE PLATINUM' THEN 1.5
                     WHEN 'EMERALD' THEN 1.3
                     WHEN 'PLATINUM' THEN 1.1
                     ELSE 1.0
                   END
                 * 0.25,
                 0
               ) AS potential
        FROM voyageops.guests.incidents i
        JOIN voyageops.guests.guests g ON i.guestId = META(g).id
        WHERE LOWER(IFMISSINGORNULL(i.status, 'open')) != 'closed'
      ),
      dedup AS (
        SELECT scored.*,
               ROW_NUMBER() OVER (
                 PARTITION BY IFMISSINGORNULL(scored.incident.guestId, scored.guestDocId)
                 ORDER BY scored.potential DESC
               ) AS rankPerGuest
        FROM scored
      )
      SELECT OBJECT_PUT(dedup.incident, 'incidentId', IFMISSINGORNULL(dedup.incident.incidentId, dedup.incidentDocId)) AS incident,
             OBJECT_PUT(dedup.guest, 'guestId', IFMISSINGORNULL(dedup.guest.guestId, dedup.guestDocId)) AS guest,
             dedup.potential
      FROM dedup
      WHERE dedup.rankPerGuest = 1
      ORDER BY dedup.potential DESC
      LIMIT 10
    `;

    const result = await db.cluster.query(q, { timeout: 10000 });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load prioritized incidents' });
  }
});

// API: Excursions
router.get('/excursions', async (req, res) => {
  try {
    const q = `SELECT e.* FROM voyageops.excursions.excursions e ORDER BY e.date DESC`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load excursions' });
  }
});

// API: Venues
router.get('/venues', async (req, res) => {
  try {
    const q = `SELECT v.* FROM voyageops.operations.venues v ORDER BY v.currentOccupancy DESC`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load venues' });
  }
});

// API: Recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const agentType = req.query.agentType;
    const where = agentType ? 'WHERE r.agentType = $agentType' : '';
    const params = agentType ? { agentType } : {};
    const q = `SELECT r.* FROM voyageops.intelligence.recommendations r ${where} ORDER BY r.createdAt DESC`;
    const result = await db.cluster.query(q, { parameters: params });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

// API: Action proposals (worker-generated, per guest or incident)
router.get('/action-proposals', async (req, res) => {
  try {
    const guestId = req.query.guestId as string | undefined;
    const incidentId = req.query.incidentId as string | undefined;
    const filterParts: string[] = [];
    const params: any = {};
    if (guestId) { filterParts.push('p.guestId = $guestId'); params.guestId = guestId; }
    if (incidentId) { filterParts.push('p.incidentId = $incidentId'); params.incidentId = incidentId; }
    const where = filterParts.length ? `WHERE ${filterParts.join(' AND ')}` : '';
    const q = `SELECT META(p).id AS _key, p.* FROM voyageops.agent.action_proposals p ${where} ORDER BY p.createdAt DESC LIMIT 50`;
    const result = await db.cluster.query(q, { parameters: params, timeout: 10000 });
    res.json(result.rows);
  } catch (error) {
    const message = String((error as any)?.message || error || '');
    const missingIndex = message.includes('No index available on keyspace') && message.includes('action_proposals');

    if (!missingIndex) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to load action proposals' });
    }

    try {
      // Fallback path for clusters without a N1QL index on agent.action_proposals.
      // We can still resolve proposal docs via proposalId references stored on agent_runs.
      const guestId = req.query.guestId as string | undefined;
      const incidentId = req.query.incidentId as string | undefined;
      const runFilterParts: string[] = ['r.proposalId IS NOT MISSING'];
      const runParams: any = {};

      if (guestId) {
        runFilterParts.push('r.guestId = $guestId');
        runParams.guestId = guestId;
      }
      if (incidentId) {
        runFilterParts.push('r.incidentId = $incidentId');
        runParams.incidentId = incidentId;
      }

      const runsQuery = `
        SELECT r.proposalId, r.updatedAt
        FROM voyageops.agent.agent_runs r
        WHERE ${runFilterParts.join(' AND ')}
        ORDER BY r.updatedAt DESC
        LIMIT 100
      `;

      const runsResult = await db.cluster.query(runsQuery, { parameters: runParams, timeout: 10000 });
      const orderedProposalIds = Array.from(
        new Set(
          (runsResult.rows as any[])
            .map((row) => String(row.proposalId || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 50);

      const proposalFetches = await Promise.allSettled(
        orderedProposalIds.map(async (proposalId) => {
          const doc = await db.actionProposals.get(proposalId);
          return {
            _key: proposalId,
            ...(doc.content as Record<string, unknown> & { createdAt?: string }),
          };
        }),
      );

      const proposals = proposalFetches
        .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

      return res.json(proposals);
    } catch (fallbackError) {
      console.error(fallbackError);
      return res.status(500).json({ error: 'Failed to load action proposals' });
    }
  }
});

// API: Vector-powered agent query
router.post('/agent-query', async (req, res) => {
  let failurePhase = 'init';
  try {
    failurePhase = 'parse-request';
    const query = String(req.body?.query || '').trim();
    const normalizedQuery = normalizeQueryForIdParsing(query);
    const agentType = String(req.body?.agentType || 'guest-recovery');
    const sessionIdInput = String(req.body?.sessionId || '').trim();
    const sessionId = sessionIdInput || `guest-recovery::${Date.now()}::${Math.random().toString(36).slice(2, 7)}`;
    failurePhase = 'load-chat-memory';
    const recentTurns = await loadRecentChatTurns(sessionId, agentType, 8);
    const chatSessionState = await loadChatSessionState(sessionId, agentType);

    let requestedIncidentId = extractIncidentIdFromQuery(normalizedQuery);
    let requestedGuestId = extractGuestIdFromQuery(normalizedQuery);

    if (!requestedIncidentId) {
      requestedIncidentId = resolveIncidentIdFromTurns(recentTurns);
    }
    if (!requestedIncidentId) {
      requestedIncidentId = chatSessionState?.lastIncidentId;
    }
    if (!requestedGuestId) {
      requestedGuestId = resolveGuestIdFromTurns(recentTurns);
    }
    if (!requestedGuestId) {
      requestedGuestId = chatSessionState?.lastGuestId;
    }

    if (!query) {
      return res.status(400).json({ error: 'query required' });
    }

    if (agentType !== 'guest-recovery') {
      return res.status(400).json({ error: 'agent-query currently supports guest-recovery only' });
    }

    failurePhase = 'persist-user-turn';
    await persistChatTurn({
      sessionId,
      role: 'user',
      message: query,
      createdAt: new Date().toISOString(),
      agentType,
      incidentId: requestedIncidentId,
      guestId: requestedGuestId,
    });

    let embeddingSource: 'openai' | 'incident-corpus-fallback' | 'guest-direct' = 'guest-direct';
    let successfulIndexes: string[] = [];
    let attemptedIndexes: string[] = [];

    let incidents: any[] = [];
    let retrievalMode: 'vector-index' | 'vector-fallback' = 'vector-index';
    let guestLookupStatus: 'found' | 'not-found' | undefined;

    if (requestedGuestId) {
      failurePhase = 'lookup-guest-and-incidents';
      const requestedGuestResult = await db.cluster.query(
        `
        SELECT g.*
        FROM voyageops.guests.guests g
        WHERE g.guestId = $guestId OR LOWER(META(g).id) = $guestId
        LIMIT 1
        `,
        {
          parameters: { guestId: requestedGuestId },
          timeout: 10000,
        },
      );

      guestLookupStatus = requestedGuestResult.rows.length > 0 ? 'found' : 'not-found';

      retrievalMode = 'vector-fallback';
      const guestIncidentResult = await db.cluster.query(
        `
        SELECT META(i).id AS docId, i.*
        FROM voyageops.guests.incidents i
        WHERE LOWER(i.guestId) = $guestId
        ORDER BY i.updatedAt DESC
        LIMIT 8
        `,
        {
          parameters: { guestId: requestedGuestId },
          timeout: 10000,
        },
      );

      incidents = guestIncidentResult.rows.map((row: any) => ({ ...row, vectorScore: 1 }));
    } else {
      failurePhase = 'vector-retrieval';
      const embeddingResult = await resolveQueryEmbedding(query);
      embeddingSource = embeddingResult.embeddingSource;
      const embedding = embeddingResult.embedding;
      const vectorHits = await searchIncidentsByVectorIndexes(embedding, 8);
      successfulIndexes = vectorHits.successfulIndexes;
      attemptedIndexes = vectorHits.attemptedIndexes;

      if (vectorHits.hits.length > 0) {
        const keys = vectorHits.hits.map(hit => hit.id);
        const scoreById = new Map(vectorHits.hits.map(hit => [hit.id, hit.score]));

        const incidentDocs = await db.cluster.query(
          `SELECT META(i).id AS docId, i.* FROM voyageops.guests.incidents i USE KEYS $keys`,
          { parameters: { keys } },
        );

        incidents = incidentDocs.rows
          .map((row: any) => ({ ...row, vectorScore: Number(scoreById.get(row.docId) || 0) }))
          .sort((a: any, b: any) => b.vectorScore - a.vectorScore)
          .slice(0, 8);
      } else {
        retrievalMode = 'vector-fallback';
        incidents = await searchIncidentsByVectorFieldsFallback(embedding, 8);
      }
    }

    let incidentLookupStatus: 'found' | 'not-found' | undefined;
    if (requestedIncidentId) {
      failurePhase = 'incident-lookup';
      const exactIncidentResult = await db.cluster.query(
        `
        SELECT META(i).id AS docId, i.*
        FROM voyageops.guests.incidents i
        WHERE i.incidentId = $incidentId OR META(i).id = $incidentId
        LIMIT 1
        `,
        {
          parameters: { incidentId: requestedIncidentId },
          timeout: 10000,
        },
      );

      if (exactIncidentResult.rows.length > 0) {
        incidentLookupStatus = 'found';
        const exact = { ...exactIncidentResult.rows[0], vectorScore: 1 };
        // When an explicit incident is requested and found, constrain to that incident only.
        incidents = [exact];
      } else {
        incidentLookupStatus = 'not-found';
      }
    }

    failurePhase = 'load-guests';
    const guestIds = Array.from(new Set(incidents.map((i: any) => i.guestId).filter(Boolean)));
    if (requestedGuestId && !guestIds.includes(requestedGuestId)) {
      guestIds.push(requestedGuestId);
    }
    const guestsById = new Map<string, any>();
    if (guestIds.length > 0) {
      const guestsResult = await db.cluster.query(
        `SELECT g.* FROM voyageops.guests.guests g WHERE g.guestId IN $guestIds`,
        { parameters: { guestIds } },
      );
      guestsResult.rows.forEach((g: any) => {
        if (g.guestId) {
          guestsById.set(g.guestId, g);
        }
      });
    }

    failurePhase = 'load-proposal';
    const topIncidentId = incidents[0]?.incidentId || incidents[0]?.id || incidents[0]?.docId;
    const proposalIncidentId = requestedIncidentId && incidentLookupStatus === 'found'
      ? requestedIncidentId
      : topIncidentId;
    let proposal: any | undefined;
    if (proposalIncidentId) {
      const proposalResult = await db.cluster.query(
        `
        SELECT p.*
        FROM voyageops.agent.action_proposals p
        WHERE p.incidentId = $incidentId
        ORDER BY p.createdAt DESC
        LIMIT 1
        `,
        { parameters: { incidentId: proposalIncidentId }, timeout: 10000 },
      );
      proposal = proposalResult.rows[0];
    }

    const primaryIncident = incidents[0];
    if (!primaryIncident) {
      return res.status(404).json({
        error: 'No incident could be resolved for this request context',
        metadata: {
          sessionId,
          recentTurnsUsed: recentTurns.length,
          retrievalMode,
          requestedIncidentId,
          incidentLookupStatus,
          requestedGuestId,
          guestLookupStatus,
          indexesAttempted: attemptedIndexes,
          indexesUsed: successfulIndexes,
        },
      });
    }

    const primaryGuest = guestsById.get(primaryIncident.guestId);
    if (!primaryGuest) {
      return res.status(404).json({
        error: 'Incident resolved but guest profile could not be resolved',
        metadata: {
          sessionId,
          recentTurnsUsed: recentTurns.length,
          retrievalMode,
          requestedIncidentId,
          incidentLookupStatus,
          requestedGuestId,
          guestLookupStatus,
          indexesAttempted: attemptedIndexes,
          indexesUsed: successfulIndexes,
        },
      });
    }

    failurePhase = 'load-policy-action-playbook-context';
    const policyRules = await loadPolicyRulesForContext(primaryIncident);
    const allowedActions = await loadAllowedActionsForContext(primaryIncident, primaryGuest);
    const playbookIds = await loadPlaybookIdsForContext(primaryIncident, primaryGuest);

    failurePhase = 'llm-plan-adjustment';
    const hasDefinedActions = allowedActions.length > 0;
    const hasDefinedPlaybooks = playbookIds.length > 0;
    let llmFallbackUsed = false;
    let llmFailureDetail: string | undefined;
    let responseCitations: string[] = [];
    let response = '';

    try {
      const llmResult = await runPlanAdjustmentLlm({
        query,
        incident: primaryIncident,
        guest: primaryGuest,
        proposal,
        recentTurns,
        policyRules,
        allowedActions,
        playbookIds,
        requestedIncidentId,
      });

      response = renderPlanAdjustmentMarkdown({
        incident: primaryIncident,
        guest: primaryGuest,
        response: llmResult.validated,
      });
      responseCitations = llmResult.validated.citations;
    } catch (llmError) {
      llmFallbackUsed = true;
      llmFailureDetail = llmError instanceof Error ? llmError.message : String(llmError);
      console.warn('LLM plan adjustment failed, using deterministic fallback:', llmFailureDetail);

      response = renderGuardrailedFallbackMarkdown({
        incident: primaryIncident,
        guest: primaryGuest,
        proposal,
        hasDefinedActions,
        hasDefinedPlaybooks,
        llmFailureDetail,
      });

      const incidentCitation = String(primaryIncident?.incidentId || primaryIncident?.id || primaryIncident?.docId || '').trim();
      const guestCitation = String(primaryIncident?.guestId || '').trim();
      responseCitations = [incidentCitation, guestCitation].filter(Boolean);
    }

    const debugSignature = '[debug-signature: routes.ts@agent-query-v2026-04-23b]';
    const responseWithDebug = `${response}\n\n${debugSignature}`;

    const responseIncidentId = String(incidents[0]?.incidentId || incidents[0]?.id || incidents[0]?.docId || requestedIncidentId || '');
    const responseGuestId = String(incidents[0]?.guestId || requestedGuestId || '');
    failurePhase = 'persist-assistant-turn';
    await persistChatTurn({
      sessionId,
      role: 'assistant',
      message: responseWithDebug,
      createdAt: new Date().toISOString(),
      agentType,
      incidentId: responseIncidentId || undefined,
      guestId: responseGuestId || undefined,
    });

    failurePhase = 'respond-success';
    res.json({
      response: responseWithDebug,
      incidents,
      metadata: {
        sessionId,
        recentTurnsUsed: recentTurns.length,
        sessionAnchorIncidentId: chatSessionState?.lastIncidentId,
        sessionAnchorGuestId: chatSessionState?.lastGuestId,
        llmModel: OPENAI_CHAT_MODEL,
        embeddingSource,
        retrievalMode,
        requestedIncidentId,
        incidentLookupStatus,
        requestedGuestId,
        guestLookupStatus,
        indexesAttempted: attemptedIndexes,
        indexesUsed: successfulIndexes,
        contextUsed: {
          incidentId: responseIncidentId || undefined,
          guestId: responseGuestId || undefined,
          proposalId: proposal?.proposalId ? String(proposal.proposalId) : undefined,
          hasDefinedActions,
          hasDefinedPlaybooks,
          chatSessionDocId: recentTurns[0]?.sessionId || sessionId,
          recentTurnMessageIds: recentTurns.map((turn) => turn.messageId).filter(Boolean),
          policyRuleIds: policyRules.map((rule) => rule.ruleId).filter(Boolean),
          playbookIds,
          allowedActionIds: allowedActions.map((action) => action.actionId).filter(Boolean),
          citations: responseCitations,
          llmFallbackUsed,
          llmFailureDetail,
        },
      },
    });
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    const debugSignature = '[debug-signature: routes.ts@agent-query-v2026-04-23c-error-detail]';
    const status =
      detail.toLowerCase().includes('llm payload') ||
      detail.toLowerCase().includes('must explicitly state') ||
      detail.toLowerCase().includes('unknown action ids')
        ? 422
        : 500;

    res.status(status).json({
      error: `Failed to run vector agent query (${failurePhase})`,
      detail,
      debugSignature,
    });
  }
});

// API: Recommendation state update
router.patch('/recommendations/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });

    await db.recommendations.mutateIn(id, [
      { type: 'replace', path: 'status', value: status },
      { type: 'replace', path: 'updatedAt', value: new Date().toISOString() },
    ]);
    const updated = await db.recommendations.get(id);
    res.json(updated.value);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update recommendation' });
  }
});

// API: Timeline
router.get('/timeline/:agentType', async (req, res) => {
  try {
    const agentType = req.params.agentType;
    const q = `
      SELECT t.* FROM voyageops.intelligence.timeline_events t
      WHERE t.agentType = $agentType
      ORDER BY t.timestamp DESC
    `;
    const result = await db.cluster.query(q, { parameters: { agentType } });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// API: Ship info
router.get('/ship-info', async (req, res) => {
  try {
    const candidateKeys = ['ship_info::current'];

    for (const key of candidateKeys) {
      try {
        const doc = await db.shipInfo.get(key);
        return res.json(doc.value);
      } catch (readError) {
        if (!(readError instanceof Error) || !readError.message.includes('document not found')) {
          throw readError;
        }
      }
    }

    const fallbackQuery = `
      SELECT s.*
      FROM voyageops.intelligence.ship_info s
      LIMIT 1
    `;
    const fallbackResult = await db.cluster.query(fallbackQuery);

    if (fallbackResult.rows.length > 0) {
      return res.json(fallbackResult.rows[0]);
    }

    res.status(404).json({ error: 'ship info not found' });
  } catch (error) {
    if (error instanceof Error && error.message.includes('document not found')) {
      res.status(404).json({ error: 'ship info not found' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Failed to load ship info' });
    }
  }
});

export default router;
