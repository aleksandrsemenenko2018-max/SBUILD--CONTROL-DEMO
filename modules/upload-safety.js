export function httpsUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url.href;
  } catch {
    return null;
  }
}

export function signedStorageUrl(value, origin, bucket) {
  const trustedUrl = httpsUrl(value);
  if (!trustedUrl) return null;
  const url = new URL(trustedUrl);
  return url.origin === origin &&
    url.pathname.startsWith(`/storage/v1/object/sign/${bucket}/`) &&
    url.searchParams.has('token') ? url.href : null;
}

export function isStorageObjectPath(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i.test(value);
}

export async function pdfPreviewBlob(file) {
  const header = await file.slice(0, 5).text();
  if (header !== '%PDF-') throw new Error('Оберіть дійсний файл PDF');
  return file.slice(0, file.size, 'application/pdf');
}

export async function openPdfPreview(file, page) {
  const popup = window.open('about:blank', '_blank');
  if (!popup) throw new Error('Дозвольте відкриття нового вікна для PDF');
  popup.opener = null;
  try {
    const blob = await pdfPreviewBlob(file);
    const objectUrl = URL.createObjectURL(blob);
    const pageNumber = Math.max(1, Math.trunc(Number(page)) || 1);
    try {
      popup.location.replace(`${objectUrl}#page=${pageNumber}`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
    }
  } catch (error) {
    popup.close();
    throw error;
  }
}
