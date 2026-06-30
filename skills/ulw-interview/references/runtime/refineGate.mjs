#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const THRESHOLD = 0.05;
const THRESHOLD_EPSILON = 1e-12;

function readInput() {
  const raw = readFileSync(0, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    process.stderr.write('Invalid JSON\n');
    process.exit(1);
  }
}

function hasOwnKey(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function main() {
  const input = readInput();
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

main();
