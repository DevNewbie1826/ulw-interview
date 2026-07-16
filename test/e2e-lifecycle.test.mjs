import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const cli = fileURLToPath(new URL('./skills/ulw-interview/runtime/cli.mjs', root));
const confirmedAt = '2026-07-17T00:00:00.000Z';

function run(request) {
  const result = spawnSync(process.execPath, [cli], {
    encoding: 'utf8',
    input: `${JSON.stringify(request)}\n`,
  });
  return {
    ...result,
    output: result.stdout ? JSON.parse(result.stdout) : null,
  };
}

function event(state, type, input = {}) {
  return run({ state, event: { type, input } });
}

function mustSucceed(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.output, null);
  return result.output;
}

function mustReject(result) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.output, null);
  assert.notEqual(result.stderr, '');
}

function assertEffects(output, names) {
  assert.deepEqual(output.effects.map((effect) => effect.type), names);
}

function panelFindings() {
  return [
    { persona: 'analyst', finding: 'The interview state is coherent enough to continue.', rationale: ['The latest answer narrows a named ambiguity dimension.'], suggested_options: ['Continue with the runtime-selected target.'], confidence: 'high' },
    { persona: 'critic', finding: 'A remaining assumption still deserves pressure testing.', rationale: ['The host should preserve the next question instead of skipping ahead.'], suggested_options: ['Ask the next ordered question.'], confidence: 'medium' },
  ];
}

function initialize(interviewId, input = {}) {
  const output = mustSucceed(event(null, 'initialize', {
    interviewId,
    type: 'greenfield',
    idea: 'Clarify a cross-functional launch workflow before implementation.',
    ...input,
  }));
  assertEffects(output, ['announce_threshold', 'ask_topology']);
  return output;
}

function confirmTopology(state, components) {
  const output = mustSucceed(event(state, 'confirm_topology', { components, confirmedAt }));
  assertEffects(output, ['open_round']);
  assert.equal(output.state.phase, 'round');
  return output;
}

function openRuntimeRound(state, openEffect, questionId) {
  const output = mustSucceed(event(state, 'open_round', {
    round: openEffect.round,
    questionId,
    question: `Question ${questionId}: clarify ${openEffect.target.componentId} ${openEffect.target.dimension}.`,
    target: openEffect.target,
  }));
  assertEffects(output, ['ask_user']);
  return output;
}

function submitUserAnswer(state, round, text, extra = {}) {
  const output = mustSucceed(event(state, 'submit_answer', {
    round,
    answer: { kind: 'user', text, source: 'direct' },
    ...extra,
  }));
  assertEffects(output, ['score_answer']);
  return output;
}

function scoreAll(components, score) {
  return Object.fromEntries(components.map((component) => [component.id, { goal: score, constraints: score, criteria: score }]));
}

function temporaryDirectory(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function auditPassed(state, rationale = 'Ready threshold reached.') {
  const output = mustSucceed(event(state, 'audit_closure', { passed: true, rationale }));
  assertEffects(output, ['request_restate']);
  return output;
}

function completeMilestonePanel(output, expectedContinuation) {
  assertEffects(output, ['report_progress', 'run_lateral_panel']);
  assert.equal(output.effects[1].reason, 'milestone');
  assert.deepEqual(output.effects[1].personas, ['analyst', 'critic']);
  const completed = mustSucceed(event(output.state, 'panel_completed', { findings: panelFindings() }));
  assertEffects(completed, [expectedContinuation]);
  assert.equal(completed.state.pendingPanel, null);
  return completed;
}

function scoreRound(state, round, componentScores, extra = {}) {
  return mustSucceed(event(state, 'record_score', {
    round,
    componentScores,
    weakestComponentId: Object.keys(componentScores)[0],
    weakestDimension: 'goal',
    weakestRationale: 'The host follows the runtime-selected weakest target.',
    ...extra,
  }));
}

function driveScoredRound(state, openEffect, options) {
  let output = openRuntimeRound(state, openEffect, `q${options.round}`);
  output = submitUserAnswer(output.state, options.round, options.answer ?? `Round ${options.round} answer.`);
  return scoreRound(output.state, options.round, options.componentScores, options.scoreInput);
}

function driveToClosure(interviewId, components) {
  let output = confirmTopology(initialize(interviewId).state, components);
  let milestoneCount = 0;
  const scores = [0.4, 0.75, 0.95];
  for (const [index, score] of scores.entries()) {
    output = driveScoredRound(output.state, output.effects[0], {
      round: index + 1,
      componentScores: scoreAll(components.filter((component) => component.status === 'active'), score),
    });
    if (output.effects[1].type === 'run_lateral_panel') {
      milestoneCount += 1;
      output = completeMilestonePanel(output, 'open_round');
    }
  }
  assertEffects(output, ['report_progress', 'request_closure_audit']);
  assert.equal(output.effects[1].reason, 'ready');
  assert.equal(output.state.phase, 'closure');
  assert.equal(output.state.ambiguity, 0.05);
  return { output, milestoneCount };
}

test('S-HAPPY drives a complete greenfield lifecycle through real CLI persistence', (t) => {
  const directory = temporaryDirectory(t, 'ulw-interview-happy-');
  const components = [
    { id: 'intake', name: 'Intake', status: 'active', description: 'Collect launch requests.' },
    { id: 'approval', name: 'Approval', status: 'active', description: 'Approve launch readiness.' },
  ];
  const closed = driveToClosure('e2e-happy', components);
  assert.ok(closed.milestoneCount >= 1);

  let output = auditPassed(closed.output.state);
  assert.equal(output.state.phase, 'restate');

  output = mustSucceed(event(output.state, 'confirm_restate', { confirmed: true, goal: 'Launch requests move from intake to approval with explicit readiness criteria.' }));
  assertEffects(output, ['write_spec']);
  assert.equal(output.state.phase, 'write');

  output = mustSucceed(event(output.state, 'write_spec', { directory, slug: 'launch-workflow', markdown: '# Launch workflow\n\nThe interview reached closure and restatement confirmation.\n', status: 'PASSED' }));
  assertEffects(output, ['persist_spec']);
  assert.equal(output.state.phase, 'written');
  assert.match(output.effects[0].path, /launch-workflow\.md$/);
  assert.match(output.effects[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(output.effects[0].path), true);
  assert.match(readFileSync(output.effects[0].path, 'utf8'), /interview reached closure/);
});

test('S-EVASIVE preserves high ambiguity and only allows closure through early exit', () => {
  const components = [{ id: 'scope', name: 'Scope', status: 'active' }, { id: 'risk', name: 'Risk', status: 'active' }];
  let output = confirmTopology(initialize('e2e-evasive').state, components);
  let openEffect = output.effects[0];
  const trigger = { kind: 'C', status: 'disputed', component: 'scope', dimension: 'goal', evidence: 'The answer avoids commitment.', rationale: 'The user disputed whether the goal is knowable yet.' };

  for (const round of [1, 2, 3]) {
    output = driveScoredRound(output.state, openEffect, { round, answer: 'Maybe later; the team is not ready to decide.', componentScores: scoreAll(components, 0.2), scoreInput: { triggers: [trigger] } });
    assertEffects(output, ['report_progress', 'open_round']);
    assert.equal(output.effects[0].effective >= 0.5, true);
    assert.equal(output.effects.some((effect) => effect.type === 'request_closure_audit'), false);
    openEffect = output.effects[1];

    if (round === 2) {
      const earlyRejected = event(output.state, 'request_closure', {});
      mustReject(earlyRejected);
      assert.match(earlyRejected.stderr, /min-rounds no-bypass|scoredRounds>=3/i);
    }
  }

  assert.equal(output.state.ambiguity >= 0.5, true);
  const nonEarlyClosure = event({ ...output.state, phase: 'closure', earlyExitRequested: false }, 'audit_closure', { passed: true, rationale: 'This must not bypass the threshold.' });
  mustReject(nonEarlyClosure);
  assert.match(nonEarlyClosure.stderr, /threshold|earlyExit/i);

  output = mustSucceed(event(output.state, 'request_closure', {}));
  assertEffects(output, ['request_closure_audit']);
  assert.equal(output.effects[0].reason, 'early-exit');
  assert.equal(output.state.earlyExitRequested, true);

  output = auditPassed(output.state, 'Accepted as an early exit.');
  assert.equal(output.state.phase, 'restate');
});

test('S-RESTATE-LOOP routes the first restatement failure through correction and the second to a plain round', () => {
  const components = [{ id: 'workflow', name: 'Workflow', status: 'active' }];
  let output = driveToClosure('e2e-restate-loop', components).output;

  output = auditPassed(output.state);

  output = mustSucceed(event(output.state, 'confirm_restate', { confirmed: false, correction: 'The goal missed operator handoff.' }));
  assertEffects(output, ['open_round']);
  assert.equal(output.effects[0].restateCorrection, true);
  assert.equal(output.state.phase, 'round');

  output = driveScoredRound(output.state, output.effects[0], { round: 4, answer: 'The corrected goal includes operator handoff and acceptance checks.', componentScores: scoreAll(components, 0.96) });
  assertEffects(output, ['report_progress', 'request_closure_audit']);

  output = auditPassed(output.state, 'Correction round restored closure.');

  output = mustSucceed(event(output.state, 'confirm_restate', { confirmed: false, correction: 'The goal is still not restated in user terms.' }));
  assertEffects(output, ['open_round']);
  assert.equal(Object.hasOwn(output.effects[0], 'restateCorrection'), false);
  assert.equal(output.state.phase, 'round');
  assert.equal(output.state.restateLoops, 2);
});

test('S-RETRACT disputes facts from a replaced round and raises the immediate floor', () => {
  const components = [{ id: 'ledger', name: 'Ledger', status: 'active' }];
  let output = confirmTopology(initialize('e2e-retract', { threshold: 0.01, thresholdSource: 'host' }).state, components);

  output = driveScoredRound(output.state, output.effects[0], { round: 1, componentScores: scoreAll(components, 0.95) });
  output = completeMilestonePanel(output, 'open_round');

  output = driveScoredRound(output.state, output.effects[0], {
    round: 2,
    answer: 'The ledger exports one immutable audit file.',
    componentScores: scoreAll(components, 0.95),
    scoreInput: {
      establishedFacts: [{ id: 'F-ledger-export', statement: 'The ledger exports one immutable audit file.', component: 'ledger', dimension: 'criteria' }],
    },
  });
  assertEffects(output, ['report_progress', 'open_round']);
  assert.equal(output.state.facts[0].disputed, false);
  assert.equal(output.state.ambiguity, 0.05);

  output = submitUserAnswer(output.state, 2, 'Actually, the ledger exports two files with different retention.', { replacesRound: 2 });
  assert.equal(output.state.facts[0].disputed, true);
  assert.equal(output.state.factEvents.at(-1).type, 'disputed');
  assert.equal(output.state.ambiguityFloor.floor, 0.1);
  assert.equal(output.state.ambiguity >= 0.1, true);
});

test('S-NOBYPASS rejects out-of-order lifecycle events with stderr and empty stdout', (t) => {
  const directory = temporaryDirectory(t, 'ulw-interview-nobypass-');
  const components = [{ id: 'gate', name: 'Gate', status: 'active' }];
  const initialized = initialize('e2e-nobypass');
  const mid = confirmTopology(initialized.state, components);

  mustReject(event(mid.state, 'record_score', { round: 1, componentScores: scoreAll(components, 0.9) }));
  mustReject(event(mid.state, 'open_round', { round: 1, questionId: 'bad-target', question: 'Can the host pick a different target?', target: { componentId: 'gate', dimension: 'criteria' } }));
  mustReject(event(mid.state, 'audit_closure', { passed: true }));
  mustReject(event(mid.state, 'confirm_topology', { components, confirmedAt }));

  let output = driveToClosure('e2e-nobypass-write', components).output;
  output = auditPassed(output.state);
  mustReject(event(output.state, 'write_spec', { directory, slug: 'not-yet', markdown: '# Not yet\n', status: 'PASSED' }));
});
