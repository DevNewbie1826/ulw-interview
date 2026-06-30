# Spec Template

Write the final specification to `.omo/specs/ulw-interview-{slug}.md` using the `write` tool. The slug is kebab-case, ASCII only, max 60 chars, derived from the final one-sentence goal. If the file exists, append `-2`, `-3`, … until the path is free.

## Normal spec (Phase 3 Step 3)

```markdown
# Spec: {title}

## Metadata
- Rounds: {count}
- Still unclear: {score}%
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
| **Still unclear** | | | **{1-total}** |

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
**Still unclear:** {score}%

...

</details>
```

## Incomplete Spec Report (Phase 3 Step 5)

> **Internal name:** Incomplete Spec Report. **User-facing name:** "Summary so far". Never say "Incomplete Spec Report" to the user.

Emit INSTEAD of a normal spec when:
- Round `{roundCap}` (default 30) hard cap reached AND closure guard rejects, OR
- Closure guard rejected 2 times, OR
- User says "enough" / "let's go" / "build it" early-exit AND `globalAmbiguity > threshold + 0.20` (high-ambiguity early exit), OR
- User says "stop" / "cancel" / "abort" mid-interview with `globalAmbiguity > threshold`.

Uses the normal spec structure with these substitutions:
- Replace `## Acceptance Criteria` with `## Unresolved Gaps` listing each open component/dimension and why it remains unclear.
- Add `## Recommended Next Steps` with 1-3 concrete suggestions (e.g., "Re-run interview focused on Component X", "Resolve contradiction between offline requirement and real-time sync requirement").
- Set the metadata `Status: incomplete` field.

The report is still written to `.omo/specs/ulw-interview-{slug}.md`.
