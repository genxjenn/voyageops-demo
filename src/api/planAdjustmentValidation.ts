export interface PlanAdjustmentResponse {
  assessmentHeadline: string;
  whatIAmWeighing: string[];
  currentPlanOnFile: string[];
  howIWouldAdjust: string[];
  followUpActions: string[];
  riskNotes: string[];
  confidence: number;
  citations: string[];
}

function normalizeLower(input: unknown) {
  return String(input || '').trim().toLowerCase();
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

/** Acknowledgment that no catalog actions exist (paraphrase-tolerant). */
export const NO_DEFINED_CATALOG_ACTIONS_ACK = /no\s+defined\s+(catalog\s+)?actions|no\s+catalog\s+actions|no\s+existing\s+actions?|no\s+matching\s+catalog\s+actions|without\s+(a\s+)?(defined\s+)?catalog\s+actions?|no\s+actions?\s+(are\s+)?defined\s+for\s+this\s+context|lack(s|ing)\s+(a\s+)?(defined\s+)?catalog|no\s+eligible\s+actions/i;

/** Acknowledgment that no playbook exists (paraphrase-tolerant). */
export const NO_DEFINED_PLAYBOOK_ACK = /no\s+defined\s+playbook|no\s+existing\s+playbook|not\s+covered\s+by\s+(a\s+)?(an\s+)?(approved\s+)?playbook|no\s+playbook\s+(is\s+)?(available|defined|exists)|without\s+(a\s+)?defined\s+playbook|no\s+matching\s+playbook|lacks\s+playbook\s+coverage|playbook\s+coverage\s+(is\s+)?missing|no\s+playbook\s+for\s+this|playbook\s+gap|absent\s+playbook/i;

export function validatePlanAdjustmentPayload(
  payload: unknown,
  allowedActionIds: Set<string>,
  availableCitationIds: Set<string>,
  options?: {
    incidentType?: string;
    hasDefinedActions?: boolean;
    hasDefinedPlaybooks?: boolean;
  },
): PlanAdjustmentResponse {
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
      const m = line.match(/\[(gr_[a-z0-9_-]+)\]/i);
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
    ...whatIAmWeighing,
    ...currentPlanOnFile,
    ...howIWouldAdjust,
    ...followUpActions,
    ...riskNotes,
  ].join(' ').toLowerCase();

  if (incidentType === 'safety' && !hasDefinedActions) {
    if (!NO_DEFINED_CATALOG_ACTIONS_ACK.test(combinedText)) {
      throw new Error('Safety response must explicitly state that no defined actions exist for this incident type');
    }

    if (/(future\s+cruise\s+credit|refund|voucher|compensation|upgrade|discount|onboard\s+credit)/.test(combinedText)) {
      throw new Error('Safety response cannot recommend compensation-style actions when no defined actions exist');
    }
  }

  if (!hasDefinedActions && !NO_DEFINED_CATALOG_ACTIONS_ACK.test(combinedText)) {
    throw new Error('Response must explicitly state that no defined catalog actions exist for this incident context');
  }

  if (!hasDefinedPlaybooks && !NO_DEFINED_PLAYBOOK_ACK.test(combinedText)) {
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
  };
}
