# ulw-interview

Socratic deep interview skill for [opencode](https://opencode.ai) with a deterministic ambiguity-scoring runtime.

Asks one targeted question at a time, scores clarity across weighted dimensions via executable runtime scripts, and loops until ambiguity drops below a configurable threshold. Produces a spec document — not code, not a plan.

## Install

Add to your project's `opencode.json` (or `~/.config/opencode/opencode.json` for global):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git"
  ]
}
```

Or via CLI:

```bash
opencode plugin "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git"
opencode plugin "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git" --global
```

Restart opencode. The skill is auto-discovered by the native skill system.

## When to use

- User has a vague idea and wants thorough requirements gathering before execution.
- User says "interview me", "ask me everything", "don't assume", "make sure you understand".
- Task is complex enough that jumping to code would waste cycles on scope discovery.

## When NOT to use

- User has a detailed, specific request with file paths and acceptance criteria — execute directly.
- User wants a quick fix or single change.
- User says "just do it" or "skip the questions".

## How it works

```
oracle → validate.mjs → scorer.mjs → LLM consumes output verbatim
         (schema check)  (deterministic math)

convergence.mjs → ontology stability tracking (advisory to scorer)
factsLedger.mjs  → established-facts event-log (closure guard queries disputes)
refineGate.mjs   → low-progress detection (triggers refinement follow-up)
```

All numerical scoring, validation, band classification, stall detection, oscillation suppression, trigger penalties, coverage gaps, streak counting, and next-target selection are handled by deterministic runtime scripts under `skills/ulw-interview/references/runtime/`. The LLM never computes ambiguity by hand.

After the spec is written, the skill presents three options via the `question` tool: **Start planning** (hands off to `/ulw-plan`), **Continue interview** (returns to Phase 2), or **Done**.

See [`skills/ulw-interview/references/runtime/README.md`](./skills/ulw-interview/references/runtime/README.md) for the full runtime contract and known limitations.

## Configuration

Optional settings in `.omo/settings.json` (project-level):

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

| Key | Default | Range | Notes |
|---|---|---|---|
| `ambiguityThreshold` | `0.05` | `(0, 0.30]` | `0.10` recommended for product discovery; `0.05` for safety/compliance. |
| `roundCap` | `30` | positive integer | Maximum Phase 2 rounds. `20` for safety/compliance; `30-40` for product discovery. |
| `softWarningRounds` | `15` | positive integer | Round for soft warning. Default ~`roundCap / 2`. |
| `panelCeiling` | `30` | positive integer | Total persona-dispatches allowed per interview. |

## Repository structure

```
ulw-interview/
├── package.json                          # npm/git package metadata
├── .opencode/plugins/
│   └── ulw-interview.js                  # opencode plugin (registers skills/)
├── skills/
│   └── ulw-interview/
│       ├── SKILL.md                      # skill instructions for the LLM
│       └── references/
│           ├── prompts/
│           │   ├── oracle-scoring.md      # oracle scoring prompt template
│           │   ├── lateral-panel.md       # panel personas + cooldown + ceiling
│           │   └── spec-template.md       # spec output template + incomplete report
│           └── runtime/
│               ├── scorer.mjs            # deterministic scoring engine
│               ├── validate.mjs          # oracle JSON validator
│               ├── convergence.mjs       # ontology stability reducer
│               ├── factsLedger.mjs        # established-facts event-log
│               ├── refineGate.mjs         # low-progress refine-or-skip gate
│               ├── test.mjs              # 79 inline assertions
│               └── README.md             # runtime contract
├── LICENSE
└── README.md
```

## Development

```bash
# verify runtime tests pass (79 assertions)
npm test
# or directly:
node skills/ulw-interview/references/runtime/test.mjs
```

To test the skill locally in opencode without installing, point `skills.paths` at this repo's `skills/` directory in your project's `opencode.json` (or `~/.config/opencode/opencode.json` for global):

```jsonc
{
  "skills": {
    "paths": ["/absolute/path/to/ulw-interview/skills"]
  }
}
```

Restart opencode and the skill appears in native discovery. This mirrors what the plugin (`.opencode/plugins/ulw-interview.js`) registers at runtime.

## License

MIT — see [LICENSE](./LICENSE).
