# ulw-interview

Socratic deep interview skill for [opencode](https://opencode.ai) with a deterministic ambiguity-scoring runtime.

Asks one targeted question at a time, scores clarity across weighted dimensions via executable runtime scripts, and loops until ambiguity drops below a configurable threshold. Produces a spec document — not code, not a plan.

## Install

### Option A — one line (recommended)

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

Restart opencode. The skill is auto-discovered.

### Option B — manual (for `--pure` mode or offline)

```bash
git clone https://github.com/DevNewbie1826/ulw-interview.git ~/.config/opencode/skills/ulw-interview
```

Then add to `opencode.json`:

```jsonc
{
  "skills": {
    "paths": ["~/.config/opencode/skills/ulw-interview/skills"]
  }
}
```

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
```

All numerical scoring, validation, band classification, stall detection, oscillation suppression, trigger penalties, coverage gaps, streak counting, and next-target selection are handled by deterministic runtime scripts under `skills/ulw-interview/references/runtime/`. The LLM never computes ambiguity by hand.

See [`skills/ulw-interview/references/runtime/README.md`](./skills/ulw-interview/references/runtime/README.md) for the full runtime contract and known limitations.

## Configuration

Optional settings in `.omo/settings.json` (project-level):

```json
{
  "omo": {
    "ulwInterview": {
      "ambiguityThreshold": 0.05,
      "panelCeiling": 6
    }
  }
}
```

| Key | Default | Range | Notes |
|---|---|---|---|
| `ambiguityThreshold` | `0.05` | `(0, 0.30]` | `0.10` recommended for product discovery; `0.05` for safety/compliance. |
| `panelCeiling` | `6` | positive integer | Total persona-dispatches allowed per interview. |

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
│           └── runtime/
│               ├── scorer.mjs            # deterministic scoring engine
│               ├── validate.mjs          # oracle JSON validator
│               ├── test.mjs              # 46 inline assertions
│               └── README.md             # runtime contract
├── LICENSE
└── README.md
```

## Development

```bash
# verify runtime tests pass
node skills/ulw-interview/references/runtime/test.mjs

# test the plugin locally by pointing skills.paths at this repo
```

## License

MIT — see [LICENSE](./LICENSE).
