import { calculateAmbiguity } from './ambiguity-floor.mjs';
import { appendEstablishedFacts, disputeFacts } from './fact-ledger.mjs';
import { normalizeComponentScores, normalizeOntology, normalizeTriggers, ontologySnapshot, panelPersonas, validateActiveTriggers } from './round-recorder.mjs';
import {
  MAX_ROUNDS,
  SOFT_WARNING_ROUND,
  TransitionError,
  answerHash,
  assertObject,
  clone,
  scoringHash,
  topologyComponents,
} from './state.mjs';
import { copyState, effect, nextTarget, progressEffect, replaceComponents, scoredRounds, weakestForComponents } from './transition-support.mjs';

function assertScoringReady(state, input) {
  if (state.phase !== 'round') throw new TransitionError('record_score wrong phase: expected round');
  if (!state.pendingRound) throw new TransitionError('record_score requires a pending answered round');
  if (state.pendingPanel) throw new TransitionError('record_score is blocked by a pending panel');
  if (state.pendingRefinement) throw new TransitionError('record_score is blocked by pending refinement');
  if (!state.pendingRound.answer) throw new TransitionError('record_score requires an answered pending round');
  if (input.round !== state.pendingRound.round) throw new TransitionError('record_score round must match pendingRound');
}

function computeMetrics(state, components, facts, rounds) {
  return calculateAmbiguity({
    type: state.type,
    components,
    facts,
    rounds,
    threshold: state.threshold,
    topologyStatus: state.topologyStatus,
    autoAnsweredRounds: state.autoAnsweredRounds,
  });
}

function updateTopologyScores(state, componentScores) {
  return topologyComponents(state).map((component) => (
    component.status === 'active' && Object.hasOwn(componentScores, component.id)
      ? { ...component, clarity: clone(componentScores[component.id]) }
      : component
  ));
}

function triggerDisputes(state, triggers, round) {
  const factIds = triggers.filter((trigger) => trigger.kind === 'A').map((trigger) => trigger.factId);
  if (factIds.length === 0) return { facts: state.facts, factEvents: state.factEvents };
  let facts = state.facts;
  let factEvents = state.factEvents;
  for (const trigger of triggers.filter((candidate) => candidate.kind === 'A')) {
    const disputed = disputeFacts({ ...state, facts, factEvents }, [trigger.factId], round, 'trigger_A', trigger);
    facts = disputed.facts;
    factEvents = disputed.factEvents;
  }
  return { facts, factEvents };
}

function stallDetected(rounds) {
  const recent = rounds.filter((round) => round.lifecycle === 'scored').slice(-3).map((round) => round.ambiguity);
  if (recent.length < 3) return false;
  return Math.max(...recent) - Math.min(...recent) <= 0.05;
}

function triggerSummary(triggers) {
  return triggers.map((trigger) => ({ kind: trigger.kind, status: trigger.status, component: trigger.component, dimension: trigger.dimension }));
}

function closureAuditEffect(state, reason) {
  return effect('request_closure_audit', {
    reason,
    ...(state.pendingThresholdCrossingConfirmation ? { thresholdCrossingConfirmation: true } : {}),
  });
}

function nextThresholdCrossingConfirmation(state, answer, effectiveAmbiguity) {
  if (effectiveAmbiguity > state.threshold) return false;
  if (answer.kind === 'user') return false;
  return state.pendingThresholdCrossingConfirmation === true || state.ambiguity > state.threshold;
}

function continuation({ state, previousBand, scoredCount, weakest }) {
  if (scoredCount >= MAX_ROUNDS) {
    const closed = copyState(state, { phase: 'closure', hardCapReached: true });
    return { state: closed, effect: closureAuditEffect(closed, 'hard-cap') };
  }
  if (state.ambiguity <= state.threshold) {
    const closed = copyState(state, { phase: 'closure' });
    return { state: closed, effect: closureAuditEffect(closed, 'ready') };
  }
  const nextOpen = effect('open_round', {
    round: state.rounds.length + 1,
    target: weakest ?? nextTarget(state),
    ...(scoredCount === SOFT_WARNING_ROUND && state.softWarningShown === false ? { softWarning: true } : {}),
  });
  const warned = nextOpen.softWarning ? copyState(state, { softWarningShown: true }) : state;
  if (previousBand !== warned.band) {
    const pendingPanel = {
      reason: 'milestone',
      personas: panelPersonas(),
      priorBand: previousBand,
      band: warned.band,
      nextEffect: nextOpen,
    };
    return {
      state: copyState(warned, { pendingPanel }),
      effect: effect('run_lateral_panel', {
        reason: 'milestone',
        personas: panelPersonas(),
        architectLens: true,
        priorBand: previousBand,
        band: warned.band,
      }),
    };
  }
  return { state: warned, effect: nextOpen };
}

function buildRoundRecord({ state, input, componentScores, triggers, metrics, ontology }) {
  const pending = state.pendingRound;
  const weakest = weakestForComponents(state.type, updateTopologyScores(state, componentScores), state.topology.lastTargetedComponentId);
  return {
    round: pending.round,
    roundKey: pending.roundKey,
    ...(pending.questionId === undefined ? {} : { questionId: pending.questionId }),
    ...(pending.roundId === undefined ? {} : { roundId: pending.roundId }),
    question: pending.question,
    questionHash: pending.questionHash,
    target: clone(pending.target),
    answer: clone(pending.answer),
    answerHash: answerHash(pending.answer),
    lifecycle: 'scored',
    componentScores: clone(componentScores),
    reportedAmbiguity: metrics.reported,
    ambiguityFloor: clone(metrics.floorBreakdown),
    ambiguity: metrics.effective,
    band: metrics.band,
    triggers: clone(triggers),
    weakest,
    scoringHash: scoringHash({ componentScores, triggers, ontology, weakest }),
    ...(input.weakestRationale === undefined ? {} : { weakestRationale: input.weakestRationale }),
    ...(metrics.clamped ? { reported_ambiguity: metrics.reported, ambiguity_floor: metrics.floor } : {}),
  };
}

function replaceOrAppendRound(rounds, round) {
  if (round.replacesRound === undefined) return [...rounds, round];
  return rounds.map((candidate) => candidate.round === round.replacesRound ? round : candidate);
}

export function recordScore(state, input) {
  assertObject(input, 'record_score input');
  assertScoringReady(state, input);
  const answer = state.pendingRound.answer;
  const { scores: componentScores } = normalizeComponentScores(input, state, answer);
  const triggers = normalizeTriggers(input, state);
  validateActiveTriggers({ state, triggers, componentScores });
  const disputed = triggerDisputes(state, triggers, state.pendingRound.round);
  const established = appendEstablishedFacts({ ...state, facts: disputed.facts, factEvents: disputed.factEvents }, input.establishedFacts ?? [], state.pendingRound.round);
  const components = updateTopologyScores(state, componentScores);
  const metricsBeforeRound = computeMetrics(state, components, established.facts, state.rounds);
  const ontology = normalizeOntology(input.ontology);
  const snapshot = ontology === null ? null : ontologySnapshot(state.pendingRound.round, ontology, state.ontologySnapshots);
  const provisionalRound = buildRoundRecord({ state, input, componentScores, triggers, metrics: metricsBeforeRound, ontology });
  if (snapshot !== null) provisionalRound.ontologySnapshot = snapshot;
  if (state.pendingRound.replacesRound !== undefined) provisionalRound.replacesRound = state.pendingRound.replacesRound;
  let rounds = replaceOrAppendRound(state.rounds, provisionalRound);
  let metrics = computeMetrics(state, components, established.facts, rounds);
  const roundRecord = {
    ...provisionalRound,
    reportedAmbiguity: metrics.reported,
    ambiguityFloor: clone(metrics.floorBreakdown),
    ambiguity: metrics.effective,
    band: metrics.band,
    ...(metrics.clamped ? { reported_ambiguity: metrics.reported, ambiguity_floor: metrics.floor } : {}),
  };
  rounds = replaceOrAppendRound(state.rounds, roundRecord);
  const ontologySnapshots = snapshot === null ? state.ontologySnapshots : [...state.ontologySnapshots, snapshot];
  const pendingThresholdCrossingConfirmation = nextThresholdCrossingConfirmation(state, answer, metrics.effective);
  const measured = copyState(state, {
    topology: replaceComponents(state, components),
    facts: established.facts,
    factEvents: established.factEvents,
    rounds,
    ontologySnapshots,
    pendingRound: null,
    pendingPanel: null,
    pendingRefinement: null,
    reportedAmbiguity: metrics.reported,
    ambiguityFloor: metrics.floorBreakdown,
    ambiguity: metrics.effective,
    band: metrics.band,
    pendingThresholdCrossingConfirmation,
  });
  const scoredCount = scoredRounds(measured).length;
  const stall = stallDetected(measured.rounds);
  const escalation = stall || (scoredCount >= 8 && measured.ambiguity > 0.30) ? 'ontology' : null;
  const weakest = roundRecord.weakest;
  const routed = continuation({ state: measured, previousBand: state.band, scoredCount, weakest });
  const progress = progressEffect({
    state: routed.state,
    round: roundRecord.round,
    bandChanged: state.band !== measured.band,
    clamped: metrics.clamped,
    stallDetected: stall,
    escalation,
    weakest,
    triggerSummary: triggerSummary(triggers),
  });
  return { state: routed.state, effects: [progress, routed.effect] };
}
