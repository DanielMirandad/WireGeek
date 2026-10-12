import { useEffect, useRef, useState } from 'react';
import { createDraftAutosave } from './site-draft-autosave.mjs';

const empty = () => ({ materia_site: '', resumo_site: '', image_url: null });
const writes = new Map();

export default function useSiteDraft(noticiaId, fallbackImage) {
  const [fields, setFields] = useState(empty);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const session = useRef(null);
  const image = useRef(fallbackImage);
  image.current = fallbackImage;

  useEffect(() => {
    let active = true;
    const state = { fields: empty(), ready: false, id: noticiaId };
    session.current = state;
    setFields(state.fields);
    setStatus('loading');
    setError('');
    const url = '/api/publicacoes?mode=site-publish';
    const autosave = createDraftAutosave({
      notify(next, message = '') { if (active) { setStatus(next); setError(message); } },
      async save(value) {
        const previous = writes.get(noticiaId) || Promise.resolve();
        const write = previous.catch(() => {}).then(async () => {
          const body = JSON.stringify({ action: 'save-draft', noticia_id: noticiaId, ...value });
          const response = await fetch(url, {
            method: 'POST', credentials: 'include',
            keepalive: new TextEncoder().encode(body).length <= 60000,
            headers: { 'Content-Type': 'application/json' }, body,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Falha ao salvar rascunho.');
        });
        writes.set(noticiaId, write);
        try { await write; } finally { if (writes.get(noticiaId) === write) writes.delete(noticiaId); }
      },
    });
    state.autosave = autosave;
    async function read(action) {
      const response = await fetch(`${url}&action=${action}&noticia_id=${noticiaId}`, { credentials: 'include' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Falha ao carregar rascunho.');
      return result.data;
    }
    async function load() {
      try {
        await writes.get(noticiaId);
        const draft = await read('draft');
        let initial = draft;
        if (!draft) {
          // Compatibility fallback never confers approval on a restored draft.
          const [approved, published] = await Promise.all([
            read('approved-editorial').catch(() => null), read('status').catch(() => null),
          ]);
          initial = approved ? { ...approved, image_url: published?.image_url ?? null } :
            published ? { materia_site: published.body, resumo_site: published.excerpt, image_url: published.image_url } : null;
        }
        if (!active) return;
        state.fields = initial ? {
          materia_site: initial.materia_site || '', resumo_site: initial.resumo_site || '',
          image_url: initial.image_url ?? null,
        } : empty();
        state.ready = true;
        setFields(state.fields);
        setStatus(draft ? 'saved' : 'idle');
      } catch (err) {
        if (active) { setStatus('load-error'); setError(err.message); }
      }
    }
    if (Number.isSafeInteger(noticiaId) && noticiaId > 0) load();
    const flush = () => { autosave.flush().catch(() => {}); };
    window.addEventListener('pagehide', flush);
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', hidden);
    const beforeUnload = event => {
      if (!autosave.isDirty()) return;
      flush();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      active = false;
      state.ready = false;
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', beforeUnload);
      autosave.dispose().catch(() => {});
    };
  }, [noticiaId]);

  const owner = session.current;
  function update(patch, immediate = false) {
    const state = session.current;
    if (!state?.ready || state !== owner || state.id !== noticiaId) return;
    state.fields = { ...state.fields, ...patch };
    setFields(state.fields);
    state.autosave.update({ ...state.fields, image_url: state.fields.image_url ?? image.current ?? '' }, immediate)?.catch(() => {});
  }
  return {
    fields, status, error, blocked: ['loading', 'load-error'].includes(status),
    setBody: value => update({ materia_site: value }),
    setExcerpt: value => update({ resumo_site: value }),
    setImage: value => update({ image_url: value }),
    generated: (body, excerpt) => update({ materia_site: body, resumo_site: excerpt }, true),
    retry: () => session.current?.autosave.flush().catch(() => {}),
  };
}
