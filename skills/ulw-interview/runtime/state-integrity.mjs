import { calculateAmbiguity, deriveAllDimensionsClear } from './ambiguity-floor.mjs';
import {
  StateValidationError,
  answerHash,
  assertObject,
  deriveRoundKey,
  initFingerprint,
  questionHash,
  requiredDimensions,
  scoringHash,
  stableJson,
  topologyComponents,
  topologyFingerprint,
  validateScores,
} from './state.mjs';
import { nextTargetForPendingRound } from './transition-support.mjs';

function sameTarget(left, right) {
  return left?.componentId === right?.componentId && left?.dimension === right?.dimension;
}

function assertSameJson(actual, expected, label) {
  if (stableJson(actual) !== stableJson(expected)) throw new StateValidationError(`${label} is inconsistent`);
}

function ontologyForRound(round) {
  return Array.isArray(round.ontologySnapshot?.entities) ? round.ontologySnapshot.entities : null;
}

function isAutoAnswered(answer) {
  return answer?.source === 'auto-research-accepted'
    || answer?.source === 'agent'
    || answer?.autoResearchUsed === true
    || answer?.kind === 'agent';
}

function deriveStreakFromAnswers(answers) {
  let streak = 0;
  for (const answer of answers) streak = isAutoAnswered(answer) ? streak + 1 : 0;
  return streak;
}

function scoredAnswers(state) {
  return state.rounds.filter((round) => round.lifecycle === 'scored').map((round) => round.answer);
}

function answersIncludingPending(state) {
  const answers = scoredAnswers(state);
  if (state.pendingRound?.answer !== undefined) answers.push(state.pendingRound.answer);
  return answers;
}

function expectedPendingTarget(state) {
  const pending = state.pendingRound;
  if (pending?.replacesRound !== undefined) {
    const prior = state.rounds.find((round) => round.round === pending.replacesRound && round.lifecycle === 'scored');
    if (!prior) throw new StateValidationError('pending replacement references an unknown scored round');
    return prior.target;
  }
  return nextTargetForPendingRound(state);
}

function replayFactEvents(events) {
  const facts = [];
  const byId = new Map();
  for (const event of events) {
    assertObject(event, 'fact event');
    if (event.type === 'established') {
      assertObject(event.fact, 'established fact event.fact');
      if (event.factId !== event.fact.id) throw new StateValidationError('established fact event id is inconsistent');
      if (byId.has(event.factId)) throw new StateValidationError('fact ledger establishes a duplicate fact id');
      const fact = structuredClone(event.fact);
      facts.push(fact);
      byId.set(fact.id, fact);
      continue;
    }
    const fact = byId.get(event.factId);
    if (!fact) throw new StateValidationError('fact ledger references unknown fact');
    if (event.type === 'disputed') {
      if (typeof fact.superseded_by !== 'string' || fact.superseded_by.trim() === '') fact.disputed = true;
      continue;
    }
    if (event.type === 'resolved' && event.action === 'reconfirm') {
      fact.disputed = false;
      continue;
    }
    if (event.type === 'resolved' && event.action === 'supersede') {
      if (typeof event.newFactId !== 'string' || event.newFactId.trim() === '') {
        throw new StateValidationError('supersede fact event requires newFactId');
      }
      fact.superseded_by = event.newFactId;
      continue;
    }
    throw new StateValidationError('fact event type is invalid');
  }
  return facts;
}

export function assertInitStamp(state) {
  if (state.initHash === undefined) {
    if (Object.hasOwn(state, 'topologyHash')) throw new StateValidationError('state initHash is missing');
    return;
  }
  if (state.initHash !== initFingerprint(state)) throw new StateValidationError('state initHash is inconsistent');
}

export function assertTopologyStamp(state) {
  if (state.topologyStatus !== 'confirmed') {
    if (state.initHash !== undefined && !Object.hasOwn(state, 'topologyHash')) throw new StateValidationError('pending topology requires a topologyHash field');
    if (state.topologyHash !== undefined && state.topologyHash !== null) throw new StateValidationError('pending topology cannot have a topologyHash');
    return;
  }
  if (state.topologyHash === undefined) {
    if (state.initHash !== undefined) throw new StateValidationError('confirmed topology requires a topologyHash');
    return;
  }
  if (state.topologyHash !== topologyFingerprint(topologyComponents(state))) {
    throw new StateValidationError('state topologyHash is inconsistent');
  }
}

export function assertScoredRoundIntegrity(state) {
  const activeIds = new Set(topologyComponents(state).filter((component) => component.status === 'active').map((component) => component.id));
  const dimensions = new Set(requiredDimensions(state.type));
  for (const round of state.rounds) {
    if (round.roundKey !== deriveRoundKey(state.interviewId, round)) throw new StateValidationError('roundKey is inconsistent');
    if (round.questionHash !== questionHash(round.question)) throw new StateValidationError('questionHash is inconsistent');
    if (round.answerHash !== answerHash(round.answer)) throw new StateValidationError('answerHash is inconsistent');
    if (round.scoringHash !== scoringHash({ componentScores: round.componentScores, triggers: round.triggers ?? [], ontology: ontologyForRound(round), weakest: round.weakest })) {
      throw new StateValidationError('scoringHash is inconsistent');
    }
    if (!activeIds.has(round.target?.componentId) || !dimensions.has(round.target?.dimension)) {
      throw new StateValidationError('round target is inconsistent with topology');
    }
    const scoreIds = Object.keys(round.componentScores ?? {});
    if (scoreIds.length !== activeIds.size || scoreIds.some((id) => !activeIds.has(id))) {
      throw new StateValidationError('round componentScores ids must match active topology components');
    }
    for (const id of activeIds) validateScores(round.componentScores[id], state.type, `round ${round.round} componentScores.${id}`);
  }
}

export function assertFactLedgerProjection(state) {
  assertSameJson(state.facts, replayFactEvents(state.factEvents), 'facts ledger projection');
}

export function assertAutoAnswerStreak(state) {
  const expected = deriveStreakFromAnswers(answersIncludingPending(state));
  if (state.autoAnswerStreak !== expected) throw new StateValidationError('autoAnswerStreak is inconsistent');
}

export function assertPendingRoundDerivedFields(state) {
  if (state.pendingRound === null) return;
  const expectedForcedUser = deriveStreakFromAnswers(scoredAnswers(state)) >= 3;
  if (state.pendingRound.forcedUser !== expectedForcedUser) throw new StateValidationError('pendingRound.forcedUser is inconsistent');
  if (!sameTarget(state.pendingRound.target, expectedPendingTarget(state))) {
    throw new StateValidationError('pendingRound.target must match the runtime-selected target');
  }
}

export function assertAllDimensionsClear(state) {
  const expected = deriveAllDimensionsClear(state.type, topologyComponents(state), state.facts);
  if ((state.allDimensionsClear === true) !== expected) throw new StateValidationError('allDimensionsClear is inconsistent');
}

export function assertDerivedMetrics(state) {
  if (state.phase === 'topology') {
    if (state.ambiguity !== 1 || state.reportedAmbiguity !== 1 || state.band !== 'initial') {
      throw new StateValidationError('topology ambiguity metrics are inconsistent');
    }
    return;
  }
  if (state.topologyStatus !== 'confirmed') return;
  const metrics = calculateAmbiguity({
    type: state.type,
    components: topologyComponents(state),
    facts: state.facts,
    rounds: state.rounds,
    threshold: state.threshold,
    topologyStatus: state.topologyStatus,
    autoAnsweredRounds: state.autoAnsweredRounds,
  });
  if (state.reportedAmbiguity !== metrics.reported
    || state.ambiguity !== metrics.effective
    || state.band !== metrics.band
    || stableJson(state.ambiguityFloor) !== stableJson(metrics.floorBreakdown)) {
    throw new StateValidationError(`state ambiguity metrics are inconsistent: expected ${stableJson(metrics.floorBreakdown)}/${metrics.reported}/${metrics.effective}/${metrics.band} got ${stableJson(state.ambiguityFloor)}/${state.reportedAmbiguity}/${state.ambiguity}/${state.band}`);
  }
}
