import { calculateAmbiguity, componentAmbiguity } from './ambiguity-floor.mjs';
import { TransitionError, clone, requiredDimensions, topologyComponents } from './state.mjs';

export function effect(type, payload = {}) {
  return { type, ...payload };
}

export function copyState(state, changes) {
  return { ...state, ...changes };
}

export function activeComponents(state) {
  return topologyComponents(state).filter((component) => component.status === 'active');
}

export function componentFor(state, componentId) {
  const component = activeComponents(state).find((candidate) => candidate.id === componentId);
  if (!component) throw new TransitionError('component must identify an active topology component');
  return component;
}

export function updateComponent(state, componentId, patch) {
  return {
    ...state.topology,
    components: state.topology.components.map((component) => (
      component.id === componentId ? { ...component, ...patch } : component
    )),
    lastTargetedComponentId: componentId,
  };
}

export function replaceComponents(state, components) {
  return { ...state.topology, components: clone(components) };
}

export function assertPhase(state, phase, eventType) {
  if (state.phase !== phase) throw new TransitionError(`${eventType} wrong phase: expected ${phase}`);
}

function compareIds(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function componentScores(component) {
  return component.clarity ?? {};
}

export function weakestForComponents(type, components) {
  const dimensions = requiredDimensions(type);
  const candidates = components.filter((component) => component.status === 'active').map((component) => {
    const clarity = componentScores(component);
    const dimension = dimensions.reduce((best, candidate) => {
      const candidateScore = typeof clarity[candidate] === 'number' ? clarity[candidate] : 0;
      const bestScore = typeof clarity[best] === 'number' ? clarity[best] : 0;
      return candidateScore < bestScore ? candidate : best;
    }, dimensions[0]);
    return { component, dimension, ambiguity: componentAmbiguity(type, clarity) };
  });
  if (candidates.length === 0) throw new TransitionError('no active component is available');
  candidates.sort((left, right) => right.ambiguity - left.ambiguity || compareIds(left.component.id, right.component.id));
  return { componentId: candidates[0].component.id, dimension: candidates[0].dimension };
}

export function nextTarget(state) {
  const components = activeComponents(state);
  if (components.length === 0) throw new TransitionError('no active component is available');
  if (state.rounds.length === 0 && components.every((component) => Object.keys(component.clarity ?? {}).length === 0)) {
    return { componentId: components[0].id, dimension: requiredDimensions(state.type)[0] };
  }
  return weakestForComponents(state.type, components);
}

export function nextRoundNumber(state) {
  return state.rounds.length + 1;
}

export function openRoundEffect(state, payload = {}) {
  return effect('open_round', {
    round: nextRoundNumber(state),
    target: nextTarget(state),
    ...payload,
  });
}

export function withMetrics(state) {
  const metrics = calculateAmbiguity({
    type: state.type,
    components: topologyComponents(state),
    facts: state.facts,
    rounds: state.rounds,
    threshold: state.threshold,
    topologyStatus: state.topologyStatus,
    autoAnsweredRounds: state.autoAnsweredRounds,
  });
  return copyState(state, {
    ambiguity: metrics.effective,
    reportedAmbiguity: metrics.reported,
    ambiguityFloor: metrics.floorBreakdown,
    band: metrics.band,
  });
}

export function scoredRounds(state) {
  return state.rounds.filter((round) => round.lifecycle === 'scored');
}

export function hasPendingWork(state) {
  return state.pendingRound !== null || state.pendingPanel !== null || state.pendingRefinement !== null;
}

export function progressEffect({ state, round = undefined, bandChanged = false, clamped = false, stallDetected = false, escalation = null, weakest = null, triggerSummary = [] }) {
  return effect('report_progress', {
    ...(round === undefined ? {} : { round }),
    reported: state.reportedAmbiguity,
    floor: state.ambiguityFloor.floor,
    effective: state.ambiguity,
    band: state.band,
    bandChanged,
    clamped,
    stallDetected,
    escalation,
    weakest,
    triggerSummary,
  });
}

export function closureAuditReason(state) {
  if (state.hardCapReached) return 'hard-cap';
  if (state.earlyExitRequested) return 'early-exit';
  return 'ready';
}
