import assert from 'node:assert/strict';
import test from 'node:test';

import { admit } from '../.github/codex/admit.mjs';

const owner = 'aleksandrsemenenko2018-max';
const env = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: `${owner}/SBUILD--CONTROL-DEMO`,
  GITHUB_REF: 'refs/heads/work',
  GITHUB_ACTOR: owner,
  GITHUB_TRIGGERING_ACTOR: owner,
  GITHUB_RUN_ID: '149',
  GITHUB_RUN_ATTEMPT: '1',
  ISSUE_NUMBER: '1',
};
const issue = { number: 1, state: 'open', labels: [{ name: 'codex-approved' }] };
const history = { total_count: 3, workflow_runs: [{ id: 149 }] };
const api = (issueData = issue, runData = history) => async endpoint =>
  endpoint.startsWith('issues/') ? issueData : runData;

test('dispatch returns only a committed task path for the approved issue', async () => {
  const requests = [];
  const now = Date.parse('2026-11-28T12:00:00Z');
  const path = await admit(env, async endpoint => {
    requests.push(endpoint);
    return api({ ...issue, body: 'External issue text never becomes the prompt.' })(endpoint);
  }, now);
  assert.equal(path, '.github/codex/tasks/1.md');
  assert.equal(requests[0], 'issues/1');
  const request = new URL(requests[1], 'https://example.test');
  assert.equal(request.searchParams.get('created'), '>=2026-11-27T12:00:00.000Z');
  assert.equal(request.searchParams.get('event'), 'workflow_dispatch');
});

test('rejects outsiders, forks, untrusted refs, callbacks, and reruns before API access', async () => {
  const invalid = [
    { GITHUB_ACTOR: 'outsider' },
    { GITHUB_TRIGGERING_ACTOR: 'outsider' },
    { GITHUB_REPOSITORY: 'fork/SBUILD--CONTROL-DEMO' },
    { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_EVENT_NAME: 'issue_comment' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { ISSUE_NUMBER: '../1' },
  ];
  for (const context of invalid) {
    await assert.rejects(admit({ ...env, ...context }, () => assert.fail('Unexpected API call')), /dispatch|issue number/i);
  }
});

test('requires an open issue whose number and approval label match', async () => {
  for (const candidate of [
    { ...issue, state: 'closed' },
    { ...issue, number: 2 },
    { ...issue, pull_request: {} },
    { ...issue, labels: [] },
  ]) {
    await assert.rejects(admit(env, api(candidate)), /issue must be open/);
  }
});

test('fails closed for missing or exhausted run history', async () => {
  await assert.rejects(admit(env, api(issue, { ...history, total_count: 4 })), /limit reached/);
  await assert.rejects(admit(env, api(issue, { ...history, workflow_runs: [] })), /could not be verified/);
  await assert.rejects(admit(env, async () => { throw new Error('GitHub unavailable'); }), /GitHub unavailable/);
});
