import { componentAmbiguity, round2 } from './ambiguity-floor.mjs';
import { AGENT_SCORE_CAP, PANEL_PERSONAS, TransitionError, assertObject, clone, requiredDimensions, scoreDetails } from './state.mjs';
import { activeComponents } from './transition-support.mjs';

const TRIGGER_KINDS = new Set(['A', 'B', 'C', 'D']);
const TRIGGER_STATUSES = new Set(['active', 'disputed', 'unresolved']);

export function capAgentScores(scores, answer) {
  const trusted = answer.kind === 'agent'
    && answer.confidence === 'high'
    && typeof answer.uncertainty === 'number'
    && Number.isFinite(answer.uncertainty)
    && answer.uncertainty >= 0
    && answer.uncertainty <= 0.05;
  if (answer.kind !== 'agent' || trusted) return scores;
  return Object.fromEntries(Object.entries(scores).map(([dimension, score]) => [dimension, Math.min(score, AGENT_SCORE_CAP)]));
}

function triggerComponent(trigger) {
  return trigger.component ?? trigger.componentId ?? trigger.component_id;
}

function triggerFactId(trigger) {
  return trigger.factId ?? trigger.contradictedFactId ?? trigger.contradicted_fact_id;
}

export function normalizeTriggers(input, state) {
  const rawTriggers = input.triggers ?? input.structured_scorer_output?.triggers ?? [];
  if (!Array.isArray(rawTriggers)) throw new TransitionError('triggers must be an array');
  const activeIds = new Set(activeComponents(state).map((component) => component.id));
  const dimensions = new Set(requiredDimensions(state.type));
  const factIds = new Set(state.facts.map((fact) => fact.id));
  return rawTriggers.map((rawTrigger, index) => {
    assertObject(rawTrigger, `trigger ${index}`);
    const trigger = {
      ...clone(rawTrigger),
      component: triggerComponent(rawTrigger),
      dimension: rawTrigger.dimension ?? rawTrigger.affected_dimension,
      status: rawTrigger.status ?? rawTrigger.trigger_status,
      ...(triggerFactId(rawTrigger) === undefined ? {} : { factId: triggerFactId(rawTrigger) }),
    };
    if (!TRIGGER_KINDS.has(trigger.kind)) throw new TransitionError('trigger.kind must be A, B, C, or D');
    if (!TRIGGER_STATUSES.has(trigger.status)) throw new TransitionError('trigger.status is invalid');
    if (!activeIds.has(trigger.component)) throw new TransitionError('trigger component must be active');
    if (!dimensions.has(trigger.dimension)) throw new TransitionError('trigger dimension is invalid');
    if ((trigger.status === 'disputed' || trigger.status === 'unresolved')
      && (typeof trigger.rationale !== 'string' || trigger.rationale.trim() === '')) {
      throw new TransitionError('disputed or unresolved triggers require a rationale');
    }
    if (trigger.kind === 'A') {
      if (typeof trigger.factId !== 'string' || !factIds.has(trigger.factId)) {
        throw new TransitionError('A triggers must identify an existing factId');
      }
    }
    return trigger;
  });
}

export function normalizeComponentScores(input, state, answer) {
  const matrix = input.componentScores ?? input.component_scores;
  assertObject(matrix, 'componentScores');
  const normalized = {};
  const details = {};
  for (const component of activeComponents(state)) {
    if (!Object.hasOwn(matrix, component.id)) throw new TransitionError('componentScores must include every active component');
    const score = scoreDetails(matrix[component.id], state.type, `componentScores.${component.id}`);
    const capped = capAgentScores(score.scores, answer);
    normalized[component.id] = capped;
    details[component.id] = { scores: capped, metadata: score.metadata };
  }
  return { scores: normalized, details };
}

export function validateActiveTriggers({ state, triggers, componentScores }) {
  const priorScored = state.rounds.filter((round) => round.lifecycle === 'scored');
  if (triggers.some((trigger) => trigger.status === 'active') && priorScored.length === 0) {
    throw new TransitionError('first-ever scored round cannot contain active triggers without prior scores');
  }
  const latest = priorScored.at(-1);
  for (const trigger of triggers) {
    if (trigger.status !== 'active') continue;
    const priorScores = latest?.componentScores?.[trigger.component];
    const nextScores = componentScores[trigger.component];
    if (!priorScores || !nextScores) throw new TransitionError('active trigger requires prior and new scores');
    if (nextScores[trigger.dimension] >= priorScores[trigger.dimension]) {
      throw new TransitionError('an active trigger must lower its affected dimension');
    }
    if (componentAmbiguity(state.type, nextScores) <= componentAmbiguity(state.type, priorScores)) {
      throw new TransitionError('an active trigger must raise component ambiguity');
    }
  }
}

function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function fieldSet(entity) {
  return new Set((Array.isArray(entity.fields) ? entity.fields : []).map((field) => lower(field)));
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / union.size;
}

export function ontologySnapshot(round, ontology, previousSnapshots) {
  const entities = Array.isArray(ontology) ? clone(ontology) : [];
  const previous = previousSnapshots.at(-1)?.entities ?? [];
  if (round === 1 || entities.length === 0) {
    return { round, entities, stable: 0, changed: 0, new: entities.length, removed: previous.length, ratio: null };
  }
  const matchedPrevious = new Set();
  let stable = 0;
  let changed = 0;
  let fresh = 0;
  for (const entity of entities) {
    const sameNameIndex = previous.findIndex((prior, index) => !matchedPrevious.has(index) && lower(prior.name) === lower(entity.name));
    if (sameNameIndex >= 0) {
      stable += 1;
      matchedPrevious.add(sameNameIndex);
      continue;
    }
    const changedIndex = previous.findIndex((prior, index) => (
      !matchedPrevious.has(index)
      && lower(prior.type) === lower(entity.type)
      && jaccard(fieldSet(prior), fieldSet(entity)) > 0.5
    ));
    if (changedIndex >= 0) {
      changed += 1;
      matchedPrevious.add(changedIndex);
      continue;
    }
    fresh += 1;
  }
  return {
    round,
    entities,
    stable,
    changed,
    new: fresh,
    removed: Math.max(0, previous.length - matchedPrevious.size),
    ratio: round2((stable + changed) / entities.length),
  };
}

export function panelPersonas() {
  return [...PANEL_PERSONAS];
}
