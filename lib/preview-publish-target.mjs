// Fail closed for Bagaça publication from WireGeek Preview.
export function assertPreviewPublishTarget(endpoint, env = process.env) {
  if (env.VERCEL_ENV !== 'preview') return;

  const configured = String(env.BAGACA_SITE_PREVIEW_PUBLISH_HOST || '')
    .trim()
    .toLowerCase();

  const validHost = /^bagaca-cast-site-[a-z0-9]{8,}-danielmirandads-projects\.vercel\.app$/.test(configured);

  if (!validHost ||
      endpoint.protocol !== 'https:' ||
      endpoint.hostname !== configured ||
      endpoint.port ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash) {
    throw new Error('Destino de publicacao Preview nao autorizado.');
  }
}
