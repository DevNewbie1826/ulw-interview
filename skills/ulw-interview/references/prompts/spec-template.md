# Spec Template

Write the artifact to `.omo/specs/ulw-interview-{slug}.md` using the `write` tool. The slug is artifact-only: kebab-case, ASCII, at most 60 characters, and suffixed when the path exists. It never supplies interview, fact, semantic item, or evidence identity.

Render confirmed user language, not reducer phases, target kinds, category status names, scorer flags, or trigger labels. Keep stable semantic and evidence IDs only where they create the required audit links.

## Write Protocol And Transition Manifest

On `write_spec`, render the artifact completely before acknowledgement. Render all components, all semantic IDs and evidence IDs, and all unresolved gaps represented by the committed reducer state. Then derive the transition manifest from the rendered artifact itself, never from an intended template or pre-render source object.

<!-- transition-manifest:start -->
```json
{
  "kind": "{complete or incomplete}",
  "path": ".omo/specs/ulw-interview-{slug}.md",
  "components": [
    {
      "name": "{component}",
      "status": "{active or deferred}",
      "scored": true,
      "itemIds": ["{O/M/N/X/I/P ID in category and history order}"],
      "evidenceIds": ["{E ID in append order}"]
    }
  ],
  "unresolvedGaps": [
    {
      "component": "{component}",
      "category": "{outcome|must_haves|must_nots|out_of_scope|invariants|acceptance_evidence}",
      "itemId": "{M/N/I ID or null}",
      "reason": "{open or missing_evidence}"
    }
  ],
  "globalAmbiguity": 0.0
}
```
<!-- transition-manifest:end -->

Build `components` in exact reducer order: active topology first, then deferred components. For each component, derive `status` from the rendered Component Scope cell (`In scope` maps to `active`; `Deferred` maps to `deferred`), derive `itemIds`, `evidenceIds`, and boolean `scored` from the rendered artifact's scope, clarity, history, and evidence rows, then compare every field with committed reducer state. Derive every renderable unresolved row from the artifact and bind it to the exact ordered `semanticCoverageGaps` records. Set `globalAmbiguity` to the reducer's committed value.

The manifest `scored` field must match the rendered Component Scope row and the null/non-null score state.

Compare the result with the committed kind, safe path, complete component set, immutable registry, ownership map, ordered `semanticCoverageGaps`, and global ambiguity. Fix any omission before acknowledgement. The manifest check proves only those projected fields; it does not validate file contents or artifact prose beyond the manifest.

Only after that comparison succeeds, emit `spec_written` with the exact `spec_written` payload shown above. `transition.mjs` rejects missing, extra, reordered, or state-divergent manifest fields; it does not inspect the artifact file itself.

## Normal spec

```markdown
# Spec: {title}

## Metadata
- Rounds: {count}
- Still unclear: {globalAmbiguity}
- Interview context: {New initiative or Existing system}
- Threshold: {threshold}
- Generated: {timestamp}

## Component Scope
| Component | Scope | Scoring |
|-----------|-------|---------|
| {component} | In scope | Scored |
| {component} | Deferred | Not scored |

Render exactly one row per manifest component in reducer order. Use `In scope` for current topology and `Deferred` for deferred scope; map `scored:true` to `Scored` and `scored:false` to `Not scored`. Zero semantic gaps does not mean there is no deferred scope: deferred components remain visible here even when Unresolved Semantic Gaps is empty.

## Clarity Breakdown
Render one row for every required dimension of every included component. When `scoreStateMatrix[name]` is null, both Score and Weighted render as `—` in every required row; never invent a score. Keep the configured Weight visible. `Still unclear` in Metadata is exactly the reducer's `globalAmbiguity`, which is the maximum per-component ambiguity; never recompute it from this table.

| Component | Dimension | Score | Weight | Weighted |
|-----------|-----------|-------|--------|----------|
| {component} | Goal Clarity | {component_goal_score} | {goal_weight} | {component_goal_weighted} |
| {component} | Constraint Clarity | {component_constraints_score} | {constraints_weight} | {component_constraints_weighted} |
| {component} | Success Criteria | {component_criteria_score} | {criteria_weight} | {component_criteria_weighted} |
| {existing-system component} | Context Clarity | {component_context_score} | {context_weight} | {component_context_weighted} |

## Category Decisions
| Component | Category | Decision | Confirmed by | Decision round |
|-----------|----------|----------|--------------|----------------|
| {component} | Desired outcome | {Confirmed statement or Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Must-Haves | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Constraints & Invariants | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Must-Nots | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Out of Scope | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Preferences | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |

For a directly confirmed zero-item category, render: `| {component} | {Category} | No items were specified | You | {category_source_round} |`.

## Goal
Render Current and Historical outcome entries.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {O id} | {Current or Historical} | You | {source_round} | {older ID or —} | {desired outcome} |

## Must-Haves
Render Current and Historical must-have entries.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {M id} | {Current or Historical} | You | {source_round} | {older ID or —} | {required capability or result} |

## Constraints & Invariants
Render Current and Historical invariant entries, plus confirmed hard constraints.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {I id} | {Current or Historical} | You | {source_round} | {older ID or —} | {condition that must remain true} |

## Must-Nots
Render Current and Historical must-not entries.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {N id} | {Current or Historical} | You | {source_round} | {older ID or —} | {forbidden behavior, side effect, or outcome} |

## Out of Scope
Render Current and Historical out-of-scope entries.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {X id} | {Current or Historical} | You | {source_round} | {older ID or —} | {work not promised by this delivery} |

## Preferences
Render Current and Historical preference entries. Preferences remain non-blocking.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {P id} | {Current or Historical} | You | {source_round} | {older ID or —} | {tie-breaker preference} |

## Acceptance Evidence
Render all historical evidence in append order, including links to Historical M/N/I entries. Every Current M/N/I entry has at least one link.

| Component | Evidence | Verifies (M/N/I links) | Type | Pass condition | Confirmed by | Confirmation round |
|-----------|----------|-------------------------|------|----------------|--------------|--------------------|
| {component} | {E id} | {M/N/I IDs owned by this component} | {type} | {user-confirmed observable condition} | You | {source_round} |

## Technical Context
| Component | Context | Provenance |
|-----------|---------|------------|
| {component} | {Existing system: relevant codebase finding; New initiative: confirmed technology choice or constraint} | {Repository inspection or You, with source round when applicable} |

## Unresolved Semantic Gaps
| Component | Category or item | What remains unclear |
|-----------|------------------|----------------------|
| — | None | None |

## Interview Transcript
<details>
<summary>Full Q&A ({n} rounds)</summary>

### Round 1
**Q:** {question}
**A:** {answer}
**Still unclear:** {round_globalAmbiguity}

...

</details>
```

## Incomplete Spec Report

> **Internal name:** Incomplete Spec Report. **User-facing name:** "Summary so far". Never show the internal name or reducer artifact kind to the user.

Use this full structure when the reducer returns `write_spec` with the incomplete kind. Preserve confirmed material and evidence links; never promote an open or inferred statement into a requirement.

```markdown
# Summary So Far: {title}

## Metadata
- Rounds: {count}
- Still unclear: {globalAmbiguity}
- Interview context: {New initiative or Existing system}
- Threshold: {threshold}
- Generated: {timestamp}

## Component Scope
| Component | Scope | Scoring |
|-----------|-------|---------|
| {component} | In scope | Scored |
| {component} | Deferred | Not scored |

Render exactly one row per manifest component in reducer order. Use `In scope` for current topology and `Deferred` for deferred scope; map `scored:true` to `Scored` and `scored:false` to `Not scored`. Zero semantic gaps does not mean there is no deferred scope: deferred or pending-baseline components remain visible here even when Unresolved Semantic Gaps is empty.

## Clarity Breakdown
Render one row for every required dimension of every included component. When `scoreStateMatrix[name]` is null, both Score and Weighted render as `—` in every required row; never invent a score. Keep the configured Weight visible. `Still unclear` in Metadata is exactly the reducer's `globalAmbiguity`, which is the maximum per-component ambiguity; never recompute it from this table.

| Component | Dimension | Score | Weight | Weighted |
|-----------|-----------|-------|--------|----------|
| {component} | Goal Clarity | {component_goal_score} | {goal_weight} | {component_goal_weighted} |
| {component} | Constraint Clarity | {component_constraints_score} | {constraints_weight} | {component_constraints_weighted} |
| {component} | Success Criteria | {component_criteria_score} | {criteria_weight} | {component_criteria_weighted} |
| {existing-system component} | Context Clarity | {component_context_score} | {context_weight} | {component_context_weighted} |

## Category Decisions
| Component | Category | Decision | Confirmed by | Decision round |
|-----------|----------|----------|--------------|----------------|
| {component} | Desired outcome | {Confirmed statement or Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Must-Haves | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Constraints & Invariants | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Must-Nots | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Out of Scope | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |
| {component} | Preferences | {Confirmed items / No items were specified / Still undecided} | {You or —} | {category_source_round or —} |

For a directly confirmed zero-item category, render: `| {component} | {Category} | No items were specified | You | {category_source_round} |`.

## Goal
Render Current and Historical outcome entries. Mark unresolved meaning below.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {O id} | {Current or Historical} | You | {source_round} | {older ID or —} | {confirmed outcome statement} |

## Must-Haves
Render Current and Historical must-have entries.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {M id} | {Current or Historical} | You | {source_round} | {older ID or —} | {confirmed capability or result} |

## Constraints & Invariants
Render Current and Historical invariant entries, plus confirmed hard constraints.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {I id} | {Current or Historical} | You | {source_round} | {older ID or —} | {confirmed invariant} |

## Must-Nots
Render Current and Historical must-not entries.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {N id} | {Current or Historical} | You | {source_round} | {older ID or —} | {confirmed forbidden result} |

## Out of Scope
Render Current and Historical out-of-scope entries.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {X id} | {Current or Historical} | You | {source_round} | {older ID or —} | {confirmed exclusion} |

## Preferences
Render Current and Historical preference entries. Preferences remain non-blocking.

| Component | ID | Standing | Confirmed by | Confirmation round | Replaces ID | Statement |
|-----------|----|----------|--------------|--------------------|-------------|-----------|
| {component} | {P id} | {Current or Historical} | You | {source_round} | {older ID or —} | {confirmed preference} |

## Acceptance Evidence
Render all historical evidence in append order, including links to Historical M/N/I entries. Explicitly identify Current M/N/I entries that still lack a link.

| Component | Evidence | Verifies (M/N/I links) | Type | Pass condition | Confirmed by | Confirmation round |
|-----------|----------|-------------------------|------|----------------|--------------|--------------------|
| {component} | {E id} | {M/N/I IDs owned by this component} | {type} | {confirmed observable pass condition} | You | {source_round} |

## Technical Context
| Component | Context | Provenance |
|-----------|---------|------------|
| {component} | {confirmed codebase fact, technology choice, or known integration limit} | {Repository inspection or You, with source round when applicable} |

## Unresolved Semantic Gaps
| Component | Category or item | What remains unclear |
|-----------|------------------|----------------------|
| {component} | {plain-language category or M/N/I item} | {what remains undecided, what proof is missing, or the unresolved contradiction} |

## Recommended Next Steps
- {one concrete way to resolve the highest-impact gap}
- {optional second or third suggestion}

## Interview Transcript
<details>
<summary>Full Q&A ({n} rounds)</summary>

### Round 1
**Q:** {question}
**A:** {answer}
**Still unclear:** {round_globalAmbiguity}

...

</details>
```

After either artifact is written and its transition manifest passes the preflight comparison, emit the full exact `spec_written` payload with matching `kind`, actual `path`, ordered `components`, ordered `unresolvedGaps`, and committed `globalAmbiguity`. Do not invent post-spec choices; execute the reducer's next action.
