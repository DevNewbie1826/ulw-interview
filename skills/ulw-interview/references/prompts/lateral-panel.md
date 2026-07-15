# Lateral Review Panel

Panels are milestone-only, non-ready reframes. Convene one only when `transition.mjs` returns `dispatch_panel`. Each persona is a read-only `oracle` call with independent context. Closure, not a panel, is the final adversarial review.

## Eligible milestones

The scorer classifies progress bands, but the caller never interprets band changes, cooldowns, suppression, readiness, or the ceiling. The reducer applies those policies and returns either `dispatch_panel` or another single action. No panel runs on a numerically ready result.

## Personas

- **`researcher`** — surfaces external facts, prior art, and version/compatibility constraints the interview depends on.
- **`contrarian`** — challenges the core assumption: "What if the opposite were true? Is this constraint real or habitual?"
- **`simplifier`** — probes whether complexity can be removed: "What is the simplest version that is still valuable?"
- **`architect`** — checks system shape, ownership, and integration impact after scope change.

Dispatch each and only returned persona in `dispatch_panel.payload.personas`, in that order. Do not add, reorder, or retry a persona outside the returned list. Give each an independent copy of prompt-safe context, including the immutable full interview ID registry and all component ID ownership, transcript summary, current scores, semantic coverage, and locked topology. Ask for one concrete blind spot or unsettled decision, suggested options for the next question, and confidence.

## Acknowledgement protocol

1. After all requested calls are dispatched, emit `panel_dispatched`; acknowledge the returned `personas` list exactly.
2. Commit the reducer response. It updates `panelDispatchCount += personas.length` and returns `await_panel_results`.
3. Wait for every acknowledged persona. Do not ask or score while waiting.
4. Validate one `{persona,summary,options,confidence}` finding for each acknowledged persona in the same order as the acknowledged `personas` list. The `persona` must exactly equal that position's acknowledged persona. Then emit `panel_completed` with the complete ordered findings array.
5. Commit the returned `ask_target` action. Fold its findings into that one user-facing question.

No caller event may bypass or reverse this acknowledgement sequence. The reducer owns persona truncation, count updates, scope-change acknowledgement, and panel state.

## Folding findings

Use concrete findings as ranked answer options or one recommended draft for the returned target. The panel never mutates requirements, adds a second question, or marks the interview complete. Facts discovered by a persona remain facts; user decisions still go to the user.

## Stall reframe

When the scorer reports a stall and the reducer returns an ordinary `ask_target` rather than a panel, reframe the same target around the core decision: "What is the core thing here?" Do not invent a different target. If a panel is returned, let each returned persona apply its documented perspective, then fold the collected result into the reducer's next single question. Never assume a particular persona survived reducer truncation.

## Mid-panel cancellation

If the user says "stop" / "cancel" / "abort" while a panel is in flight, discard partial findings and emit `user_stop`. Commit the returned state and execute only its `write_spec` or `stop` action.
