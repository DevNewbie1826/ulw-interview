import {
  DEFAULT_THRESHOLD,
  DEFAULT_THRESHOLD_SOURCE,
  MAX_COMPONENTS,
  StateValidationError,
  assertInterviewId,
  assertInterviewType,
  assertJsonValue,
  assertNonEmptyString,
  assertObject,
  assertSafeId,
  assertThreshold,
  clone,
  hashContent,
  isObject,
} from './state.mjs';

export function initFingerprint(value) {
  const payload = {
    interviewId: value.interviewId,
    type: value.type,
    threshold: value.threshold,
    thresholdSource: value.thresholdSource,
    idea: value.idea,
    ...(value.language === undefined ? {} : { language: value.language }),
  };
  return hashContent(payload);
}

export function topologyFingerprint(components) {
  return hashContent(components.map((component) => ({
    id: component.id,
    name: component.name,
    ...(component.description === undefined ? {} : { description: component.description }),
    status: component.status,
    ...(component.deferralReason === undefined ? {} : { deferralReason: component.deferralReason }),
  })));
}

export function normalizeFact(value, defaults = {}) {
  assertObject(value, 'fact');
  const fact = {
    ...clone(value),
    ...defaults,
    id: assertSafeId(value.id, 'fact.id'),
    statement: assertNonEmptyString(value.statement, 'fact.statement'),
    disputed: value.disputed === true,
  };
  if (value.superseded_by !== undefined) fact.superseded_by = assertSafeId(value.superseded_by, 'fact.superseded_by');
  return fact;
}

export function normalizeEstablishedFacts(values = []) {
  if (!Array.isArray(values)) throw new StateValidationError('facts must be an array');
  const seen = new Set();
  return values.map((value) => {
    const fact = normalizeFact(value);
    if (seen.has(fact.id)) throw new StateValidationError('fact ids must be unique');
    seen.add(fact.id);
    return { ...fact, disputed: fact.disputed === true };
  });
}

export function normalizeEstablishedFact(value) {
  return normalizeEstablishedFacts([value])[0];
}

export function normalizeTopologyComponents(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_COMPONENTS) {
    throw new StateValidationError('topology must contain 1 to 6 components');
  }
  const seen = new Set();
  return values.map((value, index) => {
    assertObject(value, `component ${index}`);
    const id = assertSafeId(value.id, 'component.id');
    if (seen.has(id)) throw new StateValidationError('topology component ids must be unique');
    seen.add(id);
    const status = value.status ?? 'active';
    if (status !== 'active' && status !== 'deferred') throw new StateValidationError('component.status must be active or deferred');
    if (status === 'deferred') assertNonEmptyString(value.deferralReason, 'component.deferralReason');
    const clarity = isObject(value.clarity)
      ? clone(value.clarity)
      : (isObject(value.clarity_scores) ? clone(value.clarity_scores) : (isObject(value.scores) ? clone(value.scores) : {}));
    return {
      id,
      name: assertNonEmptyString(value.name ?? id, 'component.name'),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      status,
      ...(status === 'deferred' ? { deferralReason: value.deferralReason } : {}),
      clarity,
    };
  });
}

export function topologyComponents(state) {
  if (Array.isArray(state.topology)) return state.topology;
  if (isObject(state.topology) && Array.isArray(state.topology.components)) return state.topology.components;
  return [];
}

export function topologyObject(state) {
  if (Array.isArray(state.topology)) throw new StateValidationError('legacy topology array states must use the topology object form');
  if (isObject(state.topology) && Array.isArray(state.topology.components)) return state.topology;
  return {
    status: state.topologyStatus ?? 'pending',
    components: [],
    deferrals: [],
    confirmedAt: null,
    lastTargetedComponentId: null,
  };
}

export function canonicalizeState(rawState) {
  assertObject(rawState, 'state');
  const state = clone(rawState);
  const topology = topologyObject(state);
  const components = topology.components.map((component) => ({
    ...component,
    clarity: isObject(component.clarity)
      ? clone(component.clarity)
      : (isObject(component.clarity_scores) ? clone(component.clarity_scores) : (isObject(component.scores) ? clone(component.scores) : {})),
  }));
  return {
    ...state,
    topologyStatus: state.topologyStatus ?? topology.status ?? 'pending',
    topology: { ...topology, components },
    facts: Array.isArray(state.facts) ? clone(state.facts) : [],
    factEvents: Array.isArray(state.factEvents) ? clone(state.factEvents) : [],
    rounds: Array.isArray(state.rounds) ? clone(state.rounds) : [],
    pendingRound: state.pendingRound ?? null,
    pendingPanel: state.pendingPanel ?? null,
    pendingRefinement: state.pendingRefinement ?? null,
    autoAnswerStreak: state.autoAnswerStreak ?? 0,
    autoResearchedRounds: Array.isArray(state.autoResearchedRounds) ? clone(state.autoResearchedRounds) : [],
    autoAnsweredRounds: Array.isArray(state.autoAnsweredRounds) ? clone(state.autoAnsweredRounds) : [],
    refinedRounds: Array.isArray(state.refinedRounds) ? clone(state.refinedRounds) : [],
    lateralReviews: Array.isArray(state.lateralReviews) ? clone(state.lateralReviews) : [],
    lateralPanelFailures: state.lateralPanelFailures ?? 0,
    ontologySnapshots: Array.isArray(state.ontologySnapshots) ? clone(state.ontologySnapshots) : [],
    closureOverrides: Array.isArray(state.closureOverrides) ? clone(state.closureOverrides) : [],
    restateLoops: state.restateLoops ?? 0,
    closurePassed: state.closurePassed === true,
    restatementConfirmed: state.restatementConfirmed === true,
    restatedGoal: state.restatedGoal ?? null,
    softWarningShown: state.softWarningShown === true,
    hardCapReached: state.hardCapReached === true,
    earlyExitRequested: state.earlyExitRequested === true,
  };
}

export function createInitialState(input) {
  assertObject(input, 'initialize input');
  const facts = normalizeEstablishedFacts(input.facts ?? input.establishedFacts ?? []);
  const threshold = assertThreshold(input.threshold ?? DEFAULT_THRESHOLD);
  const thresholdSource = assertNonEmptyString(input.thresholdSource ?? DEFAULT_THRESHOLD_SOURCE, 'thresholdSource');
  const base = {
    interviewId: assertInterviewId(input.interviewId),
    type: assertInterviewType(input.type),
    idea: assertNonEmptyString(input.idea, 'idea'),
    ...(input.language === undefined ? {} : { language: assertJsonValue(input.language, 'language') }),
    threshold,
    thresholdSource,
  };
  return {
    version: 2,
    phase: 'topology',
    ...base,
    initHash: initFingerprint(base),
    ambiguity: 1,
    reportedAmbiguity: 1,
    ambiguityFloor: { floor: 0, disputedFactCount: 0, unscoredActiveComponentCount: 0, autoAnswerRatio: 0 },
    band: 'initial',
    rounds: [],
    facts,
    factEvents: facts.map((fact) => ({ type: 'established', factId: fact.id, fact: clone(fact), ...(fact.round === undefined ? {} : { round: fact.round }) })),
    topologyStatus: 'pending',
    topology: { status: 'pending', components: [], deferrals: [], confirmedAt: null, lastTargetedComponentId: null },
    topologyHash: null,
    pendingRound: null,
    pendingPanel: null,
    pendingRefinement: null,
    autoAnswerStreak: 0,
    autoResearchedRounds: [],
    autoAnsweredRounds: [],
    refinedRounds: [],
    lateralReviews: [],
    lateralPanelFailures: 0,
    ontologySnapshots: [],
    closureOverrides: [],
    restateLoops: 0,
    closurePassed: false,
    restatementConfirmed: false,
    restatedGoal: null,
    softWarningShown: false,
    hardCapReached: false,
    earlyExitRequested: false,
  };
}
