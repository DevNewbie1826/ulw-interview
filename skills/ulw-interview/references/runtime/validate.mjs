#!/usr/bin/env node
// ULW Interview oracle-output validator.
// Reads raw text (simulating oracle JSON output) from stdin, validates against
// the documented schema, returns either { ok: true, normalized } or
// { ok: false, errors, retryHint }.
//
// The LLM pipes every oracle scoring response through this script BEFORE
// piping into scorer.mjs. If ok:false twice in a row, the LLM falls back to
// conservative scores (all dims 0.5) per the SKILL.md fallback policy.

// Optional CLI arg: --expected-type=greenfield|brownfield
// When provided, this is authoritative and overrides any `type` field in the input.
// The LLM passes this from Phase 1's brownfield/greenfield detection so the validator
// cannot silently default an ambiguous oracle response to the wrong type.
const argv = process.argv.slice(2);
let expectedType = null;
let registryContextEncoded = null;
let registryContext = null;
const cliErrors = [];
for (const a of argv) {
  const m = /^--expected-type=(greenfield|brownfield)$/.exec(a);
  if (m) expectedType = m[1];
  if (a === '--registry-context') {
    cliErrors.push('--registry-context requires a base64url JSON value');
  } else if (a.startsWith('--registry-context=')) {
    if (registryContextEncoded !== null) {
      cliErrors.push('--registry-context may be provided at most once');
    } else {
      registryContextEncoded = a.slice('--registry-context='.length);
    }
  }
}

const REQUIRED_DIMS_GREENFIELD = ['goal', 'constraints', 'criteria'];
const REQUIRED_DIMS_BROWNFIELD = ['goal', 'constraints', 'criteria', 'context'];
const VALID_DIMS = new Set(['goal', 'constraints', 'criteria', 'context']);
const VALID_TRIGGERS = new Set(['A', 'B', 'C', 'D']);
const TOP_LEVEL_KEYS = new Set([
  'type', 'scores', 'weakest_dimension', 'triggers', 'justification', 'gap',
  'coverage', 'acceptance_evidence',
]);
const COVERAGE_KEYS = ['outcome', 'must_haves', 'must_nots', 'out_of_scope', 'invariants', 'preferences'];
const CATEGORY_CONFIG = {
  outcome: { prefix: 'O', statuses: new Set(['open', 'confirmed']) },
  must_haves: { prefix: 'M', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  must_nots: { prefix: 'N', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  out_of_scope: { prefix: 'X', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  invariants: { prefix: 'I', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
  preferences: { prefix: 'P', statuses: new Set(['open', 'confirmed', 'explicit_none']) },
};
const CATEGORY_KEYS = new Set(['status', 'source', 'source_round', 'items']);
const ITEM_KEYS = new Set(['id', 'text', 'source', 'source_round', 'state', 'supersedes']);
const EVIDENCE_KEYS = new Set(['id', 'verifies', 'type', 'pass_condition', 'source', 'source_round']);
const EVIDENCE_TYPES = new Set(['test', 'inspection', 'observation', 'analysis']);
const REGISTRY_CONTEXT_KEYS = new Set(['component', 'owners']);
const REGISTRY_ID_PATTERN = /^[OMNXIPE][1-9][0-9]*$/;
const MAX_VALIDATOR_INPUT_BYTES = 1024 * 1024;
const MAX_REGISTRY_CONTEXT_BYTES = 256 * 1024;
const MAX_REGISTRY_CONTEXT_ENCODED_CHARS = Math.ceil(MAX_REGISTRY_CONTEXT_BYTES * 4 / 3);
const MAX_COMPONENT_NAME_LENGTH = 120;
const MAX_VALIDATION_ERRORS = 64;

class ValidationFailure extends Error {
  constructor(errors) {
    super('validation failed');
    this.errors = errors;
  }
}

async function readInput() {
  const chunks = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    inputBytes += bytes.length;
    if (inputBytes > MAX_VALIDATOR_INPUT_BYTES) {
      process.stdin.destroy();
      return null;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function unwrapJsonFence(input) {
  const match = /^(?:```json|```)\r?\n([\s\S]*)\r?\n```$/.exec(input);
  if (!match || match[1].trim() === '' || match[1].includes('```')) return input;
  return match[1];
}

function clamp01(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addUnknownKeyErrors(value, allowedKeys, path, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function parseRegistryContext(encoded, errors) {
  const errorCount = errors.length;
  if (encoded.length > MAX_REGISTRY_CONTEXT_ENCODED_CHARS) {
    errors.push(`registry context exceeds ${MAX_REGISTRY_CONTEXT_BYTES} decoded bytes`);
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    errors.push('registry context must be canonical non-empty base64url JSON');
    return null;
  }
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length > MAX_REGISTRY_CONTEXT_BYTES) {
    errors.push(`registry context exceeds ${MAX_REGISTRY_CONTEXT_BYTES} decoded bytes`);
    return null;
  }
  if (bytes.toString('base64url') !== encoded) {
    errors.push('registry context must be canonical non-empty base64url JSON');
    return null;
  }
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    errors.push('registry context must decode to valid UTF-8 JSON');
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    errors.push('registry context must decode to valid JSON');
    return null;
  }
  if (!isObject(parsed)) {
    errors.push('registry context must be an object');
    return null;
  }
  addUnknownKeyErrors(parsed, REGISTRY_CONTEXT_KEYS, 'registry context', errors);
  if (!Object.hasOwn(parsed, 'component')) errors.push('registry context.component is required');
  if (!Object.hasOwn(parsed, 'owners')) errors.push('registry context.owners is required');
  if (typeof parsed.component !== 'string' || parsed.component.trim() === '') {
    errors.push('registry context.component must be a non-empty string');
  } else if ([...parsed.component].length > MAX_COMPONENT_NAME_LENGTH) {
    errors.push(`registry context.component must be at most ${MAX_COMPONENT_NAME_LENGTH} characters`);
  }
  if (!isObject(parsed.owners)) {
    errors.push('registry context.owners must be an object');
  } else {
    for (const [id, owner] of Object.entries(parsed.owners)) {
      if (!REGISTRY_ID_PATTERN.test(id)) {
        errors.push(`registry context.owners key ${id} must match ${REGISTRY_ID_PATTERN}`);
      }
      if (typeof owner !== 'string' || owner.trim() === '') {
        errors.push(`registry context.owners.${id} must be a non-empty string`);
      } else if ([...owner].length > MAX_COMPONENT_NAME_LENGTH) {
        errors.push(`registry context.owners.${id} must be at most ${MAX_COMPONENT_NAME_LENGTH} characters`);
      }
    }
  }
  return errors.length === errorCount ? parsed : null;
}

function validateRegistryOwnership(id, errors) {
  if (registryContext === null || typeof id !== 'string') return;
  const owner = registryContext.owners[id];
  if (owner !== undefined && owner !== registryContext.component) {
    errors.push(
      `registry context ID ${id} is owned by component "${owner}", not current component "${registryContext.component}"`,
    );
  }
}

function validateCategory(categoryName, record, errors) {
  const path = `coverage.${categoryName}`;
  const config = CATEGORY_CONFIG[categoryName];
  if (!isObject(record)) {
    errors.push(`${path} must be an object`);
    return [];
  }
  addUnknownKeyErrors(record, CATEGORY_KEYS, path, errors);
  if (!config.statuses.has(record.status)) {
    errors.push(`${path}.status must be one of ${[...config.statuses].join('|')}`);
  }
  if (!Array.isArray(record.items)) {
    errors.push(`${path}.items must be an array`);
    return [];
  }

  const items = record.items;
  const activeCount = items.filter((item) => isObject(item) && item.state === 'active').length;
  if (record.status === 'open') {
    if (record.source !== null) errors.push(`${path}.source must be null when status is "open"`);
    if (record.source_round !== null) errors.push(`${path}.source_round must be null when status is "open"`);
    if (activeCount !== 0) errors.push(`${path} must contain no active items when status is "open"`);
  } else if (record.status === 'confirmed') {
    if (record.source !== 'user') errors.push(`${path}.source must be "user" when status is "confirmed"`);
    if (!isNonNegativeInteger(record.source_round)) {
      errors.push(`${path}.source_round must be a non-negative integer when status is "confirmed"`);
    }
    if (categoryName === 'outcome' && activeCount !== 1) {
      errors.push(`${path} must contain exactly one active item when confirmed`);
    } else if (categoryName !== 'outcome' && activeCount === 0) {
      errors.push(`${path} must contain at least one active item when confirmed`);
    }
  } else if (record.status === 'explicit_none') {
    if (record.source !== 'user') errors.push(`${path}.source must be "user" when status is "explicit_none"`);
    if (!isNonNegativeInteger(record.source_round)) {
      errors.push(`${path}.source_round must be a non-negative integer when status is "explicit_none"`);
    }
    if (activeCount !== 0) errors.push(`${path} must contain no active items when status is "explicit_none"`);
  }

  const idPattern = new RegExp(`^${config.prefix}[1-9][0-9]*$`);
  const itemsById = new Map();
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}.items[${index}]`;
    if (!isObject(item)) {
      errors.push(`${itemPath} must be an object`);
      continue;
    }
    addUnknownKeyErrors(item, ITEM_KEYS, itemPath, errors);
    if (typeof item.id !== 'string' || !idPattern.test(item.id)) {
      errors.push(`${itemPath}.id must match ${idPattern}`);
    } else if (itemsById.has(item.id)) {
      errors.push(`${path} has duplicate item id ${item.id}`);
    } else {
      itemsById.set(item.id, item);
    }
    validateRegistryOwnership(item.id, errors);
    if (typeof item.text !== 'string' || item.text.trim() === '') {
      errors.push(`${itemPath}.text must be a non-empty string`);
    }
    if (item.source !== 'user') errors.push(`${itemPath}.source must be "user"`);
    if (!isNonNegativeInteger(item.source_round)) {
      errors.push(`${itemPath}.source_round must be a non-negative integer`);
    }
    if (item.state !== 'active' && item.state !== 'superseded') {
      errors.push(`${itemPath}.state must be one of active|superseded`);
    }
    if (item.supersedes !== null && typeof item.supersedes !== 'string') {
      errors.push(`${itemPath}.supersedes must be null or an item ID`);
    }
  }

  const replacementCounts = new Map();
  for (const [index, item] of items.entries()) {
    if (!isObject(item) || typeof item.supersedes !== 'string') continue;
    const itemPath = `${path}.items[${index}]`;
    const replaced = itemsById.get(item.supersedes);
    if (!replaced) {
      errors.push(`${itemPath}.supersedes ${item.supersedes} does not reference an existing item in ${path}`);
      continue;
    }
    if (idPattern.test(item.id) && Number(item.id.slice(1)) <= Number(item.supersedes.slice(1))) {
      errors.push(`${itemPath}.supersedes must reference an older ID`);
    }
    if (replaced.state !== 'superseded') {
      errors.push(`${itemPath}.supersedes must reference a superseded item`);
    }
    replacementCounts.set(item.supersedes, (replacementCounts.get(item.supersedes) ?? 0) + 1);
  }
  for (const item of items) {
    if (!isObject(item) || item.state !== 'superseded' || typeof item.id !== 'string') continue;
    const replacementCount = replacementCounts.get(item.id) ?? 0;
    if (replacementCount > 1) errors.push(`${path} item ${item.id} is superseded by multiple items`);
    if (replacementCount === 0 && record.status !== 'explicit_none') {
      errors.push(`${path} item ${item.id} is superseded but has no replacement`);
    }
  }
  return items;
}

function validateCoverage(coverage, acceptanceEvidence, errors) {
  if (!isObject(coverage)) {
    errors.push('coverage must be an object');
    return;
  }
  addUnknownKeyErrors(coverage, new Set(COVERAGE_KEYS), 'coverage', errors);
  const allItems = [];
  const globalIds = new Set();
  for (const categoryName of COVERAGE_KEYS) {
    const items = validateCategory(categoryName, coverage[categoryName], errors);
    for (const item of items) {
      if (!isObject(item) || typeof item.id !== 'string') continue;
      if (globalIds.has(item.id)) errors.push(`coverage has duplicate item id ${item.id}`);
      globalIds.add(item.id);
      allItems.push({ categoryName, item });
    }
  }
  validateAcceptanceEvidence(acceptanceEvidence, allItems, errors);
}

function validateAcceptanceEvidence(entries, allItems, errors) {
  if (!Array.isArray(entries)) {
    errors.push('acceptance_evidence must be an array');
    return;
  }
  const eligibleIds = new Set();
  for (const { categoryName, item } of allItems) {
    if (!['must_haves', 'must_nots', 'invariants'].includes(categoryName)) continue;
    const prefix = CATEGORY_CONFIG[categoryName].prefix;
    if (!new RegExp(`^${prefix}[1-9][0-9]*$`).test(item.id)) continue;
    eligibleIds.add(item.id);
  }

  const evidenceIds = new Set();
  for (const [index, entry] of entries.entries()) {
    const path = `acceptance_evidence[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    addUnknownKeyErrors(entry, EVIDENCE_KEYS, path, errors);
    if (typeof entry.id !== 'string' || !/^E[1-9][0-9]*$/.test(entry.id)) {
      errors.push(`${path}.id must match /^E[1-9][0-9]*$/`);
    } else if (evidenceIds.has(entry.id)) {
      errors.push(`duplicate acceptance evidence id ${entry.id}`);
    } else {
      evidenceIds.add(entry.id);
    }
    validateRegistryOwnership(entry.id, errors);
    if (!Array.isArray(entry.verifies) || entry.verifies.length === 0) {
      errors.push(`${path}.verifies must be a non-empty array`);
    } else {
      const references = new Set();
      for (const reference of entry.verifies) {
        if (references.has(reference)) {
          errors.push(`${path}.verifies contains duplicate reference ${reference}`);
          continue;
        }
        references.add(reference);
        if (typeof reference !== 'string' || !eligibleIds.has(reference)) {
          errors.push(`${path}.verifies reference ${reference} must identify an existing M/N/I item`);
        }
      }
    }
    if (!EVIDENCE_TYPES.has(entry.type)) {
      errors.push(`${path}.type must be one of ${[...EVIDENCE_TYPES].join('|')}`);
    }
    if (typeof entry.pass_condition !== 'string' || entry.pass_condition.trim() === '') {
      errors.push(`${path}.pass_condition must be a non-empty string`);
    }
    if (entry.source !== 'user') {
      errors.push(`${path}.source must be "user"`);
    }
    if (!isNonNegativeInteger(entry.source_round)) {
      errors.push(`${path}.source_round must be a non-negative integer`);
    }
  }
}

function normalizeCoverage(coverage) {
  return Object.fromEntries(COVERAGE_KEYS.map((categoryName) => {
    const record = coverage[categoryName];
    return [categoryName, {
      status: record.status,
      source: record.source,
      source_round: record.source_round,
      items: record.items.map((item) => ({
        id: item.id,
        text: item.text,
        source: item.source,
        source_round: item.source_round,
        state: item.state,
        supersedes: item.supersedes,
      })),
    }];
  }));
}

function normalizeAcceptanceEvidence(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    verifies: [...entry.verifies],
    type: entry.type,
    pass_condition: entry.pass_condition,
    source: entry.source,
    source_round: entry.source_round,
  }));
}

function fail(errors) {
  throw new ValidationFailure(errors);
}

function writeFailure(errors) {
  const boundedErrors = errors.length > MAX_VALIDATION_ERRORS
    ? [
      ...errors.slice(0, MAX_VALIDATION_ERRORS - 1),
      `${errors.length - (MAX_VALIDATION_ERRORS - 1)} additional errors omitted`,
    ]
    : errors;
  const retryHint =
    'Re-dispatch the oracle with explicit instruction: '
    + '"Return STRICT JSON only. Required fields: scores{goal,constraints,criteria[,context]}, '
    + 'weakest_dimension in {goal,constraints,criteria,context}, '
    + 'triggers: array of {dim, type:A|B|C|D}, coverage, and acceptance_evidence. '
    + 'All scores in [0,1]. User provenance must be explicit. No prose, code fences, or unknown keys."';
  process.stdout.write(JSON.stringify({
    ok: false,
    errors: boundedErrors,
    retryHint,
  }, null, 2) + '\n');
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

async function main() {
  const input = await readInput();
  if (input === null) {
    fail([`input exceeds ${MAX_VALIDATOR_INPUT_BYTES} bytes`]);
  }
  const raw = input.trim();
  if (!raw) {
    fail(['empty input']);
  }

  let parsed;
  try {
    parsed = JSON.parse(unwrapJsonFence(raw));
  } catch (e) {
    fail([`not valid JSON: ${e.message}`]);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(['top-level value must be a JSON object']);
  }

  const errors = [...cliErrors];
  if (registryContextEncoded !== null) {
    registryContext = parseRegistryContext(registryContextEncoded, errors);
  }
  addUnknownKeyErrors(parsed, TOP_LEVEL_KEYS, 'top-level', errors);

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
      } else {
        errors.push(`scores.${k} is not allowed for ${type}; expected exactly ${requiredDims.join('|')}`);
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
      if (!isObject(t)) {
        errors.push(`triggers[${i}] must be an object`);
        return;
      }
      addUnknownKeyErrors(t, new Set(['dim', 'type']), `triggers[${i}]`, errors);
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

  validateCoverage(parsed.coverage, parsed.acceptance_evidence, errors);

  if (errors.length) fail(errors);

  // normalize: clamp scores, ensure all required dims present, track clamp flags
  const normalizedScores = {};
  const clampedFields = [];
  for (const dim of requiredDims) {
    const raw = parsed.scores[dim];
    // Type already validated above; clamp01 always returns a number here.
    const r = clamp01(raw);
    const clamped = r !== raw;
    if (clamped) clampedFields.push(dim);
    normalizedScores[dim] = r;
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
      coverage: normalizeCoverage(parsed.coverage),
      acceptance_evidence: normalizeAcceptanceEvidence(parsed.acceptance_evidence),
      // fields below are echoed if oracle provided them; not required
      justification: typeof parsed.justification === 'string' ? parsed.justification : null,
      gap: typeof parsed.gap === 'string' ? parsed.gap : null,
    },
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

try {
  await main();
} catch (error) {
  if (error instanceof ValidationFailure) {
    writeFailure(error.errors);
  } else {
    throw error;
  }
}
