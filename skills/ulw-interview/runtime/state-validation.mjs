import {
  assertAutoAnswerStreak,
  assertDerivedMetrics,
  assertFactLedgerProjection,
  assertInitStamp,
  assertPendingRoundDerivedFields,
  assertScoredRoundIntegrity,
  assertTopologyStamp,
} from './state-integrity.mjs';
import {
  MAX_STATE_BYTES,
  PHASES,
  StateValidationError,
  assertInterviewId,
  assertInterviewType,
  assertNonEmptyString,
  assertObject,
  assertThreshold,
  byteLength,
  canonicalizeState,
  deriveRoundKey,
  isJsonValue,
  questionHash,
  requiredDimensions,
  topologyComponents,
  validateScores,
} from './state.mjs';

function assertStateSize(state) {
  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch {
    throw new StateValidationError('state must be JSON serializable');
  }
  if (byteLength(serialized) > MAX_STATE_BYTES) throw new StateValidationError(`state exceeds ${MAX_STATE_BYTES} bytes`);
}

function assertArrays(state) {
  for (const key of ['rounds', 'facts', 'factEvents', 'autoResearchedRounds', 'autoAnsweredRounds', 'refinedRounds', 'lateralReviews', 'ontologySnapshots', 'closureOverrides']) {
    if (!Array.isArray(state[key])) throw new StateValidationError(`state.${key} must be an array`);
  }
}

function assertPendingState(state) {
  const hasPanel = state.pendingPanel !== null;
  const hasRefinement = state.pendingRefinement !== null;
  if (state.phase !== 'round' && (state.pendingRound !== null || hasPanel || hasRefinement)) {
    throw new StateValidationError('non-round phases cannot retain pending work');
  }
  if (hasPanel && hasRefinement) throw new StateValidationError('only one pending blocker is allowed');
  if (hasRefinement && state.pendingRound === null) {
    throw new StateValidationError('refinement requires the blocked pending round');
  }
  if (hasPanel) {
    assertObject(state.pendingPanel, 'state.pendingPanel');
    if (!['pre-answer', 'milestone'].includes(state.pendingPanel.reason)) throw new StateValidationError('pendingPanel.reason is invalid');
    if (state.pendingPanel.reason === 'pre-answer' && state.pendingRound === null) {
      throw new StateValidationError('pre-answer panel requires the blocked pending round');
    }
  }
}

function assertTopology(state) {
  const topology = state.topology;
  assertObject(topology, 'state.topology');
  if (!['pending', 'confirmed'].includes(topology.status) || topology.status !== state.topologyStatus) {
    throw new StateValidationError('topology status is inconsistent');
  }
  if (!Array.isArray(topology.components)) throw new StateValidationError('topology components must be an array');
  if (state.topologyStatus === 'confirmed' && topology.components.length < 1) {
    throw new StateValidationError('confirmed topology requires components');
  }
  const ids = new Set();
  const activeIds = new Set();
  for (const component of topology.components) {
    assertObject(component, 'topology component');
    if (ids.has(component.id)) throw new StateValidationError('topology component ids must be unique');
    ids.add(component.id);
    if (component.status !== 'active' && component.status !== 'deferred') throw new StateValidationError('component status is invalid');
    if (component.status === 'active') validateScoresOrPartial(component.clarity, state.type, `component ${component.id}.clarity`);
    if (component.status === 'active') activeIds.add(component.id);
  }
  if (state.topologyStatus === 'confirmed' && !topology.components.some((component) => component.status === 'active')) {
    throw new StateValidationError('confirmed topology requires an active component');
  }
  if (topology.lastTargetedComponentId !== null && !activeIds.has(topology.lastTargetedComponentId)) {
    throw new StateValidationError('topology.lastTargetedComponentId must be null or an active component id');
  }
}

function validateScoresOrPartial(scores, type, label) {
  assertObject(scores ?? {}, label);
  for (const [dimension, value] of Object.entries(scores ?? {})) {
    if (!requiredDimensions(type).includes(dimension)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new StateValidationError(`${label}.${dimension} is invalid`);
    }
  }
}

function assertPendingRound(state) {
  const pending = state.pendingRound;
  if (pending === null) return;
  assertObject(pending, 'state.pendingRound');
  if (!Number.isInteger(pending.round) || pending.round < 1) throw new StateValidationError('pendingRound.round is invalid');
  if (pending.roundKey !== deriveRoundKey(state.interviewId, pending)) throw new StateValidationError('pendingRound.roundKey is inconsistent');
  if (pending.questionHash !== questionHash(pending.question)) throw new StateValidationError('pendingRound.questionHash is inconsistent');
  const component = topologyComponents(state).find((candidate) => candidate.id === pending.target?.componentId);
  if (!component || component.status !== 'active') throw new StateValidationError('pendingRound target component is invalid');
  if (!requiredDimensions(state.type).includes(pending.target.dimension)) throw new StateValidationError('pendingRound target dimension is invalid');
  if (typeof pending.forcedUser !== 'boolean') throw new StateValidationError('pendingRound.forcedUser is invalid');
}

function assertFacts(state) {
  const ids = new Set();
  for (const fact of state.facts) {
    assertObject(fact, 'fact');
    if (ids.has(fact.id)) throw new StateValidationError('fact ids must be unique');
    ids.add(fact.id);
    if (typeof fact.statement !== 'string' || fact.statement.trim() === '') throw new StateValidationError('fact statement is invalid');
    if (typeof fact.disputed !== 'boolean') throw new StateValidationError('fact disputed flag is invalid');
  }
  for (const event of state.factEvents) {
    assertObject(event, 'fact event');
    if (!['established', 'disputed', 'resolved'].includes(event.type)) throw new StateValidationError('fact event type is invalid');
    if (event.factId !== undefined && !ids.has(event.factId)) throw new StateValidationError('fact event references unknown fact');
  }
}

function assertRounds(state) {
  const activeIds = new Set(topologyComponents(state).filter((component) => component.status === 'active').map((component) => component.id));
  for (const round of state.rounds) {
    assertObject(round, 'round');
    if (round.lifecycle !== 'scored') throw new StateValidationError('stored rounds must be scored');
    if (!Number.isInteger(round.round) || round.round < 1) throw new StateValidationError('round number is invalid');
    if (round.questionHash !== questionHash(round.question)) throw new StateValidationError('questionHash is inconsistent');
    assertObject(round.componentScores, 'round.componentScores');
    for (const id of activeIds) {
      if (!Object.hasOwn(round.componentScores, id)) throw new StateValidationError('round componentScores must cover active components');
      validateScores(round.componentScores[id], state.type, `round ${round.round} componentScores.${id}`);
    }
  }
}

function assertCounters(state) {
  for (const key of ['autoAnswerStreak', 'lateralPanelFailures', 'restateLoops']) {
    if (!Number.isInteger(state[key]) || state[key] < 0) throw new StateValidationError(`state.${key} is invalid`);
  }
  const scoredRoundSet = new Set(state.rounds.map((round) => round.round));
  for (const key of ['autoResearchedRounds', 'autoAnsweredRounds', 'refinedRounds']) {
    if (!state[key].every((round) => Number.isInteger(round) && round >= 1 && (scoredRoundSet.has(round) || state.pendingRound?.round === round))) {
      throw new StateValidationError(`state.${key} contains invalid rounds`);
    }
  }
}

export function assertRuntimeState(rawState) {
  const state = canonicalizeState(rawState);
  assertStateSize(state);
  if (state.version !== 2) throw new StateValidationError('state.version is invalid');
  if (!PHASES.includes(state.phase)) throw new StateValidationError('state.phase is invalid');
  if (typeof state.pendingThresholdCrossingConfirmation !== 'boolean') {
    throw new StateValidationError('state.pendingThresholdCrossingConfirmation must be a boolean');
  }
  assertInterviewId(state.interviewId);
  assertInterviewType(state.type);
  assertThreshold(state.threshold);
  assertNonEmptyString(state.thresholdSource, 'state.thresholdSource');
  if (typeof state.idea !== 'string' || state.idea.trim() === '') throw new StateValidationError('state.idea is invalid');
  if (state.language !== undefined && !isJsonValue(state.language)) throw new StateValidationError('state.language is invalid');
  assertInitStamp(state);
  assertArrays(state);
  assertTopology(state);
  assertTopologyStamp(state);
  assertFacts(state);
  assertFactLedgerProjection(state);
  assertRounds(state);
  assertScoredRoundIntegrity(state);
  assertPendingState(state);
  assertPendingRound(state);
  assertPendingRoundDerivedFields(state);
  assertCounters(state);
  assertAutoAnswerStreak(state);
  if ((state.phase === 'write' || state.phase === 'written') && (!state.closurePassed || !state.restatementConfirmed)) {
    throw new StateValidationError('write phases require closurePassed and restatementConfirmed');
  }
  assertDerivedMetrics(state);
  return state;
}
