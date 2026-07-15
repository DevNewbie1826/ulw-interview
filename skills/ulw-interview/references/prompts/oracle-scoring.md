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

Treat the registry and ownership map as immutable. During baseline, return only the complete snapshot for `currentBaselineComponent`; during a scored round, only the asked component snapshot may change. Never edit, move, or regenerate an ID owned by any component.

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
in order. Never edit, delete, move, reuse, or reactivate an ID. A replacement appends
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

## Transcript compression (mandatory above 4000 tokens)

Before each Oracle scoring dispatch, if the accumulated transcript exceeds 4000 tokens, compress the OLDEST half via a separate Oracle call. Supply the immutable full interview ID registry and all component ID ownership as read-only context:

> `Summarize the following interview Q&A rounds in ≤500 tokens, preserving every confirmed decision, semantic coverage item and ID, acceptance-evidence link, fired trigger, and score change.`

Replace those rounds in the working transcript with the summary. Keep the last 2 rounds verbatim. The full uncompressed transcript is still written to the final spec.
