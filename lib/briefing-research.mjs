import { buildCodexResearchPackage } from './codex-research-export.mjs';

const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const string = { type: 'string' };

export const BRIEFING_RESEARCH_SCHEMA = object({
  candidatos: {
    type: 'array', minItems: 1, maxItems: 12,
    items: object({
      titulo: string, categoria: string, publicado_em: string,
      resumo: string, contexto: string,
      evidencias: {
        type: 'array', minItems: 1,
        items: object({ fato: string, trecho: string, fonte: string, url: string, publicado_em: string }),
      },
    }),
  },
});

// Stable projection of collected data; no clock, network or database writes.
export function buildBriefingResearchPackage(collected, editorialHistoryContext) {
  const { candidatos } = buildCodexResearchPackage({ ...collected, format: 'wiregeek-briefing-research-v1', provenance: 'wiregeek_web_research', editorial_history_context: editorialHistoryContext });
  if (candidatos.length > 12) throw new Error('RESEARCH_CANDIDATE_LIMIT');
  if (typeof editorialHistoryContext !== 'string' || !editorialHistoryContext.trim()) {
    throw new Error('EDITORIAL_HISTORY_CONTEXT_REQUIRED');
  }
  return {
    format: 'wiregeek-briefing-research-v1',
    provenance: 'wiregeek_web_research',
    editorial_history_context: editorialHistoryContext,
    candidatos,
  };
}

export function validateBriefingResearchPackage(research) {
  if (research?.format !== 'wiregeek-briefing-research-v1' || research.provenance !== 'wiregeek_web_research') {
    throw new Error('INVALID_BRIEFING_RESEARCH_PACKAGE');
  }
  return buildBriefingResearchPackage(research, research.editorial_history_context);
}
