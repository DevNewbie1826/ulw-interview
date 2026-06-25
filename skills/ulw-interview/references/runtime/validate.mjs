#!/usr/bin/env node
// ULW Interview oracle-output validator.
// Reads raw text (simulating oracle JSON output) from stdin, validates against
// the documented schema, returns either { ok: true, normalized } or
// { ok: false, errors, retryHint }.
//
// The LLM pipes every oracle scoring response through this script BEFORE
// piping into scorer.mjs. If ok:false twice in a row, the LLM falls back to
// conservative scores (all dims 0.5) per the SKILL.md fallback policy.

import { readFileSync } from 'node:fs';

// Optional CLI arg: --expected-type=greenfield|brownfield
// When provided, this is authoritative and overrides any `type` field in the input.
// The LLM passes this from Phase 1's brownfield/greenfield detection so the validator
// cannot silently default an ambiguous oracle response to the wrong type.
const argv = process.argv.slice(2);
let expectedType = null;
for (const a of argv) {
  const m = /^--expected-type=(greenfield|brownfield)$/.exec(a);
  if (m) expectedType = m[1];
}

const REQUIRED_DIMS_GREENFIELD = ['goal', 'constraints', 'criteria'];
const REQUIRED_DIMS_BROWNFIELD = ['goal', 'constraints', 'criteria', 'context'];
const VALID_DIMS = new Set(['goal', 'constraints', 'criteria', 'context']);
const VALID_TRIGGERS = new Set(['A', 'B', 'C', 'D']);

function readInput() {
  return readFileSync(0, 'utf8');
}

function clamp01(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function fail(errors) {
  const retryHint =
    'Re-dispatch the oracle with explicit instruction: '
    + '"Return STRICT JSON only. Required fields: scores{goal,constraints,criteria[,context]}, '
    + 'weakest_dimension in {goal,constraints,criteria,context}, '
    + 'triggers: array of {dim, type:A|B|C|D}. All scores in [0,1]. No prose, no code fences."';
  process.stdout.write(JSON.stringify({
    ok: false,
    errors,
    retryHint,
  }, null, 2) + '\n');
  process.exit(0); // exit 0: the LLM reads the ok:false payload
}

function coerceType(value) {
  // CLI --expected-type is authoritative when provided.
  if (expectedType) {
    if (value !== undefined && value !== null && value !== expectedType) {
      // Oracle disagreed with declared type. Trust the declared type (Phase 1 detection).
      return expectedType;
    }
    return expectedType;
  }
  // No CLI override: require the field, do not silently default.
  if (value === 'greenfield' || value === 'brownfield') return value;
  return null;
}

function main() {
  const raw = readInput().trim();
  if (!raw) {
    fail(['empty input']);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail([`not valid JSON: ${e.message}`]);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(['top-level value must be a JSON object']);
  }

  const errors = [];

  // type
  const type = coerceType(parsed.type);
  if (type === null) errors.push('if present, type must be "greenfield" or "brownfield"');

  // scores object
  const requiredDims = type === 'brownfield' ? REQUIRED_DIMS_BROWNFIELD : REQUIRED_DIMS_GREENFIELD;
  if (typeof parsed.scores !== 'object' || parsed.scores === null || Array.isArray(parsed.scores)) {
    errors.push('scores must be an object with dimension keys');
  } else {
    for (const dim of requiredDims) {
      if (!(dim in parsed.scores)) {
        errors.push(`scores.${dim} missing (required for ${type})`);
      } else if (typeof parsed.scores[dim] !== 'number' || !Number.isFinite(parsed.scores[dim])) {
        errors.push(`scores.${dim} must be a finite number, got: ${JSON.stringify(parsed.scores[dim])}`);
      }
    }
    for (const k of Object.keys(parsed.scores)) {
      if (requiredDims.includes(k)) continue; // already type-checked in the required loop
      if (!VALID_DIMS.has(k)) {
        errors.push(`scores.${k} is not a recognized dimension`);
      } else if (typeof parsed.scores[k] !== 'number' || !Number.isFinite(parsed.scores[k])) {
        errors.push(`scores.${k} must be a finite number, got: ${JSON.stringify(parsed.scores[k])}`);
      }
    }
  }

  // weakest_dimension
  const wd = parsed.weakest_dimension;
  if (!VALID_DIMS.has(wd)) {
    errors.push(`weakest_dimension must be one of ${[...VALID_DIMS].join('|')}, got: ${JSON.stringify(wd)}`);
  } else if (type === 'greenfield' && wd === 'context') {
    errors.push('weakest_dimension cannot be "context" for greenfield (context is not scored)');
  }

  // triggers
  if (!Array.isArray(parsed.triggers)) {
    errors.push('triggers must be an array');
  } else {
    parsed.triggers.forEach((t, i) => {
      if (!t || typeof t !== 'object') {
        errors.push(`triggers[${i}] must be an object`);
        return;
      }
      if (!VALID_DIMS.has(t.dim)) {
        errors.push(`triggers[${i}].dim must be one of ${[...VALID_DIMS].join('|')}, got: ${JSON.stringify(t.dim)}`);
      } else if (type === 'greenfield' && t.dim === 'context') {
        errors.push(`triggers[${i}].dim cannot be "context" for greenfield (context is not scored)`);
      }
      if (!VALID_TRIGGERS.has(t.type)) {
        errors.push(`triggers[${i}].type must be one of ${[...VALID_TRIGGERS].join('|')}, got: ${JSON.stringify(t.type)}`);
      }
    });
  }

  if (errors.length) fail(errors);

  // normalize: clamp scores, ensure all required dims present, track clamp flags
  const normalizedScores = {};
  const clampedFields = [];
  for (const dim of REQUIRED_DIMS_BROWNFIELD) {
    if (dim in parsed.scores) {
      const raw = parsed.scores[dim];
      // Type already validated above; clamp01 always returns a number here.
      const r = clamp01(raw);
      const clamped = r !== raw;
      if (clamped) clampedFields.push(dim);
      normalizedScores[dim] = r;
    }
  }

  // triggers pass-through (validated)
  const normalizedTriggers = parsed.triggers.map((t) => ({ dim: t.dim, type: t.type }));

  const output = {
    ok: true,
    scoreClamped: clampedFields.length > 0,
    clampedFields,
    normalized: {
      type,
      scores: normalizedScores,
      weakest_dimension: parsed.weakest_dimension,
      triggers: normalizedTriggers,
      // fields below are echoed if oracle provided them; not required
      justification: typeof parsed.justification === 'string' ? parsed.justification : null,
      gap: typeof parsed.gap === 'string' ? parsed.gap : null,
    },
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main();
