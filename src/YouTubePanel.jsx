import { useEffect, useRef, useState } from 'react';

import { youtubeDraft } from './youtube-draft.mjs';

const channels = { bagaca: 'Bagaça Studios' };
const button = 'border border-[#52656a] px-3 py-2 text-xs disabled:opacity-40';
const field = 'w-full border border-[#52656a] bg-[#0b1416] p-2 text-sm text-white';

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
  const [privacy, setPrivacy] = useState('private');
  const [kids, setKids] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState([]);
  const [searchErrors, setSearchErrors] = useState([]);
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
  useEffect(() => { setReviewed(false); }, [groupId, asset?.sha256, title, description, privacy, kids]);
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
      <p className="text-xs">Título e descrição preparados a partir da matéria. Revise o MP4 e confirme o envio ao Bagaça Studios.</p>
      {!state?.uploads_enabled && <p className="text-xs">Envios ainda desativados na configuração do servidor.</p>}
      <label className="block">Título<input className={field} value={title} onChange={e => setTitle(e.target.value)} maxLength={100} /></label>
      <label className="block">Descrição<textarea className={field} value={description} onChange={e => setDescription(e.target.value)} rows={3} /></label>
      <label className="block">Visibilidade<select className={field} value={privacy} onChange={e => setPrivacy(e.target.value)}><option value="private">Privado</option><option value="unlisted">Não listado</option><option value="public">Público</option></select></label>
      <label className="block">Destinado a crianças?<select className={field} value={kids} onChange={e => setKids(e.target.value)}><option value="">Selecione</option><option value="no">Não</option><option value="yes">Sim</option></select></label>
      {asset?.video_url && <a className="block underline" href={asset.video_url} target="_blank" rel="noreferrer">Revisar o MP4</a>}
      <label className="block text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> Revisei o MP4 e os dados para o Bagaça Studios.</label>
      <button className={button} disabled={!state?.uploads_enabled || !connected || !!existingJob || !approved || !asset?.sha256 || !reviewed || !title.trim() || kids === ''} onClick={() => run(upload)}>{busy ? 'Processando…' : 'Enviar para Bagaça Studios'}</button>
      {!approved && <p className="text-xs">Aprove os dois editoriais para habilitar o envio.</p>}
    </fieldset>
    <ul className="space-y-2 text-sm">{state?.jobs?.map(job => <li key={job.slot}>{channels[job.slot]}: {job.status} {job.privacy && `(${job.privacy})`} {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="underline">Abrir vídeo</a>}{!job.video_id && <button className={button} disabled={busy} onClick={() => run(async () => { await api('reconcile', { slot: job.slot, group_id: groupId }); await refresh(); })}>Verificar envio</button>}{job.error && <p>{job.error}</p>}</li>)}</ul>
    <fieldset className="space-y-3 border-t border-[#3a4a4d] pt-3" disabled={busy}>
      <legend className="font-bold">Buscar vídeos para esta matéria</legend>
      <label className="block">Assunto<input className={field} value={query} onChange={e => setQuery(e.target.value)} placeholder="Deixe vazio para ver os últimos vídeos" /></label>
      <button className={button} onClick={() => run(async () => { const data = await api('search', { q: query, slot: 'bagaca' }, 'GET'); setVideos(data.results); setSearchErrors(data.errors || []); })}>Buscar vídeos</button>
      {searchErrors.map(result => <p key={result.slot} role="alert">{channels[result.slot]}: {result.error}</p>)}
      <ul className="space-y-3">{videos.map(video => <li key={video.video_id}><a href={video.url} target="_blank" rel="noreferrer" className="underline">{video.title}</a><p className="text-xs">{video.channel}</p><button className={button} disabled={!noticiaId || state?.sources?.some(s => s.video_id === video.video_id)} onClick={() => run(async () => { await api('associate', { noticia_id: noticiaId, video_id: video.video_id }); await refresh(); })}>{state?.sources?.some(s => s.video_id === video.video_id) ? 'Associado' : 'Associar à matéria'}</button></li>)}</ul>
    </fieldset>
    {!!state?.sources?.length && <div><h4>Vídeos associados</h4><ul>{state.sources.map(video => <li key={video.video_id}><a className="underline" href={`https://www.youtube.com/watch?v=${video.video_id}`} target="_blank" rel="noreferrer">{video.title}</a></li>)}</ul></div>}
  </section>;
}
