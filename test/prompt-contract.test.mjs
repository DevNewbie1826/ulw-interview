import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const skillDirectory = join(process.cwd(), 'skills', 'ulw-interview');

function readSkillFile(name) {
  const path = join(skillDirectory, name);
  assert.equal(existsSync(path), true, `${name} must exist`);
  return readFileSync(path, 'utf8');
}

test('DI-KEEP-PROMPT-001 exposes exactly one public SKILL.md and keeps all fragments private', () => {
  const markdownFiles = readdirSync(skillDirectory).filter((entry) => entry.endsWith('.md'));
  const frontmatterFiles = markdownFiles.filter((entry) => /^---\nname:/m.test(readSkillFile(entry)));

  assert.deepEqual(frontmatterFiles, ['SKILL.md']);
  assert.match(readSkillFile('SKILL.md'), /^---\nname: ulw-interview\n/m);
  for (const fragment of [
    'auto-answer-uncertain.md',
    'auto-research-greenfield.md',
    'lateral-review-panel.md',
    'scoring.md',
    'spec-template.md',
  ]) {
    assert.doesNotMatch(readSkillFile(fragment), /^---\nname:/m, `${fragment} must not be public frontmatter`);
  }
});

test('DI-PROMPT-NEW-002 scoring.md names min-per-dimension aggregation and exact gajae weights', () => {
  const scoring = readSkillFile('scoring.md');

  assert.match(scoring, /minimum across active components/i);
  assert.match(scoring, /goal\s*[:=]\s*0\.40/i);
  assert.match(scoring, /constraints\s*[:=]\s*0\.30/i);
  assert.match(scoring, /criteria\s*[:=]\s*0\.30/i);
  assert.match(scoring, /goal\s*[:=]\s*0\.35/i);
  assert.match(scoring, /constraints\s*[:=]\s*0\.25/i);
  assert.match(scoring, /criteria\s*[:=]\s*0\.25/i);
  assert.match(scoring, /context\s*[:=]\s*0\.15/i);
});

test('DI-PROMPT-NEW-003 spec-template.md contains every gajae spec heading', () => {
  const template = readSkillFile('spec-template.md');
  for (const heading of [
    '## Metadata',
    '## Clarity Breakdown',
    '## Topology',
    '## Established Facts',
    '## Trigger Metadata',
    '## Lateral Review Panel',
    '## Goal',
    '## Constraints',
    '## Non-Goals',
    '## Acceptance Criteria',
    '## Deferrals',
    '## Assumptions Exposed & Resolved',
    '## Technical Context',
    '## Ontology',
    '## Ontology Convergence',
    '## Interview Transcript',
  ]) {
    assert.match(template, new RegExp(`^${heading}$`, 'm'));
  }
});

test('DI-PROMPT-NEW-006 plain-language.md is language-neutral with plain-English glossary renderings', () => {
  const plainLanguage = readSkillFile('plain-language.md');

  for (const entry of ['ambiguity', 'threshold', 'topology', 'component', 'ontology']) {
    assert.match(plainLanguage, new RegExp(entry, 'i'));
  }
  for (const entry of ['fog score', 'big chunks', 'key names']) {
    assert.match(plainLanguage, new RegExp(entry, 'i'));
  }

  for (const file of readdirSync(skillDirectory, { recursive: true })) {
    if (!file.endsWith('.md')) continue;
    assert.doesNotMatch(readSkillFile(file), /[\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]/, `${file} must stay language-neutral`);
  }
});

test('DI-PROMPT-NEW-005 SKILL.md names metis/momus dispatch targets and contains no alternate bypass path wording', () => {
  const skill = readSkillFile('SKILL.md');

  assert.match(skill, /metis/i);
  assert.match(skill, /momus/i);
  assert.doesNotMatch(skill, /skip(?:ping)?\s+(?:closure|restate|topology|ask)/i);
  assert.doesNotMatch(skill, /bypass(?:es|ing)?\s+(?:closure|restate|topology|ask|the gate)/i);
  assert.doesNotMatch(skill, /proceed(?:ing)?\s+despite\s+high\s+ambiguity/i);
});

test('DI-PROMPT-NEW-007 SKILL.md routes user-facing questions through the host question tool', () => {
  const skill = readSkillFile('SKILL.md');

  assert.match(skill, /question tool/i);
  assert.match(skill, /plain text only when the host has no question tool/i);
});

test('DI-PROMPT-NEW-008 SKILL.md spells out literal metis/momus dispatch and forbids substitution', () => {
  const skill = readSkillFile('SKILL.md');

  assert.match(skill, /task\(subagent_type="metis"\)/);
  assert.match(skill, /task\(subagent_type="momus"\)/);
  assert.match(skill, /do not substitute another agent/i);
});

test('DI-PROMPT-NEW-009 SKILL.md dispatches the scoring pass via metis', () => {
  const skill = readSkillFile('SKILL.md');

  assert.match(
    skill,
    /If it returns `score_answer`, dispatch `scoring\.md` via `task\(subagent_type="metis"\)`, then send `record_score`/,
  );
});
