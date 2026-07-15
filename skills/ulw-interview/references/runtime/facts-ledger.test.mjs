#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const factsLedgerScript = join(runtimeDir, 'factsLedger.mjs');
const lockStaleMs = 5 * 60 * 1000;
const maxInputBytes = 1024 * 1024;
const tests = [];

function test(name, body) {
  tests.push({ name, body });
}

function makeSandbox(name, interviewId = `test-${name}`, createStateDir = true) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), `ulw-facts-ledger-${name}-`)));
  const stateDir = join(cwd, '.omo', 'state');
  const statePath = join(stateDir, `ulw-interview-facts-${interviewId}.json`);
  const lockPath = `${statePath}.lock`;
  if (createStateDir) mkdirSync(stateDir, { recursive: true });
  return {
    cleanup() {
      for (const path of [statePath, lockPath, `${statePath}.bak`]) rmSync(path, { force: true });
      rmSync(cwd, { recursive: true, force: true });
    },
    cwd,
    interviewId,
    lockPath,
    statePath,
  };
}

function runLedger(sandbox, args, input) {
  return spawnSync(
    process.execPath,
    [factsLedgerScript, ...args, '--interview-id', sandbox.interviewId],
    { cwd: sandbox.cwd, encoding: 'utf8', input },
  );
}

function appendF1(sandbox) {
  return runLedger(sandbox, ['append', '--fact-id', 'F1', '--claim', 'original', '--source-round', '1', '--confidence', 'user']);
}

test('oversized stdin fails before lock acquisition and filesystem side effects', () => {
  const sandbox = makeSandbox('oversized-stdin', 'oversized-stdin', false);
  try {
    const result = runLedger(sandbox, ['list'], 'x'.repeat(maxInputBytes + 1));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `factsLedger.mjs: Input exceeds ${maxInputBytes} bytes\n`);
    assert.equal(existsSync(sandbox.lockPath), false);
    assert.equal(existsSync(sandbox.statePath), false);
  } finally {
    sandbox.cleanup();
  }
});

function seedCompleteState(sandbox) {
  assert.equal(appendF1(sandbox).status, 0);
  assert.equal(runLedger(sandbox, ['dispute', '--fact-id', 'F1', '--reason', 'needs review']).status, 0);
  assert.equal(runLedger(sandbox, ['supersede', '--fact-id', 'F1', '--claim', 'replacement', '--source-round', '2']).status, 0);
  return JSON.parse(readFileSync(sandbox.statePath, 'utf8'));
}

test('existing valid append and supersede behavior is preserved', () => {
  const sandbox = makeSandbox('baseline-valid');
  try {
    const appended = appendF1(sandbox);
    assert.equal(appended.status, 0);
    assert.deepEqual(JSON.parse(appended.stdout), { ok: true });

    const superseded = runLedger(sandbox, ['supersede', '--fact-id', 'F1', '--claim', 'replacement', '--source-round', '2']);
    assert.equal(superseded.status, 0);
    assert.deepEqual(JSON.parse(superseded.stdout), { ok: true });

    const state = JSON.parse(readFileSync(sandbox.statePath, 'utf8'));
    assert.equal(state.entries.length, 2);
    assert.equal(state.entries[1].claim, 'replacement');
    assert.equal(state.entries[1].supersedes, 'F1');
    assert.equal(existsSync(sandbox.lockPath), false);
  } finally {
    sandbox.cleanup();
  }
});

test('valid 1-128 character interview IDs remain contained and functional', () => {
  for (const [name, interviewId] of [['one-character', 'A'], ['max-length', `A${'a'.repeat(127)}`]]) {
    const sandbox = makeSandbox(name, interviewId, false);
    try {
      const appended = appendF1(sandbox);
      assert.equal(appended.status, 0);
      assert.equal(dirname(sandbox.statePath), join(sandbox.cwd, '.omo', 'state'));
      assert.equal(existsSync(sandbox.statePath), true);
      assert.equal(runLedger(sandbox, ['list']).status, 0);
    } finally {
      sandbox.cleanup();
    }
  }
});

test('generated append dispute and supersede state reloads unchanged', () => {
  const sandbox = makeSandbox('valid-complete-state');
  try {
    const state = seedCompleteState(sandbox);
    const listed = runLedger(sandbox, ['list']);
    assert.equal(listed.status, 0);
    assert.deepEqual(JSON.parse(listed.stdout).entries, state.entries);
    assert.equal(runLedger(sandbox, ['queryDisputed']).status, 0);
  } finally {
    sandbox.cleanup();
  }
});

test('foreign fresh-lock refusal preserves the foreign lock', () => {
  const sandbox = makeSandbox('baseline-foreign-lock');
  try {
    const foreignLock = JSON.stringify({ pid: 424242, timestamp: Date.now() });
    writeFileSync(sandbox.lockPath, foreignLock);

    const refused = runLedger(sandbox, ['list']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^factsLedger\.mjs: Lock held \(age \d+s, pid 424242\)\. Refusing to proceed\.\n$/);
    assert.equal(readFileSync(sandbox.lockPath, 'utf8'), foreignLock);
  } finally {
    sandbox.cleanup();
  }
});

for (const [name, foreignLock] of [
  ['invalid JSON', 'not-json'],
  ['invalid schema with stale content timestamp', JSON.stringify({ timestamp: 0 })],
]) {
  test(`malformed foreign lock within stale threshold is refused and preserved: ${name}`, () => {
    const sandbox = makeSandbox(`fresh-malformed-${name.replaceAll(' ', '-')}`);
    try {
      writeFileSync(sandbox.lockPath, foreignLock);
      const freshMtime = new Date(Date.now() - lockStaleMs + 30_000);
      utimesSync(sandbox.lockPath, freshMtime, freshMtime);
      const originalMtime = statSync(sandbox.lockPath).mtimeMs;

      const refused = runLedger(sandbox, ['list']);
      assert.equal(refused.status, 1);
      assert.equal(refused.stdout, '');
      assert.match(refused.stderr, /^factsLedger\.mjs: Lock held \(age \d+s, pid unknown\)\. Refusing to proceed\.\n$/);
      assert.equal(readFileSync(sandbox.lockPath, 'utf8'), foreignLock);
      assert.equal(statSync(sandbox.lockPath).mtimeMs, originalMtime);
      assert.equal(existsSync(sandbox.statePath), false);
    } finally {
      sandbox.cleanup();
    }
  });
}

for (const [name, foreignLock] of [
  ['invalid JSON', 'not-json'],
  ['invalid schema with fresh content timestamp', JSON.stringify({ timestamp: Date.now() })],
]) {
  test(`malformed foreign lock older than stale threshold is reclaimed: ${name}`, () => {
    const sandbox = makeSandbox(`stale-malformed-${name.replaceAll(' ', '-')}`);
    try {
      writeFileSync(sandbox.lockPath, foreignLock);
      const staleMtime = new Date(Date.now() - lockStaleMs - 30_000);
      utimesSync(sandbox.lockPath, staleMtime, staleMtime);

      const listed = runLedger(sandbox, ['list']);
      assert.equal(listed.status, 0);
      assert.deepEqual(JSON.parse(listed.stdout), { entries: [] });
      assert.equal(existsSync(sandbox.lockPath), false);
      assert.equal(existsSync(sandbox.statePath), true);
    } finally {
      sandbox.cleanup();
    }
  });
}

test('controlled command failures release an acquired facts-ledger lock', () => {
  const sandbox = makeSandbox('controlled-failure-red');
  try {
    assert.equal(appendF1(sandbox).status, 0);

    const malformed = runLedger(sandbox, ['supersede', '--fact-id', 'F1', '--source-round', '2']);
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stderr, 'factsLedger.mjs: --claim required for supersede\n');
    assert.equal(existsSync(sandbox.lockPath), false, 'lock still present');

    const retry = runLedger(sandbox, ['supersede', '--fact-id', 'F1', '--claim', 'replacement after failure', '--source-round', '2']);
    assert.equal(retry.status, 0);
    const state = JSON.parse(readFileSync(sandbox.statePath, 'utf8'));
    assert.equal(state.entries.at(-1).claim, 'replacement after failure');
  } finally {
    sandbox.cleanup();
  }
});

const validAppendArgs = ['append', '--fact-id', 'F2', '--claim', 'retry append', '--source-round', '2', '--confidence', 'user'];
const validDisputeArgs = ['dispute', '--fact-id', 'F1', '--reason', 'retry dispute'];
const validSupersedeArgs = ['supersede', '--fact-id', 'F1', '--claim', 'retry supersede', '--source-round', '2'];

const controlledFailureCases = [
  ['append missing claim', ['append', '--source-round', '1', '--confidence', 'user'], '--claim required for append', false, validAppendArgs],
  ['append missing source-round', ['append', '--claim', 'x', '--confidence', 'user'], '--source-round required for append', false, validAppendArgs],
  ['append missing confidence', ['append', '--claim', 'x', '--source-round', '1'], '--confidence required for append', false, validAppendArgs],
  ['append invalid confidence', ['append', '--claim', 'x', '--source-round', '1', '--confidence', 'invalid'], '--confidence must be one of user|explore|oracle|inferred', false, validAppendArgs],
  ['append non-numeric source-round', ['append', '--claim', 'x', '--source-round', 'nope', '--confidence', 'user'], '--source-round must be numeric', false, validAppendArgs],
  ['append negative source-round', ['append', '--claim', 'x', '--source-round', '-1', '--confidence', 'user'], '--source-round must be a non-negative integer', false, validAppendArgs],
  ['append fractional source-round', ['append', '--claim', 'x', '--source-round', '1.5', '--confidence', 'user'], '--source-round must be a non-negative integer', false, validAppendArgs],
  ['append malformed fact-id', ['append', '--fact-id', '../bad', '--claim', 'x', '--source-round', '1', '--confidence', 'user'], '--fact-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}', false, validAppendArgs],
  ['append newline fact-id', ['append', '--fact-id', 'A\n', '--claim', 'x', '--source-round', '1', '--confidence', 'user'], '--fact-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}', false, validAppendArgs],
  ['dispute missing fact-id', ['dispute', '--reason', 'why'], '--fact-id required for dispute', true, validDisputeArgs],
  ['dispute missing reason', ['dispute', '--fact-id', 'F1'], '--reason required for dispute', true, validDisputeArgs],
  ['dispute malformed fact-id', ['dispute', '--fact-id', '../bad', '--reason', 'why'], '--fact-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}', true, validDisputeArgs],
  ['dispute nonexistent fact', ['dispute', '--fact-id', 'missing', '--reason', 'why'], 'Cannot dispute non-existent fact missing', true, validDisputeArgs],
  ['supersede missing fact-id', ['supersede', '--claim', 'x', '--source-round', '2'], '--fact-id required for supersede', true, validSupersedeArgs],
  ['supersede missing claim', ['supersede', '--fact-id', 'F1', '--source-round', '2'], '--claim required for supersede', true, validSupersedeArgs],
  ['supersede missing source-round', ['supersede', '--fact-id', 'F1', '--claim', 'x'], '--source-round required for supersede', true, validSupersedeArgs],
  ['supersede non-numeric source-round', ['supersede', '--fact-id', 'F1', '--claim', 'x', '--source-round', 'nope'], '--source-round must be numeric', true, validSupersedeArgs],
  ['supersede negative source-round', ['supersede', '--fact-id', 'F1', '--claim', 'x', '--source-round', '-1'], '--source-round must be a non-negative integer', true, validSupersedeArgs],
  ['supersede fractional source-round', ['supersede', '--fact-id', 'F1', '--claim', 'x', '--source-round', '1.5'], '--source-round must be a non-negative integer', true, validSupersedeArgs],
  ['supersede malformed fact-id', ['supersede', '--fact-id', '../bad', '--claim', 'x', '--source-round', '2'], '--fact-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}', true, validSupersedeArgs],
  ['supersede nonexistent fact', ['supersede', '--fact-id', 'missing', '--claim', 'x', '--source-round', '2'], 'Cannot supersede non-existent fact missing', true, validSupersedeArgs],
  ['unknown command', ['unknown'], 'Unknown command: unknown', false, ['list']],
];

for (const [name, args, errorMessage, seedFact, retryArgs] of controlledFailureCases) {
  test(`controlled failure cleanup: ${name}`, () => {
    const sandbox = makeSandbox(name.replaceAll(' ', '-'));
    try {
      if (seedFact) assert.equal(appendF1(sandbox).status, 0);
      const failed = runLedger(sandbox, args);
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, '');
      assert.equal(failed.stderr, `factsLedger.mjs: ${errorMessage}\n`);
      assert.equal(existsSync(sandbox.lockPath), false, 'lock still present');

      const retried = runLedger(sandbox, retryArgs);
      assert.equal(retried.status, 0);
      assert.equal(retried.stderr, '');
    } finally {
      sandbox.cleanup();
    }
  });
}

const invalidInterviewIds = [
  ['traversal', `../../../../ulw-facts-ledger-escape-${process.pid}`],
  ['nested path', 'a/b'],
  ['leading dot', '.hidden'],
  ['leading hyphen', '-bad'],
  ['space', 'bad id'],
  ['newline', 'A\n'],
  ['too long', 'A'.repeat(129)],
];

for (const [name, interviewId] of invalidInterviewIds) {
  test(`invalid interview ID rejected before filesystem side effects: ${name}`, () => {
    const sandbox = makeSandbox(`invalid-id-${name.replaceAll(' ', '-')}`, interviewId, false);
    try {
      const failed = runLedger(sandbox, ['list']);
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, '');
      assert.equal(failed.stderr, 'factsLedger.mjs: --interview-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}\n');
      assert.equal(existsSync(join(sandbox.cwd, '.omo')), false);
      assert.equal(existsSync(sandbox.statePath), false);
      assert.equal(existsSync(sandbox.lockPath), false);
    } finally {
      sandbox.cleanup();
    }
  });
}

const strictStateCases = [
  ['wrong version', (state) => { state.version = 2; }],
  ['wrong interview ownership', (state) => { state.interview_id = 'another-interview'; }],
  ['missing version', (state) => { delete state.version; }],
  ['unknown state field', (state) => { state.extra = true; }],
  ['invalid last_updated', (state) => { state.last_updated = 'not-an-iso-date'; }],
  ['duplicate fact IDs', (state) => { state.entries[2].fact_id = state.entries[0].fact_id; }],
  ['malformed fact ID', (state) => { state.entries[0].fact_id = '../bad'; state.entries[1].disputes = '../bad'; state.entries[2].supersedes = '../bad'; }],
  ['negative loaded source round', (state) => { state.entries[0].source_round = -1; }],
  ['fractional loaded source round', (state) => { state.entries[0].source_round = 1.5; }],
  ['missing entry field', (state) => { delete state.entries[0].confidence; }],
  ['unknown entry field', (state) => { state.entries[0].extra = true; }],
  ['invalid status', (state) => { state.entries[0].status = 'unknown'; }],
  ['invalid confidence', (state) => { state.entries[0].confidence = 'unknown'; }],
  ['invalid timestamp', (state) => { state.entries[0].created_at = 'yesterday'; }],
  ['reverse timestamp chronology', (state) => { state.entries[0].created_at = '2025-01-02T00:00:00.000Z'; state.entries[1].created_at = '2025-01-01T00:00:00.000Z'; state.entries[2].created_at = '2025-01-03T00:00:00.000Z'; state.last_updated = state.entries[2].created_at; }],
  ['dangling supersedes reference', (state) => { state.entries[2].supersedes = 'missing'; }],
  ['forward supersedes reference', (state) => { state.entries[0].supersedes = state.entries[2].fact_id; }],
  ['dangling disputes reference', (state) => { state.entries[1].disputes = 'missing'; }],
  ['malformed disputes reference', (state) => { state.entries[1].disputes = '../bad'; }],
  ['empty disputed reason', (state) => { state.entries[1].reason = ''; }],
  ['nonempty disputed claim', (state) => { state.entries[1].claim = 'unexpected'; }],
  ['nonzero disputed source round', (state) => { state.entries[1].source_round = 1; }],
  ['non-inferred disputed confidence', (state) => { state.entries[1].confidence = 'user'; }],
  ['disputed supersedes reference', (state) => { state.entries[1].supersedes = 'F1'; }],
  ['confirmed disputes reference', (state) => { state.entries[0].disputes = 'F1'; }],
  ['empty confirmed claim', (state) => { state.entries[0].claim = ''; }],
];

for (const [name, mutate] of strictStateCases) {
  test(`strict loaded state rejection releases acquired lock: ${name}`, () => {
    const sandbox = makeSandbox(`strict-${name.replaceAll(' ', '-')}`);
    try {
      const state = seedCompleteState(sandbox);
      mutate(state);
      const serialized = JSON.stringify(state, null, 2);
      writeFileSync(sandbox.statePath, serialized);
      const failed = runLedger(sandbox, ['list']);
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, '');
      assert.equal(failed.stderr, `factsLedger.mjs: State file corrupted at ${sandbox.statePath}. Run with --reset\n`);
      assert.equal(existsSync(sandbox.lockPath), false, 'lock still present');
      assert.equal(readFileSync(sandbox.statePath, 'utf8'), serialized);
    } finally {
      sandbox.cleanup();
    }
  });
}

for (const [name, stateContents] of [
  ['corrupt JSON state', '{garbage'],
  ['non-array entries state', JSON.stringify({ interview_id: 'invalid', version: 1, entries: {}, last_updated: null })],
]) {
  test(`controlled failure cleanup: ${name}`, () => {
    const sandbox = makeSandbox(name.replaceAll(' ', '-'));
    try {
      writeFileSync(sandbox.statePath, stateContents);
      const failed = runLedger(sandbox, ['list']);
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, '');
      assert.equal(failed.stderr, `factsLedger.mjs: State file corrupted at ${sandbox.statePath}. Run with --reset\n`);
      assert.equal(existsSync(sandbox.lockPath), false, 'lock still present');

      const reset = runLedger(sandbox, ['list', '--reset']);
      assert.equal(reset.status, 0);
      assert.deepEqual(JSON.parse(reset.stdout), { ok: true, reset: true });
    } finally {
      sandbox.cleanup();
    }
  });
}

test('malformed stdin fails before acquisition and creates no lock', () => {
  const sandbox = makeSandbox('malformed-stdin');
  try {
    const failed = runLedger(sandbox, ['list'], '{not-json');
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.equal(failed.stderr, 'factsLedger.mjs: Invalid JSON on stdin\n');
    assert.equal(existsSync(sandbox.lockPath), false);
    assert.equal(existsSync(sandbox.statePath), false);
  } finally {
    sandbox.cleanup();
  }
});

test('stale lock recovery still generates valid state', () => {
  const sandbox = makeSandbox('stale-lock');
  try {
    writeFileSync(sandbox.lockPath, JSON.stringify({ pid: 12345, timestamp: Date.now() - 6 * 60 * 1000 }));
    const listed = runLedger(sandbox, ['list']);
    assert.equal(listed.status, 0);
    assert.deepEqual(JSON.parse(listed.stdout), { entries: [] });
    assert.deepEqual(JSON.parse(readFileSync(sandbox.statePath, 'utf8')).entries, []);
    assert.equal(existsSync(sandbox.lockPath), false);
  } finally {
    sandbox.cleanup();
  }
});

test('repeated controlled failures clean up before a valid retry', () => {
  const sandbox = makeSandbox('repeated-cleanup');
  try {
    assert.equal(appendF1(sandbox).status, 0);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const failed = runLedger(sandbox, ['supersede', '--fact-id', 'F1', '--source-round', '2']);
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, '');
      assert.equal(existsSync(sandbox.lockPath), false, `lock still present after attempt ${attempt}`);
    }
    assert.equal(runLedger(sandbox, validSupersedeArgs).status, 0);
  } finally {
    sandbox.cleanup();
  }
});

function runManualScenario() {
  const sandbox = makeSandbox('manual-scenario');
  try {
    assert.equal(appendF1(sandbox).status, 0);
    const malformed = runLedger(sandbox, ['supersede', '--fact-id', 'F1', '--source-round', '2']);
    assert.equal(malformed.status, 1);
    const lockAfterFailure = existsSync(sandbox.lockPath);
    const valid = runLedger(sandbox, validSupersedeArgs);
    assert.equal(valid.status, 0);
    const listed = runLedger(sandbox, ['list']);
    assert.equal(listed.status, 0);
    const replacementPersisted = JSON.parse(listed.stdout).entries.some(
      (entry) => entry.claim === 'retry supersede' && entry.supersedes === 'F1',
    );
    const result = { status: 'PASS', lockAfterFailure, replacementPersisted };
    assert.deepEqual(result, { status: 'PASS', lockAfterFailure: false, replacementPersisted: true });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    sandbox.cleanup();
  }
}

function runForeignLockScenario() {
  const sandbox = makeSandbox('foreign-lock-scenario');
  try {
    const foreignLock = JSON.stringify({ pid: 424242, timestamp: Date.now() });
    writeFileSync(sandbox.lockPath, foreignLock);
    const refused = runLedger(sandbox, ['list']);
    const lockRemains = existsSync(sandbox.lockPath) && readFileSync(sandbox.lockPath, 'utf8') === foreignLock;
    const result = { status: 'PASS', refusalStatus: refused.status, lockRemains };
    assert.deepEqual(result, { status: 'PASS', refusalStatus: 1, lockRemains: true });
    assert.match(refused.stderr, /^factsLedger\.mjs: Lock held /);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    sandbox.cleanup();
  }
}

const scenario = process.argv.find((argument) => argument.startsWith('--scenario='));
if (scenario === '--scenario=manual') {
  runManualScenario();
} else if (scenario === '--scenario=foreign-lock') {
  runForeignLockScenario();
} else {
  let passed = 0;
  for (const { name, body } of tests) {
    try {
      body();
      passed += 1;
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      process.stderr.write(`FAIL ${name}: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
  process.stdout.write(`${JSON.stringify({ status: passed === tests.length ? 'PASS' : 'FAIL', passed, total: tests.length })}\n`);
}
