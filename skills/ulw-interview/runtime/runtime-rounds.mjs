import { disputeFactsFromRetractedRound } from './ambiguity-floor.mjs';
import {
  PANEL_PERSONAS,
  TransitionError,
  assertNonEmptyString,
  assertObject,
  clone,
  createInitialState,
  deriveRoundKey,
  isJsonValue,
  normalizeTopologyComponents,
  questionHash,
  topologyFingerprint,
} from './state.mjs';
import { assertPanelFindings, normalizeAnswer } from './runtime-round-validation.mjs';
import { assertPhase, copyState, effect, nextRoundNumber, nextTarget, nextTargetForPendingRound, withMetrics } from './transition-support.mjs';

function assertNoPending(state) {
  if (state.pendingRound || state.pendingPanel || state.pendingRefinement) {
    throw new TransitionError('a round, panel, or refinement is already pending');
  }
}

function sameTarget(left, right) {
  return left?.componentId === right?.componentId && left?.dimension === right?.dimension;
}

function assertPendingTarget(state) {
  if (!sameTarget(state.pendingRound?.target, nextTargetForPendingRound(state))) {
    throw new TransitionError('pendingRound target must match the runtime-selected target');
  }
}

function applyStreak(state, round, answer) {
  const source = answer.source;
  const autoAnswered = source === 'auto-research-accepted' || source === 'agent' || answer.autoResearchUsed === true || answer.kind === 'agent';
  return {
    autoAnswerStreak: autoAnswered ? state.autoAnswerStreak + 1 : 0,
    autoResearchedRounds: source === 'auto-research-accepted' ? [...state.autoResearchedRounds, round] : state.autoResearchedRounds,
    autoAnsweredRounds: (source === 'agent' || answer.kind === 'agent') ? [...state.autoAnsweredRounds, round] : state.autoAnsweredRounds,
    refinedRounds: source === 'refined' ? [...state.refinedRounds, round] : state.refinedRounds,
  };
}

function answeredPendingRound(state, answer) {
  return { ...state.pendingRound, answer };
}

export function initialize(input) {
  const state = createInitialState(input);
  return {
    state,
    effects: [
      effect('announce_threshold', { threshold: state.threshold, thresholdSource: state.thresholdSource }),
      effect('ask_topology'),
    ],
  };
}

export function confirmTopology(state, input) {
  assertPhase(state, 'topology', 'confirm_topology');
  assertObject(input, 'confirm_topology input');
  assertNonEmptyString(input.confirmedAt, 'confirmedAt');
  const components = normalizeTopologyComponents(input.components);
  if (!components.some((component) => component.status === 'active')) throw new TransitionError('topology requires at least one active component');
  const topology = {
    status: 'confirmed',
    components,
    deferrals: components.filter((component) => component.status === 'deferred').map((component) => ({ componentId: component.id, reason: component.deferralReason })),
    confirmedAt: input.confirmedAt,
    lastTargetedComponentId: null,
  };
  const measured = withMetrics(copyState(state, { phase: 'round', topologyStatus: 'confirmed', topology, topologyHash: topologyFingerprint(components) }));
  const target = nextTarget(measured);
  const targeted = copyState(measured, { topology: { ...measured.topology, lastTargetedComponentId: target.componentId } });
  return { state: targeted, effects: [effect('open_round', { round: 1, target })] };
}

export function openRound(state, input) {
  assertPhase(state, 'round', 'open_round');
  assertNoPending(state);
  assertObject(input, 'open_round input');
  assertObject(input.target, 'target');
  const expectedTarget = nextTarget(state);
  if (!sameTarget(input.target, expectedTarget)) throw new TransitionError('open_round target must match the runtime-selected target');
  const expectedRound = nextRoundNumber(state);
  if (input.round !== expectedRound) throw new TransitionError('open_round round must equal the next expected round');
  assertNonEmptyString(input.question, 'question');
  if (input.questionId !== undefined) assertNonEmptyString(input.questionId, 'questionId');
  if (input.roundId !== undefined) assertNonEmptyString(input.roundId, 'roundId');
  const pendingRound = {
    round: input.round,
    ...(input.questionId === undefined ? {} : { questionId: input.questionId }),
    ...(input.roundId === undefined ? {} : { roundId: input.roundId }),
    roundKey: deriveRoundKey(state.interviewId, input),
    question: input.question,
    questionHash: questionHash(input.question),
    target: clone(input.target),
    forcedUser: state.autoAnswerStreak >= 3,
  };
  const next = copyState(state, {
    pendingRound,
    topology: { ...state.topology, lastTargetedComponentId: input.target.componentId },
  });
  return {
    state: next,
    effects: [effect('ask_user', {
      round: pendingRound.round,
      target: pendingRound.target,
      forcedUser: pendingRound.forcedUser,
      ...(input.restateCorrection === true ? { restateCorrection: true } : {}),
    })],
  };
}

function submitReplacement(state, input, answer) {
  if (state.pendingRound) {
    if (state.pendingRound.answer !== undefined && (state.pendingRound.round === input.replacesRound || state.pendingRound.replacesRound === input.replacesRound)) {
      throw new TransitionError('submit_answer already recorded for this replacement round');
    }
    throw new TransitionError('replacesRound requires no pending round');
  }
  if (!Number.isInteger(input.replacesRound) || input.replacesRound < 1) throw new TransitionError('replacesRound must identify a scored round');
  const prior = state.rounds.find((round) => round.round === input.replacesRound && round.lifecycle === 'scored');
  if (!prior) throw new TransitionError('replacesRound must identify a scored round');
  const disputed = disputeFactsFromRetractedRound(state.facts, input.replacesRound);
  const factEvents = [
    ...state.factEvents,
    ...disputed.disputedIds.map((factId) => ({ type: 'disputed', factId, round: input.replacesRound, reason: 'retracted_round' })),
  ];
  const pendingRound = {
    round: input.replacesRound,
    roundKey: prior.roundKey,
    ...(prior.questionId === undefined ? {} : { questionId: prior.questionId }),
    ...(prior.roundId === undefined ? {} : { roundId: prior.roundId }),
    question: prior.question,
    questionHash: typeof prior.questionHash === 'string' && prior.questionHash.length === 64 ? prior.questionHash : questionHash(prior.question),
    target: clone(prior.target),
    forcedUser: state.autoAnswerStreak >= 3,
    replacesRound: input.replacesRound,
    answer,
  };
  const streak = applyStreak(state, pendingRound.round, answer);
  const measured = withMetrics(copyState(state, { facts: disputed.facts, factEvents, pendingRound, ...streak }));
  if (answer.kind === 'agent') {
    if (pendingRound.forcedUser) throw new TransitionError('agent answers are rejected on forced-user rounds');
    return {
      state: copyState(measured, { pendingPanel: { round: pendingRound.round, reason: 'pre-answer', personas: [...PANEL_PERSONAS], blockedEffect: 'score_answer' } }),
      effects: [effect('run_lateral_panel', { round: pendingRound.round, reason: 'pre-answer', personas: [...PANEL_PERSONAS], architectLens: false })],
    };
  }
  return { state: measured, effects: [effect('score_answer', { round: pendingRound.round })] };
}

export function submitAnswer(state, input) {
  assertPhase(state, 'round', 'submit_answer');
  assertObject(input, 'submit_answer input');
  if (!Number.isInteger(input.round) || input.round < 1) throw new TransitionError('submit_answer round is invalid');
  const answer = normalizeAnswer(input.answer);
  if (input.replacesRound !== undefined) return submitReplacement(state, input, answer);
  if (!state.pendingRound || state.pendingPanel || state.pendingRefinement) throw new TransitionError('submit_answer requires one open round');
  if (input.round !== state.pendingRound.round) throw new TransitionError('submit_answer round must match pendingRound');
  if (state.pendingRound.answer !== undefined) throw new TransitionError('submit_answer already recorded for this round');
  assertPendingTarget(state);
  if (state.pendingRound.forcedUser && answer.kind === 'agent') throw new TransitionError('agent answers are rejected on forced-user rounds');
  const streak = applyStreak(state, input.round, answer);
  const nextRound = answeredPendingRound(state, answer);
  if (input.needsRefinement === true) {
    const next = withMetrics(copyState(state, { pendingRound: nextRound, pendingRefinement: { round: input.round, answer }, ...streak }));
    return {
      state: next,
      effects: [effect('refine_answer', { round: input.round })],
    };
  }
  if (answer.kind === 'agent') {
    const next = withMetrics(copyState(state, {
      pendingRound: nextRound,
      pendingPanel: { round: input.round, reason: 'pre-answer', personas: [...PANEL_PERSONAS], blockedEffect: 'score_answer' },
      ...streak,
    }));
    return {
      state: next,
      effects: [effect('run_lateral_panel', { round: input.round, reason: 'pre-answer', personas: [...PANEL_PERSONAS], architectLens: false })],
    };
  }
  return { state: withMetrics(copyState(state, { pendingRound: nextRound, ...streak })), effects: [effect('score_answer', { round: input.round })] };
}

export function refineAnswer(state, input) {
  assertPhase(state, 'round', 'refine_answer');
  if (!state.pendingRound || !state.pendingRefinement) throw new TransitionError('refine_answer requires a pending refinement');
  assertObject(input, 'refine_answer input');
  if (input.round !== state.pendingRound.round) throw new TransitionError('refine_answer round must match pendingRound');
  if (input.confirmed !== true) {
    return {
      state: copyState(state, { pendingRound: { ...state.pendingRound, answer: undefined }, pendingRefinement: null }),
      effects: [effect('ask_user', { round: state.pendingRound.round, target: state.pendingRound.target, forcedUser: state.pendingRound.forcedUser, reask: true })],
    };
  }
  assertObject(input.structured, 'structured');
  if (!isJsonValue(input.structured)) throw new TransitionError('structured refinement must be JSON-serializable');
  const answer = { ...state.pendingRefinement.answer, source: 'refined', text: JSON.stringify(input.structured) };
  const round = state.pendingRound.round;
  const refinedRounds = state.refinedRounds.includes(round) ? state.refinedRounds : [...state.refinedRounds, round];
  return {
    state: copyState(state, { pendingRound: { ...state.pendingRound, answer }, pendingRefinement: null, refinedRounds }),
    effects: [effect('score_answer', { round })],
  };
}

export function panelCompleted(state, input) {
  assertPhase(state, 'round', 'panel_completed');
  if (!state.pendingPanel) throw new TransitionError('panel_completed requires a pending panel');
  assertObject(input, 'panel_completed input');
  assertPanelFindings(input.findings);
  const failed = input.failed === true;
  const review = {
    ...(state.pendingPanel.round === undefined ? {} : { round: state.pendingPanel.round }),
    reason: state.pendingPanel.reason,
    findings: clone(input.findings),
    ...(failed ? { failed: true } : {}),
  };
  const cleared = copyState(state, {
    pendingPanel: null,
    lateralReviews: [...state.lateralReviews, review],
    lateralPanelFailures: failed ? state.lateralPanelFailures + 1 : state.lateralPanelFailures,
  });
  if (state.pendingPanel.reason === 'pre-answer') {
    return { state: cleared, effects: [effect('score_answer', { round: state.pendingPanel.round })] };
  }
  if (state.pendingPanel.nextEffect?.type === 'request_closure_audit') {
    return { state: copyState(cleared, { phase: 'closure' }), effects: [clone(state.pendingPanel.nextEffect)] };
  }
  return { state: cleared, effects: [clone(state.pendingPanel.nextEffect)] };
}

export function recordBaseline() {
  throw new TransitionError('record_baseline is not part of the v2 runtime contract');
}
