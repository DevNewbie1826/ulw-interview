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
- **Detect the user's language** per Communication Style Rule 7; default to English only before the first user message
- **Dialectic rhythm guard:** track a streak counter — increment when a round resolves without direct user judgment (agent-confirmed facts from `explore`/`librarian`); reset to 0 on any direct user answer. If the streak reaches 3, route the next question directly to the user even if it looks auto-answerable. The interview is with the human, not the codebase.
- **Multi-component targeting:** when the locked topology has multiple active components, rotate targeting across active components rather than drilling into one — depth-first clarity on one component must not hide ambiguity in siblings.
- **Lateral review panel at milestones:** convene a multi-persona panel at ambiguity-milestone transitions to expose blind spots from independent perspectives (see Phase 2 Step 4b).

## Communication Style (user-facing text only)

**The user is not an engineer. Speak like you're explaining to a curious 12-year-old.**

### Internal vs user-facing language

Internal state, runtime calls, scorer fields, and trigger names are **never shown to the user**. Translate everything to plain language when writing chat text or `question` tool content.

| Internal concept | Say this to the user |
|---|---|
| "Ambiguity: 45%" | "About 55% of your idea is clear right now. 45% is still fuzzy." |
| "Round 0 Topology confirmation" | "Let me check if I got the big picture right" |
| "Round 0.5 Initial scoring" | "Here's what I've gathered so far" |
| "Component X / dimension Y targeting" | "The 'X' part is still unclear on 'Y'" |
| "Trigger A/B/C/D fired" | (don't mention — just ask the follow-up question) |
| "Band: initial/progress/refined/ready" | (don't mention — translate to a progress metaphor) |
| "Dialectic rhythm guard" | (don't mention — just ask the user) |
| "Coverage gaps" | "This part hasn't been decided in detail yet" |
| "Closure guard" | "Almost there! Just one last thing to check" |
| "Incomplete Spec Report" | "A few things are still unclear, so I'll write up what we have so far" |
| "goal" (dimension) | "what we're building" |
| "constraints" (dimension) | "boundaries / what's out of scope" |
| "criteria" (dimension) | "how we'll know it's done" |
| "context" (dimension) | "how it fits with existing code" |

### Rules

1. **Short sentences.** One idea per sentence. Max ~20 words each.
2. **No jargon.** Replace every technical term with an everyday word. If you must use a technical term (e.g., "API"), explain it in parentheses: "API (how programs talk to each other)".
3. **Show progress as a percentage with feeling.** Instead of "Ambiguity: 30%", say "About 70% of your idea is clear now! It's getting sharper." Use the score table for precision (the user can read it), but add a one-sentence plain-language summary.
4. **Explain WHY each question matters.** Before asking, say what you'll learn from the answer and how it helps. Example: "If you answer this, I'll know exactly which devices it needs to work on."
5. **Use analogies.** "This is like building a house out of Lego — you have to make the foundation solid first."
6. **Be friendly and encouraging.** "Great answer!", "Ah, I see — that makes sense now.", "Almost there!"
7. **Respect the user's language.** This rule is authoritative; the Execution Policy and Phase 0 defer to it. The plain-language rules above apply in whatever language you use.
   - **Detect & default.** Detect the user's language from their messages and reply in that same language. Default to English only before the first user message.
   - **Translate naturally.** The English user-facing templates are the source of truth for content. Translate them naturally — preserve meaning, tone, and every required element, but use idiomatic target-language phrasing. Literal word-for-word translation is not required.
   - **Preserve byte-for-byte.** Operators, braces, placeholders (`{name}`), JSON keys, runtime field names, and structural syntax (ternary `? :`, concatenation `+`) stay unchanged. Natural-language string *literals* inside expressions (e.g. the quoted branches of a ternary) translate. Code blocks containing oracle prompts, JSON schemas, runtime input/output contracts, spec templates, or config examples stay unchanged entirely except where prose placeholders appear inside them.
   - **Question tool JSON.** Keys and schema stay English; `header`/`question`/`label`/`description` string values translate.
   - **Code-fence taxonomy.** Each fenced block in this skill is one of: (1) user-facing chat text or `question` tool JSON example → translate per above; (2) oracle prompt (labeled "Dispatch `oracle` with...") → preserve; (3) runtime JSON input/output schema → preserve; (4) final spec template (Phase 3 Step 3) → preserve markdown structure, metadata field names, and code; translate prose content of Goal/Constraints/Non-Goals/Acceptance Criteria/Technical Context; (5) configuration JSON example → preserve.
   - **Control-flow phrases.** Exit/stop/cancel detection (referenced in Phase 2 Step 5, Phase 3 Step 5, and Escalation) is semantic. Match phrases like "enough", "let's go", "build it", "stop", "cancel", "abort" by semantic equivalent in the user's language, not literal English strings.
   - **Pluralization & numbers.** Render counts in the target language's grammatical form (e.g. "1 main part" / "2 main parts" / Russian 1/2-4/5+ forms / Arabic dual). Do not use the English `(s)` hack.
   - **Mask runtime labels.** When interpolating a runtime value into prose, map it to plain language using the Internal vs user-facing table above (e.g. `{target_dimension}`="goal" → "what we're building", `{target_component_name}` → the user's own component label, `globalAmbiguity` → the percentage). Never expose raw field names to the user.
   - **Formality.** Match the user's formality level. Raise the register for Japanese *keigo*, French *vous*, Korean *jondaetmal* — even though the English templates are casual.
   - **RTL languages.** For Arabic, Hebrew, etc., adapt punctuation and prose layout per locale conventions. Score tables (Rule 8) stay LTR technical; add an RTL plain-language summary alongside. Wrap mixed-direction runs (LTR placeholders/code inside RTL prose) in Unicode bidi marks when needed for clean rendering.
8. **Score tables stay technical** (they're for precision), but always add a plain-language summary line below them.

## Runtime Contract (authoritative)

All numerical scoring, validation, band classification, stall detection, and trigger math is delegated to a deterministic runtime. The LLM NEVER computes ambiguity by hand. The runtime is the source of truth; if prose and runtime disagree, the runtime is correct.

**Path resolution (critical):** The runtime scripts live in the `references/runtime/` directory **next to this SKILL.md file**. The skill system exposes this file's location. Resolve `RUNTIME_DIR` as the directory containing SKILL.md + `/references/runtime/`. Invoke scripts as `node "$RUNTIME_DIR/validate.mjs"` and `node "$RUNTIME_DIR/scorer.mjs"`. Do NOT use bare `references/runtime/` — that only works if cwd is the skill directory.

**Required pipeline at every scoring step:**
1. Dispatch `oracle` with the transcript and the scoring prompt.
2. Pipe raw oracle output through `node "$RUNTIME_DIR/validate.mjs" --expected-type=<greenfield|brownfield>`. If `ok: false`, re-dispatch once with `retryHint`. If still failing, fall back to all-scores-0.5, set `degraded: true`. Output exposes `scoreClamped` and `clampedFields`.
3. Pipe the normalized output (plus prior state) through `node "$RUNTIME_DIR/scorer.mjs"`. Use the JSON output for all subsequent decisions.

**What the LLM still owns:** question generation, topology enumeration, lateral panel dispatch (subject to scorer's `nextPanelEligible` flag and the per-interview panel ceiling), closure judgment, and the restate gate.

**Transcript compression (mandatory above 4000 tokens):** before each oracle scoring dispatch, if the accumulated transcript exceeds 4000 tokens, compress the OLDEST half via a separate oracle call (see `references/prompts/oracle-scoring.md` for the compression prompt). Replace those rounds in the working transcript with the summary. Keep the last 2 rounds verbatim. This bounds per-round oracle cost growth from O(n²) to O(n) without losing decisions. The full uncompressed transcript is still written to the final spec.

See `references/runtime/README.md` (in the skill directory) for the full contract.

## Phase 0: Resolve Threshold (blocking)

Complete this before anything else — before initialization, before the first question, before any scoring.

1. Read `omo.ulwInterview.ambiguityThreshold` from `.omo/settings.json`. Default: `0.05` (95% clarity required).
2. **Validate threshold.** The runtime enforces `(1e-6, 0.30]`. If the configured value is missing or malformed, use the default `0.05`. If the configured value is ≤ 0 or > 0.30, pass it to `scorer.mjs` unchanged — the runtime clamps and reports via `thresholdClamped: true` in the output. The source label becomes `.omo/settings.json | default (missing)` or `.omo/settings.json | clamped by runtime` accordingly. Do not silently substitute `0.05` for out-of-range values; let the runtime handle it deterministically.
3. Calculate the percentage form (e.g. `0.05` → `95%`).
4. Emit the user-facing first line (plain language only — the technical details stay in the transcript, NOT shown to the user):

```
We'll keep going until your idea is about {percent}% clear. Let's start!
```

Write this line in the user's language per Communication Style Rule 7. The internal threshold value, source, and clamp status are recorded in the transcript but never shown to the user.

5. Carry the threshold forward mechanically through every step. Do not hardcode. Pass it as the `threshold` field of every `scorer.mjs` invocation.

**Recommended threshold:** `0.05` is the high-rigor mode for safety/compliance specs. For most product-discovery interviews, `0.10` (90% clarity) is recommended; configure via the same settings path.

## Phase 1: Initialize

1. **Validate and parse the user's idea** from the skill arguments. If arguments are empty or whitespace-only, emit `ULW Interview: no idea provided. Re-invoke with your idea as the argument.` (translated into the user's detected language per Rule 7, when the invoking message reveals one) and STOP. Do not enter Round 0.

2. **Detect brownfield vs greenfield:**
   - Dispatch `explore` to check if cwd has existing source code relevant to the idea.
   - If source exists AND the idea references modifying/extending something: **brownfield**.
   - Otherwise: **greenfield**. Store the result as `declaredType` — pass it to every `validate.mjs --expected-type=<declaredType>` invocation.

3. **For brownfield:** use `explore` to map relevant codebase areas (file paths, patterns, conventions). Store findings as context. Use this to avoid asking the user what the code already reveals.

4. **Announce the interview:**

```
Let's figure out exactly what you want to build!

I'll ask questions one at a time. After each answer, I'll show you how clear things are getting.
We'll keep going until your idea is about {percent}% clear.

**Your idea:** "{initial_idea}"
**Project type:** {greenfield→"starting from scratch" | brownfield→"adding to existing code"}
**Clarity:** 0% (just starting!)
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
Here's the big picture as I understand it:

It seems to break down like this:
1. {component_name}: {one_sentence_plain_description}
2. ...

Does this look right?
```

Then call the `question` tool:
```json
{
  "questions": [{
    "header": "Big picture",
    "question": "Does this look right? Anything to add, remove, or change?",
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

4. **Topology refusal fallback.** If the user explicitly refuses to confirm any topology (says "I don't know" / "you decide" / "whatever you think" on **two consecutive** prompts), the agent falls back to a single-component topology covering the entire idea, announces to the user: `No problem — I'll treat this as one big piece for now.`, and continues. Note the fallback in the transcript (internal) and resume normal targeting in Round 0.5.

5. **Topology reopen protocol (trigger D).** If a Phase 2 answer fires trigger D — scope expansion — the new entity is added to the active topology. Run Round 0.5 initial scoring for the new entity (below). If active components exceed 6 after addition, ask the user to merge or defer before continuing Phase 2.

## Round 0.5: Initial Scoring (bootstrap)

Run this exactly once after Round 0 topology lock, BEFORE Phase 2 Round 1. Without this step, Round 1 cannot identify "the dimension with the LOWEST clarity score" because no scores exist yet.

1. For each locked active component, dispatch `oracle` ONCE with the original idea, the topology, and the brownfield context (if any). Ask for per-component dimension scores using the same prompt as Phase 2 Step 3.
2. Pipe each oracle response through `validate.mjs` then assemble the input state and pipe through `scorer.mjs`.
3. Set state variables: `priorBand = band`, `priorAmbiguity = globalAmbiguity`, `priorRounds = [globalAmbiguity]`, `priorBandHistory = [band]`, `streakCounter = 0`, and `scoreStateMatrix` = per-component scores from this round.
4. Announce to the user:

```
Here's what I've gathered so far!

Your idea seems to break down like this:
1. {component_name}: {one_sentence_plain_description}
2. ...

About {round((1 - globalAmbiguity) * 100)}% of your idea is clear now — it's starting to take shape!
We'll begin by making the '{target_component_name}' part clearer.
```

5. Proceed to Phase 2 Round 1.


## Phase 2: Interview Loop

Repeat until `ambiguity ≤ threshold` OR user exits early. **Closure re-entry override:** if returning from Phase 3 closure guard, ask exactly ONE forced follow-up using `scorerOutput.nextTarget` — even if `globalAmbiguity ≤ threshold` — then rescore. Do NOT immediately exit the loop on re-entry.

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
About {round((1 - score) * 100)}% of your idea is clear now. ({round(score * 100)}% is still fuzzy.)

The '{target_component_name}' part still needs a bit more clarity.
{one-sentence plain-language explanation of why this matters}
```

> **Percent convention:** `score` and `globalAmbiguity` are decimals 0.0–1.0. Display `clarityPercent = round((1 - score) * 100)` and `unclearPercent = round(score * 100)`. Never do `{100 - score}` — that gives 99.55 for score=0.45.

Then call the `question` tool:
```json
{
  "questions": [{
    "header": "Question {n}",
    "question": "{short, specific question in plain language — one sentence}",
    "options": [
      { "label": "{option A}", "description": "{one-line hint}" },
      { "label": "{option B}", "description": "{one-line hint}" },
      { "label": "{option C}", "description": "{one-line hint}" }
    ]
  }]
}
```

**Rules:**
- The `header` must be short (max 30 chars): `Question {n}` or equivalent in user's language. Plain and simple — no component/dimension labels.
- The `question` field carries the actual question — keep it to one or two sentences in plain language.
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
When trigger A (direct contradiction) or B (internal inconsistency) fires on an established fact, mark it as disputed: run `node "$RUNTIME_DIR/factsLedger.mjs" dispute --fact-id <fact_id> --reason "<trigger_description>" --interview-id $INTERVIEW_ID`. The original fact entry is NOT modified (event-log model); a new dispute entry is appended.

### Established Facts Maintenance

When the oracle identifies a stable confirmed decision (a fact the user has clearly committed to), append it to the ledger:

```bash
node "$RUNTIME_DIR/factsLedger.mjs" append --claim "<fact text>" --source-round <N> --confidence <user|explore|oracle|inferred> --fact-id <stable_id> --interview-id $INTERVIEW_ID
```

The facts ledger uses an **event-log model**: entries are immutable. Disputes (trigger A/B) and supersessions append new entries rather than modifying originals. The closure guard queries `queryDisputed` to block if any unresolved disputes remain.

**Scoring pipeline (mandatory — never compute by hand):**

1. Dispatch `oracle` with the transcript and the scoring prompt from `references/prompts/oracle-scoring.md` (read the file, substitute `{idea}`, `{all rounds Q&A}`, `{confirmed decisions so far}`, `{component_name}`, `{greenfield|brownfield}`, then send to oracle).

2. Pipe raw oracle output through `node "$RUNTIME_DIR/validate.mjs" --expected-type=<declaredType>`. The output exposes `scoreClamped`, `clampedFields`. If `ok: false`, re-dispatch once with the `retryHint`. If still failing, fall back to all-scores-0.5, set `degraded: true`, and continue. **Propagate** `scoreClamped` from validate output into the scorer input as `validationScoreClamped` so downstream sees clamping that happened pre-scorer.

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
### Step 3.5: Ontology Convergence (GLOBAL)

After scoring, extract the current slot set from the oracle output (entity names, types, fields). Run:

```bash
node "$RUNTIME_DIR/convergence.mjs"
```

Pipe stdin: `{slotSet: [{name, type, fields}, ...], priorSnapshots: [state.ontologySnapshots.map(s => s.slotSet)]}`

Append the output to `state.ontologySnapshots` as `{round, slotSet, stability_ratio, converged, hash}`.

**The `converged` boolean from the LAST snapshot should be passed as `ontologyConverged` in the next scorer.mjs input.** This is advisory only and does NOT affect `nextTarget` — it signals to the lateral panel and closure guard that the domain ontology has stabilized.

### Step 3.6: Refine Gate (conditional)

Compare the current round's scores against the previous round to detect low-progress + clamped answers. Run:

```bash
node "$RUNTIME_DIR/refineGate.mjs"
```

Pipe stdin: `{priorScores: <previous round scores>, currentScores: <this round scores>, validationScoreClamped: <bool>, targetedDim: <nextTarget.dimension>}`

- If `shouldRefine: true`: the NEXT round's Step 1 should generate a refinement question for `targetedDim` instead of progressing to a new dimension.
- If `shouldRefine: false`: proceed normally to Step 4.

**Round 0.5 (cold-start) skips this gate** — `refineGate.mjs` returns `{shouldRefine: false, reason: "cold_start"}` when priorScores is null.

After running `convergence.mjs` (Step 3.5, added separately), pass the `converged` boolean from its output as `ontologyConverged: true/false` in the next `scorer.mjs` input. This field is advisory only and does not affect targeting.

4. Pipe through `node "$RUNTIME_DIR/scorer.mjs"`. Read the JSON output. Fields: `globalAmbiguity`, `band`, `bandChanged`, `stallDetected`, `ready`, `skipToSpec`, `nextPanelEligible`, `suppressPanelForOscillation`, `dispatchPanel` (= `nextPanelEligible && !suppressPanelForOscillation && bandChanged`), `coverageGaps`, `thresholdClamped`, `scoreClamped`, `validationScoreClamped`, `negativeAmbiguityClamped`, `streakCounter`, `forceUserQuestion`, `nextTarget` (`{ component, dimension }` — authoritative target; do not recompute).

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
Question {n} done!

(Score table — for precision, stays technical)
| Dimension | Score | Weight | Weighted | Gap |
|-----------|-------|--------|----------|-----|
| Goal | {s} | {w} | {s*w} | {gap or "✓"} |
| Constraints | {s} | {w} | {s*w} | {gap or "✓"} |
| Success Criteria | {s} | {w} | {s*w} | {gap or "✓"} |
| Context (brownfield) | {s} | {w} | {s*w} | {gap or "✓"} |
| **Clarity** | | | **{round((1 - score) * 100)}% clear** ({round((1 - prior) * 100)}% → {round((1 - score) * 100)}% {↑|↓|flat}) | |

**{score <= threshold ? "Ready" : "Next"}:** {score <= threshold ? "Your idea is clear enough! Let me draft the spec." : "Next, let's make the '" + target_component_name + "' part clearer."}

> When score <= threshold, do NOT show a "next question" line — show the ready message only. When not ready, show the next target only, no ready message.

```

> **Plain-language summary (always add below the table):** Write 1-2 sentences in the user's language explaining what the scores mean. Example: "'Goal' is solid now, but 'boundaries' is still a bit fuzzy. The next question will clarify that part."

### Step 4b: Lateral Review Panel (milestone-triggered)

**Full panel protocol (milestone bands, personas, folding, cooldown, ceiling, stall detection, cancellation) is in `references/prompts/lateral-panel.md`.** Read that file before dispatching the panel. Summary:

- Check if the ambiguity **milestone band** changed versus the prior round. On a transition (either direction), convene the panel.
- Dispatch `researcher` / `contrarian` / `simplifier` / `architect` (architect only on scope change) as separate `oracle` calls with independent context.
- Fold concrete findings into the next single user-facing question. The panel never adds a second question or marks the interview complete.
- Check `dispatchPanel` from scorer output before dispatching. Respect `panelCooldown` (default 2) and per-interview ceiling (default 30, configurable via `omo.ulwInterview.panelCeiling`).
- On `suppressPanelForOscillation: true` or `stallDetected: true`, follow the escalation protocol in the reference.
- If the user says stop/cancel/abort mid-panel, abort and terminate per Escalation.

### Step 5: Check Limits

- **Round 3+:** Allow early exit if user says "enough", "let's go", "build it". **High-ambiguity early exit:** if `globalAmbiguity > threshold + 0.20` at the moment of early exit, emit an **Incomplete Spec Report** (Phase 3 Step 5) instead of a normal spec — the closure guard cannot rescue this much ambiguity.
- **Round `{softWarningRounds}` (default 15):** Soft warning — "We're at {softWarningRounds} rounds. About {round((1 - score) * 100)}% is clear right now. Keep going, or use what we have?"
- **Round `{roundCap}` (default 30):** Hard cap — "Maximum interview rounds reached." Round 0 and Round 0.5 do NOT count toward this cap; it counts Phase 2 rounds only. Configure via `omo.ulwInterview.roundCap`.
- **All dimensions of all components ≥ 0.9 AND threshold met:** Skip to Phase 3. (The scorer's `skipToSpec` flag fires only when both conditions hold — this resolves the prior contradiction where 0.9 dims at threshold 0.05 produced ambiguity 0.10.)
- **Precedence on conflict:** Hard cap > closure guard. If Round `{roundCap}` is reached and the closure guard rejects, emit an Incomplete Spec Report (see Phase 3 Step 5) and stop — do not loop back to Phase 2.

## Phase 3: Generate Spec

When ambiguity ≤ threshold (or hard cap / early exit):

1. **Closure / Acceptance Guard.** Precedence: Round `{roundCap}` hard cap > closure guard > readiness math. Even when scorer reports `ready: true`, do not treat the math as completion. Run an independent readiness audit via `oracle`. **Mechanical coverage check:** read `coverageGaps` from the last scorer output — if it is non-empty, the closure guard REJECTS and re-entry uses `scorerOutput.nextTarget` as the next question target (do not pick a target yourself). Otherwise the oracle audit checks: no unresolved or disputed trigger remains, and no agent-confirmed fact is standing in for user-confirmed truth (route these to the user). If the oracle audit finds a material gap, override the gate to the user — "The math says ready, but I am not accepting it yet because {gap}" — ask the single highest-impact follow-up, and return to Phase 2. **Retry cap:** the closure guard may reject at most 2 times. After the 2nd rejection, OR if Round `{roundCap}` has been reached, OR if the user invoked early exit with `globalAmbiguity > threshold + 0.20`, emit an **Incomplete Spec Report** (see Phase 3 Step 5) instead of looping. When returning to Phase 2 from the closure guard, the round number CONTINUES (does not reset) and re-entry targets `scorerOutput.nextTarget`. Additionally, query the established-facts ledger for disputes: run `node "$RUNTIME_DIR/factsLedger.mjs" queryDisputed --interview-id $INTERVIEW_ID`. If the `disputes` array is non-empty, reject closure and return to the disputed fact's `originalFact.source_round` to re-resolve.

2. **Restate gate.** Once closure passes, collapse the agreed answers into ONE sentence goal that covers every active component. Write the goal as chat text, then confirm via the `question` tool:

Chat text:
```
**One-line summary:** {one-sentence goal}
```

Then call the `question` tool:
```json
{
  "questions": [{
    "header": "Goal check",
    "question": "If someone read only this sentence, would they build the right thing?",
    "options": [
      { "label": "Looks good, let's go!", "description": "This captures what I want" },
      { "label": "Adjust wording", "description": "The goal is right but the phrasing needs work" },
      { "label": "Something's missing", "description": "The goal leaves something out" }
    ]
  }]
}
```
On "Adjust wording" or "Something's missing", collect the correction, route it back through Phase 2 scoring (a correction can change ambiguity), and re-run both gates. Cap at two loops; if alignment is not reached, return to Phase 2.


3. **Generate the specification** from the full interview transcript. Write it to `.omo/specs/ulw-interview-{slug}.md` using the `write` tool.

**Spec structure:** see `references/prompts/spec-template.md` for the full normal spec template and the Incomplete Spec Report substitutions. Use the `write` tool to write the spec to `.omo/specs/ulw-interview-{slug}.md`.

4. **Post-spec options.** After writing the spec, present three options via the `question` tool:

Chat text:
```
Your spec is ready at `.omo/specs/ulw-interview-{slug}.md`.

About {round((1 - globalAmbiguity) * 100)}% clear after {currentRound} rounds.
```

Then call the `question` tool:
```json
{
  "questions": [{
    "header": "Next step",
    "question": "What would you like to do next?",
    "options": [
      { "label": "Start planning", "description": "Continue to /ulw-plan with this spec" },
      { "label": "Continue interview", "description": "Ask more questions to refine the spec" },
      { "label": "Done", "description": "Stop here. The spec is saved." }
    ]
  }]
}
```

On "Start planning": invoke `/ulw-plan` with the spec path `.omo/specs/ulw-interview-{slug}.md` as context. The planning skill will read the spec and build a work plan from it.

On "Continue interview": return to Phase 2. The round number continues (does not reset). The spec file remains; it will be overwritten when the interview completes again.

On "Done": stop. The spec is the deliverable.

## Phase 3 Step 5: Summary So Far (when interview stops early)

> **Internal name:** Incomplete Spec Report. **User-facing name:** "Summary so far". Never say "Incomplete Spec Report" to the user.

Emit this INSTEAD of a normal spec when:
- Round `{roundCap}` hard cap reached AND closure guard rejects, OR
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
| `ontologySnapshots` | `[]` | Step 3.5 (append `{round, slotSet, stability_ratio, converged, hash}`) |
| `scoreStateMatrix` | `{}` (Map: component name → last-known scores) | Round 0.5, every Phase 2 round (current component's scores refreshed) |
| `priorPanelRound` | `-3` | Every panel dispatch |
| `panelDispatchCount` | `0` | Every panel dispatch (against the ceiling) |
| `closureRejections` | `0` | Each closure-guard rejection |
| `streakCounter` | `0` | Dialectic rhythm guard |
| `degraded` | `false` | Validation fallback |
| `declaredType` | set in Phase 1 Step 2 | Sticky — drives `validate.mjs --expected-type` |
| `factsLedgerInterviewId` | derived in Phase 1 from slug | `factsLedger.mjs` state file key |
| `slug` | derived at Phase 3 from final one-sentence goal | kebab-case, ASCII only, max 60 chars. If `.omo/specs/ulw-interview-{slug}.md` exists, append `-2`, `-3`, … until path is free. |
| `timestamp` | ISO 8601 UTC at spec write | Phase 3 Step 3 |

## Configuration

Optional settings in `.omo/settings.json`:

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

| Key | Default | Valid range | Notes |
|---|---|---|---|
| `ambiguityThreshold` | `0.05` | `(1e-6, 0.30]` | Out-of-range values are clamped by `scorer.mjs`. `0.10` recommended for product discovery; `0.05` for safety/compliance. |
| `roundCap` | `30` | positive integer | Maximum Phase 2 rounds. Round 0 and 0.5 do NOT count. `20` for safety/compliance; `30-40` for product discovery. |
| `softWarningRounds` | `15` | positive integer | Round number for the soft warning. Default is approximately `roundCap / 2`. |
| `panelCeiling` | `30` | positive integer | Total persona-dispatches allowed per interview. After ceiling, panels are skipped. |

## Escalation And Stop Conditions

- **Hard cap at `{roundCap}` rounds (default 30):** Proceed with whatever clarity exists, noting the risk.
- **Soft warning at `{softWarningRounds}` rounds (default 15):** Offer to continue or proceed.
- **Early exit (round 3+):** Allow with warning if ambiguity > threshold.
- **User says "stop" / "cancel" / "abort":** Stop immediately.
- **Ambiguity stalls** (`scorer.mjs` reports `stallDetected: true`): Reframe — ask "What IS the core thing here?" before continuing with detail questions. The runtime computes this as windowed max-min over the last 3 global ambiguities ≤ 0.05; the LLM never computes it by hand.
- **Codebase exploration fails:** Proceed as greenfield, note the limitation.
