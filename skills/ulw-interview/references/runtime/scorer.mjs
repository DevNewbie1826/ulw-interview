#!/usr/bin/env node
// ULW Interview deterministic scoring engine.
// Reads JSON state from stdin, writes computed scoring state to stdout.
// Vanilla Node ESM, stdlib only. No network, no fs writes.
//
// Contract: SKILL.md MUST pipe oracle output through validate.mjs, then through
// this script. The LLM never computes ambiguity by hand.

import { readFileSync } from 'node:fs';

const TRIGGER_DELTA = -0.15;        // per fired trigger, applied to targeted dim
const PANEL_COOLDOWN = 2;            // rounds between panel dispatches
const EPS = 1e-9;                    // float-comparison epsilon for band edges
const STALL_WINDOW = 0.05;           // windowed max-min over last 3 rounds
const REFINED_CEILING = 0.30;        // upper edge of "refined" band
const INITIAL_FLOOR = 0.60;          // lower edge of "initial" band (exclusive)
const THRESHOLD_MIN = 1e-6;          // exclusive lower bound for threshold
const THRESHOLD_MAX = 0.30;          // inclusive upper bound for threshold

// ---------- input schema ----------

/**
 * @typedef {Object} Trigger
 * @property {string} component  - component name this trigger fires on
 * @property {"goal"|"constraints"|"criteria"|"context"} dim
 * @property {"A"|"B"|"C"|"D"} type
 */

/**
 * @typedef {Object} Component
 * @property {string} name
 * @property {{goal: number, constraints: number, criteria: number, context?: number}} scores
 */

/**
 * @typedef {Object} ScorerInput
 * @property {number} threshold
 * @property {"greenfield"|"brownfield"} type
 * @property {Component[]} components
 * @property {number|null} [priorAmbiguity]
 * @property {string|null} [priorBand]
 * @property {number[]} [priorRounds]       // last N global ambiguity values, oldest-first
 * @property {number|null} [priorPanelRound]// round number of last panel dispatch
 * @property {number} [currentRound]        // 1-based Phase 2 round number
 * @property {Trigger[]} [triggers]
 * @property {boolean} [degraded]           // true if validation fallback was used
 */

function readInput() {
  const raw = readFileSync(0, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`Invalid JSON on stdin: ${e.message}. Re-dispatch with strict JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    fail('Input must be a JSON object.');
  }
  return parsed;
}

function fail(msg) {
  process.stderr.write(`scorer.mjs: ${msg}\n`);
  process.exit(1);
}

// ---------- validation + clamping ----------

function clampThreshold(t) {
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { value: 0.05, clamped: true };
  }
  if (t <= THRESHOLD_MIN) return { value: THRESHOLD_MIN, clamped: true };
  if (t > THRESHOLD_MAX) return { value: THRESHOLD_MAX, clamped: true };
  return { value: t, clamped: false };
}

function clampScore(s) {
  if (typeof s !== 'number' || !Number.isFinite(s)) return { value: 0.0, clamped: true };
  if (s < 0) return { value: 0.0, clamped: true };
  if (s > 1) return { value: 1.0, clamped: true };
  return { value: s, clamped: false };
}

function validateInput(input) {
  const errors = [];
  if (!Array.isArray(input.components) || input.components.length === 0) {
    errors.push('components must be a non-empty array');
  }
  if (input.type !== 'greenfield' && input.type !== 'brownfield') {
    errors.push('type must be "greenfield" or "brownfield"');
  }
  const validDims = ['goal', 'constraints', 'criteria', 'context'];
  for (const c of input.components || []) {
    if (!c || typeof c.name !== 'string') errors.push(`component.name missing: ${JSON.stringify(c)}`);
    if (!c || typeof c.scores !== 'object') {
      errors.push(`component "${c?.name}" missing scores object`);
      continue;
    }
    for (const dim of validDims) {
      if (dim in c.scores && typeof c.scores[dim] !== 'number') {
        errors.push(`component "${c?.name}" scores.${dim} must be number`);
      }
    }
    const requiredByType = input.type === 'brownfield'
      ? ['goal', 'constraints', 'criteria', 'context']
      : ['goal', 'constraints', 'criteria'];
    for (const rdim of requiredByType) {
      if (!(rdim in c.scores)) {
        errors.push(`${input.type} component "${c?.name}" must have scores.${rdim}`);
      }
    }
  }

  // Validate triggers reference real components and valid dims.
  const knownComponents = new Set((input.components || []).map((c) => c?.name).filter((n) => typeof n === 'string'));
  const validTriggerDims = new Set(['goal', 'constraints', 'criteria', 'context']);
  const validTriggerTypes = new Set(['A', 'B', 'C', 'D']);
  for (const t of input.triggers || []) {
    if (!t || typeof t !== 'object') {
      errors.push(`trigger must be an object: ${JSON.stringify(t)}`);
      continue;
    }
    if (!knownComponents.has(t.component)) {
      errors.push(`trigger.component "${t.component}" does not match any active component (known: ${[...knownComponents].join(', ')})`);
    }
    if (!validTriggerDims.has(t.dim)) {
      errors.push(`trigger.dim must be one of goal|constraints|criteria|context, got: ${JSON.stringify(t.dim)}`);
    }
    if (!validTriggerTypes.has(t.type)) {
      errors.push(`trigger.type must be one of A|B|C|D, got: ${JSON.stringify(t.type)}`);
    }
  }

  if (errors.length) fail(`Schema violations:\n  - ${errors.join('\n  - ')}`);
}

// ---------- core math ----------

function applyTriggers(components, triggers) {
  const triggered = new Map(); // component|dim -> count
  for (const t of triggers || []) {
    const key = `${t.component}|${t.dim}`;
    triggered.set(key, (triggered.get(key) || 0) + 1);
  }
  return components.map((c) => {
    const newScores = { ...c.scores };
    const dims = ['goal', 'constraints', 'criteria', 'context'];
    const firedDims = [];
    let anyClamped = false;
    for (const dim of dims) {
      if (!(dim in newScores)) continue;
      const key = `${c.name}|${dim}`;
      const count = triggered.get(key) || 0;
      if (count > 0) {
        const before = newScores[dim];
        const after = Math.max(0, before + TRIGGER_DELTA * count);
        if (after < 0) anyClamped = true;
        newScores[dim] = after;
        firedDims.push({ dim, count, delta: TRIGGER_DELTA * count });
      }
    }
    return { ...c, scores: newScores, firedDims, anyClamped };
  });
}

function computePerComponentAmbiguity(components, type) {
  // returns per-component { name, ambiguity, scores, firedDims }
  const weights = type === 'greenfield'
    ? { goal: 0.40, constraints: 0.30, criteria: 0.30, context: 0 }
    : { goal: 0.35, constraints: 0.25, criteria: 0.25, context: 0.15 };

  return components.map((c) => {
    const s = c.scores;
    const clarity = (s.goal ?? 0) * weights.goal
      + (s.constraints ?? 0) * weights.constraints
      + (s.criteria ?? 0) * weights.criteria
      + (s.context ?? 0) * weights.context;
    let ambiguity = 1 - clarity;
    let negativeClamped = false;
    if (ambiguity < 0) {
      ambiguity = 0;
      negativeClamped = true;
    }
    if (ambiguity > 1) ambiguity = 1;
    return {
      name: c.name,
      ambiguity: round(ambiguity, 9),
      scores: s,
      firedDims: c.firedDims || [],
      negativeClamped,
    };
  });
}

function classifyBand(a, threshold) {
  // initial: a > 0.60
  // progress: 0.60 >= a > 0.30
  // refined: 0.30 >= a > threshold  (empty if threshold >= 0.30)
  // ready: a <= threshold
  if (a > INITIAL_FLOOR + EPS) return 'initial';
  if (a > REFINED_CEILING + EPS) return 'progress';
  if (a > threshold + EPS) return 'refined';
  return 'ready';
}

function detectStall(priorRounds, currentAmbiguity) {
  // Caller passes priorRounds as all previous globalAmbiguity values (oldest-first).
  // We append the current round's ambiguity so the window includes the most recent state.
  const series = [...(priorRounds || []), currentAmbiguity];
  if (series.length < 3) return false;
  const window = series.slice(-3);
  const max = Math.max(...window);
  const min = Math.min(...window);
  return (max - min) <= STALL_WINDOW + EPS;
}

// Oscillation suppression: if the same band-edge has been crossed 2+ times in the
// last 4 transitions, panel dispatch is suppressed to break the loop.
function shouldSuppressPanel(priorBandHistory, currentBand) {
  const history = [...(priorBandHistory || []), currentBand];
  if (history.length < 5) return false; // need at least 4 transitions
  const transitions = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i] !== history[i - 1]) {
      // edge identity = sorted pair so ready|refined == refined|ready
      const edge = [history[i - 1], history[i]].sort().join('|');
      transitions.push(edge);
    }
  }
  const last4 = transitions.slice(-4);
  const counts = {};
  for (const e of last4) counts[e] = (counts[e] || 0) + 1;
  return Object.values(counts).some((c) => c >= 2);
}

// Coverage gaps: lists active components with any required dim < 0.9.
// The closure guard uses this to make 'material gap' mechanical.
function computeCoverageGaps(components, type) {
  const requiredDims = type === 'brownfield'
    ? ['goal', 'constraints', 'criteria', 'context']
    : ['goal', 'constraints', 'criteria'];
  const gaps = [];
  for (const c of components) {
    for (const dim of requiredDims) {
      const s = c.scores[dim];
      if (typeof s !== 'number') {
        gaps.push(`${c.name}/${dim}: missing`);
      } else if (s < 0.9 - EPS) {
        gaps.push(`${c.name}/${dim}: ${s.toFixed(3)} < 0.9`);
      }
    }
  }
  return gaps;
}

function allDimsAtLeast(components, floor, type) {
  const requiredDims = type === 'brownfield'
    ? ['goal', 'constraints', 'criteria', 'context']
    : ['goal', 'constraints', 'criteria'];
  for (const c of components) {
    for (const dim of requiredDims) {
      const s = c.scores[dim];
      if (typeof s !== 'number' || s < floor - EPS) return false;
    }
  }
  return true;
}

function round(n, digits) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// ---------- main ----------

function main() {
  /** @type {ScorerInput} */
  const input = readInput();
  validateInput(input);

  const t = clampThreshold(input.threshold);
  const threshold = t.value;

  // 1. clamp scores (rarely needed post-validation, but defense-in-depth)
  let localScoreClamped = false;
  const clampedComponents = (input.components).map((c) => {
    const newScores = {};
    for (const dim of ['goal', 'constraints', 'criteria', 'context']) {
      if (dim in c.scores) {
        const r = clampScore(c.scores[dim]);
        if (r.clamped) localScoreClamped = true;
        newScores[dim] = r.value;
      }
    }
    return { ...c, scores: newScores };
  });

  // Combine local clamp detection with validation-side clamp signal.
  const scoreClamped = localScoreClamped || input.validationScoreClamped === true;

  // 2. apply triggers
  const triggeredComponents = applyTriggers(clampedComponents, input.triggers || []);

  // 3. per-component ambiguity
  const perComponent = computePerComponentAmbiguity(triggeredComponents, input.type);

  // 4. global = MAX of per-component (worst component gates readiness)
  const globalAmbiguity = round(
    Math.max(...perComponent.map((c) => c.ambiguity)),
    9
  );

  // 5. band classification
  const band = classifyBand(globalAmbiguity, threshold);
  const bandChanged = input.priorBand ? input.priorBand !== band : true;

  // 6. stall — INCLUDES current globalAmbiguity in the window
  const stallDetected = detectStall(input.priorRounds || [], globalAmbiguity);

  // 7. ready: global ≤ threshold AND every per-component ≤ threshold
  const allComponentsReady = perComponent.every((c) => c.ambiguity <= threshold + EPS);
  const ready = allComponentsReady && globalAmbiguity <= threshold + EPS;

  // 8. skipToSpec: all required dims of all components ≥ 0.9 AND threshold met
  const allDimsHigh = allDimsAtLeast(triggeredComponents, 0.9, input.type);
  const skipToSpec = allDimsHigh && ready;

  // 9. panel eligibility (cooldown)
  const currentRound = typeof input.currentRound === 'number' ? input.currentRound : 0;
  const priorPanelRound = typeof input.priorPanelRound === 'number' ? input.priorPanelRound : -PANEL_COOLDOWN - 1;
  const nextPanelEligible = currentRound - priorPanelRound > PANEL_COOLDOWN;

  // 10. aggregate flags
  const negativeAmbiguityClamped = perComponent.some((c) => c.negativeClamped);

  // 11. oscillation suppression
  const suppressPanelForOscillation = shouldSuppressPanel(
    input.priorBandHistory || [], band
  );

  // 12. coverage gaps (for closure guard's material-gap judgment)
  const coverageGaps = computeCoverageGaps(triggeredComponents, input.type);

  // 13. dialectic rhythm guard (streak counter)
  const priorStreak = typeof input.streakCounter === 'number' ? input.streakCounter : 0;
  const resolvedWithoutUser = input.lastRoundResolvedWithoutUser === true;
  const streakCounter = resolvedWithoutUser ? priorStreak + 1 : 0;
  const forceUserQuestion = streakCounter >= 3;

  // 14. canonical next target (deterministic — removes LLM tie-break divergence)
  // Rule: pick the component with the HIGHEST ambiguity (worst); within that component,
  // pick the required dim with the LOWEST score. Tie-break: alphabetical.
  const requiredDimsForTarget = input.type === 'brownfield'
    ? ['context', 'criteria', 'constraints', 'goal'] // alphabetical for stable tie-break
    : ['criteria', 'constraints', 'goal'];
  const worstComponent = [...perComponent].sort((a, b) => {
    if (b.ambiguity !== a.ambiguity) return b.ambiguity - a.ambiguity;
    return a.name < b.name ? -1 : 1; // alphabetical tie-break
  })[0];
  let nextDimension = null;
  if (worstComponent) {
    const candidateDims = requiredDimsForTarget
      .filter((d) => typeof worstComponent.scores[d] === 'number')
      .sort((a, b) => {
        const sa = worstComponent.scores[a];
        const sb = worstComponent.scores[b];
        if (sa !== sb) return sa - sb;
        return a < b ? -1 : 1;
      });
    nextDimension = candidateDims[0] || null;
  }
  const nextTarget = worstComponent ? { component: worstComponent.name, dimension: nextDimension } : null;
  const output = {
    threshold,
    thresholdClamped: t.clamped,
    type: input.type,
    perComponent,
    globalAmbiguity,
    band,
    bandChanged,
    stallDetected,
    ready,
    skipToSpec,
    nextPanelEligible,
    suppressPanelForOscillation,
    dispatchPanel: nextPanelEligible && !suppressPanelForOscillation && bandChanged,
    panelCooldown: PANEL_COOLDOWN,
    scoreClamped,
    validationScoreClamped: input.validationScoreClamped === true,
    negativeAmbiguityClamped,
    coverageGaps,
    streakCounter,
    forceUserQuestion,
    nextTarget,
    degraded: input.degraded === true,
    currentRound,
    triggerDelta: TRIGGER_DELTA,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main();
