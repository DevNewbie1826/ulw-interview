import { PANEL_PERSONAS, TransitionError, assertNonEmptyString, assertObject, clone } from './state.mjs';

export function normalizeAnswer(rawAnswer) {
  assertObject(rawAnswer, 'answer');
  if (rawAnswer.kind !== 'user' && rawAnswer.kind !== 'agent') throw new TransitionError('answer.kind must be user or agent');
  assertNonEmptyString(rawAnswer.text, 'answer.text');
  if (rawAnswer.source !== undefined && !['direct', 'refined', 'cited-confirmation', 'auto-research-accepted', 'agent'].includes(rawAnswer.source)) {
    throw new TransitionError('answer.source is invalid');
  }
  if (rawAnswer.confidence !== undefined && !['high', 'medium', 'low'].includes(rawAnswer.confidence)) {
    throw new TransitionError('answer.confidence is invalid');
  }
  if (rawAnswer.uncertainty !== undefined && rawAnswer.uncertainty !== null
    && (typeof rawAnswer.uncertainty !== 'number' || !Number.isFinite(rawAnswer.uncertainty) || rawAnswer.uncertainty < 0 || rawAnswer.uncertainty > 1)) {
    throw new TransitionError('answer.uncertainty is invalid');
  }
  if (rawAnswer.autoResearchUsed !== undefined && typeof rawAnswer.autoResearchUsed !== 'boolean') {
    throw new TransitionError('answer.autoResearchUsed is invalid');
  }
  return clone(rawAnswer);
}

export function assertPanelFindings(findings) {
  if (!Array.isArray(findings) || findings.length !== PANEL_PERSONAS.length) {
    throw new TransitionError('panel findings must match analyst/critic order');
  }
  for (const [index, finding] of findings.entries()) {
    assertObject(finding, `panel finding ${index}`);
    if (finding.persona !== PANEL_PERSONAS[index]) throw new TransitionError('panel findings must match analyst/critic order');
    assertNonEmptyString(finding.finding, `panel finding ${index}.finding`);
    if (!Array.isArray(finding.rationale) || finding.rationale.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
      throw new TransitionError('panel finding rationale must contain strings');
    }
    if (!Array.isArray(finding.suggested_options) || finding.suggested_options.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
      throw new TransitionError('panel finding suggested_options must contain strings');
    }
    if (!['high', 'medium', 'low'].includes(finding.confidence)) throw new TransitionError('panel finding confidence is invalid');
  }
}
