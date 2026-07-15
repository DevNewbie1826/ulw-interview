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
- **Target exactly `action.payload.target`** — the reducer, not numeric prose or caller rotation, selects it
- **Score ambiguity after every answer** — display the score transparently
- **Use the `question` tool for all user-facing questions:** write context, score tables, and explanations as normal chat text, then call the `question` tool with a short question + 2-4 options. This gives the user a clear visual signal that a response is needed. Long prose stays in the chat body; the question tool carries only the decision itself. The only exception is announcements (Round 0.5 scoring complete, spec generated, etc.) which are informational and do not use the tool.
- **Gather codebase facts before asking about them** — dispatch `explore` for brownfield context before asking the user what the code already reveals
- **Facts vs decisions:** gather factual findings (current stack, versions, existing patterns) with `explore`/`librarian`, then use them to inform the one user confirmation question for the returned target. Facts never auto-complete an `ask_target`; every requirement, boundary, and interpretation remains the user's decision.
- **Do not proceed to spec generation until the reducer has cleared semantic coverage, closure, and the user's full intent-contract confirmation**
- **Allow early exit** with a clear warning if ambiguity is still high
- **Detect the user's language** per Communication Style Rule 7; default to English only before the first user message
- **Never bypass direct judgment:** every `ask_target` ends in one user answer, including targets supported by repository or external facts.
- **Multi-component targeting:** use only the component returned by the reducer. Do not rotate, rebalance, or replace it in caller prose.
- **Lateral review panel:** convene one only for a returned `dispatch_panel` action (see Phase 2 Step 4b).

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
   - **Code-fence taxonomy.** Each fenced block in this skill is one of: (1) user-facing chat text or `question` tool JSON example → translate per above; (2) Oracle prompt → preserve; (3) runtime JSON input/output schema → preserve; (4) final spec template → preserve markdown structure, metadata field names, IDs, and code; translate prose content under Goal, Must-Haves, Constraints & Invariants, Must-Nots, Out of Scope, Preferences, Acceptance Evidence, Technical Context, and Unresolved Semantic Gaps; (5) configuration JSON example → preserve.
   - **Control-flow phrases.** Exit/stop/cancel detection (referenced in Phase 2 Step 5, Phase 3 Step 5, and Escalation) is semantic. Match phrases like "enough", "let's go", "build it", "stop", "cancel", "abort" by semantic equivalent in the user's language, not literal English strings.
   - **Pluralization & numbers.** Render counts in the target language's grammatical form (e.g. "1 main part" / "2 main parts" / Russian 1/2-4/5+ forms / Arabic dual). Do not use the English `(s)` hack.
   - **Mask runtime labels.** When interpolating a runtime value into prose, map it to plain language using the Internal vs user-facing table above (e.g. `{target_dimension}`="goal" → "what we're building", `{target_component_name}` → the user's own component label, `globalAmbiguity` → the percentage). Never expose raw field names to the user.
   - **Formality.** Match the user's formality level. Raise the register for Japanese *keigo*, French *vous*, Korean *jondaetmal* — even though the English templates are casual.
   - **RTL languages.** For Arabic, Hebrew, etc., adapt punctuation and prose layout per locale conventions. Score tables (Rule 8) stay LTR technical; add an RTL plain-language summary alongside. Wrap mixed-direction runs (LTR placeholders/code inside RTL prose) in Unicode bidi marks when needed for clean rendering.
8. **Score tables stay technical** (they're for precision), but always add a plain-language summary line below them.

## Runtime Contract (authoritative)

`transition.mjs` is the **sole authoritative lifecycle contract**. It owns legal event order, policy precedence, state commits, and the next action. `validate.mjs`, `refineGate.mjs`, and `scorer.mjs` own their machine contracts and numerical decisions. The LLM NEVER computes ambiguity, semantic completeness, or a next lifecycle step by hand. If prose and runtime disagree, the runtime is correct.

**Path resolution (critical):** The runtime scripts live in the `references/runtime/` directory **next to this SKILL.md file**. The skill system exposes this file's location. Resolve `RUNTIME_DIR` as the directory containing SKILL.md + `/references/runtime/`. Invoke scripts with absolute paths under `RUNTIME_DIR`. Do NOT use bare `references/runtime/` — that only works if cwd is the skill directory.

For every lifecycle event, send `{state,event}` to `node "$RUNTIME_DIR/transition.mjs"`. Treat its successful `{state,action,semanticCoverageGaps}` response as one indivisible commit: replace the caller's state with `result.state`, retain `result.semanticCoverageGaps` for review, and execute only `result.action`. Never patch individual prior-state fields, skip an action, or infer a competing action from scorer output.

The LLM still owns meaning and language: question wording, topology proposals, facts-versus-decisions routing, semantic coverage judgment, FactsLedger effects, panel interpretation, closure materiality, and spec synthesis. Those judgments become reducer events; they never become runtime heuristics.

Every Oracle invocation, including baseline, round, panel, closure, and compression, receives the immutable full interview ID registry and all component ID ownership as read-only context.

### Round answer pipeline

When the current action is `ask_target`, preserve its `askedTarget` before asking exactly one question. After the answer, run this exact caller pipeline:

1. Dispatch `oracle` with that answer, the transcript, the current component snapshot, and `references/prompts/oracle-scoring.md`. Every Oracle invocation receives the immutable full interview ID registry and all component ID ownership, including baseline invocations.
2. Pipe the raw response through `validate.mjs --expected-type=<declaredType>`. On failure, retry exactly once with `retryHint`. If that retry fails, stop processing the Oracle response and execute the Canonical validation fallback below.
3. Apply FactsLedger effects for confirmed facts, disputes, or supersessions. Ledger entries record evidence; they do not decide semantic coverage.
4. Run `refineGate.mjs` with the dimension from the preserved `askedTarget`. For a coverage target, do not run refinement and set `refineOutput` to `null`.
5. Enrich every validated trigger with `component: askedTarget.component` before `scorer.mjs`; no trigger may name or inherit any other component.
6. Run `scorer.mjs` with the validated scores, enriched triggers, and the complete active-component score snapshot.
7. Send one `round_scored` event to `transition.mjs`, including the scorer output, refine output, full known-component coverage snapshot, any scope expansion, and whether the user requested early exit.
8. Replace caller state with `result.state`, retain `result.semanticCoverageGaps`, and execute only the returned action.

Only the asked target's component may change in that round. Carry every other active or deferred component forward byte-for-byte. The registry and ownership map are read-only context, never an invitation to edit sibling snapshots. Oracle makes the semantic judgment; `validate.mjs` and `transition.mjs` enforce the shape, provenance, history, and evidence links.

### Canonical validation fallback

The retry boundary is exact: validate the first Oracle response, retry exactly once with `retryHint`, and enter fallback only after that second validation failure. Never dispatch a third scoring Oracle for the same component and answer.

Build the fallback scorer input mechanically. Set every required score field for the failed component to `0.5`; use goal, constraints, and criteria for a new initiative, and add context for an existing system. Set `triggers: []`, `validationScoreClamped: false`, and `degraded: true`.

- **Initial baseline:** retain the reducer-created open component coverage byte-for-byte for the failed component. Do not synthesize confirmation, evidence, or IDs. Components that already validated keep their validated scores and coverage unchanged.
- **Round:** set only `askedTarget.component` required scores to `0.5` and retain that component's prior coverage byte-for-byte. Every sibling's scores and coverage remain unchanged.
- **No side effects:** fallback produces no triggers, FactsLedger effects, registry allocations, or semantic mutations. It never incorporates any field from either rejected Oracle response.
- **Reducer event:** construct the normal full scorer snapshot with the fallback fields above. For a coverage target, use `refineOutput: null`; for a dimension target, run `refineGate.mjs` with the fallback scores and `validationScoreClamped: false`. Emit the normal `baseline_scored` or `round_scored` event and commit the complete reducer response.
- **Determinism:** identical state and event input must produce byte-identical scorer and reducer JSON. Do not add clock, randomness, generated IDs, inferred coverage, or prose to a fallback event.

### Reducer action handling

Execute only `result.action` from the latest reducer result. Each row is one handler, not an alternate policy path.

| Action | Required handling |
|---|---|
| `ask_target` | Explain why the returned target matters, then ask one user-facing question. Use returned panel findings only as options for this same question. |
| `await_panel_results` | Wait for all acknowledged persona results; do not ask a question or score another round. |
| `confirm_intent_contract` | Present the Build / Preserve-Never / Not-included restatement and emit only the user's confirmation or correction event. |
| `confirm_topology` | Present the topology confirmation question, then emit `topology_confirmed` with the complete active and deferred lists. |
| `dispatch_panel` | Dispatch exactly the returned personas and follow the acknowledgement protocol in `lateral-panel.md`. |
| `offer_post_spec` | Present only the post-spec choices allowed by `allowContinue`. |
| `run_baseline` | Score exactly the returned components, carry all known coverage snapshots, then emit `baseline_scored`. |
| `run_closure` | Run the independent semantic and dispute audit, then emit `closure_passed` or `closure_rejected`. |
| `score_answer` | Treat the user's restatement correction as the answer for the returned target and run the round answer pipeline without asking again. |
| `start_planning` | Invoke `/ulw-plan` with the returned stored spec path. |
| `stop` | Stop without offering another question or lifecycle choice. |
| `write_spec` | Write exactly the returned complete or incomplete artifact, then emit `spec_written` with the matching kind and actual `.omo/specs/ulw-interview-{slug}.md` path. |

**Transcript compression (mandatory above 4000 tokens):** before each Oracle scoring dispatch, if the accumulated transcript exceeds 4000 tokens, compress the OLDEST half via a separate Oracle call (see `references/prompts/oracle-scoring.md`). Replace those rounds in the working transcript with the summary. Keep the last 2 rounds verbatim. The full uncompressed transcript is still written to the final spec.

See `references/runtime/README.md` for runtime schemas and configuration constants; do not restate their values here.

## Phase 0: Resolve Threshold (blocking)

Complete this before anything else — before initialization, before the first question, before any scoring.

1. Read `omo.ulwInterview.ambiguityThreshold` from `.omo/settings.json`. If it is missing or malformed, use the documented configuration default.
2. Pass any finite configured value through unchanged. The runtime owns validation and clamping. Record whether the source was `.omo/settings.json`, the default, or clamped by runtime; never show that internal label to the user.
3. Before the first scorer output, make no numeric clarity promise. The configured value may still be outside the runtime range and is not user-facing yet.
4. Emit only this nonnumeric user-facing first line:

```
We'll use your configured clarity target and confirm the exact level after the initial scoring. Let's start!
```

Write this line in the user's language per Communication Style Rule 7. The raw configured threshold, source, and possible clamp status remain internal until `scorer.mjs` returns the effective threshold.

5. Carry the threshold forward mechanically through every step. Do not hardcode. Pass it as the `threshold` field of every `scorer.mjs` invocation.

Use the configured threshold as the caller value. Configuration guidance belongs in the Configuration section and runtime reference.

## Phase 1: Initialize

1. **Validate and parse the user's idea** from the skill arguments. If arguments are empty or whitespace-only, emit `ULW Interview: no idea provided. Re-invoke with your idea as the argument.` (translated into the user's detected language per Rule 7, when the invoking message reveals one) and STOP. Do not enter Round 0.

2. **Initialize identity.** Obtain one stable, filesystem-safe, caller-supplied interview ID matching `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` before any FactsLedger call. Store it as `INTERVIEW_ID` and pass the same value to the reducer initialization and every `factsLedger.mjs` invocation. It is independent of the later spec filename.

3. **Detect brownfield vs greenfield:**
   - Dispatch `explore` to check if cwd has existing source code relevant to the idea.
   - If source exists AND the idea references modifying/extending something: **brownfield**.
   - Otherwise: **greenfield**. Store the result as `declaredType` — pass it to every `validate.mjs --expected-type=<declaredType>` invocation.

4. **For brownfield:** use `explore` to map relevant codebase areas (file paths, patterns, conventions). Store findings as context. Use this to avoid asking the user what the code already reveals.

5. **Initialize the lifecycle.** Send `initialize` with `INTERVIEW_ID`, `declaredType`, and the resolved configuration to `transition.mjs`, commit the complete result, and execute its `confirm_topology` action.

6. **Announce the interview:**

```
Let's figure out exactly what you want to build!

I'll ask questions one at a time. After each answer, I'll show you how clear things are getting.
After the initial scoring, I'll confirm the exact clarity level we're aiming for.

**Your idea:** "{initial_idea}"
**Project type:** {greenfield→"starting from scratch" | brownfield→"adding to existing code"}
**Clarity:** just starting
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

3. **Lock topology** after the answer by emitting `topology_confirmed` with the complete active and deferred lists. Commit the reducer response wholesale and execute its `run_baseline` action. Carry every known component's score and coverage history; never remove a known component from both lists.

4. **Topology refusal fallback.** If the user explicitly refuses to confirm any topology (says "I don't know" / "you decide" / "whatever you think" on **two consecutive** prompts), propose a single component covering the whole idea and announce: `No problem — I'll treat this as one big piece for now.` Emit that complete topology through the same reducer event. Note the fallback internally.

5. **Topology reopen protocol.** Report a genuine scope expansion in the next `round_scored` event. If the reducer returns `confirm_topology`, ask the same topology question with the expanded known set. The following `run_baseline` action identifies exactly which new or reactivated components require scoring. Do not infer that list yourself.

## Round 0.5: Initial Scoring (bootstrap)

Run this exactly once after Round 0 topology lock, BEFORE Phase 2 Round 1. It creates the baseline state from which the reducer can return the first valid target.

1. Read `run_baseline.components` in its exact returned order and process it serial, one component at a time. For each iteration set `currentBaselineComponent` to that returned component and set `globalIdOwners` to the current immutable interview-global ID-to-component ownership map.
2. Give the current component Oracle `currentBaselineComponent`, `globalIdOwners`, the immutable full interview ID registry, original idea, complete topology, its current coverage snapshot, and brownfield context (if any). The Oracle prompt's baseline context is always this current component.
3. Construct the canonical registry argument with Node's canonical base64url encoding and invoke the validator exactly as shown:

```javascript
const registryContext = Buffer.from(JSON.stringify({ component: currentBaselineComponent, owners: globalIdOwners }), 'utf8').toString('base64url')
```

```bash
node "$RUNTIME_DIR/validate.mjs" --expected-type="$declaredType" "--registry-context=$registryContext"
```

The baseline caller always supplies exactly one registry flag. Its optional validator form is reserved only for truly single-component direct validator use outside this skill's baseline flow.

4. If validation reports an ownership or schema error, reject that Oracle response and retry the same `currentBaselineComponent` before any incorporation or scoring. After the exact retry limit, execute the Canonical validation fallback for that same component; never accept colliding IDs or advance ownership from rejected output.
5. From a successful validation only, bind every validated baseline trigger to `currentBaselineComponent`, then incorporate every newly allocated O/M/N/X/I/P/E ID into `globalIdOwners` under that component. Same-owner history remains valid. Only then may the next component receive the updated registry context. Allocate only from validated output; never reserve IDs in advance.
6. Repeat the same one-at-a-time gate in exact action order. Only after all components are processed, assemble the full active-component scorer input with the component-bound validated triggers and the known-component coverage snapshot, then run `scorer.mjs` and emit one `baseline_scored` event. No partial baseline event is legal.
7. From this first scorer output, compute `requiredClarityPercent = (1 - scorerOutput.threshold) * 100`. This runtime-provided effective threshold is the first and only source for the numeric clarity target shown to the user; never derive it from the raw configured value.
8. Commit the complete reducer result. Its `ask_target` action is the only target for Round 1.
9. Announce to the user:

```
Here's what I've gathered so far!

We'll keep going until your idea is about {requiredClarityPercent}% clear.

Your idea seems to break down like this:
1. {component_name}: {one_sentence_plain_description}
2. ...

About {round((1 - globalAmbiguity) * 100)}% of your idea is clear now — it's starting to take shape!
We'll begin by making the '{target_component_name}' part clearer.
```

10. Proceed to Phase 2 Round 1 and ask exactly the returned target.


## Phase 2: Interview Loop

The reducer enters and leaves this loop. Continue only while its action requires a round. Numeric readiness never bypasses semantic gaps, closure, restatement, or artifact acknowledgement.

### Step 1: Generate Next Question

Use the target in the current `ask_target` action verbatim. It is either a numeric clarity dimension or one unresolved semantic coverage category/evidence link. Generate a question that resolves only that target.

Every `ask_target` produces exactly one user decision or confirmation through the `question` tool. Factual findings may inform that confirmation question and its options, but never auto-complete an `ask_target` or replace the user's answer.

**Question targeting rules:**
- The target IS `action.payload.target`. Do not override it with your own analysis or a scorer field.
- If the last scorer output requests a direct user question, route this question to the user even if the target looks auto-answerable.
- State, in one sentence before the question, why this target is the bottleneck. Translate coverage categories and dimensions into the plain-language terms above.
- Questions should expose ASSUMPTIONS, not gather feature lists.
- **Facts vs decisions:** if repository or external facts bear on the target, gather them first, cite them in the context, and ask the user to confirm the intended interpretation or choose among consequences. The finding is evidence for the one question, not an answer event.

**Question styles by dimension:**

| Dimension | Question Style | Example |
|-----------|---------------|---------|
| Goal Clarity | "What exactly happens when...?" | "When you say 'manage tasks', what specific action does a user take first?" |
| Constraint Clarity | "What are the boundaries?" | "Should this work offline, or is internet connectivity assumed?" |
| Success Criteria | "How do we know it works?" | "If I showed you the finished product, what would make you say 'yes, that's it'?" |
| Context Clarity (brownfield) | "How does this fit?" | "I found JWT auth middleware in `src/auth/`. Should this feature extend that path?" |

**Incidental preference capture (not a target):** Preferences may be captured only when the user volunteers one or when it is relevant to an already returned dimension/coverage target. Record it from that answer and confirm it in the final restatement. Preferences never create a semantic gap, block closure, or cause another question.

**Question styles for semantic coverage targets:**
- Outcome or must-have: contrast what must be delivered with a plausible smaller result.
- Must-not or invariant: contrast a technically working result with one the user would still reject.
- Out of scope: name one reasonable adjacent feature and ask whether this delivery includes it.
- Acceptance evidence: ask what observable result proves the referenced requirement or boundary.

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

After receiving the answer, run the exact Round answer pipeline in the Runtime Contract. Ambiguity is bidirectional and non-monotonic: later answers may invalidate, weaken, or expand prior understanding.

The Oracle may identify these trigger meanings for the validator: a direct contradiction, an internal inconsistency, an evasive answer, or a scope expansion. Do not apply any numerical effect yourself. When a contradiction or inconsistency disputes an established fact, append a dispute event before refinement. When the user clearly confirms a stable decision, append or supersede the matching fact. FactsLedger entries are immutable and use `INTERVIEW_ID`.

Coverage updates must preserve both positive intent and negative boundaries. Silence or inference leaves a semantic slot open. Only direct user confirmation can confirm a category or explicitly confirm that it has no items. Preference metadata is carried when volunteered or incidentally relevant, but never drives targeting. The Oracle prompt defines the complete snapshot schema and acceptance-evidence links.

After `transition.mjs` returns, do not copy selected scorer fields into caller state. The wholesale `result.state` commit is the only update to score history, round counters, prior values, coverage, panel state, closure state, or targets.

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

**{action.type === "run_closure" ? "Ready" : "Next"}:** {action.type === "run_closure" ? "Your idea is clear enough! Let me do one final check." : "Next, let's make the '" + target_component_name + "' part clearer."}

> Show the ready message only for `run_closure`. A low numeric score with semantic gaps still receives `ask_target` and must show the next plain-language target.

```

> **Plain-language summary (always add below the table):** Write 1-2 sentences in the user's language explaining what the scores mean. Example: "'Goal' is solid now, but 'boundaries' is still a bit fuzzy. The next question will clarify that part."

### Step 4b: Lateral Review Panel (milestone-only, non-ready)

**The full action and acknowledgement protocol is in `references/prompts/lateral-panel.md`.** Read it only when the reducer returns `dispatch_panel`. Summary:

- Never convene a panel from scorer fields or prose. The reducer has already checked milestone eligibility, non-ready status, suppression, and the configured ceiling.
- Dispatch exactly `action.payload.personas` as separate Oracle calls with independent context, then acknowledge exactly that returned list.
- Wait for all findings before sending `panel_completed`. The resulting `ask_target` action folds findings into one question; the panel never asks a second question or marks the interview complete.
- If the user stops mid-panel, emit `user_stop`, discard partial findings, commit the reducer response, and execute it.

### Step 5: Check Limits

- **Early exit:** whenever the user requests it, set `earlyExitRequested` on the current answer's `round_scored` event and execute the returned action. The caller has no minimum-round gate and does not classify ambiguity.
- **Soft warning:** at `{softWarningRounds}`, add an informational sentence before the same returned-target question. It creates no extra decision, options, or event: "We're at {softWarningRounds} rounds. About {round((1 - score) * 100)}% is clear right now."
- **At the configured hard cap:** announce "Maximum interview rounds reached." The committed boundary round still runs. Follow the reducer's closure or write action; never add another interview round.
- **Numeric readiness:** never skip directly to a spec. Semantic coverage, closure, restatement, and write acknowledgement remain mandatory reducer states.

## Phase 3: Generate Spec

Enter this phase only through a reducer action. Numeric readiness alone is not permission to write.

1. **Closure / acceptance guard.** On `run_closure`, query FactsLedger disputes with `INTERVIEW_ID` and dispatch an independent Oracle audit with the immutable full interview ID registry and all component ID ownership. Review `result.semanticCoverageGaps`, unresolved contradictions, acceptance-evidence links, and any agent-supplied statement that still needs direct user confirmation. The runtime reports structure; Oracle judges meaning.

If no material gap remains, emit `closure_passed`. Otherwise emit `closure_rejected` with a concise internal reason and the single highest-impact valid target. Commit the response and execute it. Never choose whether to retry or write an incomplete artifact; the reducer owns that decision.

2. **Restate / intent-contract gate.** On `confirm_intent_contract`, present the complete agreed contract as chat text:

```
**Build:** {desired outcome and must-have results across every active component}

**Preserve / Never:** {invariants that must remain true and outcomes that must never happen}

**Not included:** {explicitly out-of-scope work}

**Preferences:** {confirmed non-blocking tie-breakers, or that none were confirmed}

**Acceptance evidence:** {plain-language summary of how each active must-have, must-not, and invariant will be proved}
```

Then ask one confirmation question:

```json
{
  "questions": [{
    "header": "Final check",
    "question": "Does this capture what to build, protect, leave out, prefer, and how we'll prove it?",
    "options": [
      { "label": "Looks good, let's go!", "description": "This captures the whole agreement" },
      { "label": "Adjust wording", "description": "The agreement is right but the phrasing needs work" },
      { "label": "Something's missing", "description": "A required result or boundary is missing" }
    ]
  }]
}
```

On confirmation, emit `restate_confirmed`. On a correction, use semantic judgment to bind the correction to one valid active target and emit `restate_corrected`. Execute the returned `score_answer` or `write_spec` action; do not ask the correction a second time.

3. **Generate the specification.** On `write_spec`, derive an artifact-only slug from the confirmed goal, then write the exact complete or incomplete structure in `references/prompts/spec-template.md` to `.omo/specs/ulw-interview-{slug}.md`. The slug never supplies an interview, fact, coverage, or evidence ID.

For an incomplete artifact, keep every confirmed section and list unresolved semantic gaps separately. User-facing text calls it a "Summary so far"; never expose the internal artifact kind. After the write, emit `spec_written` with the returned kind and actual path. A complete acknowledgement returns `offer_post_spec`; an incomplete acknowledgement returns `stop` and must not show post-spec choices.

4. **Post-spec action.** On `offer_post_spec`, use `action.payload.specPath` in the announcement and show Start planning and Done. Show Continue interview only when `allowContinue` is true.

```json
{
  "questions": [{
    "header": "Next step",
    "question": "What would you like to do next?",
    "options": [
      { "label": "Start planning", "description": "Continue to /ulw-plan with this spec" },
      { "label": "Continue interview", "description": "Ask more questions to refine the spec; include only when allowContinue is true" },
      { "label": "Done", "description": "Stop here. The spec is saved." }
    ]
  }]
}
```

Emit `start_planning`, `continue_interview`, or `finish` for the selected visible choice and execute the next reducer action. Never return to Phase 2 directly. Incomplete `write_spec` acknowledgement leads to `stop`, with no question.

## State Variables

The caller retains only the latest complete reducer `state`, latest `semanticCoverageGaps`, the stable `INTERVIEW_ID`, transcript, and artifact metadata. Every lifecycle field lives inside reducer state and changes only by replacing it with `result.state`.

`slug` and `timestamp` are created only when writing an artifact. The slug is kebab-case, ASCII only, and at most 60 characters; add a numeric suffix when the path exists. Neither value may become a lifecycle, FactsLedger, semantic item, or evidence identity.

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
| `ambiguityThreshold` | `0.05` | runtime-validated | Out-of-range finite values are clamped by the runtime. |
| `roundCap` | `30` | positive integer | Maximum Phase 2 rounds. Round 0 and 0.5 do NOT count. `20` for safety/compliance; `30-40` for product discovery. |
| `softWarningRounds` | `15` | positive integer | Round number for the soft warning. Default is approximately `roundCap / 2`. |
| `panelCeiling` | `30` | positive integer | Total persona-dispatches allowed per interview. After ceiling, panels are skipped. |

## Escalation And Stop Conditions

- **Hard cap:** Commit the boundary round and follow the reducer's closure/write action.
- **Soft warning:** Add one informational sentence before the same reducer-selected question. It never offers a second lifecycle choice, changes options, or emits another event.
- **Early exit:** Record the request in the next round event and follow the returned action.
- **User says "stop" / "cancel" / "abort":** Emit `user_stop`, commit the response, and execute `write_spec` or `stop` as returned.
- **Ambiguity stalls:** If the next action is `ask_target`, use a stall reframe such as "What is the core thing here?" The runtime detects the stall; the LLM only phrases the one question.
- **Codebase exploration fails:** Proceed as greenfield, note the limitation.
