import crypto from 'node:crypto';

export const SCOPES = ['user.info.basic', 'video.publish'];
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const failure = (message, status = 400) => Object.assign(new Error(message), { status });

export function seal(value, key) {
  const bytes = Buffer.from(key || '', 'base64');
  if (bytes.length !== 32) throw failure('Configure TIKTOK_TOKEN_KEY com 32 bytes em base64.', 503);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', bytes, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
}

export function unseal(value, key) {
  const [iv, tag, data] = String(value).split('.').map(v => Buffer.from(v, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function caption(body) {
  const value = String(body || '').replace(/[<>]/g, '').trim();
  if (!value || [...value].length > 2200) throw failure('A legenda do TikTok precisa ter de 1 a 2200 caracteres.');
  return value;
}

export function checkGroup(rows, groupId) {
  if (!/^[0-9a-f-]{36}$/i.test(groupId) || rows.length !== 2) throw failure('Grupo editorial inválido.');
  const sorted = [...rows].sort((a, b) => a.carousel_position - b.carousel_position);
  if (sorted.some((r, i) => r.carousel_position !== i + 1 || r.publication_group_id !== groupId || !['APROVADO', 'PUBLICADO'].includes(r.status)) ||
      !sorted[0].noticia_id || sorted[0].noticia_id !== sorted[1].noticia_id || !sorted[0].cta_url || sorted[0].cta_url !== sorted[1].cta_url) {
    throw failure('Aprove os dois editoriais do mesmo grupo antes do envio.');
  }
  return sorted;
}

export async function tiktokJSON(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error?.code && data.error.code !== 'ok') {
    throw failure(`TikTok: ${data?.error?.message || data?.error?.code || `HTTP ${response.status}`}`, response.status === 401 ? 401 : 502);
  }
  return data;
}

export function uploadLocation(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('tiktokapis.com') || url.username || url.password) throw failure('Destino de upload do TikTok inválido.', 502);
  return url.href;
}
