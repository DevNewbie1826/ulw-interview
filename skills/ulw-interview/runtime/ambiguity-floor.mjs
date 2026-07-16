import { CORE_DIMENSIONS, StateValidationError, WEIGHTS, isObject, requiredDimensions, topologyComponents } from './state.mjs';

export { WEIGHTS } from './state.mjs';

const DISPUTED_FACT_WEIGHT = 0.10;
const UNSCORED_COMPONENT_WEIGHT = 0.05;
const AUTO_ANSWER_WEIGHT = 0.05;

export function round2(value) {
  return Math.round(value * 100) / 100;
}

export const round = round2;

function bound01(value) {
  return Math.min(1, Math.max(0, value));
}

export function clamp(reported, floor = 0) {
  const bounded = bound01(reported);
  if (floor > bounded) return { effective: round2(Math.min(1, floor)), clamped: true };
  return { effective: round2(bounded), clamped: false };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function factsFromState(state) {
  if (!isObject(state)) return [];
  return array(state.facts ?? state.established_facts);
}

function isUnresolvedDisputedFact(fact) {
  if (!isObject(fact) || fact.disputed !== true) return false;
  return typeof fact.superseded_by !== 'string' || fact.superseded_by.trim() === '';
}

function topologyStatus(state) {
  if (!isObject(state)) return 'pending';
  if (isObject(state.topology) && typeof state.topology.status === 'string') return state.topology.status;
  return state.topologyStatus ?? 'pending';
}

function componentsFromState(state) {
  if (!isObject(state)) return [];
  if (Array.isArray(state.components)) return state.components;
  if (Array.isArray(state.topology)) return state.topology;
  if (isObject(state.topology) && Array.isArray(state.topology.components)) return state.topology.components;
  return topologyComponents(state);
}

function clarityFor(component) {
  if (!isObject(component)) return {};
  if (isObject(component.clarity)) return component.clarity;
  if (isObject(component.clarity_scores)) return component.clarity_scores;
  if (isObject(component.scores)) return component.scores;
  return {};
}

function countUnscoredActiveComponents(state) {
  if (topologyStatus(state) !== 'confirmed') return 0;
  return componentsFromState(state).filter((component) => {
    if (!isObject(component) || component.status === 'deferred') return false;
    const clarity = clarityFor(component);
    return CORE_DIMENSIONS.some((dimension) => typeof clarity[dimension] !== 'number' || !Number.isFinite(clarity[dimension]));
  }).length;
}

function scoredRoundCount(state) {
  return array(isObject(state) ? state.rounds : []).filter((entry) => isObject(entry) && entry.lifecycle === 'scored').length;
}

function autoAnsweredRoundCount(state) {
  if (!isObject(state)) return 0;
  return array(state.autoAnsweredRounds ?? state.auto_answered_rounds).length;
}

export function ambiguityFloor(state) {
  const disputedFactCount = factsFromState(state).filter(isUnresolvedDisputedFact).length;
  const unscoredActiveComponentCount = countUnscoredActiveComponents(state);
  const autoAnswered = autoAnsweredRoundCount(state);
  const scoredRounds = scoredRoundCount(state);
  const autoAnswerRatio = autoAnswered === 0 ? 0 : Math.min(1, autoAnswered / Math.max(scoredRounds, 1));
  const floor = DISPUTED_FACT_WEIGHT * disputedFactCount
    + UNSCORED_COMPONENT_WEIGHT * unscoredActiveComponentCount
    + AUTO_ANSWER_WEIGHT * autoAnswerRatio;
  return {
    floor: round2(Math.min(1, Math.max(0, floor))),
    disputedFactCount,
    unscoredActiveComponentCount,
    autoAnswerRatio: round2(autoAnswerRatio),
  };
}

export function unresolvedDisputeCount(facts) {
  return array(facts).filter(isUnresolvedDisputedFact).length;
}

export function disputeFactsFromRetractedRound(facts, retractedRound) {
  const disputedIds = [];
  const nextFacts = array(facts).filter(isObject).map((fact) => {
    if (fact.round !== retractedRound || fact.disputed === true) return { ...fact };
    if (typeof fact.superseded_by === 'string' && fact.superseded_by.trim() !== '') return { ...fact };
    if (typeof fact.id === 'string') disputedIds.push(fact.id);
    return { ...fact, disputed: true };
  });
  return { facts: nextFacts, disputedIds };
}

function scoreFor(component, dimension) {
  const clarity = clarityFor(component);
  const score = clarity[dimension];
  return typeof score === 'number' && Number.isFinite(score) ? bound01(score) : 0;
}

export function componentAmbiguity(type, scores) {
  const weights = WEIGHTS[type];
  if (!weights) throw new StateValidationError('unsupported interview type');
  const clarity = Object.entries(weights).reduce((total, [dimension, weight]) => {
    const score = isObject(scores) && typeof scores[dimension] === 'number' && Number.isFinite(scores[dimension]) ? scores[dimension] : 0;
    return total + bound01(score) * weight;
  }, 0);
  return round2(bound01(1 - clarity));
}

export function reportedAmbiguity(type, components) {
  const active = array(components).filter((component) => isObject(component) && component.status !== 'deferred');
  if (active.length === 0) throw new StateValidationError('topology requires an active component');
  const weights = WEIGHTS[type];
  if (!weights) throw new StateValidationError('unsupported interview type');
  const overall = {};
  for (const dimension of requiredDimensions(type)) {
    overall[dimension] = Math.min(...active.map((component) => scoreFor(component, dimension)));
  }
  const clarity = Object.entries(weights).reduce((total, [dimension, weight]) => total + overall[dimension] * weight, 0);
  return round2(bound01(1 - clarity));
}

export function classifyBand(ambiguity, threshold) {
  if (ambiguity <= threshold) return 'ready';
  if (ambiguity <= 0.30) return 'refined';
  if (ambiguity <= 0.60) return 'progress';
  return 'initial';
}

export function calculateAmbiguity({ type, components, facts = [], rounds = [], threshold, topologyStatus = 'confirmed', autoAnsweredRounds = null }) {
  const stateForFloor = {
    topologyStatus,
    topology: { status: topologyStatus, components },
    facts,
    rounds,
    autoAnsweredRounds: autoAnsweredRounds ?? rounds.filter((entry) => isObject(entry) && entry.answer?.kind === 'agent').map((entry) => entry.round),
  };
  const reported = reportedAmbiguity(type, components);
  const floorBreakdown = ambiguityFloor(stateForFloor);
  const { effective, clamped } = clamp(reported, floorBreakdown.floor);
  return {
    reported,
    floor: floorBreakdown.floor,
    floorBreakdown,
    effective,
    clamped,
    band: classifyBand(effective, threshold),
    ready: effective <= threshold,
    requiredDimensions: requiredDimensions(type),
  };
}

export function applyAmbiguityFloorToEnvelope(value) {
  const envelope = isObject(value) ? { ...value } : {};
  const state = isObject(envelope.state) ? { ...envelope.state } : { ...envelope };
  const breakdown = ambiguityFloor(state);
  let clamped = false;
  const current = state.current_ambiguity ?? state.ambiguity;
  if (typeof current === 'number') {
    const applied = clamp(current, breakdown.floor);
    if (applied.clamped) clamped = true;
    if (Object.hasOwn(state, 'current_ambiguity')) state.current_ambiguity = applied.effective;
    if (Object.hasOwn(state, 'ambiguity')) state.ambiguity = applied.effective;
  }
  const rounds = array(state.rounds).map((entry) => ({ ...entry }));
  let latestIndex = -1;
  for (let index = 0; index < rounds.length; index += 1) {
    if (rounds[index].lifecycle === 'scored') latestIndex = index;
  }
  if (latestIndex >= 0 && typeof rounds[latestIndex].ambiguity === 'number') {
    const applied = clamp(rounds[latestIndex].ambiguity, breakdown.floor);
    if (applied.clamped) {
      rounds[latestIndex] = {
        ...rounds[latestIndex],
        reported_ambiguity: rounds[latestIndex].reported_ambiguity ?? rounds[latestIndex].ambiguity,
        ambiguity_floor: breakdown.floor,
        ambiguity: applied.effective,
      };
      state.rounds = rounds;
      clamped = true;
    }
  }
  state.ambiguity_floor = breakdown;
  return { envelope: { ...envelope, state }, breakdown, clamped };
}
