# Oracle Scoring Prompt

Dispatch this prompt to `oracle` each round (Phase 2 Step 3) and during Round 0.5 bootstrap. Substitute `{placeholders}` with current values. The oracle returns STRICT JSON only.

---

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

## Trigger taxonomy

- **A** — direct contradiction of an established fact
- **B** — internal inconsistency (two requirements that cannot co-hold)
- **C** — low-quality/evasive answer
- **D** — scope expansion (new component/entity/constraint)

## Transcript compression (mandatory above 4000 tokens)

Before each oracle scoring dispatch, if the accumulated transcript exceeds 4000 tokens, compress the OLDEST half via a separate oracle call:

> `Summarize the following interview Q&A rounds in ≤500 tokens, preserving every confirmed decision, every fired trigger, and every score change.`

Replace those rounds in the working transcript with the summary. Keep the last 2 rounds verbatim. This bounds per-round oracle cost growth from O(n²) to O(n) without losing decisions. The full uncompressed transcript is still written to the final spec.
