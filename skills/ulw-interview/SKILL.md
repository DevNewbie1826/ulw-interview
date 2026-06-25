---
name: ulw-interview
description: Socratic deep interview with mathematical ambiguity scoring. Asks one targeted question at a time to expose hidden assumptions, scores clarity across weighted dimensions via a deterministic runtime, and repeats until ambiguity drops below threshold. Produces a spec document. Use when the user has a vague idea, says "interview me", "ask me everything", "don't assume", "make sure you understand", or wants validated clarity before committing to execution.
---

# ULW Interview

## Purpose

AI can build anything. The hard part is knowing what to build. This skill applies Socratic methodology to iteratively expose assumptions and mathematically gate readiness, ensuring genuine clarity before execution cycles are spent.

The output is a **spec document** at `.omo/specs/ulw-interview-{slug}.md` — not code, not a plan, not an implementation.

## When To Use

- User has a vague idea and wants thorough requirements gathering before execution
- User says "interview me", "ask me everything", "don't assume", "make sure you understand"
- User says "I have a vague idea", "not sure exactly what I want"
- User wants to avoid "that's not what I meant" outcomes
- Task is complex enough that jumping to code would waste cycles on scope discovery

## When NOT To Use

- User has a detailed, specific request with file paths, function names, or acceptance criteria — execute directly
- User wants a quick fix or single change
- User says "just do it" or "skip the questions" — respect their intent
- User already has a plan file and explicitly asks to execute it

## Execution Policy

- **Ask ONE question at a time** — never batch multiple questions
- **Target the WEAKEST clarity dimension** with each question
- **Score ambiguity after every answer** — display the score transparently
- **Use the `question` tool for all user-facing questions:** write context, score tables, and explanations as normal chat text, then call the `question` tool with a short question + 2-4 options. This gives the user a clear visual signal that a response is needed. Long prose stays in the chat body; the question tool carries only the decision itself. The only exception is announcements (Round 0.5 scoring complete, spec generated, etc.) which are informational and do not use the tool.
- **Gather codebase facts before asking about them** — dispatch `explore` for brownfield context before asking the user what the code already reveals
- **Facts vs decisions:** answer factual questions (current stack, versions, existing patterns) from `explore`/`librarian` and present them as cited confirmations; route every *decision* (goals, scope, tradeoffs, desired behavior) to the user. When unsure which a question is, treat it as a decision and ask.
- **Do not proceed to spec generation until ambiguity ≤ threshold** (default 5%) and the user confirms
- **Allow early exit** with a clear warning if ambiguity is still high
- **Default to English** unless the user's language is obvious from context
- **Dialectic rhythm guard:** track a streak counter — increment when a round resolves without direct user judgment (agent-confirmed facts from `explore`/`librarian`); reset to 0 on any direct user answer. If the streak reaches 3, route the next question directly to the user even if it looks auto-answerable. The interview is with the human, not the codebase.
- **Multi-component targeting:** when the locked topology has multiple active components, rotate targeting across active components rather than drilling into one — depth-first clarity on one component must not hide ambiguity in siblings.
- **Lateral review panel at milestones:** convene a multi-persona panel at ambiguity-milestone transitions to expose blind spots from independent perspectives (see Phase 2 Step 4b).

## Runtime Contract (authoritative)

All numerical scoring, validation, band classification, stall detection, and trigger math is delegated to a deterministic runtime under `references/runtime/`. The LLM NEVER computes ambiguity by hand. The runtime is the source of truth; if prose and runtime disagree, the runtime is correct.

**Required pipeline at every scoring step:**
1. Dispatch `oracle` with the transcript and the scoring prompt.
2. Pipe raw oracle output through `node references/runtime/validate.mjs --expected-type=<greenfield|brownfield>`. The CLI arg is authoritative — pass the type detected in Phase 1 Step 2. If `ok: false`, re-dispatch once with the `retryHint`. If still failing, fall back to conservative scores (all dims 0.5), set `degraded: true`, and continue. The output exposes `scoreClamped` and `clampedFields` so downstream decisions can observe clamping.
3. Pipe the normalized output (plus prior state) through `node references/runtime/scorer.mjs`. Use the JSON output for all subsequent decisions.

**What the LLM still owns:** question generation, topology enumeration, lateral panel dispatch (subject to scorer's `nextPanelEligible` flag and the per-interview panel ceiling), closure judgment, and the restate gate.

**Transcript compression (mandatory above 4000 tokens):** before each oracle scoring dispatch, if the accumulated transcript exceeds 4000 tokens, compress the OLDEST half via a separate oracle call (`Summarize the following interview Q&A rounds in ≤500 tokens, preserving every confirmed decision, every fired trigger, and every score change.`) and replace those rounds in the working transcript with the summary. Keep the last 2 rounds verbatim. This bounds per-round oracle cost growth from O(n²) to O(n) without losing decisions. The full uncompressed transcript is still written to the final spec.

See `references/runtime/README.md` for the full contract, constants, and fallback policy.

## Phase 0: Resolve Threshold (blocking)

Complete this before anything else — before initialization, before the first question, before any scoring.

1. Read `omo.ulwInterview.ambiguityThreshold` from `.omo/settings.json`. Default: `0.05` (95% clarity required).
2. **Validate threshold.** The runtime enforces `(1e-6, 0.30]`. If the configured value is missing or malformed, use the default `0.05`. If the configured value is ≤ 0 or > 0.30, pass it to `scorer.mjs` unchanged — the runtime clamps and reports via `thresholdClamped: true` in the output. The source label becomes `.omo/settings.json | default (missing)` or `.omo/settings.json | clamped by runtime` accordingly. Do not silently substitute `0.05` for out-of-range values; let the runtime handle it deterministically.
3. Calculate the percentage form (e.g. `0.05` → `95%`).
4. Emit the required first line to the user before any other announcement:

```
ULW Interview threshold: 95% (source: .omo/settings.json | default)
```

5. Carry the threshold forward mechanically through every step. Do not hardcode. Pass it as the `threshold` field of every `scorer.mjs` invocation.

**Recommended threshold:** `0.05` is the high-rigor mode for safety/compliance specs. For most product-discovery interviews, `0.10` (90% clarity) is recommended; configure via the same settings path.

## Phase 1: Initialize

1. **Validate and parse the user's idea** from the skill arguments. If arguments are empty or whitespace-only, emit `ULW Interview: no idea provided. Re-invoke with your idea as the argument.` and STOP. Do not enter Round 0.

2. **Detect brownfield vs greenfield:**
   - Dispatch `explore` to check if cwd has existing source code relevant to the idea.
   - If source exists AND the idea references modifying/extending something: **brownfield**.
   - Otherwise: **greenfield**. Store the result as `declaredType` — pass it to every `validate.mjs --expected-type=<declaredType>` invocation.

3. **For brownfield:** use `explore` to map relevant codebase areas (file paths, patterns, conventions). Store findings as context. Use this to avoid asking the user what the code already reveals.

4. **Announce the interview:**

```
ULW Interview threshold: <percent>% (source: <source>)

Starting interview. I'll ask targeted questions to understand your idea thoroughly. After each answer, I'll show your clarity score. We'll proceed to spec generation once ambiguity drops below <percent>%.

**Your idea:** "{initial_idea}"
**Project type:** {greenfield|brownfield}
**Current ambiguity:** 100% (we haven't started yet)
```

## Round 0: Topology Enumeration Gate

Run this gate exactly once after Phase 1 initialization and before any Phase 2 ambiguity scoring. The goal is to lock the **shape** of the scope before depth-first questioning can overfit to the most-described component.

1. **Enumerate candidate top-level components** from the initial idea and brownfield context:
   - Extract top-level verbs/nouns, workstreams, surfaces, or deliverables that can succeed or fail independently.
   - Prefer 1-6 components. If more than 6 candidates appear, group siblings at the highest useful level.
   - **Decomposition preference (tie-breaker):** prefer user-facing surfaces or deliverables (what the user thinks of as outcomes) over implementation subsystems (what the engineer thinks of as modules). If ambiguous, ask the user which framing they want. This reduces cross-agent divergence on topology shape.
   - Do not treat implementation tasks or sub-features as top-level components unless the user framed them as independent outcomes.

2. **Write the topology as chat text**, then ask via the `question` tool:

Chat text (written before the tool call):
```
Round 0 | Topology confirmation | Ambiguity: not scored yet

I'm reading this as {N} top-level component(s):
1. {component_name}: {one_sentence_description}
2. ...
```

Then call the `question` tool:
```json
{
  "questions": [{
    "header": "Round 0 | Topology",
    "question": "Is this topology right? Should any component be added, removed, merged, split, or deferred?",
    "options": [
      { "label": "Looks right", "description": "Proceed with these components" },
      { "label": "Add/remove/merge", "description": "Adjust the component list" },
      { "label": "Defer one or more", "description": "Remove a component from this interview's scope" }
    ]
  }]
}
```
The tool auto-adds a free-text option, so the user can always type a custom response.

3. **Lock topology** after the answer. Carry the confirmed component list through Phase 2 scoring. If the user confirms one component, Phase 2 proceeds normally. If multiple components are confirmed, Phase 2 must ask follow-up questions until every active component has sufficient goal/constraint/criteria clarity.

4. **Topology refusal fallback.** If the user explicitly refuses to confirm any topology (says "I don't know" / "you decide" / "whatever you think" on **two consecutive** prompts), the agent falls back to a single-component topology covering the entire idea, announces `Round 0 | Topology fallback | single-component mode (user declined to confirm)`, and continues. Note the fallback in the transcript and resume normal targeting in Round 0.5.

5. **Topology reopen protocol (trigger D).** If a Phase 2 answer fires trigger D — scope expansion — the new entity is added to the active topology. Run Round 0.5 initial scoring for the new entity (below). If active components exceed 6 after addition, ask the user to merge or defer before continuing Phase 2.

## Round 0.5: Initial Scoring (bootstrap)

Run this exactly once after Round 0 topology lock, BEFORE Phase 2 Round 1. Without this step, Round 1 cannot identify "the dimension with the LOWEST clarity score" because no scores exist yet.

1. For each locked active component, dispatch `oracle` ONCE with the original idea, the topology, and the brownfield context (if any). Ask for per-component dimension scores using the same prompt as Phase 2 Step 3.
2. Pipe each oracle response through `validate.mjs` then assemble the input state and pipe through `scorer.mjs`.
3. Set state variables: `priorBand = band`, `priorAmbiguity = globalAmbiguity`, `priorRounds = [globalAmbiguity]`, `priorBandHistory = [band]`, `streakCounter = 0`, and `scoreStateMatrix` = per-component scores from this round.
4. Announce to the user:

```
Round 0.5 | Initial scoring complete | Ambiguity: {globalAmbiguity}%

Seeded scores for {N} component(s). Round 1 will target {scorerOutput.nextTarget.component}/{scorerOutput.nextTarget.dimension} (the lowest pair).
```

5. Proceed to Phase 2 Round 1.


## Phase 2: Interview Loop

Repeat until `ambiguity ≤ threshold` OR user exits early:

### Step 1: Generate Next Question

Use `scorerOutput.nextTarget` verbatim — do not recompute the weakest pair in prose. The runtime selects the worst component (highest ambiguity) and its lowest-scoring required dimension deterministically, with alphabetical tie-breaks. Generate a question that specifically improves `nextTarget.dimension` for `nextTarget.component`. If `nextTarget` is null (only possible with empty topology, which the runtime rejects), stop and emit an error.

**Question targeting rules:**
- The component+dimension pair for the next question IS `scorerOutput.nextTarget`. Do not override it with your own analysis.
- If `forceUserQuestion: true` in the scorer output (dialectic rhythm guard fired), the next question MUST be routed directly to the user even if `nextTarget` looks auto-answerable. Reset by passing `lastRoundResolvedWithoutUser: false` on the next round.
- State, in one sentence before the question, why this component/dimension pair is now the bottleneck (use the perComponent scores from scorer output as evidence).
- Questions should expose ASSUMPTIONS, not gather feature lists.
- **Facts vs decisions:** if the question is factual (answerable from codebase/docs), answer it yourself via `explore` or `librarian` and present the finding as a cited confirmation. Only ask the user about decisions. After resolving factually, set `lastRoundResolvedWithoutUser: true` on the next scorer call.

**Question styles by dimension:**

| Dimension | Question Style | Example |
|-----------|---------------|---------|
| Goal Clarity | "What exactly happens when...?" | "When you say 'manage tasks', what specific action does a user take first?" |
| Constraint Clarity | "What are the boundaries?" | "Should this work offline, or is internet connectivity assumed?" |
| Success Criteria | "How do we know it works?" | "If I showed you the finished product, what would make you say 'yes, that's it'?" |
| Context Clarity (brownfield) | "How does this fit?" | "I found JWT auth middleware in `src/auth/`. Should this feature extend that path?" |

### Step 2: Ask the Question

Write the round context as chat text, then ask the actual question via the `question` tool.

**Chat text** (written before the tool call):
```
Round {n} | Component: {target_component_name} | Targeting: {target_dimension} | Ambiguity: {score}%

{one-sentence rationale for why this component/dimension is the bottleneck}
```

Then call the `question` tool:
```json
{
  "questions": [{
    "header": "Round {n} | {component}/{dimension}",
    "question": "{short, specific question text — one sentence}",
    "options": [
      { "label": "{option A}", "description": "{one-line hint}" },
      { "label": "{option B}", "description": "{one-line hint}" },
      { "label": "{option C}", "description": "{one-line hint}" }
    ]
  }]
}
```

**Rules:**
- The `header` must be short (max 30 chars): `Round {n} | {component}/{dimension}`.
- The `question` field carries the actual question — keep it to one or two sentences.
- Provide 2-4 contextually relevant options. The tool auto-adds free-text, so users can always type their own.
- If `forceUserQuestion: true` (dialectic rhythm guard), still use the `question` tool but with minimal options — the point is to force a direct user response.
- Score tables and progress reports (Step 4) remain as normal chat text, NOT in the question tool.

### Step 3: Score Ambiguity

After receiving the answer, score clarity across all dimensions.

**Ambiguity is BIDIRECTIONAL and NON-MONOTONIC.** A later answer can increase ambiguity when it invalidates, weakens, or expands prior understanding.

**Ambiguity-raising triggers:**
- **A — direct contradiction:** the answer contradicts an established fact.
- **B — internal inconsistency:** two requirements that cannot co-hold are now present.
- **C — low-quality/evasive:** the answer avoids, hand-waves, or fails to resolve the targeted gap.
- **D — scope expansion:** the answer adds a component, entity, constraint, or deliverable not already covered (also fires the topology-reopen protocol from Round 0 Step 5).

When a trigger fires, append it to the `triggers` array passed to `scorer.mjs` with the targeted `component` and `dim`. The runtime applies a fixed -0.15 delta per fired trigger (stacking, floored at 0.0); the weighted formula then raises ambiguity automatically. The LLM never applies penalties by hand.

**Scoring pipeline (mandatory — never compute by hand):**

1. Dispatch `oracle` with the transcript and this prompt:

```
Given the following interview transcript for a {greenfield|brownfield} project,
score clarity on each dimension from 0.0 to 1.0.

Original idea: {idea}
Transcript: {all rounds Q&A}
Established facts: {confirmed decisions so far}
Active topology component being scored this round: {component_name}

Score each dimension:
1. Goal Clarity (0.0-1.0): Is the primary objective unambiguous? Can you state it
   in one sentence without qualifiers?
2. Constraint Clarity (0.0-1.0): Are the boundaries, limitations, and non-goals clear?
3. Success Criteria (0.0-1.0): Could you write a test that verifies success? Are
   acceptance criteria concrete?
4. Context Clarity (0.0-1.0): [brownfield only] Do we understand the existing system
   well enough to modify it safely?

For each dimension provide:
- score: float (0.0-1.0)
- justification: one sentence
- gap: what's still unclear (if score < 0.9)

Also identify:
- weakest_dimension: the single lowest-confidence dimension this round
- weakest_dimension_rationale: one sentence explaining why this is the highest-leverage
  target for the next question
- triggers: array of {dim, type} where dim is goal|constraints|criteria|context and
  type is A|B|C|D. Empty array if none fired.

Respond as STRICT JSON only. No prose, no code fences. All scores in [0,1].
```

2. Pipe raw oracle output through `node references/runtime/validate.mjs --expected-type=<declaredType>`. The output exposes `scoreClamped`, `clampedFields`. If `ok: false`, re-dispatch once with the `retryHint`. If still failing, fall back to all-scores-0.5, set `degraded: true`, and continue. **Propagate** `scoreClamped` from validate output into the scorer input as `validationScoreClamped` so downstream sees clamping that happened pre-scorer.

3. Assemble the scorer input — **include EVERY active component, not just the current round's component**. The MAX aggregation rule only works if all components are scored together. The current round's component gets fresh normalized scores from validate.mjs; every other active component carries forward its last-known scores from `scoreStateMatrix`.
```json
{
  "threshold": <Phase 0 threshold>,
  "type": "greenfield" | "brownfield",
  "components": [
    { "name": "<this round's component>", "scores": <fresh normalized scores from validate.mjs> },
    { "name": "<other active component>", "scores": <last-known scores from scoreStateMatrix> }
    // ...one entry per active component
  ],
  "priorAmbiguity": <previous globalAmbiguity>,
  "priorBand": <previous band>,
  "priorRounds": <array of previous globalAmbiguity values>,
  "priorBandHistory": <array of previous bands, oldest-first>,
  "priorPanelRound": <round number of last panel dispatch>,
  "currentRound": <this round number>,
  "triggers": <triggers from validate.mjs, each augmented with component name and dim>,
  "validationScoreClamped": <boolean from validate.mjs output>,
  "streakCounter": <previous streakCounter from scorer output>,
  "lastRoundResolvedWithoutUser": <true if this round was resolved via explore/librarian without direct user judgment>,
  "degraded": <true if validation fallback was used>
}
```

4. Pipe through `node references/runtime/scorer.mjs`. Read the JSON output. Fields: `globalAmbiguity`, `band`, `bandChanged`, `stallDetected`, `ready`, `skipToSpec`, `nextPanelEligible`, `suppressPanelForOscillation`, `dispatchPanel` (= `nextPanelEligible && !suppressPanelForOscillation && bandChanged`), `coverageGaps` (array of `component/dim: score < 0.9` or `component/dim: missing` strings — drives closure guard), `thresholdClamped`, `scoreClamped`, `validationScoreClamped`, `negativeAmbiguityClamped`, `streakCounter`, `forceUserQuestion`, `nextTarget` (`{ component, dimension }` — authoritative target for the next question; do not recompute in prose).

5. **Update `scoreStateMatrix[currentComponent]`** with the `perComponent` entry whose `name` matches. Other components' entries in scoreStateMatrix are unchanged this round.

6. **Append `globalAmbiguity` to `priorRounds` and `band` to `priorBandHistory`** for the next round's stall and oscillation detection. Update `streakCounter` from scorer output.


**Aggregation rule (C2 fix):** Global ambiguity is the MAX of per-component ambiguities — the worst component gates readiness. A clear component cannot mask an unclear sibling.

**Formulas (reference only — runtime is authoritative):**
- Greenfield: `ambiguity = 1 - (goal × 0.40 + constraints × 0.30 + criteria × 0.30)`
- Brownfield: `ambiguity = 1 - (goal × 0.35 + constraints × 0.25 + criteria × 0.25 + context × 0.15)`

Brownfield adds a 15% Context Clarity dimension because safely modifying existing code requires understanding the system being changed. Note: with all other dims perfect, brownfield requires context ≥ ~0.667 to reach the default 0.05 threshold.

### Step 4: Report Progress

After scoring, show the user:

```
Round {n} complete.

| Dimension | Score | Weight | Weighted | Gap |
|-----------|-------|--------|----------|-----|
| Goal | {s} | {w} | {s*w} | {gap or "Clear"} |
| Constraints | {s} | {w} | {s*w} | {gap or "Clear"} |
| Success Criteria | {s} | {w} | {s*w} | {gap or "Clear"} |
| Context (brownfield) | {s} | {w} | {s*w} | {gap or "Clear"} |
| **Ambiguity** | | | **{prior}% → {score}% {↑|↓|flat}** | {trigger name if up} |

**Next target:** {scorerOutput.nextTarget.component}/{scorerOutput.nextTarget.dimension} — {rationale from perComponent scores}

{score <= threshold ? "Clarity threshold met! Ready to generate spec." : "Focusing next question on: {scorerOutput.nextTarget.component}/{scorerOutput.nextTarget.dimension}"}
```

### Step 4b: Lateral Review Panel (milestone-triggered)

After scoring, check if the ambiguity **milestone band** changed versus the prior round:

| Band | Ambiguity |
|------|-----------|
| `initial` | > 0.60 |
| `progress` | 0.60 ≥ a > 0.30 |
| `refined` | 0.30 ≥ a > threshold |
| `ready` | ≤ threshold |

A transition occurs whenever the band changes — in either direction, since bidirectional scoring can move it back up. On a transition, convene the panel before generating the next question.

**Personas (dispatch in parallel via `oracle`, independent context each):**
- `researcher` — surfaces external facts, prior art, and version/compatibility constraints the interview depends on.
- `contrarian` — challenges the core assumption: "What if the opposite were true? Is this constraint real or habitual?"
- `simplifier` — probes whether complexity can be removed: "What is the simplest version that is still valuable?"
- `architect` — only when scope changed (trigger D, new component, ownership change): checks system shape, ownership, and integration impact.

Dispatch each persona as a separate `oracle` call with its own copy of the prompt-safe context (transcript summary + current scores + locked topology) so no persona anchors on another's framing. Ask each for: one concrete blind spot or unsettled decision, 1-3 suggested answer options for the next question, and confidence (high/medium/low).

**Folding findings:** validate each response, then fold concrete findings into the next single user-facing question as 2-3 ranked answer options or one recommended draft. The panel never adds a second question, never mutates requirements, and never marks the interview complete. The one-question-per-round rule stays intact.

**Ontology escalation:** if ambiguity stalls (same score ±0.05 for 3 rounds) or stays > 0.30 after 8 rounds, instruct `contrarian` + `architect` to ask "What IS this, really?" — identify the core entity versus supporting views before returning to feature questions.

**Panel cooldown and ceiling (cost controls):**
- A panel cannot fire within `panelCooldown` (default 2) rounds of the previous panel. Check `dispatchPanel` (= `nextPanelEligible && !suppressPanelForOscillation && bandChanged`) in the scorer output. If false, skip the panel and note the cooldown, oscillation suppression, or unchanged band in the transcript.
- Per-interview panel ceiling: 6 persona-dispatches total. Override via `.omo/settings.json` `omo.ulwInterview.panelCeiling`. After the ceiling, panels are skipped and the agent notes the degradation.
- Bidirectional band oscillation: the scorer reports `suppressPanelForOscillation: true` when the same band-edge has been crossed 2+ times in the last 4 transitions. When true, the panel is suppressed regardless of cooldown.

**Stall detection (deterministic):** the runtime computes `stallDetected` as a windowed max-min over the last 3 global ambiguities ≤ 0.05. The LLM does not compute this. On `stallDetected: true`, fire ontology escalation.

**Mid-panel cancellation:** if the user says "stop" / "cancel" / "abort" while a panel is mid-flight, abort the panel, discard any partial results, and terminate the interview per the Escalation section.

### Step 5: Check Limits

- **Round 3+:** Allow early exit if user says "enough", "let's go", "build it". **High-ambiguity early exit:** if `globalAmbiguity > threshold + 0.20` at the moment of early exit, emit an **Incomplete Spec Report** (Phase 3 Step 5) instead of a normal spec — the closure guard cannot rescue this much ambiguity.
- **Round 10:** Soft warning — "We're at 10 rounds. Current ambiguity: {score}%. Continue or proceed with current clarity?"
- **Round 20:** Hard cap — "Maximum interview rounds reached." Round 0 and Round 0.5 do NOT count toward this cap; it counts Phase 2 rounds only.
- **All dimensions of all components ≥ 0.9 AND threshold met:** Skip to Phase 3. (The scorer's `skipToSpec` flag fires only when both conditions hold — this resolves the prior contradiction where 0.9 dims at threshold 0.05 produced ambiguity 0.10.)
- **Precedence on conflict:** Hard cap > closure guard. If Round 20 is reached and the closure guard rejects, emit an Incomplete Spec Report (see Phase 3 Step 5) and stop — do not loop back to Phase 2.

## Phase 3: Generate Spec

When ambiguity ≤ threshold (or hard cap / early exit):

1. **Closure / Acceptance Guard.** Precedence: Round 20 hard cap > closure guard > readiness math. Even when scorer reports `ready: true`, do not treat the math as completion. Run an independent readiness audit via `oracle`. **Mechanical coverage check:** read `coverageGaps` from the last scorer output — if it is non-empty, the closure guard REJECTS and the highest-priority gap drives the next question. Otherwise the oracle audit checks: no unresolved or disputed trigger remains, and no agent-confirmed fact is standing in for user-confirmed truth (route these to the user). If the oracle audit finds a material gap, override the gate to the user — "The math says ready, but I am not accepting it yet because {gap}" — ask the single highest-impact follow-up, and return to Phase 2. **Retry cap:** the closure guard may reject at most 2 times. After the 2nd rejection, OR if Round 20 has been reached, OR if the user invoked early exit with `globalAmbiguity > threshold + 0.20`, emit an **Incomplete Spec Report** (see Phase 3 Step 5) instead of looping. When returning to Phase 2 from the closure guard, the round number CONTINUES (does not reset) and re-entry targets the specific component/dimension flagged as the gap.

2. **Restate gate.** Once closure passes, collapse the agreed answers into ONE sentence goal that covers every active component. Write the goal as chat text, then confirm via the `question` tool:

Chat text:
```
**Crystallized goal:** {one-sentence goal}
```

Then call the `question` tool:
```json
{
  "questions": [{
    "header": "Goal confirmation",
    "question": "If someone read only this line, would they reach the same outcome you have in mind?",
    "options": [
      { "label": "Yes, crystallize", "description": "Proceed to spec generation with this goal" },
      { "label": "Adjust wording", "description": "The goal is right but the phrasing needs work" },
      { "label": "Missing scope", "description": "The goal leaves something out" }
    ]
  }]
}
```
On "Adjust wording" or "Missing scope", collect the correction, route it back through Phase 2 scoring (a correction can change ambiguity), and re-run both gates. Cap at two loops; if alignment is not reached, return to Phase 2.


3. **Generate the specification** from the full interview transcript. Write it to `.omo/specs/ulw-interview-{slug}.md` using the `write` tool.

**Spec structure:**

```markdown
# Spec: {title}

## Metadata
- Rounds: {count}
- Final Ambiguity: {score}%
- Type: greenfield | brownfield
- Threshold: {threshold}
- Generated: {timestamp}

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | {s} | {w} | {s*w} |
| Constraint Clarity | {s} | {w} | {s*w} |
| Success Criteria | {s} | {w} | {s*w} |
| Context Clarity | {s} | {w} | {s*w} |
| **Ambiguity** | | | **{1-total}** |

## Goal
{crystal-clear goal statement derived from interview}

## Constraints
- {constraint 1}
- {constraint 2}

## Non-Goals
- {explicitly excluded scope 1}

## Acceptance Criteria
- [ ] {testable criterion 1}
- [ ] {testable criterion 2}

## Technical Context
{brownfield: relevant codebase findings from explore}
{greenfield: technology choices and constraints}

## Interview Transcript
<details>
<summary>Full Q&A ({n} rounds)</summary>

### Round 1
**Q:** {question}
**A:** {answer}
**Ambiguity:** {score}%

...

</details>
```

4. **Stop.** The spec is the deliverable. Do NOT auto-invoke execution. The user can take the spec to `/ulw-plan` for planning or proceed however they choose.

## Phase 3 Step 5: Incomplete Spec Report

Emit this INSTEAD of a normal spec when:
- Round 20 hard cap reached AND closure guard rejects, OR
- Closure guard rejected 2 times, OR
- User says "enough" / "let's go" / "build it" early-exit AND `globalAmbiguity > threshold + 0.20` (high-ambiguity early exit), OR
- User says "stop" / "cancel" / "abort" mid-interview with `globalAmbiguity > threshold`.

The Incomplete Spec Report uses the normal spec structure with these substitutions:
- Replace `## Acceptance Criteria` with `## Unresolved Gaps` listing each open component/dimension and why it remains unclear.
- Add `## Recommended Next Steps` with 1-3 concrete suggestions (e.g., "Re-run interview focused on Component X", "Resolve contradiction between offline requirement and real-time sync requirement").
- Set the metadata `Status: incomplete` field.

The report is still written to `.omo/specs/ulw-interview-{slug}.md`. The user takes it from there.

## State Variables

These MUST be initialized at Phase 1 and updated through every round. The runtime depends on them.

| Variable | Init | Updated by |
|---|---|---|
| `confirmedTopology` | `[]` | Round 0 lock, Round 0 reopen protocol |
| `deferredComponents` | `[]` | Round 0 user choice |
| `currentRound` | `0` | Each Phase 2 round (Round 0 and Round 0.5 do NOT increment this) |
| `priorBand` | `null` | Round 0.5, every Phase 2 round |
| `priorAmbiguity` | `null` | Round 0.5, every Phase 2 round |
| `priorRounds` | `[]` | Every Phase 2 round (append `globalAmbiguity`) |
| `priorBandHistory` | `[]` | Every Phase 2 round (append `band`) — drives oscillation suppression |
| `scoreStateMatrix` | `{}` (Map: component name → last-known scores) | Round 0.5, every Phase 2 round (current component's scores refreshed) |
| `priorPanelRound` | `-3` | Every panel dispatch |
| `panelDispatchCount` | `0` | Every panel dispatch (against the ceiling) |
| `closureRejections` | `0` | Each closure-guard rejection |
| `streakCounter` | `0` | Dialectic rhythm guard |
| `degraded` | `false` | Validation fallback |
| `declaredType` | set in Phase 1 Step 2 | Sticky — drives `validate.mjs --expected-type` |
| `slug` | derived at Phase 3 from final one-sentence goal | kebab-case, ASCII only, max 60 chars. If `.omo/specs/ulw-interview-{slug}.md` exists, append `-2`, `-3`, … until path is free. |
| `timestamp` | ISO 8601 UTC at spec write | Phase 3 Step 3 |

## Configuration

Optional settings in `.omo/settings.json`:

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

| Key | Default | Valid range | Notes |
|---|---|---|---|
| `ambiguityThreshold` | `0.05` | `(0, 0.30]` | Out-of-range values are clamped by `scorer.mjs`. `0.10` recommended for product discovery; `0.05` for safety/compliance. |
| `panelCeiling` | `6` | positive integer | Total persona-dispatches allowed per interview. After ceiling, panels are skipped. |

## Escalation And Stop Conditions

- **Hard cap at 20 rounds:** Proceed with whatever clarity exists, noting the risk.
- **Soft warning at 10 rounds:** Offer to continue or proceed.
- **Early exit (round 3+):** Allow with warning if ambiguity > threshold.
- **User says "stop" / "cancel" / "abort":** Stop immediately.
- **Ambiguity stalls** (`scorer.mjs` reports `stallDetected: true`): Reframe — ask "What IS the core thing here?" before continuing with detail questions. The runtime computes this as windowed max-min over the last 3 global ambiguities ≤ 0.05; the LLM never computes it by hand.
- **Codebase exploration fails:** Proceed as greenfield, note the limitation.
