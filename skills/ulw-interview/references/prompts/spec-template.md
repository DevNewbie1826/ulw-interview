# Spec Template

Write the artifact to `.omo/specs/ulw-interview-{slug}.md` using the `write` tool. The slug is artifact-only: kebab-case, ASCII, at most 60 characters, and suffixed when the path exists. It never supplies interview, fact, semantic item, or evidence identity.

Render confirmed user language, not reducer phases, target kinds, category status names, scorer flags, or trigger labels. Keep stable semantic and evidence IDs only where they create the required audit links.

## Normal spec

```markdown
# Spec: {title}

## Metadata
- Rounds: {count}
- Still unclear: {globalAmbiguity}
- Interview context: {New initiative or Existing system}
- Threshold: {threshold}
- Generated: {timestamp}

## Clarity Breakdown
Render one row for every required dimension of every included component. `Still unclear` in Metadata is exactly the reducer's `globalAmbiguity`, which is the maximum per-component ambiguity; never recompute it from this table.

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

## Clarity Breakdown
Render one row for every required dimension of every included component. `Still unclear` in Metadata is exactly the reducer's `globalAmbiguity`, which is the maximum per-component ambiguity; never recompute it from this table.

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

After either artifact is written, emit `spec_written` with the matching kind and actual path. Do not invent post-spec choices; execute the reducer's next action.
