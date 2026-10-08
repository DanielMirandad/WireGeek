import { buildCanonicalBannerRequest } from './banner-canonical.mjs';

const SOURCE_IMAGES = Object.freeze([
  'https://web-static.hg-cdn.com/upload/image/20261006/5cb4ff8b849fed7568a408c212df250e.png',
  'https://web-static.hg-cdn.com/upload/image/20261006/f40a387c839e92d3494ecff376bf5cec.png',
]);

const NEWS = Object.freeze({
  id: 403,
  titulo: 'Arknights: Endfield confirma atualização Sanctuary of Ink e chegada ao Steam em 15 de outubro',
  titulo_curto: 'Arknights: Endfield no Steam',
  categoria: 'games',
  artigo: 'A GRYPHLINE confirmou que a atualização principal Sanctuary of Ink, de Arknights: Endfield, será lançada em 15 de outubro. Na mesma data, o jogo chega oficialmente ao Steam. A versão da loja da Valve terá sincronização de dados de conta entre plataformas, permitindo a continuidade do progresso para quem joga em diferentes dispositivos.',
  highlights: [
    {
      id: 1,
      texto: 'A atualização Sanctuary of Ink e a versão de Steam de Arknights: Endfield chegam oficialmente em 15 de outubro.',
    },
    {
      id: 2,
      texto: 'A edição de Steam terá sincronização de dados de conta entre plataformas, segundo comunicado da GRYPHLINE.',
    },
  ],
  hashtags: [
    { id: 1, hashtag: '#arknightsendfield' },
    { id: 2, hashtag: '#arknights' },
    { id: 3, hashtag: '#gryphline' },
    { id: 4, hashtag: '#steam' },
    { id: 5, hashtag: '#games' },
  ],
  fontes: [
    {
      id: 1,
      nome: 'Arknights: Endfield [Sanctuary of Ink] Version DEV Comm',
      url: 'https://endfield.gryphline.com/en-us/news/7014',
      publicado_em: null,
    },
  ],
});

export function loadPreviewFixture403() {
  const briefing = buildCanonicalBannerRequest(NEWS);
  briefing.visual_title = { title_main: "ENDFIELD", title_theme: "ESTREIA NO STEAM" };

  briefing.banners
    .filter(banner => banner.type === 'editorial')
    .forEach((banner, index) => {
      banner.image_url = SOURCE_IMAGES[index];
      banner.image_candidates = [];
      banner.manual_image_override = true;
      banner.editorial_copy = [
        'SANCTUARY OF INK E ESTREIA NO STEAM CHEGAM EM 15 DE OUTUBRO.',
        'VERSÃO STEAM TERÁ PROGRESSO SINCRONIZADO ENTRE PLATAFORMAS.'
      ][index];
    });

  return briefing;
}