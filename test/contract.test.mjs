import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { materializeEffects } from '../skills/ulw-interview/runtime/cli.mjs';

const root = new URL('..', import.meta.url);
const cli = fileURLToPath(new URL('./skills/ulw-interview/runtime/cli.mjs', root));

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

function start() {
  const result = event(null, 'initialize', {
    interviewId: 'contract-flow',
    type: 'greenfield',
    idea: 'Build an intake pipeline with review UI and audit exports.',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.output;
}

function confirmTopology(state) {
  const result = event(state, 'confirm_topology', {
    confirmedAt: '2026-07-17T00:00:00.000Z',
    components: [
      { id: 'ingestion', name: 'Ingestion', status: 'active', description: 'Load CSVs.' },
      { id: 'review-ui', name: 'Review UI', status: 'active', description: 'Approve records.' },
      { id: 'export', name: 'Export', status: 'deferred', deferralReason: 'Later release.' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  return result.output;
}

function panelFindings() {
  return [
    {
      persona: 'analyst',
      finding: 'The target is coherent.',
      rationale: ['No contradiction was found.'],
      suggested_options: ['Continue.'],
      confidence: 'high',
    },
    {
      persona: 'critic',
      finding: 'The assumption should still be challenged.',
      rationale: ['The user has not named non-goals.'],
      suggested_options: ['Ask for non-goals.'],
      confidence: 'medium',
    },
  ];
}

test('DI-KEEP-CLI-001 rejects malformed JSON and over-budget stdin without stdout', () => {
  const malformed = spawnSync(process.execPath, [cli], { encoding: 'utf8', input: '{not-json\n' });
  assert.notEqual(malformed.status, 0);
  assert.equal(malformed.stdout, '');
  assert.match(malformed.stderr, /invalid json/i);

  const oversized = spawnSync(process.execPath, [cli], {
    encoding: 'utf8',
    input: 'x'.repeat(1_048_577),
  });
  assert.notEqual(oversized.status, 0);
  assert.equal(oversized.stdout, '');
  assert.match(oversized.stderr, /input exceeds/i);
});

test('DI-KEEP-CLI-002 materializes persist_spec atomically without replacing existing files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ulw-interview-contract-'));
  try {
    const [effect] = materializeEffects([{ type: 'persist_spec', directory, slug: 'payments', markdown: '# Payment report\n' }]);
    assert.equal(existsSync(effect.path), true);
    assert.equal(readFileSync(effect.path, 'utf8'), '# Payment report\n');
    assert.match(effect.sha256, /^[a-f0-9]{64}$/);
    assert.throws(
      () => materializeEffects([{ type: 'persist_spec', directory, slug: 'payments', markdown: '# Other\n' }]),
      /spec path already exists/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('DI-KEEP-CLI-003 rejects state that exceeds the serialized state budget', () => {
  const rejected = event(null, 'initialize', {
    interviewId: 'large-state',
    type: 'greenfield',
    idea: 'x'.repeat(950_000),
  });

  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /state exceeds/i);
});

test('DI-KEEP-PLUGIN-001 keeps plugin skill registration idempotent and fragments non-public', async () => {
  const pluginModule = await import('../.opencode/plugins/ulw-interview.js');
  const plugin = await pluginModule.UlwInterviewPlugin();
  const config = { skills: { paths: [] } };
  await plugin.config(config);
  await plugin.config(config);

  assert.equal(config.skills.paths.length, 1);
  assert.equal(config.skills.paths[0].endsWith('/skills'), true);
});

test('DI-CONTRACT-NEW-001 initialize seeds the full topology-phase state and threshold announcement', () => {
  const result = start();

  assert.equal(result.state.ambiguity, 1);
  assert.equal(result.state.reportedAmbiguity, 1);
  assert.equal(result.state.band, 'initial');
  assert.deepEqual(result.state.ambiguityFloor, {
    floor: 0,
    disputedFactCount: 0,
    unscoredActiveComponentCount: 0,
    autoAnswerRatio: 0,
  });
  assert.deepEqual(result.state.autoResearchedRounds, []);
  assert.deepEqual(result.state.closureOverrides, []);
  assert.equal(result.state.restatedGoal, null);
  assert.equal(result.state.softWarningShown, false);
  assert.deepEqual(result.effects, [
    { type: 'announce_threshold', threshold: 0.05, thresholdSource: 'default' },
    { type: 'ask_topology' },
  ]);
});

test('DI-CONTRACT-NEW-002 confirm_topology locks components and opens round 1 without a baseline phase', () => {
  const initialized = start();
  const result = confirmTopology(initialized.state);

  assert.equal(result.state.phase, 'round');
  assert.equal(result.state.topologyStatus, 'confirmed');
  assert.equal(result.state.topology.confirmedAt, '2026-07-17T00:00:00.000Z');
  assert.deepEqual(result.effects, [{
    type: 'open_round',
    round: 1,
    target: { componentId: 'ingestion', dimension: 'goal' },
  }]);
});

test('DI-CONTRACT-NEW-003 open_round accepts only the runtime-selected target and emits forcedUser', () => {
  let result = confirmTopology(start().state);
  result = event(result.state, 'open_round', {
    round: 1,
    questionId: 'q1',
    question: 'What outcome must ingestion produce?',
    target: { componentId: 'ingestion', dimension: 'goal' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.state.pendingRound.roundKey, 'contract-flow::r:1::q:q1');
  assert.equal(result.output.state.pendingRound.forcedUser, false);
  assert.deepEqual(result.output.effects, [{
    type: 'ask_user',
    round: 1,
    target: { componentId: 'ingestion', dimension: 'goal' },
    forcedUser: false,
  }]);
});

test('DI-CONTRACT-NEW-004 submit_answer refinement and panel gates block scoring until resolved', () => {
  let result = confirmTopology(start().state);
  result = event(result.state, 'open_round', {
    round: 1,
    questionId: 'q1',
    question: 'What outcome must ingestion produce?',
    target: { componentId: 'ingestion', dimension: 'goal' },
  });
  assert.equal(result.status, 0, result.stderr);
  const refinement = event(result.output.state, 'submit_answer', {
    round: 1,
    answer: { kind: 'user', text: 'It should normalize records because reviewers need comparable rows.', source: 'direct' },
    needsRefinement: true,
  });

  assert.equal(refinement.status, 0, refinement.stderr);
  assert.deepEqual(refinement.output.effects, [{ type: 'refine_answer', round: 1 }]);
  const blocked = event(refinement.output.state, 'record_score', {
    round: 1,
    componentScores: { ingestion: { goal: 0.9, constraints: 0.5, criteria: 0.5 }, 'review-ui': { goal: 0.5, constraints: 0.5, criteria: 0.5 } },
  });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /refinement|pending/i);
});

test('DI-CONTRACT-NEW-005 agent answers dispatch the analyst/critic pre-answer panel and require ordered findings', () => {
  let result = confirmTopology(start().state);
  result = event(result.state, 'open_round', {
    round: 1,
    questionId: 'q1',
    question: 'What outcome must ingestion produce?',
    target: { componentId: 'ingestion', dimension: 'goal' },
  });
  assert.equal(result.status, 0, result.stderr);
  result = event(result.output.state, 'submit_answer', {
    round: 1,
    answer: { kind: 'agent', text: 'Use a conventional CSV normalization pipeline.', source: 'agent', confidence: 'medium', uncertainty: 0.4 },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.output.effects, [{
    type: 'run_lateral_panel',
    round: 1,
    reason: 'pre-answer',
    personas: ['analyst', 'critic'],
    architectLens: false,
  }]);
  const completed = event(result.output.state, 'panel_completed', { findings: panelFindings() });
  assert.equal(completed.status, 0, completed.stderr);
  assert.deepEqual(completed.output.effects, [{ type: 'score_answer', round: 1 }]);
});

test('DI-CONTRACT-NEW-006 record_score stores reported/floor/effective metrics, ontology stability, and weakest target', () => {
  let result = confirmTopology(start().state);
  result = event(result.state, 'open_round', {
    round: 1,
    questionId: 'q1',
    question: 'What outcome must ingestion produce?',
    target: { componentId: 'ingestion', dimension: 'goal' },
  });
  result = event(result.output.state, 'submit_answer', {
    round: 1,
    answer: { kind: 'user', text: 'CSV rows become normalized review records.', source: 'direct' },
  });
  assert.equal(result.status, 0, result.stderr);
  result = event(result.output.state, 'record_score', {
    round: 1,
    componentScores: {
      ingestion: { goal: 0.9, constraints: 0.5, criteria: 0.5, justification: 'Goal clear.', gap: 'Need constraints.' },
      'review-ui': { goal: 0.4, constraints: 0.4, criteria: 0.4, justification: 'Sibling unclear.', gap: 'Need UI details.' },
    },
    weakestComponentId: 'review-ui',
    weakestDimension: 'goal',
    weakestRationale: 'Review UI has the highest component ambiguity.',
    ontology: [{ name: 'ReviewRecord', type: 'core', fields: ['id', 'status'], relationships: ['Reviewer approves ReviewRecord'] }],
    establishedFacts: [{ id: 'F1', statement: 'CSV rows become review records.', component: 'ingestion', dimension: 'goal' }],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.output.effects[0], {
    type: 'report_progress',
    round: 1,
    reported: 0.6,
    floor: 0,
    effective: 0.6,
    band: 'progress',
    bandChanged: true,
    clamped: false,
    stallDetected: false,
    escalation: null,
    weakest: { componentId: 'review-ui', dimension: 'goal' },
    triggerSummary: [],
  });
  assert.deepEqual(result.output.state.ontologySnapshots[0], {
    round: 1,
    entities: [{ name: 'ReviewRecord', type: 'core', fields: ['id', 'status'], relationships: ['Reviewer approves ReviewRecord'] }],
    stable: 0,
    changed: 0,
    new: 1,
    removed: 0,
    ratio: null,
  });
});

test('DI-CONTRACT-NEW-007 active triggers are rejected on first score and must lower prior scores later', () => {
  let result = confirmTopology(start().state);
  result = event(result.state, 'open_round', {
    round: 1,
    questionId: 'q1',
    question: 'What outcome must ingestion produce?',
    target: { componentId: 'ingestion', dimension: 'goal' },
  });
  result = event(result.output.state, 'submit_answer', {
    round: 1,
    answer: { kind: 'user', text: 'The scope expanded to exports.', source: 'direct' },
  });
  const rejected = event(result.output.state, 'record_score', {
    round: 1,
    componentScores: {
      ingestion: { goal: 0.5, constraints: 0.5, criteria: 0.5 },
      'review-ui': { goal: 0.5, constraints: 0.5, criteria: 0.5 },
    },
    triggers: [{ kind: 'D', status: 'active', component: 'ingestion', dimension: 'goal', evidence: 'Scope expansion.', rationale: 'New deliverable.' }],
  });

  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /first-ever scored round|prior/i);
});

test('DI-CONTRACT-NEW-008 request_closure is a guarded early-exit event with a min-round rejection', () => {
  const initialized = start();
  const rejected = event(initialized.state, 'request_closure', {});

  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /min-rounds no-bypass|scoredRounds>=3|softWarningShown|hardCapReached/i);
});

test('DI-CONTRACT-NEW-009 user_stop is accepted in any non-written phase and reports rounds, ambiguity, and band', () => {
  const initialized = start();
  const stopped = event(initialized.state, 'user_stop', {});

  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(stopped.output.state.phase, 'stopped');
  assert.deepEqual(stopped.output.effects, [{
    type: 'stop',
    rounds: 0,
    ambiguity: 1,
    band: 'initial',
    reason: 'user_requested',
  }]);
});

test('DI-CONTRACT-NEW-010 write_spec enforces closurePassed and restatementConfirmed before persistence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ulw-interview-write-gate-'));
  try {
    const initialized = start();
    const rejected = event({
      ...initialized.state,
      phase: 'write',
      closurePassed: false,
      restatementConfirmed: false,
    }, 'write_spec', {
      directory,
      slug: 'review-workflow',
      markdown: '# Review workflow\n',
      status: 'PASSED',
    });

    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /closurePassed|restatementConfirmed|write phases/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('DI-CONTRACT-NEW-011 submit_answer rejects a double submit for the same round', () => {
  let result = confirmTopology(start().state);
  result = event(result.state, 'open_round', {
    round: 1,
    questionId: 'q1',
    question: 'What outcome must ingestion produce?',
    target: { componentId: 'ingestion', dimension: 'goal' },
  });
  assert.equal(result.status, 0, result.stderr);
  result = event(result.output.state, 'submit_answer', {
    round: 1,
    answer: { kind: 'user', text: 'First answer', source: 'direct' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.output.effects, [{ type: 'score_answer', round: 1 }]);

  const replay = event(result.output.state, 'submit_answer', {
    round: 1,
    answer: { kind: 'user', text: 'Second answer overwrites first', source: 'direct' },
  });
  assert.notEqual(replay.status, 0);
  assert.match(replay.stderr, /already recorded/i);
});