# ulw-interview

Socratic deep interview skill for [opencode](https://opencode.ai) with deterministic validation, scoring, and lifecycle enforcement.

The skill asks one targeted question at a time, confirms both positive intent and negative boundaries, and produces a specification rather than code or a plan.

## Install

Add the plugin to project or global `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git"
  ]
}
```

Or install it from the CLI:

```bash
opencode plugin "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git"
opencode plugin "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git" --global
```

Restart opencode after installation. The plugin registers the bundled `skills/` directory with the native skill loader.

## When to use

- A user has a vague idea and wants thorough requirements discovery before execution.
- A user says "interview me", "ask me everything", "don't assume", or "make sure you understand".
- Missing boundaries or acceptance evidence would make direct implementation risky.

Do not use it for a detailed request that already has concrete scope and acceptance criteria, a quick single change, or an explicit request to skip questions.

## How it works

`transition.mjs` is authoritative and owns every lifecycle transition and next action. The persisted phases are `TOPOLOGY -> BASELINE -> ROUND -> CLOSURE -> RESTATE -> WRITE`, followed by `DONE`, `INCOMPLETE`, or `STOPPED`.

Caller-supplied interview IDs must match `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. Completed artifacts are acknowledged only at the contained path `.omo/specs/ulw-interview-{slug}.md`, where the lowercase hyphenated slug is at most 60 characters; traversal and alternate paths are rejected.

Each answered round follows this path:

```text
asked target -> Oracle -> validate.mjs -> FactsLedger effects -> refineGate.mjs
             -> scorer.mjs -> transition.mjs round_scored -> returned action
```

`validate.mjs` validates numerical scores and semantic coverage. Coverage records outcome, must-haves, must-nots, out-of-scope decisions, invariants, and preferences; acceptance evidence links active M/N/I requirements to user-confirmed pass conditions. Preferences are metadata and never block closure.

Greenfield validation accepts exactly goal, constraints, and criteria dimensions and rejects context; brownfield validation requires all four dimensions. After validation, each trigger is enriched with `askedTarget.component` before `scorer.mjs` so fired trigger effects remain bound to the answered component.

During serial baseline scoring, `currentBaselineComponent` and the immutable `globalIdOwners` map are encoded into `--registry-context`; validation rejects cross-component ID ownership before aggregate scoring, and only validated IDs advance the registry.

`scorer.mjs` owns deterministic ambiguity math. Greenfield weights are goal `0.35`, constraints `0.35`, criteria `0.30`; brownfield weights are goal `0.30`, constraints `0.30`, criteria `0.25`, context `0.15`. Readiness uses the maximum per-component ambiguity so a clear component cannot mask an unclear sibling.

Round score commits isolate the answered target: only `askedTarget.component` may change, while every unasked sibling score must remain unchanged and any sibling mutation is rejected. Closure passage is mechanically zero-gap: `closure_passed` requires `semanticCoverageGaps` to be exactly empty, including hard-cap and early-exit closure; missing acceptance evidence leaves a gap and makes `closure_passed` reject the event.

Normal and incomplete artifacts are component-aware: their tables preserve each component's per-component dimension scores, semantic ownership, provenance, and evidence history, while Metadata uses the reducer's `globalAmbiguity`, the MAX of per-component ambiguity, without recomputing it from rendered rows.

Canonical validation fallback must retry a failed Oracle response exactly once using its `retryHint`. If that retry fails, all required scores are `0.5`, `validationScoreClamped` is `false`, and `degraded` is `true`. On an initial baseline, those scores pair with reducer-created open coverage; on a round, only `askedTarget.component` scores change, its prior coverage is preserved byte-for-byte, and sibling scores and coverage remain unchanged. The event carries no triggers, FactsLedger effects, registry allocations, or semantic mutations; identical state and event inputs produce byte-identical output.

Before the first scorer output there is no numeric threshold or clarity-target announcement; the first scorer output supplies the effective threshold, and the UI announces clarity from `1 - scorerOutput.threshold`. Examples only: raw `-1` maps to `0.000001`, `0.05` maps to `0.05`, and `1` maps to `0.30`; scorer output remains authoritative.

Panel responsibility is split deliberately: the scorer emits a non-ready panel signal, the transition reducer owns eligibility, persona selection, dispatch sequence, acknowledgement, and count state, and the LLM executes only the returned personas. `panelDispatchHistory` is the authoritative ordered history: `panelDispatchCount` and `priorPanelRound` are derived from it, and its ordered entries enforce cooldown chronology. Eligibility uses the scorer-consistent strict comparison `currentRound - priorPanelRound > PANEL_COOLDOWN`; with cooldown `2`, history rounds `[1,3]` are rejected and `[1,4]` are legal. Panel findings include `persona` and must match every acknowledged persona in the same order before the reducer accepts them. Closure remains the final adversarial judgment.

A reopened baseline uses `pendingBaselineComponents` for exactly the null-scored active components returned by `run_baseline`; retained scores and coverage remain byte-equivalent. `user_stop` stays legal in `BASELINE`: an initial baseline with no ambiguity stops directly, while reopened high-ambiguity state writes an incomplete artifact without erasing the pending list.

`factsLedger.mjs` stores established facts, disputes, and supersessions in a per-interview append-only event log. FactsLedger enforces an exact schema and non-negative integer source rounds, safe fact IDs, matching interview ownership, ordered timestamps, and backward-only dispute/supersede references. Controlled failures after lock acquisition release that acquired lock before returning exit code 1. For a malformed foreign lock, filesystem mtime is authoritative: fresh bytes are refused and preserved, while a stale malformed lock is reclaimed regardless of embedded content.

After a complete specification is written, the reducer can offer **Start planning**, **Continue interview** when allowed, or **Done**. An incomplete specification stops after the artifact is acknowledged.

See the [runtime reference](./skills/ulw-interview/references/runtime/README.md) for schemas, constants, lifecycle details, and limitations.

## Configuration

Optional project settings live in `.omo/settings.json`:

```json
{
  "omo": {
    "ulwInterview": {
      "ambiguityThreshold": 0.05,
      "roundCap": 30,
      "softWarningRounds": 15,
      "panelCeiling": 30
    }
  }
}
```

| Key | Range | Purpose |
|---|---|---|
| `ambiguityThreshold` | `(0, 0.30]` | Readiness threshold; invalid edges are clamped by the scorer. |
| `roundCap` | positive integer | Maximum number of scored interview rounds. |
| `softWarningRounds` | positive integer | Round at which the current target question carries an informational warning. |
| `panelCeiling` | positive integer | Maximum number of persona dispatches in an interview. |

## Repository structure

```text
ulw-interview/
|-- package.json
|-- .opencode/plugins/
|   `-- ulw-interview.js
|-- skills/ulw-interview/
|   |-- SKILL.md
|   `-- references/
|       |-- prompts/
|       |   |-- oracle-scoring.md
|       |   |-- lateral-panel.md
|       |   `-- spec-template.md
|       `-- runtime/
|           |-- README.md
|           |-- validate.mjs
|           |-- scorer.mjs
|           |-- refineGate.mjs
|           |-- factsLedger.mjs
|           |-- transition.mjs
|           |-- test.mjs
|           |-- facts-ledger.test.mjs
|           |-- intent-contract.test.mjs
|           |-- scorer-contract.test.mjs
|           |-- transition.test.mjs
|           `-- docs-contract.test.mjs
|-- LICENSE
`-- README.md
```

## Development

`npm test` runs all six suites in sequence and stops at the first failure:

```bash
npm test
```

The chain covers legacy runtime behavior, FactsLedger cleanup, semantic intent validation, scorer contracts, transition scenarios, and documentation integration. The package has no runtime dependencies or build step.

For local development without installation, add this repository's `skills/` directory to `skills.paths`, then restart opencode:

```jsonc
{
  "skills": {
    "paths": ["/absolute/path/to/ulw-interview/skills"]
  }
}
```

## License

MIT - see [LICENSE](./LICENSE).
