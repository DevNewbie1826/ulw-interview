# ULW Interview Runtime

Deterministic scoring engine for the `ulw-interview` skill. The LLM never
computes ambiguity by hand. Every scoring step pipes oracle output through
`validate.mjs`, then through `scorer.mjs`.

## Why this exists

Five independent Oracle audits converged on eight Critical defects, almost all
of them numerical or control-flow problems the LLM cannot reliably solve by
reading prose:

- Per-component aggregation (one perfect component must not mask an unclear one)
- Threshold validation (0, negative, > 0.30 must not break milestone bands)
- Score validation (oracle may return 1.2 or "85%")
- Trigger penalty magnitude (must be reproducible)
- Stall detection math (windowed, not pairwise)
- Bidirectional band oscillation (panel cooldown + epsilon-safe edges)
- Negative ambiguity clamp (oracle may sum > 1.0)
- "All dims ≥ 0.9" shortcut reconciliation with the threshold

All of this lives in `scorer.mjs`. The LLM keeps the judgment work — question
generation, topology enumeration, panel dispatch, closure decisions — but
defers every numerical decision to the runtime.

## Files

| File | Purpose |
|---|---|
| `scorer.mjs` | Reads state JSON from stdin, writes computed scoring state to stdout. |
| `validate.mjs` | Validates raw oracle JSON output. Returns `{ok:true, normalized}` or `{ok:false, errors, retryHint}`. |
| `test.mjs` | Inline assertions. Run with `node test.mjs`. |

Both scripts are vanilla Node ES modules. No `package.json`, no `node_modules`,
no network, no fs writes (except stdout). Stdlib only.

## Contracts

### `validate.mjs`

**Input** (stdin): raw text — typically the oracle's JSON response.

**Output** (stdout, exit 0):
```json
{
  "ok": true,
  "normalized": {
    "type": "greenfield",                          // or "brownfield"
    "scores": { "goal": 0.8, "constraints": 0.7, "criteria": 0.6 },  // context added if brownfield
    "weakest_dimension": "criteria",
    "triggers": [ { "dim": "criteria", "type": "C" } ],
    "justification": "...",                        // optional, echoed
    "gap": "..."                                   // optional, echoed
  },
  "scoreClamped": false,                            // true if any score was clamped to [0,1]
  "clampedFields": []                              // e.g. ["goal"] if goal was clamped
}
```

Or, on validation failure (exit 0, the LLM reads the payload):
```json
{
  "ok": false,
  "errors": [ "scores.criteria missing (required for greenfield)" ],
  "retryHint": "Re-dispatch the oracle with explicit instruction: ..."
}
```

Required fields: `scores.{goal,constraints,criteria}` for greenfield (add
`context` for brownfield), `weakest_dimension`, `triggers` (array, may be
empty). Scores are clamped to `[0,1]`. Unknown fields are tolerated.

### `scorer.mjs`

**Input** (stdin):
```json
{
  "threshold": 0.05,
  "type": "greenfield",                            // or "brownfield"
  "components": [
    { "name": "API", "scores": { "goal": 0.95, "constraints": 0.95, "criteria": 0.95 } }
  ],
  "priorAmbiguity": 0.45,                          // optional
  "priorBand": "progress",                         // optional
  "priorRounds": [0.55, 0.50, 0.47],               // optional, last N global ambiguities
  "priorBandHistory": ["progress", "refined"],     // optional, drives oscillation suppression
  "priorPanelRound": 3,                            // optional
  "currentRound": 6,                               // optional, 1-based Phase 2 round
  "triggers": [                                    // optional, fires this round
    { "component": "API", "dim": "goal", "type": "C" }
  ],
  "validationScoreClamped": false,                 // optional, propagated from validate.mjs
  "streakCounter": 0,                              // optional, dialectic rhythm guard state
  "lastRoundResolvedWithoutUser": false,           // optional, increments streak when true
  "degraded": false                                // optional, set when validation fallback was used
}
```

**Output** (stdout, exit 0):
```json
{
  "threshold": 0.05,
  "thresholdClamped": false,
  "type": "greenfield",
  "perComponent": [
    { "name": "API", "ambiguity": 0.05, "scores": { "...": "..." }, "firedDims": [], "negativeClamped": false }
  ],
  "globalAmbiguity": 0.05,
  "band": "ready",                                 // initial | progress | refined | ready
  "bandChanged": true,
  "stallDetected": false,
  "ready": true,
  "skipToSpec": true,
  "nextPanelEligible": true,
  "suppressPanelForOscillation": false,
  "dispatchPanel": true,                            // = nextPanelEligible && !suppressPanelForOscillation && bandChanged
  "panelCooldown": 2,
  "scoreClamped": false,
  "validationScoreClamped": false,
  "negativeAmbiguityClamped": false,
  "coverageGaps": [],                               // ["component/dim: score < 0.9", ...] for closure guard
  "streakCounter": 0,
  "forceUserQuestion": false,
  "nextTarget": { "component": "API", "dimension": "constraints" }, // authoritative next-question target
  "degraded": false,
  "currentRound": 6,
  "triggerDelta": -0.15
}
```

On schema violation (exit 1, stderr message): the LLM treats this as a
programmer error in the calling code, not an oracle failure. Re-dispatch is
not appropriate — fix the calling code.

## Authoritative constants (do not duplicate in prose)

These constants live here. `SKILL.md` references them by name and must not
re-state their values — if the prose disagrees with the script, the script is
correct.

| Constant | Value | Meaning |
|---|---|---|
| `TRIGGER_DELTA` | -0.15 | Per-fired-trigger penalty applied to the targeted dimension. Multiple triggers stack additively, floored at 0.0. |
| `PANEL_COOLDOWN` | 2 | A panel cannot fire within 2 rounds of the previous panel dispatch. |
| `STALL_WINDOW` | 0.05 | Windowed max-min of the last 3 global ambiguities. ≤ this value → stall detected. |
| `REFINED_CEILING` | 0.30 | Upper edge of the `refined` band. |
| `INITIAL_FLOOR` | 0.60 | Lower edge (exclusive) of the `initial` band. |
| `THRESHOLD_MIN` | 1e-6 | Threshold below this is clamped up to this value (avoids "never ready"). |
| `THRESHOLD_MAX` | 0.30 | Threshold above this is clamped down to this value (avoids band overlap). |
| `EPS` | 1e-9 | Float-comparison epsilon for band edges. |

## Aggregation rule (C2 fix)

**Global ambiguity = MAX of per-component ambiguities.** Equivalently, the
worst component gates readiness. This is the single most important design
decision: it prevents a fully-clear component from masking an unclear sibling.

Concretely: `ready = (globalAmbiguity ≤ threshold) AND (every perComponent.ambiguity ≤ threshold)`.

## Fallback policy

If `validate.mjs` returns `ok: false` **twice in a row** for the same scoring
round, the LLM falls back to conservative local scoring:

1. Set all dimension scores to `0.5`.
2. Set `degraded: true` in the next scorer input.
3. Note the degradation in the interview transcript under a `> [degraded round]` quote.
4. Continue the interview; do not abort.

This guarantees the interview always makes forward progress even when the
oracle is temporarily unavailable or returning malformed output.

## What the LLM still owns

The runtime is deliberately narrow. The LLM continues to own:

- Question generation and option selection
- Topology enumeration and the Round 0 confirmation question
- Topology reopen decision when trigger D fires (the scorer applies the delta;
  the LLM decides whether to ask the user to merge/defer if > 6 components)
- Lateral panel dispatch (subject to `nextPanelEligible` and the per-interview
  panel ceiling from `omo.ulwInterview.panelCeiling`, default 6)
- Closure guard judgment (whether a "material gap" exists; the runtime only
  reports `ready` mathematically)
- Phase 3 restate gate and incomplete-spec-report decision

## Running the tests

```sh
node test.mjs
```

All assertions should pass (46 at the time of writing; the count grows as the
runtime matures). The test file is the canonical reference for expected behavior
— read it alongside this README.

## Known Limitations

1. **Cost justification is empirically open.** Per-round oracle scoring plus milestone panels is defensible for high-rigor interviews (safety, compliance, specs that will govern substantial downstream work). It is NOT yet proven against a simpler single-agent Socratic interview with one final readiness audit. Before using `ulw-interview` as the default interview path for ordinary product discovery, run an A/B benchmark measuring spec quality, critical omissions, downstream rework, token cost, and wall-clock latency.

2. **Determinism boundary.** Numerical scoring, validation, band classification, stall detection, oscillation suppression, trigger deltas, coverage gaps, streak counter, and next-target selection are deterministic (runtime-owned). Question wording, facts-vs-decisions routing, topology decomposition (with the user-surface preference rule as a tie-breaker), panel finding folding, and final spec synthesis are LLM-owned. Two competent agents will produce the same scores and the same next-target for the same input state, but may phrase questions differently.

3. **`weakest_dimension: "context"` is rejected for greenfield** (context is not scored). For brownfield, all four dimensions are valid.

4. **Trigger objects must reference a real active component.** Typos in component names are rejected with a schema violation rather than silently no-oping.
