const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-sbuild-setup-key',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const reply = (body, status = 200) => Response.json(body, { status, headers: cors });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const titles = { question: 'Питання', approval: 'Погодження', problem: 'Проблема', task: 'Завдання' };
const allowedMedia = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'application/pdf']);

function sameSecret(expected, actual) {
  if (!actual || actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return mismatch === 0;
}

export async function legacyWebhookSecret(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).subarray(0, 20), byte => byte.toString(16).padStart(2, '0')).join('');
}

function providerText(text, limit) {
  return [...String(text || '')].slice(0, limit).join('');
}

async function sendQuestion(request, gateway, telegram, logError) {
  const { question_id: id } = await request.json().catch(() => ({})) ?? {};
  if (typeof id !== 'string' || !uuid.test(id)) return reply({ error: 'Invalid question' }, 400);
  const question = await gateway.question(id);
  if (!question?.recipient_contact_id) return reply({ error: 'No assigned contact' }, 400);
  if (question.status === 'answered') return reply({ error: 'Question already answered and archived' }, 409);

  const delivery = await gateway.priorDelivery(id);
  if (delivery) return reply({ ok: true, already_sent: true, telegram_message_id: delivery.telegram_message_id, attachments_sent: 0 });

  const contact = await gateway.contact(question.recipient_contact_id);
  if (!contact?.telegram_chat_id || contact.project_id !== question.project_id) {
    return reply({ error: 'Contact has not connected Telegram for this project' }, 400);
  }

  const attempt = crypto.randomUUID();
  if (!await gateway.claimSend(id, attempt)) {
    const current = await gateway.sendClaim(id);
    if (current?.state === 'sent') {
      return reply({ ok: true, already_sent: true, telegram_message_id: current.telegram_message_id, attachments_sent: 0 });
    }
    return reply({ error: 'Telegram delivery is pending or unconfirmed' }, 409);
  }
  if (question.status !== 'draft') {
    await gateway.markSendUncertain(id, attempt);
    return reply({ error: 'Question delivery is unconfirmed' }, 409);
  }

  let message;
  try {
    const projectName = await gateway.projectName(question.project_id);
    message = await telegram.call('sendMessage', {
      chat_id: contact.telegram_chat_id,
      text: '🏗 S-BUILD Control\nОб’єкт: ' + providerText(projectName, 150) +
        '\n' + (titles[question.kind] || titles.question) + ': ' + providerText(question.description, 3600) +
        '\n\nВідповідайте на це повідомлення або надішліть фото/відео.',
      reply_markup: { force_reply: true },
    });
    if (!Number.isSafeInteger(message?.message_id) || message.message_id < 1) {
      throw new Error('Provider did not return a valid message ID');
    }
  } catch (error) {
    if (error?.definitiveTelegramRejection) {
      await gateway.releaseSend(id, attempt);
      return reply({ error: 'Telegram declined the send' }, error.status === 429 ? 429 : 400);
    }
    await gateway.markSendUncertain(id, attempt);
    logError('Telegram send outcome is unknown');
    return reply({ error: 'Telegram delivery is unconfirmed' }, 502);
  }

  try {
    await gateway.finishSend(id, attempt, contact.id, contact.telegram_chat_id, message.message_id);
  } catch {
    await gateway.markSendUncertain(id, attempt);
    logError('Telegram acknowledged send but delivery persistence failed');
    return reply({ error: 'Telegram delivery is unconfirmed' }, 500);
  }

  let attachmentsSent = 0;
  try {
    for (const attachment of await gateway.attachments(id)) {
      const type = attachment.media_type;
      const [method, field] = type?.startsWith('image/') ? ['sendPhoto', 'photo']
        : type?.startsWith('video/') ? ['sendVideo', 'video'] : ['sendDocument', 'document'];
      try {
        const url = await gateway.attachmentUrl(attachment.media_path);
        if (!url) continue;
        await telegram.call(method, {
          chat_id: contact.telegram_chat_id,
          [field]: url,
          reply_to_message_id: message.message_id,
        });
        attachmentsSent++;
      } catch {
        logError('Telegram attachment was not confirmed');
      }
    }
  } catch {
    logError('Telegram attachments could not be listed');
  }
  return reply({ ok: true, telegram_message_id: message.message_id, attachments_sent: attachmentsSent });
}

async function createReplyMedia({ message, questionId, telegram, gateway }) {
  const file = message.photo?.at(-1) || message.video || message.document;
  const type = message.photo ? 'image/jpeg' : message.video ? 'video/mp4' : message.document?.mime_type;
  if (!file?.file_id || !allowedMedia.has(type) || file.file_size > telegram.maxBytes) return {};
  const { bytes, filename } = await telegram.download(file.file_id);
  const path = `telegram/${questionId}/${message.message_id}-${filename}`;
  const stored = await gateway.storeReplyMedia(path, bytes, type);
  if (!stored) throw new Error('Reply attachment upload failed');
  return { mediaPath: path, mediaType: type };
}

async function receiveUpdate(request, gateway, telegram, logError) {
  const update = await request.json().catch(() => null);
  if (!update) return reply({ error: 'Invalid Telegram update' }, 400);
  const message = update.message;
  if (!Number.isSafeInteger(message?.chat?.id) ||
      !Number.isSafeInteger(message.message_id) || message.message_id < 1) return reply({ ok: true });

  const chat = String(message.chat.id);
  const text = providerText(message.text || message.caption, 4096);
  const sendNotice = notice => telegram.call('sendMessage', { chat_id: chat, text: notice })
    .catch(() => logError('Telegram acknowledgement was not confirmed'));
  if (text.trim() === '/start') {
    await sendNotice('🏗 S-BUILD Control працює. Для прив’язки відкрийте персональне запрошення.');
    return reply({ ok: true });
  }
  if (text.startsWith('/start ')) {
    const code = text.slice(7).trim();
    if (!uuid.test(code)) return reply({ ok: true });
    const contact = await gateway.bindContact(code, chat, providerText(message.from?.username, 128) || null);
    await sendNotice(contact ? '✅ Контакт підключено до S-BUILD Control.'
      : 'Це запрошення недійсне або вже використане. Попросіть нове посилання.');
    return reply({ ok: true });
  }

  if (await gateway.replyAlreadyRecorded(chat, message.message_id)) return reply({ ok: true });
  const contacts = await gateway.contactsForChat(chat);
  if (!contacts.length) {
    await sendNotice('Спочатку попросіть керівника надіслати персональне запрошення.');
    return reply({ ok: true });
  }
  const delivered = await gateway.deliveryForChat(chat, message.reply_to_message?.message_id);
  if (!delivered || !contacts.some(contact => contact.id === delivered.contact_id)) {
    await sendNotice('Натисніть «Відповісти» на повідомленні з питанням, щоб правильно прив’язати відповідь.');
    return reply({ ok: true });
  }
  const question = await gateway.question(delivered.question_id);
  if (!question || question.recipient_contact_id !== delivered.contact_id) return reply({ ok: true });
  const media = await createReplyMedia({ message, questionId: question.id, telegram, gateway });
  if (!text && !media.mediaPath) return reply({ ok: true });
  const saved = await gateway.saveReply({
    questionId: question.id,
    contactId: delivered.contact_id,
    chat,
    messageId: message.message_id,
    text: text || null,
    ...media,
  });
  if (saved) await sendNotice('✅ Відповідь збережена у S-BUILD Control.');
  return reply({ ok: true });
}

export function createTelegramHandler({ gateway, telegram, webhookUrl, webhookSecret, logError = () => {} }) {
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    if (!telegram || !webhookSecret) return reply({ error: 'Telegram is not configured' }, 503);
    const action = new URL(request.url).searchParams.get('action');
    try {
      if (action === 'send' || action === 'setup') {
        if (!await gateway.authorize(request)) return reply({ error: 'Owner authorization required' }, 403);
        if (action === 'send') return await sendQuestion(request, gateway, telegram, logError);
        await telegram.call('setWebhook', {
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ['message'],
        });
        return reply({ ok: true, webhook: webhookUrl });
      }
      if (action) return reply({ error: 'Unknown action' }, 404);
      if (!sameSecret(webhookSecret, request.headers.get('x-telegram-bot-api-secret-token'))) {
        return reply({ error: 'Invalid Telegram signature' }, 403);
      }
      return await receiveUpdate(request, gateway, telegram, logError);
    } catch {
      logError('Telegram request failed');
      return reply({ error: 'Request failed' }, 500);
    }
  };
}
