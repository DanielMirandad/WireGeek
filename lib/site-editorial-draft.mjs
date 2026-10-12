export const DRAFT_FIELDS = 'noticia_id,materia_site,resumo_site,image_url,updated_at';

export function validateDraft(value) {
  for (const [field, limit] of [['materia_site', 50000], ['resumo_site', 5000], ['image_url', 8192]]) {
    if (typeof value?.[field] !== 'string' || value[field].length > limit) {
      throw new Error(`Rascunho invalido: ${field}.`);
    }
  }
  // Partial text and incomplete image URLs are deliberately allowed in drafts.
  return Object.fromEntries(['materia_site', 'resumo_site', 'image_url'].map(field => [field, value[field]]));
}

export async function loadDraft(supabase, noticiaId) {
  const { data, error } = await supabase.from('site_editorial_drafts')
    .select(DRAFT_FIELDS).eq('noticia_id', noticiaId).maybeSingle();
  if (error) throw new Error('Nao foi possivel carregar o rascunho editorial.');
  return data || null;
}

export async function saveDraft(supabase, noticiaId, value) {
  const record = { noticia_id: noticiaId, ...validateDraft(value), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('site_editorial_drafts')
    .upsert(record, { onConflict: 'noticia_id' }).select(DRAFT_FIELDS).single();
  if (error || !data) throw new Error('Nao foi possivel salvar o rascunho editorial.');
  return data;
}
