import { collectBriefingResearch } from './briefing-executor.mjs';
import { validateBriefingResearchPackage } from './briefing-research.mjs';

// Explicit backend action only. No backfill, canonical write, publication or receiver call.
export async function reapurarSiteEditorial({ supabase, noticiaId }, {
  collectResearch = collectBriefingResearch, createResponse, captureSource,
} = {}) {
  const news = await supabase.from('noticias').select('id,titulo,categoria,url,fonte,fontes(nome,url,publicado_em)').eq('id', noticiaId).maybeSingle();
  if (news.error) throw new Error('REAPURACAO_LOAD_FAILED: ' + news.error.message);
  if (!news.data) return { status: 404, json: { success: false, error: 'Noticia nao encontrada.' } };
  try {
    const identity = { id: news.data.id, titulo: news.data.titulo, categoria: news.data.categoria,
      fontes: [
        ...(Array.isArray(news.data.fontes) ? news.data.fontes.map(source => ({
          ...source,
          titulo: source?.titulo || source?.nome || '',
        })) : []),
        ...(news.data.url ? [{ url: news.data.url, titulo: news.data.fonte || '' }] : []),
      ] };
    if (!identity.titulo || !identity.categoria || !identity.fontes.length) throw new Error('CANONICAL_IDENTITY_OR_SOURCES_REQUIRED');
    const research = validateBriefingResearchPackage(await collectResearch({ targetStory: identity, createResponse, captureSource }));
    if (research.candidatos.length !== 1) throw new Error('SINGLE_RESEARCH_CANDIDATE_REQUIRED');
    const candidate = research.candidatos[0];
    if (candidate.titulo !== identity.titulo || candidate.categoria !== identity.categoria) throw new Error('RESEARCH_STORY_IDENTITY_MISMATCH');
    // All source snapshots and package validation finish before the first write.
    const run = await supabase.from('research_runs').insert({ janela_horas: 0, candidatos_pesquisados: 1, candidatos_validos: 1, erro: null }).select('id').single();
    if (run.error || !run.data?.id) throw new Error('RESEARCH_RUN_PERSIST_FAILED');
    // Candidate and noticia_id are one atomic INSERT, never insert then partial link.
    const saved = await supabase.from('research_candidates').insert({
      research_run_id: run.data.id, noticia_id: noticiaId, titulo: candidate.titulo, categoria: candidate.categoria,
      publicado_em: candidate.publicado_em || null, resumo: candidate.resumo,
      url: candidate.evidencias[0].url, fonte: candidate.evidencias[0].fonte, dados_json: JSON.stringify(candidate),
    }).select('id').single();
    if (saved.error || !saved.data?.id) throw new Error('RESEARCH_CANDIDATE_PERSIST_FAILED');
    return { status: 200, json: { success: true, action: 'reapurar-editorial', data: { noticia_id: noticiaId, research_candidate_id: saved.data.id } } };
  } catch {
    return { status: 422, json: { success: false, code: 'EDITORIAL_RESEARCH_FAILED', error: 'Reapuracao nao concluida; nenhuma noticia canonica foi alterada.' } };
  }
}
