#!/usr/bin/env node

// allow: SIZE_OK - the authoritative state machine and its trust boundary form one atomic contract.

import { pathToFileURL } from 'node:url';

const STATE_KEYS = new Set([
  'version', 'phase', 'interviewId', 'declaredType', 'threshold', 'roundCap',
  'softWarningRounds', 'panelCeiling', 'currentRound', 'topology',
  'deferredComponents', 'pendingBaselineComponents', 'askedTarget', 'scoreStateMatrix',
  'coverageByComponent', 'priorBand', 'priorAmbiguity', 'priorRounds',
  'priorBandHistory', 'priorPanelRound', 'panelDispatchCount', 'panelDispatchHistory',
  'closureRejections', 'closureContext', 'hardCapReached', 'streakCounter',
  'degraded', 'scopeChangedSincePanel', 'panelStage', 'pendingPanelPersonas',
  'pendingTarget', 'lastScorerOutput', 'pendingWriteKind', 'writtenSpecPath',
]);

const PHASES = new Set([
  'TOPOLOGY', 'BASELINE', 'ROUND', 'CLOSURE', 'RESTATE', 'WRITE', 'DONE',
  'INCOMPLETE', 'STOPPED',
]);
const BANDS = new Set(['initial', 'progress', 'refined', 'ready']);
const PERSONAS = new Set(['architect', 'researcher', 'contrarian', 'simplifier']);
const PANEL_STAGES = new Set(['none', 'awaiting_dispatch', 'awaiting_results']);
const DIMENSIONS = new Set(['goal', 'constraints', 'criteria', 'context']);
const COVERAGE_TARGET_CATEGORIES = new Set([
  'outcome', 'must_haves', 'must_nots', 'out_of_scope', 'invariants',
  'acceptance_evidence',
]);
const CATEGORY_NAMES = [
  'outcome', 'must_haves', 'must_nots', 'out_of_scope', 'invariants',
  'preferences',
];
const BLOCKING_CATEGORIES = [
  'outcome', 'must_haves', 'must_nots', 'out_of_scope', 'invariants',
];
const CATEGORY_CONFIG = {
  outcome: { prefix: 'O', statuses: new Set(['open', 'confirmed']) },
  must_haves: { prefix: 'M', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  must_nots: { prefix: 'N', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  out_of_scope: { prefix: 'X', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  invariants: { prefix: 'I', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  preferences: { prefix: 'P', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
};
const CATEGORY_KEYS = new Set(['status', 'source', 'source_round', 'items']);
const ITEM_KEYS = new Set(['id', 'text', 'source', 'source_round', 'state', 'supersedes']);
const EVIDENCE_KEYS = new Set(['id', 'verifies', 'type', 'pass_condition', 'source', 'source_round']);
const EVIDENCE_TYPES = new Set(['test', 'inspection', 'observation', 'analysis']);
const TARGET_DIMENSION_KEYS = new Set(['kind', 'component', 'dimension']);
const TARGET_COVERAGE_KEYS = new Set(['kind', 'component', 'category', 'itemId']);
const SCORER_KEYS = new Set([
  'threshold', 'thresholdClamped', 'type', 'perComponent', 'globalAmbiguity',
  'band', 'bandChanged', 'stallDetected', 'ready', 'skipToSpec',
  'nextPanelEligible', 'suppressPanelForOscillation', 'dispatchPanel',
  'panelCooldown', 'scoreClamped', 'validationScoreClamped',
  'negativeAmbiguityClamped', 'coverageGaps', 'streakCounter',
  'forceUserQuestion', 'nextTarget', 'degraded', 'currentRound', 'triggerDelta',
]);
const PER_COMPONENT_KEYS = new Set(['name', 'ambiguity', 'scores', 'firedDims', 'negativeClamped']);
const FIRED_DIM_KEYS = new Set(['dim', 'count', 'delta']);
const RAW_TARGET_KEYS = new Set(['component', 'dimension']);
const FINDING_KEYS = new Set(['persona', 'summary', 'options', 'confidence']);
const PANEL_HISTORY_KEYS = new Set(['round', 'personas', 'panelCooldown']);
const EPSILON = 1e-9;
const THRESHOLD_MIN = 1e-6;
const THRESHOLD_MAX = 0.30;
const INTERVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SPEC_PATH_PATTERN = /^\.omo\/specs\/ulw-interview-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

export class TransitionContractError extends Error {}

function requireCondition(condition) {
  if (!condition) throw new TransitionContractError('invalid contract');
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys) {
  requireCondition(isObject(value));
  const actual = Object.keys(value);
  requireCondition(actual.length === keys.size && actual.every((key) => keys.has(key)));
}

function allowedKeys(value, keys) {
  requireCondition(isObject(value));
  requireCondition(Object.keys(value).every((key) => keys.has(key)));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validSpecPath(value) {
  if (typeof value !== 'string') return false;
  const match = SPEC_PATH_PATTERN.exec(value);
  return match !== null && match[1].length <= 60;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function compareRaw(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function effectiveThreshold(threshold) {
  if (threshold <= THRESHOLD_MIN) return { value: THRESHOLD_MIN, clamped: true };
  if (threshold > THRESHOLD_MAX) return { value: THRESHOLD_MAX, clamped: true };
  return { value: threshold, clamped: false };
}

function panelCountReachable(count, ceiling) {
  if (count === 0 || count === ceiling) return true;
  for (let architectPanels = 0; architectPanels * 4 <= count; architectPanels += 1) {
    if ((count - architectPanels * 4) % 3 === 0) return true;
  }
  return false;
}

function panelBookkeeping(history) {
  return {
    count: history.reduce((total, entry) => total + entry.personas.length, 0),
    lastRound: history.at(-1)?.round ?? -3,
  };
}

function validatePanelDispatchHistory(state) {
  requireCondition(Array.isArray(state.panelDispatchHistory));
  let previousRound = null;
  for (const entry of state.panelDispatchHistory) {
    exactKeys(entry, PANEL_HISTORY_KEYS);
    requireCondition(positiveInteger(entry.round) && entry.round <= state.currentRound);
    validateNameList(entry.personas);
    requireCondition(entry.personas.every((persona) => PERSONAS.has(persona)));
    requireCondition(acknowledgedPersonasAreCanonical(entry.personas));
    requireCondition(entry.panelCooldown === 2);
    if (previousRound !== null) {
      requireCondition(entry.round > previousRound);
      requireCondition(entry.round - previousRound > entry.panelCooldown);
    }
    previousRound = entry.round;
  }
  const bookkeeping = panelBookkeeping(state.panelDispatchHistory);
  requireCondition(state.panelDispatchCount === bookkeeping.count);
  requireCondition(state.priorPanelRound === bookkeeping.lastRound);
}

function validateNameList(value) {
  requireCondition(Array.isArray(value));
  requireCondition(value.every(nonEmptyString));
  requireCondition(new Set(value).size === value.length);
}

function requiredDimensions(type) {
  return type === 'brownfield'
    ? ['goal', 'constraints', 'criteria', 'context']
    : ['goal', 'constraints', 'criteria'];
}

function validateScores(scores, type) {
  exactKeys(scores, new Set(requiredDimensions(type)));
  for (const score of Object.values(scores)) {
    requireCondition(finiteNumber(score) && score >= 0 && score <= 1);
  }
}

function validateTarget(target, type, activeNames) {
  requireCondition(isObject(target));
  requireCondition(activeNames.has(target.component));
  if (target.kind === 'dimension') {
    exactKeys(target, TARGET_DIMENSION_KEYS);
    requireCondition(requiredDimensions(type).includes(target.dimension));
    return;
  }
  requireCondition(target.kind === 'coverage');
  exactKeys(target, TARGET_COVERAGE_KEYS);
  requireCondition(COVERAGE_TARGET_CATEGORIES.has(target.category));
  requireCondition(target.itemId === null || nonEmptyString(target.itemId));
}

function validateCategory(name, category, committedRound) {
  exactKeys(category, CATEGORY_KEYS);
  const config = CATEGORY_CONFIG[name];
  requireCondition(config.statuses.has(category.status));
  requireCondition(Array.isArray(category.items));
  const activeCount = category.items.filter((item) => isObject(item) && item.state === 'active').length;
  if (category.status === 'open') {
    requireCondition(category.source === null && category.source_round === null && activeCount === 0);
  } else {
    requireCondition(category.source === 'user');
    requireCondition(nonNegativeInteger(category.source_round) && category.source_round <= committedRound);
    if (category.status === 'confirmed') {
      requireCondition(name === 'outcome' ? activeCount === 1 : activeCount > 0);
    } else {
      requireCondition(activeCount === 0);
    }
  }

  const idPattern = new RegExp(`^${config.prefix}[1-9][0-9]*$`);
  const byId = new Map();
  for (const item of category.items) {
    exactKeys(item, ITEM_KEYS);
    requireCondition(idPattern.test(item.id) && !byId.has(item.id));
    requireCondition(nonEmptyString(item.text));
    requireCondition(item.source === 'user');
    requireCondition(nonNegativeInteger(item.source_round) && item.source_round <= committedRound);
    requireCondition(item.state === 'active' || item.state === 'superseded');
    requireCondition(item.supersedes === null || typeof item.supersedes === 'string');
    byId.set(item.id, item);
  }

  const replacementCounts = new Map();
  for (const item of category.items) {
    if (item.supersedes === null) continue;
    const replaced = byId.get(item.supersedes);
    requireCondition(replaced !== undefined && replaced.state === 'superseded');
    requireCondition(Number(item.id.slice(1)) > Number(item.supersedes.slice(1)));
    replacementCounts.set(item.supersedes, (replacementCounts.get(item.supersedes) ?? 0) + 1);
  }
  for (const item of category.items) {
    if (item.state !== 'superseded') continue;
    const replacementCount = replacementCounts.get(item.id) ?? 0;
    requireCondition(replacementCount <= 1);
    requireCondition(replacementCount === 1 || category.status === 'explicit_none');
  }
}

function validateCoverage(value, committedRound) {
  exactKeys(value, new Set(['coverage', 'acceptance_evidence']));
  exactKeys(value.coverage, new Set(CATEGORY_NAMES));
  const itemIds = new Set();
  const eligibleEvidenceIds = new Set();
  for (const categoryName of CATEGORY_NAMES) {
    const category = value.coverage[categoryName];
    validateCategory(categoryName, category, committedRound);
    for (const item of category.items) {
      requireCondition(!itemIds.has(item.id));
      itemIds.add(item.id);
      if (['must_haves', 'must_nots', 'invariants'].includes(categoryName)) {
        eligibleEvidenceIds.add(item.id);
      }
    }
  }

  requireCondition(Array.isArray(value.acceptance_evidence));
  const evidenceIds = new Set();
  for (const evidence of value.acceptance_evidence) {
    exactKeys(evidence, EVIDENCE_KEYS);
    requireCondition(/^E[1-9][0-9]*$/.test(evidence.id) && !evidenceIds.has(evidence.id));
    evidenceIds.add(evidence.id);
    requireCondition(Array.isArray(evidence.verifies) && evidence.verifies.length > 0);
    requireCondition(new Set(evidence.verifies).size === evidence.verifies.length);
    requireCondition(evidence.verifies.every((id) => eligibleEvidenceIds.has(id)));
    requireCondition(EVIDENCE_TYPES.has(evidence.type));
    requireCondition(nonEmptyString(evidence.pass_condition));
    requireCondition(evidence.source === 'user');
    requireCondition(nonNegativeInteger(evidence.source_round) && evidence.source_round <= committedRound);
  }
}

function validateGlobalIds(coverageByComponent) {
  const ids = new Set();
  for (const value of Object.values(coverageByComponent)) {
    for (const category of Object.values(value.coverage)) {
      for (const item of category.items) {
        requireCondition(!ids.has(item.id));
        ids.add(item.id);
      }
    }
    for (const evidence of value.acceptance_evidence) {
      requireCondition(!ids.has(evidence.id));
      ids.add(evidence.id);
    }
  }
}

function expectedBand(ambiguity, threshold) {
  if (ambiguity > 0.60 + EPSILON) return 'initial';
  if (ambiguity > 0.30 + EPSILON) return 'progress';
  if (ambiguity > threshold + EPSILON) return 'refined';
  return 'ready';
}

function expectedStall(priorRounds, ambiguity) {
  const values = [...priorRounds, ambiguity];
  if (values.length < 3) return false;
  const window = values.slice(-3);
  return Math.max(...window) - Math.min(...window) <= 0.05 + EPSILON;
}

function expectedPanelSuppression(priorBandHistory, band) {
  const history = [...priorBandHistory, band];
  if (history.length < 5) return false;
  const transitions = [];
  for (let index = 1; index < history.length; index += 1) {
    if (history[index] === history[index - 1]) continue;
    transitions.push([history[index - 1], history[index]].sort().join('|'));
  }
  const counts = new Map();
  for (const transition of transitions.slice(-4)) {
    counts.set(transition, (counts.get(transition) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 2);
}

function validateScorerOutput(output, state, expectedRound) {
  exactKeys(output, SCORER_KEYS);
  requireCondition(finiteNumber(output.threshold));
  requireCondition(output.type === state.declaredType);
  requireCondition(output.currentRound === expectedRound);
  for (const key of [
    'thresholdClamped', 'bandChanged', 'stallDetected', 'ready', 'skipToSpec',
    'nextPanelEligible', 'suppressPanelForOscillation', 'dispatchPanel',
    'scoreClamped', 'validationScoreClamped', 'negativeAmbiguityClamped',
    'forceUserQuestion', 'degraded',
  ]) requireCondition(typeof output[key] === 'boolean');
  requireCondition(BANDS.has(output.band));
  requireCondition(Array.isArray(output.perComponent));
  requireCondition(Array.isArray(output.coverageGaps) && output.coverageGaps.every((gap) => typeof gap === 'string'));
  requireCondition(nonNegativeInteger(output.streakCounter));
  requireCondition(output.panelCooldown === 2 && output.triggerDelta === -0.15);
  const threshold = effectiveThreshold(state.threshold);
  requireCondition(output.threshold === threshold.value);
  requireCondition(output.thresholdClamped === threshold.clamped);

  const activeNames = new Set(state.topology);
  const outputNames = new Set();
  const dimensions = requiredDimensions(state.declaredType);
  const weights = state.declaredType === 'greenfield'
    ? { goal: 0.35, constraints: 0.35, criteria: 0.30 }
    : { goal: 0.30, constraints: 0.30, criteria: 0.25, context: 0.15 };
  for (const component of output.perComponent) {
    exactKeys(component, PER_COMPONENT_KEYS);
    requireCondition(activeNames.has(component.name) && !outputNames.has(component.name));
    outputNames.add(component.name);
    requireCondition(finiteNumber(component.ambiguity) && component.ambiguity >= 0 && component.ambiguity <= 1);
    validateScores(component.scores, state.declaredType);
    requireCondition(Array.isArray(component.firedDims));
    for (const fired of component.firedDims) {
      exactKeys(fired, FIRED_DIM_KEYS);
      requireCondition(dimensions.includes(fired.dim));
      requireCondition(positiveInteger(fired.count) && fired.delta === -0.15 * fired.count);
    }
    requireCondition(typeof component.negativeClamped === 'boolean');
    const clarity = dimensions.reduce((sum, dimension) => sum + component.scores[dimension] * weights[dimension], 0);
    const ambiguity = Math.max(0, Math.min(1, 1 - clarity));
    requireCondition(Math.abs(component.ambiguity - ambiguity) <= EPSILON);
  }
  requireCondition(sameSet(outputNames, activeNames));
  requireCondition(output.perComponent.length > 0);

  const globalAmbiguity = Math.max(...output.perComponent.map((component) => component.ambiguity));
  requireCondition(output.threshold >= THRESHOLD_MIN && output.threshold <= THRESHOLD_MAX);
  requireCondition(Math.abs(output.globalAmbiguity - globalAmbiguity) <= EPSILON);
  requireCondition(output.band === expectedBand(output.globalAmbiguity, output.threshold));
  const ready = output.perComponent.every((component) => component.ambiguity <= output.threshold + EPSILON)
    && output.globalAmbiguity <= output.threshold + EPSILON;
  requireCondition(output.ready === ready);
  const allHigh = output.perComponent.every((component) => dimensions.every(
    (dimension) => component.scores[dimension] >= 0.9 - EPSILON,
  ));
  requireCondition(output.skipToSpec === (ready && allHigh));
  requireCondition(output.dispatchPanel === (
    !output.ready && output.nextPanelEligible && !output.suppressPanelForOscillation && output.bandChanged
  ));
  requireCondition(output.validationScoreClamped === false || output.scoreClamped);
  requireCondition(output.negativeAmbiguityClamped === output.perComponent.some((component) => component.negativeClamped));
  requireCondition(output.forceUserQuestion === (output.streakCounter >= 3));
  const expectedCoverageGaps = output.perComponent.flatMap((component) => dimensions.flatMap((dimension) => (
    component.scores[dimension] < 0.9 - EPSILON
      ? [`${component.name}/${dimension}: ${component.scores[dimension].toFixed(3)} < 0.9`]
      : []
  )));
  requireCondition(sameJson(output.coverageGaps, expectedCoverageGaps));

  exactKeys(output.nextTarget, RAW_TARGET_KEYS);
  requireCondition(activeNames.has(output.nextTarget.component));
  requireCondition(dimensions.includes(output.nextTarget.dimension));
  const worst = [...output.perComponent].sort((left, right) => {
    if (right.ambiguity !== left.ambiguity) return right.ambiguity - left.ambiguity;
    return compareRaw(left.name, right.name);
  })[0];
  const nextDimension = [...dimensions].sort((left, right) => {
    if (worst.scores[left] !== worst.scores[right]) return worst.scores[left] - worst.scores[right];
    return compareRaw(left, right);
  })[0];
  requireCondition(output.nextTarget.component === worst.name && output.nextTarget.dimension === nextDimension);
}

function validateScorerPriorContext(output, state, expectedRound) {
  requireCondition(output.bandChanged === (state.priorBand === null || state.priorBand !== output.band));
  requireCondition(output.stallDetected === expectedStall(state.priorRounds, output.globalAmbiguity));
  requireCondition(output.nextPanelEligible === (expectedRound - state.priorPanelRound > 2));
  requireCondition(output.suppressPanelForOscillation === expectedPanelSuppression(state.priorBandHistory, output.band));
}

function validateStoredScorerHistory(output, state) {
  const priorRounds = state.priorRounds.slice(0, -1);
  const priorBands = state.priorBandHistory.slice(0, -1);
  const priorBand = priorBands.at(-1) ?? null;
  requireCondition(output.bandChanged === (priorBand === null || priorBand !== output.band));
  requireCondition(output.stallDetected === expectedStall(priorRounds, output.globalAmbiguity));
  requireCondition(output.suppressPanelForOscillation === expectedPanelSuppression(priorBands, output.band));
  if (state.panelDispatchCount > 0 && state.priorPanelRound === state.currentRound) {
    requireCondition(output.nextPanelEligible && output.dispatchPanel);
  } else {
    requireCondition(output.nextPanelEligible === (
      state.currentRound - state.priorPanelRound > output.panelCooldown
    ));
  }
}

function validateState(state) {
  exactKeys(state, STATE_KEYS);
  requireCondition(state.version === 1 && PHASES.has(state.phase));
  requireCondition(typeof state.interviewId === 'string' && INTERVIEW_ID_PATTERN.test(state.interviewId));
  requireCondition(state.declaredType === 'greenfield' || state.declaredType === 'brownfield');
  requireCondition(finiteNumber(state.threshold));
  requireCondition(positiveInteger(state.roundCap));
  requireCondition(positiveInteger(state.softWarningRounds));
  requireCondition(positiveInteger(state.panelCeiling));
  requireCondition(nonNegativeInteger(state.currentRound) && state.currentRound <= state.roundCap);
  validateNameList(state.topology);
  validateNameList(state.deferredComponents);
  requireCondition(state.topology.length <= 6);
  const activeNames = new Set(state.topology);
  const deferredNames = new Set(state.deferredComponents);
  requireCondition([...activeNames].every((name) => !deferredNames.has(name)));
  validateNameList(state.pendingBaselineComponents);
  requireCondition(sameJson(state.pendingBaselineComponents, [...state.pendingBaselineComponents].sort(compareRaw)));
  const pendingBaselineNames = new Set(state.pendingBaselineComponents);
  requireCondition([...pendingBaselineNames].every((name) => activeNames.has(name)));
  if (pendingBaselineNames.size > 0) {
    requireCondition(['BASELINE', 'WRITE', 'INCOMPLETE', 'STOPPED'].includes(state.phase));
  }
  const knownNames = new Set([...state.topology, ...state.deferredComponents]);
  exactKeys(state.scoreStateMatrix, knownNames);
  exactKeys(state.coverageByComponent, knownNames);
  for (const name of knownNames) {
    const scores = state.scoreStateMatrix[name];
    requireCondition(scores === null || isObject(scores));
    if (activeNames.has(name)) requireCondition((scores === null) === pendingBaselineNames.has(name));
    if (scores !== null) validateScores(scores, state.declaredType);
    validateCoverage(state.coverageByComponent[name], state.currentRound);
  }
  validateGlobalIds(state.coverageByComponent);

  requireCondition(state.priorBand === null || BANDS.has(state.priorBand));
  requireCondition(state.priorAmbiguity === null || (
    finiteNumber(state.priorAmbiguity) && state.priorAmbiguity >= 0 && state.priorAmbiguity <= 1
  ));
  requireCondition(Array.isArray(state.priorRounds) && state.priorRounds.every(
    (ambiguity) => finiteNumber(ambiguity) && ambiguity >= 0 && ambiguity <= 1,
  ));
  requireCondition(Array.isArray(state.priorBandHistory) && state.priorBandHistory.every((band) => BANDS.has(band)));
  requireCondition(state.priorRounds.length === state.priorBandHistory.length);
  const threshold = effectiveThreshold(state.threshold).value;
  requireCondition(state.priorRounds.every(
    (ambiguity, index) => state.priorBandHistory[index] === expectedBand(ambiguity, threshold),
  ));
  const hasScoreHistory = state.priorAmbiguity !== null;
  requireCondition(hasScoreHistory === (state.priorBand !== null));
  if (hasScoreHistory) {
    requireCondition(state.priorRounds.length === state.currentRound + 1);
    requireCondition(state.priorRounds.at(-1) === state.priorAmbiguity);
    requireCondition(state.priorBandHistory.at(-1) === state.priorBand);
  } else {
    requireCondition(state.priorRounds.length === 0);
  }
  requireCondition(Number.isInteger(state.priorPanelRound));
  requireCondition(state.priorPanelRound <= state.currentRound);
  requireCondition(nonNegativeInteger(state.panelDispatchCount) && state.panelDispatchCount <= state.panelCeiling);
  validatePanelDispatchHistory(state);
  requireCondition(panelCountReachable(state.panelDispatchCount, state.panelCeiling));
  requireCondition(state.panelDispatchCount <= 4 * state.currentRound);
  requireCondition(state.panelDispatchCount === 0
    ? state.priorPanelRound === -3
    : state.priorPanelRound >= 1);
  requireCondition(nonNegativeInteger(state.closureRejections) && state.closureRejections <= 2);
  if (state.closureRejections === 2) {
    requireCondition(state.phase === 'WRITE' || state.phase === 'INCOMPLETE');
  }
  requireCondition(typeof state.hardCapReached === 'boolean');
  if (state.hardCapReached) {
    requireCondition(state.currentRound === state.roundCap);
    requireCondition(['RESTATE', 'WRITE', 'DONE', 'INCOMPLETE', 'STOPPED'].includes(state.phase));
  }
  requireCondition(nonNegativeInteger(state.streakCounter));
  requireCondition(typeof state.degraded === 'boolean');
  requireCondition(typeof state.scopeChangedSincePanel === 'boolean');
  requireCondition(PANEL_STAGES.has(state.panelStage));
  requireCondition(Array.isArray(state.pendingPanelPersonas));
  requireCondition(state.pendingPanelPersonas.every((persona) => PERSONAS.has(persona)));
  requireCondition(new Set(state.pendingPanelPersonas).size === state.pendingPanelPersonas.length);
  requireCondition(state.pendingWriteKind === null || state.pendingWriteKind === 'complete' || state.pendingWriteKind === 'incomplete');
  requireCondition(state.writtenSpecPath === null || validSpecPath(state.writtenSpecPath));

  if (state.askedTarget !== null) validateTarget(state.askedTarget, state.declaredType, activeNames);
  if (state.pendingTarget !== null) validateTarget(state.pendingTarget, state.declaredType, activeNames);
  if (state.panelStage === 'none') {
    requireCondition(state.pendingPanelPersonas.length === 0 && state.pendingTarget === null);
  } else if (state.panelStage === 'awaiting_dispatch') {
    requireCondition(state.askedTarget === null && state.pendingPanelPersonas.length > 0 && state.pendingTarget !== null);
  } else {
    requireCondition(state.askedTarget === null && state.pendingPanelPersonas.length > 0 && state.pendingTarget !== null);
  }
  requireCondition(state.phase === 'ROUND' || state.panelStage === 'none');
  if (state.phase === 'ROUND') {
    requireCondition(state.currentRound < state.roundCap);
    requireCondition(state.panelStage === 'none' ? state.askedTarget !== null : state.askedTarget === null);
  } else {
    requireCondition(state.askedTarget === null);
  }

  if (state.phase === 'CLOSURE') {
    exactKeys(state.closureContext, new Set(['hardCap', 'earlyExit']));
    requireCondition(typeof state.closureContext.hardCap === 'boolean');
    requireCondition(typeof state.closureContext.earlyExit === 'boolean');
    requireCondition(!(state.closureContext.hardCap && state.closureContext.earlyExit));
    requireCondition(!state.closureContext.hardCap || state.currentRound >= state.roundCap);
    requireCondition(state.closureContext.hardCap === (state.currentRound === state.roundCap));
  } else {
    requireCondition(state.closureContext === null);
  }
  requireCondition(state.phase === 'WRITE' ? state.pendingWriteKind !== null : state.pendingWriteKind === null);
  const completedHardCapPhase = state.currentRound === state.roundCap && (
    state.phase === 'RESTATE'
    || state.phase === 'DONE'
    || (state.phase === 'WRITE' && state.pendingWriteKind === 'complete')
  );
  if (completedHardCapPhase) requireCondition(state.hardCapReached);
  if (state.phase === 'DONE' || state.phase === 'INCOMPLETE') requireCondition(nonEmptyString(state.writtenSpecPath));
  if (hasScoreHistory && state.phase !== 'BASELINE') {
    requireCondition(state.topology.every(
      (name) => state.scoreStateMatrix[name] !== null || pendingBaselineNames.has(name),
    ));
  }
  if (state.lastScorerOutput !== null) {
    validateScorerOutput(state.lastScorerOutput, state, state.currentRound);
    validateStoredScorerHistory(state.lastScorerOutput, state);
    requireCondition(state.lastScorerOutput.globalAmbiguity === state.priorAmbiguity);
    requireCondition(state.lastScorerOutput.band === state.priorBand);
    requireCondition(!state.lastScorerOutput.degraded || state.degraded);
    requireCondition(state.streakCounter === state.lastScorerOutput.streakCounter);
    for (const component of state.lastScorerOutput.perComponent) {
      requireCondition(sameJson(state.scoreStateMatrix[component.name], component.scores));
    }
  }
  if (hasScoreHistory && state.phase !== 'BASELINE' && pendingBaselineNames.size === 0) {
    requireCondition(state.lastScorerOutput !== null);
  }
  if (state.panelStage !== 'none') {
    requireCondition(state.lastScorerOutput !== null && state.lastScorerOutput.dispatchPanel);
    requireCondition(sameJson(state.pendingTarget, dimensionTarget(state.lastScorerOutput.nextTarget)));
    if (state.panelStage === 'awaiting_dispatch') {
      requireCondition(sameJson(state.pendingPanelPersonas, selectPanelPersonas(state)));
      requireCondition(state.currentRound - state.priorPanelRound > state.lastScorerOutput.panelCooldown);
    } else {
      requireCondition(state.panelDispatchCount > 0);
      requireCondition(state.priorPanelRound === state.currentRound);
      requireCondition(state.scopeChangedSincePanel === false);
      requireCondition(acknowledgedPersonasAreCanonical(state.pendingPanelPersonas));
      requireCondition(state.panelDispatchCount >= state.pendingPanelPersonas.length);
    }
  }
}

function openCoverage() {
  return {
    coverage: Object.fromEntries(CATEGORY_NAMES.map((name) => [name, {
      status: 'open', source: null, source_round: null, items: [],
    }])),
    acceptance_evidence: [],
  };
}

function semanticGaps(state, scorerOutput = state.lastScorerOutput) {
  const ambiguityByComponent = new Map(
    (scorerOutput?.perComponent ?? []).map((component) => [component.name, component.ambiguity]),
  );
  const componentNames = [...state.topology].sort((left, right) => {
    const ambiguityDifference = (ambiguityByComponent.get(right) ?? -1) - (ambiguityByComponent.get(left) ?? -1);
    return ambiguityDifference || compareRaw(left, right);
  });
  const gaps = [];
  for (const component of componentNames) {
    const value = state.coverageByComponent[component];
    for (const category of BLOCKING_CATEGORIES) {
      if (value.coverage[category].status === 'open') {
        gaps.push({ component, category, itemId: null, reason: 'open' });
      }
    }
    const linkedIds = new Set(value.acceptance_evidence.flatMap((evidence) => evidence.verifies));
    const missingIds = ['must_haves', 'must_nots', 'invariants']
      .flatMap((category) => value.coverage[category].items)
      .filter((item) => item.state === 'active' && !linkedIds.has(item.id))
      .map((item) => item.id)
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)) || compareRaw(left, right));
    for (const itemId of missingIds) {
      gaps.push({ component, category: 'acceptance_evidence', itemId, reason: 'missing_evidence' });
    }
  }
  return gaps;
}

function dimensionTarget(rawTarget) {
  return {
    kind: 'dimension',
    component: rawTarget.component,
    dimension: rawTarget.dimension,
  };
}

function chooseTarget(state, scorerOutput) {
  const gaps = semanticGaps(state, scorerOutput);
  if (gaps.length > 0) {
    const gap = gaps[0];
    return {
      kind: 'coverage',
      component: gap.component,
      category: gap.category,
      itemId: gap.itemId,
    };
  }
  return dimensionTarget(scorerOutput.nextTarget);
}

function compareCoverageHistory(previous, current) {
  for (const categoryName of CATEGORY_NAMES) {
    const previousCategory = previous.coverage[categoryName];
    const currentCategory = current.coverage[categoryName];
    requireCondition(currentCategory.items.length >= previousCategory.items.length);
    for (const [index, previousItem] of previousCategory.items.entries()) {
      const currentItem = currentCategory.items[index];
      for (const key of ['id', 'text', 'source', 'source_round', 'supersedes']) {
        requireCondition(currentItem[key] === previousItem[key]);
      }
      requireCondition(
        currentItem.state === previousItem.state
        || (previousItem.state === 'active' && currentItem.state === 'superseded'),
      );
    }
  }
  requireCondition(current.acceptance_evidence.length >= previous.acceptance_evidence.length);
  for (const [index, previousEntry] of previous.acceptance_evidence.entries()) {
    requireCondition(sameJson(current.acceptance_evidence[index], previousEntry));
  }
}

function validateSnapshot(state, snapshot, context) {
  const knownNames = new Set([...state.topology, ...state.deferredComponents]);
  exactKeys(snapshot, knownNames);
  for (const name of knownNames) {
    validateCoverage(snapshot[name], context.committedRound);
    compareCoverageHistory(state.coverageByComponent[name], snapshot[name]);
    if (!context.mutableComponents.has(name)) {
      requireCondition(sameJson(snapshot[name], state.coverageByComponent[name]));
    }
  }
  validateGlobalIds(snapshot);
}

function clearPanel(state) {
  state.panelStage = 'none';
  state.pendingPanelPersonas = [];
  state.pendingTarget = null;
  state.scopeChangedSincePanel = false;
}

function selectPanelPersonas(state) {
  const personas = state.scopeChangedSincePanel
    ? ['architect', 'researcher', 'contrarian', 'simplifier']
    : ['researcher', 'contrarian', 'simplifier'];
  return personas.slice(0, state.panelCeiling - state.panelDispatchCount);
}

function acknowledgedPersonasAreCanonical(personas) {
  const canonical = personas[0] === 'architect'
    ? ['architect', 'researcher', 'contrarian', 'simplifier']
    : ['researcher', 'contrarian', 'simplifier'];
  return sameJson(personas, canonical.slice(0, personas.length));
}

function enterWrite(state, kind) {
  state.phase = 'WRITE';
  state.askedTarget = null;
  state.closureContext = null;
  state.pendingWriteKind = kind;
  clearPanel(state);
}

function validateFinding(finding) {
  exactKeys(finding, FINDING_KEYS);
  requireCondition(PERSONAS.has(finding.persona));
  requireCondition(typeof finding.summary === 'string');
  requireCondition(Array.isArray(finding.options) && finding.options.every((option) => typeof option === 'string'));
  requireCondition(finding.confidence === 'high' || finding.confidence === 'medium' || finding.confidence === 'low');
}

function validateRefineOutput(value, askedTarget) {
  if (askedTarget.kind === 'coverage') {
    requireCondition(value === null);
    return;
  }
  exactKeys(value, new Set(['shouldRefine', 'reason', 'target']));
  requireCondition(typeof value.shouldRefine === 'boolean' && typeof value.reason === 'string');
  if (value.shouldRefine) {
    requireCondition(value.target === askedTarget.dimension);
  } else {
    requireCondition(value.target === null);
  }
}

function validateAction(action) {
  exactKeys(action, new Set(['type', 'payload']));
  const emptyActions = new Set([
    'confirm_topology', 'await_panel_results', 'confirm_intent_contract', 'stop',
  ]);
  if (emptyActions.has(action.type)) {
    exactKeys(action.payload, new Set());
    return;
  }
  const payloadKeys = {
    run_baseline: new Set(['components']),
    dispatch_panel: new Set(['personas']),
    score_answer: new Set(['target']),
    write_spec: new Set(['kind']),
    offer_post_spec: new Set(['specPath', 'allowContinue']),
    start_planning: new Set(['specPath']),
  };
  if (action.type === 'ask_target') {
    allowedKeys(action.payload, new Set(['target', 'refine', 'findings']));
    requireCondition('target' in action.payload);
    return;
  }
  if (action.type === 'run_closure') {
    allowedKeys(action.payload, new Set(['hardCap', 'earlyExit']));
    return;
  }
  requireCondition(action.type in payloadKeys);
  exactKeys(action.payload, payloadKeys[action.type]);
}

function result(state, action) {
  validateState(state);
  validateAction(action);
  return {
    state: structuredClone(state),
    action: structuredClone(action),
    semanticCoverageGaps: structuredClone(semanticGaps(state)),
  };
}

function initializeTransition(payload) {
  exactKeys(payload, new Set([
    'interviewId', 'declaredType', 'threshold', 'roundCap', 'softWarningRounds',
    'panelCeiling',
  ]));
  requireCondition(typeof payload.interviewId === 'string' && INTERVIEW_ID_PATTERN.test(payload.interviewId));
  requireCondition(payload.declaredType === 'greenfield' || payload.declaredType === 'brownfield');
  requireCondition(finiteNumber(payload.threshold));
  requireCondition(positiveInteger(payload.roundCap));
  requireCondition(positiveInteger(payload.softWarningRounds));
  requireCondition(positiveInteger(payload.panelCeiling));
  const state = {
    version: 1,
    phase: 'TOPOLOGY',
    interviewId: payload.interviewId,
    declaredType: payload.declaredType,
    threshold: payload.threshold,
    roundCap: payload.roundCap,
    softWarningRounds: payload.softWarningRounds,
    panelCeiling: payload.panelCeiling,
    currentRound: 0,
    topology: [],
    deferredComponents: [],
    pendingBaselineComponents: [],
    askedTarget: null,
    scoreStateMatrix: {},
    coverageByComponent: {},
    priorBand: null,
    priorAmbiguity: null,
    priorRounds: [],
    priorBandHistory: [],
    priorPanelRound: -3,
    panelDispatchCount: 0,
    panelDispatchHistory: [],
    closureRejections: 0,
    closureContext: null,
    hardCapReached: false,
    streakCounter: 0,
    degraded: false,
    scopeChangedSincePanel: false,
    panelStage: 'none',
    pendingPanelPersonas: [],
    pendingTarget: null,
    lastScorerOutput: null,
    pendingWriteKind: null,
    writtenSpecPath: null,
  };
  return result(state, { type: 'confirm_topology', payload: {} });
}

function topologyConfirmed(state, payload) {
  exactKeys(payload, new Set(['activeComponents', 'deferredComponents']));
  validateNameList(payload.activeComponents);
  validateNameList(payload.deferredComponents);
  requireCondition(payload.activeComponents.length >= 1 && payload.activeComponents.length <= 6);
  const activeNames = new Set(payload.activeComponents);
  const deferredNames = new Set(payload.deferredComponents);
  requireCondition([...activeNames].every((name) => !deferredNames.has(name)));
  const previousKnown = new Set([...state.topology, ...state.deferredComponents]);
  const nextKnown = new Set([...payload.activeComponents, ...payload.deferredComponents]);
  requireCondition([...previousKnown].every((name) => nextKnown.has(name)));

  const previousActive = new Set(state.topology);
  const previousDeferred = new Set(state.deferredComponents);
  const next = structuredClone(state);
  for (const name of nextKnown) {
    if (!(name in next.coverageByComponent)) next.coverageByComponent[name] = openCoverage();
    if (!(name in next.scoreStateMatrix)) next.scoreStateMatrix[name] = null;
  }
  const baselineComponents = payload.activeComponents.filter(
    (name) => !previousActive.has(name) || previousDeferred.has(name),
  ).sort(compareRaw);
  for (const name of baselineComponents) next.scoreStateMatrix[name] = null;
  next.phase = 'BASELINE';
  next.topology = [...payload.activeComponents];
  next.deferredComponents = [...payload.deferredComponents];
  next.pendingBaselineComponents = baselineComponents;
  next.askedTarget = null;
  next.lastScorerOutput = null;
  const scopeChangedSincePanel = next.scopeChangedSincePanel;
  clearPanel(next);
  next.scopeChangedSincePanel = scopeChangedSincePanel;
  return result(next, { type: 'run_baseline', payload: { components: baselineComponents } });
}

function commitScorer(state, scorerOutput, replaceCurrentHistory) {
  const next = structuredClone(state);
  for (const component of scorerOutput.perComponent) {
    next.scoreStateMatrix[component.name] = structuredClone(component.scores);
  }
  if (replaceCurrentHistory && next.priorRounds.length > 0) {
    next.priorRounds[next.priorRounds.length - 1] = scorerOutput.globalAmbiguity;
    next.priorBandHistory[next.priorBandHistory.length - 1] = scorerOutput.band;
  } else {
    next.priorRounds.push(scorerOutput.globalAmbiguity);
    next.priorBandHistory.push(scorerOutput.band);
  }
  next.priorAmbiguity = scorerOutput.globalAmbiguity;
  next.priorBand = scorerOutput.band;
  next.streakCounter = scorerOutput.streakCounter;
  next.degraded = next.degraded || scorerOutput.degraded;
  next.lastScorerOutput = structuredClone(scorerOutput);
  return next;
}

function baselineScored(state, payload) {
  exactKeys(payload, new Set(['scorerOutput', 'coverageByComponent']));
  validateSnapshot(state, payload.coverageByComponent, {
    committedRound: state.currentRound,
    mutableComponents: new Set(state.pendingBaselineComponents),
  });
  validateScorerOutput(payload.scorerOutput, state, state.currentRound);
  const pendingBaselineNames = new Set(state.pendingBaselineComponents);
  for (const component of payload.scorerOutput.perComponent) {
    if (!pendingBaselineNames.has(component.name)) {
      requireCondition(sameJson(component.scores, state.scoreStateMatrix[component.name]));
    }
  }
  const priorContext = structuredClone(state);
  if (state.priorRounds.length > 0) {
    priorContext.priorRounds = state.priorRounds.slice(0, -1);
    priorContext.priorBandHistory = state.priorBandHistory.slice(0, -1);
    priorContext.priorAmbiguity = priorContext.priorRounds.at(-1) ?? null;
    priorContext.priorBand = priorContext.priorBandHistory.at(-1) ?? null;
  }
  validateScorerPriorContext(payload.scorerOutput, priorContext, state.currentRound);
  const next = commitScorer(state, payload.scorerOutput, state.priorRounds.length > 0);
  next.coverageByComponent = structuredClone(payload.coverageByComponent);
  next.pendingBaselineComponents = [];
  next.phase = 'ROUND';
  next.askedTarget = chooseTarget(next, payload.scorerOutput);
  return result(next, { type: 'ask_target', payload: { target: next.askedTarget } });
}

function roundScored(state, payload) {
  requireCondition(state.panelStage === 'none' && state.askedTarget !== null);
  exactKeys(payload, new Set([
    'scorerOutput', 'refineOutput', 'coverageByComponent', 'scopeExpansion',
    'earlyExitRequested',
  ]));
  requireCondition(typeof payload.earlyExitRequested === 'boolean');
  validateSnapshot(state, payload.coverageByComponent, {
    committedRound: state.currentRound + 1,
    mutableComponents: new Set([state.askedTarget.component]),
  });
  validateScorerOutput(payload.scorerOutput, state, state.currentRound + 1);
  for (const component of payload.scorerOutput.perComponent) {
    if (component.name !== state.askedTarget.component) {
      requireCondition(sameJson(component.scores, state.scoreStateMatrix[component.name]));
    }
  }
  validateScorerPriorContext(payload.scorerOutput, state, state.currentRound + 1);
  validateRefineOutput(payload.refineOutput, state.askedTarget);
  if (payload.scopeExpansion !== null) {
    exactKeys(payload.scopeExpansion, new Set(['newComponents']));
    validateNameList(payload.scopeExpansion.newComponents);
    requireCondition(payload.scopeExpansion.newComponents.length > 0);
    const known = new Set([...state.topology, ...state.deferredComponents]);
    requireCondition(payload.scopeExpansion.newComponents.every((name) => !known.has(name)));
  }

  const priorAskedTarget = structuredClone(state.askedTarget);
  const next = commitScorer(state, payload.scorerOutput, false);
  next.currentRound += 1;
  next.coverageByComponent = structuredClone(payload.coverageByComponent);
  next.askedTarget = null;

  if (next.currentRound >= next.roundCap) {
    next.phase = 'CLOSURE';
    next.closureContext = { hardCap: true, earlyExit: false };
    return result(next, { type: 'run_closure', payload: { hardCap: true } });
  }
  if (payload.scopeExpansion !== null) {
    for (const name of payload.scopeExpansion.newComponents) {
      next.deferredComponents.push(name);
      next.scoreStateMatrix[name] = null;
      next.coverageByComponent[name] = openCoverage();
    }
    next.phase = 'TOPOLOGY';
    next.scopeChangedSincePanel = true;
    return result(next, { type: 'confirm_topology', payload: {} });
  }
  if (payload.earlyExitRequested) {
    if (payload.scorerOutput.globalAmbiguity > effectiveThreshold(next.threshold).value + 0.20) {
      enterWrite(next, 'incomplete');
      return result(next, { type: 'write_spec', payload: { kind: 'incomplete' } });
    }
    next.phase = 'CLOSURE';
    next.closureContext = { hardCap: false, earlyExit: true };
    return result(next, { type: 'run_closure', payload: { earlyExit: true } });
  }

  const gaps = semanticGaps(next, payload.scorerOutput);
  if (gaps.length > 0) {
    next.askedTarget = chooseTarget(next, payload.scorerOutput);
    return result(next, { type: 'ask_target', payload: { target: next.askedTarget } });
  }
  if (payload.scorerOutput.ready) {
    next.phase = 'CLOSURE';
    next.closureContext = { hardCap: false, earlyExit: false };
    return result(next, { type: 'run_closure', payload: {} });
  }
  const scorerTarget = dimensionTarget(payload.scorerOutput.nextTarget);
  if (payload.scorerOutput.dispatchPanel && next.panelDispatchCount < next.panelCeiling) {
    const selected = selectPanelPersonas(next);
    if (selected.length > 0) {
      next.pendingTarget = scorerTarget;
      next.pendingPanelPersonas = selected;
      next.panelStage = 'awaiting_dispatch';
      return result(next, { type: 'dispatch_panel', payload: { personas: selected } });
    }
  }
  if (payload.refineOutput?.shouldRefine && priorAskedTarget.kind === 'dimension') {
    next.askedTarget = priorAskedTarget;
    return result(next, { type: 'ask_target', payload: { target: next.askedTarget, refine: true } });
  }
  next.askedTarget = scorerTarget;
  return result(next, { type: 'ask_target', payload: { target: next.askedTarget } });
}

function panelDispatched(state, payload) {
  requireCondition(state.panelStage === 'awaiting_dispatch');
  exactKeys(payload, new Set(['personas']));
  requireCondition(sameJson(payload.personas, state.pendingPanelPersonas));
  const next = structuredClone(state);
  next.panelDispatchHistory.push({
    round: next.currentRound,
    personas: structuredClone(payload.personas),
    panelCooldown: next.lastScorerOutput.panelCooldown,
  });
  const bookkeeping = panelBookkeeping(next.panelDispatchHistory);
  next.panelDispatchCount = bookkeeping.count;
  requireCondition(next.panelDispatchCount <= next.panelCeiling);
  next.priorPanelRound = bookkeeping.lastRound;
  if (payload.personas.includes('architect')) next.scopeChangedSincePanel = false;
  next.panelStage = 'awaiting_results';
  return result(next, { type: 'await_panel_results', payload: {} });
}

function panelCompleted(state, payload) {
  requireCondition(state.panelStage === 'awaiting_results' && state.pendingTarget !== null);
  exactKeys(payload, new Set(['findings']));
  requireCondition(Array.isArray(payload.findings));
  payload.findings.forEach(validateFinding);
  requireCondition(payload.findings.length === state.pendingPanelPersonas.length);
  requireCondition(payload.findings.every(
    (finding, index) => finding.persona === state.pendingPanelPersonas[index],
  ));
  const next = structuredClone(state);
  const target = structuredClone(next.pendingTarget);
  next.askedTarget = target;
  clearPanel(next);
  return result(next, {
    type: 'ask_target',
    payload: { target, findings: structuredClone(payload.findings) },
  });
}

function closurePassed(state, payload) {
  exactKeys(payload, new Set());
  requireCondition(semanticGaps(state).length === 0);
  const next = structuredClone(state);
  next.hardCapReached = next.closureContext.hardCap;
  next.closureContext = null;
  next.phase = 'RESTATE';
  return result(next, { type: 'confirm_intent_contract', payload: {} });
}

function closureRejected(state, payload) {
  exactKeys(payload, new Set(['reason', 'target']));
  requireCondition(nonEmptyString(payload.reason));
  validateTarget(payload.target, state.declaredType, new Set(state.topology));
  const next = structuredClone(state);
  const hardCap = next.closureContext.hardCap;
  next.closureRejections += 1;
  next.closureContext = null;
  if (hardCap || next.closureRejections >= 2) {
    enterWrite(next, 'incomplete');
    return result(next, { type: 'write_spec', payload: { kind: 'incomplete' } });
  }
  next.phase = 'ROUND';
  next.askedTarget = structuredClone(payload.target);
  return result(next, { type: 'ask_target', payload: { target: next.askedTarget } });
}

function restateConfirmed(state, payload) {
  exactKeys(payload, new Set());
  const next = structuredClone(state);
  enterWrite(next, 'complete');
  return result(next, { type: 'write_spec', payload: { kind: 'complete' } });
}

function restateCorrected(state, payload) {
  exactKeys(payload, new Set(['target']));
  validateTarget(payload.target, state.declaredType, new Set(state.topology));
  const next = structuredClone(state);
  if (next.hardCapReached) {
    enterWrite(next, 'incomplete');
    return result(next, { type: 'write_spec', payload: { kind: 'incomplete' } });
  }
  next.phase = 'ROUND';
  next.askedTarget = structuredClone(payload.target);
  return result(next, { type: 'score_answer', payload: { target: next.askedTarget } });
}

function specWritten(state, payload) {
  exactKeys(payload, new Set(['kind', 'path']));
  requireCondition(payload.kind === state.pendingWriteKind && validSpecPath(payload.path));
  const next = structuredClone(state);
  const kind = next.pendingWriteKind;
  next.writtenSpecPath = payload.path;
  next.pendingWriteKind = null;
  if (kind === 'complete') {
    next.phase = 'DONE';
    return result(next, {
      type: 'offer_post_spec',
      payload: { specPath: payload.path, allowContinue: !next.hardCapReached },
    });
  }
  next.phase = 'INCOMPLETE';
  return result(next, { type: 'stop', payload: {} });
}

function continueInterview(state, payload) {
  exactKeys(payload, new Set());
  requireCondition(!state.hardCapReached && state.lastScorerOutput !== null);
  const next = structuredClone(state);
  next.phase = 'ROUND';
  next.closureRejections = 0;
  next.askedTarget = chooseTarget(next, next.lastScorerOutput);
  return result(next, { type: 'ask_target', payload: { target: next.askedTarget } });
}

function startPlanning(state, payload) {
  exactKeys(payload, new Set());
  requireCondition(nonEmptyString(state.writtenSpecPath));
  return result(structuredClone(state), {
    type: 'start_planning', payload: { specPath: state.writtenSpecPath },
  });
}

function finishTransition(state, payload) {
  exactKeys(payload, new Set());
  const next = structuredClone(state);
  next.phase = 'STOPPED';
  return result(next, { type: 'stop', payload: {} });
}

function userStop(state, payload) {
  exactKeys(payload, new Set());
  const next = structuredClone(state);
  next.askedTarget = null;
  next.closureContext = null;
  clearPanel(next);
  if (next.priorAmbiguity !== null && next.priorAmbiguity > effectiveThreshold(next.threshold).value) {
    enterWrite(next, 'incomplete');
    return result(next, { type: 'write_spec', payload: { kind: 'incomplete' } });
  }
  next.phase = 'STOPPED';
  return result(next, { type: 'stop', payload: {} });
}

function reduceValidated(state, event) {
  exactKeys(event, new Set(['type', 'payload']));
  requireCondition(typeof event.type === 'string' && isObject(event.payload));
  if (state === null) {
    requireCondition(event.type === 'initialize');
    return initializeTransition(event.payload);
  }
  validateState(state);
  if (event.type === 'user_stop') {
    requireCondition(['TOPOLOGY', 'BASELINE', 'ROUND', 'CLOSURE', 'RESTATE'].includes(state.phase));
    return userStop(state, event.payload);
  }
  if (state.phase === 'TOPOLOGY' && event.type === 'topology_confirmed') return topologyConfirmed(state, event.payload);
  if (state.phase === 'BASELINE' && event.type === 'baseline_scored') return baselineScored(state, event.payload);
  if (state.phase === 'ROUND' && event.type === 'round_scored') return roundScored(state, event.payload);
  if (state.phase === 'ROUND' && event.type === 'panel_dispatched') return panelDispatched(state, event.payload);
  if (state.phase === 'ROUND' && event.type === 'panel_completed') return panelCompleted(state, event.payload);
  if (state.phase === 'CLOSURE' && event.type === 'closure_passed') return closurePassed(state, event.payload);
  if (state.phase === 'CLOSURE' && event.type === 'closure_rejected') return closureRejected(state, event.payload);
  if (state.phase === 'RESTATE' && event.type === 'restate_confirmed') return restateConfirmed(state, event.payload);
  if (state.phase === 'RESTATE' && event.type === 'restate_corrected') return restateCorrected(state, event.payload);
  if (state.phase === 'WRITE' && event.type === 'spec_written') return specWritten(state, event.payload);
  if (state.phase === 'DONE' && event.type === 'continue_interview') return continueInterview(state, event.payload);
  if (state.phase === 'DONE' && event.type === 'start_planning') return startPlanning(state, event.payload);
  if (state.phase === 'DONE' && event.type === 'finish') return finishTransition(state, event.payload);
  throw new TransitionContractError('illegal transition');
}

function eventLabel(event) {
  return isObject(event) && typeof event.type === 'string' ? event.type : 'unknown';
}

function phaseLabel(state) {
  return isObject(state) && typeof state.phase === 'string' ? state.phase : 'null';
}

export function formatExecutionError(error, parsed) {
  if (error instanceof TransitionContractError) {
    const state = isObject(parsed) ? parsed.state : null;
    const event = isObject(parsed) ? parsed.event : null;
    return `transition.mjs: invalid event ${eventLabel(event)} for phase ${phaseLabel(state)}\n`;
  }
  return `transition.mjs: ${error.name}: ${error.message}\n`;
}

export function reduceTransition(state, event) {
  return reduceValidated(state, event);
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    process.stderr.write('transition.mjs: invalid event unknown for phase null\n');
    process.exitCode = 1;
    return;
  }
  try {
    exactKeys(parsed, new Set(['state', 'event']));
    const output = reduceTransition(parsed.state, parsed.event);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    process.stderr.write(formatExecutionError(error, parsed));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
