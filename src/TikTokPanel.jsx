import { useEffect, useRef, useState } from 'react';
import { tiktokDraft } from './tiktok-draft.mjs';

const button = 'border border-[#52656a] px-3 py-2 text-xs disabled:opacity-40';

async function api(action, data = {}, method = 'POST') {
  const response = await fetch('/api/tiktok' + (method === 'GET' ? '?' + new URLSearchParams({ action, platform: 'tiktok', ...data }) : ''), {
    method, credentials: 'same-origin',
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, platform: 'tiktok', ...data }) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível acessar o TikTok.');
  return result;
}

export default function TikTokPanel({ item, group, asset }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [caption, setCaption] = useState(() => tiktokDraft(item).caption);
  const groupId = group?.publication_group_id || '';
  const approved = group?.publicacoes?.length === 2 && group.publicacoes.every(row => ['APROVADO', 'PUBLICADO'].includes(row.status));
  const connected = Boolean(state?.connected);
  const existingJob = state?.job;

  async function refresh() {
    const result = await api('status', { group_id: groupId }, 'GET');
    setState(result);
    return result;
  }

  useEffect(() => {
    let active = true;
    setCaption(tiktokDraft(item).caption);
    api('status', { group_id: groupId }, 'GET').then(result => { if (active) setState(result); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [groupId, asset?.sha256]);

  async function run(fn) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message); }
    finally { lock.current = false; setBusy(false); }
  }

  async function upload() {
    try {
      await api('upload', { group_id: groupId, asset_sha256: asset?.sha256, caption, reviewed: true });
    } finally { await refresh(); }
  }

  return <section className="space-y-3 border border-[#3a4a4d] bg-[#0b1416] p-4 text-[#dfebed]" aria-label="Integração TikTok">
    <h3 className="font-mono font-bold">TIKTOK · BAGAÇA STUDIOS</h3>
    {error && <p role="alert" className="text-sm text-[#ffb3a7]">{error}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm">Bagaça Studios · {connected ? 'Conectado' : 'Não conectado'}</span>
      <button className={button} disabled={busy} onClick={() => run(async () => { const data = await api('authorize'); window.location.assign(data.url); })}>{connected ? 'Reconectar' : 'Conectar TikTok'}</button>
      {connected && <button className={button} disabled={busy} onClick={() => run(async () => { await api('disconnect'); await refresh(); })}>Desconectar</button>}
      {connected && <button className={button} disabled={busy} onClick={() => run(refresh)}>Atualizar TikTok</button>}
    </div>
    {!state?.uploads_enabled && <p className="text-xs">Envios TikTok ainda não estão habilitados no servidor.</p>}
    <p className="text-xs">Legenda e configurações preparadas automaticamente. O envio final depende do seu clique.</p>
    {asset?.video_url && <a className="inline-block text-xs underline" href={asset.video_url} target="_blank" rel="noreferrer">Revisar MP4</a>}
    <button className={button} disabled={!state?.uploads_enabled || !connected || !!existingJob || !approved || !asset?.sha256 || !caption.trim()} onClick={() => run(upload)}>{busy ? 'Processando…' : existingJob ? `TikTok: ${existingJob.status}` : 'Enviar para TikTok'}</button>
    {!approved && <p className="text-xs">Aprove os dois editoriais para habilitar o envio.</p>}
    {existingJob?.url && <a className="block text-xs underline" href={existingJob.url} target="_blank" rel="noreferrer">Abrir publicação no TikTok</a>}
    {existingJob && !existingJob.video_id && <button className={`${button} ml-2`} disabled={busy} onClick={() => run(async () => { await api('reconcile', { group_id: groupId }); await refresh(); })}>Verificar status</button>}
  </section>;
}
