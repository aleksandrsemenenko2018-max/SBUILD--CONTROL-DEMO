import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { createTelegramHandler, legacyWebhookSecret } from './handler.mjs';
import { createTelegramClient } from './telegram.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
const configuredWebhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const webhookSecret = configuredWebhookSecret || (token ? await legacyWebhookSecret(token) : '');
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceRole, authOptions);
const client = createClient(url, publishableKey, authOptions);
const bucket = 'sbuild-question-media';
const storage = service.storage.from(bucket);

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error('Supabase request failed');
  return result.data;
}

const gateway = {
  async authorize(request: Request) {
    const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (bearer) {
      const { data } = await client.auth.getUser(bearer);
      if (data.user) {
        const profile = checked(await service.from('sbuild_profiles').select('role,active').eq('user_id', data.user.id).maybeSingle());
        if (profile?.role === 'owner' && profile.active === true) return true;
      }
    }

    const setupKey = request.headers.get('x-sbuild-setup-key');
    if (!setupKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(setupKey)) return false;
    const now = new Date().toISOString();
    const claimed = checked(await service.from('sbuild_integration_setup_tokens').update({ used_at: now })
      .eq('token', setupKey).is('used_at', null).gt('expires_at', now).select('token').maybeSingle());
    return !!claimed;
  },

  async question(questionId: string) {
    return checked(await service.from('sbuild_questions')
      .select('id,description,recipient_contact_id,project_id,status,kind').eq('id', questionId).maybeSingle());
  },

  async priorDelivery(questionId: string) {
    return checked(await service.from('sbuild_telegram_deliveries').select('telegram_message_id')
      .eq('question_id', questionId).order('created_at', { ascending: false }).limit(1).maybeSingle());
  },

  async contact(contactId: string) {
    return checked(await service.from('sbuild_project_contacts').select('id,project_id,telegram_chat_id').eq('id', contactId).maybeSingle());
  },

  async projectName(projectId: string) {
    const project = checked(await service.from('sbuild_projects').select('name').eq('id', projectId).maybeSingle());
    return project?.name ?? '';
  },

  async claimSend(questionId: string, attemptId: string) {
    const inserted = checked(await service.from('sbuild_telegram_send_claims')
      .upsert({ question_id: questionId, attempt_id: attemptId, state: 'sending' }, {
        onConflict: 'question_id', ignoreDuplicates: true,
      }).select('question_id').maybeSingle());
    return !!inserted;
  },

  async sendClaim(questionId: string) {
    return checked(await service.from('sbuild_telegram_send_claims').select('state,telegram_message_id').eq('question_id', questionId).maybeSingle());
  },

  async releaseSend(questionId: string, attemptId: string) {
    checked(await service.from('sbuild_telegram_send_claims').delete()
      .eq('question_id', questionId).eq('attempt_id', attemptId).eq('state', 'sending'));
  },

  async markSendUncertain(questionId: string, attemptId: string) {
    checked(await service.from('sbuild_telegram_send_claims').update({ state: 'uncertain' })
      .eq('question_id', questionId).eq('attempt_id', attemptId).eq('state', 'sending'));
  },

  async finishSend(questionId: string, attempt: string, contact: string, chat: string, messageId: number) {
    checked(await service.rpc('sbuild_finish_telegram_send', {
      p_question_id: questionId, p_attempt_id: attempt, p_contact_id: contact, p_chat_id: chat, p_message_id: messageId,
    }));
  },

  async attachments(questionId: string) {
    return checked(await service.from('sbuild_question_messages').select('media_path,media_type')
      .eq('question_id', questionId).is('author_contact_id', null).not('media_path', 'is', null)) ?? [];
  },

  async attachmentUrl(path: string) {
    const { signedUrl } = checked(await storage.createSignedUrl(path, 600)) ?? {};
    if (!signedUrl) return null;
    const parsed = new URL(signedUrl);
    return parsed.origin === new URL(url).origin && parsed.pathname.startsWith('/storage/v1/object/sign/' + bucket + '/')
      ? parsed.href : null;
  },

  async bindContact(code: string, chat: string, username: string | null) {
    return checked(await service.from('sbuild_project_contacts')
      .update({ telegram_chat_id: chat, telegram_username: username, link_code: crypto.randomUUID() })
      .eq('link_code', code).select('id').maybeSingle());
  },

  async contactsForChat(chat: string) {
    return checked(await service.from('sbuild_project_contacts').select('id').eq('telegram_chat_id', chat)) ?? [];
  },

  async deliveryForChat(chat: string, replyTo?: number) {
    const deliveries = service.from('sbuild_telegram_deliveries').select('question_id,contact_id').eq('chat_id', chat);
    if (replyTo !== undefined) {
      if (!Number.isSafeInteger(replyTo) || replyTo < 1) return null;
      return checked(await deliveries.eq('telegram_message_id', replyTo).maybeSingle());
    }
    const recent = checked(await deliveries.order('created_at', { ascending: false }).limit(2));
    return recent?.length === 1 ? recent[0] : null;
  },

  async replyAlreadyRecorded(chat: string, messageId: number) {
    const row = checked(await service.from('sbuild_telegram_reply_claims').select('question_id')
      .eq('chat_id', chat).eq('telegram_message_id', messageId).maybeSingle());
    return !!row;
  },

  async storeReplyMedia(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await storage.upload(path, bytes, { contentType });
    if (!error) return true;
    const { data } = await storage.exists(path);
    return data === true;
  },

  async saveReply({ questionId, contactId, chat, messageId, text, mediaPath = null, mediaType = null }: {
    questionId: string; contactId: string; chat: string; messageId: number;
    text: string | null; mediaPath?: string | null; mediaType?: string | null;
  }) {
    return checked(await service.rpc('sbuild_save_telegram_reply', {
      p_question_id: questionId, p_contact_id: contactId, p_chat_id: chat, p_message_id: messageId,
      p_body: text, p_media_path: mediaPath, p_media_type: mediaType,
    })) === true;
  },
};

Deno.serve(createTelegramHandler({
  gateway,
  telegram: token ? createTelegramClient(token) : null,
  webhookUrl: url + '/functions/v1/sbuild-telegram',
  webhookSecret,
  logError: (message: string) => console.error(message),
}));
