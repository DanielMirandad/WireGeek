// Shared by the panel and publisher; no persistence or image generation here.
export function correctionSnapshot(rows) {
  return rows.map(row => ({ id: Number(row.id), banner_url: row.banner_url,
    cta_url: row.cta_url, status: row.status, atualizado_em: row.atualizado_em,
    selected_channels: row.selected_channels ?? null, scheduled_at: row.scheduled_at ?? null,
    hashtags: row.hashtags ?? null, banner_model_version: row.banner_model_version ?? null,
    reel_asset_revision: row.reel_asset_revision ?? null,
    instagram_parent_container_id: row.instagram_parent_container_id ?? null }));
}

export function correctedEditorials(slides) {
  if (!Array.isArray(slides)) throw new Error('Conjunto corrigido ausente.');
  const rows = slides.filter(slide => slide?.type === 'editorial' && slide.publication_id == null);
  if (rows.length < 1 || rows.length > 2) throw new Error('Use 1 ou 2 editoriais corrigidos.');
  const urls = new Set();
  return rows.map(slide => {
    const url = new URL(String(slide.banner_url || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || urls.has(url.href)) {
      throw new Error('Banners corrigidos devem ter URLs HTTPS distintas e publicas.');
    }
    urls.add(url.href);
    const caption = String(slide.headline || '').trim();
    if (!caption || caption.length > 2200) throw new Error('Editorial corrigido sem headline valida.');
    return { banner_url: url.href, caption };
  });
}

export function reelAssetPrefix(groupId, revision = null) {
  if (revision == null) return groupId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(revision)) {
    throw new Error('Revisao do asset invalida.');
  }
  return groupId + '-' + revision;
}
