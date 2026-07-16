#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduceTransition } from './transition.mjs';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const skillDir = join(runtimeDir, '..', '..');
const promptsDir = join(skillDir, 'references', 'prompts');
const repoDir = join(skillDir, '..', '..');

const packageJson = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
const rootReadme = readFileSync(join(repoDir, 'README.md'), 'utf8');
const runtimeReadme = readFileSync(join(runtimeDir, 'README.md'), 'utf8');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const oracle = readFileSync(join(promptsDir, 'oracle-scoring.md'), 'utf8');
const panel = readFileSync(join(promptsDir, 'lateral-panel.md'), 'utf8');
const spec = readFileSync(join(promptsDir, 'spec-template.md'), 'utf8');
const scopedDocs = [skill, oracle, panel, spec].join('\n');
const publicDocs = [rootReadme, runtimeReadme, scopedDocs].join('\n');
const tests = [];
const scorerPath = join(runtimeDir, 'scorer.mjs');

const TEST_CHAIN = 'node skills/ulw-interview/references/runtime/test.mjs && node skills/ulw-interview/references/runtime/facts-ledger.test.mjs && node skills/ulw-interview/references/runtime/intent-contract.test.mjs && node skills/ulw-interview/references/runtime/scorer-contract.test.mjs && node skills/ulw-interview/references/runtime/transition.test.mjs && node skills/ulw-interview/references/runtime/docs-contract.test.mjs';

const RUNTIME_FILES = [
  'docs-contract.test.mjs', 'facts-ledger.test.mjs', 'factsLedger.mjs',
  'intent-contract.test.mjs', 'README.md', 'refineGate.mjs', 'scorer-contract.test.mjs',
  'scorer.mjs', 'test.mjs', 'transition.mjs', 'transition.test.mjs', 'validate.mjs',
];

const REQUIRED_ACTIONS = [
  'ask_target', 'await_panel_results', 'confirm_intent_contract', 'confirm_topology',
  'dispatch_panel', 'offer_post_spec', 'run_baseline', 'run_closure', 'score_answer',
  'start_planning', 'stop', 'write_spec',
];

const SPEC_HEADINGS = [
  'Goal', 'Must-Haves', 'Constraints & Invariants', 'Must-Nots', 'Out of Scope', 'Preferences', 'Acceptance Evidence', 'Technical Context',
];

function test(name, body) { tests.push({ name, body }); }

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section ${start}`);
  const endIndex = end === null ? source.length : source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section boundary ${end}`); return source.slice(startIndex, endIndex);
}

function assertOrdered(source, tokens, message) {
  let cursor = -1;
  for (const token of tokens) { const next = source.indexOf(token, cursor + 1); assert.ok(next > cursor, `${message}: ${token}`); cursor = next; }
}

function assertHeadings(source, headings, label) {
  for (const heading of headings) assert.match(source, new RegExp(`^## ${heading}$`, 'm'), `${label} missing ${heading}`);
}

function contractJson(source, name) {
  const contract = section(source, `<!-- ${name}:start -->`, `<!-- ${name}:end -->`);
  const fenced = /```json\n([\s\S]*?)\n```/.exec(contract);
  assert.ok(fenced, `missing JSON contract ${name}`); return JSON.parse(fenced[1]);
}

function markdownArtifact(source) {
  const fenced = /```markdown\n([\s\S]*?)\n```/.exec(source);
  assert.ok(fenced, 'missing markdown artifact'); return fenced[1];
}

function runScorer(input) {
  const result = spawnSync('node', [scorerPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function topologyState(interviewId) {
  const initialized = reduceTransition(null, {
    type: 'initialize',
    payload: {
      interviewId, declaredType: 'greenfield', threshold: 0.05,
      roundCap: 30, softWarningRounds: 15, panelCeiling: 30,
    },
  });
  return reduceTransition(initialized.state, {
    type: 'topology_confirmed',
    payload: { activeComponents: ['API', 'UI'], deferredComponents: [] },
  }).state;
}

function baselineResult({ interviewId, apiScores, uiScores, degraded }) {
  const state = topologyState(interviewId);
  const scorerOutput = runScorer({
    threshold: state.threshold,
    type: state.declaredType,
    components: [
      { name: 'API', scores: apiScores },
      { name: 'UI', scores: uiScores },
    ],
    currentRound: 0,
    triggers: [],
    validationScoreClamped: false,
    degraded,
  });
  const event = {
    type: 'baseline_scored',
    payload: {
      scorerOutput,
      coverageByComponent: structuredClone(state.coverageByComponent),
    },
  };
  return { before: state, event, result: reduceTransition(state, event), scorerOutput };
}

function roundFallbackFixture() {
  const prior = baselineResult({
    interviewId: 'docs-round-fallback',
    apiScores: { goal: 0.8, constraints: 0.8, criteria: 0.8 },
    uiScores: { goal: 0.9, constraints: 0.9, criteria: 0.9 },
    degraded: false,
  }).result.state;
  assert.equal(prior.askedTarget.component, 'API');
  const coverage = structuredClone(prior.coverageByComponent);
  const scorerOutput = runScorer({
    threshold: prior.threshold,
    type: prior.declaredType,
    components: [
      { name: 'API', scores: { goal: 0.5, constraints: 0.5, criteria: 0.5 } },
      { name: 'UI', scores: structuredClone(prior.scoreStateMatrix.UI) },
    ],
    priorAmbiguity: prior.priorAmbiguity,
    priorBand: prior.priorBand,
    priorRounds: prior.priorRounds,
    priorBandHistory: prior.priorBandHistory,
    priorPanelRound: prior.priorPanelRound,
    currentRound: prior.currentRound + 1,
    triggers: [],
    validationScoreClamped: false,
    streakCounter: prior.streakCounter,
    lastRoundResolvedWithoutUser: false,
    degraded: true,
  });
  const event = {
    type: 'round_scored',
    payload: {
      scorerOutput,
      refineOutput: null,
      coverageByComponent: coverage,
      scopeExpansion: null,
      earlyExitRequested: false,
    },
  };
  const first = reduceTransition(structuredClone(prior), structuredClone(event));
  const second = reduceTransition(structuredClone(prior), structuredClone(event));
  return { prior, event, first, second, scorerOutput };
}

function tableHeadersAfterHeading(artifact, heading) {
  const start = artifact.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const nextHeading = artifact.indexOf('\n## ', start + heading.length + 3);
  const body = artifact.slice(start, nextHeading === -1 ? artifact.length : nextHeading);
  const lines = body.split('\n');
  const index = lines.findIndex((line, lineIndex) => (
    line.startsWith('|') && /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[lineIndex + 1] ?? '')
  ));
  assert.notEqual(index, -1, `${heading} is missing a table schema`);
  return lines[index].split('|').slice(1, -1).map((cell) => cell.trim());
}

function projectRows(artifact, heading, rows) {
  const headers = tableHeadersAfterHeading(artifact, heading);
  return rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header]])));
}

const TWO_COMPONENT_ARTIFACT_FIXTURE = {
  globalAmbiguity: '0.42',
  clarity: [
    { Component: 'API', Dimension: 'Goal Clarity', Score: '0.90', Weight: '0.35', Weighted: '0.315' },
    { Component: 'UI', Dimension: 'Goal Clarity', Score: '0.60', Weight: '0.35', Weighted: '0.210' },
  ],
  decisions: [
    { Component: 'API', Category: 'Must-Nots', Decision: 'No items were specified', 'Confirmed by': 'You', 'Decision round': '1' },
    { Component: 'UI', Category: 'Must-Nots', Decision: 'Never expose raw tokens', 'Confirmed by': 'You', 'Decision round': '3' },
  ],
  history: {
    Goal: [
      { Component: 'API', ID: 'O1', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '1', 'Replaces ID': '—', Statement: 'Expose an API' },
      { Component: 'UI', ID: 'O2', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '2', 'Replaces ID': '—', Statement: 'Render a dashboard' },
    ],
    'Must-Haves': [
      { Component: 'API', ID: 'M1', Standing: 'Historical', 'Confirmed by': 'You', 'Confirmation round': '1', 'Replaces ID': '—', Statement: 'Return JSON' },
      { Component: 'API', ID: 'M3', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '2', 'Replaces ID': 'M1', Statement: 'Return versioned JSON' },
      { Component: 'UI', ID: 'M2', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '3', 'Replaces ID': '—', Statement: 'Show status' },
    ],
    'Constraints & Invariants': [
      { Component: 'API', ID: 'I1', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '2', 'Replaces ID': '—', Statement: 'Preserve compatibility' },
      { Component: 'UI', ID: 'I2', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '3', 'Replaces ID': '—', Statement: 'Remain keyboard accessible' },
    ],
    'Must-Nots': [
      { Component: 'UI', ID: 'N1', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '3', 'Replaces ID': '—', Statement: 'Never expose raw tokens' },
    ],
    'Out of Scope': [
      { Component: 'API', ID: 'X1', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '2', 'Replaces ID': '—', Statement: 'No GraphQL' },
      { Component: 'UI', ID: 'X2', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '3', 'Replaces ID': '—', Statement: 'No mobile app' },
    ],
    Preferences: [
      { Component: 'API', ID: 'P1', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '2', 'Replaces ID': '—', Statement: 'Prefer REST' },
      { Component: 'UI', ID: 'P2', Standing: 'Current', 'Confirmed by': 'You', 'Confirmation round': '3', 'Replaces ID': '—', Statement: 'Prefer compact density' },
    ],
  },
  evidence: [
    { Component: 'API', Evidence: 'E1', 'Verifies (M/N/I links)': 'M3, I1', Type: 'test', 'Pass condition': 'Versioned response passes', 'Confirmed by': 'You', 'Confirmation round': '2' },
    { Component: 'UI', Evidence: 'E2', 'Verifies (M/N/I links)': 'M2, N1, I2', Type: 'inspection', 'Pass condition': 'Accessible status hides tokens', 'Confirmed by': 'You', 'Confirmation round': '3' },
  ],
  context: [
    { Component: 'API', Context: 'Existing REST service', Provenance: 'Repository inspection' },
    { Component: 'UI', Context: 'Existing design system', Provenance: 'Repository inspection' },
  ],
  gaps: [
    { Component: 'API', 'Category or item': 'Acceptance evidence for M3', 'What remains unclear': 'Load threshold' },
    { Component: 'UI', 'Category or item': 'Out of Scope', 'What remains unclear': 'Tablet layout boundary' },
  ],
};

test('package test entrypoint runs the exact six-suite integration chain', () => {
  assert.equal(packageJson.scripts?.test, TEST_CHAIN);
});

test('root README describes the integrated runtime and current repository surface', () => {
  for (const file of RUNTIME_FILES) assert.match(rootReadme, new RegExp(`\\b${file.replaceAll('.', '\\.') }\\b`), `root README missing ${file}`);
  assert.match(rootReadme, /transition\.mjs[^\n]*(?:authoritative|owns)[^\n]*(?:lifecycle|transition)/i);
  assert.match(rootReadme, /outcome[^\n]*must.?haves[^\n]*must.?nots[^\n]*out.?of.?scope[^\n]*invariants[^\n]*preferences/i);
  assert.match(rootReadme, /acceptance evidence[^\n]*M\/N\/I/i);
  assert.match(rootReadme, /greenfield[^\n]*0\.35[^\n]*0\.35[^\n]*0\.30/i);
  assert.match(rootReadme, /brownfield[^\n]*0\.30[^\n]*0\.30[^\n]*0\.25[^\n]*0\.15/i);
  assert.match(rootReadme, /controlled failures[^\n]*release[^\n]*acquired lock/i);
  assert.match(rootReadme, /npm test[^\n]*six|six[^\n]*npm test/i);
});

test('runtime README documents lifecycle semantic coverage ownership and limitations', () => {
  for (const file of RUNTIME_FILES) assert.match(runtimeReadme, new RegExp(`\\b${file.replaceAll('.', '\\.') }\\b`), `runtime README missing ${file}`);
  assertOrdered(runtimeReadme, ['TOPOLOGY', 'BASELINE', 'ROUND', 'CLOSURE', 'RESTATE', 'WRITE', 'DONE'], 'runtime lifecycle is incomplete');
  assert.match(runtimeReadme, /transition\.mjs[^\n]*sole authoritative lifecycle/i);
  assert.match(runtimeReadme, /semanticCoverageGaps/);
  assert.match(runtimeReadme, /outcome[^\n]*must_haves[^\n]*must_nots[^\n]*out_of_scope[^\n]*invariants[^\n]*preferences/i);
  assert.match(runtimeReadme, /active M\/N\/I[^\n]*acceptance evidence/i);
  assert.match(runtimeReadme, /greenfield[^\n]*0\.35[^\n]*0\.35[^\n]*0\.30/i);
  assert.match(runtimeReadme, /brownfield[^\n]*0\.30[^\n]*0\.30[^\n]*0\.25[^\n]*0\.15/i);
  assert.match(runtimeReadme, /scorer[^\n]*panel signal[^\n]*transition[^\n]*(?:dispatch|sequence)/i);
  assert.match(runtimeReadme, /controlled failures[^\n]*release[^\n]*acquired lock/i);
  assert.match(runtimeReadme, /npm test[^\n]*six|six[^\n]*npm test/i);
  assert.match(runtimeReadme, /## Known Limitations/);
});

test('public READMEs document every hardened runtime boundary', () => {
  for (const readme of [rootReadme, runtimeReadme]) {
    assert.ok(readme.includes('[A-Za-z0-9][A-Za-z0-9._-]{0,127}'), 'safe interview ID grammar missing');
    assert.ok(readme.includes('.omo/specs/ulw-interview-{slug}.md'), 'contained spec path missing');
    assert.match(readme, /greenfield[^\n]*exactly[^\n]*goal[^\n]*constraints[^\n]*criteria[^\n]*(?:reject|no)[^\n]*context/i);
    assert.match(readme, /trigger[^\n]*enrich[^\n]*askedTarget\.component[^\n]*scorer/i);
    assert.match(readme, /panel findings[^\n]*persona[^\n]*same order/i);
    assert.match(readme, /reopened baseline[^\n]*(?:only|exactly)[^\n]*null-scored/i);
    assert.match(readme, /FactsLedger[^\n]*exact schema[^\n]*non-negative integer[^\n]*source rounds/i);
    assert.match(readme, /closure_passed[^\n]*semanticCoverageGaps[^\n]*(?:exactly empty|zero-gap)/i);
    assert.match(readme, /missing[^\n]*acceptance evidence[^\n]*closure_passed[^\n]*reject/i);
    assert.match(readme, /round score[^\n]*askedTarget\.component[^\n]*unasked sibling[^\n]*(?:unchanged|reject)/i);
    assert.match(readme, /closure[^\n]*pending[^\n]*passed[^\n]*confirmed/i);
    assert.match(readme, /RESTATE/i);
    assert.match(readme, /artifact[^\n]*component-aware[^\n]*per-component[^\n]*scores[^\n]*globalAmbiguity[^\n]*MAX/i);
    assert.match(readme, /canonical validation fallback[^\n]*retry[^\n]*exactly once[^\n]*retryHint/i);
    assert.match(readme, /required scores[^\n]*0\.5[^\n]*validationScoreClamped[^\n]*false[^\n]*degraded[^\n]*true/i);
    assert.match(readme, /initial baseline[^\n]*open coverage[^\n]*round[^\n]*askedTarget\.component[^\n]*byte-for-byte[^\n]*sibling[^\n]*unchanged/i);
    assert.match(readme, /no triggers[^\n]*FactsLedger effects[^\n]*registry allocations[^\n]*semantic mutations[^\n]*byte-identical/i);
    assert.match(readme, /before[^\n]*first scorer output[^\n]*no numeric[^\n]*first scorer output[^\n]*effective threshold[^\n]*1 - scorerOutput\.threshold/i);
    assert.match(readme, /-1[^\n]*0\.000001[^\n]*0\.05[^\n]*0\.05[^\n]*1[^\n]*0\.30/);
  }
  assert.match(runtimeReadme, /MAX_COMPONENT_NAME_LENGTH[\s\S]*120/);
  assert.match(runtimeReadme, /MAX_KNOWN_COMPONENTS[\s\S]*64/);
  assert.match(runtimeReadme, /MAX_SERIALIZED_STATE_BYTES[\s\S]*1048576/);
  assert.match(runtimeReadme, /MAX_SERIALIZED_EVENT_BYTES[\s\S]*1048576/);
  assert.match(runtimeReadme, /MAX_SERIALIZED_PROJECTION_BYTES[\s\S]*262144/);
  assert.match(runtimeReadme, /MAX_SERIALIZED_RESULT_BYTES[\s\S]*3145728/);
  assert.match(runtimeReadme, /MAX_RAW_TRANSITION_BYTES[\s\S]*2101248/);
  assert.match(runtimeReadme, /MAX_VALIDATOR_INPUT_BYTES[\s\S]*1048576/);
  assert.match(runtimeReadme, /MAX_REGISTRY_CONTEXT_BYTES[\s\S]*262144/);
  assert.match(runtimeReadme, /MAX_HISTORY_CONTEXT_BYTES[\s\S]*262144/);
  assert.match(runtimeReadme, /MAX_INPUT_BYTES[\s\S]*1048576/);
  assert.match(runtimeReadme, /MAX_VALIDATION_ERRORS[\s\S]*64/);
  assert.match(runtimeReadme, /MAX_DIAGNOSTICS[\s\S]*64/);
});

test('public READMEs document pending baseline registry and malformed lock contracts', () => {
  for (const readme of [rootReadme, runtimeReadme]) {
    assert.match(readme, /pendingBaselineComponents[^\n]*null-scored[^\n]*user_stop/i);
    assert.match(readme, /currentBaselineComponent[^\n]*globalIdOwners[^\n]*--registry-context/i);
    assert.match(readme, /malformed[^\n]*lock[^\n]*filesystem mtime[^\n]*fresh[^\n]*preserv[^\n]*stale[^\n]*reclaim/i);
  }
});

test('public READMEs document panel history authority and retained baseline immutability', () => {
  for (const readme of [rootReadme, runtimeReadme]) {
    assert.match(readme, /panelDispatchHistory[^\n]*(?:authoritative|authority)[^\n]*panelDispatchCount[^\n]*priorPanelRound/i);
    assert.match(readme, /panelDispatchHistory[^\n]*ordered[^\n]*cooldown[^\n]*chronolog/i);
    assert.match(readme, /panelDispatchHistory[^\n]*(?:globalAmbiguity|ambiguity)[^\n]*band[^\n]*scorer-history/i);
    assert.match(readme, /currentRound\s*-\s*priorPanelRound\s*>\s*PANEL_COOLDOWN/);
    assert.match(readme, /\[1,\s*3\][^\n]*reject[^\n]*\[1,\s*4\][^\n]*legal/i);
    assert.match(readme, /reopened baseline[^\n]*retained[^\n]*scores[^\n]*coverage[^\n]*(?:immutable|unchanged|byte-equivalent)/i);
  }
});

test('public docs contain no retired contracts old weights or fixed assertion counts', () => {
  assert.doesNotMatch(publicDocs, /ontologyConverged|ontologySnapshots|convergence\.mjs|ontology convergence|ontology escalation/i);
  assert.doesNotMatch(publicDocs, /goal[^\n]*0\.40[^\n]*constraints[^\n]*0\.30[^\n]*criteria[^\n]*0\.30/i);
  assert.doesNotMatch(publicDocs, /goal[^\n]*0\.35[^\n]*constraints[^\n]*0\.25[^\n]*criteria[^\n]*0\.25[^\n]*context[^\n]*0\.15/i);
  assert.doesNotMatch(publicDocs, /goal-only restate|restate[^\n]*(?:goal (?:alone|only)|only the goal)/i);
  assert.doesNotMatch(publicDocs, /\b\d+\s+(?:inline\s+)?assertions?\b|assertions?[^\n]*\(\d+ at the time/i);
  assert.doesNotMatch(scopedDocs, /-0\.15|panel[ _-]?cooldown[^\n]*default[^\n]*2|(?:stall[ _-]?window[^\n]*0\.05|(?:last|recent) 3[^\n]*0\.05)/i);
  assert.doesNotMatch(scopedDocs, /THRESHOLD_(?:MIN|MAX)[^\n]*(?:1e-6|0\.30)|threshold[^\n]*(?:clamp|edge)[^\n]*(?:1e-6|0\.30)/i);
});

test('transition lifecycle is the sole instruction authority', () => {
  assert.match(
    skill,
    /transition\.mjs[^\n]*sole authoritative lifecycle/i,
    'absent authoritative transition lifecycle',
  );

  const pipeline = section(skill, '### Round answer pipeline', '### Reducer action handling');
  assertOrdered(
    pipeline,
    ['askedTarget', 'oracle', 'validate.mjs', 'FactsLedger', 'refineGate.mjs', 'scorer.mjs', 'round_scored'],
    'round pipeline is out of order',
  );
  assert.match(pipeline, /coverage[^\n]*refineOutput[^\n]*null/i);
  assert.match(
    pipeline,
    /every validated trigger[^\n]*component[^\n]*askedTarget\.component[^\n]*before[^\n]*scorer\.mjs/i,
    'validated triggers are not enriched with the asked component before scoring',
  );
  assert.match(pipeline, /replace[^\n]*state[^\n]*result\.state/i);
  assert.match(pipeline, /semanticCoverageGaps/);
  assert.match(pipeline, /--history-context/);

  const handling = section(skill, '### Reducer action handling', '## Phase 0:');
  const documentedActions = [...handling.matchAll(/^\| `([a-z_]+)` \|/gm)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(documentedActions, REQUIRED_ACTIONS);
  assert.match(handling, /execute only[^\n]*result\.action/i);

  assert.match(skill, /caller-supplied[^\n]*interview ID[^\n]*before[^\n]*FactsLedger/i);
  assert.ok(
    skill.includes('[A-Za-z0-9][A-Za-z0-9._-]{0,127}'),
    'caller instructions omit the runtime-safe interview ID grammar',
  );
  assert.match(
    skill,
    /spec_written[^\n]*\.omo\/specs\/ulw-interview-\{slug\}\.md/i,
    'spec_written does not acknowledge the runtime-safe artifact path grammar',
  );
  assert.doesNotMatch(skill, /factsLedgerInterviewId[^\n]*slug|INTERVIEW_ID[^\n]*slug/i);
  assert.doesNotMatch(scopedDocs, /-0\.15|panelCooldown[^\n]*default[^\n]*2/i);
  assert.doesNotMatch(scopedDocs, /last 3[^\n]*0\.05|goal\s*[×*]\s*0\.[0-9]+/i);
  assert.match(skill, /state[^\n]*opaque trusted tool output[^\n]*exact `result\.state`/i);
  assert.match(skill, /never[^\n]*user-supplied replacement state/i);
});

test('primary caller cannot replace or bypass Oracle semantic scoring', () => {
  const authority = contractJson(skill, 'scoring-authority');
  assert.deepEqual(authority, {
    tool: 'task',
    subagent_type: 'oracle',
    load_skills: [],
    run_in_background: false,
    prompt_source: 'references/prompts/oracle-scoring.md',
    history_context: 'required-current-component-snapshot',
    semantic_output_fields: [
      'scores',
      'weakest_dimension',
      'triggers',
      'justification',
      'gap',
      'coverage',
      'acceptance_evidence',
    ],
    primary_caller_mode: 'opaque-relay',
    on_validation_failure: 'retry-once-then-canonical-fallback',
    on_oracle_unavailable: 'stop',
  });
});

test('validation fallback instructions define the canonical side-effect-free event', () => {
  const fallback = section(skill, '### Canonical validation fallback', '### Reducer action handling');
  assert.match(fallback, /retry[^\n]*exactly once[^\n]*retryHint/i);
  assert.match(fallback, /every required score[^\n]*0\.5/i);
  assert.match(fallback, /initial baseline[^\n]*reducer-created open[^\n]*coverage/i);
  assert.match(fallback, /round[^\n]*askedTarget\.component[^\n]*prior coverage[^\n]*byte-for-byte/i);
  assert.match(fallback, /sibling[^\n]*scores[^\n]*coverage[^\n]*unchanged/i);
  assert.match(fallback, /no triggers[^\n]*FactsLedger effects[^\n]*registry allocations[^\n]*semantic mutations/i);
  assert.match(fallback, /validationScoreClamped[^\n]*false[^\n]*degraded[^\n]*true/i);
  assert.match(fallback, /identical state[^\n]*event[^\n]*byte-identical/i);
});

test('canonical fallback executes through baseline and deterministic round reducers', () => {
  const fallbackScores = { goal: 0.5, constraints: 0.5, criteria: 0.5 };
  const baseline = baselineResult({
    interviewId: 'docs-baseline-fallback',
    apiScores: fallbackScores,
    uiScores: { goal: 0.9, constraints: 0.9, criteria: 0.9 },
    degraded: true,
  });
  assert.deepEqual(baseline.scorerOutput.perComponent[0].scores, fallbackScores);
  assert.deepEqual(baseline.scorerOutput.perComponent[1].scores, { goal: 0.9, constraints: 0.9, criteria: 0.9 });
  assert.deepEqual(baseline.event.payload.coverageByComponent, baseline.before.coverageByComponent);
  assert.deepEqual(baseline.scorerOutput.perComponent.flatMap((component) => component.firedDims), []);
  assert.equal(baseline.scorerOutput.validationScoreClamped, false);
  assert.equal(baseline.scorerOutput.degraded, true);
  assert.equal(baseline.result.state.degraded, true);

  const round = roundFallbackFixture();
  assert.deepEqual(round.scorerOutput.perComponent[0].scores, fallbackScores);
  assert.deepEqual(round.scorerOutput.perComponent[1].scores, round.prior.scoreStateMatrix.UI);
  assert.deepEqual(round.event.payload.coverageByComponent, round.prior.coverageByComponent);
  assert.deepEqual(round.first.state.coverageByComponent, round.prior.coverageByComponent);
  assert.deepEqual(round.scorerOutput.perComponent.flatMap((component) => component.firedDims), []);
  assert.equal(round.scorerOutput.validationScoreClamped, false);
  assert.equal(round.scorerOutput.degraded, true);
  assert.equal(round.first.state.degraded, true);
  assert.equal(JSON.stringify(round.first), JSON.stringify(round.second));
});

test('threshold UX waits for scorer clamp and uses effective threshold', () => {
  const phaseZero = section(skill, '## Phase 0: Resolve Threshold', '## Phase 1:');
  const phaseOne = section(skill, '## Phase 1: Initialize', '## Round 0:');
  const baseline = section(skill, '## Round 0.5: Initial Scoring', '## Phase 2:');
  assert.doesNotMatch(phaseZero, /\{percent\}|\b\d+(?:\.\d+)?%/);
  assert.doesNotMatch(phaseOne, /\{percent\}|\b\d+(?:\.\d+)?%/);
  assert.match(phaseZero, /before[^\n]*first scorer output[^\n]*no numeric/i);
  assert.match(baseline, /first scorer output[^\n]*1 - scorerOutput\.threshold/i);

  const cases = [
    { raw: -1, threshold: 0.000001, percentage: 99.9999 },
    { raw: 0.05, threshold: 0.05, percentage: 95 },
    { raw: 1, threshold: 0.30, percentage: 70 },
  ];
  const actual = cases.map(({ raw }) => {
    const output = runScorer({
      threshold: raw,
      type: 'greenfield',
      components: [{ name: 'API', scores: { goal: 0.5, constraints: 0.5, criteria: 0.5 } }],
      currentRound: 0,
      triggers: [],
      validationScoreClamped: false,
      degraded: false,
    });
    return {
      raw,
      threshold: output.threshold,
      percentage: Number(((1 - output.threshold) * 100).toFixed(4)),
    };
  });
  assert.deepEqual(actual, cases);
  assert.doesNotMatch(`${phaseZero}\n${phaseOne}`, /200%|-\d+(?:\.\d+)?%/);
});

test('panel findings preserve acknowledged persona identity and order', () => {
  assert.match(panel, /\{persona,summary,options,confidence\}/);
  assert.match(
    panel,
    /finding[^\n]*each acknowledged persona[^\n]*same order|same order[^\n]*acknowledged persona[^\n]*finding/i,
  );
  assert.match(panel, /panel_completed[^\n]*complete ordered findings array/i);
});

test('panel personas launch in one concurrent batch behind an all-results barrier', () => {
  assert.match(panel, /single parallel dispatch batch/i);
  assert.match(panel, /concurrently/i);
  assert.match(panel, /independent (?:copy of )?context/i);
  assertOrdered(
    panel,
    ['single parallel dispatch batch', 'panel_dispatched', 'all-results barrier', 'panel_completed'],
    'panel concurrency or all-results barrier is ambiguous',
  );
  assert.match(panel, /reassemble[^\n]*reducer-returned persona order/i);
  assert.match(panel, /sum\(L_i\)[^\n]*max\(L_i\)/i);
  assert.match(panel, /timeout|dispatch error|invalid result/i);
  assert.match(panel, /panel_failed[^\n]*discard[^\n]*partial/i);
  assert.match(panel, /failed dispatches[^\n]*remain counted|dispatch count[^\n]*not rolled back/i);
  assert.match(panel, /launch fails[^\n]*do not emit `panel_dispatched`[^\n]*panel_failed[^\n]*dispatch_error/i);
  assert.match(panel, /atomically records[^\n]*intended persona batch/i);
  assert.match(skill, /panel_failed[^\n]*pending target[^\n]*one question/i);
});

test('compression policy executes two and three-round boundaries and valid-cache reuse', () => {
  const policy = contractJson(oracle, 'compression-policy');
  assert.deepEqual(policy, {
    trigger_tokens: 4000,
    latest_verbatim_rounds: 2,
    selection: 'oldest_half_of_eligible_prefix_rounded_up',
    cache_key: [
      'exact_prefix', 'global_id_registry', 'all_component_id_ownership',
      'compression_prompt_version',
    ],
  });

  function plan(roundTokenCounts) {
    const eligiblePrefix = roundTokenCounts.slice(0, Math.max(0, roundTokenCounts.length - policy.latest_verbatim_rounds));
    const selectedPrefix = eligiblePrefix.slice(0, Math.ceil(eligiblePrefix.length / 2));
    return {
      eligiblePrefix,
      selectedPrefix,
      dispatch: selectedPrefix.length > 0
        && selectedPrefix.reduce((total, tokens) => total + tokens, 0) > policy.trigger_tokens,
    };
  }

  assert.deepEqual(plan([2501, 2501]), { eligiblePrefix: [], selectedPrefix: [], dispatch: false });
  assert.deepEqual(plan([4000, 2501, 2501]), { eligiblePrefix: [4000], selectedPrefix: [4000], dispatch: false });
  assert.deepEqual(plan([4001, 2501, 2501]), { eligiblePrefix: [4001], selectedPrefix: [4001], dispatch: true });
  assert.match(oracle, /validation retry[^\n]*reuse[^\n]*same cache key/i);
  assert.match(oracle, /unchanged prefix[^\n]*reuse/i);
  assert.match(oracle, /prefix changes[^\n]*invalidat/i);
  assert.match(oracle, /never cache[^\n]*(?:invalid|fallback)/i);
  assert.match(oracle, /immutable full transcript[^\n]*only source/i);
  assert.match(oracle, /working transcript[^\n]*never[^\n]*(?:selection|cache key)/i);
  assert.match(oracle, /cache lifetime[^\n]*one interview/i);
  assert.match(oracle, /missing[^\n]*(?:semantic|evidence) ID[^\n]*invalid/i);
  assert.match(skill, /immutableFullTranscript[^\n]*workingTranscript[^\n]*compressionCache/i);
  assert.match(oracle, /calls saved[^\n]*sum[^\n]*\(k_i - 1\)/i);
});

test('reducer action exclusively owns target selection', () => {
  const execution = section(skill, '## Execution Policy', '## Communication Style');
  assert.doesNotMatch(execution, /target the WEAKEST clarity dimension|rotate targeting/i);
});

test('factual findings still require exactly one user confirmation for ask_target', () => {
  const ask = section(skill, '### Step 1: Generate Next Question', '### Step 3: Score Ambiguity');
  assert.match(ask, /every `ask_target`[^\n]*exactly one[^\n]*user/i);
  assert.match(ask, /factual findings[^\n]*inform[^\n]*confirmation/i);
  assert.match(ask, /never[^\n]*auto-complete[^\n]*`ask_target`/i);
  assert.doesNotMatch(ask, /answer it yourself|resolved without direct user/i);
});

test('fast-answer guidance enriches the same component without another question', () => {
  const ask = section(skill, '### Step 1: Generate Next Question', '### Step 3: Score Ambiguity');
  assert.match(ask, /optional fast-answer guidance/i);
  for (const detail of ['must-have', 'must-not', 'out-of-scope', 'invariant', 'evidence']) {
    assert.match(ask, new RegExp(detail, 'i'), `fast-answer guidance omits ${detail}`);
  }
  assert.match(ask, /same single question/i);
  assert.match(ask, /no second (?:target|question)|never ask a second (?:target|question)/i);
  assert.match(ask, /same component/i);
  assert.match(ask, /sibling components[^\n]*(?:immutable|byte-for-byte)/i);
  assert.match(oracle, /fast-answer[^\n]*same component/i);
  assert.match(oracle, /no second target[^\n]*no second question/i);

  const trace = [
    { action: 'ask_target', component: 'API', target: 'must_haves' },
    { tool: 'question', calls: [...ask.matchAll(/Then call the `question` tool:/g)].length },
    { answer: 'one free-text answer with related M/N/X/I/E details' },
    { oracle: 'capture', mutableComponents: ['API'] },
    { event: 'round_scored', questionsAsked: 1 },
  ];
  assert.equal(trace[1].calls, 1);
  assert.equal(trace.at(-1).questionsAsked, 1);
  assert.deepEqual(trace[3].mutableComponents, [trace[0].component]);
});

test('Oracle category examples enforce conditional provenance and cardinality', () => {
  const examples = contractJson(oracle, 'category-examples');
  assert.deepEqual(examples.open, { status: 'open', source: null, source_round: null, items: [] });
  assert.equal(examples.confirmed.source, 'user');
  assert.equal(Number.isInteger(examples.confirmed.source_round), true);
  assert.ok(examples.confirmed.items.length > 0);
  assert.ok(examples.confirmed.items.some((item) => item.state === 'active'));
  assert.equal(examples.explicit_none.source, 'user');
  assert.equal(Number.isInteger(examples.explicit_none.source_round), true);
  assert.ok(examples.explicit_none.items.every((item) => item.state === 'superseded'));
  assert.match(oracle, /missing evidence[^\n]*valid snapshot[^\n]*transition target/i);
});

test('every Oracle call receives the immutable global ID registry and ownership map', () => {
  assert.match(oracle, /Immutable full interview ID registry: \{global_id_registry\}/);
  assert.match(oracle, /All component ID ownership: \{all_component_id_ownership\}/);
  const pipeline = section(skill, '### Round answer pipeline', '### Reducer action handling');
  assert.match(pipeline, /every Oracle invocation[^\n]*immutable full interview ID registry/i);
  assert.match(pipeline, /all component ID ownership/i);
  assert.match(skill, /every Oracle invocation[^\n]*baseline[^\n]*round[^\n]*panel[^\n]*closure[^\n]*compression/i);
  assert.match(panel, /immutable full interview ID registry[^\n]*all component ID ownership/i);
  const closure = section(skill, '**Closure / acceptance guard.**', '**Restate / intent-contract gate.**');
  assert.match(closure, /immutable full interview ID registry[^\n]*all component ID ownership/i);
  const compression = section(oracle, '## Transcript compression', null);
  assert.match(compression, /immutable full interview ID registry[^\n]*all component ID ownership/i);
});

test('round Oracle output may mutate only the asked component snapshot', () => {
  assert.match(oracle, /only the asked component[^\n]*may change/i);
  assert.match(skill, /only the asked target's component[^\n]*change/i);
});

test('Oracle coverage and both spec artifacts preserve the full intent contract', () => {
  const normal = section(spec, '## Normal spec', '## Incomplete Spec Report');
  const incomplete = section(spec, '## Incomplete Spec Report', null);
  assertHeadings(normal, SPEC_HEADINGS, 'normal spec');
  assertHeadings(incomplete, [...SPEC_HEADINGS, 'Unresolved Semantic Gaps'], 'incomplete spec');
  assert.match(normal, /M\/N\/I[^\n]*link|link[^\n]*M\/N\/I/i);
  assert.match(incomplete, /M\/N\/I[^\n]*link|link[^\n]*M\/N\/I/i);

  for (const category of [
    'outcome', 'must_haves', 'must_nots', 'out_of_scope', 'invariants',
    'preferences', 'acceptance_evidence',
  ]) {
    assert.match(oracle, new RegExp(`\\b${category}\\b`), `Oracle schema missing ${category}`);
  }
  for (const field of [
    'status', 'source', 'source_round', 'items', 'supersedes', 'verifies', 'pass_condition',
  ]) {
    assert.match(oracle, new RegExp(`\\b${field}\\b`), `Oracle schema missing ${field}`);
  }
  assert.match(oracle, /contrastive[^\n]*gap[^\n]*rationale/i);
  assert.match(oracle, /semantic[^\n]*judgment[^\n]*Oracle|Oracle[^\n]*semantic[^\n]*judgment/i);
});

test('panels are milestone-only non-ready stall reframes with exact acknowledgement', () => {
  assert.doesNotMatch(panel, /^\| `ready`/m, 'ready panel path remains');
  assert.match(panel, /milestone-only/i);
  assert.match(panel, /non-ready/i);
  assert.match(panel, /stall reframe/i);
  assert.doesNotMatch(panel, /ontology/i);
  assertOrdered(
    panel,
    ['dispatch_panel', 'panel_dispatched', 'personas', 'await_panel_results', 'panel_completed'],
    'panel acknowledgement flow is out of order',
  );
  assert.match(panel, /exact[^\n]*personas[^\n]*returned|returned[^\n]*personas[^\n]*exact/i);
  assert.match(panel, /panelDispatchCount[^\n]*personas\.length/);
  assert.match(panel, /each and only[^\n]*returned[^\n]*persona/i);
});

test('panel prose never mandates a persona outside the returned list', () => {
  assert.doesNotMatch(panel, /ask the contrarian|contrarian[^\n]*(mandatory|required)/i);
});

test('scoped instructions contain no ontology or convergence contract', () => {
  assert.doesNotMatch(
    scopedDocs,
    /ontologyConverged|ontologySnapshots|convergence\.mjs|ontology convergence|ontology escalation/i,
    'ontology/convergence text remains',
  );
});

test('final confirmation covers Build Preserve-Never and Not included', () => {
  const restate = section(skill, '**Restate / intent-contract gate.**', '**Generate the specification.**');
  assert.match(restate, /\*\*Build:\*\*/i, 'goal-only restate remains');
  assert.match(restate, /\*\*Preserve \/ Never:\*\*/i);
  assert.match(restate, /\*\*Not included:\*\*/i);
  assert.match(restate, /restate_confirmed/);
  assert.match(restate, /restate_corrected/);

  const postSpec = section(skill, '**Post-spec action.**', '## State Variables');
  assert.match(postSpec, /offer_post_spec/);
  assert.match(postSpec, /allowContinue/);
  assert.match(postSpec, /Continue interview[^\n]*only[^\n]*true/i);
  assert.match(postSpec, /write_spec[^\n]*incomplete[^\n]*stop|incomplete[^\n]*write_spec[^\n]*stop/i);
});

test('final restatement confirms preferences and acceptance evidence', () => {
  const restate = section(skill, '**Restate / intent-contract gate.**', '**Generate the specification.**');
  assert.match(restate, /\*\*Preferences:\*\*/i);
  assert.match(restate, /\*\*Acceptance evidence:\*\*/i);
});

test('early exit has no caller round gate', () => {
  const limits = section(skill, '### Step 5: Check Limits', '## Phase 3:');
  assert.doesNotMatch(limits, /Round 3\+|round\s*(?:>=|>|at least)\s*3/i);
  assert.match(limits, /early exit[^\n]*whenever[^\n]*user requests/i);
});

test('known semantic gaps short-circuit closure model calls with bounded states', () => {
  const limits = section(skill, '### Step 5: Check Limits', '## Phase 3:');
  const closure = section(skill, '**Closure / acceptance guard.**', '**Restate / intent-contract gate.**');
  assert.match(limits, /hard cap[^\n]*semanticCoverageGaps[^\n]*nonempty[^\n]*incomplete[^\n]*`write_spec`/i);
  assert.match(limits, /early exit[^\n]*semanticCoverageGaps[^\n]*nonempty[^\n]*incomplete[^\n]*`write_spec`/i);
  assert.match(limits, /without `run_closure`[^\n]*zero closure Oracle calls[^\n]*zero additional user questions/i);
  assert.match(limits, /known-gap short-circuit[^\n]*one Oracle call/i);
  assert.match(closure, /`run_closure`[^\n]*semanticCoverageGaps[^\n]*empty/i);
  assert.match(closure, /never emit `closure_passed`[^\n]*nonempty/i);
});

test('expected duration and optional discovery preset preserve the assurance default', () => {
  const duration = section(rootReadme, '## Expected Duration', '## Configuration');
  assert.match(duration, /planning envelope[^\n]*not an empirical benchmark/i);
  assert.match(duration, /T\s*=/);
  for (const term of ['topology', 'baseline', 'user', 'scoring', 'validation retry', 'compression', 'panel', 'closure', 'restate', 'artifact']) {
    assert.match(duration, new RegExp(term, 'i'), `duration model omits ${term}`);
  }
  assert.match(duration, /model[^\n]*user[^\n]*latency[^\n]*dominates/i);
  assert.doesNotMatch(duration, /observed|p95|median|20-75|30-165|60-330/i);
  for (const source of [rootReadme, runtimeReadme, skill]) {
    assert.match(source, /product discovery[^\n]*0\.10[^\n]*15[^\n]*8[^\n]*6/i);
    assert.match(source, /default[^\n]*high-assurance[^\n]*0\.05|high-assurance[^\n]*default[^\n]*0\.05/i);
    assert.match(source, /never adapt[^\n]*threshold[^\n]*mid-session/i);
  }
  assert.match(duration, /trade-?off[^\n]*(?:speed|faster)[^\n]*(?:assurance|certainty|coverage)/i);
  assert.doesNotMatch(skill, /30-40[^\n]*product discovery/i);
});

test('both artifacts expose component scope and deterministic unscored rows', () => {
  const normal = markdownArtifact(section(spec, '## Normal spec', '## Incomplete Spec Report'));
  const incomplete = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  for (const [label, artifact] of [['normal', normal], ['incomplete', incomplete]]) {
    assert.match(artifact, /## Component Scope/, label);
    assert.match(artifact, /Component \| Scope \| Scoring/, label);
    assert.match(artifact, /\{component\} \| Deferred \| Not scored/, label);
    assert.match(artifact, /scoreStateMatrix[^\n]*null[^\n]*Score[^\n]*Weighted[^\n]*—/i, label);
  }
  assert.match(spec, /manifest[^\n]*scored[^\n]*component scope/i);
  assert.match(spec, /derive[^\n]*status[^\n]*component scope[^\n]*compare[^\n]*committed/i);
  assert.match(spec, /zero semantic gaps[^\n]*does not mean[^\n]*no deferred scope/i);
});

test('spec_written instructions never collapse the acknowledgement to kind and path', () => {
  for (const source of [skill, spec]) {
    assert.doesNotMatch(source, /emit `spec_written` with (?:the )?(?:returned|matching) kind and (?:the )?actual path\.?/i);
  }
  assert.match(skill, /spec_written[^\n]*components[^\n]*unresolvedGaps[^\n]*globalAmbiguity/i);
  assert.match(spec, /exact `spec_written` payload/i);
});

test('soft warning is informational inside the one returned-target question', () => {
  const limits = section(skill, '### Step 5: Check Limits', '## Phase 3:');
  assert.match(limits, /soft warning[^\n]*informational[^\n]*same returned-target question/i);
  assert.doesNotMatch(limits, /soft warning[^\n]*offer to continue/i);
});

test('Escalation soft warning annotates one reducer-selected question only', () => {
  const escalation = section(skill, '## Escalation And Stop Conditions', null);
  assert.match(escalation, /soft warning[^\n]*informational[^\n]*same reducer-selected question/i);
  assert.doesNotMatch(escalation, /offer to continue|use what has been confirmed|continue or proceed/i);
});

test('baseline Oracle allocation is serial and commits registry ownership between components', () => {
  const baseline = section(skill, '## Round 0.5: Initial Scoring', '## Phase 2:');
  assertOrdered(baseline, [
    'run_baseline.components', 'serial', 'currentBaselineComponent', 'globalIdOwners',
    'validate.mjs', 'reject', 'retry', 'incorporate', 'next component',
    'after all components', 'baseline_scored',
  ], 'baseline registry allocation is not serialized');
  assert.match(
    baseline,
    /reject[^\n]*Oracle response[^\n]*retry[^\n]*before any incorporation or scoring/i,
  );
  assert.match(
    baseline,
    /JSON\.stringify\(\{\s*component:\s*currentBaselineComponent,\s*owners:\s*globalIdOwners\s*\}\)[^\n]*base64url/s,
    'baseline registry context is not canonical base64url JSON',
  );
  assert.match(
    baseline,
    /node "\$RUNTIME_DIR\/validate\.mjs" --expected-type="\$declaredType" "--registry-context=\$registryContext"/,
    'baseline does not invoke the exact machine-enforced registry gate',
  );
  assert.equal(
    [...baseline.matchAll(/--registry-context=/g)].length,
    1,
    'baseline must document exactly one registry flag',
  );
  assert.match(baseline, /validated baseline trigger[^\n]*currentBaselineComponent/i);
  assert.match(oracle, /baseline context[^\n]*currentBaselineComponent/i);
  assert.doesNotMatch(baseline, /parallel|concurrent|speculative reservation/i);
});

test('baseline registry scenario enforces ownership before aggregate scoring', () => {
  const result = spawnSync(
    'node',
    [join(runtimeDir, 'intent-contract.test.mjs'), '--scenario=baseline-registry'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'PASS');
  assert.equal(output.scenario, 'baseline-registry');
  assert.equal(output.duplicateRejected, true);
  assert.deepEqual(output.enrichedTriggers, [
    { component: 'API', dim: 'goal', type: 'C' },
    { component: 'UI', dim: 'criteria', type: 'A' },
  ]);
  assert.deepEqual(output.transition, { phase: 'ROUND', gaps: [] });
});

test('preferences are metadata only and never a reducer-returned target', () => {
  const coverageTargets = section(skill, '**Question styles for semantic coverage targets:**', '### Step 2:');
  assert.doesNotMatch(coverageTargets, /Preference/i);
  assert.match(skill, /Preferences[^\n]*volunteers?[^\n]*already returned[^\n]*target/i);
  assert.match(skill, /Preferences[^\n]*never[^\n]*semantic gap[^\n]*block closure[^\n]*another question/i);
  assert.match(oracle, /preferences[^\n]*metadata[^\n]*never[^\n]*(?:gap|next question|target)/i);
});

test('rendered artifacts never expose internal completion kinds', () => {
  const normal = markdownArtifact(section(spec, '## Normal spec', '## Incomplete Spec Report'));
  const incomplete = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  for (const artifact of [normal, incomplete]) {
    assert.doesNotMatch(artifact, /\b(?:active|superseded|greenfield|brownfield|complete|incomplete)\b/i);
  }
});

test('zero-item category decisions retain user-safe provenance in both artifacts', () => {
  const normal = markdownArtifact(section(spec, '## Normal spec', '## Incomplete Spec Report'));
  const incomplete = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  for (const artifact of [normal, incomplete]) {
    assert.match(artifact, /Decision \| Confirmed by \| Decision round/);
    assert.match(artifact, /No items were specified \| You \| \{category_source_round\}/);
    assert.match(artifact, /New initiative[^\n]*Existing system/);
  }
});

test('both artifacts preserve per-component scores and reducer global ambiguity', () => {
  const normal = markdownArtifact(section(spec, '## Normal spec', '## Incomplete Spec Report'));
  const incomplete = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  for (const [label, artifact] of [['normal', normal], ['incomplete', incomplete]]) {
    assert.match(artifact, /- Still unclear: \{globalAmbiguity\}/, `${label} does not use reducer globalAmbiguity`);
    assert.doesNotMatch(artifact, /\{1-total\}/, `${label} uses undefined aggregate 1-total`);
    assert.deepEqual(
      projectRows(artifact, 'Clarity Breakdown', TWO_COMPONENT_ARTIFACT_FIXTURE.clarity),
      TWO_COMPONENT_ARTIFACT_FIXTURE.clarity,
      `${label} loses component score ownership`,
    );
  }
});

test('both artifacts represent colliding category names with independent component provenance', () => {
  const normal = markdownArtifact(section(spec, '## Normal spec', '## Incomplete Spec Report'));
  const incomplete = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  for (const [label, artifact] of [['normal', normal], ['incomplete', incomplete]]) {
    const decisions = projectRows(artifact, 'Category Decisions', TWO_COMPONENT_ARTIFACT_FIXTURE.decisions);
    assert.deepEqual(decisions, TWO_COMPONENT_ARTIFACT_FIXTURE.decisions, `${label} collapses API/UI category provenance`);
    assert.deepEqual(
      decisions.map(({ Component, Category, 'Decision round': decisionRound }) => ({ Component, Category, decisionRound })),
      [
        { Component: 'API', Category: 'Must-Nots', decisionRound: '1' },
        { Component: 'UI', Category: 'Must-Nots', decisionRound: '3' },
      ],
    );
  }
});

test('two-component fixture projects without history evidence context or gap loss', () => {
  const normal = markdownArtifact(section(spec, '## Normal spec', '## Incomplete Spec Report'));
  const incomplete = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  for (const [label, artifact] of [['normal', normal], ['incomplete', incomplete]]) {
    for (const [heading, rows] of Object.entries(TWO_COMPONENT_ARTIFACT_FIXTURE.history)) {
      assert.deepEqual(projectRows(artifact, heading, rows), rows, `${label} loses ${heading} ownership or history`);
    }
    assert.deepEqual(
      projectRows(artifact, 'Acceptance Evidence', TWO_COMPONENT_ARTIFACT_FIXTURE.evidence),
      TWO_COMPONENT_ARTIFACT_FIXTURE.evidence,
      `${label} loses evidence ownership or links`,
    );
    assert.deepEqual(
      projectRows(artifact, 'Technical Context', TWO_COMPONENT_ARTIFACT_FIXTURE.context),
      TWO_COMPONENT_ARTIFACT_FIXTURE.context,
      `${label} loses technical context ownership`,
    );
    assert.deepEqual(
      projectRows(artifact, 'Unresolved Semantic Gaps', TWO_COMPONENT_ARTIFACT_FIXTURE.gaps),
      TWO_COMPONENT_ARTIFACT_FIXTURE.gaps,
      `${label} loses unresolved-gap ownership`,
    );
    assert.match(artifact, /<details>[\s\S]*<summary>Full Q&A/, `${label} lost progressive transcript disclosure`);
  }
});

test('transition manifest is derived from rendered component ID evidence and gap rows', () => {
  const schema = contractJson(spec, 'transition-manifest');
  assert.deepEqual(Object.keys(schema), [
    'kind', 'path', 'components', 'unresolvedGaps', 'globalAmbiguity',
  ]);

  const artifact = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  const historyRows = Object.entries(TWO_COMPONENT_ARTIFACT_FIXTURE.history)
    .flatMap(([heading, rows]) => projectRows(artifact, heading, rows));
  const evidenceRows = projectRows(artifact, 'Acceptance Evidence', TWO_COMPONENT_ARTIFACT_FIXTURE.evidence);
  const gapRows = projectRows(artifact, 'Unresolved Semantic Gaps', TWO_COMPONENT_ARTIFACT_FIXTURE.gaps);
  const componentRows = [
    ...projectRows(artifact, 'Clarity Breakdown', TWO_COMPONENT_ARTIFACT_FIXTURE.clarity),
    ...historyRows,
    ...evidenceRows,
    ...gapRows,
  ];
  const manifest = {
    kind: 'incomplete',
    path: '.omo/specs/ulw-interview-fixture.md',
    components: [...new Set(componentRows.map(({ Component }) => Component))].map((name) => ({
      name,
      status: 'active',
      scored: true,
      itemIds: historyRows.filter(({ Component }) => Component === name).map(({ ID }) => ID),
      evidenceIds: evidenceRows.filter(({ Component }) => Component === name).map(({ Evidence }) => Evidence),
    })),
    unresolvedGaps: [
      { component: 'API', category: 'acceptance_evidence', itemId: 'M3', reason: 'missing_evidence' },
      { component: 'UI', category: 'out_of_scope', itemId: null, reason: 'open' },
    ],
    globalAmbiguity: Number(TWO_COMPONENT_ARTIFACT_FIXTURE.globalAmbiguity),
  };

  assert.deepEqual(manifest, {
    kind: 'incomplete',
    path: '.omo/specs/ulw-interview-fixture.md',
    components: [
      { name: 'API', status: 'active', scored: true, itemIds: ['O1', 'M1', 'M3', 'I1', 'X1', 'P1'], evidenceIds: ['E1'] },
      { name: 'UI', status: 'active', scored: true, itemIds: ['O2', 'M2', 'I2', 'N1', 'X2', 'P2'], evidenceIds: ['E2'] },
    ],
    unresolvedGaps: [
      { component: 'API', category: 'acceptance_evidence', itemId: 'M3', reason: 'missing_evidence' },
      { component: 'UI', category: 'out_of_scope', itemId: null, reason: 'open' },
    ],
    globalAmbiguity: 0.42,
  });
  assert.match(spec, /derive[^\n]*manifest[^\n]*rendered artifact/i);
  assert.match(spec, /render[^\n]*all components[^\n]*all (?:semantic )?IDs[^\n]*all unresolved gaps/i);
  assertOrdered(spec, ['render the artifact', 'derive the transition manifest', 'emit `spec_written`'], 'write protocol order is ambiguous');
  assert.match(spec, /does not validate[^\n]*(?:file contents|artifact prose)[^\n]*beyond[^\n]*manifest/i);
  assert.match(spec, /exact `spec_written` payload/i);
});

test('both artifacts preserve provenance supersession and evidence history symmetrically', () => {
  const normal = markdownArtifact(section(spec, '## Normal spec', '## Incomplete Spec Report'));
  const incomplete = markdownArtifact(section(spec, '## Incomplete Spec Report', null));
  for (const [label, artifact] of [['normal', normal], ['incomplete', incomplete]]) {
    assert.match(artifact, /ID \| Standing \| Confirmed by \| Confirmation round \| Replaces ID \| Statement/, `${label} item history`);
    assert.match(artifact, /Evidence \| Verifies \(M\/N\/I links\) \| Type \| Pass condition \| Confirmed by \| Confirmation round/, `${label} evidence history`);
    assert.match(artifact, /Current[^\n]*Historical|Historical[^\n]*Current/i, `${label} supersession coverage`);
    assert.match(artifact, /historical evidence/i, `${label} historical evidence`);
  }
});

let passed = 0;
let failed = 0;
for (const { name, body } of tests) {
  try {
    body();
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`docs-contract.test.mjs: ${name}: ${error.message}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', passed, failed, tests: tests.length })}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ status: 'PASS', suite: 'docs-contract', tests: passed })}\n`);
}
