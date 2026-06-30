#!/usr/bin/env node
// ULW Interview facts ledger: event-log of established facts, disputes, and supersedes.
// Per-interview state file. Vanilla Node ESM, stdlib only.
//
// Usage:
//   node factsLedger.mjs <command> [--interview-id ID] [options]
//
// Commands:
//   append    --claim T --source-round N --confidence C [--fact-id ID]
//   dispute   --fact-id X --reason R
//   supersede --fact-id X --claim T --source-round N
//   list      [--status S]
//   queryDisputed

import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const STATE_VERSION = 1;
const LOCK_STALE_MS = 5 * 60 * 1000;
const VALID_CONFIDENCE = ['user', 'explore', 'oracle', 'inferred'];

function fail(msg) {
  process.stderr.write(`factsLedger.mjs: ${msg}\n`);
  process.exit(1);
}

function readStdinJson() {
  const raw = readFileSync(0, 'utf8');
  if (raw === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    fail('Invalid JSON on stdin');
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const options = {};
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--reset') {
      options.reset = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[key] = next;
        i += 1;
      } else {
        options[key] = true;
      }
    }
  }
  return { command, options };
}

function getInterviewId(options, stdinPayload) {
  const id =
    options['interview-id'] ||
    process.env.ULW_FACTS_LEDGER_ID ||
    stdinPayload.interview_id;
  if (!id) {
    fail('--interview-id required (or set env ULW_FACTS_LEDGER_ID)');
  }
  return id;
}

function statePathFor(interviewId) {
  return join(
    process.cwd(),
    '.omo',
    'state',
    `ulw-interview-facts-${interviewId}.json`,
  );
}

function lockPathFor(statePath) {
  return `${statePath}.lock`;
}

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function emptyState(interviewId) {
  return {
    interview_id: interviewId,
    version: STATE_VERSION,
    entries: [],
    last_updated: null,
  };
}

function readState(statePath) {
  if (!existsSync(statePath)) return null;
  const raw = readFileSync(statePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    fail(`State file corrupted at ${statePath}. Run with --reset`);
  }
}

function acquireLock(lockPath) {
  if (existsSync(lockPath)) {
    let lockData = null;
    try {
      lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      // unreadable — treat as stale.
    }
    if (lockData && typeof lockData.timestamp === 'number') {
      const age = Date.now() - lockData.timestamp;
      if (age < LOCK_STALE_MS) {
        fail(
          `Lock held (age ${Math.round(age / 1000)}s, pid ${lockData.pid || 'unknown'}). Refusing to proceed.`,
        );
      }
    }
    unlinkSync(lockPath);
  }
  ensureDir(lockPath);
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
}

function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // already gone
  }
}

function writeStateAtomic(statePath, state) {
  ensureDir(statePath);
  const tmpPath = `${statePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`;
  const fd = openSync(tmpPath, 'w');
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, statePath);
}

function generateFactId(seed) {
  const hash = createHash('sha1');
  hash.update(String(seed));
  hash.update(String(Date.now()));
  hash.update(randomBytes(8));
  return hash.digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function appendFact(state, options) {
  const claim = options.claim;
  const sourceRoundRaw = options['source-round'];
  const confidence = options.confidence;
  if (!claim) fail('--claim required for append');
  if (sourceRoundRaw === undefined) fail('--source-round required for append');
  if (!confidence) fail('--confidence required for append');
  if (!VALID_CONFIDENCE.includes(confidence)) {
    fail(`--confidence must be one of ${VALID_CONFIDENCE.join('|')}`);
  }
  const sourceRound = Number(sourceRoundRaw);
  if (!Number.isFinite(sourceRound)) fail('--source-round must be numeric');

  const factId = options['fact-id'];
  if (factId) {
    const exists = state.entries.some((e) => e.fact_id === factId);
    if (exists) return { appended: false };
  }

  const entry = {
    fact_id: factId || generateFactId(claim),
    claim,
    source_round: sourceRound,
    confidence,
    status: 'confirmed',
    created_at: nowIso(),
    disputes: null,
    supersedes: null,
  };
  state.entries.push(entry);
  state.last_updated = entry.created_at;
  return { appended: true, entry };
}

function disputeFact(state, options) {
  const factId = options['fact-id'];
  const reason = options.reason;
  if (!factId) fail('--fact-id required for dispute');
  if (!reason) fail('--reason required for dispute');

  const original = state.entries.find((e) => e.fact_id === factId);
  if (!original) fail(`Cannot dispute non-existent fact ${factId}`);

  const entry = {
    fact_id: generateFactId(`dispute:${factId}:${reason}`),
    claim: '',
    source_round: 0,
    confidence: 'inferred',
    status: 'disputed',
    created_at: nowIso(),
    disputes: factId,
    reason,
    supersedes: null,
  };
  state.entries.push(entry);
  state.last_updated = entry.created_at;
  return { entry };
}

function supersedeFact(state, options) {
  const factId = options['fact-id'];
  const claim = options.claim;
  const sourceRoundRaw = options['source-round'];
  if (!factId) fail('--fact-id required for supersede');
  if (!claim) fail('--claim required for supersede');
  if (sourceRoundRaw === undefined) fail('--source-round required for supersede');
  const sourceRound = Number(sourceRoundRaw);
  if (!Number.isFinite(sourceRound)) fail('--source-round must be numeric');

  const original = state.entries.find((e) => e.fact_id === factId);
  if (!original) fail(`Cannot supersede non-existent fact ${factId}`);

  const entry = {
    fact_id: generateFactId(`supersede:${factId}:${claim}`),
    claim,
    source_round: sourceRound,
    confidence: 'inferred',
    status: 'confirmed',
    created_at: nowIso(),
    disputes: null,
    supersedes: factId,
  };
  state.entries.push(entry);
  state.last_updated = entry.created_at;
  return { entry };
}

function listEntries(state, options) {
  const status = options.status;
  let entries = state.entries;
  if (status) {
    entries = entries.filter((e) => e.status === status);
  }
  return { entries };
}

function queryDisputed(state) {
  const supersededIds = new Set();
  for (const e of state.entries) {
    if (typeof e.supersedes === 'string') supersededIds.add(e.supersedes);
  }
  const disputeEntries = state.entries.filter((e) => typeof e.disputes === 'string');
  const disputes = disputeEntries
    .filter((d) => !supersededIds.has(d.disputes))
    .map((d) => {
      const original = state.entries.find((e) => e.fact_id === d.disputes);
      return {
        disputeEntry: d,
        originalFact: original,
        superseded: false,
      };
    });
  return { disputes };
}

function main() {
  const { command, options } = parseArgs(process.argv);
  if (!command) fail('Command required');

  const stdinPayload = readStdinJson();
  const interviewId = getInterviewId(options, stdinPayload);
  const statePath = statePathFor(interviewId);
  const lockPath = lockPathFor(statePath);

  if (options.reset) {
    if (existsSync(statePath)) {
      copyFileSync(statePath, `${statePath}.bak`);
    }
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
    writeStateAtomic(statePath, emptyState(interviewId));
    process.stdout.write(JSON.stringify({ ok: true, reset: true }) + '\n');
    return;
  }

  acquireLock(lockPath);
  try {
    const state = readState(statePath) || emptyState(interviewId);
    if (!Array.isArray(state.entries)) {
      fail(`State file corrupted at ${statePath}. Run with --reset`);
    }
    let output;
    switch (command) {
      case 'append':
        appendFact(state, options);
        output = { ok: true };
        break;
      case 'dispute':
        disputeFact(state, options);
        output = { ok: true };
        break;
      case 'supersede':
        supersedeFact(state, options);
        output = { ok: true };
        break;
      case 'list':
        output = listEntries(state, options);
        break;
      case 'queryDisputed':
        output = queryDisputed(state);
        break;
      default:
        fail(`Unknown command: ${command}`);
    }
    writeStateAtomic(statePath, state);
    process.stdout.write(JSON.stringify(output) + '\n');
  } finally {
    releaseLock(lockPath);
  }
}

main();
