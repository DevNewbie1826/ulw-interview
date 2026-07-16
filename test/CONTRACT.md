# ulw-interview Runtime Contract (Gajae Deep-Interview Port)

This file is the single source of truth for the runtime, prompt, and docs rewrites. Tests in this directory intentionally fail until the runtime and docs implement this contract.

## Constants

| Name | Value |
|---|---|
| `DEFAULT_THRESHOLD` | `0.05` |
| `DEFAULT_THRESHOLD_SOURCE` | `"default"` |
| `GREENFIELD_WEIGHTS` | `{ goal: 0.40, constraints: 0.30, criteria: 0.30 }` |
| `BROWNFIELD_WEIGHTS` | `{ goal: 0.35, constraints: 0.25, criteria: 0.25, context: 0.15 }` |
| `AGENT_SCORE_CAP` | `0.85` |
| `MAX_COMPONENTS` | `6` |
| `MAX_ROUNDS` | `100` |
| `SOFT_WARNING_ROUND` | `10` |
| `MAX_STATE_BYTES` | `900000` UTF-8 bytes |
| `MAX_STDIN_BYTES` | `1048576` UTF-8 bytes |
| `MAX_DIRECTORY_BYTES` | `4096` UTF-8 bytes |
| `MAX_MARKDOWN_BYTES` | `50000` UTF-8 bytes |
| `INTERVIEW_ID_PATTERN` | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` |
| `COMPONENT_ID_PATTERN` | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` |
| `SLUG_PATTERN` | lowercase kebab-case, max 64 chars |
| `ROUND_KEY_WITH_QUESTION` | `` `${interviewId}::r:${round}::q:${questionId}` `` |
| `ROUND_KEY_WITH_ID` | `` `${interviewId}::rid:${roundId}` `` |
| `round2` | `Math.round(value * 100) / 100` |
| `PANEL_PERSONAS` | `['analyst', 'critic']` in that order |
| `REQUIRED_GREENFIELD_DIMS` | `['goal', 'constraints', 'criteria']` |
| `REQUIRED_BROWNFIELD_DIMS` | `['goal', 'constraints', 'criteria', 'context']` |

## State fields

All state is JSON-serializable and validated before every non-`initialize` event and after every event. Initial values are for `initialize` with no optional fields except `language`.

| Field | Type | Initial value / invariant |
|---|---|---|
| `version` | integer | `2` |
| `phase` | `'topology'|'round'|'closure'|'restate'|'write'|'written'|'stopped'` | `'topology'` |
| `interviewId` | string | safe id from input |
| `type` | `'greenfield'|'brownfield'` | input |
| `idea` | non-empty string | input |
| `language` | optional JSON value | input when present |
| `threshold` | number `(0,1]` | input or `0.05` |
| `thresholdSource` | string | input or `'default'` |
| `initHash` | sha256 string | canonical hash of initialize-locked fields: `interviewId`, `type`, `threshold`, `thresholdSource`, `idea`, and `language` when present |
| `ambiguity` | number `[0,1]` | effective ambiguity, initially `1.0` |
| `reportedAmbiguity` | number `[0,1]` | scorer/math value before floor, initially `1.0` |
| `ambiguityFloor` | object | `{ floor:0, disputedFactCount:0, unscoredActiveComponentCount:0, autoAnswerRatio:0 }` |
| `band` | `'initial'|'progress'|'refined'|'ready'` | `'initial'` |
| `rounds` | round record array | `[]` |
| `facts` | fact array | `[]` or established facts from input normalized to append-only ledger |
| `factEvents` | fact event array | one `established` event per input fact, otherwise `[]` |
| `topologyStatus` | `'pending'|'confirmed'` | `'pending'` |
| `topology` | object | `{ status:'pending', components:[], deferrals:[], confirmedAt:null, lastTargetedComponentId:null }` |
| `topologyHash` | sha256 string or `null` | `null` until confirmation, then canonical hash of locked topology component ids/names/status/deferrals; excludes mutable clarity scores |
| `pendingRound` | object or `null` | `null`; mutually exclusive with `pendingPanel` and `pendingRefinement` |
| `pendingPanel` | object or `null` | `null`; mutually exclusive with `pendingRound` except when blocking its answer/continuation |
| `pendingRefinement` | object or `null` | `null`; mutually exclusive with `pendingPanel` |
| `pendingThresholdCrossingConfirmation` | boolean | `false`; runtime-owned flag set only when an agent-scored answer crosses effective ambiguity from above threshold to ready and cleared by confirmed closure, a later above-threshold score, or a subsequent user-scored answer |
| `autoAnswerStreak` | non-negative integer | `0` |
| `autoResearchedRounds` | number array | `[]` |
| `autoAnsweredRounds` | number array | `[]` |
| `refinedRounds` | number array | `[]` |
| `lateralReviews` | review array | `[]` |
| `lateralPanelFailures` | non-negative integer | `0` |
| `ontologySnapshots` | snapshot array | `[]` |
| `closureOverrides` | object array | `[]` |
| `restateLoops` | non-negative integer | `0` |
| `closurePassed` | boolean | `false` |
| `restatementConfirmed` | boolean | `false` |
| `restatedGoal` | string or `null` | `null` |
| `softWarningShown` | boolean | `false` |
| `hardCapReached` | boolean | `false` |
| `earlyExitRequested` | boolean | `false` |

### Topology component

`{ id, name, description?, status, deferralReason?, clarity }` where `status` is `active` or `deferred`. Active components participate in scoring. Deferred components stay visible in state/spec and are excluded from ambiguity math. `clarity` stores per-component dimension scores; an active component is scored when every greenfield core dimension `goal/constraints/criteria` is finite. Brownfield also stores `context`.

### Round record

Required fields after scoring: `round`, `roundKey`, `questionId?`, `question`, `questionHash`, `target`, `answer`, `lifecycle:'scored'`, `componentScores`, `reportedAmbiguity`, `ambiguityFloor`, `ambiguity`, `band`, `triggers`, `ontologySnapshot?`, `weakest`. Pending rounds use `pendingRound` with `round`, `roundKey`, `questionId`, `question`, `questionHash`, `target`, `forcedUser`.

### Fact record

`{ id, statement, round?, component?, dimension?, evidence?, disputed:boolean, superseded_by? }`. Facts are append-only. Contradicted facts are never deleted; they become `disputed:true` until reconfirmed or superseded.

### Fact events

- `established`: `{ type:'established', factId, fact, round? }`
- `disputed`: `{ type:'disputed', factId, round, reason, trigger? }`
- `resolved`: `{ type:'resolved', factId, action:'reconfirm'|'supersede', newFactId? }`

## Effects

Effects are returned in exact order. The host owns rendering, model calls, and filesystem persistence except for CLI materialization of `persist_spec`.

| Effect | Payload fields |
|---|---|
| `announce_threshold` | `threshold`, `thresholdSource` |
| `ask_topology` | no required payload |
| `open_round` | `round`, `target`, optional `softWarning`, optional `restateCorrection` |
| `ask_user` | `round`, `target`, `forcedUser`, optional `reask` |
| `refine_answer` | `round` |
| `run_lateral_panel` | `round?`, `reason:'pre-answer'|'milestone'`, `personas:['analyst','critic']`, `architectLens:boolean`, milestone payload may include `priorBand`, `band` |
| `score_answer` | `round` |
| `report_progress` | `round?`, `reported`, `floor`, `effective`, `band`, `bandChanged`, `clamped`, `stallDetected`, `escalation`, `weakest`, `triggerSummary` |
| `request_closure_audit` | `reason:'ready'|'hard-cap'|'early-exit'`, optional `thresholdCrossingConfirmation:true` |
| `request_restate` | `summary` |
| `write_spec` | no required payload |
| `persist_spec` | `directory`, `slug`, `markdown`, `status` before CLI; CLI result is `path`, `sha256` |
| `stop` | `rounds`, `ambiguity`, `band`, `reason` |

## Events

### `initialize`

Input: `{ interviewId, type:'greenfield'|'brownfield', idea, threshold?, thresholdSource?, language? }`. Requires no prior state. Validates `0 < threshold <= 1`. Seeds all state fields above. Effects: `announce_threshold`, then `ask_topology`.

### `confirm_topology`

Input: `{ components:[{ id, name, description?, status:'active'|'deferred', deferralReason? }], confirmedAt }`. Required phase: `topology`. `confirmedAt` must be host-supplied ISO text for deterministic replay; the runtime must not mint time by itself. Requires 1..6 components, safe unique ids, and at least one active component. Deferred components should include a deferral reason. Sets topology status/confirmed timestamp. Effects: `open_round` for round 1 targeting the first active component in sorted target-selection order and `goal`; `topology.lastTargetedComponentId` records that selected component.

### `open_round`

Input: `{ round, questionId?, roundId?, question, target }`. Required phase: `round`. Rejects if any round/panel/refinement is pending. `target` must exactly equal the runtime-selected current target. `round` must equal the next expected round number, except restate-correction rounds use the current correction number. Builds `pendingRound`; `forcedUser` is true when `autoAnswerStreak >= 3`. Effect: `ask_user`.

### `submit_answer`

Input: `{ round, answer, needsRefinement?, replacesRound? }`. `answer` is `{ kind:'user'|'agent', text, source?:'direct'|'refined'|'cited-confirmation'|'auto-research-accepted'|'agent', confidence?:'high'|'medium'|'low', uncertainty?:number|null, autoResearchUsed?:boolean }`. Required phase: `round`; round must match `pendingRound.round` unless using `replacesRound`. Agent answers are rejected on forced-user rounds.

If `needsRefinement:true`, set `pendingRefinement` and return `refine_answer`; scoring is rejected until refinement resolves. If `answer.kind:'agent'`, set `pendingPanel` and return `run_lateral_panel` with reason `pre-answer`, personas `analyst/critic`; scoring is rejected until `panel_completed`. If `answer.kind:'user'`, return `score_answer`.

`replacesRound` is allowed only when the prior round is scored. It disputes every fact with `fact.round === replacesRound && !superseded_by`, appends disputed fact events, recomputes the floor immediately, and reopens that round number.

Streak bookkeeping: `source` in `auto-research-accepted|agent` or `autoResearchUsed:true` increments `autoAnswerStreak`; direct/refined/cited-confirmation resets it. `auto-research-accepted` records `autoResearchedRounds`; `agent` records `autoAnsweredRounds`; refined records `refinedRounds`.

### `refine_answer`

Input: `{ round, confirmed:true, structured:{ decision, reasoning?, constraints?, outOfScope?, codebaseContext? } }` or `{ round, confirmed:false }`. Required when `pendingRefinement` exists. Confirmed true clears pending refinement, replaces scored answer text with the structured interpretation, and returns `score_answer`. Confirmed false keeps the round unresolved and returns `ask_user` with `reask:true`.

### `panel_completed`

Input: `{ findings:[{ persona:'analyst'|'critic', finding, rationale:string[], suggested_options:string[], confidence:'high'|'medium'|'low' }], failed?:boolean }`. Required when `pendingPanel` exists. Findings order must exactly match the dispatched order: analyst first, critic second. `failed:true` also resolves the panel and increments `lateralPanelFailures`. Records a lateral review. Returns the blocked effect: `score_answer` for pre-answer panels; `open_round` or `request_closure_audit` for milestone panels.

### `record_score`

Input: `{ round, componentScores, triggers?, weakestComponentId?, weakestDimension?, weakestRationale?, ontology?, establishedFacts? }`. Required phase: `round` with an answered pending round and no pending refinement/panel.

Rules:

1. Every score is finite in `[0,1]`.
2. Every active component receives all required scores every scored round.
3. Agent-cap: if `answer.kind === 'agent'`, cap every score at `0.85` unless `confidence === 'high'` and `uncertainty` is a number in `[0,0.05]`.
4. Active trigger invariants: affected component/dimension exists and is active; first scored round cannot have active triggers; otherwise the new score for the affected dimension is strictly lower than the latest prior scored score and that component's ambiguity rises.
5. Trigger kind `A` requires `factId` referencing an existing fact and disputes that fact.
6. Trigger status `disputed` or `unresolved` requires non-empty rationale and is exempt from active invariants.
7. Aggregation uses the minimum score across active components for each required dimension, then `reported = round2(1 - sum(weight[d] * overall[d]))`.
8. Floor: `floor = round2(min(1, 0.10*unresolvedDisputedFacts + 0.05*unscoredActiveComponents + 0.05*min(1, autoAnswered/max(scoredRounds,1))))` after committing this score.
9. Effective ambiguity is `max(reported, floor)` via a gajae-verbatim clamp (no rounding inside the clamp; both operands are already round2 in-flow, so effective stays 2-decimal in practice). Store `reportedAmbiguity`, full `ambiguityFloor`, and `ambiguity`.
10. If clamped, the scored round stores both `reported_ambiguity` and `ambiguity_floor`.
11. Component clarity persists to topology components.
12. Band: `ready <= threshold`; `refined <= 0.30`; `progress <= 0.60`; otherwise `initial`. `bandChanged` detects either direction.
13. Stall: most recent three scored effective ambiguities have `max-min <= 0.05`.
14. Escalation is `ontology` on stall or when `scoredRounds >= 8 && effective > 0.30`.
15. Ontology snapshot: round 1 or zero entities gives `ratio:null`; stable uses same name case-insensitive; changed uses same type and field-name Jaccard strictly greater than `0.5`; new/removed otherwise; ratio is `round2((stable+changed)/totalCurrentEntities)`.
16. Weakest next target: active component with highest per-component ambiguity. If exactly one active component has the highest ambiguity, select it. If multiple active components tie for the highest ambiguity, sort only those tied component ids ascending and select the id after `topology.lastTargetedComponentId`, wrapping to the first tied id when the last target is absent, last, or outside the tied set. Within the selected component, choose the lowest scored required dimension, tie declared dimension order.
17. `establishedFacts` are appended to facts and factEvents with source round.

Agent threshold crossing gate: when `answer.kind === 'agent'`, the prior effective ambiguity was above `threshold` (initially seeded as `1.0`), and the new effective ambiguity is `<= threshold`, set `pendingThresholdCrossingConfirmation:true` and include `thresholdCrossingConfirmation:true` on the `request_closure_audit` effect. User-kind answers never set this flag; a subsequent user-scored answer or any later score above threshold clears it.

Effects: first `report_progress`, then exactly one continuation: hard cap requests closure audit; ready requests closure audit; band changes run the lateral panel; otherwise open the next round. On the 10th scored round that does not close, set `softWarningShown` and include `softWarning:true` in `open_round`.

### `record_fact`

Input: `{ fact:{ id, statement, component?, dimension?, evidence? } }`. Required phase: `round` or `closure`; no pending work in round phase. Appends the fact and event, recomputes floor/effective, returns `report_progress` and the next routing effect.

### `resolve_fact`

Input: `{ factId, action:'reconfirm' }` or `{ factId, action:'supersede', newFact:{ id, statement, component?, dimension?, evidence? } }`. Reconfirm sets `disputed:false`. Supersede sets `old.superseded_by = newFact.id` and appends the new fact. Both append fact events, recompute floor/effective, and return `report_progress` plus routing.

### `request_closure`

Input: `{}`. Allowed only when `scoredRounds >= 3` or `softWarningShown` or `hardCapReached`; otherwise reject. Sets `earlyExitRequested:true`, phase `closure`, effect `request_closure_audit` with reason `early-exit`.

### `audit_closure`

Input: `{ passed:boolean, overrideGap?, rationale?, userConfirmedCrossing? }`. Required phase: `closure`. Passing is rejected when unresolved disputed facts exist. Passing also requires `effective <= threshold` or `hardCapReached` or `earlyExitRequested`. While `pendingThresholdCrossingConfirmation:true`, passing is rejected unless `userConfirmedCrossing === true`; confirmed passing clears the flag. Failed audits do not require crossing confirmation and still use the override path. If passed, set `closurePassed:true`, phase `restate`, effect `request_restate`. If failed, record `overrideGap` in `closureOverrides` when supplied, phase `round`, effect `open_round` for the current runtime-selected target.

### `confirm_restate`

Input: `{ confirmed:true, goal }` or `{ confirmed:false, correction }`. Required phase: `restate`. Confirmed true sets `restatementConfirmed:true`, `restatedGoal`, phase `write`, effect `write_spec`. Confirmed false increments `restateLoops`; if loops reach 2, phase `round` and effect `open_round`; otherwise effect `open_round` with `restateCorrection:true` and the correction becomes a normal scored round before closure repeats.

### `write_spec`

Input: `{ directory, slug, markdown, status:'PASSED'|'BELOW_THRESHOLD_EARLY_EXIT' }`. Required phase: `write` and requires `closurePassed && restatementConfirmed`. Directory must be an existing absolute path, <=4096 bytes; slug lowercase kebab <=64; markdown <=50000 bytes. Reducer returns `persist_spec` and phase `written`. CLI writes atomically by temp file, fsync, hard-link no-replace, and returns `path` plus `sha256`.

### `user_stop`

Input: `{}`. Any phase before `written`. Clears pending work, phase `stopped`, effect `stop` with rounds, ambiguity, band, and reason.

## Global rejection rules

- Unknown event names reject.
- Wrong phase rejects.
- Malformed input, missing required fields, out-of-range scores, duplicate ids, and unknown component/fact ids reject.
- Caller-mutated derived fields (`ambiguity`, `reportedAmbiguity`, `ambiguityFloor`, `band`, streaks, selected targets, hashes) inconsistent with replay reject.
- Exactly one pending thing may exist: round XOR panel XOR refinement. A panel may block the continuation of a round, but scoring is still rejected while it is pending.
- State serialized size must be <=900000 bytes; CLI stdin <=1048576 bytes.
- Initialize-locked fields (`interviewId`, `type`, `threshold`, `thresholdSource`, `idea`, `language`) are immutable after `initialize`; their canonical `initHash` is verified before and after every event.
- Confirmed topology identity is immutable after `confirm_topology`; `topologyHash` is verified before and after every event, while clarity scores may still change through scoring.
- Scored rounds are immutable except through the replacement path: stored `questionHash`, `answerHash`, and `scoringHash` must match the stored question/answer/scoring content, and scored component ids must match active topology ids.
- Pending round `target` and `forcedUser` are derived from topology, rounds, and trailing auto-answer streak; caller mutation rejects before answer submission.
- Facts are append-only; deletion or mutation without an event rejects. The `factEvents` ledger is replayed (`established`/`disputed`/`resolved`) and must reproduce the stored `facts` projection exactly.
- `initialize` validates safe `interviewId`, enum `type`, non-empty `idea`, numeric `threshold` in `(0,1]`, non-empty string `thresholdSource`, and JSON `language` when present.
- `record_score` ontology input rejects duplicate entity names case-insensitively and rejects entities with empty `name`, `type`, or `fields`; `relationships` may be an empty array.
- Legacy topology-array states reject; runtime states must use the canonical topology object form.
- Same state plus same event returns the same result, except externally supplied `confirmedAt` is treated as deterministic input.

## Prompt and docs contract

- `skills/ulw-interview/` contains exactly one frontmatter public file: `SKILL.md`.
- Private fragments do not carry skill frontmatter.
- `scoring.md` documents min-per-dimension aggregation and the exact greenfield/brownfield weights.
- `spec-template.md` contains these headings: Metadata, Clarity Breakdown, Topology, Established Facts, Trigger Metadata, Lateral Review Panel, Goal, Constraints, Non-Goals, Acceptance Criteria, Deferrals, Assumptions Exposed & Resolved, Technical Context, Ontology, Ontology Convergence, Interview Transcript.
- `plain-language.md` exists and includes Korean glossary entries for `애매함 점수`, `큰 덩어리`, and `핵심 개념`.
- `SKILL.md` names `metis` and `momus` as dispatch targets for the analyst/critic panel and contains no alternate bypass path wording.

## Open decisions

None.
