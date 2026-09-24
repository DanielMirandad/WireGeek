// Prepare editable copy only; this module never authorizes or sends a video.
export function youtubeDraft(item = {}) {
  const clean = value => String(value || '').replace(/[<>]/g, '').trim();
  const title = [...clean(item.titulo || item.title)].slice(0, 100).join('');
  const body = clean(item.resumo || item.materia);
  const footer = '\n\nBagaça Studios\nhttps://www.youtube.com/@bagacastudios';
  const encoder = new TextEncoder();
  let description = '';
  let bytes = encoder.encode(footer).length;
  for (const char of body) {
    const size = encoder.encode(char).length;
    if (bytes + size > 5000) break;
    description += char;
    bytes += size;
  }
  return { title, description: (description.trimEnd() + footer).trim() };
}
