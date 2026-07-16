# ULW Interview Runtime

The runtime is the deterministic contract layer for `ulw-interview`. It validates Oracle output, computes ambiguity, gates refinement, records facts, and reduces lifecycle events to one legal action. It uses vanilla Node.js ES modules and no external dependencies.

## Files

| File | Purpose |
|---|---|
| `validate.mjs` | Validates and normalizes Oracle scores, semantic coverage, provenance, supersession, and acceptance evidence. |
| `scorer.mjs` | Computes per-component and global ambiguity, readiness, bands, panel signals, numeric gaps, and the deterministic numerical target. |
| `refineGate.mjs` | Decides whether a clamped, low-progress numerical answer receives a refinement pass. |
| `factsLedger.mjs` | Maintains the per-interview append-only facts event log and its lock. |
| `transition.mjs` | Pure reducer and CLI adapter for legal lifecycle transitions, state commits, policy precedence, and actions. |
| `test.mjs` | Legacy validation, scorer, refinement, ledger, and pipeline regression suite. |
| `facts-ledger.test.mjs` | Lock ownership, controlled-failure cleanup, recovery, and manual ledger scenarios. |
| `intent-contract.test.mjs` | Semantic coverage, provenance, supersession, and evidence-link contract scenarios. |
| `scorer-contract.test.mjs` | Exact weight, MAX gating, determinism, and panel-signal scenarios. |
| `transition.test.mjs` | Transition matrix, schema, immutability, determinism, policy, and end-to-end lifecycle scenarios. |
| `docs-contract.test.mjs` | Public documentation, instruction, prompt, template, and package-entrypoint integration checks. |
| `README.md` | This runtime reference. |

All JSON runtimes read stdin and write stdout. `scorer.mjs`, `validate.mjs`, `refineGate.mjs`, and `transition.mjs` do not persist state. `factsLedger.mjs` is the only runtime here that writes project state.

## Lifecycle Contract

`transition.mjs` is the sole authoritative lifecycle contract. Its normal order is `TOPOLOGY -> BASELINE -> ROUND -> CLOSURE -> RESTATE -> WRITE -> DONE`; early or rejected paths end in `INCOMPLETE` or `STOPPED`.

The caller-supplied `interviewId` must match `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. A successful `spec_written` event accepts only `.omo/specs/ulw-interview-{slug}.md`, with a lowercase alphanumeric, single-hyphen-separated slug no longer than 60 characters. Absolute paths, traversal, nested paths, alternate prefixes, and unsafe slugs are invalid.

Direct execution accepts exactly one JSON object:

```json
{
  "state": null,
  "event": {
    "type": "initialize",
    "payload": {
      "interviewId": "example-1",
      "declaredType": "greenfield",
      "threshold": 0.05,
      "roundCap": 30,
      "softWarningRounds": 15,
      "panelCeiling": 30
    }
  }
}
```

Every successful call returns `{state, action, semanticCoverageGaps}`. The caller replaces its entire prior state with `result.state` and executes only `result.action`. Invalid phase/event pairs exit 1, write no stdout, and identify the invalid event and phase on stderr.

The reducer owns policy precedence after a committed round: hard cap, scope expansion, early exit, `semanticCoverageGaps`, numerical readiness, panel flow, refinement, then the scorer target. This prevents a caller from skipping required phases or selecting a different target.

Round score commits isolate the answered target: only `askedTarget.component` may change, while every unasked sibling score must remain unchanged and any sibling mutation is rejected. Closure passage is mechanically zero-gap: `closure_passed` requires `semanticCoverageGaps` to be exactly empty, including hard-cap and early-exit closure; missing acceptance evidence leaves a gap and makes `closure_passed` reject the event. Retained `closureContext.stage` maps exactly to lifecycle progress: `pending` for `CLOSURE`, `passed` for `RESTATE`, and `confirmed` for complete `WRITE` and `DONE`.

Normal and incomplete artifacts are component-aware: their tables preserve each component's scope, scored/unscored state, per-component dimension scores, semantic ownership, provenance, and evidence history, while Metadata uses the reducer's `globalAmbiguity`, the MAX of per-component ambiguity, without recomputing it from rendered rows. Null-scored components remain visible and render `—` instead of invented scores. Before `spec_written`, the instruction layer derives the state-bound manifest from the rendered artifact. The exact payload is `{kind,path,components,unresolvedGaps,globalAmbiguity}`; ordered component entries are `{name,status,scored,itemIds,evidenceIds}`. The runtime validates these projected fields against state but validates no file prose or content beyond the manifest.

A reopened baseline uses `pendingBaselineComponents` as the sorted provenance list for exactly the null-scored active components named by `run_baseline.components`; retained scores and coverage stay unchanged while a commit mutates only that pending set. `user_stop` is legal in `BASELINE`: initial unscored state stops directly, while reopened state with known high ambiguity enters incomplete writing and preserves the pending list through acknowledgement.

Panel ownership is split at a machine boundary: the scorer produces a non-ready panel signal; transition owns dispatch eligibility, persona choice, ceiling enforcement, and both pre-acknowledgement and post-acknowledgement failure recovery. The LLM launches all returned personas concurrently in one parallel batch with independent context. A launch-time error emits `panel_failed{reason:"dispatch_error"}` from `awaiting_dispatch`; the reducer atomically records the intended batch, clears panel state, and resumes the pending target. After `panel_dispatched`, an all-results barrier uses a 120-second per-call result timeout; timeout or invalid result emits `panel_failed`, preserving the consumed count and returning the target without findings. For persona latencies `L_i`, critical-path savings are exactly `sum(L_i) - max(L_i)` while call count is unchanged. `panelDispatchHistory` is the authoritative ordered cooldown chronology: each entry stores the authorized `globalAmbiguity` and `band` from the matching scorer-history round and must use the canonical persona sequence truncated only by the remaining `panelCeiling`; `panelDispatchCount` and `priorPanelRound` are derived from it. Eligibility uses `currentRound - priorPanelRound > PANEL_COOLDOWN`; with cooldown `2`, history rounds `[1,3]` are rejected and `[1,4]` are legal. Panel findings carry `{persona,summary,options,confidence}` and must identify every acknowledged persona in the same order. Ready output never dispatches a panel.

## Oracle Validation And Semantic Coverage

Invoke `validate.mjs` with `--expected-type=greenfield` or `--expected-type=brownfield`. For every baseline and round call, also pass the canonical base64url-encoded pre-Oracle component snapshot through `--history-context`; baseline additionally passes ID ownership through `--registry-context`. A valid result has `ok:true`, normalized scores, normalized coverage, and normalized acceptance evidence. Invalid Oracle data returns `ok:false` with errors and a retry hint on stdout so the caller can retry without treating it as a runtime crash.

Greenfield validation accepts exactly `goal`, `constraints`, and `criteria` and rejects `context`; brownfield requires exactly all four dimensions. Validated Oracle triggers are `{dim,type}` records. Before scorer invocation, the instruction layer must enrich every trigger with `component: askedTarget.component`; the scorer then records the fired dimensions and the reducer validates the committed scorer output.

Baseline calls are serial. The instruction layer sets `currentBaselineComponent`, carries the immutable `globalIdOwners` ownership map, encodes `{component: currentBaselineComponent, owners: globalIdOwners}` as base64url, and passes it through `--registry-context`. The validator rejects malformed context, duplicate registry IDs, and any ID already owned by another component before aggregate scoring; only successful validation may advance ownership or the baseline cursor.

Each component coverage snapshot has exactly these categories on one object: `outcome`, `must_haves`, `must_nots`, `out_of_scope`, `invariants`, `preferences`. Records preserve user provenance and append-only item history. Outcome requires one active item when confirmed; the five other categories may be user-confirmed as `explicit_none`. Preferences are metadata and never produce `semanticCoverageGaps`.

Acceptance evidence is append-only. Every currently active M/N/I item must have acceptance evidence with a user-confirmed pass condition before semantic closure, while evidence may continue to reference superseded history. Structural validation accepts a snapshot with a missing active link so transition can return that exact coverage target; malformed, dangling, or duplicate links are rejected.

Within an interview, item IDs and evidence IDs are globally unique, immutable, and never reused or moved. `validate.mjs` compares the trusted history context before scoring and rejects deletion, reorder, prior text or `source_round` changes, invalid state transitions, and acceptance-evidence rewrites. `transition.mjs` independently enforces the same history contract at commit, plus cross-component history, round provenance, snapshot carry-forward, and mutation of only the component selected by the prior target.

Transcript compression is instruction-layer work. The append-only immutable full transcript is the only source for selection, token counting, cache keys, and final artifact rendering. The latest two complete rounds are always verbatim and ineligible. From older rounds, select the oldest half rounded up, and compress only if that selected prefix is nonempty and strictly exceeds 4000 tokens. The one-interview cache stores only summaries validated for the exact prefix bytes, immutable registry, ownership map, and compression prompt version; retries and unchanged prefixes reuse them. A working transcript is ephemeral and never feeds later selection. Invalid or fallback output is never cached. Valid key `i` reused `k_i` times saves `k_i - 1` calls, for total savings `sum(k_i - 1)`.

## Scoring Contract

`scorer.mjs` accepts active components with scores plus prior scoring state. Exact clarity weights are:

| Type | Goal | Constraints | Criteria | Context |
|---|---:|---:|---:|---:|
| greenfield | `0.35` | `0.35` | `0.30` | not scored |
| brownfield | `0.30` | `0.30` | `0.25` | `0.15` |

Per-component ambiguity is one minus weighted clarity after trigger effects. Global ambiguity is the **MAX** of per-component ambiguity, so the least clear component gates readiness. Numerical `coverageGaps` describe dimensions below their score floor; they are distinct from transition-owned semantic coverage gaps.

The scorer also returns band state, stall and oscillation signals, validation-clamp propagation, streak state, panel eligibility, and a deterministic numerical `nextTarget`. A `ready:true` result always has `dispatchPanel:false`.

### Authoritative Constants

These runtime values are documented only here. Instruction and prompt prose refers to their names rather than copying their values.

| Constant | Value | Meaning |
|---|---:|---|
| `TRIGGER_DELTA` | `-0.15` | Penalty for each fired trigger on its dimension. |
| `PANEL_COOLDOWN` | `2` | Completed rounds required between panel opportunities. |
| `STALL_WINDOW` | `0.05` | Maximum spread in the most recent three ambiguity values for a stall signal. |
| `REFINED_CEILING` | `0.30` | Upper refined-band edge. |
| `INITIAL_FLOOR` | `0.60` | Exclusive lower initial-band edge. |
| `THRESHOLD_MIN` | `1e-6` | Minimum clamped threshold. |
| `THRESHOLD_MAX` | `0.30` | Maximum clamped threshold. |
| `EPS` | `1e-9` | Floating-point comparison tolerance. |
| `MAX_COMPONENT_NAME_LENGTH` | `120` | Maximum Unicode code points in one component name. |
| `MAX_KNOWN_COMPONENTS` | `64` | Maximum active plus deferred components. |
| `MAX_SERIALIZED_STATE_BYTES` | `1048576` | Maximum serialized reducer state bytes. |
| `MAX_SERIALIZED_EVENT_BYTES` | `1048576` | Maximum serialized event bytes before deep validation. |
| `MAX_SERIALIZED_PROJECTION_BYTES` | `262144` | Maximum state-derived manifest and semantic-gap projection bytes. |
| `MAX_SERIALIZED_RESULT_BYTES` | `3145728` | Maximum serialized reducer result bytes after bounded projection. |
| `MAX_RAW_TRANSITION_BYTES` | `2101248` | Maximum transition CLI stdin bytes before parsing. |
| `MAX_VALIDATOR_INPUT_BYTES` | `1048576` | Maximum validator stdin bytes before parsing. |
| `MAX_REGISTRY_CONTEXT_BYTES` | `262144` | Maximum decoded baseline registry-context bytes before parsing. |
| `MAX_HISTORY_CONTEXT_BYTES` | `262144` | Maximum decoded pre-Oracle component history context before parsing. |
| `MAX_INPUT_BYTES` | `1048576` | Maximum scorer, refine-gate, and FactsLedger stdin bytes before parsing. |
| `MAX_VALIDATION_ERRORS` | `64` | Maximum validator error records, including the omission marker. |
| `MAX_DIAGNOSTICS` | `64` | Maximum scorer diagnostics, including the omission marker. |

## FactsLedger Contract

Run `node factsLedger.mjs <command> --interview-id ID [options]`. Commands are `append`, `dispute`, `supersede`, `queryDisputed`, and `list`; `--reset` recreates corrupt state after preserving a backup.

State is stored at `.omo/state/ulw-interview-facts-{interview_id}.json`. Entries are immutable: disputes and supersessions append records rather than rewriting prior facts. The current design assumes one writer and uses a five-minute stale-lock policy.

FactsLedger enforces an exact schema and non-negative integer source rounds. State must contain exactly `interview_id`, `version`, `entries`, and `last_updated`; ownership must match the CLI interview ID; entry fields depend on `confirmed` or `disputed` status; safe IDs are unique; timestamps are ordered; `last_updated` equals the final entry timestamp; and dispute/supersede references point only to earlier IDs. Interview and explicit fact IDs use `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`, so traversal-like identifiers fail before filesystem side effects.

Lock ownership is explicit. Controlled failures after this invocation acquires the lock release that acquired lock before returning exit code 1. Malformed stdin and refusal on a fresh foreign lock happen before acquisition, so no owned lock is removed. A malformed lock uses filesystem mtime rather than untrusted content to determine freshness: fresh malformed bytes are refused and preserved exactly, while stale malformed bytes are reclaimed even when their embedded timestamp claims freshness. Unexpected failures still unwind through `finally` after acquisition.

## Fallback And Ownership Boundaries

Canonical validation fallback must retry a failed Oracle response exactly once using its `retryHint`. If that retry fails, all required scores are `0.5`, `validationScoreClamped` is `false`, and `degraded` is `true`. On an initial baseline, those scores pair with reducer-created open coverage; on a round, only `askedTarget.component` scores change, its prior coverage is preserved byte-for-byte, and sibling scores and coverage remain unchanged. The event carries no triggers, FactsLedger effects, registry allocations, or semantic mutations; identical state and event inputs produce byte-identical output.

Before the first scorer output there is no numeric threshold or clarity-target announcement; the first scorer output supplies the effective threshold, and the UI announces clarity from `1 - scorerOutput.threshold`. Examples only: raw `-1` maps to `0.000001`, `0.05` maps to `0.05`, and `1` maps to `0.30`; scorer output remains authoritative.

The LLM owns question wording, option design, user-facing topology proposals, facts-versus-decisions routing, Oracle semantic judgments, execution of reducer-returned panel personas, closure materiality judgment, and specification prose. The runtime owns schema validation, scoring math, state transition legality, policy order, coverage-target selection, panel state/counting, and complete state commits.

Known gaps bound closure work before `run_closure`. At hard cap or early exit, nonempty `semanticCoverageGaps` returns incomplete `write_spec` directly, saving exactly one closure Oracle call and adding zero questions. Only a gap-free state can enter closure; `closure_passed` still requires the exact empty gap set.

The default high-assurance profile remains `ambiguityThreshold: 0.05`, `roundCap: 30`, `softWarningRounds: 15`, `panelCeiling: 30`. The optional product discovery preset is `ambiguityThreshold: 0.10`, `roundCap: 15`, `softWarningRounds: 8`, `panelCeiling: 6`. It reduces expected model turns and panel calls but lowers numerical assurance; semantic/evidence closure and restatement are unchanged. Select once and never adapt the threshold mid-session.

## Running Tests

From the repository root, `npm test` runs the exact six-suite chain: legacy runtime, FactsLedger, intent contract, scorer contract, transition, then documentation contract.

```bash
npm test
```

Run any suite directly with `node skills/ulw-interview/references/runtime/<suite>.test.mjs`. Scenario options on the focused suites provide JSON outputs for terminal QA.

## Known Limitations

1. The reducer is intentionally in-memory and fileless. Interview transition state is not persisted across processes or transactionally coupled to FactsLedger.
2. FactsLedger retains its existing single-writer assumption; lock acquisition is not a distributed mutex, and abrupt process termination cannot run cleanup.
3. Scores and transitions are deterministic for identical inputs, but Oracle semantic judgment, user-facing questions, panel findings, closure review, and specification synthesis remain model-owned.
4. The cost and quality advantage of per-round Oracle scoring plus milestone panels over a simpler interview requires empirical benchmarking for each use case.
5. Greenfield interviews reject the `context` scoring dimension; brownfield interviews require it.
6. The reducer validates state consistency but does not cryptographically authenticate caller-supplied state. Bundled usage treats `result.state` as opaque trusted tool output and never exposes it to user or model subprompts; external embedders that cross a trust boundary must persist or authenticate state outside the model context.
7. The transition manifest attests its projected component, score-presence, ID, gap, and ambiguity fields, not arbitrary artifact prose or file bytes. User provenance still depends on the bundled caller admitting only direct user confirmations.
