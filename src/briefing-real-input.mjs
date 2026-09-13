// Only accept one editorial item. Never import pre-rendered results.
export function parseBriefingRealInput(text) {
  let item;
  try { item = JSON.parse(text); }
  catch { throw new Error("JSON inválido. Cole um único item do Briefing Geek Diário."); }
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const required = (value, label) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} deve conter texto.`);
    return value.trim();
  };
  if (!object(item)) throw new Error("Carregue um único objeto, sem lista ou edição completa.");
  const categoria = required(item.categoria, "categoria").toLowerCase();
  if (!["anime", "games", "cinema", "geek"].includes(categoria)) throw new Error("Categoria deve ser anime, games, cinema ou geek.");
  if (!Array.isArray(item.fontes)) throw new Error("fontes deve ser uma lista.");
  if (item.imagens !== undefined && !Array.isArray(item.imagens)) throw new Error("imagens deve ser uma lista, que pode estar vazia.");
  if (!Array.isArray(item.banners) || item.banners.length !== 2) throw new Error("Informe exatamente dois banners editoriais. O CTA será acrescentado pelo fluxo existente.");
  const banners = item.banners.map((banner, index) => {
    if (!object(banner) || (banner.type !== undefined && banner.type !== "editorial")) throw new Error(`Banner ${index + 1} deve ser editorial.`);
    const result = {
      type: "editorial",
      banner_title: required(banner.banner_title, `Banner ${index + 1}: banner_title`),
      highlight: required(banner.highlight, `Banner ${index + 1}: highlight`),
    };
    for (const field of ["visual_subject", "contexto_visual", "image_query", "image_url"]) {
      if (banner[field] !== undefined) result[field] = required(banner[field], `Banner ${index + 1}: ${field}`);
    }
    if (banner.imagens !== undefined) {
      if (!Array.isArray(banner.imagens)) throw new Error(`Banner ${index + 1}: imagens deve ser uma lista.`);
      result.imagens = banner.imagens;
    }
    return result;
  });
  return {
    categoria,
    titulo: required(item.titulo, "titulo"),
    fontes: item.fontes,
    contexto_visual: required(item.contexto_visual, "contexto_visual"),
    image_query: required(item.image_query, "image_query"),
    imagens: item.imagens || [],
    banners,
  };
}
