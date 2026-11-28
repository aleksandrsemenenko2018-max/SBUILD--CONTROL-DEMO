const limitBytes = 50 * 1024 * 1024;

async function boundedBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Telegram file too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Telegram file has no response stream');
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('Telegram file too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createTelegramClient(token, fetcher = fetch, maxBytes = limitBytes) {
  const request = (url, options) => fetcher(url, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(12000),
  });

  async function call(method, payload) {
    const response = await request('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok === true) return body.result;
    const error = new Error('Telegram request was not confirmed');
    if ([400, 403, 429].includes(response.status) && body?.ok === false && body.error_code === response.status) {
      error.definitiveTelegramRejection = true;
      error.status = response.status;
    }
    throw error;
  }

  async function download(fileId) {
    const file = await call('getFile', { file_id: fileId });
    if (!file || file.file_size > maxBytes) throw new Error('Telegram file too large');
    const parts = String(file.file_path || '').split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid Telegram file path');
    const response = await request('https://api.telegram.org/file/bot' + token + '/' + parts.map(encodeURIComponent).join('/'));
    if (!response.ok) throw new Error('Telegram file download failed');
    const bytes = await boundedBytes(response, maxBytes);
    const filename = parts.at(-1).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-128);
    return { bytes, filename };
  }

  return { call, download, maxBytes };
}
