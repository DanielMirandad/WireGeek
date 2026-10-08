import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadPreviewFixture403 } from '../lib/briefing-preview-fixture-403.mjs';
import { resolveBriefingBannerImages } from '../lib/banner-images-briefing.mjs';
import { normalizeBanner, renderBanner } from '../lib/banner-renderer-briefing.mjs';
import { createPreviewZip } from '../lib/briefing-preview-zip.mjs';
import { withoutGenerationCache } from '../lib/generation-cache.mjs';
if (!process.argv[2]) throw new Error('Informe a pasta de exportação.');
const output = resolve(process.argv[2]);
const files = await withoutGenerationCache(async () => {
  const briefing = loadPreviewFixture403();
  const banners = briefing.banners.filter(b => b.type === 'editorial');
  const images = await resolveBriefingBannerImages(briefing);
  if (banners.length !== 2 || images.length !== 2) throw new Error('Exige dois editoriais.');
  return Promise.all(banners.map((banner, i) => renderBanner({
    ...normalizeBanner({ ...banner, ...briefing.visual_title, categoria: briefing.categoria, titulo_curto: briefing.titulo_curto }),
    imageBuffer: images[i].imageBuffer,
  })));
});
const zip = createPreviewZip(files);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'wiregeek-403-preview.zip'), zip);
for (const [i, file] of files.entries()) await writeFile(resolve(output, 'wiregeek-403-editorial-' + (i+1) + '.png'), file.png);
console.log('Exportados dois PNGs e ZIP:', output);
