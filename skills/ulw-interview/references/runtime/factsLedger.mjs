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
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const STATE_VERSION = 1;
const LOCK_STALE_MS = 5 * 60 * 1000;
const VALID_CONFIDENCE = ['user', 'explore', 'oracle', 'inferred'];
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_ID_DESCRIPTION = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}';
const LOCK_KEYS = ['pid', 'timestamp'];
const STATE_KEYS = ['entries', 'interview_id', 'last_updated', 'version'];
const CONFIRMED_ENTRY_KEYS = [
  'claim',
  'confidence',
  'created_at',
  'disputes',
  'fact_id',
  'source_round',
  'status',
  'supersedes',
];
const DISPUTED_ENTRY_KEYS = [...CONFIRMED_ENTRY_KEYS, 'reason'];
const MAX_INPUT_BYTES = 1024 * 1024;

class ControlledCliError extends Error {}

function fail(msg) {
  throw new ControlledCliError(msg);
}

async function readStdinJson() {
  const chunks = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    inputBytes += bytes.length;
    if (inputBytes > MAX_INPUT_BYTES) {
      process.stdin.destroy();
      fail(`Input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
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
  if (typeof id !== 'string' || !SAFE_ID_PATTERN.test(id)) {
    fail(`--interview-id must match ${SAFE_ID_DESCRIPTION}`);
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

function hasExactKeys(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return null;
  return timestamp;
}

function entryTimestamp(entry, priorIds, priorTimestamp) {
  const expectedKeys = entry?.status === 'disputed' ? DISPUTED_ENTRY_KEYS : CONFIRMED_ENTRY_KEYS;
  if (!hasExactKeys(entry, expectedKeys)) return null;
  if (!isSafeId(entry.fact_id) || priorIds.has(entry.fact_id)) return null;
  if (!isNonNegativeInteger(entry.source_round)) return null;
  const timestamp = isoTimestamp(entry.created_at);
  if (timestamp === null || timestamp < priorTimestamp) return null;

  if (entry.status === 'confirmed') {
    if (typeof entry.claim !== 'string' || entry.claim.length === 0) return null;
    if (!VALID_CONFIDENCE.includes(entry.confidence) || entry.disputes !== null) return null;
    if (entry.supersedes !== null && (!isSafeId(entry.supersedes) || !priorIds.has(entry.supersedes))) return null;
    return timestamp;
  }

  if (entry.status === 'disputed') {
    if (entry.claim !== '' || entry.source_round !== 0 || entry.confidence !== 'inferred') return null;
    if (!isSafeId(entry.disputes) || !priorIds.has(entry.disputes) || entry.supersedes !== null) return null;
    if (typeof entry.reason !== 'string' || entry.reason.length === 0) return null;
    return timestamp;
  }

  return null;
}

function isValidState(state, interviewId) {
  if (!hasExactKeys(state, STATE_KEYS)) return false;
  if (state.version !== STATE_VERSION || state.interview_id !== interviewId || !Array.isArray(state.entries)) return false;

  const priorIds = new Set();
  let priorTimestamp = Number.NEGATIVE_INFINITY;
  for (const entry of state.entries) {
    const timestamp = entryTimestamp(entry, priorIds, priorTimestamp);
    if (timestamp === null) return false;
    priorIds.add(entry.fact_id);
    priorTimestamp = timestamp;
  }

  if (state.entries.length === 0) return state.last_updated === null;
  return state.last_updated === state.entries.at(-1).created_at;
}

function readState(statePath, interviewId) {
  if (!existsSync(statePath)) return null;
  const raw = readFileSync(statePath, 'utf8');
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    fail(`State file corrupted at ${statePath}. Run with --reset`);
  }
  if (!isValidState(state, interviewId)) {
    fail(`State file corrupted at ${statePath}. Run with --reset`);
  }
  return state;
}

function acquireLock(lockPath) {
  if (existsSync(lockPath)) {
    let lockData = null;
    try {
      lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      // Filesystem age below decides whether an unreadable foreign lock is stale.
    }
    const validLockData =
      hasExactKeys(lockData, LOCK_KEYS) &&
      isNonNegativeInteger(lockData.pid) &&
      lockData.pid > 0 &&
      isNonNegativeInteger(lockData.timestamp);
    const observedTimestamp = validLockData ? lockData.timestamp : statSync(lockPath).mtimeMs;
    const age = Date.now() - observedTimestamp;
    const fresh = validLockData ? age < LOCK_STALE_MS : age <= LOCK_STALE_MS;
    if (fresh) {
      fail(
        `Lock held (age ${Math.round(age / 1000)}s, pid ${validLockData ? lockData.pid : 'unknown'}). Refusing to proceed.`,
      );
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
  if (typeof sourceRoundRaw !== 'string' || sourceRoundRaw.trim() === '' || !Number.isFinite(sourceRound)) {
    fail('--source-round must be numeric');
  }
  if (!isNonNegativeInteger(sourceRound)) fail('--source-round must be a non-negative integer');

  const factId = options['fact-id'];
  if (factId !== undefined) {
    if (!isSafeId(factId)) fail(`--fact-id must match ${SAFE_ID_DESCRIPTION}`);
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
  if (!isSafeId(factId)) fail(`--fact-id must match ${SAFE_ID_DESCRIPTION}`);

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
  if (typeof sourceRoundRaw !== 'string' || sourceRoundRaw.trim() === '' || !Number.isFinite(sourceRound)) {
    fail('--source-round must be numeric');
  }
  if (!isNonNegativeInteger(sourceRound)) fail('--source-round must be a non-negative integer');
  if (!isSafeId(factId)) fail(`--fact-id must match ${SAFE_ID_DESCRIPTION}`);

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

async function main() {
  const { command, options } = parseArgs(process.argv);
  if (!command) fail('Command required');

  const stdinPayload = await readStdinJson();
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
    const state = readState(statePath, interviewId) || emptyState(interviewId);
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

try {
  await main();
} catch (error) {
  if (error instanceof ControlledCliError) {
    process.stderr.write(`factsLedger.mjs: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
