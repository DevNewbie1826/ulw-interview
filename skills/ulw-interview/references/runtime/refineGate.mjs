#!/usr/bin/env node

const THRESHOLD = 0.05;
const THRESHOLD_EPSILON = 1e-12;
const MAX_INPUT_BYTES = 1024 * 1024;

class RefineFailure extends Error {}

function fail(message) {
  throw new RefineFailure(message);
}

async function readInput() {
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
  try {
    return JSON.parse(raw);
  } catch {
    fail('Invalid JSON');
  }
}

function hasOwnKey(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

async function main() {
  const input = await readInput();
  const priorScores = input?.priorScores;
  const currentScores = input?.currentScores;
  const validationScoreClamped = input?.validationScoreClamped === true;
  const targetedDim = input?.targetedDim;

  if (priorScores == null || currentScores == null) {
    process.stdout.write(JSON.stringify({ shouldRefine: false, reason: 'cold_start', target: null }));
    return;
  }

  if (typeof targetedDim !== 'string' || !hasOwnKey(priorScores, targetedDim) || !hasOwnKey(currentScores, targetedDim)) {
    process.stdout.write(JSON.stringify({ shouldRefine: false, reason: 'missing_dim', target: null }));
    return;
  }

  const delta = currentScores[targetedDim] - priorScores[targetedDim];

  if (delta >= THRESHOLD - THRESHOLD_EPSILON) {
    process.stdout.write(JSON.stringify({ shouldRefine: false, reason: 'delta_at_or_above_threshold', target: null }));
    return;
  }

  if (!validationScoreClamped) {
    process.stdout.write(JSON.stringify({ shouldRefine: false, reason: 'not_clamped', target: null }));
    return;
  }

  process.stdout.write(JSON.stringify({ shouldRefine: true, reason: 'low_delta_and_clamped', target: targetedDim }));
}

try {
  await main();
} catch (error) {
  if (error instanceof RefineFailure) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
