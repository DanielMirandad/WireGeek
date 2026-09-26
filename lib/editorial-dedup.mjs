// Cross-run dedup reads the complete persisted history, including legacy rows.
// Kept only for compatibility with existing diagnostics/imports.
// Deduplication itself is no longer limited to this window.
export const EDITORIAL_HISTORY_HOURS = 72;
const HISTORY_PAGE_SIZE = 200;
const TRACKING_PARAM = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_gl)$/i;
const LISTING_PATH = /^\/(?:news|noticias|games|geek|cinema|anime|category|categoria|tag|tags|search|busca|author|autor)\/?$/i;

export function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    // A publisher's home/listing page cannot identify a single story.
    if (!url.search && (pathname === '/' || LISTING_PATH.test(pathname))) return '';
    return `${url.host.toLowerCase().replace(/^www\./, '')}${pathname}${url.search}`;
  } catch { return ''; }
}

export function normalizeEventText(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s.,!?]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const STOP = new Set(('a o as os um uma uns umas de do da dos das e em no na nos nas para por com que se ao aos sua seu suas seus ' +
  'the of and to for in on new ' +
  'anuncia anunciam anunciou anunciado anunciada anuncio anunciarem revela revelam revelou revelado revelada ' +
  'confirma confirmou confirmado confirmada divulga divulgou divulgado divulgada detalha detalhou detalhes ' +
  'novo nova novos novas oficial oficiais oficialmente ganha ganham ganhou recebe recebeu tera tem vai mais ' +
  'primeiro primeira primeiros primeiras apos sobre durante agora ja').split(' '));
const ALIASES = new Map(Object.entries({
  jogos:'jogo', consoles:'console', cinemas:'cinema', trailers:'trailer', datas:'data', jogadores:'jogador',
  temporadas:'temporada', episodios:'episodio', atualizacoes:'atualizacao', lancamentos:'lancamento',
  estreias:'estreia', exibe:'exibicao', exibicoes:'exibicao', sessoes:'sessao', funcionarios:'funcionario',
  dublada:'dublagem', dublado:'dublagem', colaboradores:'funcionario', bilheterias:'bilheteria',
  previa:'trailer', teaser:'trailer', apresenta:'apresentacao', apresentou:'apresentacao',
}));
function tokens(text) {
  return new Set((normalizeEventText(text).match(/\d+(?:[.,]\d+)*|[\p{L}][\p{L}\p{N}]*/gu) || [])
    .filter(token => !STOP.has(token) && (token.length > 1 || /^\d/.test(token)))
    .map(token => ALIASES.get(token) || token));
}
function titleOverlap(a, b) {
  const left=tokens(a), right=tokens(b);
  const common=[...left].filter(word=>right.has(word)).length;
  return { common, smaller:common/Math.max(1,Math.min(left.size,right.size)), larger:common/Math.max(1,left.size,right.size) };
}
function titleKey(value) { return [...tokens(value)].sort().join(' '); }
function sourceKeys(item) {
  const sources = Array.isArray(item?.fontes) ? item.fontes : [];
  return [...new Set([item?.url, ...sources.map(f=>f?.url)].map(normalizeSourceUrl).filter(Boolean))];
}
export function primarySourceKey(item) {
  const sources = Array.isArray(item?.fontes) ? item.fontes : [];
  const candidates = [
    sources[0]?.url,
    item?.url,
    ...sources.slice(1).map(source => source?.url),
  ];
  return candidates.map(normalizeSourceUrl).find(Boolean) || '';
}
function body(item) {
  if (item?.materia || item?.artigo) return String(item.materia || item.artigo);
  // Research candidates have a summary and confirmed facts before article writing.
  return [item?.resumo, ...(Array.isArray(item?.fatos_confirmados) ? item.fatos_confirmados : [])]
    .filter(value => typeof value === 'string' && value.trim()).join('. ');
}

// A date change on the source or a rewritten headline is not proof of a new event.
// New event details must appear in both the incoming headline and its article,
// and must not already be present in the stored article/headline.
const FACTS = [
  ['desmentido', /\b(?:nega|negou|desmente|desmentiu|refuta|refutou|rebate|contesta|contestou)\b/],
  ['adiamento', /\b(?:adia|adiou|adiad[oa]s?|adiamento)\b/],
  ['cancelamento', /\b(?:cancela|cancelou|cancelad[oa]s?|cancelamento)\b/],
  ['estreia', /\b(?:lanca|lancou|lancad[oa]|estreia|estreou|chegou|disponivel)\b/],
  ['trailer', /\b(?:trailer|teaser|previa|clipe)\b/],
  ['renovacao', /\b(?:renova|renovou|renovad[oa]|renovacao)\b/],
  ['demissoes', /\b(?:demite|demitiu|demitid[oa]s?|demiss(?:ao|oes))\b/],
  ['aquisicao', /\b(?:adquire|adquiriu|adquirid[oa]|compra|comprou|aquisicao)\b/],
  ['decisao_judicial', /\b(?:condena|condenou|condenad[oa]|condenacao|absolve|absolveu|absolvido|absolvicao)\b/],
  ['acordo', /\b(?:acordo|indenizacao|indeniza)\b/],
  ['vendas', /\b(?:vende|vendeu|vendas|arrecada|arrecadou|arrecadacao|bilheteria)\b/],
  ['atualizacao', /\b(?:atualizacao|atualiza|patch|versao)\b/],
];
const UNCERTAIN = /\b(?:pode|podera|poderia|rumor|rumores|especula|especulacao|suposto|suposta|talvez|nega|negou|nao)\b/;
function affirmativeFact(text, kind, pattern) {
  return normalizeEventText(text).split(/(?<=[.!?])\s+|\n+/).some(sentence => {
    const assertion = kind === 'desmentido' ? sentence.replace(/\b(?:nega|negou)\b/g, '') : sentence;
    if (!pattern.test(sentence) || UNCERTAIN.test(assertion) || sentence.includes('?')) return false;
    if (kind==='estreia' && /\b(?:sera|previst[oa]|prepara|planeja|anuncia|anunciou|confirmou|confirma)\b/.test(sentence)) return false;
    if (kind==='estreia' && /\b(?:trailer|teaser|previa|clipe)\b/.test(sentence)) return false;
    return true;
  });
}
function numberedFacts(text) {
  const affirmed = normalizeEventText(text).split(/(?<=[.!?])\s+/)
    .filter(sentence => !UNCERTAIN.test(sentence) && !sentence.includes('?')).join(' ');
  return new Set(affirmed.match(
    /\b(?:versao|temporada|episodio|patch|atualizacao|switch|playstation|iphone|gemini|gpt|nhl|fighter|pixel|galaxy)\s*(?:v\s*)?\d+(?:[.,]\d+)*\b|\b\d+(?:[.,]\d+)*\s+(?:milhao|milhoes|bilhao|bilhoes|copias|unidades|jogadores|usuarios|funcionarios|vagas|episodios)\b|\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+\d{4})?\b/g
  ) || []);
}
// Stable evidence for concurrent versions of a story on the same source URL.
// Used only after a stored story confirms this is a material update.
export function editorialEventSignature(item) {
  const title=String(item?.titulo || ''), article=body(item);
  const facts=FACTS.filter(([kind,pattern])=>affirmativeFact(title,kind,pattern) && affirmativeFact(article,kind,pattern)).map(([kind])=>kind);
  const articleFacts=numberedFacts(article);
  const numbers=[...numberedFacts(title)].filter(fact=>articleFacts.has(fact));
  return [...facts,...numbers].sort().join('|');
}
function hasMaterialUpdate(incoming, previous) {
  const title=String(incoming?.titulo || '');
  const article=body(incoming);
  if (!article.trim()) return false;
  const previousText=`${previous?.titulo || ''} ${body(previous)}`;
  for (const [kind, pattern] of FACTS) {
    if (affirmativeFact(title,kind,pattern) && affirmativeFact(article,kind,pattern)
        && !affirmativeFact(previousText,kind,pattern)) return true;
  }
  // Version, season, financial milestone or event date can change without changing its stage.
  if (UNCERTAIN.test(normalizeEventText(title))) return false;
  const oldFacts=numberedFacts(previousText), articleFacts=numberedFacts(article);
  return [...numberedFacts(title)].some(fact=>articleFacts.has(fact) && !oldFacts.has(fact));
}

export function compareEditorialStories(incoming, previous) {
  const shared=sourceKeys(incoming).filter(url=>sourceKeys(previous).includes(url));
  const overlap=titleOverlap(incoming?.titulo,previous?.titulo);
  const sameTitle=Boolean(titleKey(incoming?.titulo)) && titleKey(incoming?.titulo)===titleKey(previous?.titulo);
  const similarTitle=overlap.common>=3 && overlap.smaller>=0.8 && overlap.larger>=0.55;
  const primaryShared=shared.some(url=>url===primarySourceKey(incoming) || url===primarySourceKey(previous));
  const relatedSources=shared.length>0 && (primaryShared || overlap.common>=3);
  if (!sameTitle && !similarTitle && !relatedSources) return {duplicate:false,reason:'pauta_distinta'};
  if (hasMaterialUpdate(incoming,previous)) return {duplicate:false,reason:'novo_acontecimento'};
  return {duplicate:true,reason:relatedSources?'fonte_repetida':'titulo_evento_repetido'};
}

export function selectUnseenNews(news, history) {
  const pool=history.map(item=>({item,index:null}));
  const retainedIndexes=[],duplicates=[],updates=[];
  for (const [index,item] of news.entries()) {
    let duplicate=null;
    const changes=[];
    for (const existing of pool) {
      const match=compareEditorialStories(item,existing.item);
      const evidence={index,noticia_id:existing.item.id ?? null,previous_index:existing.index,reason:match.reason};
      if(match.duplicate){duplicate=evidence;break;}
      if(match.reason==='novo_acontecimento') changes.push(evidence);
    }
    if(duplicate) duplicates.push(duplicate);
    else{retainedIndexes.push(index);updates.push(...changes);pool.push({item,index});}
  }
  return {retainedIndexes,duplicates,updates};
}

export async function loadEditorialHistory(supabase) {
  const history=[];
  let lastId=0;
  for (;;) {
    const {data,error}=await supabase.from('noticias')
      .select('id,titulo,titulo_curto,manchete_curta,resumo,artigo,url,publicado_em,criado_em,fontes(url)')
      .gt('id',lastId).order('id',{ascending:true}).limit(HISTORY_PAGE_SIZE);
    if(error || !Array.isArray(data)) throw new Error(`Não foi possível consultar notícias anteriores; a rodada não foi salva. ${error?.message || 'Resposta inválida do histórico.'}`);
    for(const row of data){
      if(!Number.isSafeInteger(Number(row.id)) || Number(row.id)<=lastId) throw new Error('Histórico fora de ordem; a rodada não foi salva.');
      history.push(row);lastId=Number(row.id);
    }
    if(data.length<HISTORY_PAGE_SIZE) return {history,since:null};
  }
}
