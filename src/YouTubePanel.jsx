import { useEffect, useRef, useState } from 'react';

import { youtubeDraft } from './youtube-draft.mjs';

const channels = { bagaca: 'Bagaça Studios' };
const button = 'border border-[#52656a] px-3 py-2 text-xs disabled:opacity-40';

async function api(action, data = {}, method = 'POST') {
  const response = await fetch('/api/youtube' + (method === 'GET' ? '?' + new URLSearchParams({ action, ...data }) : ''), {
    method, credentials: 'same-origin',
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível acessar o YouTube.');
  return result;
}

export default function YouTubePanel({ item, group, asset }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [title, setTitle] = useState(() => youtubeDraft(item).title);
  const [description, setDescription] = useState(() => youtubeDraft(item).description);
  const privacy = 'public';
  const kids = 'no';
  const reviewed = true;
  const groupId = group?.publication_group_id || '';
  const noticiaId = item?.id || item?.noticia_id || '';
  const slots = Object.keys(channels);
  const connected = state?.channels?.some(ch => ch.slot === 'bagaca');
  const existingJob = state?.jobs?.find(job => job.slot === 'bagaca');
  const approved = group?.publicacoes?.length === 2 && group.publicacoes.every(row => ['APROVADO', 'PUBLICADO'].includes(row.status));
  async function refresh() {
    const result = await api('status', { group_id: groupId, noticia_id: String(noticiaId) }, 'GET');
    setState(result);
    return result;
  }
  useEffect(() => {
    let active = true;
    api('status', { group_id: groupId, noticia_id: String(noticiaId) }, 'GET').then(result => { if (active) setState(result); }).catch(err => { if (active) setError(err.message); });
    const onFocus = () => { if (!lock.current) api('status', { group_id: groupId, noticia_id: String(noticiaId) }, 'GET').then(result => { if (active) setState(result); }).catch(err => { if (active) setError(err.message); }); };
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.removeEventListener('focus', onFocus); };
  }, [groupId, noticiaId]);
  useEffect(() => {
    setTitle(youtubeDraft(item).title);
    setDescription(youtubeDraft(item).description);
  }, [groupId, asset?.sha256]);
  async function run(fn) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function upload() {
    try {
      await api('upload', { slot: 'bagaca', group_id: groupId, asset_sha256: asset?.sha256, title, description, privacy, made_for_kids: kids === 'yes', reviewed });
    } finally { await refresh(); }
  }
  return <section className="space-y-4 border border-[#3a4a4d] bg-[#0b1416] p-4 text-[#dfebed]" aria-label="Integração YouTube">
    <h3 className="font-mono font-bold">YOUTUBE · SHORTS E VÍDEOS DE APOIO</h3>
    {error && <p role="alert" className="text-sm text-[#ffb3a7]">{error}</p>}
    <div className="flex flex-wrap gap-3">
      {slots.map(slot => {
        const connected = state?.channels?.find(ch => ch.slot === slot);
        return <div key={slot} className="space-y-2 border border-[#3a4a4d] p-3">
          <p>{channels[slot]} · {connected ? 'Conectado' : 'Não conectado'}</p>
          <button className={button} disabled={busy} onClick={() => run(async () => { const data = await api('authorize', { slot }); window.location.assign(data.url); })}>{connected ? 'Reconectar' : 'Conectar canal'}</button>
          {connected && <button className={button} disabled={busy} onClick={() => run(async () => { await api('disconnect', { slot }); await refresh(); })}>Desconectar</button>}
        </div>;
      })}
      <button className={button} disabled={busy} onClick={() => run(refresh)}>Atualizar YouTube</button>
    </div>
    <fieldset className="space-y-3" disabled={busy}>
      <legend className="mb-2 font-bold">Enviar Short</legend>
      <p className="text-xs">Rascunho, descrição e configurações preparados automaticamente. O envio final depende do seu clique.</p>
      {!state?.uploads_enabled && <p className="text-xs">Envios ainda desativados na configuração do servidor.</p>}
      {asset?.video_url && <a className="block underline" href={asset.video_url} target="_blank" rel="noreferrer">Revisar o MP4</a>}
      <button className={button} disabled={!state?.uploads_enabled || !connected || !!existingJob || !approved || !asset?.sha256 || !title.trim()} onClick={() => run(upload)}>{busy ? 'Processando…' : 'Enviar para Bagaça Studios'}</button>
      {!approved && <p className="text-xs">Aprove os dois editoriais para habilitar o envio.</p>}
    </fieldset>
    {existingJob && <p className="text-xs">Status do envio: {existingJob.status}{existingJob.url && <> · <a href={existingJob.url} target="_blank" rel="noreferrer" className="underline">Abrir vídeo</a></>}{!existingJob.video_id && <button className={`${button} ml-2`} disabled={busy} onClick={() => run(async () => { await api('reconcile', { slot: 'bagaca', group_id: groupId }); await refresh(); })}>Verificar envio</button>}</p>}
  </section>;
}
