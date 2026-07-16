import { TransitionError, assertObject } from './state.mjs';
import { assertRuntimeState } from './state-validation.mjs';
import { confirmTopology, initialize, openRound, panelCompleted, refineAnswer, submitAnswer } from './runtime-rounds.mjs';
import { recordScore } from './runtime-scoring.mjs';
import { auditClosure, confirmRestate, recordFact, requestClosure, resolveFact, userStop, writeSpec } from './runtime-finalization.mjs';

export { RuntimeContractError, StateValidationError, TransitionError } from './state.mjs';

const HANDLERS = Object.freeze({
  initialize: (state, input) => {
    if (state !== null) throw new TransitionError('initialize requires a null state');
    return initialize(input);
  },
  confirm_topology: confirmTopology,
  open_round: openRound,
  submit_answer: submitAnswer,
  refine_answer: refineAnswer,
  panel_completed: panelCompleted,
  record_score: recordScore,
  record_fact: recordFact,
  resolve_fact: resolveFact,
  request_closure: requestClosure,
  audit_closure: auditClosure,
  confirm_restate: confirmRestate,
  write_spec: writeSpec,
  user_stop: userStop,
});

export function reduce(state, event) {
  assertObject(event, 'event');
  if (typeof event.type !== 'string' || !Object.hasOwn(HANDLERS, event.type)) {
    throw new TransitionError(`unsupported event: ${String(event.type)}`);
  }
  const checkedState = event.type === 'initialize' ? state : assertRuntimeState(state);
  const result = HANDLERS[event.type](checkedState, event.input ?? {});
  return { state: assertRuntimeState(result.state), effects: result.effects };
}

export const transition = reduce;
