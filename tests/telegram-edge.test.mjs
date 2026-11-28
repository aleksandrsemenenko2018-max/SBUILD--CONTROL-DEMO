import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelegramHandler, legacyWebhookSecret } from '../supabase/functions/sbuild-telegram/handler.mjs';
import { createTelegramClient } from '../supabase/functions/sbuild-telegram/telegram.mjs';

const questionId = 'aa100000-0000-4000-8000-000000000001';
const contactId = 'aa100000-0000-4000-8000-000000000002';
const projectId = 'aa100000-0000-4000-8000-000000000003';
const linkCode = 'aa100000-0000-4000-8000-000000000004';
const webhookSecret = 'local-webhook-test';
const webhookUrl = 'https://example.invalid/functions/v1/sbuild-telegram';

function request(action, body, headers = {}) {
  return new Request(webhookUrl + (action ? '?action=' + action : ''), {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}
const send = () => request('send', { question_id: questionId }, { authorization: 'Bearer mock-owner' });
const webhook = body => request('', { message: body }, { 'x-telegram-bot-api-secret-token': webhookSecret });

function fixture() {
  const question = { id: questionId, project_id: projectId, recipient_contact_id: contactId, kind: 'problem', description: 'Test problem', status: 'draft' };
  const contact = { id: contactId, project_id: projectId, telegram_chat_id: '12' };
  let claim, delivery;
  let links = 1;
  const calls = [], answers = new Set();
  const gateway = {
    authorize: async request => request.headers.get('authorization') === 'Bearer mock-owner',
    question: async () => question,
    contact: async () => contact,
    projectName: async () => 'Test project',
    priorDelivery: async () => delivery,
    claimSend: async (_id, attempt) => {
      if (claim) return false;
      claim = { attempt, state: 'sending' };
      return true;
    },
    sendClaim: async () => claim,
    releaseSend: async (_id, attempt) => { if (claim.attempt === attempt) claim = undefined; },
    markSendUncertain: async (_id, attempt) => { if (claim.attempt === attempt) claim.state = 'uncertain'; },
    finishSend: async (_id, attempt, _contact, _chat, messageId) => {
      assert.equal(claim.attempt, attempt);
      claim.state = 'sent';
      claim.telegram_message_id = messageId;
      question.status = 'sent';
      delivery = claim;
    },
    attachments: async () => [],
    bindContact: async code => {
      if (code !== linkCode || !links) return null;
      links--;
      return contact;
    },
    replyAlreadyRecorded: async (chat, message) => answers.has(chat + '/' + message),
    contactsForChat: async () => [contact],
    deliveryForChat: async (_chat, message) => message === 7 ? { question_id: questionId, contact_id: contactId } : null,
    saveReply: async ({ chat, messageId }) => {
      const id = chat + '/' + messageId;
      if (answers.has(id)) return false;
      answers.add(id);
      question.status = 'answered';
      return true;
    },
  };
  const telegram = {
    call: async (method, payload) => {
      calls.push({ method, payload });
      return { message_id: 7 };
    },
  };
  const handle = createTelegramHandler({ gateway, telegram, webhookUrl, webhookSecret });
  return { handle, calls, gateway, telegram, question, contact, answers };
}

test('rejects unverified owner requests and webhooks before provider calls', async () => {
  const { handle, calls } = fixture();
  const invalidOwner = await handle(request('send', { question_id: questionId }));
  const invalidSignature = await handle(request('', { message: { chat: { id: 12 }, message_id: 7 } }));
  const badMethod = await handle(new Request(webhookUrl));
  assert.equal(invalidOwner.status, 403);
  assert.equal(invalidSignature.status, 403);
  assert.equal(badMethod.status, 405);
  assert.deepEqual(calls, []);
});

test('allows one provider send for concurrent requests and preserves existing delivery', async () => {
  const { handle, calls } = fixture();
  const results = await Promise.all([handle(send()), handle(send())]);
  assert.equal(results.filter(response => response.status === 200).length, 1);
  assert.equal(results.filter(response => response.status === 409).length, 1);
  assert.deepEqual(await (await handle(send())).json(), {
    ok: true, already_sent: true, telegram_message_id: 7, attachments_sent: 0,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].payload.text, /Проблема: Test problem/);
});

test('only a definitive Telegram refusal allows another provider attempt', async () => {
  const { handle, telegram } = fixture();
  let attempts = 0;
  telegram.call = async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error(), { definitiveTelegramRejection: true, status: 429 });
    throw new Error('unknown transport result');
  };
  assert.equal((await handle(send())).status, 429);
  assert.equal((await handle(send())).status, 502);
  assert.equal((await handle(send())).status, 409);
  assert.equal(attempts, 2);
});

test('persistence errors after a confirmed provider send cannot send a duplicate', async () => {
  const { handle, gateway, calls } = fixture();
  gateway.finishSend = async () => { throw new Error('database unavailable'); };
  assert.equal((await handle(send())).status, 500);
  assert.equal((await handle(send())).status, 409);
  assert.equal(calls.length, 1);
});

test('prevents sending a question to an out-of-project contact', async () => {
  const { handle, contact, calls } = fixture();
  contact.project_id = contactId;
  assert.equal((await handle(send())).status, 400);
  assert.deepEqual(calls, []);
});

test('a valid webhook archives a reply once and acknowledges it once', async () => {
  const { handle, question, answers, calls } = fixture();
  const answer = { chat: { id: 12 }, message_id: 8, text: 'Test answer', reply_to_message: { message_id: 7 } };
  const results = await Promise.all([handle(webhook(answer)), handle(webhook(answer))]);
  assert.ok(results.every(response => response.status === 200));
  assert.equal(question.status, 'answered');
  assert.equal(answers.size, 1);
  assert.equal(calls.length, 1);
});

test('requires the received reply to belong to a delivery of the current chat', async () => {
  const { handle, question, answers, calls } = fixture();
  const answer = { chat: { id: 12 }, message_id: 8, text: 'Test answer', reply_to_message: { message_id: 999 } };
  assert.equal((await handle(webhook(answer))).status, 200);
  assert.equal(question.status, 'draft');
  assert.equal(answers.size, 0);
  assert.match(calls[0].payload.text, /Натисніть/);
});

test('supports the existing webhook secret and a single use link', async () => {
  const { handle, calls } = fixture();
  const link = { chat: { id: 12 }, message_id: 1, text: '/start ' + linkCode };
  assert.equal((await handle(webhook(link))).status, 200);
  assert.equal((await handle(webhook(link))).status, 200);
  assert.match(calls[0].payload.text, /підключено/);
  assert.match(calls[1].payload.text, /вже використане/);
  assert.equal(await legacyWebhookSecret('test-only'), 'bb310ae75eb4a77421ea0d52b9db9a10d93be149');
});

test('provider client treats gateway errors as uncertain and limits streamed attachments', async () => {
  const gatewayFailure = createTelegramClient('test-token', async () =>
    Response.json({ ok: false, error_code: 502 }, { status: 502 }));
  await assert.rejects(() => gatewayFailure.call('sendMessage', {}), error => !error.definitiveTelegramRejection);

  const oversized = createTelegramClient('test-token', async url => {
    if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'docs/example.pdf' } });
    return new Response(new Uint8Array(5));
  }, 4);
  await assert.rejects(() => oversized.download('fake-file-id'), /too large/);
});
