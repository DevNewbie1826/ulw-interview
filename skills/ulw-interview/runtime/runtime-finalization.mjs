import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { appendEstablishedFact, isUnresolvedDisputed, resolveFactLedger } from './fact-ledger.mjs';
import {
  MAX_DIRECTORY_BYTES,
  MAX_MARKDOWN_BYTES,
  SLUG_PATTERN,
  TransitionError,
  assertNonEmptyString,
  assertObject,
  byteLength,
  clone,
} from './state.mjs';
import { assertPhase, closureAuditReason, copyState, effect, hasPendingWork, openRoundEffect, progressEffect, scoredRounds, withMetrics } from './transition-support.mjs';

function assertFactMutationAvailable(state, eventType) {
  if (!['round', 'closure'].includes(state.phase)) throw new TransitionError(`${eventType} is only available during round or closure`);
  if (state.phase === 'round' && hasPendingWork(state)) throw new TransitionError(`${eventType} requires no pending work`);
}

function routeAfterMutation(previous, measured) {
  const progress = progressEffect({
    state: measured,
    bandChanged: previous.band !== measured.band,
    clamped: measured.ambiguityFloor.floor > measured.reportedAmbiguity,
    weakest: measured.phase === 'round' ? openRoundEffect(measured).target : null,
  });
  if (previous.phase === 'closure') {
    return { state: measured, effects: [progress, effect('request_closure_audit', { reason: closureAuditReason(measured) })] };
  }
  if (measured.ambiguity <= measured.threshold) {
    const closed = copyState(measured, { phase: 'closure' });
    return { state: closed, effects: [progress, effect('request_closure_audit', { reason: 'ready' })] };
  }
  if (measured.allDimensionsClear === true) {
    const closed = copyState(measured, { phase: 'closure' });
    return { state: closed, effects: [progress, effect('request_closure_audit', { reason: 'all-clear' })] };
  }
  return { state: measured, effects: [progress, openRoundEffect(measured)] };
}

export function recordFact(state, input) {
  assertFactMutationAvailable(state, 'record_fact');
  assertObject(input, 'record_fact input');
  assertObject(input.fact, 'fact');
  const appended = appendEstablishedFact(state, input.fact, input.fact.round);
  const measured = withMetrics(copyState(state, { facts: appended.facts, factEvents: appended.factEvents }));
  return routeAfterMutation(state, measured);
}

export function resolveFact(state, input) {
  assertFactMutationAvailable(state, 'resolve_fact');
  assertObject(input, 'resolve_fact input');
  assertNonEmptyString(input.factId, 'factId');
  const resolved = resolveFactLedger(state, input);
  const measured = withMetrics(copyState(state, { facts: resolved.facts, factEvents: resolved.factEvents }));
  return routeAfterMutation(state, measured);
}

export function requestClosure(state, input) {
  assertObject(input, 'request_closure input');
  const count = scoredRounds(state).length;
  if (count < 3 && !state.softWarningShown && !state.hardCapReached) {
    throw new TransitionError('min-rounds no-bypass: requires scoredRounds>=3 or softWarningShown or hardCapReached');
  }
  if (state.phase !== 'round') throw new TransitionError('request_closure wrong phase: expected round');
  if (hasPendingWork(state)) throw new TransitionError('request_closure requires no pending work');
  return {
    state: copyState(state, { phase: 'closure', earlyExitRequested: true }),
    effects: [effect('request_closure_audit', { reason: 'early-exit' })],
  };
}

export function auditClosure(state, input) {
  assertPhase(state, 'closure', 'audit_closure');
  if (hasPendingWork(state)) throw new TransitionError('audit_closure requires no pending work');
  assertObject(input, 'audit_closure input');
  if (input.passed === true) {
    if (state.facts.some(isUnresolvedDisputed)) throw new TransitionError('closure pass rejected with unresolved disputed facts');
    if (state.ambiguity > state.threshold && !state.hardCapReached && !state.earlyExitRequested && state.allDimensionsClear !== true) {
      throw new TransitionError('closure pass requires threshold, hardCap, or earlyExit');
    }
    if (state.pendingThresholdCrossingConfirmation && input.userConfirmedCrossing !== true) {
      throw new TransitionError('threshold crossing requires userConfirmedCrossing true before closure can pass');
    }
    return {
      state: copyState(state, { closurePassed: true, phase: 'restate', pendingThresholdCrossingConfirmation: false }),
      effects: [effect('request_restate', { summary: { rounds: scoredRounds(state).length, ambiguity: state.ambiguity, band: state.band } })],
    };
  }
  const override = input.overrideGap === undefined ? null : { overrideGap: clone(input.overrideGap), ...(input.rationale === undefined ? {} : { rationale: input.rationale }) };
  const next = copyState(state, {
    phase: 'round',
    closureOverrides: override === null ? state.closureOverrides : [...state.closureOverrides, override],
    closurePassed: false,
  });
  return { state: next, effects: [openRoundEffect(next)] };
}

export function confirmRestate(state, input) {
  assertPhase(state, 'restate', 'confirm_restate');
  assertObject(input, 'confirm_restate input');
  if (input.confirmed === true) {
    assertNonEmptyString(input.goal, 'goal');
    return {
      state: copyState(state, { restatementConfirmed: true, restatedGoal: input.goal, phase: 'write' }),
      effects: [effect('write_spec')],
    };
  }
  if (input.confirmed !== false) throw new TransitionError('confirm_restate requires confirmed true or false');
  assertNonEmptyString(input.correction, 'correction');
  const loops = state.restateLoops + 1;
  const next = copyState(state, { phase: 'round', restateLoops: loops, closurePassed: false, restatementConfirmed: false });
  return { state: next, effects: [openRoundEffect(next, loops >= 2 ? {} : { restateCorrection: true })] };
}

export function writeSpec(state, input) {
  assertPhase(state, 'write', 'write_spec');
  if (!state.closurePassed || !state.restatementConfirmed) {
    throw new TransitionError('write phases require closurePassed and restatementConfirmed');
  }
  assertObject(input, 'write_spec input');
  assertNonEmptyString(input.directory, 'directory');
  if (!isAbsolute(input.directory)) throw new TransitionError('directory must be absolute');
  if (byteLength(input.directory) > MAX_DIRECTORY_BYTES) throw new TransitionError(`directory exceeds ${MAX_DIRECTORY_BYTES} bytes`);
  if (!existsSync(input.directory) || !lstatSync(input.directory).isDirectory() || lstatSync(input.directory).isSymbolicLink()) {
    throw new TransitionError('directory must be an existing directory');
  }
  if (typeof input.slug !== 'string' || input.slug.length > 64 || !SLUG_PATTERN.test(input.slug)) {
    throw new TransitionError('slug must be lowercase kebab-case and at most 64 characters');
  }
  if (typeof input.markdown !== 'string') throw new TransitionError('markdown must be a string');
  if (byteLength(input.markdown) > MAX_MARKDOWN_BYTES) throw new TransitionError(`markdown exceeds ${MAX_MARKDOWN_BYTES} bytes`);
  if (input.status !== 'PASSED' && input.status !== 'BELOW_THRESHOLD_EARLY_EXIT') {
    throw new TransitionError('status must be PASSED or BELOW_THRESHOLD_EARLY_EXIT');
  }
  return {
    state: copyState(state, { phase: 'written' }),
    effects: [effect('persist_spec', { directory: input.directory, slug: input.slug, markdown: input.markdown, status: input.status })],
  };
}

export function userStop(state, input) {
  assertObject(input, 'user_stop input');
  if (state.phase === 'written') throw new TransitionError('user_stop is unavailable after written');
  return {
    state: copyState(state, { phase: 'stopped', pendingRound: null, pendingPanel: null, pendingRefinement: null }),
    effects: [effect('stop', {
      rounds: scoredRounds(state).length,
      ambiguity: state.ambiguity,
      band: state.band,
      reason: 'user_requested',
    })],
  };
}
