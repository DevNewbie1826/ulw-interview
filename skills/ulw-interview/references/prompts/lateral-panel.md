# Lateral Review Panel

Convened at ambiguity-milestone transitions (Phase 2 Step 4b) and before synthesizing any agent-supplied answer. Each persona is a read-only `oracle` call with independent context.

## Milestone bands

| Band | Ambiguity |
|------|-----------|
| `initial` | > 0.60 |
| `progress` | 0.60 ≥ a > 0.30 |
| `refined` | 0.30 ≥ a > threshold |
| `ready` | ≤ threshold |

A transition occurs whenever the band changes — in either direction, since bidirectional scoring can move it back up.

## Personas (dispatch in parallel, independent context each)

- **`researcher`** — surfaces external facts, prior art, and version/compatibility constraints the interview depends on.
- **`contrarian`** — challenges the core assumption: "What if the opposite were true? Is this constraint real or habitual?"
- **`simplifier`** — probes whether complexity can be removed: "What is the simplest version that is still valuable?"
- **`architect`** — only when scope changed (trigger D, new component, ownership change): checks system shape, ownership, and integration impact.

Dispatch each persona as a separate `oracle` call with its own copy of the prompt-safe context (transcript summary + current scores + locked topology) so no persona anchors on another's framing. Ask each for: one concrete blind spot or unsettled decision, 1-3 suggested answer options for the next question, and confidence (high/medium/low).

## Folding findings

Validate each response, then fold concrete findings into the next single user-facing question as 2-3 ranked answer options or one recommended draft. The panel never adds a second question, never mutates requirements, and never marks the interview complete. The one-question-per-round rule stays intact.

## Ontology escalation

If ambiguity stalls (same score ±0.05 for 3 rounds) or stays > 0.30 after 8 rounds, instruct `contrarian` + `architect` to ask "What IS this, really?" — identify the core entity versus supporting views before returning to feature questions.

## Panel cooldown and ceiling (cost controls)

- A panel cannot fire within `panelCooldown` (default 2) rounds of the previous panel. Check `dispatchPanel` (= `nextPanelEligible && !suppressPanelForOscillation && bandChanged`) in the scorer output. If false, skip the panel and note the cooldown, oscillation suppression, or unchanged band in the transcript.
- Per-interview panel ceiling: 30 persona-dispatches total (default; was 20, raised to match `roundCap` default of 30). Override via `.omo/settings.json` `omo.ulwInterview.panelCeiling`. **Before dispatching:** compute `remaining = panelCeiling - panelDispatchCount`. If `remaining <= 0`, skip the panel entirely. If `remaining < 4` (not enough for all personas), dispatch only the highest-priority personas that fit and note the degradation.
- Bidirectional band oscillation: the scorer reports `suppressPanelForOscillation: true` when the same band-edge has been crossed 2+ times in the last 4 transitions. When true, the panel is suppressed regardless of cooldown.

## Stall detection (deterministic)

The runtime computes `stallDetected` as a windowed max-min over the last 3 global ambiguities ≤ 0.05. The LLM does not compute this. On `stallDetected: true`, fire ontology escalation.

## Mid-panel cancellation

If the user says "stop" / "cancel" / "abort" while a panel is mid-flight, abort the panel, discard any partial results, and terminate the interview per the Escalation section.
