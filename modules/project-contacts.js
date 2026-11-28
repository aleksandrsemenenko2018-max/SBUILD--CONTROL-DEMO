const contactFields = 'id,project_id,name,role,phone,created_at';

export async function fetchProjectContacts(client, isOwner) {
  const result = await client.rpc('sbuild_list_project_contacts', {}, { get: true })
    .order('created_at', { ascending: false });
  // Deploys can serve the new frontend before the database migration is approved.
  if (result.error?.code !== 'PGRST202') return result;

  const fields = isOwner ? `${contactFields},telegram_chat_id,link_code` : contactFields;
  const legacy = await client.from('sbuild_project_contacts').select(fields)
    .order('created_at', { ascending: false });
  if (legacy.error) return legacy;

  return {
    ...legacy,
    data: legacy.data.map(({ telegram_chat_id, link_code, ...contact }) => ({
      ...contact,
      telegram_connected: isOwner ? Boolean(telegram_chat_id) : null,
      link_code: isOwner ? link_code : null,
    })),
  };
}
