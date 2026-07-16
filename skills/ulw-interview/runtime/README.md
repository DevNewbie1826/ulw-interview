# ULW Interview runtime contract

This runtime is a deterministic JSON state machine. The caller owns language, questions, model dispatch, panel dispatch, and spec markdown; the runtime owns order, validation, scoring arithmetic, gates, and atomic spec persistence.

## CLI envelope

Run the CLI from any harness:

```bash
node "$RUNTIME_DIR/cli.mjs"
```

Input is one JSON object on stdin:

```json
{
  "state": null,
  "event": {
    "type": "initialize",
    "input": {
      "interviewId": "example-1",
      "type": "greenfield",
      "idea": "Clarify a report workflow.",
      "threshold": 0.05,
      "thresholdSource": "default",
      "language": { "user": "en" }
    }
  }
}
```

Success prints exactly one JSON object: `{ "state": nextState, "effects": [...] }`. Replace the previous state wholesale and execute effects in returned order. Invalid JSON, malformed state, invalid event order, or contract rejection exits non-zero, prints no success JSON, and writes the diagnostic to stderr.

## Effects

Effects are ordered instructions for the caller.

| Effect | Payload |
|---|---|
| `announce_threshold` | `threshold`, `thresholdSource` |
| `ask_topology` | no required payload |
| `open_round` | `round`, `target`, optional `softWarning`, optional `restateCorrection` |
| `ask_user` | `round`, `target`, `forcedUser`, optional `reask` |
| `refine_answer` | `round` |
| `run_lateral_panel` | `round?`, `reason:'pre-answer'|'milestone'`, `personas:['analyst','critic']`, `architectLens:boolean`, milestone may include `priorBand`, `band` |
| `score_answer` | `round` |
| `report_progress` | `round?`, `reported`, `floor`, `effective`, `band`, `bandChanged`, `clamped`, `stallDetected`, `escalation`, `weakest`, `triggerSummary` |
| `request_closure_audit` | `reason:'ready'|'hard-cap'|'early-exit'` |
| `request_restate` | `summary` |
| `write_spec` | no required payload |
| `persist_spec` | before CLI persistence: `directory`, `slug`, `markdown`, `status`; after CLI persistence: `path`, `sha256` |
| `stop` | `rounds`, `ambiguity`, `band`, `reason` |

## Events

### `initialize`

Input: `{ interviewId, type:'greenfield'|'brownfield', idea, threshold?, thresholdSource?, language? }`. Requires no prior state. Seeds version `2`, phase `topology`, threshold or `0.05`, threshold source or `default`, ambiguity `1.0`, and empty ledgers. Effects: `announce_threshold`, then `ask_topology`.

### `confirm_topology`

Input: `{ components:[{ id, name, description?, status:'active'|'deferred', deferralReason? }], confirmedAt }`. Required phase: `topology`. Requires 1..6 unique safe component ids and at least one active component. `confirmedAt` is host-supplied deterministic ISO text. Effects: `open_round` for round 1 targeting the first active component and `goal`.

### `open_round`

Input: `{ round, questionId?, roundId?, question, target }`. Required phase: `round`. Rejects if a round, panel, or refinement is already pending. `target` must exactly equal the runtime-selected target. Builds `pendingRound`; effect: `ask_user` with `forcedUser:true` when `autoAnswerStreak >= 3`.

### `submit_answer`

Input: `{ round, answer, needsRefinement?, replacesRound? }`, where `answer` is `{ kind:'user'|'agent', text, source?:'direct'|'refined'|'cited-confirmation'|'auto-research-accepted'|'agent', confidence?:'high'|'medium'|'low', uncertainty?:number|null, autoResearchUsed?:boolean }`. Required phase: `round`. Agent answers reject on forced-user rounds. Effects: `refine_answer` when `needsRefinement:true`; `run_lateral_panel` with `reason:'pre-answer'` and personas `analyst`,`critic` when `answer.kind:'agent'`; otherwise `score_answer`. `replacesRound` disputes prior facts for that round and reopens it.

### `refine_answer`

Input: `{ round, confirmed:true, structured:{ decision, reasoning?, constraints?, outOfScope?, codebaseContext? } }` or `{ round, confirmed:false }`. Required when `pendingRefinement` exists. Confirmed clears refinement and returns `score_answer`; unconfirmed returns `ask_user` with `reask:true`.

### `panel_completed`

Input: `{ findings:[{ persona:'analyst'|'critic', finding, rationale:string[], suggested_options:string[], confidence:'high'|'medium'|'low' }], failed?:boolean }`. Required when `pendingPanel` exists. Findings order must be analyst first, critic second. Records the review and returns the blocked effect: `score_answer`, `open_round`, or `request_closure_audit`.

### `record_score`

Input: `{ round, componentScores, triggers?, weakestComponentId?, weakestDimension?, weakestRationale?, ontology?, establishedFacts? }`. Required phase: `round` with an answered pending round and no pending refinement or panel. Every active component receives all required scores. Agent answers cap scores at `0.85` unless confidence is `high` and uncertainty is `0..0.05`. Active trigger invariants require a lower affected score; trigger `A` requires `factId`. Effects: `report_progress`, then exactly one continuation: `request_closure_audit`, `run_lateral_panel`, or `open_round` with optional `softWarning:true` at round 10.

### `record_fact`

Input: `{ fact:{ id, statement, component?, dimension?, evidence? } }`. Required phase: `round` or `closure`; no pending round work. Appends fact and fact event, recomputes floor/effective ambiguity, returns `report_progress` plus routing.

### `resolve_fact`

Input: `{ factId, action:'reconfirm' }` or `{ factId, action:'supersede', newFact:{ id, statement, component?, dimension?, evidence? } }`. Reconfirm clears dispute. Supersede links the old fact to `newFact.id` and appends the new fact. Returns `report_progress` plus routing.

### `request_closure`

Input: `{}`. Allowed only when `scoredRounds >= 3`, `softWarningShown`, or `hardCapReached`. Sets early exit and phase `closure`; effect: `request_closure_audit` with `reason:'early-exit'`.

### `audit_closure`

Input: `{ passed:boolean, overrideGap?, rationale? }`. Required phase: `closure`. Passing rejects when unresolved disputed facts exist, and requires effective ambiguity `<= threshold` unless `hardCapReached` or early exit applies. Passed effect: `request_restate`. Failed effect: `open_round` for the selected target, with optional closure override recorded.

### `confirm_restate`

Input: `{ confirmed:true, goal }` or `{ confirmed:false, correction }`. Required phase: `restate`. Confirmed sets `restatedGoal`, phase `write`, and effect `write_spec`. Corrections increment `restateLoops`; before two loops, effect `open_round` with `restateCorrection:true`; at two loops, return to the normal interview loop through `open_round`.

### `write_spec`

Input: `{ directory, slug, markdown, status:'PASSED'|'BELOW_THRESHOLD_EARLY_EXIT' }`. Required phase: `write`, after closure and restatement. Directory must be an existing absolute path, slug lowercase kebab-case max 64 chars, markdown max 50000 UTF-8 bytes. Reducer returns `persist_spec`; CLI writes atomically and returns `path`, `sha256`.

### `user_stop`

Input: `{}`. Any phase before `written`. Clears pending work, phase `stopped`; effect: `stop` with rounds, ambiguity, band, and reason.

## Scoring, limits, and determinism

- Greenfield weights: `{ goal: 0.40, constraints: 0.30, criteria: 0.30 }`.
- Brownfield weights: `{ goal: 0.35, constraints: 0.25, criteria: 0.25, context: 0.15 }`.
- Aggregation uses the minimum score across active components per dimension, then `reported = round2(1 - sum(weight[d] * overall[d]))`.
- Floor is `round2(min(1, 0.10*unresolvedDisputedFacts + 0.05*unscoredActiveComponents + 0.05*min(1, autoAnswered/max(scoredRounds,1))))`; effective ambiguity is `round2(max(reported, floor))`.
- Bands: `ready <= threshold`; `refined <= 0.30`; `progress <= 0.60`; otherwise `initial`.
- Limits: `MAX_COMPONENTS=6`, `SOFT_WARNING_ROUND=10`, `MAX_ROUNDS=100`, `MAX_STATE_BYTES=900000`, `MAX_STDIN_BYTES=1048576`, `MAX_DIRECTORY_BYTES=4096`, `MAX_MARKDOWN_BYTES=50000`.
- Safe ids: interview ids match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`; component ids match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`; slugs are lowercase kebab-case max 64 chars.
- Same state plus same event returns the same result, except caller-supplied fields like `confirmedAt` are deterministic inputs.

## Ownership and persistence

Caller owns user language, topology proposal text, question text, answer collection, model calls, analyst/critic panel dispatch, closure audit judgment, and the final markdown body. Runtime owns event order, phase checks, pending-work exclusivity, score validation, arithmetic, floor, target selection, fact ledgers, closure/restate gates, and state commits.

Facts are append-only; contradiction marks a fact disputed and resolution reconfirms or supersedes it. The CLI writes a spec only for `persist_spec`, inside the caller-approved existing absolute directory, through same-directory temp write, fsync, and no-replace publication. It writes no session store, config, timestamp, network call, or host-specific handoff.
