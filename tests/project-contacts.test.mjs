import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchProjectContacts } from '../modules/project-contacts.js';

function backend(result, legacy) {
  let selected;
  return {
    client: {
      rpc(name, args, options) {
        assert.equal(name, 'sbuild_list_project_contacts');
        assert.deepEqual(args, {});
        assert.equal(options.get, true);
        return { order: async () => result };
      },
      from(table) {
        assert.equal(table, 'sbuild_project_contacts');
        return {
          select(fields) {
            selected = fields;
            return { order: async () => legacy };
          },
        };
      },
    },
    selected: () => selected,
  };
}

test('uses the authenticated contact directory without consulting legacy columns', async () => {
  const result = { data: [{ id: 'contact', telegram_connected: true, link_code: null }], error: null };
  const { client, selected } = backend(result);
  assert.equal(await fetchProjectContacts(client, false), result);
  assert.equal(selected(), undefined);
});

test('legacy recipient fallback retrieves only public-to-project contact fields', async () => {
  const { client, selected } = backend({ error: { code: 'PGRST202' } }, { data: [{ id: 'contact' }] });
  const result = await fetchProjectContacts(client, false);
  assert.equal(selected(), 'id,project_id,name,role,phone,created_at');
  assert.deepEqual(result.data, [{ id: 'contact', telegram_connected: null, link_code: null }]);
});

test('legacy owner can link Telegram while raw chat IDs stay out of UI state', async () => {
  const legacy = { data: [{ id: 'contact', telegram_chat_id: 'chat-id', link_code: 'owner-link' }] };
  const { client, selected } = backend({ error: { code: 'PGRST202' } }, legacy);
  const result = await fetchProjectContacts(client, true);
  assert.match(selected(), /telegram_chat_id,link_code$/);
  assert.deepEqual(result.data, [{ id: 'contact', telegram_connected: true, link_code: 'owner-link' }]);
});

test('does not fall back when the contact directory denies access', async () => {
  const result = { error: { code: '42501' } };
  const { client, selected } = backend(result);
  assert.equal(await fetchProjectContacts(client, true), result);
  assert.equal(selected(), undefined);
});
