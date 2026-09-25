import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hasValidSession } from '../api/auth.js';
import { SCOPES, caption, checkGroup, failure, hash, seal, unseal, tiktokJSON, uploadLocation } from './tiktok-core.mjs';

const TABLE = 'wiregeek_tiktok_';
const CHANNEL = 'bagaca';

function config() {
  const env = process.env;
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', 'TIKTOK_TOKEN_KEY'];
  if (required.some(key => !env[key])) throw failure('TikTok ainda não configurado. Cadastre as variáveis no Vercel.', 503);
  const redirect = new URL(env.TIKTOK_REDIRECT_URI);
  if (redirect.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(redirect.hostname)) throw failure('Callback do TikTok deve usar HTTPS.', 503);
  return { env, redirect, key: env.TIKTOK_TOKEN_KEY };
}

async function checked(query) {
  const { data, error } = await query;
  if (error) throw failure('Falha ao acessar os registros do TikTok.', 503);
  return data;
}

function cookies(req) {
  return Object.fromEntries(String(req.headers?.cookie || '').split(';').filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
  }));
}

function publicJob(row) {
  return { status: row.status, publish_id: row.publish_id, error: row.error, url: row.video_id ? `https://www.tiktok.com/@bagacastudios/video/${row.video_id}` : null };
}

async function accessToken(channel, configValue) {
  if (channel.expires_at && Date.parse(channel.expires_at) > Date.now() + 60000) return unseal(channel.access_cipher, configValue.key);
  const data = await tiktokJSON('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: configValue.env.TIKTOK_CLIENT_KEY, client_secret: configValue.env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: unseal(channel.refresh_cipher, configValue.key) }),
  });
  await checked(configValue.db.from(TABLE + 'channels').update({ access_cipher: seal(data.access_token, configValue.key), expires_at: new Date(Date.now() + Number(data.expires_in || 86400) * 1000).toISOString(), refresh_cipher: data.refresh_token ? seal(data.refresh_token, configValue.key) : channel.refresh_cipher }).eq('slot', CHANNEL));
  return data.access_token;
}

async function verifiedAsset(db, groupId) {
  const rows = await checked(db.from('publicacoes').select('id,noticia_id,status,publication_group_id,carousel_position,cta_url').eq('publication_group_id', groupId));
  checkGroup(rows, groupId);
  const storage = db.storage.from('wiregeek-banners');
  const files = await checked(storage.list('instagram-reels', { search: groupId + '-', limit: 100 }));
  const pattern = new RegExp('^' + groupId + '-([a-f0-9]{16})\\.mp4$', 'i');
  const candidates = files.filter(file => pattern.test(file.name));
  if (candidates.length !== 1) throw failure('Gere o MP4 imutável deste grupo antes de enviar.');
  const file = candidates[0];
  const blob = await checked(storage.download('instagram-reels/' + file.name));
  if (!blob.size || blob.size > 100 * 1024 * 1024) throw failure('Tamanho de MP4 inválido.');
  const buffer = Buffer.from(await blob.arrayBuffer());
  const sha = hash(buffer);
  if (!sha.startsWith(file.name.match(pattern)[1].toLowerCase())) throw failure('MP4 alterado; revise o arquivo.');
  return { buffer, sha, video_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/wiregeek-banners/instagram-reels/${encodeURIComponent(file.name)}` };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasValidSession(req)) return res.status(401).json({ error: 'Faça login no WireGeek.' });
  try {
    const c = config();
    const action = String(req.query?.action || req.body?.action || 'status');
    if (!['GET', 'POST'].includes(req.method)) throw failure('Método não permitido.', 405);
    if (req.method === 'POST' && (req.headers.origin !== c.redirect.origin || !String(req.headers['content-type'] || '').startsWith('application/json'))) throw failure('Origem da operação inválida.', 403);
    if (['authorize', 'upload', 'reconcile', 'disconnect'].includes(action) && req.method !== 'POST') throw failure('Use POST.', 405);
    if (['status', 'callback'].includes(action) && req.method !== 'GET') throw failure('Use GET.', 405);
    const db = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    c.db = db;

    if (action === 'authorize') {
      const state = crypto.randomBytes(32).toString('base64url');
      const verifier = crypto.randomBytes(48).toString('base64url');
      await checked(db.from(TABLE + 'oauth').delete().lt('expires_at', new Date().toISOString()));
      await checked(db.from(TABLE + 'oauth').insert({ state_hash: hash(state), session_hash: hash(cookies(req).wiregeek_session || ''), verifier_cipher: seal(verifier, c.key), expires_at: new Date(Date.now() + 600000).toISOString() }));
      res.setHeader('Set-Cookie', `wiregeek_tiktok_state=${state}; HttpOnly; SameSite=Lax; Path=/api/tiktok; Max-Age=600${c.redirect.protocol === 'https:' ? '; Secure' : ''}`);
      const params = new URLSearchParams({ client_key: c.env.TIKTOK_CLIENT_KEY, redirect_uri: c.redirect.href, response_type: 'code', scope: SCOPES.join(','), state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return res.json({ url: 'https://www.tiktok.com/v2/auth/authorize/?' + params });
    }

    if (action === 'callback') {
      const jar = cookies(req), state = String(req.query.state || '');
      if (!state || state !== jar.wiregeek_tiktok_state) throw failure('Conexão TikTok expirada ou inválida.', 403);
      const pending = await checked(db.from(TABLE + 'oauth').delete().eq('state_hash', hash(state)).eq('session_hash', hash(jar.wiregeek_session || '')).gt('expires_at', new Date().toISOString()).select().maybeSingle());
      res.setHeader('Set-Cookie', 'wiregeek_tiktok_state=; HttpOnly; SameSite=Lax; Path=/api/tiktok; Max-Age=0');
      if (!pending || req.query.error || !req.query.code) throw failure('Conexão TikTok cancelada ou expirada.');
      const data = await tiktokJSON('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: c.env.TIKTOK_CLIENT_KEY, client_secret: c.env.TIKTOK_CLIENT_SECRET, code: String(req.query.code), grant_type: 'authorization_code', redirect_uri: c.redirect.href, code_verifier: unseal(pending.verifier_cipher, c.key) }) });
      if (!data.access_token || !data.refresh_token) throw failure('O TikTok não retornou autorização suficiente.');
      const info = await tiktokJSON('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: { Authorization: `Bearer ${data.access_token}` } });
      const user = info.data?.user;
      if (!user?.open_id) throw failure('Não foi possível identificar a conta TikTok.');
      await checked(db.from(TABLE + 'channels').upsert({ slot: CHANNEL, open_id: user.open_id, display_name: user.display_name || 'Bagaça Studios', access_cipher: seal(data.access_token, c.key), refresh_cipher: seal(data.refresh_token, c.key), expires_at: new Date(Date.now() + Number(data.expires_in || 86400) * 1000).toISOString(), connected_at: new Date().toISOString() }, { onConflict: 'slot' }));
      return res.redirect(303, '/?tiktok=connected');
    }

    if (action === 'status') {
      const channel = await checked(db.from(TABLE + 'channels').select('slot,open_id,display_name,connected_at').eq('slot', CHANNEL).maybeSingle());
      const groupId = String(req.query.group_id || '');
      const job = groupId ? await checked(db.from(TABLE + 'uploads').select('status,publish_id,video_id,error').eq('group_id', groupId).eq('slot', CHANNEL).maybeSingle()) : null;
      return res.json({ channel, connected: Boolean(channel), uploads_enabled: c.env.TIKTOK_UPLOAD_ENABLED === 'true', job: job ? publicJob(job) : null });
    }

    if (action === 'disconnect') {
      await checked(db.from(TABLE + 'channels').delete().eq('slot', CHANNEL));
      return res.json({ success: true });
    }

    if (action === 'reconcile') {
      const groupId = String(req.body.group_id || ''), job = await checked(db.from(TABLE + 'uploads').select('*').eq('group_id', groupId).eq('slot', CHANNEL).maybeSingle());
      if (!job) throw failure('Envio TikTok não encontrado.');
      if (!job.publish_id || job.video_id) return res.json(publicJob(job));
      const channel = await checked(db.from(TABLE + 'channels').select('*').eq('slot', CHANNEL).maybeSingle());
      if (!channel) throw failure('Conecte o TikTok.');
      const status = await tiktokJSON('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { Authorization: `Bearer ${await accessToken(channel, c)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ publish_id: job.publish_id }) });
      const result = status.data?.status || 'PROCESSANDO';
      const next = { status: result === 'PUBLISH_COMPLETE' ? 'ENVIADO' : result === 'FAILED' ? 'VERIFICAR' : 'PUBLICANDO', error: result === 'FAILED' ? String(status.data?.fail_reason || 'TikTok recusou a publicação.') : null };
      await checked(db.from(TABLE + 'uploads').update(next).eq('id', job.id));
      return res.json(publicJob({ ...job, ...next }));
    }

    if (action === 'upload') {
      if (c.env.TIKTOK_UPLOAD_ENABLED !== 'true') throw failure('Envios TikTok desativados. Configure TIKTOK_UPLOAD_ENABLED=true.', 403);
      const groupId = String(req.body.group_id || ''), previous = await checked(db.from(TABLE + 'uploads').select('*').eq('group_id', groupId).eq('slot', CHANNEL).maybeSingle());
      if (previous) return res.json(publicJob(previous));
      if (req.body.reviewed !== true) throw failure('Revise o MP4 antes de enviar.');
      const channel = await checked(db.from(TABLE + 'channels').select('*').eq('slot', CHANNEL).maybeSingle());
      if (!channel) throw failure('Conecte o TikTok da Bagaça Studios.');
      const asset = await verifiedAsset(db, groupId);
      if (String(req.body.asset_sha256 || '') !== asset.sha) throw failure('O MP4 mudou desde a preparação.');
      const access = await accessToken(channel, c);
      const creator = await tiktokJSON('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: '{}' });
      const options = creator.data?.privacy_level_options || [];
      const privacy = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0];
      if (!privacy) throw failure('O TikTok não retornou opções de privacidade para esta conta.');
      const text = caption(req.body.caption);
      const { data: job, error } = await db.from(TABLE + 'uploads').insert({ group_id: groupId, slot: CHANNEL, open_id: channel.open_id, asset_sha256: asset.sha, status: 'PREPARANDO', metadata: { title: text, privacy_level: privacy }, bytes: asset.buffer.length }).select().single();
      if (error) throw failure('Já existe uma tentativa TikTok para este grupo. Atualize o status.', 409);
      try {
        const chunkSize = Math.min(10_000_000, asset.buffer.length);
        const totalChunks = Math.ceil(asset.buffer.length / chunkSize);
        const init = await tiktokJSON('https://open.tiktokapis.com/v2/post/publish/video/init/', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ post_info: { title: text, privacy_level: privacy, disable_duet: true, disable_comment: false, disable_stitch: true }, source_info: { source: 'FILE_UPLOAD', video_size: asset.buffer.length, chunk_size: chunkSize, total_chunk_count: totalChunks } }) });
        const publishId = String(init.data?.publish_id || ''), uploadUrl = init.data?.upload_url ? uploadLocation(init.data.upload_url) : '';
        if (!publishId) throw failure('O TikTok não retornou o ID da publicação.', 502);
        if (!uploadUrl) throw failure('O TikTok não retornou a URL de upload.', 502);
        for (let start = 0; start < asset.buffer.length; start += chunkSize) {
          const end = Math.min(start + chunkSize, asset.buffer.length) - 1;
          const chunk = asset.buffer.subarray(start, end + 1);
          const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${start}-${end}/${asset.buffer.length}` }, body: chunk, redirect: 'error', signal: AbortSignal.timeout(180000) });
          if (!upload.ok) throw failure(`TikTok recusou o envio do MP4 (HTTP ${upload.status}).`, 502);
        }
        await checked(db.from(TABLE + 'uploads').update({ publish_id: publishId, status: 'PUBLICANDO' }).eq('id', job.id));
        return res.json(publicJob({ ...job, publish_id: publishId, status: 'PUBLICANDO' }));
      } catch (error) {
        await db.from(TABLE + 'uploads').update({ status: 'VERIFICAR', error: 'Envio interrompido. Verifique o TikTok antes de tentar novamente.' }).eq('id', job.id);
        throw error;
      }
    }
    throw failure('Ação TikTok não reconhecida.');
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível concluir a operação do TikTok.' });
  }
}
