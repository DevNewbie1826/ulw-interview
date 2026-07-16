import { createHash } from 'node:crypto';

export class RuntimeContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuntimeContractError';
  }
}

export class StateValidationError extends RuntimeContractError {
  constructor(message) {
    super(message);
    this.name = 'StateValidationError';
  }
}

export class TransitionError extends RuntimeContractError {
  constructor(message) {
    super(message);
    this.name = 'TransitionError';
  }
}

export const DEFAULT_THRESHOLD = 0.05;
export const DEFAULT_THRESHOLD_SOURCE = 'default';
export const AGENT_SCORE_CAP = 0.85;
export const MAX_COMPONENTS = 6;
export const MAX_ROUNDS = 100;
export const SOFT_WARNING_ROUND = 10;
export const MAX_DIRECTORY_BYTES = 4_096;
export const MAX_MARKDOWN_BYTES = 50_000;
export const MAX_STATE_BYTES = 900_000;
export const PANEL_PERSONAS = Object.freeze(['analyst', 'critic']);
export const CORE_DIMENSIONS = Object.freeze(['goal', 'constraints', 'criteria']);
export const BROWNFIELD_DIMENSIONS = Object.freeze(['goal', 'constraints', 'criteria', 'context']);
export const PHASES = Object.freeze(['topology', 'round', 'closure', 'restate', 'write', 'written', 'stopped']);
export const INTERVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const COMPONENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const WEIGHTS = Object.freeze({
  greenfield: Object.freeze({ goal: 0.40, constraints: 0.30, criteria: 0.30 }),
  brownfield: Object.freeze({ goal: 0.35, constraints: 0.25, criteria: 0.25, context: 0.15 }),
});

const TEXT_ENCODER = new TextEncoder();

export function requiredDimensions(type) {
  if (type === 'greenfield') return [...CORE_DIMENSIONS];
  if (type === 'brownfield') return [...BROWNFIELD_DIMENSIONS];
  throw new StateValidationError('type must be greenfield or brownfield');
}

export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertObject(value, label) {
  if (!isObject(value)) throw new StateValidationError(`${label} must be an object`);
  return value;
}

export function clone(value) {
  return structuredClone(value);
}

export function byteLength(value) {
  return TEXT_ENCODER.encode(value).length;
}

export function isJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value).every((entry) => isJsonValue(entry));
}

export function assertJsonValue(value, label) {
  if (!isJsonValue(value)) throw new StateValidationError(`${label} must be JSON-serializable`);
  return value;
}

export function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StateValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

export function assertSafeId(value, label, pattern = COMPONENT_ID_PATTERN) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new StateValidationError(`${label} must be a safe identifier`);
  }
  return value;
}

export function assertInterviewId(value) {
  return assertSafeId(value, 'interviewId', INTERVIEW_ID_PATTERN);
}

export function assertInterviewType(value) {
  if (value !== 'greenfield' && value !== 'brownfield') {
    throw new StateValidationError('type must be greenfield or brownfield');
  }
  return value;
}

export function assertThreshold(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new StateValidationError('threshold must be greater than 0 and at most 1');
  }
  return value;
}

export function assertUnitInterval(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new StateValidationError(`${label} must be a finite number from 0 to 1`);
  }
  return value;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashContent(value) {
  const source = typeof value === 'string' ? value : stableJson(value);
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function questionHash(question) {
  return hashContent(question);
}

export function answerHash(answer) {
  return hashContent(answer);
}

export function scoringHash(scoring) {
  const { scoringHash: _scoringHash, ...payload } = scoring;
  return hashContent(payload);
}

export function deriveRoundKey(interviewId, input) {
  assertInterviewId(interviewId);
  assertObject(input, 'round key input');
  const roundId = input.roundId ?? input.round_id;
  if (typeof roundId === 'string' && roundId.trim() !== '') return `${interviewId}::rid:${roundId}`;
  return `${interviewId}::r:${input.round}::q:${input.questionId ?? input.question_id ?? 'noqid'}`;
}

export function validateScores(scores, type, label = 'scores') {
  assertObject(scores, label);
  const normalized = {};
  for (const dimension of requiredDimensions(type)) {
    normalized[dimension] = assertUnitInterval(scores[dimension], `${label}.${dimension}`);
  }
  return normalized;
}

export function scoreDetails(value, type, label = 'scores') {
  assertObject(value, label);
  const scores = validateScores(value, type, label);
  const metadata = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(scores, key)) metadata[key] = clone(entry);
  }
  return { scores, metadata };
}

export {
  canonicalizeState,
  createInitialState,
  normalizeEstablishedFact,
  normalizeEstablishedFacts,
  normalizeFact,
  normalizeTopologyComponents,
  topologyComponents,
  topologyObject,
} from './state-shape.mjs';
