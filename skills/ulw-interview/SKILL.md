---
name: ulw-interview
description: One-question-at-a-time Socratic interview for requirements discovery, ambiguity scoring, and final spec document output. Use when the user says "interview me", "ask me everything", has a vague idea, or says "don't assume".
---

# ULW Interview

## What this is

ULW Interview turns a vague idea into a testable spec by asking one focused question at a time and measuring what is still undecided. A small harness-neutral Node JSON state machine lives beside this file; the agent never does scoring arithmetic or state edits in prose. The output is a written spec only after closure and restatement pass.

## Non-negotiable rules

- Ask one question per round.
- The runtime chooses every target; use returned `target` values verbatim.
- Show the threshold before any welcome or question.
- Show scores after every scored round.
- Never implement during the interview.
- The runtime's effects are the ONLY legal next steps; no alternate path exists.

## Runtime boundary

Resolve `RUNTIME_DIR` as the `runtime/` directory next to this file, then run:

```bash
node "$RUNTIME_DIR/cli.mjs"
```

Send one JSON object on stdin and read one JSON object on stdout: `{ "state": previousStateOrNull, "event": { "type": "...", "input": {...} } }` in, `{ "state": nextState, "effects": [...] }` out. On success, replace caller-held state wholesale with `nextState`, then execute effects in order. On failure, the CLI exits non-zero and writes the validation or contract error to stderr; do not invent recovery state.

## The ONE mandatory path

0. **Before `initialize`:** In one sentence, check suitability. If the request is already concrete and small, say this interview is unnecessary and do not start it unless the user insists. Resolve threshold from host setting or flags (`quick=0.6`, `standard=0.5`, `deep=0.35`, else `0.05`) and pass it into `initialize` with `thresholdSource`. Detect the user's language and keep it for everything user-facing.
1. **`initialize`:** Load `plain-language.md` NOW and keep its rules for the whole interview. The FIRST visible line must be the threshold announcement in the user's own language using the glossary (Korean: `딥 인터뷰 통과 기준선: {percent}% (근거: {source})`; English: `Deep Interview threshold: {percent}% (source: {source})`), immediately followed by one plain line explaining what it means (Korean example: `애매함 점수가 그 비율 아래로 내려가면 다음 단계로 넘어가요`). Then render a short welcome in the user's language.
2. **`ask_topology`:** Propose 1-6 `큰 덩어리` (plain word for top-level components), ask one confirmation question, then send `confirm_topology` with host-supplied `confirmedAt`.
3. **Round loop:** When the runtime returns `open_round` with a `target`, write ONE plain-language reason why that target matters and ONE question with 2-4 options plus a free-text path. Send the `open_round` event with that question. After the user answers, send `submit_answer`.
   - If the runtime returns `refine_answer`, structure reasoning-heavy free text, ask one confirmation, then send `refine_answer`.
   - If it returns `run_lateral_panel`, dispatch `lateral-review-panel.md`: `analyst` first via `metis`, `critic` second via `momus`, parallel if possible; then send `panel_completed` with findings in analyst→critic order.
   - If it returns `score_answer`, dispatch `scoring.md` to a scoring pass, then send `record_score` with the scorer output UNMODIFIED. The scorer owns semantic judgment; the runtime owns math and routing.
4. **`report_progress`:** Render the score table and a plain-language explanation every round. Every number gets one plain line explaining what it means per `plain-language.md`.
5. **Continue only from returned effects:** The next step is whatever the runtime returns: another `open_round`, a `run_lateral_panel` milestone, or `request_closure_audit`.
6. **Closure:** On `request_closure_audit`, do an independent audit. Recommended dispatch: `momus`, because its OKAY/ITERATE/REJECT lens fits closure. Short prompt: `Review the transcript, scores, facts, topology, and threshold. Return OKAY only if every active chunk is clear enough, no disputed fact remains, and the spec can be safely written; return ITERATE with the single next gap; return REJECT only for a contract violation.` Send `audit_closure {passed,...}`. The runtime mechanically rejects passing above threshold unless hard-cap or early-exit applies, and rejects unresolved disputed facts.
7. **Restate:** On `request_restate`, show the whole agreement plainly and ask one confirmation question. Send `confirm_restate`. Corrections become normal rounds; after two failed loops the runtime returns to the interview loop.
8. **Write spec:** On `write_spec`, load `spec-template.md` and render every heading. Send `write_spec` with an explicit user-approved directory and safe slug. The CLI persists atomically and returns `path` plus `sha256`; show both.
9. **After write:** Present an approval-gated next step, such as refining the spec into a plan. NEVER auto-start implementation.

## Early exit and limits

- The user may stop any time by sending `user_stop`.
- Host-initiated wrap-up uses `request_closure`; the runtime enforces at least 3 scored rounds unless soft warning or hard cap applies.
- Round 10 is a soft warning; explain plainly that the interview is taking longer and focus the next question.
- Round 100 is a hard cap; explain plainly and follow the returned closure-audit path.

## Progressive disclosure

| Fragment | Load exactly when |
|---|---|
| `plain-language.md` | At `initialize`; keep loaded for all user-facing text. |
| `scoring.md` | Every `score_answer`. |
| `auto-research-greenfield.md` | Greenfield factual question where research can substitute for a user decision; dispatch `metis`. |
| `auto-answer-uncertain.md` | User opts out or asks the agent to decide; dispatch `metis`. |
| `lateral-review-panel.md` | Every `run_lateral_panel` effect. |
| `spec-template.md` | After closure and restatement pass, when rendering the spec. |

Fragments are private: no frontmatter, never public commands, never loaded at startup unless the table says so.

## Agent dispatch

| Agent | Use |
|---|---|
| `analyst` → `metis` | Panel researcher + contrarian lens; also use `metis` for auto-research and auto-answer. |
| `critic` → `momus` | Panel simplifier + architect lens; also use `momus` for closure audit. |

On harnesses without these agents, load the fragment file as the full prompt for a read-only forked context.

## Language mandate

EVERYTHING the user sees follows `plain-language.md`: plain Korean when the user speaks Korean, numbers explained in one plain line, and jargon only in agent-internal protocol text. Keep the user's own wording when it is clear.

Scoring model adapted from gajae-code deep-interview (MIT).
