#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reduceTransition } from './transition.mjs';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const validatorPath = join(runtimeDir, 'validate.mjs');
const scorerPath = join(runtimeDir, 'scorer.mjs');

function validCoverage() {
  return {
    outcome: {
      status: 'confirmed', source: 'user', source_round: 0,
      items: [{ id: 'O1', text: 'Ship the interview runtime', source: 'user', source_round: 0, state: 'active', supersedes: null }],
    },
    must_haves: {
      status: 'confirmed', source: 'user', source_round: 1,
      items: [{ id: 'M1', text: 'Validate intent coverage', source: 'user', source_round: 1, state: 'active', supersedes: null }],
    },
    must_nots: { status: 'explicit_none', source: 'user', source_round: 1, items: [] },
    out_of_scope: { status: 'explicit_none', source: 'user', source_round: 1, items: [] },
    invariants: {
      status: 'confirmed', source: 'user', source_round: 2,
      items: [{ id: 'I1', text: 'Preserve score normalization', source: 'user', source_round: 2, state: 'active', supersedes: null }],
    },
    preferences: { status: 'open', source: null, source_round: null, items: [] },
  };
}

function validInput() {
  return {
    type: 'greenfield',
    scores: { goal: 1.2, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'criteria',
    triggers: [{ dim: 'goal', type: 'C' }],
    justification: 'Score rationale',
    gap: 'Remaining gap',
    coverage: validCoverage(),
    acceptance_evidence: [
      { id: 'E1', verifies: ['M1', 'I1'], type: 'test', pass_condition: 'Contract suite passes', source: 'user', source_round: 2 },
    ],
  };
}

function runRaw(input, args = []) {
  const result = spawnSync('node', [validatorPath, '--expected-type=greenfield', ...args], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return { output: JSON.parse(result.stdout), stdout: result.stdout };
}

function runValidator(input, args = []) {
  return runRaw(JSON.stringify(input), args).output;
}

function clone(value) {
  return structuredClone(value);
}

function makeExplicitNoneHistory() {
  const input = validInput();
  input.coverage.must_haves = {
    status: 'explicit_none', source: 'user', source_round: 4,
    items: [
      { id: 'M1', text: 'Original capability', source: 'user', source_round: 1, state: 'superseded', supersedes: null },
      { id: 'M2', text: 'Replacement capability', source: 'user', source_round: 2, state: 'superseded', supersedes: 'M1' },
    ],
  };
  input.coverage.invariants = { status: 'explicit_none', source: 'user', source_round: 4, items: [] };
  input.acceptance_evidence = [
    { id: 'E1', verifies: ['M1', 'M2'], type: 'test', pass_condition: 'Historical proof remains recorded', source: 'user', source_round: 3 },
  ];
  return input;
}

function missingEvidenceInput() {
  const input = transitionCompatibleInput();
  input.acceptance_evidence = [
    { ...input.acceptance_evidence[0], verifies: ['I1'] },
  ];
  return input;
}

function transitionCompatibleInput() {
  const input = validInput();
  input.scores = { goal: 0.8, constraints: 0.7, criteria: 0.6 };
  for (const category of Object.values(input.coverage)) {
    if (category.status !== 'open') category.source_round = 0;
    for (const item of category.items) item.source_round = 0;
  }
  for (const evidence of input.acceptance_evidence) evidence.source_round = 0;
  return input;
}

function registryFlag(context) {
  return `--registry-context=${Buffer.from(JSON.stringify(context)).toString('base64url')}`;
}

function componentInput(seed) {
  const input = transitionCompatibleInput();
  input.coverage.outcome.items[0].id = `O${seed}`;
  input.coverage.must_haves.items[0].id = `M${seed}`;
  input.coverage.invariants.items[0].id = `I${seed}`;
  input.acceptance_evidence[0].id = `E${seed}`;
  input.acceptance_evidence[0].verifies = [`M${seed}`, `I${seed}`];
  input.scores = seed === 1
    ? { goal: 0.8, constraints: 0.7, criteria: 0.6 }
    : { goal: 0.9, constraints: 0.8, criteria: 0.7 };
  input.triggers = [{ dim: seed === 1 ? 'goal' : 'criteria', type: seed === 1 ? 'C' : 'A' }];
  return input;
}

function normalizedIds(normalized) {
  return [
    ...Object.values(normalized.coverage).flatMap((category) => category.items.map((item) => item.id)),
    ...normalized.acceptance_evidence.map((evidence) => evidence.id),
  ];
}

function reduceMissingEvidenceSnapshot(normalized) {
  const initialized = reduceTransition(null, {
    type: 'initialize',
    payload: {
      interviewId: 'intent-contract-missing-evidence', declaredType: 'greenfield',
      threshold: 0.05, roundCap: 30, softWarningRounds: 15, panelCeiling: 30,
    },
  });
  const topology = reduceTransition(initialized.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['API'], deferredComponents: [] },
  });
  const scorer = spawnSync('node', [scorerPath], {
    input: JSON.stringify({
      threshold: 0.05,
      type: 'greenfield',
      components: [{ name: 'API', scores: normalized.scores }],
      currentRound: 0,
    }),
    encoding: 'utf8',
  });
  assert.equal(scorer.status, 0, scorer.stderr);
  return reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: {
      scorerOutput: JSON.parse(scorer.stdout),
      coverageByComponent: {
        API: {
          coverage: normalized.coverage,
          acceptance_evidence: normalized.acceptance_evidence,
        },
      },
    },
  });
}

function runFiredTriggerPipeline() {
  const validation = runValidator(transitionCompatibleInput());
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const baseline = reduceMissingEvidenceSnapshot({ ...validation.normalized, triggers: [] });
  const askedTarget = baseline.state.askedTarget;
  const enrichedTriggers = validation.normalized.triggers.map((trigger) => ({
    component: askedTarget.component,
    ...trigger,
  }));
  const scorer = spawnSync('node', [scorerPath], {
    input: JSON.stringify({
      threshold: baseline.state.threshold,
      type: baseline.state.declaredType,
      components: [{ name: askedTarget.component, scores: validation.normalized.scores }],
      priorAmbiguity: baseline.state.priorAmbiguity,
      priorBand: baseline.state.priorBand,
      priorRounds: baseline.state.priorRounds,
      priorBandHistory: baseline.state.priorBandHistory,
      priorPanelRound: baseline.state.priorPanelRound,
      currentRound: baseline.state.currentRound + 1,
      triggers: enrichedTriggers,
      validationScoreClamped: validation.scoreClamped,
      streakCounter: baseline.state.streakCounter,
      lastRoundResolvedWithoutUser: false,
      degraded: false,
    }),
    encoding: 'utf8',
  });
  assert.equal(scorer.status, 0, scorer.stderr);
  const scorerOutput = JSON.parse(scorer.stdout);
  const transition = reduceTransition(baseline.state, {
    type: 'round_scored',
    payload: {
      scorerOutput,
      refineOutput: { shouldRefine: false, reason: 'progressed', target: null },
      coverageByComponent: baseline.state.coverageByComponent,
      scopeExpansion: null,
      earlyExitRequested: false,
    },
  });
  return { askedTarget, enrichedTriggers, scorerOutput, transition, validation };
}

function runBaselineRegistryPipeline() {
  const owners = {};
  const api = runValidator(componentInput(1), [registryFlag({ component: 'API', owners })]);
  assert.equal(api.ok, true, JSON.stringify(api.errors));
  for (const id of normalizedIds(api.normalized)) owners[id] = 'API';

  const duplicateUiInput = componentInput(2);
  duplicateUiInput.coverage.must_haves.items[0].id = 'M1';
  duplicateUiInput.acceptance_evidence[0].id = 'E1';
  duplicateUiInput.acceptance_evidence[0].verifies = ['M1', 'I2'];
  const duplicateUi = runValidator(duplicateUiInput, [registryFlag({ component: 'UI', owners })]);
  assert.deepEqual(duplicateUi.errors, [
    'registry context ID M1 is owned by component "API", not current component "UI"',
    'registry context ID E1 is owned by component "API", not current component "UI"',
  ]);

  const ui = runValidator(componentInput(2), [registryFlag({ component: 'UI', owners })]);
  assert.equal(ui.ok, true, JSON.stringify(ui.errors));
  for (const id of normalizedIds(ui.normalized)) owners[id] = 'UI';

  const enrichedTriggers = [
    ...api.normalized.triggers.map((trigger) => ({ component: 'API', ...trigger })),
    ...ui.normalized.triggers.map((trigger) => ({ component: 'UI', ...trigger })),
  ];
  const scorer = spawnSync('node', [scorerPath], {
    input: JSON.stringify({
      threshold: 0.05,
      type: 'greenfield',
      components: [
        { name: 'API', scores: api.normalized.scores },
        { name: 'UI', scores: ui.normalized.scores },
      ],
      currentRound: 0,
      triggers: enrichedTriggers,
      validationScoreClamped: false,
    }),
    encoding: 'utf8',
  });
  assert.equal(scorer.status, 0, scorer.stderr);
  const scorerOutput = JSON.parse(scorer.stdout);
  const initialized = reduceTransition(null, {
    type: 'initialize',
    payload: {
      interviewId: 'baseline-registry', declaredType: 'greenfield', threshold: 0.05,
      roundCap: 30, softWarningRounds: 15, panelCeiling: 30,
    },
  });
  const topology = reduceTransition(initialized.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['API', 'UI'], deferredComponents: [] },
  });
  const transition = reduceTransition(topology.state, {
    type: 'baseline_scored',
    payload: {
      scorerOutput,
      coverageByComponent: {
        API: { coverage: api.normalized.coverage, acceptance_evidence: api.normalized.acceptance_evidence },
        UI: { coverage: ui.normalized.coverage, acceptance_evidence: ui.normalized.acceptance_evidence },
      },
    },
  });
  return { api, duplicateUi, enrichedTriggers, owners, scorerOutput, transition, ui };
}

function assertInvalid(input, fragment) {
  const output = runValidator(input);
  assert.equal(output.ok, false, `expected rejection containing ${fragment}`);
  assert.ok(output.errors.some((error) => error.includes(fragment)), JSON.stringify(output.errors));
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test('pins existing valid score normalization', () => {
  const baseline = runValidator(validInput());
  assert.equal(baseline.ok, true);
  assert.deepEqual(baseline.normalized.scores, { goal: 1, constraints: 0.7, criteria: 0.6 });
  assert.deepEqual(baseline.normalized.triggers, [{ dim: 'goal', type: 'C' }]);
  assert.equal(baseline.normalized.type, 'greenfield');
  assert.equal(baseline.normalized.weakest_dimension, 'criteria');
  assert.equal(baseline.normalized.justification, 'Score rationale');
  assert.equal(baseline.normalized.gap, 'Remaining gap');
  assert.equal(baseline.scoreClamped, true);
  assert.deepEqual(baseline.clampedFields, ['goal']);
});

test('rejects context scores when expected type is greenfield', () => {
  const input = validInput();
  input.type = 'brownfield';
  input.scores.context = 0.5;
  const output = runValidator(input);
  assert.deepEqual(output.errors, [
    'scores.context is not allowed for greenfield; expected exactly goal|constraints|criteria',
  ]);

  delete input.scores.context;
  const coerced = runValidator(input);
  assert.equal(coerced.ok, true);
  assert.equal(coerced.normalized.type, 'greenfield');
  assert.deepEqual(Object.keys(coerced.normalized.scores), ['goal', 'constraints', 'criteria']);
});

test('caller enrichment carries a fired validator trigger through scorer and transition', () => {
  const { askedTarget, enrichedTriggers, scorerOutput, transition, validation } = runFiredTriggerPipeline();
  assert.deepEqual(validation.normalized.triggers, [{ dim: 'goal', type: 'C' }]);
  assert.equal(askedTarget.component, 'API');
  assert.deepEqual(enrichedTriggers, [{ component: 'API', dim: 'goal', type: 'C' }]);
  assert.equal(scorerOutput.triggerDelta, -0.15);
  assert.deepEqual(scorerOutput.perComponent[0].firedDims, [
    { dim: 'goal', count: 1, delta: -0.15 },
  ]);
  assert.equal(scorerOutput.perComponent[0].scores.goal, 0.65);
  assert.equal(transition.state.currentRound, 1);
  assert.deepEqual(transition.state.lastScorerOutput.perComponent[0].firedDims, [
    { dim: 'goal', count: 1, delta: -0.15 },
  ]);
});

test('registry context rejects foreign IDs and allows current-component history', () => {
  const apiInput = makeExplicitNoneHistory();
  const apiOwners = Object.fromEntries(normalizedIds({
    coverage: apiInput.coverage,
    acceptance_evidence: apiInput.acceptance_evidence,
  }).map((id) => [id, 'API']));
  assert.equal(runValidator(apiInput, [registryFlag({ component: 'API', owners: apiOwners })]).ok, true);

  const duplicateUi = componentInput(2);
  duplicateUi.coverage.must_haves.items[0].id = 'M1';
  duplicateUi.acceptance_evidence[0].id = 'E1';
  duplicateUi.acceptance_evidence[0].verifies = ['M1', 'I2'];
  const rejected = runValidator(duplicateUi, [registryFlag({ component: 'UI', owners: apiOwners })]);
  assert.deepEqual(rejected.errors, [
    'registry context ID M1 is owned by component "API", not current component "UI"',
    'registry context ID E1 is owned by component "API", not current component "UI"',
  ]);
  assert.equal(runValidator(duplicateUi).ok, true);
});

test('registry context rejects malformed encoding shape IDs owners and duplicates', () => {
  const cases = [
    ['--registry-context', '--registry-context requires a base64url JSON value'],
    ['--registry-context=%%%', 'registry context must be canonical non-empty base64url JSON'],
    [`--registry-context=${Buffer.from('{').toString('base64url')}`, 'registry context must decode to valid JSON'],
    [registryFlag({ component: 'API', owners: {}, extra: true }), 'registry context.extra is not allowed'],
    [registryFlag({ component: '', owners: {} }), 'registry context.component must be a non-empty string'],
    [registryFlag({ component: 'API', owners: [] }), 'registry context.owners must be an object'],
    [registryFlag({ component: 'API', owners: { M0: 'API' } }), 'registry context.owners key M0 must match /^[OMNXIPE][1-9][0-9]*$/'],
    [registryFlag({ component: 'API', owners: { M1: ' ' } }), 'registry context.owners.M1 must be a non-empty string'],
  ];
  for (const [flag, fragment] of cases) {
    const output = runValidator(validInput(), [flag]);
    assert.equal(output.ok, false, `${flag} should fail`);
    assert.ok(output.errors.some((error) => error.includes(fragment)), JSON.stringify(output.errors));
  }
  const duplicateFlag = registryFlag({ component: 'API', owners: {} });
  const duplicate = runValidator(validInput(), [duplicateFlag, duplicateFlag]);
  assert.deepEqual(duplicate.errors, ['--registry-context may be provided at most once']);
});

test('serial baseline registry binds component triggers and reaches reducer', () => {
  const { enrichedTriggers, owners, scorerOutput, transition } = runBaselineRegistryPipeline();
  assert.deepEqual(enrichedTriggers, [
    { component: 'API', dim: 'goal', type: 'C' },
    { component: 'UI', dim: 'criteria', type: 'A' },
  ]);
  assert.equal(scorerOutput.triggerDelta, -0.15);
  assert.deepEqual(scorerOutput.perComponent.map((component) => component.firedDims), [
    [{ dim: 'goal', count: 1, delta: -0.15 }],
    [{ dim: 'criteria', count: 1, delta: -0.15 }],
  ]);
  assert.deepEqual(owners, {
    O1: 'API', M1: 'API', I1: 'API', E1: 'API',
    O2: 'UI', M2: 'UI', I2: 'UI', E2: 'UI',
  });
  assert.equal(transition.state.phase, 'ROUND');
  assert.deepEqual(transition.semanticCoverageGaps, []);
});

test('requires coverage and acceptance evidence', () => {
  const missingCoverage = validInput();
  delete missingCoverage.coverage;
  assertInvalid(missingCoverage, 'coverage must be an object');
  const missingEvidence = validInput();
  delete missingEvidence.acceptance_evidence;
  assertInvalid(missingEvidence, 'acceptance_evidence must be an array');
});

test('normalizes complete coverage without semantic rewriting', () => {
  const input = validInput();
  const before = clone(input);
  const output = runValidator(input);
  assert.equal(output.ok, true);
  assert.deepEqual(input, before);
  assert.deepEqual(output.normalized.coverage, before.coverage);
  assert.deepEqual(output.normalized.acceptance_evidence, before.acceptance_evidence);
});

test('normalizes missing active evidence for reducer-owned targeting', () => {
  const validation = runValidator(missingEvidenceInput());
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const transition = reduceMissingEvidenceSnapshot(validation.normalized);
  assert.deepEqual(transition.semanticCoverageGaps, [
    { component: 'API', category: 'acceptance_evidence', itemId: 'M1', reason: 'missing_evidence' },
  ]);
  assert.deepEqual(transition.action, {
    type: 'ask_target',
    payload: {
      target: { kind: 'coverage', component: 'API', category: 'acceptance_evidence', itemId: 'M1' },
    },
  });
});

test('accepts open slots and non-blocking open preferences', () => {
  const input = validInput();
  input.coverage.outcome = { status: 'open', source: null, source_round: null, items: [] };
  assert.equal(runValidator(input).ok, true);
});

test('rejects unknown keys at every contract level', () => {
  const cases = [
    ['top-level.extra', (input) => { input.extra = true; }],
    ['coverage.extra', (input) => { input.coverage.extra = {}; }],
    ['coverage.must_haves.extra', (input) => { input.coverage.must_haves.extra = true; }],
    ['coverage.must_haves.items[0].extra', (input) => { input.coverage.must_haves.items[0].extra = true; }],
    ['acceptance_evidence[0].extra', (input) => { input.acceptance_evidence[0].extra = true; }],
    ['triggers[0].extra', (input) => { input.triggers[0].extra = true; }],
  ];
  for (const [path, mutate] of cases) {
    const input = validInput();
    mutate(input);
    assertInvalid(input, `${path} is not allowed`);
  }
});

test('enforces category status provenance and active cardinality', () => {
  const invalidCases = [
    ['source must be "user"', (input) => { input.coverage.must_haves.source = 'oracle'; }],
    ['source_round must be a non-negative integer', (input) => { input.coverage.must_haves.source_round = 1.5; }],
    ['must contain at least one active item', (input) => { input.coverage.must_haves.items[0].state = 'superseded'; }],
    ['outcome must contain exactly one active item', (input) => { input.coverage.outcome.items.push({ ...input.coverage.outcome.items[0], id: 'O2' }); }],
    ['outcome.status must be one of open|confirmed', (input) => { input.coverage.outcome = { status: 'explicit_none', source: 'user', source_round: 2, items: [] }; }],
    ['source must be null when status is "open"', (input) => { input.coverage.preferences.source = 'user'; }],
    ['source_round must be null when status is "open"', (input) => { input.coverage.preferences.source_round = 2; }],
    ['must contain no active items when status is "open"', (input) => { input.coverage.preferences.items.push({ id: 'P1', text: 'Fast', source: 'user', source_round: 1, state: 'active', supersedes: null }); }],
    ['must contain no active items when status is "explicit_none"', (input) => { input.coverage.must_nots.items.push({ id: 'N1', text: 'No regressions', source: 'user', source_round: 1, state: 'active', supersedes: null }); }],
  ];
  for (const [fragment, mutate] of invalidCases) {
    const input = validInput();
    mutate(input);
    assertInvalid(input, fragment);
  }
});

test('enforces item shape provenance rounds IDs and local uniqueness', () => {
  const invalidCases = [
    ['text must be a non-empty string', (input) => { input.coverage.must_haves.items[0].text = '  '; }],
    ['source must be "user"', (input) => { input.coverage.must_haves.items[0].source = 'oracle'; }],
    ['source_round must be a non-negative integer', (input) => { input.coverage.must_haves.items[0].source_round = -1; }],
    ['state must be one of active|superseded', (input) => { input.coverage.must_haves.items[0].state = 'retired'; }],
    ['id must match /^M[1-9][0-9]*$/', (input) => { input.coverage.must_haves.items[0].id = 'M01'; input.acceptance_evidence[0].verifies[0] = 'M01'; }],
    ['duplicate item id M1', (input) => { input.coverage.invariants.items[0].id = 'M1'; input.acceptance_evidence[0].verifies = ['M1']; }],
  ];
  for (const [fragment, mutate] of invalidCases) {
    const input = validInput();
    mutate(input);
    assertInvalid(input, fragment);
  }
});

test('accepts valid supersession and historical evidence links', () => {
  const input = validInput();
  input.coverage.must_haves.items[0].state = 'superseded';
  input.coverage.must_haves.items.push({ id: 'M2', text: 'Validate the complete contract', source: 'user', source_round: 3, state: 'active', supersedes: 'M1' });
  input.acceptance_evidence = [
    { id: 'E1', verifies: ['M1'], type: 'inspection', pass_condition: 'Historical requirement is retained', source: 'user', source_round: 2 },
    { id: 'E2', verifies: ['M2', 'I1'], type: 'test', pass_condition: 'Current contract passes', source: 'user', source_round: 3 },
  ];
  assert.equal(runValidator(input).ok, true);
});

test('rejects invalid supersession graphs and reactivation-shaped snapshots', () => {
  const invalidCases = [
    ['does not reference an existing item', (input) => { input.coverage.must_haves.items[0].supersedes = 'M9'; }],
    ['must reference an older ID', (input) => {
      input.coverage.must_haves.items[0] = { id: 'M1', text: 'Replacement', source: 'user', source_round: 2, state: 'active', supersedes: 'M2' };
      input.coverage.must_haves.items.push({ id: 'M2', text: 'Future item', source: 'user', source_round: 1, state: 'superseded', supersedes: null });
      input.acceptance_evidence[0].verifies = ['M1', 'I1'];
    }],
    ['must reference a superseded item', (input) => {
      input.coverage.must_haves.items.push({ id: 'M2', text: 'Second item', source: 'user', source_round: 2, state: 'active', supersedes: 'M1' });
      input.acceptance_evidence[0].verifies.push('M2');
    }],
    ['is superseded but has no replacement', (input) => { input.coverage.must_haves.items[0].state = 'superseded'; }],
    ['is superseded by multiple items', (input) => {
      input.coverage.must_haves.items[0].state = 'superseded';
      input.coverage.must_haves.items.push(
        { id: 'M2', text: 'First replacement', source: 'user', source_round: 2, state: 'active', supersedes: 'M1' },
        { id: 'M3', text: 'Second replacement', source: 'user', source_round: 2, state: 'active', supersedes: 'M1' },
      );
      input.acceptance_evidence[0].verifies = ['M2', 'M3', 'I1'];
    }],
  ];
  for (const [fragment, mutate] of invalidCases) {
    const input = validInput();
    mutate(input);
    assertInvalid(input, fragment);
  }
});

test('allows direct-user explicit-none to retire all category items without replacement', () => {
  const input = makeExplicitNoneHistory();
  const output = runValidator(input);
  assert.equal(output.ok, true);
  assert.deepEqual(output.normalized.coverage.must_haves, input.coverage.must_haves);
  assert.deepEqual(output.normalized.acceptance_evidence, input.acceptance_evidence);
});

test('enforces acceptance evidence shape provenance and reference integrity', () => {
  const invalidCases = [
    ['acceptance_evidence[0].id must match /^E[1-9][0-9]*$/', (input) => { input.acceptance_evidence[0].id = 'E0'; }],
    ['duplicate acceptance evidence id E1', (input) => { input.acceptance_evidence.push(clone(input.acceptance_evidence[0])); }],
    ['verifies must be a non-empty array', (input) => { input.acceptance_evidence[0].verifies = []; }],
    ['verifies contains duplicate reference M1', (input) => { input.acceptance_evidence[0].verifies = ['M1', 'M1', 'I1']; }],
    ['verifies reference O1 must identify an existing M/N/I item', (input) => { input.acceptance_evidence[0].verifies = ['O1', 'M1', 'I1']; }],
    ['type must be one of test|inspection|observation|analysis', (input) => { input.acceptance_evidence[0].type = 'proof'; }],
    ['pass_condition must be a non-empty string', (input) => { input.acceptance_evidence[0].pass_condition = ''; }],
    ['source must be "user"', (input) => { input.acceptance_evidence[0].source = 'oracle'; }],
    ['source_round must be a non-negative integer', (input) => { input.acceptance_evidence[0].source_round = -1; }],
  ];
  for (const [fragment, mutate] of invalidCases) {
    const input = validInput();
    mutate(input);
    assertInvalid(input, fragment);
  }
});

test('allows empty or historical evidence when all M/N/I categories are explicit-none', () => {
  const historical = makeExplicitNoneHistory();
  assert.equal(runValidator(historical).ok, true);
  historical.acceptance_evidence = [];
  assert.equal(runValidator(historical).ok, true);
});

test('rejects malformed JSON without treating process success as validation success', () => {
  const { output } = runRaw('{not json');
  assert.equal(output.ok, false);
  assert.match(output.errors[0], /not valid JSON/);
});

test('is deterministic for repeated runs', () => {
  const serialized = JSON.stringify(validInput());
  assert.equal(runRaw(serialized).stdout, runRaw(serialized).stdout);
});

function runScenario(name) {
  if (name === 'valid') {
    const output = runValidator(validInput());
    assert.equal(output.ok, true);
    assert.deepEqual(output.normalized.coverage, validCoverage());
    return { status: 'PASS', scenario: name, normalized: true };
  }
  if (name === 'invalid-provenance') {
    const input = validInput();
    input.coverage.must_haves.source = 'oracle';
    const output = runValidator(input);
    assert.deepEqual(output.errors, ['coverage.must_haves.source must be "user" when status is "confirmed"']);
    return { status: 'PASS', scenario: name, ok: output.ok };
  }
  if (name === 'invalid-link') {
    const input = validInput();
    input.acceptance_evidence = [
      { ...input.acceptance_evidence[0], verifies: ['M404'] },
      { ...input.acceptance_evidence[0], id: 'E2', verifies: ['I1'] },
    ];
    const output = runValidator(input);
    assert.deepEqual(output.errors, [
      'acceptance_evidence[0].verifies reference M404 must identify an existing M/N/I item',
    ]);
    return { status: 'PASS', scenario: name, ok: output.ok };
  }
  if (name === 'explicit-none') {
    const input = makeExplicitNoneHistory();
    const output = runValidator(input);
    assert.equal(output.ok, true);
    assert.deepEqual(output.normalized.coverage.must_haves.items, input.coverage.must_haves.items);
    return { status: 'PASS', scenario: name, historicalLinks: true };
  }
  if (name === 'missing-evidence') {
    const validation = runValidator(missingEvidenceInput());
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    const transition = reduceMissingEvidenceSnapshot(validation.normalized);
    const target = transition.action.payload.target;
    assert.deepEqual(transition.semanticCoverageGaps, [
      { component: 'API', category: 'acceptance_evidence', itemId: 'M1', reason: 'missing_evidence' },
    ]);
    assert.deepEqual(target, {
      kind: 'coverage', component: 'API', category: 'acceptance_evidence', itemId: 'M1',
    });
    return { status: 'PASS', scenario: name, target, gaps: transition.semanticCoverageGaps };
  }
  if (name === 'greenfield-context') {
    const input = validInput();
    input.type = 'brownfield';
    input.scores.context = 0.5;
    const output = runValidator(input);
    assert.deepEqual(output.errors, [
      'scores.context is not allowed for greenfield; expected exactly goal|constraints|criteria',
    ]);
    return { status: 'PASS', scenario: name, ok: output.ok, errors: output.errors };
  }
  if (name === 'fired-trigger') {
    const { enrichedTriggers, scorerOutput, transition } = runFiredTriggerPipeline();
    const firedDims = scorerOutput.perComponent[0].firedDims;
    assert.deepEqual(firedDims, [{ dim: 'goal', count: 1, delta: -0.15 }]);
    assert.equal(transition.state.currentRound, 1);
    return {
      status: 'PASS', scenario: name, triggerDelta: scorerOutput.triggerDelta,
      enrichedTriggers, firedDims,
      transition: { phase: transition.state.phase, currentRound: transition.state.currentRound },
    };
  }
  if (name === 'baseline-registry') {
    const { duplicateUi, enrichedTriggers, owners, scorerOutput, transition } = runBaselineRegistryPipeline();
    const firedDims = scorerOutput.perComponent.map((component) => ({
      component: component.name,
      firedDims: component.firedDims,
    }));
    assert.equal(duplicateUi.ok, false);
    assert.equal(transition.state.phase, 'ROUND');
    assert.deepEqual(transition.semanticCoverageGaps, []);
    return {
      status: 'PASS', scenario: name, duplicateRejected: true, enrichedTriggers,
      triggerDelta: scorerOutput.triggerDelta, firedDims, owners,
      transition: { phase: transition.state.phase, gaps: transition.semanticCoverageGaps },
    };
  }
  throw new Error(`unknown scenario ${name}`);
}

const scenarioArg = process.argv.find((arg) => arg.startsWith('--scenario='));
if (scenarioArg) {
  console.log(JSON.stringify(runScenario(scenarioArg.slice('--scenario='.length))));
} else {
  for (const { name, run } of tests) {
    try {
      run();
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  console.log(JSON.stringify({ status: 'PASS', suite: 'intent-contract', tests: tests.length }));
}
