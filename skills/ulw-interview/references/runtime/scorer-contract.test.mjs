#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const scorerPath = join(runtimeDir, 'scorer.mjs');

function runScorer(input) {
  return spawnSync('node', [scorerPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

function parseSuccessfulRun(input) {
  const result = runScorer(input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

function greenfieldWeightScenario() {
  const output = parseSuccessfulRun({
    threshold: 0.05,
    type: 'greenfield',
    components: [
      { name: 'API', scores: { goal: 1, constraints: 0, criteria: 1 } },
    ],
  });

  assert.equal(output.globalAmbiguity, 0.35);
  return { status: 'PASS', scenario: 'greenfield-weight', ambiguity: output.globalAmbiguity };
}

function brownfieldWeightScenario() {
  const output = parseSuccessfulRun({
    threshold: 0.05,
    type: 'brownfield',
    components: [
      { name: 'API', scores: { goal: 1, constraints: 0, criteria: 1, context: 1 } },
    ],
  });

  assert.equal(output.globalAmbiguity, 0.3);
  return { status: 'PASS', scenario: 'brownfield-weight', ambiguity: output.globalAmbiguity };
}

function readyPanelScenario() {
  const output = parseSuccessfulRun({
    threshold: 0.05,
    type: 'greenfield',
    components: [
      { name: 'API', scores: { goal: 0.95, constraints: 0.95, criteria: 0.95 } },
    ],
    currentRound: 7,
    priorPanelRound: 4,
  });

  assert.equal(output.ready, true);
  assert.equal(output.nextPanelEligible, true);
  assert.equal(output.dispatchPanel, false);
  return {
    status: 'PASS',
    scenario: 'ready-panel',
    ready: output.ready,
    dispatchPanel: output.dispatchPanel,
  };
}

function nonReadyPanelScenario() {
  const output = parseSuccessfulRun({
    threshold: 0.05,
    type: 'greenfield',
    components: [
      { name: 'API', scores: { goal: 0.5, constraints: 0.5, criteria: 0.5 } },
    ],
    currentRound: 7,
    priorPanelRound: 4,
  });

  assert.equal(output.ready, false);
  assert.equal(output.nextPanelEligible, true);
  assert.equal(output.bandChanged, true);
  assert.equal(output.suppressPanelForOscillation, false);
  assert.equal(output.dispatchPanel, true);
  return {
    status: 'PASS',
    scenario: 'non-ready-panel',
    ready: output.ready,
    dispatchPanel: output.dispatchPanel,
  };
}

function panelScenario() {
  const ready = readyPanelScenario();
  const nonReady = nonReadyPanelScenario();
  return {
    status: 'PASS',
    scenario: 'panel',
    ready: { ready: ready.ready, dispatchPanel: ready.dispatchPanel },
    nonReady: { ready: nonReady.ready, dispatchPanel: nonReady.dispatchPanel },
  };
}

function maxGatingScenario() {
  const output = parseSuccessfulRun({
    threshold: 0.05,
    type: 'greenfield',
    components: [
      { name: 'Clear', scores: { goal: 1, constraints: 1, criteria: 1 } },
      { name: 'Unclear', scores: { goal: 0, constraints: 0, criteria: 0 } },
    ],
  });

  assert.equal(output.globalAmbiguity, 1);
  assert.equal(output.ready, false);
  return {
    status: 'PASS',
    scenario: 'max-gating',
    globalAmbiguity: output.globalAmbiguity,
    ready: output.ready,
  };
}

const scenarios = new Map([
  ['greenfield-weight', greenfieldWeightScenario],
  ['brownfield-weight', brownfieldWeightScenario],
  ['ready-panel', readyPanelScenario],
  ['non-ready-panel', nonReadyPanelScenario],
  ['panel', panelScenario],
  ['max-gating', maxGatingScenario],
]);

function executeScenario(name) {
  const scenario = scenarios.get(name);
  if (!scenario) throw new Error(`Unknown scenario: ${name}`);
  return scenario();
}

function runDefaultSuite() {
  let passed = 0;
  let failed = 0;

  function test(name, assertion) {
    try {
      assertion();
      passed += 1;
      process.stdout.write(`  PASS  ${name}\n`);
    } catch (error) {
      failed += 1;
      process.stdout.write(`  FAIL  ${name}\n        ${error.message}\n`);
    }
  }

  test('greenfield uses exact balanced goal constraints criteria weights', greenfieldWeightScenario);
  test('brownfield uses exact balanced goal constraints criteria context weights', brownfieldWeightScenario);
  test('ready output never dispatches a panel', readyPanelScenario);
  test('baseline eligible non-ready band transition dispatches a panel', nonReadyPanelScenario);
  test('baseline MAX aggregation blocks masking by a clear sibling', maxGatingScenario);

  test('malformed score inputs fail without a success payload', () => {
    for (const malformedScore of ['high', null]) {
      const result = runScorer({
        threshold: 0.05,
        type: 'greenfield',
        components: [
          { name: 'API', scores: { goal: malformedScore, constraints: 1, criteria: 1 } },
        ],
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /scores\.goal must be number/);
    }
  });

  test('identical inputs produce byte-identical output across repeated runs', () => {
    const input = {
      threshold: 0.05,
      type: 'greenfield',
      components: [
        { name: 'API', scores: { goal: 0.7, constraints: 0.6, criteria: 0.8 } },
      ],
      currentRound: 9,
      priorPanelRound: 5,
      priorRounds: [0.41, 0.39],
    };
    const outputs = Array.from({ length: 10 }, () => runScorer(input));
    for (const result of outputs) assert.equal(result.status, 0, result.stderr);
    assert.equal(new Set(outputs.map((result) => result.stdout)).size, 1);
  });

  test('unknown scenarios cannot emit a misleading PASS payload', () => {
    assert.throws(() => executeScenario('not-real'), /Unknown scenario: not-real/);
  });

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

const scenarioOption = process.argv.find((argument) => argument.startsWith('--scenario='));
if (scenarioOption) {
  const scenarioName = scenarioOption.slice('--scenario='.length);
  try {
    process.stdout.write(`${JSON.stringify(executeScenario(scenarioName))}\n`);
  } catch (error) {
    process.stderr.write(`scorer-contract.test.mjs: ${error.message}\n`);
    process.exitCode = 1;
  }
} else {
  runDefaultSuite();
}
