import assert from 'node:assert/strict';
import test from 'node:test';

import { httpsUrl, isStorageObjectPath, pdfPreviewBlob, signedStorageUrl } from '../modules/upload-safety.js';

test('receipt links require explicit HTTPS and no embedded credentials', () => {
  assert.equal(httpsUrl('https://seller.example/receipts/123.pdf'), 'https://seller.example/receipts/123.pdf');
  for (const value of ['http://seller.example/a', '//seller.example/a', 'https:seller.example/a', 'https://user@trusted.example/a', 'javascript:void(0)', 'https://']) {
    assert.equal(httpsUrl(value), null);
  }
});

test('only stored object paths or a signed HTTPS URL from the expected bucket can be opened', () => {
  assert.ok(isStorageObjectPath('project-1/receipt-id.pdf'));
  for (const value of ['project/../receipt.pdf', 'httpx:wrong', 'project/%2e%2e/receipt.pdf', 'project\\receipt.pdf', '/project/receipt.pdf']) {
    assert.equal(isStorageObjectPath(value), false);
  }

  const origin = 'https://sbuild.example';
  const correct = `${origin}/storage/v1/object/sign/sbuild-receipts/project/receipt.pdf?token=signed`;
  assert.equal(signedStorageUrl(correct, origin, 'sbuild-receipts'), correct);
  assert.equal(signedStorageUrl(correct.replace('sbuild.example', 'other.example'), origin, 'sbuild-receipts'), null);
  assert.equal(signedStorageUrl(correct.replace('/sign/', '/public/'), origin, 'sbuild-receipts'), null);
  assert.equal(signedStorageUrl(correct.split('?')[0], origin, 'sbuild-receipts'), null);
  assert.equal(signedStorageUrl(correct, origin, 'sbuild-work-photos'), null);
});

test('PDF previews reject non-PDF content and use application/pdf independently of provided MIME', async () => {
  await assert.rejects(pdfPreviewBlob(new Blob(['unexpected report'], { type: 'application/pdf' })), /PDF/);
  const input = new Blob(['%PDF-1.7\nexample'], { type: 'application/octet-stream' });
  const preview = await pdfPreviewBlob(input);
  assert.equal(preview.type, 'application/pdf');
  assert.equal(await preview.text(), await input.text());
});
