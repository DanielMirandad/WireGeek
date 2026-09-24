import crypto from 'node:crypto';

export const CHANNELS = Object.freeze({
  bagaca: { label: 'Bagaça Studios', handle: '@bagacastudios' },
  cortes: { label: 'Cortes BCast Oficial', handle: '@CortesBCastOficial' },
});
export const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload'];
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const failure = (message, status = 400) => Object.assign(new Error(message), { status });
export function channelKey(value) {
  if (!Object.hasOwn(CHANNELS, value)) throw failure('Canal inválido.');
  return value;
}
export function seal(value, key) {
  const bytes = Buffer.from(key || '', 'base64');
  if (bytes.length !== 32) throw failure('Configure YOUTUBE_TOKEN_KEY com 32 bytes em base64.', 503);
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
export function metadata(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  if (!title || [...title].length > 100 || /[<>]/.test(title)) throw failure('O título precisa ter de 1 a 100 caracteres, sem < ou >.');
  if (Buffer.byteLength(description, 'utf8') > 5000 || /[<>]/.test(description)) throw failure('A descrição ultrapassa o limite do YouTube ou contém < ou >.');
  if (!['private', 'unlisted', 'public'].includes(body.privacy)) throw failure('Escolha a visibilidade.');
  if (typeof body.made_for_kids !== 'boolean') throw failure('Informe se o vídeo é destinado a crianças.');
  if (body.reviewed !== true) throw failure('Revise o MP4 antes de enviar.');
  return { snippet: { title, description }, status: { privacyStatus: body.privacy, selfDeclaredMadeForKids: body.made_for_kids } };
}
export function checkGroup(rows, groupId) {
  if (!/^[0-9a-f-]{36}$/i.test(groupId) || rows.length !== 2) throw failure('Grupo editorial inválido.');
  const sorted = [...rows].sort((a,b) => a.carousel_position-b.carousel_position);
  if (sorted.some((r,i) => r.carousel_position !== i+1 || r.publication_group_id !== groupId || !['APROVADO','PUBLICADO'].includes(r.status)) ||
      !sorted[0].noticia_id || sorted[0].noticia_id !== sorted[1].noticia_id || !sorted[0].cta_url || sorted[0].cta_url !== sorted[1].cta_url) {
    throw failure('Aprove os dois editoriais do mesmo grupo antes do envio.');
  }
  return sorted;
}
export function uploadLocation(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || !url.pathname.startsWith('/upload/youtube/v3/videos') || url.username || url.password) throw failure('Destino de upload inválido.', 502);
  return url.href;
}
export async function googleJSON(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason || (typeof data.error === 'string' ? data.error : 'api_error');
    throw failure(`YouTube/Google: ${reason} (HTTP ${response.status}).`, 502);
  }
  return data;
}
