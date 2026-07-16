import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const cli = fileURLToPath(new URL('./skills/ulw-interview/runtime/cli.mjs', root));
const confirmedAt = '2026-07-17T00:00:00.000Z';

function run(envelope) {
  const result = spawnSync(process.execPath, [cli], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
    input: `${JSON.stringify(envelope)}\n`,
  });
  return {
    ...result,
    output: result.stdout ? JSON.parse(result.stdout) : null,
  };
}

function event(state, type, input = {}) {
  return run({ state, event: { type, input } });
}

function ok(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.output, null);
  return result.output;
}

function assertRejected(result, id) {
  assert.deepEqual(
    {
      statusRejected: result.status !== 0,
      stdoutEmpty: result.stdout === '',
      stderrNonEmpty: result.stderr.trim() !== '',
    },
    { statusRejected: true, stdoutEmpty: true, stderrNonEmpty: true },
    `${id} tampered next event must reject with non-zero exit, empty stdout, and non-empty stderr`,
  );
}

function findings() {
  return [
    { persona: 'analyst', finding: 'ok', rationale: ['ok'], suggested_options: ['ok'], confidence: 'high' },
    { persona: 'critic', finding: 'ok', rationale: ['ok'], suggested_options: ['ok'], confidence: 'medium' },
  ];
}

function maybeResolveMilestone(output) {
  if (output.effects[1]?.type !== 'run_lateral_panel') return output;
  return ok(event(output.state, 'panel_completed', { findings: findings() }));
}

test('DI-HOSTILE-001 rejects scored-score tamper before the next open_round', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-flip-score', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal' }));
  out = maybeResolveMilestone(out);
  out.state.rounds[0].componentScores.c1.goal = 0;

  assertRejected(event(out.state, 'open_round', { round: 2, questionId: 'q2', question: 'q2', target: out.effects.at(-1).target }), 'DI-HOSTILE-001');
});

test('DI-HOSTILE-002 rejects topology id rewrite before the next open_round', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-topology-id', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal' }));
  out = maybeResolveMilestone(out);
  out.state.topology.components[0].id = 'pwned';
  out.state.rounds[0].componentScores = { pwned: out.state.rounds[0].componentScores.c1 };
  out.state.rounds[0].target.componentId = 'pwned';

  assertRejected(event(out.state, 'open_round', { round: 2, questionId: 'q2', question: 'q2', target: { componentId: 'pwned', dimension: 'goal' } }), 'DI-HOSTILE-002');
});

test('DI-HOSTILE-003 rejects threshold change before the next open_round', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-threshold', type: 'greenfield', idea: 'x', threshold: 0.05 }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal' }));
  out = maybeResolveMilestone(out);
  out.state.threshold = 1;
  out.state.band = 'ready';

  assertRejected(event(out.state, 'open_round', { round: 2, questionId: 'q2', question: 'q2', target: out.effects.at(-1).target }), 'DI-HOSTILE-003');
});

test('DI-HOSTILE-004 rejects factEvents deletion before the next open_round', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-remove-fact-events', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal', establishedFacts: [{ id: 'fact1', statement: 'Fact one.', component: 'c1', dimension: 'goal' }] }));
  out = maybeResolveMilestone(out);
  out.state.factEvents = [];

  assertRejected(event(out.state, 'open_round', { round: 2, questionId: 'q2', question: 'q2', target: out.effects.at(-1).target }), 'DI-HOSTILE-004');
});

test('DI-HOSTILE-005 rejects legacy-array metric bypass before the next open_round', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-legacy-topology', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal' }));
  out = maybeResolveMilestone(out);
  out.state.topology = out.state.topology.components;
  out.state.ambiguity = 0.99;

  assertRejected(event(out.state, 'open_round', { round: 2, questionId: 'q2', question: 'q2', target: out.effects.at(-1).target }), 'DI-HOSTILE-005');
});

test('DI-HOSTILE-006 rejects streak mutation before the next open_round', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-streak', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal' }));
  out = maybeResolveMilestone(out);
  out.state.autoAnswerStreak = 99;

  assertRejected(event(out.state, 'open_round', { round: 2, questionId: 'q2', question: 'q2', target: out.effects.at(-1).target }), 'DI-HOSTILE-006');
});

test('DI-HOSTILE-007 rejects thresholdSource non-string initialize input', () => {
  assertRejected(event(null, 'initialize', { interviewId: 'repro-threshold-source', type: 'greenfield', idea: 'x', thresholdSource: { bad: true } }), 'DI-HOSTILE-007');
});

test('DI-HOSTILE-008 rejects duplicate replacesRound before rescoring', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-replace-twice', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal', establishedFacts: [{ id: 'fact1', statement: 'Fact one.', component: 'c1', dimension: 'goal' }] }));
  out = ok(event(out.state, 'submit_answer', { round: 1, replacesRound: 1, answer: { kind: 'user', text: 'replacement one', source: 'direct' } }));

  assertRejected(event(out.state, 'submit_answer', { round: 1, replacesRound: 1, answer: { kind: 'user', text: 'replacement two', source: 'direct' } }), 'DI-HOSTILE-008');
});

test('DI-HOSTILE-009 rejects forcedUser tamper before a fourth agent answer', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-forced-user', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  for (const round of [1, 2, 3]) {
    out = ok(event(out.state, 'open_round', { round, questionId: `q${round}`, question: `q${round}`, target: out.effects.at(-1).target }));
    out = ok(event(out.state, 'submit_answer', { round, answer: { kind: 'agent', text: 'agent', source: 'agent' } }));
    out = ok(event(out.state, 'panel_completed', { findings: findings() }));
    out = ok(event(out.state, 'record_score', { round, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal' }));
    if (out.effects[1]?.type === 'run_lateral_panel') out = ok(event(out.state, 'panel_completed', { findings: findings() }));
  }
  out = ok(event(out.state, 'open_round', { round: 4, questionId: 'q4', question: 'q4', target: out.effects.at(-1).target }));
  out.state.pendingRound.forcedUser = false;

  assertRejected(event(out.state, 'submit_answer', { round: 4, answer: { kind: 'agent', text: 'bypass', source: 'agent' } }), 'DI-HOSTILE-009');
});

test('DI-HOSTILE-010 rejects duplicate ontology names in one snapshot', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-ontology-duplicate', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));

  assertRejected(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal', ontology: [{ name: 'User', type: 'actor', fields: ['id'] }, { name: 'user', type: 'actor', fields: ['name'] }] }), 'DI-HOSTILE-010');
});

test('DI-HOSTILE-011 rejects empty ontology entity fields', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-ontology-empty', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'a', source: 'direct' } }));

  assertRejected(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.4, constraints: 0.4, criteria: 0.4 } }, weakestComponentId: 'c1', weakestDimension: 'goal', ontology: [{ name: '', type: '', fields: [] }] }), 'DI-HOSTILE-011');
});

test('DI-HOSTILE-012 rejects pendingRound.target tamper before submit_answer', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-pending-target', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }, { id: 'c2', name: 'C2', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out.state.pendingRound.target = { componentId: 'c2', dimension: 'criteria' };

  assertRejected(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'user', text: 'hijacked', source: 'direct' } }), 'DI-HOSTILE-012');
});


test('DI-HOSTILE-013 rejects audit_closure with a tampered allDimensionsClear flag', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-allclear-tamper', type: 'greenfield', idea: 'x' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out.state.phase = 'closure';
  out.state.allDimensionsClear = true;

  assertRejected(event(out.state, 'audit_closure', { passed: true }), 'DI-HOSTILE-013');
});

test('DI-HOSTILE-014 rejects audit_closure with a tampered pendingThresholdCrossingConfirmation flag', () => {
  let out = ok(event(null, 'initialize', { interviewId: 'repro-crossing-tamper', type: 'greenfield', idea: 'x', threshold: 0.05, thresholdSource: 'default' }));
  out = ok(event(out.state, 'confirm_topology', { components: [{ id: 'c1', name: 'C1', status: 'active' }], confirmedAt }));
  out = ok(event(out.state, 'open_round', { round: 1, questionId: 'q1', question: 'q1', target: out.effects[0].target }));
  out = ok(event(out.state, 'submit_answer', { round: 1, answer: { kind: 'agent', text: 'agent decides', source: 'agent', confidence: 'high', uncertainty: 0 } }));
  out = ok(event(out.state, 'panel_completed', { findings: findings() }));
  out = ok(event(out.state, 'record_score', { round: 1, componentScores: { c1: { goal: 0.95, constraints: 0.95, criteria: 0.95 } }, weakestComponentId: 'c1', weakestDimension: 'goal' }));

  assert.equal(out.state.pendingThresholdCrossingConfirmation, true);
  assert.equal(out.effects.at(-1).type, 'request_closure_audit');
  assert.equal(out.effects.at(-1).thresholdCrossingConfirmation, true);
  assertRejected(event(out.state, 'audit_closure', { passed: true }), 'DI-HOSTILE-014 control (unconfirmed crossing must reject)');

  out.state.pendingThresholdCrossingConfirmation = false;
  assertRejected(event(out.state, 'audit_closure', { passed: true }), 'DI-HOSTILE-014');
});