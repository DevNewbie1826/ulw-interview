# ulw-interview

`ulw-interview` is a harness-neutral Socratic deep-interview skill for OpenCode and any host that can run a Node.js JSON subprocess. It asks one targeted question at a time, scores ambiguity with the gajae deep-interview model, and writes a specification only after closure and restatement confirmation.

The scoring model and runtime are adapted from the MIT-licensed gajae deep-interview work. This package keeps the ambiguity math, panel timing, and lifecycle gates while removing host-specific session storage and command modes.

## Install for OpenCode

Add the plugin to `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git"
  ]
}
```

Restart OpenCode after installing or updating the plugin. The plugin only registers the bundled `skills/` directory. It does not own interview state.

## Use from another harness

Run the portable runtime directly:

```bash
node skills/ulw-interview/runtime/cli.mjs
```

Send one JSON envelope on stdin. The first call uses the `initialize` event with no prior state:

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

The CLI prints exactly one `{ "state", "effects" }` object on success. Replace the previous state wholesale, execute the ordered effects, and call the CLI again with the returned state plus the next event. Contract rejections exit non-zero, print no success JSON, and write the diagnostic to stderr.

The runtime is deterministic for the same state and event. It performs no network calls, configuration reads, session persistence, model calls, panel dispatch, or host-specific handoffs. The CLI materializes a spec file only when the caller reaches `write_spec` with an existing absolute directory, safe slug, and markdown body.

## Mandatory flow

The host must follow the lifecycle in order:

1. `initialize` announces the threshold and asks for topology.
2. `confirm_topology` locks 1..6 components with at least one active component.
3. Round loop: accept the runtime `open_round` target, ask one question, `submit_answer`, resolve any refinement or analyst/critic panel, then `record_score` for every active component.
4. Closure: when the runtime emits `request_closure_audit`, call `audit_closure`. A host-requested early exit uses `request_closure` after the minimum-round gate.
5. Restate: call `confirm_restate`; failures reopen correction rounds and successes move to writing.
6. Write: call `write_spec`; the CLI returns `persist_spec` with the materialized path and SHA-256.

Skipping a phase, inventing a target, mutating derived state, scoring incomplete components, or bypassing closure/restate gates is rejected.

## Behavioral contract

- Greenfield weights are `goal:0.40`, `constraints:0.30`, `criteria:0.30`.
- Brownfield weights are `goal:0.35`, `constraints:0.25`, `criteria:0.25`, `context:0.15`.
- Aggregation uses the minimum score per required dimension across active components, then `reported = round2(1 - weighted_sum)`.
- Ambiguity floor pressure is `0.10` per unresolved disputed fact, `0.05` for unscored active components, and up to `0.05` for agent-answer ratio.
- Effective ambiguity is `max(reported, floor)` after rounding and floor calculation.
- Ordinary agent-derived scores are capped at `0.85`; high-confidence low-uncertainty agent answers may exceed the cap.
- Three consecutive agent/auto-research answers force the next answer to come from the user.
- Bands are `ready <= threshold`, `refined <= 0.30`, `progress <= 0.60`, otherwise `initial`.
- Band changes dispatch milestone lateral review panels; panel personas are `analyst` then `critic`.
- The soft warning appears at round 10, the hard cap is round 100, and host-requested early exit requires at least 3 scored rounds unless soft warning or hard cap already fired.
- Stall escalation occurs when the latest 3 effective ambiguities are within `±0.05`, or after 8 scored rounds while effective ambiguity remains above `0.30`; escalation requests ontology attention.
- Facts are append-only: contradictions mark existing facts disputed, and resolution reconfirms or supersedes them.
- Closure requires threshold, hard cap, or early exit; unresolved disputed facts still block passing closure.
- Restatement confirmation and closure success both gate spec persistence.

The public skill protocol is in [`skills/ulw-interview/SKILL.md`](./skills/ulw-interview/SKILL.md). The scorer contract is progressively loaded from [`skills/ulw-interview/scoring.md`](./skills/ulw-interview/scoring.md). The runtime event/effect contract is in [`skills/ulw-interview/runtime/README.md`](./skills/ulw-interview/runtime/README.md). Tests treat [`test/CONTRACT.md`](./test/CONTRACT.md) as the executable contract.

## Repository structure

```text
ulw-interview/
├── .opencode/plugins/ulw-interview.js
├── LICENSE
├── README.md
├── package.json
├── skills/ulw-interview/
│   ├── SKILL.md
│   ├── auto-answer-uncertain.md
│   ├── auto-research-greenfield.md
│   ├── lateral-review-panel.md
│   ├── plain-language.md
│   ├── runtime/
│   │   ├── README.md
│   │   ├── ambiguity-floor.mjs
│   │   ├── cli.mjs
│   │   ├── fact-ledger.mjs
│   │   ├── round-recorder.mjs
│   │   ├── runtime-finalization.mjs
│   │   ├── runtime-rounds.mjs
│   │   ├── runtime-scoring.mjs
│   │   ├── runtime.mjs
│   │   ├── state-shape.mjs
│   │   ├── state-validation.mjs
│   │   ├── state.mjs
│   │   └── transition-support.mjs
│   ├── scoring.md
│   └── spec-template.md
└── test/
    ├── CONTRACT.md
    ├── contract.test.mjs
    ├── e2e-lifecycle.test.mjs
    ├── prompt-contract.test.mjs
    └── runtime-unit.test.mjs
```

## Development

```bash
npm test
```

The suite uses `node:test` and includes unit scoring fixtures, contract-level runtime tests, prompt/docs checks, plugin registration, and real-CLI lifecycle tests that carry JSON state between subprocess calls.

## Intentional omissions

- gajae Phase 0.75 --trace native seed: omitted because this package ships the portable skill/runtime only, not the seed trace harness.
- >6 component grouping: omitted because this runtime rejects more than six components by design.
- legacy_missing topology migration: omitted because this build accepts new-format states only.
- .gjc paths and gjc CLI: omitted because they are host-specific gajae artifacts, not part of this package.
- ask-tool deepInterview.* metadata: omitted because the skill uses the Node JSON protocol, not ask-tool metadata.
- ralplan/ultragoal/team handoffs: omitted because the runtime is single-path and does not expose those handoff modes.
- codebase_context state field: omitted because host context is folded into the scoring prompt instead of stored in state.

## License

MIT. See [LICENSE](./LICENSE).
