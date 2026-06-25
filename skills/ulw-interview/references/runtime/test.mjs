#!/usr/bin/env node
// Inline tests for scorer.mjs and validate.mjs. No framework, stdlib only.
// Run: node references/runtime/test.mjs

import { execFileSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORER = join(__dirname, 'scorer.mjs');
const VALIDATE = join(__dirname, 'validate.mjs');

function runScript(scriptPath, stdin) {
  const r = spawnSync('node', [scriptPath], { input: stdin, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
  }
}

// ---------- validate.mjs ----------

console.log('\n[validate.mjs]');

test('valid greenfield JSON → ok:true', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'criteria',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.type, 'greenfield');
  assert.equal(out.normalized.scores.goal, 0.8);
  assert.equal(out.normalized.scores.criteria, 0.6);
  assert.deepEqual(out.normalized.scores.context, undefined);
});

test('valid brownfield JSON → ok:true with context', () => {
  const input = JSON.stringify({
    type: 'brownfield',
    scores: { goal: 0.9, constraints: 0.9, criteria: 0.8, context: 0.7 },
    weakest_dimension: 'context',
    triggers: [{ dim: 'context', type: 'C' }],
  });
  const r = runScript(VALIDATE, input);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.scores.context, 0.7);
  assert.deepEqual(out.normalized.triggers, [{ dim: 'context', type: 'C' }]);
});

test('missing required dim → ok:false with retryHint', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 0.8 }, // missing constraints, criteria
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.length >= 2);
  assert.ok(out.retryHint.includes('STRICT JSON'));
});

test('garbage text → ok:false', () => {
  const r = runScript(VALIDATE, 'not json at all');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /not valid JSON/);
});

test('invalid trigger type → ok:false', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'goal',
    triggers: [{ dim: 'goal', type: 'Z' }],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('type must be one of')));
});

test('score out of [0,1] → ok:true with clamped value + clampedFields flag', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 1.2, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.scores.goal, 1.0); // clamped
  assert.equal(out.scoreClamped, true);
  assert.deepEqual(out.clampedFields, ['goal']);
});

test('expected-type CLI override — brownfield required even if oracle omits type', () => {
  const input = JSON.stringify({
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6 }, // no context, no type
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = spawnSync('node', [VALIDATE, '--expected-type=brownfield'], { input, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false, 'brownfield must require context even when oracle omits type');
  assert.ok(out.errors.some((e) => e.includes('context')));
});

test('expected-type CLI override — brownfield passes when context provided', () => {
  const input = JSON.stringify({
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6, context: 0.5 },
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = spawnSync('node', [VALIDATE, '--expected-type=brownfield'], { input, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.type, 'brownfield');
});

test('no type, no CLI override → ok:false (do not silently default)', () => {
  const input = JSON.stringify({
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('type')));
});
// ---------- scorer.mjs ----------

console.log('\n[scorer.mjs]');

const GREENFIELD_READY = {
  threshold: 0.05,
  type: 'greenfield',
  components: [
    { name: 'API', scores: { goal: 0.95, constraints: 0.95, criteria: 0.95 } },
  ],
};

const GREENFIELD_NOT_READY = {
  threshold: 0.05,
  type: 'greenfield',
  components: [
    { name: 'API', scores: { goal: 0.5, constraints: 0.5, criteria: 0.5 } },
  ],
};

test('greenfield all-0.95 → ready:true', () => {
  const r = runScript(SCORER, JSON.stringify(GREENFIELD_READY));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ready, true);
  assert.equal(out.band, 'ready');
  assert.ok(out.globalAmbiguity <= 0.05 + 1e-9);
});

test('validate rejects non-numeric score with ok:false', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: '85%', constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('must be a finite number')));
});

test('validate rejects null score with ok:false', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: null, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('must be a finite number')));
});

test('greenfield low scores → ready:false', () => {
  const r = runScript(SCORER, JSON.stringify(GREENFIELD_NOT_READY));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ready, false);
  assert.notEqual(out.band, 'ready');
});

test('C2 multi-component masking — one perfect + one zero → ready:false', () => {
  // The core C2 fix: global = MAX of per-component (worst gates readiness)
  const input = {
    threshold: 0.05,
    type: 'greenfield',
    components: [
      { name: 'A', scores: { goal: 1.0, constraints: 1.0, criteria: 1.0 } },
      { name: 'B', scores: { goal: 0.0, constraints: 0.0, criteria: 0.0 } },
    ],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ready, false, 'must NOT be ready when one component is at zero');
  assert.equal(out.globalAmbiguity, 1.0, 'global ambiguity is the worst component');
});

test('C8 threshold > 0.30 → clamped to 0.30 + flag', () => {
  const input = { ...GREENFIELD_READY, threshold: 1.5 };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.threshold, 0.30);
  assert.equal(out.thresholdClamped, true);
});

test('C8 threshold ≤ 0 → clamped to tiny positive + flag', () => {
  const input = { ...GREENFIELD_READY, threshold: -0.1 };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.ok(out.threshold > 0);
  assert.equal(out.thresholdClamped, true);
});

test('C3 negative ambiguity clamped — score > 1.0 in input', () => {
  // After validate.mjs clamps to 1.0, scorer sees 1.0; but if LLM bypasses validate,
  // scorer still clamps and flags.
  const input = {
    threshold: 0.05,
    type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 1.2, constraints: 1.0, criteria: 1.0 } }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.scoreClamped, true);
  assert.equal(out.perComponent[0].scores.goal, 1.0);
  assert.equal(out.negativeAmbiguityClamped, false); // after clamp, ambiguity = 0
});

test('C5 0.9 skip rule — only fires when threshold also met', () => {
  // All dims 0.9, threshold 0.05: ambiguity = 1-(0.9*1.0) = 0.10 > 0.05 → ready:false → skipToSpec:false
  const input = {
    threshold: 0.05,
    type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.9, constraints: 0.9, criteria: 0.9 } }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ready, false, 'threshold 0.05 not met with 0.9 dims');
  assert.equal(out.skipToSpec, false);
});

test('C5 0.9 skip rule — fires when threshold met AND all dims ≥ 0.9', () => {
  // threshold 0.15: 0.9 dims → ambiguity 0.10 ≤ 0.15 → ready:true → skipToSpec:true
  const input = {
    threshold: 0.15,
    type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.92, constraints: 0.92, criteria: 0.92 } }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ready, true);
  assert.equal(out.skipToSpec, true);
});

test('M7 trigger delta — single trigger lowers dim by 0.15', () => {
  const input = {
    threshold: 0.05,
    type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.8, constraints: 0.7, criteria: 0.7 } }],
    triggers: [{ component: 'A', dim: 'goal', type: 'C' }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.perComponent[0].scores.goal, 0.65); // 0.8 - 0.15
  assert.equal(out.perComponent[0].firedDims.length, 1);
});

test('M7 trigger floors at 0.0 (no negative scores)', () => {
  const input = {
    threshold: 0.05,
    type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.1, constraints: 0.7, criteria: 0.7 } }],
    triggers: [{ component: 'A', dim: 'goal', type: 'A' }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.perComponent[0].scores.goal, 0.0); // not -0.05
});

test('band classification at boundaries (epsilon-safe)', () => {
  // exactly 0.60 → progress (initial is > 0.60)
  const r60 = runScript(SCORER, JSON.stringify({
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.6, constraints: 0.4, criteria: 0.4 } }],
  }));
  const o60 = JSON.parse(r60.stdout);
  // 0.6*0.4 + 0.4*0.3 + 0.4*0.3 = 0.24+0.12+0.12 = 0.48; ambiguity = 0.52 → progress
  assert.equal(o60.band, 'progress');
});

test('stall detection — last 3 including current within 0.05 → stallDetected:true', () => {
  // Input scores 0.6,0.5,0.5 → ambiguity = 1-(0.24+0.15+0.15) = 0.46
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.6, constraints: 0.5, criteria: 0.5 } }],
    priorRounds: [0.46, 0.48, 0.47],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.stallDetected, true);
});

test('stall detection — divergent rounds → stallDetected:false', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.6, constraints: 0.5, criteria: 0.5 } }],
    priorRounds: [0.20, 0.50, 0.80],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.stallDetected, false);
});

test('oscillation suppression — same edge twice in 4 transitions → suppressPanelForOscillation:true', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.95, constraints: 0.95, criteria: 0.95 } }],
    priorBandHistory: ['ready', 'refined', 'ready', 'refined'],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.band, 'ready');
  assert.equal(out.suppressPanelForOscillation, true);
  assert.equal(out.dispatchPanel, false);
});

test('oscillation suppression — monotone progress → suppressPanelForOscillation:false', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.95, constraints: 0.95, criteria: 0.95 } }],
    priorBandHistory: ['initial', 'progress', 'refined'],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.suppressPanelForOscillation, false);
});

test('coverageGaps — components with dims < 0.9 are listed', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [
      { name: 'A', scores: { goal: 0.95, constraints: 0.85, criteria: 0.95 } },
      { name: 'B', scores: { goal: 0.5, constraints: 0.5, criteria: 0.5 } }
    ],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.ok(out.coverageGaps.length >= 4, `expected >=4 gaps, got ${out.coverageGaps.length}`);
  assert.ok(out.coverageGaps.some((g) => g.includes('A/constraints')), 'should list A/constraints');
});

test('coverageGaps — all dims ≥ 0.9 → empty array', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.95, constraints: 0.95, criteria: 0.95 } }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.coverageGaps, []);
});

test('panel cooldown — nextPanelEligible false within 2 rounds', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.6, constraints: 0.5, criteria: 0.5 } }],
    currentRound: 5,
    priorPanelRound: 4,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.nextPanelEligible, false); // 5-4=1, need > 2
});

test('panel cooldown — nextPanelEligible true after 3 rounds', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.6, constraints: 0.5, criteria: 0.5 } }],
    currentRound: 7,
    priorPanelRound: 4,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.nextPanelEligible, true); // 7-4=3 > 2
});

test('scorer rejects greenfield component missing required dim', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.9, criteria: 0.9 } }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must have scores\.constraints/);
});

test('coverageGaps lists low required dims', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.5, constraints: 0.9, criteria: 0.9 } }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.ok(out.coverageGaps.some((g) => g.includes('A/goal: 0.500 < 0.9')));
});

test('scoreClamped propagates from validationScoreClamped input', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.9, constraints: 0.9, criteria: 0.9 } }],
    validationScoreClamped: true,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.scoreClamped, true);
  assert.equal(out.validationScoreClamped, true);
});

test('streak counter increments and forces question at 3', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.7, constraints: 0.7, criteria: 0.7 } }],
    streakCounter: 2,
    lastRoundResolvedWithoutUser: true,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.streakCounter, 3);
  assert.equal(out.forceUserQuestion, true);
});

test('streak counter resets on direct user answer', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.7, constraints: 0.7, criteria: 0.7 } }],
    streakCounter: 2,
    lastRoundResolvedWithoutUser: false,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.streakCounter, 0);
  assert.equal(out.forceUserQuestion, false);
});

test('scorer rejects trigger with unknown component', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.7, constraints: 0.7, criteria: 0.7 } }],
    triggers: [{ component: 'TypoB', dim: 'goal', type: 'C' }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match any active component/);
});

test('scorer rejects trigger with invalid dim', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.7, constraints: 0.7, criteria: 0.7 } }],
    triggers: [{ component: 'A', dim: 'persona', type: 'C' }],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /trigger\.dim must be one of/);
});

test('dispatchPanel gates on bandChanged', () => {
  // Same band, cooldown OK, no oscillation → dispatchPanel should be false.
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [{ name: 'A', scores: { goal: 0.6, constraints: 0.5, criteria: 0.5 } }],
    priorBand: 'progress', // same as current will be
    currentRound: 5,
    priorPanelRound: 1,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.bandChanged, false);
  assert.equal(out.dispatchPanel, false);
});

test('nextTarget picks worst component + lowest dim deterministically', () => {
  const input = {
    threshold: 0.05, type: 'greenfield',
    components: [
      { name: 'Alpha', scores: { goal: 0.95, constraints: 0.95, criteria: 0.95 } },
      { name: 'Beta', scores: { goal: 0.4, constraints: 0.7, criteria: 0.6 } }
    ],
  };
  const r = runScript(SCORER, JSON.stringify(input));
  const out = JSON.parse(r.stdout);
  assert.equal(out.nextTarget.component, 'Beta');
  assert.equal(out.nextTarget.dimension, 'goal'); // lowest of Beta
});

test('validate rejects context weakest_dimension for greenfield', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'context',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('cannot be "context" for greenfield')));

test('validate rejects context trigger dim for greenfield', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'goal',
    triggers: [{ dim: 'context', type: 'C' }],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('cannot be "context" for greenfield')));
});

test('validate does not duplicate non-numeric score errors', () => {
  const input = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 'high', constraints: 0.7, criteria: 0.6 },
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = runScript(VALIDATE, input);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  const goalErrors = out.errors.filter((e) => e.includes('scores.goal'));
  assert.equal(goalErrors.length, 1, `expected 1 goal error, got ${goalErrors.length}: ${JSON.stringify(goalErrors)}`);
});
});

test('schema violation — empty components → exit 1 with stderr', () => {
  const input = JSON.stringify({ threshold: 0.05, type: 'greenfield', components: [] });
  const r = runScript(SCORER, input);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /components must be a non-empty array/);
});

test('schema violation — non-JSON input → exit 1 with stderr', () => {
  const r = runScript(SCORER, 'not json');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Invalid JSON/);
});

// ---------- pipeline integration ----------

console.log('\n[pipeline: validate.mjs → scorer.mjs]');

test('oracle output → validate → scorer pipeline produces ready:true', () => {
  const oracleOut = JSON.stringify({
    type: 'greenfield',
    scores: { goal: 0.96, constraints: 0.95, criteria: 0.96 },
    weakest_dimension: 'constraints',
    triggers: [],
  });
  const v = runScript(VALIDATE, oracleOut);
  const vOut = JSON.parse(v.stdout);
  assert.equal(vOut.ok, true);
  // Now feed into scorer wrapped as a single-component state
  const scorerInput = {
    threshold: 0.05,
    type: vOut.normalized.type,
    components: [{ name: 'Main', scores: vOut.normalized.scores }],
  };
  const s = runScript(SCORER, JSON.stringify(scorerInput));
  const sOut = JSON.parse(s.stdout);
  assert.equal(sOut.ready, true);
  assert.equal(sOut.band, 'ready');
});

test('pipeline: brownfield cannot reach 0.05 with context=0', () => {
  // Documents the brownfield-context requirement (math from numerical stress case #15)
  const oracleOut = JSON.stringify({
    type: 'brownfield',
    scores: { goal: 1.0, constraints: 1.0, criteria: 1.0, context: 0.0 },
    weakest_dimension: 'context',
    triggers: [],
  });
  const v = runScript(VALIDATE, oracleOut);
  const vOut = JSON.parse(v.stdout);
  const scorerInput = {
    threshold: 0.05,
    type: 'brownfield',
    components: [{ name: 'Main', scores: vOut.normalized.scores }],
  };
  const s = runScript(SCORER, JSON.stringify(scorerInput));
  const sOut = JSON.parse(s.stdout);
  assert.equal(sOut.ready, false, 'brownfield needs context ≥ ~0.667 even with perfect others');
  assert.ok(sOut.globalAmbiguity > 0.05);
});

// ---------- summary ----------

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
