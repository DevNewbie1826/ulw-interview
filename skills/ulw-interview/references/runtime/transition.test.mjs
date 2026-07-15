#!/usr/bin/env node

// allow: SIZE_OK - this is the pure-data matrix and adversarial contract suite.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatExecutionError, reduceTransition, TransitionContractError } from './transition.mjs';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const transitionPath = join(runtimeDir, 'transition.mjs');
const scorerPath = join(runtimeDir, 'scorer.mjs');
const tests = [];
const coverageMetrics = { illegalPhaseEventPairs: 0 };
const MAX_COMPONENT_NAME_LENGTH = 120;
const MAX_KNOWN_COMPONENTS = 64;
const MAX_SERIALIZED_STATE_BYTES = 1024 * 1024;
const MAX_SERIALIZED_EVENT_BYTES = 1024 * 1024;
const MAX_SERIALIZED_PROJECTION_BYTES = 256 * 1024;
const MAX_SERIALIZED_RESULT_BYTES = 3 * 1024 * 1024;
const MAX_RAW_TRANSITION_BYTES = 2 * 1024 * 1024 + 4096;

const CATEGORY_NAMES = [
  'outcome',
  'must_haves',
  'must_nots',
  'out_of_scope',
  'invariants',
  'preferences',
];

const EVENT_TYPES = [
  'initialize',
  'topology_confirmed',
  'baseline_scored',
  'round_scored',
  'panel_dispatched',
  'panel_completed',
  'panel_failed',
  'closure_passed',
  'closure_rejected',
  'restate_confirmed',
  'restate_corrected',
  'spec_written',
  'continue_interview',
  'start_planning',
  'finish',
  'user_stop',
];

function test(name, body) {
  tests.push({ name, body });
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function openCategory() {
  return { status: 'open', source: null, source_round: null, items: [] };
}

function explicitNone(round = 0) {
  return { status: 'explicit_none', source: 'user', source_round: round, items: [] };
}

function completeCoverage(seed = 1, round = 0) {
  return {
    coverage: {
      outcome: {
        status: 'confirmed',
        source: 'user',
        source_round: round,
        items: [{
          id: `O${seed}`,
          text: `Outcome ${seed}`,
          source: 'user',
          source_round: round,
          state: 'active',
          supersedes: null,
        }],
      },
      must_haves: explicitNone(round),
      must_nots: explicitNone(round),
      out_of_scope: explicitNone(round),
      invariants: explicitNone(round),
      preferences: openCategory(),
    },
    acceptance_evidence: [],
  };
}

function openCoverage() {
  return {
    coverage: Object.fromEntries(CATEGORY_NAMES.map((name) => [name, openCategory()])),
    acceptance_evidence: [],
  };
}

function specManifest(state) {
  const ambiguityByComponent = new Map(
    (state.lastScorerOutput?.perComponent ?? []).map((component) => [component.name, component.ambiguity]),
  );
  const orderedActiveNames = [...state.topology].sort((left, right) => {
    const ambiguityDifference = (ambiguityByComponent.get(right) ?? -1) - (ambiguityByComponent.get(left) ?? -1);
    if (ambiguityDifference !== 0) return ambiguityDifference;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const unresolvedGaps = [];
  for (const component of orderedActiveNames) {
    const value = state.coverageByComponent[component];
    for (const category of ['outcome', 'must_haves', 'must_nots', 'out_of_scope', 'invariants']) {
      if (value.coverage[category].status === 'open') {
        unresolvedGaps.push({ component, category, itemId: null, reason: 'open' });
      }
    }
    const linkedIds = new Set(value.acceptance_evidence.flatMap((evidence) => evidence.verifies));
    const missingIds = ['must_haves', 'must_nots', 'invariants']
      .flatMap((category) => value.coverage[category].items)
      .filter((item) => item.state === 'active' && !linkedIds.has(item.id))
      .map((item) => item.id)
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)) || (left < right ? -1 : left > right ? 1 : 0));
    for (const itemId of missingIds) {
      unresolvedGaps.push({ component, category: 'acceptance_evidence', itemId, reason: 'missing_evidence' });
    }
  }
  const componentEntry = (name, status) => ({
    name,
    status,
    scored: state.scoreStateMatrix[name] !== null,
    itemIds: CATEGORY_NAMES.flatMap((category) => (
      state.coverageByComponent[name].coverage[category].items.map((item) => item.id)
    )),
    evidenceIds: state.coverageByComponent[name].acceptance_evidence.map((evidence) => evidence.id),
  });
  return {
    components: [
      ...state.topology.map((name) => componentEntry(name, 'active')),
      ...state.deferredComponents.map((name) => componentEntry(name, 'deferred')),
    ],
    unresolvedGaps,
    globalAmbiguity: state.priorAmbiguity,
  };
}

function specWrittenEvent(state, kind, path) {
  return {
    type: 'spec_written',
    payload: { kind, path, ...specManifest(state) },
  };
}

function evidenceGapCoverage(seed = 1, round = 0) {
  const value = completeCoverage(seed, round);
  value.coverage.must_haves = {
    status: 'confirmed',
    source: 'user',
    source_round: round,
    items: [{
      id: `M${seed}`,
      text: `Requirement ${seed}`,
      source: 'user',
      source_round: round,
      state: 'active',
      supersedes: null,
    }],
  };
  return value;
}

function manyMissingEvidenceCoverage(count) {
  const value = completeCoverage(1);
  value.coverage.must_haves = {
    status: 'confirmed',
    source: 'user',
    source_round: 0,
    items: Array.from({ length: count }, (_, index) => ({
      id: `M${index + 1}`,
      text: `Requirement ${index + 1}`,
      source: 'user',
      source_round: 0,
      state: 'active',
      supersedes: null,
    })),
  };
  value.acceptance_evidence = [];
  return value;
}

function orderedHistoryCoverage() {
  const value = completeCoverage(1);
  value.coverage.must_haves = {
    status: 'confirmed',
    source: 'user',
    source_round: 0,
    items: [
      { id: 'M1', text: 'First', source: 'user', source_round: 0, state: 'active', supersedes: null },
      { id: 'M2', text: 'Second', source: 'user', source_round: 0, state: 'active', supersedes: null },
    ],
  };
  value.acceptance_evidence = [
    { id: 'E1', verifies: ['M1'], type: 'test', pass_condition: 'First passes', source: 'user', source_round: 0 },
    { id: 'E2', verifies: ['M2'], type: 'test', pass_condition: 'Second passes', source: 'user', source_round: 0 },
  ];
  return value;
}

function initialize(overrides = {}) {
  return reduceTransition(null, {
    type: 'initialize',
    payload: {
      interviewId: 'interview-1',
      declaredType: 'greenfield',
      threshold: 0.05,
      roundCap: 30,
      softWarningRounds: 15,
      panelCeiling: 30,
      ...overrides,
    },
  });
}

function score(names, options = {}) {
  const value = options.value ?? 0.5;
  const components = names.map((name, index) => ({
    name,
    scores: options.scoresByName?.[name] ?? {
      goal: value + index * 0.01,
      constraints: value + index * 0.01,
      criteria: value + index * 0.01,
      ...(options.type === 'brownfield' ? { context: value + index * 0.01 } : {}),
    },
  }));
  const result = spawnSync('node', [scorerPath], {
    input: JSON.stringify({
      threshold: options.threshold ?? 0.05,
      type: options.type ?? 'greenfield',
      components,
      priorAmbiguity: options.priorAmbiguity ?? null,
      priorBand: options.priorBand ?? null,
      priorRounds: options.priorRounds ?? [],
      priorBandHistory: options.priorBandHistory ?? [],
      priorPanelRound: options.priorPanelRound ?? -3,
      currentRound: options.currentRound ?? 0,
      triggers: [],
      validationScoreClamped: false,
      streakCounter: options.streakCounter ?? 0,
      lastRoundResolvedWithoutUser: false,
      degraded: options.degraded ?? false,
    }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function topologyState(options = {}) {
  const initialized = initialize(options.initialize).state;
  const activeComponents = options.activeComponents ?? ['API'];
  const deferredComponents = options.deferredComponents ?? [];
  return reduceTransition(initialized, {
    type: 'topology_confirmed',
    payload: { activeComponents, deferredComponents },
  });
}

function baselineState(options = {}) {
  const topology = topologyState(options);
  const names = topology.state.topology;
  const coverageByComponent = options.coverageByComponent
    ?? Object.fromEntries(names.map((name, index) => [name, completeCoverage(index + 1)]));
  for (const deferred of topology.state.deferredComponents) {
    coverageByComponent[deferred] ??= openCoverage();
  }
  const scorerOutput = score(names, {
    value: options.value,
    scoresByName: options.scoresByName,
    type: topology.state.declaredType,
    threshold: topology.state.threshold,
    currentRound: topology.state.currentRound,
  });
  return reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput, coverageByComponent },
  });
}

function roundEvent(state, options = {}) {
  const coverageByComponent = clone(options.coverageByComponent ?? state.coverageByComponent);
  const scorerOutput = score(state.topology, {
    value: options.value,
    scoresByName: options.scoresByName,
    type: state.declaredType,
    threshold: state.threshold,
    priorAmbiguity: state.priorAmbiguity,
    priorBand: state.priorBand,
    priorRounds: state.priorRounds,
    priorBandHistory: state.priorBandHistory,
    priorPanelRound: state.priorPanelRound,
    currentRound: state.currentRound + 1,
    streakCounter: state.streakCounter,
  });
  const refineOutput = state.askedTarget.kind === 'dimension'
    ? (options.refineOutput ?? { shouldRefine: false, reason: 'progressed', target: null })
    : null;
  return {
    type: 'round_scored',
    payload: {
      scorerOutput,
      refineOutput,
      coverageByComponent,
      scopeExpansion: options.scopeExpansion ?? null,
      earlyExitRequested: options.earlyExitRequested ?? false,
    },
  };
}

function readyClosure(options = {}) {
  const baseline = baselineState(options);
  return reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
}

function completeWrite(options = {}) {
  const closure = readyClosure(options);
  const restate = reduceTransition(closure.state, { type: 'closure_passed', payload: {} });
  return reduceTransition(restate.state, { type: 'restate_confirmed', payload: {} });
}

function manifestWrite() {
  return completeWrite({
    activeComponents: ['Second', 'First'],
    deferredComponents: ['Later'],
    value: 0.96,
    coverageByComponent: {
      Second: orderedHistoryCoverage(),
      First: completeCoverage(3),
      Later: openCoverage(),
    },
  });
}

function invalidManifestPayloads(validPayload) {
  const mutations = [
    (payload) => { delete payload.components; },
    (payload) => { payload.components[0].extra = true; },
    (payload) => { payload.components[0].scored = !payload.components[0].scored; },
    (payload) => { payload.components.reverse(); },
    (payload) => { payload.components[0].itemIds.reverse(); },
    (payload) => { payload.components[0].evidenceIds.reverse(); },
    (payload) => { payload.unresolvedGaps = [{ component: 'Second', category: 'outcome', itemId: null, reason: 'open' }]; },
    (payload) => { payload.globalAmbiguity += 0.01; },
  ];
  return mutations.map((mutate) => {
    const payload = clone(validPayload);
    mutate(payload);
    return payload;
  });
}

function doneState(options = {}) {
  const write = completeWrite(options);
  return reduceTransition(
    write.state,
    specWrittenEvent(write.state, 'complete', '.omo/specs/ulw-interview-interview.md'),
  );
}

function incompleteState() {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state));
  const write = reduceTransition(closure.state, {
    type: 'closure_rejected',
    payload: {
      reason: 'material gap',
      target: { kind: 'dimension', component: 'API', dimension: 'goal' },
    },
  });
  return reduceTransition(
    write.state,
    specWrittenEvent(write.state, 'incomplete', '.omo/specs/ulw-interview-incomplete.md'),
  );
}

function hardCapCompletePath() {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  const restate = reduceTransition(closure.state, { type: 'closure_passed', payload: {} });
  const write = reduceTransition(restate.state, { type: 'restate_confirmed', payload: {} });
  const done = reduceTransition(
    write.state,
    specWrittenEvent(write.state, 'complete', '.omo/specs/ulw-interview-cap-complete.md'),
  );
  return { restate, write, done };
}

function expectInvalid(state, event) {
  assert.throws(
    () => reduceTransition(state, event),
    (error) => error instanceof TransitionContractError,
  );
}

function runCli(input, options = {}) {
  return spawnSync('node', [transitionPath], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd: options.cwd,
    env: options.env,
  });
}

test('initialize creates the complete default state and exact action', () => {
  const event = deepFreeze({
    type: 'initialize',
    payload: {
      interviewId: 'immutable-id',
      declaredType: 'greenfield',
      threshold: 0.05,
      roundCap: 30,
      softWarningRounds: 15,
      panelCeiling: 30,
    },
  });
  const before = JSON.stringify(event);
  const first = reduceTransition(null, event);
  const second = reduceTransition(null, event);

  assert.equal(JSON.stringify(event), before);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.action, { type: 'confirm_topology', payload: {} });
  assert.deepEqual(first.semanticCoverageGaps, []);
  assert.deepEqual(first.state, {
    version: 1,
    phase: 'TOPOLOGY',
    interviewId: 'immutable-id',
    declaredType: 'greenfield',
    threshold: 0.05,
    roundCap: 30,
    softWarningRounds: 15,
    panelCeiling: 30,
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
  });
});

test('initialize rejects malformed config and unknown keys', () => {
  const invalidCases = [
    { interviewId: ' ' },
    { declaredType: 'hybrid' },
    { threshold: Number.POSITIVE_INFINITY },
    { roundCap: 0 },
    { softWarningRounds: 1.5 },
    { panelCeiling: -1 },
    { extra: true },
  ];
  for (const override of invalidCases) {
    expectInvalid(null, {
      type: 'initialize',
      payload: {
        interviewId: 'id',
        declaredType: 'greenfield',
        threshold: 0.05,
        roundCap: 30,
        softWarningRounds: 15,
        panelCeiling: 30,
        ...override,
      },
    });
  }
});

test('initialize enforces the safe interview ID grammar and length', () => {
  for (const interviewId of ['-leading', '_leading', '.leading', 'has/slash', 'has space', 'é', `a${'b'.repeat(128)}`]) {
    expectInvalid(null, {
      type: 'initialize',
      payload: {
        interviewId,
        declaredType: 'greenfield',
        threshold: 0.05,
        roundCap: 30,
        softWarningRounds: 15,
        panelCeiling: 30,
      },
    });
  }
  assert.equal(initialize({ interviewId: `a${'b'.repeat(127)}` }).state.interviewId.length, 128);
});

test('topology lock preserves known history and baselines sorted new or reactivated names', () => {
  const initial = topologyState({ activeComponents: ['Core'], deferredComponents: ['Later'] });
  assert.deepEqual(initial.action, { type: 'run_baseline', payload: { components: ['Core'] } });
  assert.deepEqual(Object.keys(initial.state.coverageByComponent).sort(), ['Core', 'Later']);
  assert.deepEqual(initial.state.coverageByComponent.Core, openCoverage());

  const baseline = reduceTransition(initial.state, {
    type: 'baseline_scored',
    payload: {
      scorerOutput: score(['Core'], { currentRound: 0 }),
      coverageByComponent: {
        Core: completeCoverage(1),
        Later: openCoverage(),
      },
    },
  });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['Newest'] },
  }));
  assert.equal(reopened.state.phase, 'TOPOLOGY');
  assert.deepEqual(reopened.state.deferredComponents.sort(), ['Later', 'Newest']);

  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: {
      activeComponents: ['Newest', 'Core', 'Later'],
      deferredComponents: [],
    },
  });
  assert.deepEqual(relocked.action, {
    type: 'run_baseline',
    payload: { components: ['Later', 'Newest'] },
  });
  assert.deepEqual(relocked.state.coverageByComponent.Core, baseline.state.coverageByComponent.Core);
  assert.equal(relocked.state.scoreStateMatrix.Later, null);
  assert.equal(relocked.state.scoreStateMatrix.Newest, null);
});

test('topology rejects duplicates disappearance overlap and more than six active names', () => {
  const initialized = initialize().state;
  const invalidPayloads = [
    { activeComponents: [], deferredComponents: [] },
    { activeComponents: ['A', 'A'], deferredComponents: [] },
    { activeComponents: ['A'], deferredComponents: ['A'] },
    { activeComponents: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], deferredComponents: [] },
    { activeComponents: [' '], deferredComponents: [] },
  ];
  for (const payload of invalidPayloads) {
    expectInvalid(initialized, { type: 'topology_confirmed', payload });
  }

  const known = topologyState({ activeComponents: ['A'], deferredComponents: ['B'] }).state;
  expectInvalid(known, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['A'], deferredComponents: [] },
  });
});

test('component names and total known components enforce exact inclusive bounds', () => {
  const initialized = initialize().state;
  const longestName = 'a'.repeat(MAX_COMPONENT_NAME_LENGTH);
  const accepted = reduceTransition(initialized, {
    type: 'topology_confirmed',
    payload: {
      activeComponents: [longestName],
      deferredComponents: Array.from(
        { length: MAX_KNOWN_COMPONENTS - 1 },
        (_, index) => `Deferred-${index + 1}`,
      ),
    },
  });
  assert.equal(accepted.state.topology[0].length, MAX_COMPONENT_NAME_LENGTH);
  assert.equal(accepted.state.topology.length + accepted.state.deferredComponents.length, MAX_KNOWN_COMPONENTS);

  expectInvalid(initialized, {
    type: 'topology_confirmed',
    payload: { activeComponents: [`a${longestName}`], deferredComponents: [] },
  });
  expectInvalid(initialized, {
    type: 'topology_confirmed',
    payload: {
      activeComponents: ['Active'],
      deferredComponents: Array.from({ length: MAX_KNOWN_COMPONENTS }, (_, index) => `Overflow-${index + 1}`),
    },
  });

  const fullBaseline = baselineState({
    activeComponents: ['Active'],
    deferredComponents: Array.from(
      { length: MAX_KNOWN_COMPONENTS - 1 },
      (_, index) => `Known-${index + 1}`,
    ),
  });
  expectInvalid(fullBaseline.state, roundEvent(fullBaseline.state, {
    scopeExpansion: { newComponents: ['OneTooMany'] },
  }));
  const baseline = baselineState();
  expectInvalid(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: [`a${longestName}`] },
  }));
});

test('topology rejects a 5000-component pathological payload before state growth', () => {
  const initialized = initialize().state;
  expectInvalid(initialized, {
    type: 'topology_confirmed',
    payload: {
      activeComponents: ['Active'],
      deferredComponents: Array.from({ length: 4999 }, (_, index) => `Deferred-${index + 1}`),
    },
  });
});

test('baseline commits complete snapshots and targets semantic gaps before dimensions', () => {
  const topology = topologyState({ activeComponents: ['Fuzzy', 'Clear'] });
  const coverageByComponent = {
    Fuzzy: completeCoverage(1),
    Clear: openCoverage(),
  };
  const scorerOutput = score(['Fuzzy', 'Clear'], {
    scoresByName: {
      Fuzzy: { goal: 0.1, constraints: 0.1, criteria: 0.1 },
      Clear: { goal: 0.8, constraints: 0.8, criteria: 0.8 },
    },
    currentRound: 0,
  });
  const result = reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput, coverageByComponent },
  });

  assert.equal(result.state.phase, 'ROUND');
  assert.deepEqual(result.action, {
    type: 'ask_target',
    payload: {
      target: {
        kind: 'coverage',
        component: 'Clear',
        category: 'outcome',
        itemId: null,
      },
    },
  });
  assert.equal(result.semanticCoverageGaps.length, 5);
  assert.equal(result.state.priorRounds.length, 1);
  assert.equal(result.state.priorBandHistory.length, 1);
});

test('semantic gaps include missing evidence and use numeric ID ordering', () => {
  const topology = topologyState({ activeComponents: ['API'] });
  const coverage = evidenceGapCoverage(10);
  coverage.coverage.must_haves.items.unshift({
    id: 'M2',
    text: 'Earlier numeric requirement',
    source: 'user',
    source_round: 0,
    state: 'active',
    supersedes: null,
  });
  const result = reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: {
      scorerOutput: score(['API'], { currentRound: 0 }),
      coverageByComponent: { API: coverage },
    },
  });

  assert.deepEqual(result.semanticCoverageGaps, [
    { component: 'API', category: 'acceptance_evidence', itemId: 'M2', reason: 'missing_evidence' },
    { component: 'API', category: 'acceptance_evidence', itemId: 'M10', reason: 'missing_evidence' },
  ]);
  assert.equal(result.action.payload.target.itemId, 'M2');
});

test('round commit is immutable and refinement retains the asked dimension', () => {
  const baseline = baselineState();
  const state = deepFreeze(baseline.state);
  const before = JSON.stringify(state);
  const event = deepFreeze(roundEvent(state, {
    refineOutput: { shouldRefine: true, reason: 'low_delta_and_clamped', target: state.askedTarget.dimension },
  }));
  const result = reduceTransition(state, event);

  assert.equal(JSON.stringify(state), before);
  assert.equal(result.state.interviewId, state.interviewId);
  assert.equal(result.state.currentRound, 1);
  assert.equal(result.state.priorRounds.length, 2);
  assert.deepEqual(result.action, {
    type: 'ask_target',
    payload: { target: baseline.state.askedTarget, refine: true },
  });
});

test('round scoring rejects unasked sibling score mutation and permits asked score change', () => {
  const baseline = baselineState({
    activeComponents: ['A', 'B'],
    coverageByComponent: { A: completeCoverage(1), B: completeCoverage(2) },
  });
  const asked = baseline.state.askedTarget.component;
  const sibling = baseline.state.topology.find((name) => name !== asked);
  const askedScores = clone(baseline.state.scoreStateMatrix[asked]);
  const siblingScores = clone(baseline.state.scoreStateMatrix[sibling]);
  askedScores.goal += 0.1;
  const forgedSiblingScores = clone(siblingScores);
  forgedSiblingScores.goal += 0.1;

  expectInvalid(baseline.state, roundEvent(baseline.state, {
    scoresByName: { [asked]: askedScores, [sibling]: forgedSiblingScores },
  }));

  const accepted = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scoresByName: { [asked]: askedScores, [sibling]: siblingScores },
  }));
  assert.deepEqual(accepted.state.scoreStateMatrix[asked], askedScores);
  assert.deepEqual(accepted.state.scoreStateMatrix[sibling], siblingScores);
});

test('cap-round scope expansion is registered deferred and writes incomplete without closure', () => {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const result = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['DiscoveredAtCap'] },
  }));

  assert.equal(result.state.currentRound, 1);
  assert.equal(result.state.phase, 'WRITE');
  assert.deepEqual(result.state.deferredComponents, ['DiscoveredAtCap']);
  assert.equal(result.state.scoreStateMatrix.DiscoveredAtCap, null);
  assert.deepEqual(result.state.coverageByComponent.DiscoveredAtCap, openCoverage());
  assert.equal(result.state.scopeChangedSincePanel, true);
  assert.deepEqual(result.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
  assert.deepEqual(specManifest(result.state).components.at(-1), {
    name: 'DiscoveredAtCap',
    status: 'deferred',
    scored: false,
    itemIds: [],
    evidenceIds: [],
  });
});

test('early exit uses strict high boundary and otherwise runs closure', () => {
  const high = baselineState({ initialize: { threshold: 0.05 }, value: 0.5 });
  const highResult = reduceTransition(high.state, roundEvent(high.state, {
    value: 0.5,
    earlyExitRequested: true,
  }));
  assert.equal(highResult.state.phase, 'WRITE');
  assert.deepEqual(highResult.action, { type: 'write_spec', payload: { kind: 'incomplete' } });

  const boundary = baselineState({ initialize: { threshold: 0.05 }, value: 0.75 });
  const boundaryResult = reduceTransition(boundary.state, roundEvent(boundary.state, {
    value: 0.75,
    earlyExitRequested: true,
  }));
  assert.equal(boundaryResult.state.priorAmbiguity, 0.25);
  assert.equal(boundaryResult.state.phase, 'CLOSURE');
  assert.deepEqual(boundaryResult.action, { type: 'run_closure', payload: { earlyExit: true } });
});

test('semantic gaps outrank numeric readiness and ready closes only without gaps', () => {
  const gapBaseline = baselineState({ coverageByComponent: { API: openCoverage() } });
  const gap = reduceTransition(gapBaseline.state, roundEvent(gapBaseline.state, { value: 0.96 }));
  assert.equal(gap.state.phase, 'ROUND');
  assert.equal(gap.action.type, 'ask_target');
  assert.equal(gap.action.payload.target.kind, 'coverage');

  const complete = baselineState();
  const ready = reduceTransition(complete.state, roundEvent(complete.state, { value: 0.96 }));
  assert.equal(ready.state.phase, 'CLOSURE');
  assert.deepEqual(ready.action, { type: 'run_closure', payload: {} });
});

test('closure_passed rejects normal closure with missing active requirement evidence', () => {
  const closure = readyClosure();
  const forged = clone(closure.state);
  forged.coverageByComponent.API = evidenceGapCoverage(1, forged.currentRound);
  assert.equal(forged.coverageByComponent.API.coverage.must_haves.items[0].state, 'active');
  assert.deepEqual(forged.coverageByComponent.API.acceptance_evidence, []);
  expectInvalid(forged, { type: 'closure_passed', payload: {} });
});

test('hard cap with deterministic semantic gaps writes incomplete without closure', () => {
  const baseline = baselineState({
    initialize: { roundCap: 1 },
    coverageByComponent: { API: openCoverage() },
  });
  const result = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  assert.equal(result.state.phase, 'WRITE');
  assert.equal(result.semanticCoverageGaps.length, 5);
  assert.deepEqual(result.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
});

test('early exit with deterministic semantic gaps writes incomplete without closure', () => {
  const baseline = baselineState({ coverageByComponent: { API: openCoverage() }, value: 0.8 });
  const result = reduceTransition(baseline.state, roundEvent(baseline.state, {
    value: 0.8,
    earlyExitRequested: true,
  }));
  assert.equal(result.state.phase, 'WRITE');
  assert.equal(result.semanticCoverageGaps.length, 5);
  assert.deepEqual(result.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
});

test('panel dispatch is ordered guarded counted and folded exactly once', () => {
  const baseline = baselineState({ value: 0.8 });
  const scopeFlagged = clone(baseline.state);
  scopeFlagged.scopeChangedSincePanel = true;
  const event = roundEvent(scopeFlagged, { value: 0.5 });
  const dispatch = reduceTransition(scopeFlagged, event);

  assert.equal(dispatch.state.panelStage, 'awaiting_dispatch');
  assert.deepEqual(dispatch.action, {
    type: 'dispatch_panel',
    payload: { personas: ['architect', 'researcher', 'contrarian', 'simplifier'] },
  });
  expectInvalid(dispatch.state, event);
  expectInvalid(dispatch.state, { type: 'panel_completed', payload: { findings: [] } });

  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched',
    payload: { personas: ['architect', 'researcher', 'contrarian', 'simplifier'] },
  });
  assert.equal(acknowledged.state.panelDispatchCount, 4);
  assert.equal(acknowledged.state.priorPanelRound, acknowledged.state.currentRound);
  assert.equal(acknowledged.state.scopeChangedSincePanel, false);
  assert.equal(acknowledged.state.panelStage, 'awaiting_results');
  assert.deepEqual(acknowledged.action, { type: 'await_panel_results', payload: {} });
  expectInvalid(acknowledged.state, {
    type: 'panel_dispatched',
    payload: { personas: [] },
  });

  const findings = acknowledged.state.pendingPanelPersonas.map((persona) => ({
    persona, summary: `${persona} blind spot`, options: ['A', 'B'], confidence: 'high',
  }));
  const completed = reduceTransition(acknowledged.state, {
    type: 'panel_completed',
    payload: { findings },
  });
  assert.equal(completed.state.panelStage, 'none');
  assert.deepEqual(completed.action, {
    type: 'ask_target',
    payload: { target: dispatch.state.pendingTarget, findings },
  });
});

test('panel findings retain and exactly match acknowledged personas in order', () => {
  const baseline = baselineState({ value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const personas = clone(dispatch.state.pendingPanelPersonas);
  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched', payload: { personas },
  });
  assert.deepEqual(acknowledged.state.pendingPanelPersonas, personas);

  const findings = personas.map((persona) => ({
    persona,
    summary: `${persona} finding`,
    options: [`${persona} option`],
    confidence: 'high',
  }));
  const completed = reduceTransition(acknowledged.state, {
    type: 'panel_completed', payload: { findings },
  });
  assert.deepEqual(completed.action.payload.findings, findings);
  assert.deepEqual(completed.state.pendingPanelPersonas, []);

  expectInvalid(acknowledged.state, {
    type: 'panel_completed', payload: { findings: clone(findings).reverse() },
  });
  expectInvalid(acknowledged.state, {
    type: 'panel_completed', payload: { findings: findings.slice(1) },
  });
  const wrongPersona = clone(findings);
  wrongPersona[0].persona = 'simplifier';
  expectInvalid(acknowledged.state, { type: 'panel_completed', payload: { findings: wrongPersona } });
});

test('panel failure consumes the dispatch and resumes the pending target without findings', () => {
  const baseline = baselineState({ value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  expectInvalid(dispatch.state, { type: 'panel_failed', payload: { reason: 'timeout' } });
  const launchFailed = reduceTransition(dispatch.state, {
    type: 'panel_failed', payload: { reason: 'dispatch_error' },
  });
  assert.equal(launchFailed.state.panelDispatchCount, dispatch.state.pendingPanelPersonas.length);
  assert.equal(launchFailed.state.panelStage, 'none');
  assert.deepEqual(launchFailed.state.askedTarget, dispatch.state.pendingTarget);
  assert.deepEqual(launchFailed.action, {
    type: 'ask_target', payload: { target: dispatch.state.pendingTarget },
  });
  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched', payload: { personas: dispatch.state.pendingPanelPersonas },
  });
  const failed = reduceTransition(acknowledged.state, {
    type: 'panel_failed', payload: { reason: 'timeout' },
  });
  assert.equal(failed.state.panelDispatchCount, acknowledged.state.panelDispatchCount);
  assert.equal(failed.state.panelStage, 'none');
  assert.deepEqual(failed.state.pendingPanelPersonas, []);
  assert.deepEqual(failed.state.askedTarget, acknowledged.state.pendingTarget);
  assert.deepEqual(failed.action, {
    type: 'ask_target', payload: { target: acknowledged.state.pendingTarget },
  });
  expectInvalid(acknowledged.state, {
    type: 'panel_failed', payload: { reason: 'unknown' },
  });
  expectInvalid(acknowledged.state, {
    type: 'panel_failed', payload: { reason: 'dispatch_error' },
  });
});

test('panel history rejects unreachable partial dispatch ordering', () => {
  const baseline = baselineState({ initialize: { panelCeiling: 5 }, value: 0.2 });
  const firstDispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const firstAcknowledged = reduceTransition(firstDispatch.state, {
    type: 'panel_dispatched', payload: { personas: firstDispatch.state.pendingPanelPersonas },
  });
  const findings = firstAcknowledged.state.pendingPanelPersonas.map((persona) => ({
    persona, summary: 'finding', options: [], confidence: 'medium',
  }));
  let current = reduceTransition(firstAcknowledged.state, {
    type: 'panel_completed', payload: { findings },
  });
  current = reduceTransition(current.state, roundEvent(current.state, { value: 0.5 }));
  current = reduceTransition(current.state, roundEvent(current.state, { value: 0.5 }));
  const secondDispatch = reduceTransition(current.state, roundEvent(current.state, { value: 0.8 }));
  const secondAcknowledged = reduceTransition(secondDispatch.state, {
    type: 'panel_dispatched', payload: { personas: secondDispatch.state.pendingPanelPersonas },
  });
  assert.deepEqual(secondAcknowledged.state.panelDispatchHistory.map((entry) => entry.personas.length), [3, 2]);

  const forged = clone(secondAcknowledged.state);
  forged.panelDispatchHistory[0].personas = ['researcher', 'contrarian'];
  forged.panelDispatchHistory[1].personas = ['researcher', 'contrarian', 'simplifier'];
  forged.pendingPanelPersonas = ['researcher', 'contrarian', 'simplifier'];
  expectInvalid(forged, { type: 'panel_failed', payload: { reason: 'timeout' } });
});

test('panel history cannot be backfilled into a round without dispatch authorization', () => {
  let current = baselineState({ value: 0.5 });
  for (let round = 0; round < 4; round += 1) {
    current = reduceTransition(current.state, roundEvent(current.state, { value: 0.5 }));
  }
  assert.deepEqual(current.state.panelDispatchHistory, []);
  const forged = clone(current.state);
  forged.panelDispatchHistory = [{
    round: 1,
    personas: ['researcher', 'contrarian', 'simplifier'],
    panelCooldown: 2,
    globalAmbiguity: forged.priorRounds[1],
    band: forged.priorBandHistory[1],
  }];
  forged.panelDispatchCount = 3;
  forged.priorPanelRound = 1;
  expectInvalid(forged, { type: 'user_stop', payload: {} });
});

test('panel ceiling truncates personas and zero remaining skips panel', () => {
  const baseline = baselineState({ initialize: { panelCeiling: 2 }, value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  assert.deepEqual(dispatch.action.payload.personas, ['researcher', 'contrarian']);
  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched', payload: { personas: dispatch.state.pendingPanelPersonas },
  });
  let capped = reduceTransition(acknowledged.state, {
    type: 'panel_completed',
    payload: {
      findings: acknowledged.state.pendingPanelPersonas.map((persona) => ({
        persona, summary: `${persona} finding`, options: [], confidence: 'medium',
      })),
    },
  });
  capped = reduceTransition(capped.state, roundEvent(capped.state, { value: 0.5 }));
  capped = reduceTransition(capped.state, roundEvent(capped.state, { value: 0.5 }));
  const skipped = reduceTransition(capped.state, roundEvent(capped.state, { value: 0.8 }));
  assert.equal(skipped.action.type, 'ask_target');
  assert.equal(skipped.state.panelStage, 'none');
});

test('closure retries once then writes incomplete while hard cap never loops', () => {
  const closure = readyClosure();
  const target = { kind: 'dimension', component: 'API', dimension: 'goal' };
  const retry = reduceTransition(closure.state, {
    type: 'closure_rejected',
    payload: { reason: 'Need user confirmation', target },
  });
  assert.equal(retry.state.phase, 'ROUND');
  assert.equal(retry.state.closureRejections, 1);
  assert.deepEqual(retry.action, { type: 'ask_target', payload: { target } });

  const closureAgainState = clone(closure.state);
  closureAgainState.closureRejections = 1;
  const stopped = reduceTransition(closureAgainState, {
    type: 'closure_rejected',
    payload: { reason: 'Still incomplete', target },
  });
  assert.equal(stopped.state.phase, 'WRITE');
  assert.equal(stopped.state.closureRejections, 2);
  assert.deepEqual(stopped.action, { type: 'write_spec', payload: { kind: 'incomplete' } });

  const capBaseline = baselineState({ initialize: { roundCap: 1 } });
  const capClosure = reduceTransition(capBaseline.state, roundEvent(capBaseline.state));
  const capReject = reduceTransition(capClosure.state, {
    type: 'closure_rejected',
    payload: { reason: 'Cap gap', target },
  });
  assert.equal(capReject.state.phase, 'WRITE');
});

test('closure pass and restate correction honor hard cap', () => {
  const closure = readyClosure();
  const restate = reduceTransition(closure.state, { type: 'closure_passed', payload: {} });
  assert.equal(restate.state.phase, 'RESTATE');
  assert.deepEqual(restate.action, { type: 'confirm_intent_contract', payload: {} });

  const target = { kind: 'coverage', component: 'API', category: 'must_nots', itemId: null };
  const correction = reduceTransition(restate.state, {
    type: 'restate_corrected',
    payload: { target },
  });
  assert.equal(correction.state.phase, 'ROUND');
  assert.deepEqual(correction.action, { type: 'score_answer', payload: { target } });

  const capBaseline = baselineState({ initialize: { roundCap: 1 } });
  const capClosure = reduceTransition(capBaseline.state, roundEvent(capBaseline.state, { value: 0.96 }));
  const capRestate = reduceTransition(capClosure.state, { type: 'closure_passed', payload: {} });
  const capCorrection = reduceTransition(capRestate.state, {
    type: 'restate_corrected',
    payload: { target },
  });
  assert.equal(capCorrection.state.phase, 'WRITE');
  assert.deepEqual(capCorrection.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
});

test('write acknowledgement matches kind persists path and controls post-spec continuation', () => {
  const write = completeWrite();
  expectInvalid(
    write.state,
    specWrittenEvent(write.state, 'incomplete', '.omo/specs/ulw-interview-wrong-kind.md'),
  );
  const done = reduceTransition(
    write.state,
    specWrittenEvent(write.state, 'complete', '.omo/specs/ulw-interview-final.md'),
  );
  assert.equal(done.state.phase, 'DONE');
  assert.deepEqual(done.action, {
    type: 'offer_post_spec',
    payload: { specPath: '.omo/specs/ulw-interview-final.md', allowContinue: true },
  });

  const continued = reduceTransition(done.state, { type: 'continue_interview', payload: {} });
  assert.equal(continued.state.phase, 'ROUND');
  assert.equal(continued.state.closureRejections, 0);
  assert.equal(continued.action.type, 'ask_target');

  const planning = reduceTransition(done.state, { type: 'start_planning', payload: {} });
  assert.equal(planning.state.phase, 'DONE');
  assert.deepEqual(planning.action, {
    type: 'start_planning',
    payload: { specPath: '.omo/specs/ulw-interview-final.md' },
  });

  const finished = reduceTransition(done.state, { type: 'finish', payload: {} });
  assert.equal(finished.state.phase, 'STOPPED');
  assert.deepEqual(finished.action, { type: 'stop', payload: {} });
});

test('spec_written accepts only a contained safe ulw-interview spec path', () => {
  const write = completeWrite();
  for (const path of [
    '/tmp/ulw-interview-safe.md',
    '../ulw-interview-safe.md',
    '.omo/specs/other-safe.md',
    '.omo/specs/ulw-interview-../escape.md',
    '.omo/specs/ulw-interview-Upper.md',
    `.omo/specs/ulw-interview-${'a'.repeat(61)}.md`,
  ]) {
    expectInvalid(write.state, specWrittenEvent(write.state, 'complete', path));
  }
  const accepted = reduceTransition(
    write.state,
    specWrittenEvent(write.state, 'complete', '.omo/specs/ulw-interview-safe-slug.md'),
  );
  assert.equal(accepted.state.writtenSpecPath, '.omo/specs/ulw-interview-safe-slug.md');
});

test('spec_written requires the exact ordered state-derived manifest', () => {
  const write = manifestWrite();
  const manifest = specManifest(write.state);
  assert.deepEqual(manifest.components.map((component) => component.name), ['Second', 'First', 'Later']);
  assert.deepEqual(manifest.components[0].itemIds, ['O1', 'M1', 'M2']);
  assert.deepEqual(manifest.components[0].evidenceIds, ['E1', 'E2']);
  assert.equal(manifest.components[0].scored, true);
  assert.equal(manifest.components.at(-1).scored, false);
  const validPayload = {
    kind: 'complete',
    path: '.omo/specs/ulw-interview-manifest.md',
    ...manifest,
  };
  const accepted = reduceTransition(write.state, { type: 'spec_written', payload: validPayload });
  assert.equal(accepted.state.phase, 'DONE');

  for (const payload of invalidManifestPayloads(validPayload)) {
    expectInvalid(write.state, { type: 'spec_written', payload });
  }
});

test('spec_written treats JSON object member order as non-semantic', () => {
  const write = manifestWrite();
  const manifest = specManifest(write.state);
  const components = manifest.components.map((component) => ({
    evidenceIds: component.evidenceIds,
    itemIds: component.itemIds,
    scored: component.scored,
    status: component.status,
    name: component.name,
  }));
  const unresolvedGaps = manifest.unresolvedGaps.map((gap) => ({
    reason: gap.reason,
    itemId: gap.itemId,
    category: gap.category,
    component: gap.component,
  }));
  const accepted = reduceTransition(write.state, {
    type: 'spec_written',
    payload: {
      globalAmbiguity: manifest.globalAmbiguity,
      unresolvedGaps,
      components,
      path: '.omo/specs/ulw-interview-key-order.md',
      kind: 'complete',
    },
  });
  assert.equal(accepted.state.phase, 'DONE');
});

test('hard-cap complete spec hides continuation', () => {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  const restate = reduceTransition(closure.state, { type: 'closure_passed', payload: {} });
  const write = reduceTransition(restate.state, { type: 'restate_confirmed', payload: {} });
  const done = reduceTransition(
    write.state,
    specWrittenEvent(write.state, 'complete', '.omo/specs/ulw-interview-cap.md'),
  );
  assert.equal(done.state.hardCapReached, true);
  assert.equal(done.action.payload.allowContinue, false);
  expectInvalid(done.state, { type: 'continue_interview', payload: {} });
});

test('phase-specific user stop clears every panel substate and uses known ambiguity', () => {
  const preBaseline = topologyState().state;
  const low = reduceTransition(preBaseline, { type: 'user_stop', payload: {} });
  assert.equal(low.state.phase, 'STOPPED');
  assert.deepEqual(low.action, { type: 'stop', payload: {} });

  const baseline = baselineState({ value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched', payload: { personas: dispatch.state.pendingPanelPersonas },
  });
  for (const panelState of [dispatch.state, acknowledged.state]) {
    const high = reduceTransition(panelState, { type: 'user_stop', payload: {} });
    assert.equal(high.state.phase, 'WRITE');
    assert.equal(high.state.panelStage, 'none');
    assert.equal(high.state.pendingTarget, null);
    assert.deepEqual(high.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
    expectInvalid(high.state, { type: 'user_stop', payload: {} });
  }
});

test('full snapshots reject stale siblings cross-component ID movement and source future rounds', () => {
  const baseline = baselineState({
    activeComponents: ['A', 'B'],
    coverageByComponent: { A: completeCoverage(1), B: completeCoverage(2) },
  });
  const staleSibling = clone(baseline.state.coverageByComponent);
  staleSibling.B.coverage.outcome.items[0].text = 'Changed outside asked component';
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent: staleSibling }));

  const moved = clone(baseline.state.coverageByComponent);
  moved.A.coverage.outcome.items = [];
  moved.A.coverage.outcome.status = 'open';
  moved.A.coverage.outcome.source = null;
  moved.A.coverage.outcome.source_round = null;
  moved.B.coverage.outcome.items.push({
    ...moved.B.coverage.outcome.items[0],
    id: 'O1',
    text: 'Moved ID',
  });
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent: moved }));

  const future = clone(baseline.state.coverageByComponent);
  future.A.coverage.outcome.source_round = 2;
  future.A.coverage.outcome.items[0].source_round = 2;
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent: future }));
});

test('history is append-only immutable and allows one-way supersession', () => {
  const baseline = baselineState({
    coverageByComponent: {
      API: {
        ...completeCoverage(1),
        coverage: {
          ...completeCoverage(1).coverage,
          must_haves: {
            status: 'confirmed',
            source: 'user',
            source_round: 0,
            items: [{
              id: 'M1', text: 'Original', source: 'user', source_round: 0, state: 'active', supersedes: null,
            }],
          },
        },
        acceptance_evidence: [{
          id: 'E1', verifies: ['M1'], type: 'test', pass_condition: 'Original passes', source: 'user', source_round: 0,
        }],
      },
    },
  });
  const next = clone(baseline.state.coverageByComponent);
  next.API.coverage.must_haves.items[0].state = 'superseded';
  next.API.coverage.must_haves.items.push({
    id: 'M2', text: 'Replacement', source: 'user', source_round: 1, state: 'active', supersedes: 'M1',
  });
  next.API.acceptance_evidence.push({
    id: 'E2', verifies: ['M2'], type: 'test', pass_condition: 'Replacement passes', source: 'user', source_round: 1,
  });
  const accepted = reduceTransition(baseline.state, roundEvent(baseline.state, { coverageByComponent: next }));
  assert.equal(accepted.state.coverageByComponent.API.coverage.must_haves.items.length, 2);

  const reactivated = clone(accepted.state.coverageByComponent);
  reactivated.API.coverage.must_haves.items[0].state = 'active';
  expectInvalid(accepted.state, roundEvent(accepted.state, { coverageByComponent: reactivated }));

  const editedEvidence = clone(accepted.state.coverageByComponent);
  editedEvidence.API.acceptance_evidence[0].pass_condition = 'Rewritten';
  expectInvalid(accepted.state, roundEvent(accepted.state, { coverageByComponent: editedEvidence }));
});

test('strict scorer schema rejects missing unknown and contradictory cross-fields', () => {
  const topology = topologyState();
  const coverageByComponent = { API: completeCoverage(1) };
  const valid = score(['API'], { currentRound: 0 });
  const mutations = [
    (output) => { delete output.ready; },
    (output) => { output.extra = true; },
    (output) => { output.globalAmbiguity = 0.123; },
    (output) => { output.currentRound = 1; },
    (output) => { output.type = 'brownfield'; },
    (output) => { output.perComponent[0].name = 'Other'; },
    (output) => { output.nextTarget.component = 'Other'; },
    (output) => { output.dispatchPanel = !output.dispatchPanel; },
    (output) => { output.ready = true; },
    (output) => { output.skipToSpec = true; output.ready = false; },
  ];
  for (const mutate of mutations) {
    const scorerOutput = clone(valid);
    mutate(scorerOutput);
    expectInvalid(topology.state, {
      type: 'baseline_scored',
      payload: { scorerOutput, coverageByComponent },
    });
  }
});

test('scorer threshold and clamp flag must match the effective state threshold', () => {
  const topology = topologyState();
  const mismatchedThreshold = score(['API'], { threshold: 0.30, currentRound: 0, value: 0.75 });
  expectInvalid(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput: mismatchedThreshold, coverageByComponent: { API: completeCoverage(1) } },
  });

  const wrongClampFlag = score(['API'], { threshold: 0.05, currentRound: 0 });
  wrongClampFlag.thresholdClamped = true;
  expectInvalid(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput: wrongClampFlag, coverageByComponent: { API: completeCoverage(1) } },
  });
});

test('exact one-micro threshold clamp is a valid scorer boundary', () => {
  const topology = topologyState({ initialize: { threshold: 0 } });
  const scorerOutput = score(['API'], { threshold: 0, currentRound: 0, value: 1 });
  assert.equal(scorerOutput.threshold, 0.000001);
  assert.equal(scorerOutput.thresholdClamped, true);
  const result = reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput, coverageByComponent: { API: completeCoverage(1) } },
  });
  assert.equal(result.state.phase, 'ROUND');
});

test('item history rejects prepend and reorder while preserving append', () => {
  const baseline = baselineState({ coverageByComponent: { API: orderedHistoryCoverage() } });
  const prepended = clone(baseline.state.coverageByComponent);
  prepended.API.coverage.must_haves.items.unshift({
    id: 'M3', text: 'Prepended', source: 'user', source_round: 1, state: 'active', supersedes: null,
  });
  prepended.API.acceptance_evidence.push({
    id: 'E3', verifies: ['M3'], type: 'test', pass_condition: 'Third passes', source: 'user', source_round: 1,
  });
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent: prepended }));

  const reordered = clone(baseline.state.coverageByComponent);
  reordered.API.coverage.must_haves.items.reverse();
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent: reordered }));
});

test('acceptance evidence history rejects prepend and reorder', () => {
  const baseline = baselineState({ coverageByComponent: { API: orderedHistoryCoverage() } });
  const prepended = clone(baseline.state.coverageByComponent);
  prepended.API.acceptance_evidence.unshift({
    id: 'E3', verifies: ['M1'], type: 'inspection', pass_condition: 'Prepended proof', source: 'user', source_round: 1,
  });
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent: prepended }));

  const reordered = clone(baseline.state.coverageByComponent);
  reordered.API.acceptance_evidence.reverse();
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent: reordered }));
});

test('reopened baseline validates scorer context after excluding the replaced observation', () => {
  const baseline = baselineState({ activeComponents: ['API'], value: 0.5 });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    value: 0.5,
    scopeExpansion: { newComponents: ['New'] },
  }));
  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['API', 'New'], deferredComponents: [] },
  });
  const scorerOutput = score(relocked.state.topology, {
    value: 0.5,
    currentRound: relocked.state.currentRound,
    priorAmbiguity: relocked.state.priorRounds.at(-2),
    priorBand: relocked.state.priorBandHistory.at(-2),
    priorRounds: relocked.state.priorRounds.slice(0, -1),
    priorBandHistory: relocked.state.priorBandHistory.slice(0, -1),
    priorPanelRound: relocked.state.priorPanelRound,
  });
  assert.equal(scorerOutput.stallDetected, false);
  const result = reduceTransition(relocked.state, {
    type: 'baseline_scored',
    payload: { scorerOutput, coverageByComponent: relocked.state.coverageByComponent },
  });
  assert.equal(result.state.lastScorerOutput.stallDetected, false);
  assert.equal(result.state.priorRounds.length, result.state.currentRound + 1);
});

test('reopened baseline mutates only null-scored active components', () => {
  const baseline = baselineState({ activeComponents: ['A', 'B'], value: 0.5 });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['New'] },
  }));
  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['A', 'B', 'New'], deferredComponents: [] },
  });
  assert.deepEqual(relocked.action.payload.components, ['New']);
  const scorerOutput = score(relocked.state.topology, {
    currentRound: relocked.state.currentRound,
    priorAmbiguity: relocked.state.priorRounds.at(-2),
    priorBand: relocked.state.priorBandHistory.at(-2),
    priorRounds: relocked.state.priorRounds.slice(0, -1),
    priorBandHistory: relocked.state.priorBandHistory.slice(0, -1),
    priorPanelRound: relocked.state.priorPanelRound,
  });
  const forgedSnapshot = clone(relocked.state.coverageByComponent);
  forgedSnapshot.A.coverage.preferences = {
    status: 'explicit_none', source: 'user', source_round: relocked.state.currentRound, items: [],
  };
  expectInvalid(relocked.state, {
    type: 'baseline_scored', payload: { scorerOutput, coverageByComponent: forgedSnapshot },
  });

  const allowedSnapshot = clone(relocked.state.coverageByComponent);
  allowedSnapshot.New = completeCoverage(3, relocked.state.currentRound);
  const accepted = reduceTransition(relocked.state, {
    type: 'baseline_scored', payload: { scorerOutput, coverageByComponent: allowedSnapshot },
  });
  assert.deepEqual(accepted.state.coverageByComponent.A, relocked.state.coverageByComponent.A);
});

test('reopened baseline rejects retained-score-only mutation before commit', () => {
  const baseline = baselineState({ activeComponents: ['Retained'], value: 0.5 });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    value: 0.5,
    scopeExpansion: { newComponents: ['Pending'] },
  }));
  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['Retained', 'Pending'], deferredComponents: [] },
  });
  const scorerOutput = score(relocked.state.topology, {
    currentRound: relocked.state.currentRound,
    priorAmbiguity: relocked.state.priorRounds.at(-2),
    priorBand: relocked.state.priorBandHistory.at(-2),
    priorRounds: relocked.state.priorRounds.slice(0, -1),
    priorBandHistory: relocked.state.priorBandHistory.slice(0, -1),
    priorPanelRound: relocked.state.priorPanelRound,
    scoresByName: {
      Retained: { goal: 0.6, constraints: 0.6, criteria: 0.6 },
      Pending: { goal: 0.5, constraints: 0.5, criteria: 0.5 },
    },
  });
  assert.notDeepEqual(
    scorerOutput.perComponent.find((component) => component.name === 'Retained').scores,
    relocked.state.scoreStateMatrix.Retained,
  );
  expectInvalid(relocked.state, {
    type: 'baseline_scored',
    payload: { scorerOutput, coverageByComponent: relocked.state.coverageByComponent },
  });
});

test('baseline provenance rejects forged retained-component null and mutation', () => {
  const baseline = baselineState({ activeComponents: ['A', 'B'], value: 0.5 });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['New'] },
  }));
  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['A', 'B', 'New'], deferredComponents: [] },
  });
  assert.deepEqual(relocked.state.pendingBaselineComponents, ['New']);

  const forged = clone(relocked.state);
  forged.scoreStateMatrix.A = null;
  const forgedSnapshot = clone(forged.coverageByComponent);
  forgedSnapshot.A.coverage.preferences = {
    status: 'explicit_none', source: 'user', source_round: forged.currentRound, items: [],
  };
  const scorerOutput = score(forged.topology, {
    currentRound: forged.currentRound,
    priorAmbiguity: forged.priorRounds.at(-2),
    priorBand: forged.priorBandHistory.at(-2),
    priorRounds: forged.priorRounds.slice(0, -1),
    priorBandHistory: forged.priorBandHistory.slice(0, -1),
    priorPanelRound: forged.priorPanelRound,
  });
  expectInvalid(forged, {
    type: 'baseline_scored', payload: { scorerOutput, coverageByComponent: forgedSnapshot },
  });
});

test('user_stop is legal from initial and reopened BASELINE with pending null scores', () => {
  const initial = topologyState({ activeComponents: ['Initial'] });
  assert.deepEqual(initial.state.pendingBaselineComponents, ['Initial']);
  const initialStop = reduceTransition(initial.state, { type: 'user_stop', payload: {} });
  assert.equal(initialStop.state.phase, 'STOPPED');
  assert.deepEqual(initialStop.state.pendingBaselineComponents, ['Initial']);
  assert.deepEqual(initialStop.action, { type: 'stop', payload: {} });

  const baseline = baselineState({ activeComponents: ['Retained'], value: 0.5 });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['Pending'] },
  }));
  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['Retained', 'Pending'], deferredComponents: [] },
  });
  const reopenedStop = reduceTransition(relocked.state, { type: 'user_stop', payload: {} });
  assert.equal(reopenedStop.state.phase, 'WRITE');
  assert.deepEqual(reopenedStop.state.pendingBaselineComponents, ['Pending']);
  assert.deepEqual(reopenedStop.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
  const incomplete = reduceTransition(
    reopenedStop.state,
    specWrittenEvent(reopenedStop.state, 'incomplete', '.omo/specs/ulw-interview-baseline-stop.md'),
  );
  assert.equal(incomplete.state.phase, 'INCOMPLETE');
  assert.deepEqual(incomplete.state.pendingBaselineComponents, ['Pending']);
});

test('pending panel state rejects reversed personas and forged scope or ceiling', () => {
  const baseline = baselineState({ value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));

  const reversed = clone(dispatch.state);
  reversed.pendingPanelPersonas.reverse();
  expectInvalid(reversed, { type: 'panel_dispatched', payload: { personas: reversed.pendingPanelPersonas } });

  const forgedScope = clone(dispatch.state);
  forgedScope.scopeChangedSincePanel = true;
  expectInvalid(forgedScope, { type: 'user_stop', payload: {} });

  const forgedCeiling = clone(dispatch.state);
  forgedCeiling.panelDispatchCount = forgedCeiling.panelCeiling - 1;
  expectInvalid(forgedCeiling, { type: 'user_stop', payload: {} });
});

test('pending panel target and acknowledged round bindings cannot be forged', () => {
  const baseline = baselineState({ value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const forgedTarget = clone(dispatch.state);
  forgedTarget.pendingTarget.dimension = forgedTarget.pendingTarget.dimension === 'goal' ? 'criteria' : 'goal';
  expectInvalid(forgedTarget, { type: 'user_stop', payload: {} });

  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched',
    payload: { personas: dispatch.state.pendingPanelPersonas },
  });
  const forgedRound = clone(acknowledged.state);
  forgedRound.priorPanelRound -= 1;
  expectInvalid(forgedRound, { type: 'user_stop', payload: {} });
});

test('mixed-case ties follow scorer raw ordering and never use localeCompare', () => {
  const topology = topologyState({ activeComponents: ['a', 'B'] });
  assert.deepEqual(topology.action.payload.components, ['B', 'a']);
  const scorerOutput = score(['a', 'B'], {
    currentRound: 0,
    scoresByName: {
      a: { goal: 0.5, constraints: 0.5, criteria: 0.5 },
      B: { goal: 0.5, constraints: 0.5, criteria: 0.5 },
    },
  });
  assert.equal(scorerOutput.nextTarget.component, 'B');
  const result = reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: {
      scorerOutput,
      coverageByComponent: { a: openCoverage(), B: openCoverage() },
    },
  });
  assert.equal(result.action.payload.target.component, 'B');
  assert.doesNotMatch(readFileSync(transitionPath, 'utf8'), /localeCompare/);
});

test('impossible panel counts closure counters and hard-cap histories are rejected', () => {
  const baseline = baselineState();
  const mutations = [
    (state) => { state.panelDispatchCount = 1; },
    (state) => { state.priorPanelRound = 0; },
    (state) => { state.closureRejections = 3; },
    (state) => { state.hardCapReached = true; },
  ];
  for (const mutate of mutations) {
    const state = clone(baseline.state);
    mutate(state);
    expectInvalid(state, { type: 'user_stop', payload: {} });
  }

  const round = reduceTransition(baseline.state, roundEvent(baseline.state)).state;
  const impossiblePartialCount = clone(round);
  impossiblePartialCount.panelDispatchCount = 1;
  impossiblePartialCount.priorPanelRound = 1;
  expectInvalid(impossiblePartialCount, { type: 'user_stop', payload: {} });

  const panelBaseline = baselineState({ initialize: { panelCeiling: 6 }, value: 0.8 });
  const panelDispatch = reduceTransition(panelBaseline.state, roundEvent(panelBaseline.state, { value: 0.5 }));
  const acknowledged = reduceTransition(panelDispatch.state, {
    type: 'panel_dispatched', payload: { personas: panelDispatch.state.pendingPanelPersonas },
  });
  assert.equal(acknowledged.state.currentRound, 1);
  assert.equal(acknowledged.state.panelDispatchCount, 3);
  const impossibleAtRoundOne = clone(acknowledged.state);
  impossibleAtRoundOne.panelDispatchCount = 6;
  expectInvalid(impossibleAtRoundOne, { type: 'user_stop', payload: {} });
});

test('panel count cannot claim a second dispatch without immutable history', () => {
  const baseline = baselineState({ value: 0.3 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched', payload: { personas: dispatch.state.pendingPanelPersonas },
  });
  const completed = reduceTransition(acknowledged.state, {
    type: 'panel_completed',
    payload: {
      findings: acknowledged.state.pendingPanelPersonas.map((persona) => ({
        persona, summary: `${persona} finding`, options: [], confidence: 'high',
      })),
    },
  });
  const roundTwo = reduceTransition(completed.state, roundEvent(completed.state, { value: 0.5 }));
  assert.equal(roundTwo.state.currentRound, 2);
  assert.equal(roundTwo.state.priorPanelRound, 1);
  const forged = clone(roundTwo.state);
  forged.panelDispatchCount = 6;
  expectInvalid(forged, { type: 'user_stop', payload: {} });
});

test('panel dispatch history is canonical derived and cooldown ordered', () => {
  const baseline = baselineState({ value: 0.3 });
  const firstDispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const firstAcknowledged = reduceTransition(firstDispatch.state, {
    type: 'panel_dispatched', payload: { personas: firstDispatch.state.pendingPanelPersonas },
  });
  const firstCompleted = reduceTransition(firstAcknowledged.state, {
    type: 'panel_completed',
    payload: {
      findings: firstAcknowledged.state.pendingPanelPersonas.map((persona) => ({
        persona, summary: `${persona} first`, options: [], confidence: 'high',
      })),
    },
  });
  const roundTwo = reduceTransition(firstCompleted.state, roundEvent(firstCompleted.state, { value: 0.5 }));
  const roundThree = reduceTransition(roundTwo.state, roundEvent(roundTwo.state, { value: 0.5 }));
  const secondDispatch = reduceTransition(roundThree.state, roundEvent(roundThree.state, { value: 0.8 }));
  assert.equal(secondDispatch.action.type, 'dispatch_panel');
  const secondAcknowledged = reduceTransition(secondDispatch.state, {
    type: 'panel_dispatched', payload: { personas: secondDispatch.state.pendingPanelPersonas },
  });
  assert.deepEqual(secondAcknowledged.state.panelDispatchHistory, [
    {
      round: 1,
      personas: ['researcher', 'contrarian', 'simplifier'],
      panelCooldown: 2,
      globalAmbiguity: 0.5,
      band: 'progress',
    },
    {
      round: 4,
      personas: ['researcher', 'contrarian', 'simplifier'],
      panelCooldown: 2,
      globalAmbiguity: 0.2,
      band: 'refined',
    },
  ]);
  assert.equal(secondAcknowledged.state.panelDispatchCount, 6);
  assert.equal(secondAcknowledged.state.priorPanelRound, 4);

  const secondCompleted = reduceTransition(secondAcknowledged.state, {
    type: 'panel_completed',
    payload: {
      findings: secondAcknowledged.state.pendingPanelPersonas.map((persona) => ({
        persona, summary: `${persona} second`, options: [], confidence: 'high',
      })),
    },
  });
  const roundFive = reduceTransition(secondCompleted.state, roundEvent(secondCompleted.state, { value: 0.8 }));
  const exactCooldownGap = clone(roundFive.state);
  exactCooldownGap.panelDispatchHistory[1].round = 3;
  exactCooldownGap.priorPanelRound = 3;
  assert.deepEqual(exactCooldownGap.panelDispatchHistory.map((entry) => entry.round), [1, 3]);
  expectInvalid(exactCooldownGap, { type: 'user_stop', payload: {} });

  const mutations = [
    (state) => { state.panelDispatchCount = 3; },
    (state) => { state.priorPanelRound = 1; },
    (state) => { state.panelDispatchHistory[1].panelCooldown = 1; },
    (state) => { state.panelDispatchHistory.reverse(); },
    (state) => { state.panelDispatchHistory[0].personas.reverse(); },
    (state) => { state.panelDispatchHistory[0].round = 3; },
    (state) => { state.panelDispatchHistory[0].extra = true; },
  ];
  for (const mutate of mutations) {
    const forged = clone(roundFive.state);
    mutate(forged);
    expectInvalid(forged, { type: 'user_stop', payload: {} });
  }
});

test('every historical ambiguity matches its range band and effective threshold', () => {
  const baseline = baselineState();
  const round = reduceTransition(baseline.state, roundEvent(baseline.state)).state;
  const invalidHistories = [
    (state) => { state.priorRounds[0] = -0.1; },
    (state) => { state.priorRounds[0] = 1.1; },
    (state) => { state.priorBandHistory[0] = 'ready'; },
  ];
  for (const mutate of invalidHistories) {
    const state = clone(round);
    mutate(state);
    expectInvalid(state, { type: 'user_stop', payload: {} });
  }
});

test('stored scorer history flags must match the committed observation sequence', () => {
  const baseline = baselineState();
  const round = reduceTransition(baseline.state, roundEvent(baseline.state)).state;
  for (const field of ['bandChanged', 'stallDetected', 'suppressPanelForOscillation']) {
    const forged = clone(round);
    forged.lastScorerOutput[field] = !forged.lastScorerOutput[field];
    expectInvalid(forged, { type: 'user_stop', payload: {} });
  }
});

test('hard-cap closure context cannot be downgraded before closure passes', () => {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const generated = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  assert.deepEqual(generated.state.closureContext, { hardCap: true, earlyExit: false, stage: 'pending' });
  const downgraded = clone(generated.state);
  downgraded.closureContext = { hardCap: false, earlyExit: false, stage: 'pending' };
  expectInvalid(downgraded, { type: 'closure_passed', payload: {} });
});

test('cap-round RESTATE cannot downgrade hardCapReached after closure passes', () => {
  const { restate } = hardCapCompletePath();
  assert.equal(restate.state.hardCapReached, true);
  const downgraded = clone(restate.state);
  downgraded.hardCapReached = false;
  expectInvalid(downgraded, { type: 'restate_confirmed', payload: {} });
});

test('cap-round complete WRITE cannot downgrade hardCapReached', () => {
  const { write } = hardCapCompletePath();
  assert.equal(write.state.pendingWriteKind, 'complete');
  assert.equal(write.state.hardCapReached, true);
  const downgraded = clone(write.state);
  downgraded.hardCapReached = false;
  expectInvalid(
    downgraded,
    specWrittenEvent(downgraded, 'complete', '.omo/specs/ulw-interview-forged.md'),
  );
});

test('cap-round DONE cannot re-enable continuation by downgrading hardCapReached', () => {
  const { done } = hardCapCompletePath();
  assert.equal(done.action.payload.allowContinue, false);
  expectInvalid(done.state, { type: 'continue_interview', payload: {} });
  const downgraded = clone(done.state);
  downgraded.hardCapReached = false;
  expectInvalid(downgraded, { type: 'start_planning', payload: {} });
});

test('stored scorer panel eligibility cannot be coherently downgraded', () => {
  const baseline = baselineState();
  assert.equal(baseline.state.lastScorerOutput.nextPanelEligible, true);
  const forged = clone(baseline.state);
  forged.lastScorerOutput.nextPanelEligible = false;
  forged.lastScorerOutput.dispatchPanel = false;
  expectInvalid(forged, { type: 'user_stop', payload: {} });
});

test('active score matrix must equal committed scorer component scores', () => {
  const baseline = baselineState();
  const forged = clone(baseline.state);
  forged.scoreStateMatrix.API.goal = 0.25;
  expectInvalid(forged, { type: 'user_stop', payload: {} });
});

test('state streak counter must equal the committed scorer streak counter', () => {
  const baseline = baselineState();
  const forged = clone(baseline.state);
  forged.streakCounter += 1;
  expectInvalid(forged, { type: 'user_stop', payload: {} });
});

test('degraded state is sticky and cannot contradict the last scorer output', () => {
  const topology = topologyState();
  const scorerOutput = score(['API'], { currentRound: 0, degraded: true });
  const degraded = reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput, coverageByComponent: { API: completeCoverage(1) } },
  });
  assert.equal(degraded.state.degraded, true);
  const forged = clone(degraded.state);
  forged.degraded = false;
  expectInvalid(forged, { type: 'user_stop', payload: {} });
});

test('stop and write clear panel and scope-change transients together', () => {
  const baseline = baselineState({ value: 0.8 });
  const scopeState = clone(baseline.state);
  scopeState.scopeChangedSincePanel = true;
  const dispatch = reduceTransition(scopeState, roundEvent(scopeState, { value: 0.5 }));
  const stopped = reduceTransition(dispatch.state, { type: 'user_stop', payload: {} });
  assert.equal(stopped.state.phase, 'WRITE');
  assert.equal(stopped.state.panelStage, 'none');
  assert.equal(stopped.state.scopeChangedSincePanel, false);
});

test('brownfield scores require context exactly and preserve declared type', () => {
  const topology = topologyState({ initialize: { declaredType: 'brownfield' } });
  const scorerOutput = score(['API'], { type: 'brownfield', currentRound: 0 });
  const result = reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput, coverageByComponent: { API: completeCoverage(1) } },
  });
  assert.equal(result.state.declaredType, 'brownfield');
  assert.equal(typeof result.state.scoreStateMatrix.API.context, 'number');

  const missingContext = clone(scorerOutput);
  delete missingContext.perComponent[0].scores.context;
  expectInvalid(topology.state, {
    type: 'baseline_scored',
    payload: { scorerOutput: missingContext, coverageByComponent: { API: completeCoverage(1) } },
  });
});

test('strict full-state validation rejects unknown missing and inconsistent transients', () => {
  const baseline = baselineState();
  const mutations = [
    (state) => { state.extra = true; },
    (state) => { delete state.version; },
    (state) => { state.priorRounds.push(0.5); },
    (state) => { state.panelDispatchCount = state.panelCeiling + 1; },
    (state) => { state.pendingTarget = state.askedTarget; },
    (state) => { state.closureContext = { hardCap: false, earlyExit: false }; },
    (state) => { state.pendingWriteKind = 'complete'; },
    (state) => { state.scoreStateMatrix.API = null; },
  ];
  for (const mutate of mutations) {
    const state = clone(baseline.state);
    mutate(state);
    expectInvalid(state, roundEvent(baseline.state));
  }
});

test('unscored state cannot forge WRITE or terminal artifact phases', () => {
  for (const phase of ['WRITE', 'DONE', 'INCOMPLETE']) {
    const forged = clone(initialize().state);
    forged.phase = phase;
    if (phase === 'WRITE') forged.pendingWriteKind = 'complete';
    if (phase !== 'WRITE') forged.writtenSpecPath = '.omo/specs/ulw-interview-forged.md';
    expectInvalid(forged, { type: 'finish', payload: {} });
  }
});

test('DONE requires reachable closure and restatement provenance', () => {
  for (const baseline of [
    baselineState({ coverageByComponent: { API: openCoverage() }, value: 0.5 }),
    baselineState({ value: 0.5 }),
  ]) {
    const forged = clone(baseline.state);
    forged.phase = 'DONE';
    forged.askedTarget = null;
    forged.writtenSpecPath = '.omo/specs/ulw-interview-forged-done.md';
    expectInvalid(forged, { type: 'start_planning', payload: {} });
  }
  const closure = readyClosure();
  const forgedClosure = clone(closure.state);
  forgedClosure.phase = 'DONE';
  forgedClosure.writtenSpecPath = '.omo/specs/ulw-interview-forged-closure.md';
  expectInvalid(forgedClosure, { type: 'start_planning', payload: {} });
});

test('serialized state accepts exactly one MiB and rejects one byte over at input', () => {
  const baseline = baselineState();
  const exact = clone(baseline.state);
  const text = exact.coverageByComponent.API.coverage.outcome.items[0];
  text.text = 'x';
  const remainingBytes = MAX_SERIALIZED_STATE_BYTES - Buffer.byteLength(JSON.stringify(exact));
  assert.ok(remainingBytes > 0);
  text.text += 'x'.repeat(remainingBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), MAX_SERIALIZED_STATE_BYTES);

  const accepted = reduceTransition(exact, { type: 'user_stop', payload: {} });
  assert.equal(accepted.state.phase, 'WRITE');

  const overflow = clone(exact);
  overflow.coverageByComponent.API.coverage.outcome.items[0].text += 'x';
  assert.equal(Buffer.byteLength(JSON.stringify(overflow)), MAX_SERIALIZED_STATE_BYTES + 1);
  expectInvalid(overflow, { type: 'user_stop', payload: {} });
});

test('produced state rejects a round commit that crosses one MiB', () => {
  const baseline = baselineState();
  const coverageByComponent = clone(baseline.state.coverageByComponent);
  coverageByComponent.API.coverage.preferences = {
    status: 'confirmed',
    source: 'user',
    source_round: 1,
    items: [{
      id: 'P2',
      text: 'x'.repeat(MAX_SERIALIZED_STATE_BYTES),
      source: 'user',
      source_round: 1,
      state: 'active',
      supersedes: null,
    }],
  };
  expectInvalid(baseline.state, roundEvent(baseline.state, { coverageByComponent }));
});

test('manifest projection budget keeps accepted WRITE states acknowledgeable', () => {
  const topology = topologyState({ initialize: { roundCap: 1 } });
  const scorerOutput = score(['API'], { currentRound: 0, value: 0.5 });
  const acceptedCoverage = { API: manyMissingEvidenceCoverage(2000) };
  const baseline = reduceTransition(topology.state, {
    type: 'baseline_scored', payload: { scorerOutput, coverageByComponent: acceptedCoverage },
  });
  const write = reduceTransition(baseline.state, { type: 'user_stop', payload: {} });
  const event = specWrittenEvent(
    write.state,
    'incomplete',
    '.omo/specs/ulw-interview-large-projection.md',
  );
  assert.ok(Buffer.byteLength(JSON.stringify(event)) <= MAX_SERIALIZED_EVENT_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(specManifest(write.state))) <= MAX_SERIALIZED_PROJECTION_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(write)) <= MAX_SERIALIZED_RESULT_BYTES);
  const acknowledged = reduceTransition(write.state, event);
  assert.equal(acknowledged.state.phase, 'INCOMPLETE');

  const oversizedCoverage = { API: manyMissingEvidenceCoverage(6000) };
  expectInvalid(topology.state, {
    type: 'baseline_scored', payload: { scorerOutput, coverageByComponent: oversizedCoverage },
  });
});

test('serialized events accept one MiB and reject one byte over', () => {
  const baseline = baselineState({ value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched',
    payload: { personas: dispatch.state.pendingPanelPersonas },
  });
  const event = {
    type: 'panel_completed',
    payload: {
      findings: acknowledged.state.pendingPanelPersonas.map((persona) => ({
        persona,
        summary: '',
        options: [],
        confidence: 'medium',
      })),
    },
  };
  event.payload.findings[0].summary = 'x'.repeat(
    MAX_SERIALIZED_EVENT_BYTES - Buffer.byteLength(JSON.stringify(event)),
  );
  assert.equal(Buffer.byteLength(JSON.stringify(event)), MAX_SERIALIZED_EVENT_BYTES);
  const accepted = reduceTransition(acknowledged.state, event);
  assert.equal(accepted.action.type, 'ask_target');
  event.payload.findings[0].summary += 'x';
  assert.equal(Buffer.byteLength(JSON.stringify(event)), MAX_SERIALIZED_EVENT_BYTES + 1);
  expectInvalid(acknowledged.state, event);
});

test('event envelopes payloads targets findings and refine output reject malformed data', () => {
  const baseline = baselineState();
  const malformed = [
    null,
    {},
    { type: 'round_scored' },
    { type: 'round_scored', payload: {}, extra: true },
    { type: 'unknown', payload: {} },
  ];
  for (const event of malformed) expectInvalid(baseline.state, event);

  const extraPayload = roundEvent(baseline.state);
  extraPayload.payload.extra = true;
  expectInvalid(baseline.state, extraPayload);

  const badRefine = roundEvent(baseline.state);
  badRefine.payload.refineOutput = { shouldRefine: true, reason: 'refine', target: 'criteria' };
  expectInvalid(baseline.state, badRefine);

  const panel = clone(baseline.state);
  panel.panelStage = 'awaiting_results';
  panel.pendingTarget = panel.askedTarget;
  panel.askedTarget = null;
  expectInvalid(panel, {
    type: 'panel_completed',
    payload: { findings: [{ summary: 'x', options: [], confidence: 'certain' }] },
  });
});

test('unexpected reducer defects retain their original diagnostic identity', () => {
  const state = clone(baselineState().state);
  const sentinel = new Error('unexpected-sentinel');
  Object.defineProperty(state, 'scoreStateMatrix', {
    enumerable: true,
    get() { throw sentinel; },
  });
  assert.throws(
    () => reduceTransition(state, { type: 'user_stop', payload: {} }),
    (error) => error === sentinel,
  );

  const child = spawnSync('node', ['--input-type=module', '-e', `
    import { reduceTransition } from ${JSON.stringify(new URL('./transition.mjs', import.meta.url).href)};
    const initialized = reduceTransition(null, {
      type: 'initialize',
      payload: { interviewId: 'unexpected-1', declaredType: 'greenfield', threshold: 0.05, roundCap: 30, softWarningRounds: 15, panelCeiling: 30 }
    }).state;
    Object.defineProperty(initialized, 'scoreStateMatrix', { enumerable: true, get() { throw new Error('unexpected-sentinel'); } });
    reduceTransition(initialized, { type: 'user_stop', payload: {} });
  `], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /unexpected-sentinel/);
  assert.doesNotMatch(child.stderr, /invalid event/);

  const syntaxSentinel = new SyntaxError('unexpected-syntax-sentinel');
  const syntaxState = clone(baselineState().state);
  Object.defineProperty(syntaxState, 'scoreStateMatrix', {
    enumerable: true,
    get() { throw syntaxSentinel; },
  });
  assert.throws(
    () => reduceTransition(syntaxState, { type: 'user_stop', payload: {} }),
    (error) => error === syntaxSentinel,
  );
  assert.equal(
    formatExecutionError(syntaxSentinel, {
      state: syntaxState,
      event: { type: 'user_stop', payload: {} },
    }),
    'transition.mjs: SyntaxError: unexpected-syntax-sentinel\n',
  );
  const source = readFileSync(transitionPath, 'utf8');
  assert.doesNotMatch(source, /TransitionContractError\s*\|\|\s*error instanceof SyntaxError/);
});

test('every non-matrix phase and event pairing is illegal', () => {
  const topology = initialize().state;
  const baseline = topologyState().state;
  const round = baselineState().state;
  const closure = readyClosure().state;
  const restate = reduceTransition(closure, { type: 'closure_passed', payload: {} }).state;
  const write = completeWrite().state;
  const done = doneState().state;
  const incomplete = incompleteState().state;
  const stopped = reduceTransition(done, { type: 'finish', payload: {} }).state;
  const states = { TOPOLOGY: topology, BASELINE: baseline, ROUND: round, CLOSURE: closure, RESTATE: restate, WRITE: write, DONE: done, INCOMPLETE: incomplete, STOPPED: stopped };
  const legal = {
    TOPOLOGY: new Set(['topology_confirmed', 'user_stop']),
    BASELINE: new Set(['baseline_scored', 'user_stop']),
    ROUND: new Set(['round_scored', 'panel_dispatched', 'panel_completed', 'panel_failed', 'user_stop']),
    CLOSURE: new Set(['closure_passed', 'closure_rejected', 'user_stop']),
    RESTATE: new Set(['restate_confirmed', 'restate_corrected', 'user_stop']),
    WRITE: new Set(['spec_written']),
    DONE: new Set(['continue_interview', 'start_planning', 'finish']),
    INCOMPLETE: new Set(),
    STOPPED: new Set(),
  };
  let rejected = 0;
  for (const [phase, state] of Object.entries(states)) {
    for (const type of EVENT_TYPES) {
      if (legal[phase].has(type)) continue;
      expectInvalid(state, { type, payload: {} });
      rejected += 1;
    }
  }
  assert.equal(rejected, 125);
  coverageMetrics.illegalPhaseEventPairs = rejected;
});

test('CLI is byte-deterministic across environment cwd clock delay and random-looking values', () => {
  const input = {
    state: null,
    event: {
      type: 'initialize',
      payload: {
        interviewId: 'qa-random-1700000000000',
        declaredType: 'greenfield',
        threshold: 0.05,
        roundCap: 30,
        softWarningRounds: 15,
        panelCeiling: 30,
      },
    },
  };
  const runs = Array.from({ length: 10 }, (_, index) => runCli(input, {
    cwd: index % 2 === 0 ? runtimeDir : tmpdir(),
    env: { ...process.env, ULW_SENTINEL: `run-${index}` },
  }));
  for (const run of runs) {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');
  }
  assert.equal(new Set(runs.map((run) => run.stdout)).size, 1);
});

test('CLI errors emit no stdout and cannot print misleading success', () => {
  const invalidJson = runCli('{not-json');
  assert.equal(invalidJson.status, 1);
  assert.equal(invalidJson.stdout, '');
  assert.match(invalidJson.stderr, /^transition\.mjs: invalid event unknown for phase null/);

  const invalidEvent = runCli({ state: null, event: { type: 'finish', payload: {} } });
  assert.equal(invalidEvent.status, 1);
  assert.equal(invalidEvent.stdout, '');
  assert.equal(invalidEvent.stderr, 'transition.mjs: invalid event finish for phase null\n');
  assert.doesNotMatch(invalidEvent.stderr, /PASS|success|ok/i);
});

test('CLI rejects oversized raw input before JSON parsing', () => {
  const oversized = runCli('x'.repeat(MAX_RAW_TRANSITION_BYTES + 1));
  assert.equal(oversized.status, 1);
  assert.equal(oversized.stdout, '');
  assert.equal(
    oversized.stderr,
    `transition.mjs: input exceeds ${MAX_RAW_TRANSITION_BYTES} bytes\n`,
  );
});

test('reducer source contains no clock randomness environment cwd subprocess network or persistence reads', () => {
  const source = readFileSync(transitionPath, 'utf8');
  const forbidden = [
    /Date\s*\./,
    /new\s+Date/,
    /Math\.random/,
    /process\.env/,
    /process\.cwd/,
    /child_process/,
    /https?:/,
    /writeFile/,
    /readFileSync/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern);
});

test('every scenario driver executes and reports its advertised name', () => {
  for (const [name, scenario] of scenarios) {
    const output = scenario();
    assert.equal(output.status, 'PASS', name);
    assert.equal(output.scenario, name);
  }
});

function assertScenarioOutcome(result, expectedPhase, expectedAction) {
  assert.equal(result.state.phase, expectedPhase);
  assert.equal(result.action.type, expectedAction);
}

function happyScenario() {
  const done = doneState();
  assertScenarioOutcome(done, 'DONE', 'offer_post_spec');
  return { status: 'PASS', scenario: 'happy', finalPhase: done.state.phase, action: done.action.type };
}

function semanticGapScenario() {
  const baseline = baselineState({ coverageByComponent: { API: openCoverage() } });
  const result = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  assertScenarioOutcome(result, 'ROUND', 'ask_target');
  assert.equal(result.action.payload.target.kind, 'coverage');
  return {
    status: 'PASS',
    scenario: 'semantic-gap',
    finalPhase: result.state.phase,
    action: result.action.type,
    targetKind: result.action.payload.target.kind,
  };
}

function hardCapScenario() {
  const incomplete = incompleteState();
  assertScenarioOutcome(incomplete, 'INCOMPLETE', 'stop');
  return { status: 'PASS', scenario: 'hard-cap', finalPhase: incomplete.state.phase, action: incomplete.action.type };
}

function postSpecScenario() {
  const done = doneState();
  const planning = reduceTransition(done.state, { type: 'start_planning', payload: {} });
  assertScenarioOutcome(planning, 'DONE', 'start_planning');
  assert.deepEqual(planning.action, {
    type: 'start_planning', payload: { specPath: done.state.writtenSpecPath },
  });
  return {
    status: 'PASS',
    scenario: 'post-spec',
    finalPhase: planning.state.phase,
    action: planning.action.type,
    specPath: planning.action.payload.specPath,
  };
}

function scopeReopenScenario() {
  const baseline = baselineState({ activeComponents: ['Core'] });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['Search'] },
  }));
  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['Core', 'Search'], deferredComponents: [] },
  });
  assertScenarioOutcome(relocked, 'BASELINE', 'run_baseline');
  assert.deepEqual(relocked.action.payload.components, ['Search']);
  return {
    status: 'PASS',
    scenario: 'scope-reopen',
    finalPhase: relocked.state.phase,
    action: relocked.action.type,
    components: relocked.action.payload.components,
  };
}

function reopenedBaselineStopScenario() {
  const baseline = baselineState({ activeComponents: ['Retained'], value: 0.5 });
  const reopened = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['Pending'] },
  }));
  const relocked = reduceTransition(reopened.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['Retained', 'Pending'], deferredComponents: [] },
  });
  const stopped = reduceTransition(relocked.state, { type: 'user_stop', payload: {} });
  assertScenarioOutcome(stopped, 'WRITE', 'write_spec');
  assert.deepEqual(stopped.state.pendingBaselineComponents, ['Pending']);
  assert.deepEqual(stopped.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
  return {
    status: 'PASS',
    scenario: 'reopened-baseline-stop',
    finalPhase: stopped.state.phase,
    action: stopped.action.type,
    kind: stopped.action.payload.kind,
    pendingBaselineComponents: stopped.state.pendingBaselineComponents,
  };
}

function restateCorrectionScenario() {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  const restate = reduceTransition(closure.state, { type: 'closure_passed', payload: {} });
  const corrected = reduceTransition(restate.state, {
    type: 'restate_corrected',
    payload: { target: { kind: 'coverage', component: 'API', category: 'must_nots', itemId: null } },
  });
  assertScenarioOutcome(corrected, 'WRITE', 'write_spec');
  assert.equal(corrected.state.hardCapReached, true);
  assert.deepEqual(corrected.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
  return {
    status: 'PASS',
    scenario: 'restate-correction',
    finalPhase: corrected.state.phase,
    action: corrected.action.type,
    kind: corrected.action.payload.kind,
  };
}

function stopHighScenario() {
  const baseline = baselineState({ value: 0.5 });
  const stopped = reduceTransition(baseline.state, { type: 'user_stop', payload: {} });
  assertScenarioOutcome(stopped, 'WRITE', 'write_spec');
  assert.deepEqual(stopped.action, { type: 'write_spec', payload: { kind: 'incomplete' } });
  return { status: 'PASS', scenario: 'stop-high', finalPhase: stopped.state.phase, action: stopped.action.type };
}

function stopLowScenario() {
  const stopped = reduceTransition(initialize().state, { type: 'user_stop', payload: {} });
  assertScenarioOutcome(stopped, 'STOPPED', 'stop');
  assert.deepEqual(stopped.action, { type: 'stop', payload: {} });
  return { status: 'PASS', scenario: 'stop-low', finalPhase: stopped.state.phase, action: stopped.action.type };
}

function capScopeExpansionScenario() {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const result = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['DiscoveredAtCap'] },
  }));
  assertScenarioOutcome(result, 'WRITE', 'write_spec');
  assert.deepEqual(result.state.deferredComponents, ['DiscoveredAtCap']);
  assert.equal(result.state.scoreStateMatrix.DiscoveredAtCap, null);
  assert.deepEqual(result.state.coverageByComponent.DiscoveredAtCap, openCoverage());
  assert.equal(result.state.scopeChangedSincePanel, true);
  return {
    status: 'PASS',
    scenario: 'cap-scope-expansion',
    finalPhase: result.state.phase,
    action: result.action.type,
    deferredComponents: result.state.deferredComponents,
    deferredScore: result.state.scoreStateMatrix.DiscoveredAtCap,
    scopeChangedSincePanel: result.state.scopeChangedSincePanel,
    semanticGaps: result.semanticCoverageGaps.length,
  };
}

function gapShortCircuitScenario() {
  const hardCapBaseline = baselineState({
    initialize: { roundCap: 1 },
    coverageByComponent: { API: openCoverage() },
  });
  const hardCap = reduceTransition(
    hardCapBaseline.state,
    roundEvent(hardCapBaseline.state, { value: 0.96 }),
  );
  assertScenarioOutcome(hardCap, 'WRITE', 'write_spec');
  const earlyBaseline = baselineState({ coverageByComponent: { API: openCoverage() }, value: 0.8 });
  const earlyExit = reduceTransition(earlyBaseline.state, roundEvent(earlyBaseline.state, {
    value: 0.8,
    earlyExitRequested: true,
  }));
  assertScenarioOutcome(earlyExit, 'WRITE', 'write_spec');
  return {
    status: 'PASS',
    scenario: 'gap-short-circuit',
    hardCap: { action: hardCap.action.type, gaps: hardCap.semanticCoverageGaps.length },
    earlyExit: { action: earlyExit.action.type, gaps: earlyExit.semanticCoverageGaps.length },
    closureCalls: 0,
  };
}

function panelFailureScenario() {
  const baseline = baselineState({ value: 0.8 });
  const dispatch = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.5 }));
  const acknowledged = reduceTransition(dispatch.state, {
    type: 'panel_dispatched', payload: { personas: dispatch.state.pendingPanelPersonas },
  });
  const result = reduceTransition(acknowledged.state, {
    type: 'panel_failed', payload: { reason: 'invalid_result' },
  });
  assertScenarioOutcome(result, 'ROUND', 'ask_target');
  assert.equal(result.state.panelStage, 'none');
  assert.deepEqual(result.action.payload.target, acknowledged.state.pendingTarget);
  return {
    status: 'PASS',
    scenario: 'panel-failure',
    finalPhase: result.state.phase,
    action: result.action.type,
    panelDispatchCount: result.state.panelDispatchCount,
  };
}

function specManifestScenario() {
  const write = manifestWrite();
  const manifest = specManifest(write.state);
  const validEvent = specWrittenEvent(
    write.state,
    'complete',
    '.omo/specs/ulw-interview-manifest-scenario.md',
  );
  const invalidPayloads = invalidManifestPayloads(validEvent.payload);
  for (const payload of invalidPayloads) {
    expectInvalid(write.state, { type: 'spec_written', payload });
  }
  const done = reduceTransition(
    write.state,
    validEvent,
  );
  assertScenarioOutcome(done, 'DONE', 'offer_post_spec');
  return {
    status: 'PASS',
    scenario: 'spec-manifest',
    finalPhase: done.state.phase,
    action: done.action.type,
    manifest,
    forgeriesRejected: invalidPayloads.length,
  };
}

function boundsScenario() {
  const initialized = initialize().state;
  const atLimit = reduceTransition(initialized, {
    type: 'topology_confirmed',
    payload: {
      activeComponents: ['Active'],
      deferredComponents: Array.from(
        { length: MAX_KNOWN_COMPONENTS - 1 },
        (_, index) => `Deferred-${index + 1}`,
      ),
    },
  });
  assertScenarioOutcome(atLimit, 'BASELINE', 'run_baseline');
  expectInvalid(initialized, {
    type: 'topology_confirmed',
    payload: {
      activeComponents: ['Active'],
      deferredComponents: Array.from({ length: MAX_KNOWN_COMPONENTS }, (_, index) => `Overflow-${index + 1}`),
    },
  });
  expectInvalid(initialized, {
    type: 'topology_confirmed',
    payload: {
      activeComponents: ['Active'],
      deferredComponents: Array.from({ length: 4999 }, (_, index) => `Pathological-${index + 1}`),
    },
  });
  const exactState = clone(baselineState().state);
  const item = exactState.coverageByComponent.API.coverage.outcome.items[0];
  item.text = 'x';
  item.text += 'x'.repeat(MAX_SERIALIZED_STATE_BYTES - Buffer.byteLength(JSON.stringify(exactState)));
  const exactAccepted = reduceTransition(exactState, { type: 'user_stop', payload: {} });
  assertScenarioOutcome(exactAccepted, 'WRITE', 'write_spec');
  const overflowState = clone(exactState);
  overflowState.coverageByComponent.API.coverage.outcome.items[0].text += 'x';
  expectInvalid(overflowState, { type: 'user_stop', payload: {} });
  return {
    status: 'PASS',
    scenario: 'bounds',
    maxNameChars: MAX_COMPONENT_NAME_LENGTH,
    knownAtLimit: atLimit.state.topology.length + atLimit.state.deferredComponents.length,
    knownOverflowRejected: true,
    pathological5000Rejected: true,
    exactStateBytes: Buffer.byteLength(JSON.stringify(exactState)),
    overflowStateBytes: Buffer.byteLength(JSON.stringify(overflowState)),
  };
}

const scenarios = new Map([
  ['happy', happyScenario],
  ['semantic-gap', semanticGapScenario],
  ['hard-cap', hardCapScenario],
  ['post-spec', postSpecScenario],
  ['scope-reopen', scopeReopenScenario],
  ['reopened-baseline-stop', reopenedBaselineStopScenario],
  ['restate-correction', restateCorrectionScenario],
  ['stop-high', stopHighScenario],
  ['stop-low', stopLowScenario],
  ['cap-scope-expansion', capScopeExpansionScenario],
  ['gap-short-circuit', gapShortCircuitScenario],
  ['panel-failure', panelFailureScenario],
  ['spec-manifest', specManifestScenario],
  ['bounds', boundsScenario],
]);

function executeScenario(name) {
  const scenario = scenarios.get(name);
  if (!scenario) throw new Error(`unknown scenario ${name}`);
  return scenario();
}

function runSuite() {
  let passed = 0;
  let failed = 0;
  for (const { name, body } of tests) {
    try {
      body();
      passed += 1;
      process.stdout.write(`  PASS  ${name}\n`);
    } catch (error) {
      process.stderr.write(`transition.test.mjs: ${name}: ${error.message}\n`);
      failed += 1;
    }
  }
  if (failed > 0) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', passed, failed, tests: tests.length })}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    suite: 'transition',
    tests: passed,
    scenarioDrivers: scenarios.size,
    illegalPhaseEventPairs: coverageMetrics.illegalPhaseEventPairs,
  })}\n`);
}

const scenarioOption = process.argv.find((argument) => argument.startsWith('--scenario='));
if (scenarioOption) {
  try {
    process.stdout.write(`${JSON.stringify(executeScenario(scenarioOption.slice('--scenario='.length)))}\n`);
  } catch (error) {
    process.stderr.write(`transition.test.mjs: ${error.message}\n`);
    process.exitCode = 1;
  }
} else {
  runSuite();
}
