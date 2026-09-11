// Text normalization must never strip accents or join article paragraphs.
export const HIGHLIGHT_COUNT = 2;
export const MIN_HIGHLIGHT_WORDS = 15;
export const MAX_HIGHLIGHT_WORDS = 25;
export const HIGHLIGHTS_SCHEMA = {
  type: "array", minItems: HIGHLIGHT_COUNT, maxItems: HIGHLIGHT_COUNT,
  description: "Dois ganchos de curiosidade distintos, com 15 a 25 palavras cada e resposta na matéria.",
  items: { type: "string" },
};

export function cleanEditorialText(value) {
  return String(value ?? "").normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n").trim();
}

export const countHighlightWords = value => String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
export const comparisonKey = value => String(value ?? "").normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ")
  .replace(/\s+/g, " ").trim();

// These are detectors, never a dictionary of automatic replacements.
// Ambiguous words (pais/país, critica/crítica, esta/está, etc.) belong to the editor.
const accentless = /\b(?:transmissao|animacao|comemoracoes|aniversario|expansao|midias|operacoes|transicao|producao|exibicao|informacoes|informacao|noticias|noticia|publicacao|programacao|presenca|tambem|proximo|proxima|porem|possivel|consequencia|consequencias|publico|publicos|agencia|agencias)\b/gi;
const badEncoding = /\uFFFD|Ã[\u0080-\u00BFƒ‡‰Š“”•˜™šœžŸ]|Â[\u0080-\u00BF]|â(?:€|™|œ)|ï¿½/;
const editorialTypos = /\b(?:liver(?:s)?\s+virtuais?|operucionais|animacao\s+televisiva\s+representa\s+um\s+marco\s+historico)\b/gi;

export function validatePortugueseText(value) {
  const text = String(value ?? "");
  const errors = [];
  if (badEncoding.test(text)) errors.push("contém caracteres de codificação corrompidos");
  const suspect = [...new Set(text.match(accentless) || [])];
  if (suspect.length) errors.push(`precisa de revisão de acentuação: ${suspect.slice(0, 6).join(", ")}`);
  const wording = [...new Set(text.match(editorialTypos) || [])];
  if (wording.length) errors.push(`precisa de revisão de redação: ${wording.slice(0, 3).join(", ")}`);
  return errors;
}

const genericBait = /^(?:detalhe\b|mas ha um detalhe\b|o detalhe que\b|voce nao vai acreditar\b|descubra o que\b|saiba mais\b|informacoes factuais adicionais\b)/;
const stopWords = new Set("a o as os um uma uns umas de do da dos das e em no na nos nas para por com que se ao aos sua seu suas seus".split(" "));
function tokens(value) { return new Set(comparisonKey(value).split(" ").filter(t => !stopWords.has(t))); }
export function highlightsTooSimilar(a, b) {
  if (comparisonKey(a) === comparisonKey(b)) return true;
  const first = tokens(a), second = tokens(b);
  const union = new Set([...first, ...second]);
  const shared = [...first].filter(t => second.has(t)).length;
  return union.size > 0 && shared / union.size >= 0.8;
}

export function validateHighlights(highlights, title = "") {
  if (!Array.isArray(highlights) || highlights.length !== HIGHLIGHT_COUNT) {
    return ["precisa de exatamente 2 highlights"];
  }
  const errors = [];
  highlights.forEach((highlight, index) => {
    const label = `highlight ${index + 1}`;
    if (typeof highlight !== "string") { errors.push(`${label} precisa ser texto`); return; }
    const words = countHighlightWords(highlight);
    if (words < MIN_HIGHLIGHT_WORDS || words > MAX_HIGHLIGHT_WORDS) errors.push(`${label} precisa de 15 a 25 palavras (recebido: ${words})`);
    if (!/[.!?]["'”’)]?$/.test(highlight.trim())) errors.push(`${label} precisa terminar uma frase completa`);
    const key = comparisonKey(highlight);
    if (/\b(?:e|de|do|da|dos|das|em|com|para|que|mas|uma|um)$/.test(key)) errors.push(`${label} parece terminar com uma frase cortada`);
    if (genericBait.test(key)) errors.push(`${label} usa uma chamada genérica de curiosidade`);
    if (key && key === comparisonKey(title)) errors.push(`${label} repete o título`);
    errors.push(...validatePortugueseText(highlight).map(e => `${label} ${e}`));
  });
  if (highlightsTooSimilar(highlights[0], highlights[1])) errors.push("os highlights precisam explorar dois ângulos distintos");
  return errors;
}

export function validateEditorialItem(item) {
  const errors = validateHighlights(item?.highlights, item?.titulo);
  for (const field of ["titulo", "materia", "titulo_curto"]) {
    errors.push(...validatePortugueseText(item?.[field]).map(e => `${field} ${e}`));
  }
  const shortTitle = String(item?.titulo_curto || "").trim();
  const shortTitleWords = shortTitle
    ? shortTitle.split(/\s+/).filter(Boolean)
    : [];

  if (
    !shortTitle ||
    shortTitle.length > 24 ||
    shortTitleWords.length > 2
  ) {
    errors.push(
      "titulo_curto precisa identificar o assunto com 1 ou 2 palavras completas e até 24 caracteres; nunca corte uma palavra ou nome"
    );
  }
  return errors;
}

export const EDITORIAL_RULES = `
Escreva em português brasileiro natural, com acentos e concordância corretos.
Revise no contexto: "pais" não é sempre "país", "critica" não é sempre "crítica",
"esta" não é sempre "está". Preserve nomes e marcas. Nunca converta para ASCII.
Use "VTubers" ou "criadores virtuais" quando esse for o sentido, não "liver virtuais".
Retire adjetivos promocionais, repetições e afirmações que não tenham apoio nos fatos pesquisados.

HIGHLIGHTS: exatamente 2 strings, cada uma com 15 a 25 palavras.
Cada highlight é uma frase completa e natural que desperta curiosidade sobre um detalhe concreto.
Comece por um fato verificado e deixe uma pergunta específica em aberto, respondida na matéria.
Podem ser afirmações ou perguntas; o sinal de interrogação não é obrigatório.
Os dois devem ter ângulos factuais diferentes, sem repetir o título nem resumir a notícia inteira.
Não prometa segredo, surpresa, impacto ou consequência sem confirmação.
Não acrescente "Detalhe:", "Mas há um detalhe:", "Saiba mais" ou outra fórmula a um resumo pronto.
Não corte frases, não acrescente palavras de preenchimento e não invente um segundo fato.
Conte as palavras. Se necessário, REESCREVA a frase integralmente, preservando sentido e naturalidade.
Revise se a curiosidade tem uma resposta factual no texto, e se os dois ganchos são diferentes.

TÍTULO CURTO: em titulo_curto, escreva apenas o nome curto do assunto (obra, jogo, marca ou produto),
com 1 ou 2 palavras completas e até 24 caracteres. Nunca corte uma palavra ou nome para caber no limite. É o título colorido do banner.
Exemplo: "One Piece", e não a manchete inteira sobre One Piece.
O título deve caber em uma linha; prefira highlights concisos que ocupem no máximo quatro linhas.
Use palavras precisas e diretas. Não reduza os tamanhos do modelo para encaixar texto longo.
Não altere datas, categorias, nomes de fontes ou URLs. Não use travessões.
`;

// These constraints describe the fixed, approved Archive layout. They are
// intentionally stricter than the editorial word-count range so the model
// rewrites copy before the renderer has to reject an otherwise valid item.
export const BANNER_COPY_RULES = `
ENCAIXE NOS BANNERS:
O modelo usa título em Archive 50 e highlight em Archive 35, sem reduzir os tamanhos.
titulo_curto deve ser somente o nome curto do assunto, com 1 ou 2 palavras completas e obrigatoriamente
até 24 caracteres (por exemplo, "Musk" ou "Artificial", nunca a manchete completa).
Cada highlight deve ter 15 a 18 palavras sempre que possível, ser uma frase completa,
usar palavras e construções curtas e caber em no máximo 4 linhas do modelo.
Evite listas, parênteses, subtítulos, orações longas e acúmulo de adjetivos.
Se a validação informar que o texto não cabe, reescreva integralmente o titulo_curto e
o highlight indicado, preservando apenas fatos confirmados e a curiosidade concreta.
Nunca reduza a fonte, corte a frase ou acrescente palavras de preenchimento.
`;
