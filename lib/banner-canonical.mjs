import { validateCanonicalShape } from './wiregeek-contract.mjs';

function failure(message, code, statusCode, details) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

export function canonicalNewsId(value) {
  const text = String(value ?? '');
  const id = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(id)) {
    throw failure('Informe o ID de uma notícia salva.', 'CANONICAL_NEWS_ID_REQUIRED', 400);
  }
  return id;
}

function images(values) {
  return (Array.isArray(values) ? values : []).map(value => {
    const item = typeof value === 'string' ? { url: value } : value;
    if (!item || typeof item !== 'object') return null;
    const url = String(item.url || item.image_url || item.imageUrl || '').trim();
    return /^https?:\/\//i.test(url) ? { ...item, url } : null;
  }).filter(Boolean);
}

// Saved stories send identity and optional image choices. Editorial copy is
// always loaded by the server, including when the browser has an older edition.
export function buildCanonicalClientPayload(item) {
  return {
    mode: 'briefing',
    noticia_id: canonicalNewsId(item.id),
    imagens: images(item.imagens),
    banners: (Array.isArray(item.banners) ? item.banners : [])
      .filter(banner => String(banner?.type || 'editorial').toLowerCase() === 'editorial')
      .slice(0, 2).map(banner => ({
        type: 'editorial',
        image_url: String(banner.image_url || banner.imageUrl || '').trim(),
        imagens: images(banner.imagens),
      })),
  };
}

function ordered(rows) {
  return Array.isArray(rows) ? [...rows].sort((a, b) => Number(a.id) - Number(b.id)) : [];
}

function editorialCopy(highlight) {
  const text = String(highlight || '').trim();
  if (!text) return '';

  const endings = ['. ', '! ', '? '];
  let cut = -1;

  for (const ending of endings) {
    const index = text.indexOf(ending);
    if (index >= 0 && (cut < 0 || index < cut)) {
      cut = index;
    }
  }

  return cut >= 0
    ? text.slice(0, cut + 1).trim()
    : text;
}
export async function loadCanonicalBannerRequest(client, noticiaId, imageChoices = {}) {
  const id = canonicalNewsId(noticiaId);
  const { data, error } = await client.from('noticias')
    .select('id,categoria,titulo,titulo_curto,artigo,highlights(id,texto),hashtags(id,hashtag),fontes(id,nome,url,publicado_em)')
    .eq('id', id).maybeSingle();
  if (error) throw failure('Não foi possível carregar a notícia salva. Tente novamente.', 'CANONICAL_NEWS_READ_FAILED', 503);
  if (!data) throw failure('Notícia salva não encontrada.', 'CANONICAL_NEWS_NOT_FOUND', 404);
  if (Number(data.id) !== id) throw failure('A notícia recebida não corresponde ao ID solicitado.', 'CANONICAL_NEWS_READ_FAILED', 503);
  return buildCanonicalBannerRequest(data, imageChoices);
}

export function buildCanonicalBannerRequest(row, imageChoices = {}) {
  const item = {
    id: canonicalNewsId(row.id),
    categoria: row.categoria,
    titulo: row.titulo,
    titulo_curto: row.titulo_curto,

    materia: row.artigo,
    highlights: ordered(row.highlights).map(entry => entry.texto),
    hashtags: ordered(row.hashtags).map(entry => entry.hashtag),
    fontes: ordered(row.fontes).map(source => ({
      titulo: source.nome,
      url: source.url,
      publicado_em: source.publicado_em,
    })),
    fonte_oficial_primaria: {
      encontrada: false,
    },
    image_query: row.titulo_curto,
  };
  const issues = [...new Set(validateCanonicalShape(item))];
  if (issues.length) {
    throw failure('Revise os dados editoriais salvos antes de gerar o banner: ' + issues.join('; ') + '.', 'CANONICAL_EDITORIAL_REVIEW_REQUIRED', 422, issues);
  }

  const choices = buildCanonicalClientPayload({ ...imageChoices, id: item.id });
  const entities = [item.titulo_curto];
  const context = [
    `Entidade principal: ${item.titulo_curto}`,
    `Título: ${item.titulo}`,

    `Matéria: ${item.materia}`,
  ].join('\n');
  return {
    mode: 'briefing', canonical_source: true,
    noticia_id: item.id, categoria: item.categoria,
    titulo: item.titulo, titulo_curto: item.titulo_curto,
    materia: item.materia,
    highlights: item.highlights, entidades: entities,
    contexto_visual: context,
    source_urls: item.fontes.map(source => source.url),
    banners: [
      ...item.highlights.map((highlight, index) => {
        const own = choices.banners[index] || {};
        const candidates = images([...images(own.imagens), ...(choices.imagens[index] ? [choices.imagens[index]] : []), ...choices.imagens]);
        return {
          type: 'editorial', index, categoria: item.categoria,
          titulo_curto: item.titulo_curto,
          banner_title: item.titulo_curto, highlight,
          editorial_copy: editorialCopy(highlight),
          visual_subject: item.titulo,
          contexto_visual: `${context}\nDestaque deste banner: ${highlight}${index === 1 ? '\nUsar uma segunda imagem oficial claramente diferente do primeiro banner.' : ''}`,
          image_query: item.titulo,
          image_url: /^https?:\/\//i.test(own.image_url || '') ? own.image_url : candidates[0]?.url || '',
          image_candidates: [...new Map(candidates.map(image => [image.url, image])).values()],
        };
      }),
      { type: 'cta', index: 2, asset_path: './assets/cta/bagaca-studios-cta.jpg' },
    ],
  };
}



