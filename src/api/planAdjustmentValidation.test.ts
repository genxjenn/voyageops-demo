import { describe, it, expect } from 'vitest';
import {
  validatePlanAdjustmentPayload,
  NO_DEFINED_CATALOG_ACTIONS_ACK,
  NO_DEFINED_PLAYBOOK_ACK,
} from './planAdjustmentValidation.ts';

function minimalPayload(overrides: Record<string, unknown> = {}) {
  return {
    assessmentHeadline: 'Headline',
    whatIAmWeighing: ['a', 'b'],
    currentPlanOnFile: ['c'],
    howIWouldAdjust: ['d'],
    followUpActions: ['e'],
    riskNotes: ['f'],
    confidence: 0.5,
    citations: ['IN_1'],
    ...overrides,
  };
}

describe('validatePlanAdjustmentPayload', () => {
  const emptySets = { allowed: new Set<string>(), citations: new Set<string>() };

  it('accepts paraphrased no-playbook acknowledgment in whatIAmWeighing', () => {
    const payload = minimalPayload({
      whatIAmWeighing: ['No matching playbook exists for this guest context.', 'Second weighing item'],
    });
    expect(() =>
      validatePlanAdjustmentPayload(payload, emptySets.allowed, emptySets.citations, {
        hasDefinedActions: true,
        hasDefinedPlaybooks: false,
      }),
    ).not.toThrow();
  });

  it('accepts "playbook coverage is missing" in followUpActions', () => {
    const payload = minimalPayload({
      followUpActions: ['Playbook coverage is missing; escalate to governance.'],
    });
    expect(() =>
      validatePlanAdjustmentPayload(payload, emptySets.allowed, emptySets.citations, {
        hasDefinedActions: true,
        hasDefinedPlaybooks: false,
      }),
    ).not.toThrow();
  });

  it('throws when no playbook and no acknowledgment', () => {
    const payload = minimalPayload({
      assessmentHeadline: 'We should expedite guest recovery immediately.',
    });
    expect(() =>
      validatePlanAdjustmentPayload(payload, emptySets.allowed, emptySets.citations, {
        hasDefinedActions: true,
        hasDefinedPlaybooks: false,
      }),
    ).toThrow(/no defined playbook/i);
  });

  it('accepts "no eligible actions" when catalog actions empty', () => {
    const payload = minimalPayload({
      riskNotes: ['No eligible actions defined for this context; manual containment only.'],
    });
    expect(() =>
      validatePlanAdjustmentPayload(payload, emptySets.allowed, emptySets.citations, {
        hasDefinedActions: false,
        hasDefinedPlaybooks: true,
      }),
    ).not.toThrow();
  });
});

describe('ack regex sanity', () => {
  it('matches common playbook paraphrases', () => {
    expect(NO_DEFINED_PLAYBOOK_ACK.test('No playbook is available for this scenario.')).toBe(true);
    expect(NO_DEFINED_PLAYBOOK_ACK.test('There is a full playbook for this case.')).toBe(false);
  });

  it('matches common catalog paraphrases', () => {
    expect(NO_DEFINED_CATALOG_ACTIONS_ACK.test('No matching catalog actions for this incident.')).toBe(true);
    expect(NO_DEFINED_CATALOG_ACTIONS_ACK.test('Use the standard refund playbook.')).toBe(false);
  });
});
