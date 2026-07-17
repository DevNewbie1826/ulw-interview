# Plain-language rendering guide

Purpose: load this guide whenever the interviewing agent writes user-facing text: announcements, questions, answer options, progress reports, and final spec prose. The user sees plain language; the internal protocol may keep technical terms for scoring, state, and dispatch.

Default to the user's own language. If the user writes in Korean, answer in Korean; if they write in Japanese, answer in Japanese — always match the user's language unless they ask otherwise. Keep technical names inside internal notes only; if a technical term must appear for the user, explain it immediately in everyday words.

## Glossary

The plain English wording below is the reference rendering. When the user's language is not English, translate each row into plain everyday words of the user's language at `initialize`, then use those renderings consistently for the whole interview. Never expose the internal term itself to the user.

| Internal term | Plain English wording |
| --- | --- |
| ambiguity | fog score (how much is still undecided) |
| threshold | pass line |
| topology | big chunks (groups of work that can succeed or fail on their own) |
| component | chunk |
| ontology | key names (the names that show up in this service) |
| clarity dimensions | the four see-through meters: goal, boundaries, done-test, fit |
| trigger | warning sign |
| floor | safety net score (a score the total can never drop below) |
| closure audit | final check |
| restatement | one-sentence check |
| brownfield | changing existing code |
| greenfield | making something new |

## Tone rules

- Ask one question per message. If there are several things to decide, choose the next most useful one.
- Every number needs a one-line plain explanation. Example: `The fog score is 42% — 4 out of 10 decisions are still open.`
- Do not use unexplained jargon. Replace it with the glossary wording or a short everyday explanation.
- Use everyday analogies when the decision is abstract: rooms in a house, labels on boxes, a checklist before a trip, or choosing a route on a map.
- Phrase options as plain choices, not expert labels.
- Always include an escape path such as `I'm not sure — please choose for me`, or its equivalent in the user's language, when asking the user to pick.
- Keep the user's wording when it is already clear. Do not polish away their intent.
- Progress reports should say what changed, why it matters, and what the next small choice is.
- Spec prose should read like instructions for a teammate, not like a research paper.

## Worked examples

Examples are written in English. Render the same patterns in the user's language, keeping the tone rather than the wording.

### 1. Interview start

> Let's start. First I will split this work into big chunks — groups of work that can succeed or fail on their own. I will ask one question at a time.

### 2. Round question with options

> Next we decide who uses this first. Knowing that keeps the screens, tone, and feature set from growing too big. Which one is closest?
>
> 1. An internal tool the team uses every day
> 2. A screen outside customers use occasionally
> 3. A settings screen only admins use
> 4. I'm not sure — please choose for me

### 3. Progress report after scoring

> The fog score is 42% — 4 out of 10 decisions are still open. The good news: the goal is much clearer now. What is left is deciding what we will call "done", so the next question settles just that one success test.
