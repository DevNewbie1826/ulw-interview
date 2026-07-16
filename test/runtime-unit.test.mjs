import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ambiguityFloor,
  calculateAmbiguity,
  clamp,
  classifyBand,
} from '../skills/ulw-interview/runtime/ambiguity-floor.mjs';
import { reduce } from '../skills/ulw-interview/runtime/runtime.mjs';

function safeFloor(state) {
  try {
    return ambiguityFloor(state);
  } catch (error) {
    return { error: error.message };
  }
}

function safeReduce(state, event) {
  try {
    return reduce(state, event);
  } catch (error) {
    return { error: error.message };
  }
}

function initialize(interviewId = 'unit-contract') {
  return reduce(null, {
    type: 'initialize',
    input: { interviewId, type: 'greenfield', idea: 'Clarify a review workflow.' },
  });
}

function newContractScoredState() {
  return {
    version: 2,
    phase: 'round',
    interviewId: 'new-contract-state',
    type: 'greenfield',
    idea: 'Clarify a review workflow.',
    threshold: 0.05,
    thresholdSource: 'default',
    ambiguity: 0.06,
    reportedAmbiguity: 0.06,
    ambiguityFloor: {
      floor: 0,
      disputedFactCount: 0,
      unscoredActiveComponentCount: 0,
      autoAnswerRatio: 0,
    },
    band: 'ready',
    rounds: [{
      round: 1,
      roundKey: 'new-contract-state::r:1::q:q1',
      questionId: 'q1',
      question: 'What is the review goal?',
      questionHash: 'fixture-hash',
      target: { componentId: 'review', dimension: 'goal' },
      answer: { kind: 'user', text: 'Review one queue.' },
      lifecycle: 'scored',
      componentScores: { review: { goal: 0.94, constraints: 0.94, criteria: 0.94 } },
      reported_ambiguity: 0.06,
      ambiguity: 0.06,
    }],
    facts: [{ id: 'F1', statement: 'One review queue exists.', round: 1, disputed: false }],
    factEvents: [{ type: 'established', factId: 'F1', round: 1 }],
    topologyStatus: 'confirmed',
    topology: [{
      id: 'review',
      name: 'Review',
      status: 'active',
      clarity: { goal: 0.94, constraints: 0.94, criteria: 0.94 },
    }],
    pendingRound: null,
    pendingPanel: null,
    pendingRefinement: null,
    autoAnswerStreak: 0,
    autoResearchedRounds: [],
    autoAnsweredRounds: [],
    refinedRounds: [],
    lateralReviews: [],
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

test('DI-UNIT-NEW-001 reproduces gajae deterministic floor fixtures verbatim', () => {
  const scoredRounds = [
    { lifecycle: 'scored', round: 1 },
    { lifecycle: 'scored', round: 2 },
  ];
  const fixtures = [
    {},
    { established_facts: [{ disputed: true }, { disputed: true }, { disputed: false }] },
    { established_facts: [{ disputed: true, superseded_by: 'F9' }, { id: 'F9', disputed: false }] },
    {
      topology: {
        status: 'confirmed',
        components: [
          { id: 'a', status: 'active', clarity_scores: { goal: 0.9, constraints: 0.8, criteria: 0.9 } },
          { id: 'b', status: 'active', clarity_scores: { goal: 0.9, constraints: null, criteria: 0.9 } },
          { id: 'c', status: 'deferred', clarity_scores: {} },
          { id: 'd', status: 'active' },
        ],
      },
    },
    {
      topology: {
        status: 'pending',
        components: [
          { id: 'b', status: 'active', clarity_scores: { goal: 0.9, constraints: null, criteria: 0.9 } },
        ],
      },
    },
    { rounds: scoredRounds, auto_answered_rounds: [2] },
    { rounds: scoredRounds, auto_answered_rounds: [1, 2, 3, 4] },
  ];

  assert.deepEqual(fixtures.map((fixture) => safeFloor(fixture).floor), [0, 0.2, 0, 0.1, 0, 0.03, 0.05]);
});

test('DI-UNIT-NEW-002 reproduces gajae clamp fixtures verbatim', () => {
  const cases = [
    [0.03, 0.2],
    [0.5, 0.2],
    [-1, 0],
    [2, 0],
  ];

  assert.deepEqual(cases.map(([reported, floor]) => clamp(reported, floor)), [
    { effective: 0.2, clamped: true },
    { effective: 0.5, clamped: false },
    { effective: 0, clamped: false },
    { effective: 1, clamped: false },
  ]);
});

test('DI-UNIT-NEW-003 re-answering a scored round disputes its facts and raises 0.06 to the 0.10 floor', () => {
  const replaced = safeReduce(newContractScoredState(), {
    type: 'submit_answer',
    input: {
      round: 1,
      replacesRound: 1,
      answer: { kind: 'user', text: 'Actually, use two queues.', source: 'direct' },
    },
  });

  assert.equal(replaced.error, undefined);
  assert.equal(replaced.state.facts[0].disputed, true);
  assert.equal(replaced.state.ambiguityFloor.floor, 0.1);
  assert.equal(replaced.state.ambiguity, 0.1);
});

test('DI-UNIT-NEW-004 reports ambiguity from the minimum score per dimension across active components', () => {
  const metrics = calculateAmbiguity({
    type: 'greenfield',
    components: [
      { id: 'a', status: 'active', scores: { goal: 1, constraints: 0, criteria: 1 } },
      { id: 'b', status: 'active', scores: { goal: 0, constraints: 1, criteria: 1 } },
    ],
    facts: [],
    rounds: [],
    threshold: 0.05,
    topologyStatus: 'confirmed',
  });

  assert.equal(metrics.reported, 0.7);
  assert.equal(metrics.floor, 0);
  assert.equal(metrics.effective, 0.7);
});

test('DI-UNIT-NEW-005 initializes with concrete ambiguity, floor breakdown, counters, and topology phase', () => {
  const result = initialize('init-contract');

  assert.equal(result.state.phase, 'topology');
  assert.equal(result.state.ambiguity, 1);
  assert.equal(result.state.reportedAmbiguity, 1);
  assert.deepEqual(result.state.ambiguityFloor, {
    floor: 0,
    disputedFactCount: 0,
    unscoredActiveComponentCount: 0,
    autoAnswerRatio: 0,
  });
  assert.deepEqual(result.state.autoResearchedRounds, []);
  assert.equal(result.state.restatedGoal, null);
  assert.equal(result.state.softWarningShown, false);
  assert.deepEqual(result.effects.map((effect) => effect.type), ['announce_threshold', 'ask_topology']);
  assert.deepEqual(result.effects[0], { type: 'announce_threshold', threshold: 0.05, thresholdSource: 'default' });
});

test('DI-KEEP-UNIT-001 band classification is ready/refined/progress/initial with threshold boundary', () => {
  assert.equal(classifyBand(0.05, 0.05), 'ready');
  assert.equal(classifyBand(0.3, 0.05), 'refined');
  assert.equal(classifyBand(0.6, 0.05), 'progress');
  assert.equal(classifyBand(0.61, 0.05), 'initial');
});

test('DI-UNIT-NEW-007 safe round keys use the gajae ::r and ::q contract', () => {
  let result = initialize('round-key-contract');
  result = reduce(result.state, {
    type: 'confirm_topology',
    input: { components: [{ id: 'review', name: 'Review', status: 'active' }], confirmedAt: '2026-07-17T00:00:00.000Z' },
  });
  result = reduce(result.state, {
    type: 'open_round',
    input: {
      round: 1,
      questionId: 'q1',
      question: 'What is the review goal?',
      target: { componentId: 'review', dimension: 'goal' },
    },
  });

  assert.equal(result.state.pendingRound.roundKey, 'round-key-contract::r:1::q:q1');
  assert.equal(result.state.pendingRound.forcedUser, false);
});


test('DI-UNIT-NEW-008 clamp mirrors gajae clampReportedAmbiguity without rounding', () => {
  assert.deepEqual(clamp(0.333, 0), { effective: 0.333, clamped: false });
  assert.deepEqual(clamp(0.333, 0.5), { effective: 0.5, clamped: true });
  assert.deepEqual(clamp(0.4567, 0.2), { effective: 0.4567, clamped: false });
});