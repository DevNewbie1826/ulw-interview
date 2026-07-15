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

function doneState(options = {}) {
  const write = completeWrite(options);
  return reduceTransition(write.state, {
    type: 'spec_written',
    payload: { kind: 'complete', path: '.omo/specs/ulw-interview-interview.md' },
  });
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
  return reduceTransition(write.state, {
    type: 'spec_written',
    payload: { kind: 'incomplete', path: '.omo/specs/ulw-interview-incomplete.md' },
  });
}

function hardCapCompletePath() {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  const restate = reduceTransition(closure.state, { type: 'closure_passed', payload: {} });
  const write = reduceTransition(restate.state, { type: 'restate_confirmed', payload: {} });
  const done = reduceTransition(write.state, {
    type: 'spec_written', payload: { kind: 'complete', path: '.omo/specs/ulw-interview-cap-complete.md' },
  });
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

test('hard cap commits the boundary round before closure and outranks scope expansion', () => {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const result = reduceTransition(baseline.state, roundEvent(baseline.state, {
    scopeExpansion: { newComponents: ['IgnoredAtCap'] },
  }));

  assert.equal(result.state.currentRound, 1);
  assert.equal(result.state.phase, 'CLOSURE');
  assert.deepEqual(result.state.closureContext, { hardCap: true, earlyExit: false });
  assert.deepEqual(result.action, { type: 'run_closure', payload: { hardCap: true } });
  assert.equal('IgnoredAtCap' in result.state.coverageByComponent, false);
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

test('closure_passed rejects reachable hard-cap closure with open semantic gaps', () => {
  const baseline = baselineState({
    initialize: { roundCap: 1 },
    coverageByComponent: { API: openCoverage() },
  });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  assert.deepEqual(closure.action, { type: 'run_closure', payload: { hardCap: true } });
  assert.equal(closure.semanticCoverageGaps.length, 5);
  expectInvalid(closure.state, { type: 'closure_passed', payload: {} });
});

test('closure_passed rejects reachable early-exit closure with open semantic gaps', () => {
  const baseline = baselineState({ coverageByComponent: { API: openCoverage() }, value: 0.8 });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state, {
    value: 0.8,
    earlyExitRequested: true,
  }));
  assert.deepEqual(closure.action, { type: 'run_closure', payload: { earlyExit: true } });
  assert.equal(closure.semanticCoverageGaps.length, 5);
  expectInvalid(closure.state, { type: 'closure_passed', payload: {} });
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
  expectInvalid(write.state, {
    type: 'spec_written',
    payload: { kind: 'incomplete', path: '.omo/specs/ulw-interview-wrong-kind.md' },
  });
  const done = reduceTransition(write.state, {
    type: 'spec_written',
    payload: { kind: 'complete', path: '.omo/specs/ulw-interview-final.md' },
  });
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
    expectInvalid(write.state, { type: 'spec_written', payload: { kind: 'complete', path } });
  }
  const accepted = reduceTransition(write.state, {
    type: 'spec_written',
    payload: { kind: 'complete', path: '.omo/specs/ulw-interview-safe-slug.md' },
  });
  assert.equal(accepted.state.writtenSpecPath, '.omo/specs/ulw-interview-safe-slug.md');
});

test('hard-cap complete spec hides continuation', () => {
  const baseline = baselineState({ initialize: { roundCap: 1 } });
  const closure = reduceTransition(baseline.state, roundEvent(baseline.state, { value: 0.96 }));
  const restate = reduceTransition(closure.state, { type: 'closure_passed', payload: {} });
  const write = reduceTransition(restate.state, { type: 'restate_confirmed', payload: {} });
  const done = reduceTransition(write.state, {
    type: 'spec_written',
    payload: { kind: 'complete', path: '.omo/specs/ulw-interview-cap.md' },
  });
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
  const incomplete = reduceTransition(reopenedStop.state, {
    type: 'spec_written',
    payload: { kind: 'incomplete', path: '.omo/specs/ulw-interview-baseline-stop.md' },
  });
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
    { round: 1, personas: ['researcher', 'contrarian', 'simplifier'], panelCooldown: 2 },
    { round: 4, personas: ['researcher', 'contrarian', 'simplifier'], panelCooldown: 2 },
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
  assert.deepEqual(generated.state.closureContext, { hardCap: true, earlyExit: false });
  const downgraded = clone(generated.state);
  downgraded.closureContext = { hardCap: false, earlyExit: false };
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
  expectInvalid(downgraded, {
    type: 'spec_written', payload: { kind: 'complete', path: '.omo/specs/ulw-interview-forged.md' },
  });
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
    ROUND: new Set(['round_scored', 'panel_dispatched', 'panel_completed', 'user_stop']),
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
  assert.equal(rejected, 117);
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

test('every scenario driver asserts its exact advertised phase and action', () => {
  const source = readFileSync(transitionPath.replace('transition.mjs', 'transition.test.mjs'), 'utf8');
  const scenarioSource = source.slice(source.lastIndexOf('function happyScenario()'));
  const expectedAssertions = [
    "assertScenarioOutcome(done, 'DONE', 'offer_post_spec')",
    "assertScenarioOutcome(result, 'ROUND', 'ask_target')",
    "assertScenarioOutcome(incomplete, 'INCOMPLETE', 'stop')",
    "assertScenarioOutcome(planning, 'DONE', 'start_planning')",
    "assertScenarioOutcome(relocked, 'BASELINE', 'run_baseline')",
    "assertScenarioOutcome(stopped, 'WRITE', 'write_spec')",
    "assertScenarioOutcome(corrected, 'WRITE', 'write_spec')",
    "assertScenarioOutcome(stopped, 'WRITE', 'write_spec')",
    "assertScenarioOutcome(stopped, 'STOPPED', 'stop')",
  ];
  for (const assertion of expectedAssertions) assert.ok(scenarioSource.includes(assertion), assertion);
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
