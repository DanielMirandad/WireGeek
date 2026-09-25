export function tiktokDraft(item = {}) {
  const clean = value => String(value || '').replace(/[<>]/g, '').trim();
  const title = clean(item.titulo || item.title);
  const body = clean(item.resumo || item.materia);
  const hashtags = clean(item.hashtags || '').split(/\s+/).filter(value => value.startsWith('#')).join(' ');
  const text = [title, body, hashtags].filter(Boolean).join('\n\n');
  return { caption: [...text].slice(0, 2200).join('') };
}
