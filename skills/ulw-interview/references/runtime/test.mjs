#!/usr/bin/env node
// Inline tests for scorer.mjs and validate.mjs. No framework, stdlib only.
// Run: node references/runtime/test.mjs

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORER = join(__dirname, 'scorer.mjs');
const VALIDATE = join(__dirname, 'validate.mjs');

function runScript(scriptPath, stdin) {
  const r = spawnSync('node', [scriptPath], { input: stdin, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function validCoverageFields() {
  const explicitNone = { status: 'explicit_none', source: 'user', source_round: 0, items: [] };
  return {
    coverage: {
      outcome: {
        status: 'confirmed',
        source: 'user',
        source_round: 0,
        items: [{ id: 'O1', text: 'Deliver the requested outcome', source: 'user', source_round: 0, state: 'active', supersedes: null }],
      },
      must_haves: explicitNone,
      must_nots: explicitNone,
      out_of_scope: explicitNone,
      invariants: explicitNone,
      preferences: explicitNone,
    },
    acceptance_evidence: [],
  };
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
    ...validCoverageFields(),
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
    ...validCoverageFields(),
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
    ...validCoverageFields(),
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
    ...validCoverageFields(),
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
    ...validCoverageFields(),
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

console.log('\n[scorer.mjs advisory]');

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
    ...validCoverageFields(),
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
    ...validCoverageFields(),
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

// ---------- refineGate.mjs ----------

console.log('\n[refineGate.mjs]');

const runtimeDir = __dirname;

test('delta=0.02 and clamped=true → shouldRefine true for goal', () => {
  const r = spawnSync('node', ['refineGate.mjs'], {
    input: JSON.stringify({
      priorScores: { goal: 0.8 },
      currentScores: { goal: 0.82 },
      validationScoreClamped: true,
      targetedDim: 'goal',
    }),
    cwd: runtimeDir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { shouldRefine: true, reason: 'low_delta_and_clamped', target: 'goal' });
});

test('delta=0.10 and clamped=true → shouldRefine false at threshold', () => {
  const r = spawnSync('node', ['refineGate.mjs'], {
    input: JSON.stringify({
      priorScores: { goal: 0.8 },
      currentScores: { goal: 0.9 },
      validationScoreClamped: true,
      targetedDim: 'goal',
    }),
    cwd: runtimeDir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { shouldRefine: false, reason: 'delta_at_or_above_threshold', target: null });
});

test('delta=0.02 and clamped=false → shouldRefine false when not clamped', () => {
  const r = spawnSync('node', ['refineGate.mjs'], {
    input: JSON.stringify({
      priorScores: { goal: 0.8 },
      currentScores: { goal: 0.82 },
      validationScoreClamped: false,
      targetedDim: 'goal',
    }),
    cwd: runtimeDir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { shouldRefine: false, reason: 'not_clamped', target: null });
});

test('delta=0.05 boundary and clamped=true → strict less-than keeps false', () => {
  const r = spawnSync('node', ['refineGate.mjs'], {
    input: JSON.stringify({
      priorScores: { goal: 0.8 },
      currentScores: { goal: 0.85 },
      validationScoreClamped: true,
      targetedDim: 'goal',
    }),
    cwd: runtimeDir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { shouldRefine: false, reason: 'delta_at_or_above_threshold', target: null });
});

test('cold-start with priorScores=null exits cleanly with false', () => {
  const r = spawnSync('node', ['refineGate.mjs'], {
    input: JSON.stringify({
      priorScores: null,
      currentScores: { goal: 0.82 },
      validationScoreClamped: true,
      targetedDim: 'goal',
    }),
    cwd: runtimeDir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { shouldRefine: false, reason: 'cold_start', target: null });
});

test('missing targeted dimension returns false with missing_dim', () => {
  const r = spawnSync('node', ['refineGate.mjs'], {
    input: JSON.stringify({
      priorScores: { goal: 0.8 },
      currentScores: { goal: 0.82 },
      validationScoreClamped: true,
      targetedDim: 'constraints',
    }),
    cwd: runtimeDir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { shouldRefine: false, reason: 'missing_dim', target: null });
});

test('malformed JSON exits 1 with stderr', () => {
  const r = spawnSync('node', ['refineGate.mjs'], {
    input: 'not valid json{{',
    cwd: runtimeDir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.notEqual(r.stderr.length, 0);
  assert.match(r.stderr, /Invalid JSON/);
});

// ---------- factsLedger.mjs ----------

console.log('\n[factsLedger.mjs]');

const FACTS_LEDGER_SCRIPT = join(__dirname, 'factsLedger.mjs');

function makeFactsLedgerSandbox(testName) {
  const cwd = mkdtempSync(join(tmpdir(), `ulw-facts-${testName}-`));
  const interviewId = `test-${testName}`;
  const stateDir = join(cwd, '.omo', 'state');
  const statePath = join(stateDir, `ulw-interview-facts-${interviewId}.json`);
  const lockPath = `${statePath}.lock`;

  mkdirSync(stateDir, { recursive: true });

  return {
    cleanup() {
      try {
        unlinkSync(statePath);
      } catch {
        // nothing to clean up
      }

      try {
        unlinkSync(lockPath);
      } catch {
        // nothing to clean up
      }

      rmSync(cwd, { recursive: true, force: true });
    },
    cwd,
    interviewId,
    lockPath,
    statePath,
  };
}

function runFactsLedger(args, sandbox, input) {
  return spawnSync('node', [FACTS_LEDGER_SCRIPT, ...args, '--interview-id', sandbox.interviewId], {
    cwd: sandbox.cwd,
    encoding: 'utf8',
    input,
  });
}

test('append first fact → list length 1 and confirmed', () => {
  const sandbox = makeFactsLedgerSandbox('append-first-fact');

  try {
    const append = runFactsLedger(
      ['append', '--fact-id', 'F1', '--claim', 'test', '--source-round', '1', '--confidence', 'user'],
      sandbox,
    );
    assert.equal(append.status, 0);

    const listed = runFactsLedger(['list'], sandbox);
    assert.equal(listed.status, 0);
    const out = JSON.parse(listed.stdout);
    assert.equal(out.entries.length, 1);
    assert.equal(out.entries[0].status, 'confirmed');
  } finally {
    sandbox.cleanup();
  }
});

test('duplicate fact_id append → noop', () => {
  const sandbox = makeFactsLedgerSandbox('duplicate-fact-id');

  try {
    const first = runFactsLedger(
      ['append', '--fact-id', 'F1', '--claim', 'test', '--source-round', '1', '--confidence', 'user'],
      sandbox,
    );
    assert.equal(first.status, 0);

    const duplicate = runFactsLedger(
      ['append', '--fact-id', 'F1', '--claim', 'test', '--source-round', '1', '--confidence', 'user'],
      sandbox,
    );
    assert.equal(duplicate.status, 0);

    const listed = runFactsLedger(['list'], sandbox);
    const out = JSON.parse(listed.stdout);
    assert.equal(out.entries.length, 1);
  } finally {
    sandbox.cleanup();
  }
});

test('queryDisputed on empty ledger → empty disputes', () => {
  const sandbox = makeFactsLedgerSandbox('empty-query-disputed');

  try {
    const queried = runFactsLedger(['queryDisputed'], sandbox);
    assert.equal(queried.status, 0);
    const out = JSON.parse(queried.stdout);
    assert.deepEqual(out, { disputes: [] });
  } finally {
    sandbox.cleanup();
  }
});

test('dispute fact F1 → queryDisputed returns original fact', () => {
  const sandbox = makeFactsLedgerSandbox('dispute-fact');

  try {
    const append = runFactsLedger(
      ['append', '--fact-id', 'F1', '--claim', 'test', '--source-round', '1', '--confidence', 'user'],
      sandbox,
    );
    assert.equal(append.status, 0);

    const disputed = runFactsLedger(['dispute', '--fact-id', 'F1', '--reason', 'contradicts R2'], sandbox);
    assert.equal(disputed.status, 0);

    const queried = runFactsLedger(['queryDisputed'], sandbox);
    const out = JSON.parse(queried.stdout);
    assert.equal(out.disputes.length, 1);
    assert.equal(out.disputes[0].originalFact.claim, 'test');
  } finally {
    sandbox.cleanup();
  }
});

test('supersede fact F1 → queryDisputed excludes it and list includes replacement', () => {
  const sandbox = makeFactsLedgerSandbox('supersede-fact');

  try {
    const append = runFactsLedger(
      ['append', '--fact-id', 'F1', '--claim', 'test', '--source-round', '1', '--confidence', 'user'],
      sandbox,
    );
    assert.equal(append.status, 0);

    const disputed = runFactsLedger(['dispute', '--fact-id', 'F1', '--reason', 'contradicts R2'], sandbox);
    assert.equal(disputed.status, 0);

    const superseded = runFactsLedger(
      ['supersede', '--fact-id', 'F1', '--claim', 'new text', '--source-round', '3'],
      sandbox,
    );
    assert.equal(superseded.status, 0);

    const queried = runFactsLedger(['queryDisputed'], sandbox);
    const disputedOut = JSON.parse(queried.stdout);
    assert.equal(disputedOut.disputes.some((entry) => entry.fact_id === 'F1'), false);

    const listed = runFactsLedger(['list'], sandbox);
    const listedOut = JSON.parse(listed.stdout);
    assert.equal(listedOut.entries.some((entry) => entry.claim === 'new text'), true);
  } finally {
    sandbox.cleanup();
  }
});

test('different interview-id → separate state file isolation', () => {
  const firstSandbox = makeFactsLedgerSandbox('isolation-one');
  const secondSandbox = makeFactsLedgerSandbox('isolation-two');

  try {
    const firstAppend = runFactsLedger(
      ['append', '--fact-id', 'F1', '--claim', 'test', '--source-round', '1', '--confidence', 'user'],
      firstSandbox,
    );
    assert.equal(firstAppend.status, 0);

    const firstList = runFactsLedger(['list'], firstSandbox);
    const secondList = runFactsLedger(['list'], secondSandbox);

    assert.equal(JSON.parse(firstList.stdout).entries.length, 1);
    assert.equal(JSON.parse(secondList.stdout).entries.length, 0);
    assert.notEqual(firstSandbox.statePath, secondSandbox.statePath);
  } finally {
    firstSandbox.cleanup();
    secondSandbox.cleanup();
  }
});

test('corrupt state file → exit 1 with corrupted message', () => {
  const sandbox = makeFactsLedgerSandbox('corrupt-state');

  try {
    writeFileSync(sandbox.statePath, '{garbage');
    const listed = runFactsLedger(['list'], sandbox);
    assert.equal(listed.status, 1);
    assert.match(listed.stderr, /corrupted/i);
  } finally {
    sandbox.cleanup();
  }
});

test('stale lock file → auto-removes lock and succeeds', () => {
  const sandbox = makeFactsLedgerSandbox('stale-lock');

  try {
    writeFileSync(sandbox.lockPath, JSON.stringify({ pid: 12345, timestamp: Date.now() - 6 * 60 * 1000 }));
    const listed = runFactsLedger(['list'], sandbox);
    assert.equal(listed.status, 0);
    const out = JSON.parse(listed.stdout);
    assert.deepEqual(out.entries, []);
  } finally {
    sandbox.cleanup();
  }
});

test('list on empty ledger → entries array', () => {
  const sandbox = makeFactsLedgerSandbox('empty-list');

  try {
    const listed = runFactsLedger(['list'], sandbox);
    assert.equal(listed.status, 0);
    assert.deepEqual(JSON.parse(listed.stdout), { entries: [] });
  } finally {
    sandbox.cleanup();
  }
});

test('malformed JSON stdin → exit 1', () => {
  const sandbox = makeFactsLedgerSandbox('malformed-stdin');

  try {
    const listed = runFactsLedger(['list'], sandbox, '{not-json');
    assert.equal(listed.status, 1);
    assert.match(listed.stderr, /Invalid JSON/);
  } finally {
    sandbox.cleanup();
  }
});

// [coverage gaps]

console.log('\n[coverage gaps]');

test('validate empty stdin → ok:false', () => {
  const r = spawnSync('node', [VALIDATE], { input: '', encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes('empty input'));
});

test('validate top-level array stdin → ok:false', () => {
  const r = spawnSync('node', [VALIDATE], { input: '[1,2,3]', encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes('top-level value must be a JSON object'));
});

test('scorer NaN threshold → clamped + flag', () => {
  const input = {
    ...GREENFIELD_READY,
    threshold: Number.NaN,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.thresholdClamped, true);
});

test('scorer priorPanelRound undefined → cooldown default works', () => {
  const input = {
    ...GREENFIELD_READY,
    currentRound: 3,
  };
  const r = runScript(SCORER, JSON.stringify(input));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.nextPanelEligible, true);
});

test('validate expected-type=greenfield rejects brownfield context but preserves type coercion', () => {
  const input = JSON.stringify({
    ...validCoverageFields(),
    type: 'brownfield',
    scores: { goal: 0.8, constraints: 0.7, criteria: 0.6, context: 0.5 },
    weakest_dimension: 'goal',
    triggers: [],
  });
  const r = spawnSync('node', [VALIDATE, '--expected-type=greenfield'], { input, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, [
    'scores.context is not allowed for greenfield; expected exactly goal|constraints|criteria',
  ]);

  const compatible = JSON.parse(input);
  delete compatible.scores.context;
  const compatibleRun = spawnSync('node', [VALIDATE, '--expected-type=greenfield'], {
    input: JSON.stringify(compatible), encoding: 'utf8',
  });
  const compatibleOut = JSON.parse(compatibleRun.stdout);
  assert.equal(compatibleOut.ok, true);
  assert.equal(compatibleOut.normalized.type, 'greenfield');
  assert.deepEqual(Object.keys(compatibleOut.normalized.scores), ['goal', 'constraints', 'criteria']);
});

// ---------- summary ----------

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
