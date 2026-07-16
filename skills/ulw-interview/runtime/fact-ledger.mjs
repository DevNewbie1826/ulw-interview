import { TransitionError, assertSafeId, clone, normalizeFact } from './state.mjs';

export function isUnresolvedDisputed(fact) {
  return fact.disputed === true && (typeof fact.superseded_by !== 'string' || fact.superseded_by.trim() === '');
}

export function findFact(state, factId) {
  const fact = state.facts.find((candidate) => candidate.id === factId);
  if (!fact) throw new TransitionError('unknown fact id');
  return fact;
}

export function assertUniqueFactId(state, factId) {
  assertSafeId(factId, 'fact.id');
  if (state.facts.some((fact) => fact.id === factId)) throw new TransitionError('fact id already exists');
}

export function appendEstablishedFact(state, rawFact, round = undefined) {
  const fact = normalizeFact(rawFact, round === undefined ? {} : { round });
  assertUniqueFactId(state, fact.id);
  return {
    facts: [...state.facts, fact],
    factEvents: [...state.factEvents, { type: 'established', factId: fact.id, fact: clone(fact), ...(round === undefined ? {} : { round }) }],
  };
}

export function appendEstablishedFacts(state, rawFacts, round) {
  let facts = state.facts;
  let factEvents = state.factEvents;
  for (const rawFact of rawFacts ?? []) {
    const working = { ...state, facts, factEvents };
    const appended = appendEstablishedFact(working, rawFact, round);
    facts = appended.facts;
    factEvents = appended.factEvents;
  }
  return { facts, factEvents };
}

export function disputeFacts(state, factIds, round, reason, trigger = undefined) {
  const ids = [...new Set(factIds)];
  const facts = state.facts.map((fact) => {
    if (!ids.includes(fact.id) || fact.disputed === true) return fact;
    if (typeof fact.superseded_by === 'string' && fact.superseded_by.trim() !== '') return fact;
    return { ...fact, disputed: true };
  });
  const factEvents = [...state.factEvents];
  for (const factId of ids) {
    const original = state.facts.find((fact) => fact.id === factId);
    if (!original) throw new TransitionError('unknown fact id');
    if (original.disputed === true || (typeof original.superseded_by === 'string' && original.superseded_by.trim() !== '')) continue;
    factEvents.push({
      type: 'disputed',
      factId,
      round,
      reason,
      ...(trigger === undefined ? {} : { trigger: clone(trigger) }),
    });
  }
  return { facts, factEvents };
}

export function resolveFactLedger(state, input) {
  const fact = findFact(state, input.factId);
  if (!isUnresolvedDisputed(fact)) throw new TransitionError('fact is not unresolved disputed');
  if (input.action === 'reconfirm') {
    return {
      facts: state.facts.map((candidate) => candidate.id === fact.id ? { ...candidate, disputed: false } : candidate),
      factEvents: [...state.factEvents, { type: 'resolved', factId: fact.id, action: 'reconfirm' }],
    };
  }
  if (input.action === 'supersede') {
    const newFact = normalizeFact(input.newFact);
    assertUniqueFactId(state, newFact.id);
    return {
      facts: [
        ...state.facts.map((candidate) => candidate.id === fact.id ? { ...candidate, superseded_by: newFact.id } : candidate),
        newFact,
      ],
      factEvents: [
        ...state.factEvents,
        { type: 'resolved', factId: fact.id, action: 'supersede', newFactId: newFact.id },
        { type: 'established', factId: newFact.id, fact: clone(newFact) },
      ],
    };
  }
  throw new TransitionError('resolve_fact action must be reconfirm or supersede');
}
