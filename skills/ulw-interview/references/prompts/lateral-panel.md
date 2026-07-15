# Lateral Review Panel

Panels are milestone-only, non-ready reframes. Convene one only when `transition.mjs` returns `dispatch_panel`. Each persona is a read-only `oracle` call with independent context. Closure, not a panel, is the final adversarial review.

## Eligible milestones

The scorer classifies progress bands, but the caller never interprets band changes, cooldowns, suppression, readiness, or the ceiling. The reducer applies those policies and returns either `dispatch_panel` or another single action. No panel runs on a numerically ready result.

## Personas

- **`researcher`** — surfaces external facts, prior art, and version/compatibility constraints the interview depends on.
- **`contrarian`** — challenges the core assumption: "What if the opposite were true? Is this constraint real or habitual?"
- **`simplifier`** — probes whether complexity can be removed: "What is the simplest version that is still valuable?"
- **`architect`** — checks system shape, ownership, and integration impact after scope change.

Launch each and only returned persona in `dispatch_panel.payload.personas` concurrently in a single parallel dispatch batch. Do not await one persona before launching the next. Do not add, reorder, or retry a persona outside the returned list. Give each call an independent copy of context, with no persona's prompt or mutable response shared with another. That context includes the immutable full interview ID registry and all component ID ownership, transcript summary, current scores, semantic coverage, and locked topology. Ask for one concrete blind spot or unsettled decision, suggested options for the next question, and confidence.

## Acknowledgement protocol

1. Attempt the single parallel dispatch batch. If any launch fails before all calls are launched, do not emit `panel_dispatched`; emit `panel_failed` with reason `dispatch_error` directly from `awaiting_dispatch`. The reducer atomically records the full intended persona batch as consumed, clears panel state, and returns the pending target.
2. After all requested calls launch successfully, emit `panel_dispatched`; acknowledge the returned `personas` list exactly.
3. Commit the reducer response. It records the full persona batch, updates `panelDispatchCount += personas.length`, and returns `await_panel_results`.
4. Treat `await_panel_results` as an all-results barrier. Wait for every acknowledged persona until each tool call reaches its configured 120-second result timeout. Do not ask, score, or emit partial completion while waiting.
5. Validate one `{persona,summary,options,confidence}` finding for each acknowledged persona in the same order as the acknowledged list. Arrival order is irrelevant: reassemble findings in reducer-returned persona order. The `persona` must exactly equal that position's acknowledged persona. Only after every result passes validation, emit `panel_completed` with the complete ordered findings array.
6. If an acknowledged call times out or returns an invalid result, emit `panel_failed` with reason `timeout` or `invalid_result` and discard all partial findings. Failed batches remain counted and the dispatch count is not rolled back. Commit the returned `ask_target` for the pending target; it has no findings and still produces exactly one user-facing question.
7. Otherwise commit the `ask_target` returned by `panel_completed` and fold its findings into that one user-facing question.

No caller event may bypass or reverse this acknowledgement sequence. The reducer owns persona truncation, count updates, scope-change acknowledgement, panel failure recovery, and panel state.

For persona latencies `L_i`, serial critical-path time is `sum(L_i)` and parallel critical-path time is `max(L_i)`. Exact critical-path savings are `sum(L_i) - max(L_i)`; the persona call count remains unchanged.

## Folding findings

Use concrete findings as ranked answer options or one recommended draft for the returned target. The panel never mutates requirements, adds a second question, or marks the interview complete. Facts discovered by a persona remain facts; user decisions still go to the user.

## Stall reframe

When the scorer reports a stall and the reducer returns an ordinary `ask_target` rather than a panel, reframe the same target around the core decision: "What is the core thing here?" Do not invent a different target. If a panel is returned, let each returned persona apply its documented perspective, then fold the collected result into the reducer's next single question. Never assume a particular persona survived reducer truncation.

## Mid-panel cancellation

If the user says "stop" / "cancel" / "abort" while a panel is in flight, discard partial findings and emit `user_stop`. Commit the returned state and execute only its `write_spec` or `stop` action.
