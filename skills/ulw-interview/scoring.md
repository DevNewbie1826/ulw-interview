# Deep Interview Scoring Prompt

Load this fragment for every `score_answer` effect. The scorer gives semantic judgments only; it does NO arithmetic. The runtime owns weights, aggregation, floors, caps, bands, validation, state, and the next effect.

## Scorer input

Provide this context to the scoring pass:

- `idea`: original idea or prompt-safe summary.
- `transcript`: all rounds or a prompt-safe transcript summary.
- `topology`: locked components with active/deferred status and prior component scores.
- `establishedFacts`: durable fact ledger with ids, evidence, disputed status, and supersession.
- `priorOntology`: previous ontology entities; REUSE an entity name when the concept is the same.
- `roundAnswer`: `{ kind:'user'|'agent', text, source?, confidence?, uncertainty?, autoResearchUsed? }`.
- `target`: runtime-selected component and dimension for this round.

## Scoring task

Score every active component independently from `0.0` to `1.0` for:

1. `goal`: objective, key nouns, and relationships are clear.
2. `constraints`: boundaries, limits, invariants, and non-goals are clear.
3. `criteria`: observable done-tests or acceptance criteria are clear.
4. `context` for brownfield only: how safely we can modify existing code, including fit with verified paths, ownership, and integration risk.

Deferred components stay visible but are excluded from scoring. Do not infer agreement from silence, repository conventions, or agent suggestions.

## Strict JSON output

Return strict JSON only, with these keys and no markdown:

```json
{
  "componentScores": {
    "component-id": {
      "goal": 0.0,
      "constraints": 0.0,
      "criteria": 0.0,
      "context": 0.0,
      "justification": {
        "goal": "one sentence",
        "constraints": "one sentence",
        "criteria": "one sentence",
        "context": "one sentence for brownfield only"
      },
      "gap": {
        "goal": "what remains unclear, or null",
        "constraints": "what remains unclear, or null",
        "criteria": "what remains unclear, or null",
        "context": "what remains unclear, or null"
      }
    }
  },
  "triggers": [
    {
      "kind": "A",
      "status": "active",
      "component": "component-id",
      "dimension": "goal",
      "evidence": "answer text or fact that proves the trigger",
      "rationale": "required for disputed or unresolved status",
      "factId": "fact-id-for-kind-A"
    }
  ],
  "weakestComponentId": "component-id",
  "weakestDimension": "goal",
  "weakestRationale": "one sentence naming the highest-leverage next gap",
  "ontology": [
    {
      "name": "User",
      "type": "core domain",
      "fields": ["id"],
      "relationships": ["User owns Project"]
    }
  ],
  "establishedFacts": []
}
```

For greenfield, omit `context` values or return `null` consistently if the host requires the key. For brownfield, every active component must include `context`.

## Semantics to honor

- Scoring is bidirectional. Later answers can raise ambiguity by lowering a score when they contradict, weaken, or expand earlier understanding.
- Never raise a dimension without new evidence in the current answer, panel findings, or established facts.
- Evasive answers score LOW, not neutral.
- Established facts are durable. Contradicting one REQUIRES trigger `A` with the exact `factId`; never delete or silently rewrite the fact.
- Active trigger means the affected dimension's score MUST drop versus that component's prior score, and the `justification` for that dimension must say why.
- `status` may be `active`, `disputed`, or `unresolved`. `disputed` and `unresolved` require `rationale`.

## Trigger definitions

- `A` direct contradiction: the answer conflicts with an established fact. Example: fact says "mobile only"; answer says "desktop first".
- `B` internal inconsistency: two requirements cannot both hold. Example: "store no data" and "show six-month history".
- `C` low-quality or evasive answer: the answer avoids the target. Example: "make it nice" when asked for a done-test.
- `D` scope expansion: the answer adds a component, entity, constraint, deliverable, or integration not covered or deferred. Example: adding billing to a reporting tool.

## Aggregation expectations

The runtime aggregates after your JSON, but score with this in mind: per-dimension overall clarity is the minimum across active components, so a clear component cannot hide an unclear sibling.

Exact runtime weights:

- Greenfield: `goal = 0.40`, `constraints = 0.30`, `criteria = 0.30`.
- Brownfield: `goal = 0.35`, `constraints = 0.25`, `criteria = 0.25`, `context = 0.15`.

Agent-kind answers are capped by the runtime at `0.85` unless confidence is `high` and uncertainty is `<= 0.05`. Do not pre-cap; score the semantics and preserve confidence/uncertainty evidence in justifications.
