import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const approvedSecret = () => String(process.env.WIREGEEK_ACCESS_KEY || '').trim();
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const authenticatedPayload = (payload, secret) => {
  const content = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return content + '.' + createHmac('sha256', secret).update(content).digest('hex');
};

export function issueEditorialReceipt(noticiaId, body, excerpt, sourceHashes, now = Date.now()) {
  const secret = approvedSecret();
  if (!secret || !Number.isSafeInteger(noticiaId) || noticiaId <= 0) return null;
  if (!Array.isArray(sourceHashes) || !sourceHashes.length || sourceHashes.length > 3 ||
      sourceHashes.some(h => !/^sha256:[a-f0-9]{64}$/.test(h))) return null;
  return authenticatedPayload({
    version: 1, noticia_id: noticiaId,
    body_hash: sha(body), excerpt_hash: sha(excerpt),
    source_hashes: sourceHashes,
    expires_at: now + 60 * 60_000,
  }, secret);
}

export function verifyEditorialReceipt(receipt, noticiaId, body, excerpt, now = Date.now()) {
  const secret = approvedSecret();
  if (!secret || typeof receipt !== 'string' || receipt.length > 4096) return null;
  const segments = receipt.split('.');
  if (segments.length !== 2 || !/^[a-zA-Z0-9_-]+$/.test(segments[0]) ||
      !/^[a-f0-9]{64}$/.test(segments[1])) return null;
  const expected = createHmac('sha256', secret).update(segments[0]).digest();
  if (!timingSafeEqual(expected, Buffer.from(segments[1], 'hex'))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8')); }
  catch { return null; }
  if (payload?.version !== 1 || payload.noticia_id !== noticiaId ||
      !Number.isSafeInteger(payload.expires_at) || payload.expires_at <= now ||
      payload.expires_at > now + 60 * 60_000 ||
      payload.body_hash !== sha(body) || payload.excerpt_hash !== sha(excerpt) ||
      !Array.isArray(payload.source_hashes) || !payload.source_hashes.length ||
      payload.source_hashes.length > 3 ||
      payload.source_hashes.some(h => typeof h !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(h))) return null;
  return payload;
}
