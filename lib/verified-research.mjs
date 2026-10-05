import { buildCodexResearchPackage } from './codex-research-export.mjs';

export function verifiedCandidate(candidate) {
  return buildCodexResearchPackage({ candidatos: [candidate] }).candidatos[0];
}

// URL identity, never model order or a fuzzy title match. Ambiguity fails before writes.
export function mapResearchToNews(news, researchData) {
  if (!researchData?.verified) return null;
  const candidates = researchData.candidatos.map(verifiedCandidate);
  const used = new Set();
  return news.map(item => {
    const urls = new Set(item.fontes.map(source => source.url));
    const matches = candidates.map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.evidencias.some(evidence => urls.has(evidence.url)));
    if (matches.length !== 1 || used.has(matches[0].index)) {
      throw new Error('RESEARCH_NEWS_LINK_AMBIGUOUS_OR_MISSING');
    }
    used.add(matches[0].index);
    return matches[0].index;
  });
}
