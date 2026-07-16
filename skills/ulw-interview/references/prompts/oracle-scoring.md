# Oracle Scoring Prompt

Dispatch this prompt to `oracle` for each baseline and round score. Substitute `{placeholders}` with current values. Baseline context binds the active component to the caller's `currentBaselineComponent`; round context binds it to `askedTarget.component`. The Oracle returns STRICT JSON only. The Oracle owns semantic judgment; runtime validation owns schema and history enforcement.

---

```
Given the following interview transcript for a {greenfield|brownfield} project,
score clarity from 0.0 to 1.0 and return the complete semantic coverage snapshot
for the active component. Do not infer user agreement from silence, code, or prior art.

Original idea: {idea}
Transcript: {all rounds Q&A}
Established facts: {confirmed decisions so far}
Active topology component being scored this round: {component_name}
Invocation context: {baseline currentBaselineComponent | round askedTarget.component}
Previously committed coverage for this component: {coverage_snapshot}
Asked target (baseline: component initialization): {asked_target}
Immutable full interview ID registry: {global_id_registry}
All component ID ownership: {all_component_id_ownership}
Current committed interview round: {source_round}

Treat the registry and ownership map as immutable. During baseline, return only the complete snapshot for `currentBaselineComponent`; during a scored round, only the asked component snapshot may change. Copy every prior item and acceptance-evidence record byte-for-byte, including its full text and original `source_round`; only `state` may change from `active` to `superseded`. Never restamp prior records with the current round, abbreviate their text, or edit, move, or regenerate an owned ID.

If one free-text answer also volunteers related must-have, must-not, out-of-scope, invariant, preference, or acceptance-evidence details, fast-answer capture may record those direct confirmations only for the same component. The returned asked target still owns scoring. This creates no second target and no second question, and every sibling component remains byte-for-byte unchanged.

Score these dimensions:
1. Goal Clarity: desired outcome plus required positive behavior.
2. Constraint Clarity: must-nots, out-of-scope work, and invariants.
3. Success Criteria: observable evidence linked to every active hard statement.
4. Context Clarity: brownfield only; safe fit with the existing system.

Choose weakest_dimension from goal|constraints|criteria|context. In `gap`, give a
contrastive gap rationale: explain why the asked target remains less resolved than
the strongest competing gap and what one answer would settle it. Put the overall
score rationale in `justification`. Return triggers as {dim,type}, where type is
A|B|C|D, or an empty array.

Return this exact top-level shape:
{
  "type": "greenfield",
  "scores": {
    "goal": 0.0,
    "constraints": 0.0,
    "criteria": 0.0
  },
  "weakest_dimension": "goal",
  "triggers": [],
  "justification": "one concise overall rationale",
  "gap": "contrastive gap rationale",
  "coverage": {
    "outcome": { "status": "open", "source": null, "source_round": null, "items": [] },
    "must_haves": { "status": "open", "source": null, "source_round": null, "items": [] },
    "must_nots": { "status": "open", "source": null, "source_round": null, "items": [] },
    "out_of_scope": { "status": "open", "source": null, "source_round": null, "items": [] },
    "invariants": { "status": "open", "source": null, "source_round": null, "items": [] },
    "preferences": { "status": "open", "source": null, "source_round": null, "items": [] }
  },
  "acceptance_evidence": []
}

The preferences category is state metadata only. Emit volunteered or incidentally relevant preferences, but never treat preferences as a semantic gap target, weakest_dimension, or next question.

For brownfield, set type to "brownfield" and add scores.context. Each category
record is exactly {status,source,source_round,items}. Apply these conditions:
- open: source:null, source_round:null, and zero active items.
- confirmed: source:"user", an integer source_round, and at least one active item;
  outcome has exactly one active item.
- explicit_none: allowed outside outcome only, with source:"user", an integer
  source_round, and zero active items. Preserved historical items are superseded.
Only direct user confirmation may close a category. Oracle conclusions and repository
facts remain open until the user decides.

Each item is exactly
{id,text,source:"user",source_round,state:"active|superseded",supersedes}.
Use stable interview-global IDs: O... outcome, M... must-have, N... must-not,
X... out-of-scope, I... invariant, and P... preference. Preserve all prior items
byte-for-byte in order, including `text` and `source_round`. Never edit, delete, move, reuse, or reactivate an ID. A replacement appends
a higher ID, sets supersedes to the older ID, and marks only that older item superseded.

Each acceptance_evidence entry is exactly
{id,verifies,type,pass_condition,source:"user",source_round}. Use a stable E... ID.
`verifies` is a non-empty unique list of existing M/N/I IDs. `type` is one of
test|inspection|observation|analysis. Preserve prior evidence entries byte-for-byte
and append new entries only. Missing evidence remains a structurally valid snapshot and a transition target; it blocks closure rather than invalidating the round. Every
active M/N/I item needs linked evidence before closure. Preferences never block. Do
not invent evidence or an item merely to fill a slot.

Respond as STRICT JSON only. No prose, no code fences, and no unknown keys.
```

## Valid category examples (include with every dispatch)

<!-- category-examples:start -->
```json
{
  "open": {
    "status": "open",
    "source": null,
    "source_round": null,
    "items": []
  },
  "confirmed": {
    "status": "confirmed",
    "source": "user",
    "source_round": 4,
    "items": [
      {
        "id": "M8",
        "text": "Export a reviewable report",
        "source": "user",
        "source_round": 4,
        "state": "active",
        "supersedes": null
      }
    ]
  },
  "explicit_none": {
    "status": "explicit_none",
    "source": "user",
    "source_round": 6,
    "items": [
      {
        "id": "N3",
        "text": "Never retain temporary uploads",
        "source": "user",
        "source_round": 2,
        "state": "superseded",
        "supersedes": null
      }
    ]
  }
}
```
<!-- category-examples:end -->

## Trigger taxonomy

- **A** — direct contradiction of an established fact
- **B** — internal inconsistency (two requirements that cannot co-hold)
- **C** — low-quality/evasive answer
- **D** — scope expansion (new component/entity/constraint)

## Transcript compression (eligible selected prefix above 4000 tokens)

Use this executable policy before each Oracle scoring dispatch:

<!-- compression-policy:start -->
```json
{
  "trigger_tokens": 4000,
  "latest_verbatim_rounds": 2,
  "selection": "oldest_half_of_eligible_prefix_rounded_up",
  "cache_key": [
    "exact_prefix",
    "global_id_registry",
    "all_component_id_ownership",
    "compression_prompt_version"
  ]
}
```
<!-- compression-policy:end -->

1. The immutable full transcript, stored as append-only `immutableFullTranscript`, is the only source for prefix selection, token counting, cache keys, and the final artifact. Set `eligiblePrefix` to only its complete interview Q&A rounds older than the latest two. The latest two rounds are never eligible, even when they alone exceed 4000 tokens.
2. Set `selectedPrefix` to the oldest `ceil(eligiblePrefix.length / 2)` rounds. Dispatch compression only when `selectedPrefix.length > 0` and its token count is strictly greater than 4000. Exactly 4000 does not dispatch. Two recent rounds therefore make zero compression calls; with three rounds, only round one can be selected.
3. Compute the cache key from the exact UTF-8 bytes of `selectedPrefix`, immutable full interview ID registry, all component ID ownership, and `compressionPromptVersion`. The cache lifetime is one interview. A hit returns the validated summary without a model call; a miss supplies the registry and ownership map as read-only compression context:

> `Summarize the following interview Q&A rounds in ≤500 tokens, preserving every confirmed decision, semantic coverage item and ID, acceptance-evidence link, fired trigger, and score change.`

Validate a candidate before cache insertion: it is at most 500 tokens and retains every semantic/evidence ID, fired trigger, and score-change record present in `selectedPrefix`. A missing semantic or evidence ID makes the summary invalid. Never cache invalid or fallback output; use the original selected rounds verbatim instead.

Build an ephemeral `workingTranscript` by replacing only `selectedPrefix` with the validated summary and keeping the remaining rounds, including the latest two, verbatim. The working transcript is never a source for later prefix selection or cache-key computation. A scoring validation retry must reuse the summary for the same cache key. An unchanged prefix on a later dispatch also reuses it. When the prefix changes, invalidate the previous lookup by computing a new key. Discard `workingTranscript` after the dispatch and discard the entire cache when the interview ends. The full uncompressed transcript is always written to the final spec.

If valid cache key `i` is encountered `k_i` times, compression calls saved across valid key groups are `sum(k_i - 1)`. Avoiding an empty or below-trigger selected prefix saves one otherwise no-op call for each such scoring dispatch.
