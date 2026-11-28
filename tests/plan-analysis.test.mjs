import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlanAnalysisHandler } from '../supabase/functions/sbuild-plan-analysis/handler.mjs';

const origin = 'https://sbuild.example.invalid';
const internal = 'https://supabase.example.invalid';
const projectId = '00000000-0000-4000-8000-000000000012';
const actor = '00000000-0000-4000-8000-000000000001';
const inputs = { projectId, lines: [
  { page: 2, text: 'Painting 14 m2' },
  { page: 3, text: 'Untrusted document content' }
] };
const config = { enabled: true, apiKey: 'mock-provider-key', model: 'example-model', allowedOrigin: origin, supabaseUrl: internal, publishableKey: 'mock' };
const request = (body, headers = {}) => new Request(origin + '/plan', {
  method: 'POST',
  headers: { origin, authorization: 'Bearer mock-user', 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

test('disabled or malformed plan analysis cannot call a provider', async () => {
  const fail = () => assert.fail('Unexpected fetch');
  const disabled = createPlanAnalysisHandler({ ...config, enabled: false }, fail);
  assert.equal((await disabled(request(inputs))).status, 503);
  const enabled = createPlanAnalysisHandler(config, fail);
  assert.equal((await enabled(request(inputs, { origin: 'https://other.invalid' }))).status, 403);
  assert.equal((await enabled(request(inputs, { authorization: '' }))).status, 401);
  assert.equal((await enabled(request({ ...inputs, lines: [{ page: 2, text: 'x'.repeat(50000) }] }))).status, 400);
});

test('denies project and quota failures before any provider call', async () => {
  for (const [claim, status] of [[Response.json({ message: 'Denied' }, { status: 403 }), 403], [Response.json(false), 429]]) {
    const calls = [];
    const handler = createPlanAnalysisHandler(config, url => {
      calls.push(url);
      if (calls.length === 1) return Response.json({ id: actor });
      if (calls.length === 2) return claim;
      assert.fail('Unexpected provider call');
    });
    assert.equal((await handler(request(inputs))).status, status);
    assert.equal(calls.length, 2);
  }
});

test('provider receives bounded excerpts without user credentials and cannot invent estimate values', async () => {
  const calls = [];
  const handler = createPlanAnalysisHandler(config, (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ id: actor });
    if (calls.length === 2) return Response.json(true);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(options.headers.authorization, 'Bearer mock-provider-key');
    assert.equal(body.store, false);
    assert.equal(body.input.includes(projectId), false);
    return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ items: [
      { line: 0, category: 'painting', price: 12 },
      { line: 0, category: 'flooring' },
      { line: 99, category: 'concrete' }
    ] }) }] }] });
  });
  const result = await handler(request(inputs));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { items: [{ page: 2, text: 'Painting 14 m2', category: 'painting' }] });
  assert.equal(calls[1].options.headers.authorization, 'Bearer mock-user');
});
