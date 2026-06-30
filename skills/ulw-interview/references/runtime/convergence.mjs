#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function failInvalidJson() {
  process.stderr.write('Invalid JSON\n');
  process.exit(1);
}

function readInput() {
  const raw = readFileSync(0, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    failInvalidJson();
  }
}

function normalizeSlot(slot) {
  return {
    name: slot.name,
    type: slot.type,
    fields: [...slot.fields].sort(),
  };
}

function compareSlots(left, right) {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  if (left.type !== right.type) return left.type < right.type ? -1 : 1;
  const leftFields = left.fields.join('\u0000');
  const rightFields = right.fields.join('\u0000');
  if (leftFields !== rightFields) return leftFields < rightFields ? -1 : 1;
  return 0;
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function round9(value) {
  return Math.round(value * 1e9) / 1e9;
}

function matchStable(current, prior) {
  const priorByKey = new Map();
  prior.forEach((slot, index) => {
    const key = `${slot.name}\u0000${slot.type}`;
    const queue = priorByKey.get(key);
    if (queue) {
      queue.push(index);
    } else {
      priorByKey.set(key, [index]);
    }
  });

  const stableCurrent = new Set();
  const stablePrior = new Set();

  current.forEach((slot, index) => {
    const queue = priorByKey.get(`${slot.name}\u0000${slot.type}`);
    if (!queue || queue.length === 0) return;
    stableCurrent.add(index);
    stablePrior.add(queue.shift());
  });

  return { stableCurrent, stablePrior };
}

function matchChanged(current, prior, stableCurrent, stablePrior) {
  const candidates = [];

  current.forEach((currentSlot, currentIndex) => {
    if (stableCurrent.has(currentIndex)) return;
    prior.forEach((priorSlot, priorIndex) => {
      if (stablePrior.has(priorIndex)) return;
      if (currentSlot.type !== priorSlot.type) return;
      if (currentSlot.name === priorSlot.name) return;
      if (currentSlot.fields.length !== priorSlot.fields.length) return;
      const score = jaccard(currentSlot.fields, priorSlot.fields);
      if (score >= 0.5) {
        candidates.push({ currentIndex, priorIndex, score, currentName: currentSlot.name, priorName: priorSlot.name });
      }
    });
  });

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.currentName !== right.currentName) return left.currentName < right.currentName ? -1 : 1;
    if (left.priorName !== right.priorName) return left.priorName < right.priorName ? -1 : 1;
    if (left.currentIndex !== right.currentIndex) return left.currentIndex - right.currentIndex;
    return left.priorIndex - right.priorIndex;
  });

  const changedCurrent = new Set();
  const changedPrior = new Set();

  for (const candidate of candidates) {
    if (changedCurrent.has(candidate.currentIndex) || changedPrior.has(candidate.priorIndex)) continue;
    changedCurrent.add(candidate.currentIndex);
    changedPrior.add(candidate.priorIndex);
  }

  return { changedCurrent, changedPrior };
}

function main() {
  const input = readInput();
  const slotSet = Array.isArray(input.slotSet) ? input.slotSet : [];
  const priorSnapshots = Array.isArray(input.priorSnapshots) ? input.priorSnapshots : [];
  const current = slotSet.map(normalizeSlot).sort(compareSlots);
  const prior = priorSnapshots.length > 0
    ? priorSnapshots[priorSnapshots.length - 1].map(normalizeSlot).sort(compareSlots)
    : [];

  const hash = createHash('sha256').update(JSON.stringify(current)).digest('hex').slice(0, 16);

  const { stableCurrent, stablePrior } = matchStable(current, prior);
  const { changedCurrent, changedPrior } = matchChanged(current, prior, stableCurrent, stablePrior);

  const stable = stableCurrent.size;
  const changed = changedCurrent.size;
  const total = current.length;
  const newCount = total - stable - changed;
  const removed = prior.length - stable - changed;

  const stability_ratio = total === 0
    ? 0
    : priorSnapshots.length < 2
      ? null
      : round9((stable + changed) / total);

  const converged =
    stability_ratio !== null &&
    stability_ratio >= 0.95 &&
    priorSnapshots.length >= 2 &&
    prior.length > 0;

  const output = {
    stability_ratio,
    converged,
    stable,
    changed,
    new: newCount,
    removed,
    total,
  };

  if (total > 0) {
    output.hash = hash;
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main();
