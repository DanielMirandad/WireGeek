import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBagacaSocialCaptionFromArticle,
  buildGroupInstagramReelCaption,
} from "../lib/instagram-reel.mjs";

const title =
  "Dragon Ball Super: Beerus divulga vídeos completos de abertura e encerramento após estreia do anime";

const article =
  "Dragon Ball Super: Beerus ganhou os vídeos oficiais de abertura e encerramento sem créditos, disponibilizados após a estreia do anime na televisão japonesa em 11 de outubro de 2026. " +
  "O material foi destacado pela imprensa especializada em 12 de outubro e já aparece na seção de vídeos do site oficial da produção. " +
  "A novidade permite assistir às sequências completas, acompanhadas das músicas escolhidas para esta nova versão de Dragon Ball Super. " +
  "Diferentemente dos trailers divulgados anteriormente, os vídeos apresentam especificamente as animações utilizadas na abertura e no encerramento dos episódios.\n\n" +
  "A abertura utiliza a música ONOGAMI, interpretada por MEGATERA・ZERO, e apresenta diferentes momentos da trajetória de Son Goku. " +
  "A sequência percorre fases de sua evolução, desde a infância até transformações como Super Saiyajin God e Super Saiyajin Blue. " +
  "Beerus, o Deus da Destruição, também recebe destaque, reforçando sua importância para a história. " +
  "O encerramento utiliza Kan Peki no Peki, de Vicke Blanka, e apresenta uma abordagem visual diferente, com Shenlong ocupando uma posição central. " +
  "As duas sequências foram disponibilizadas separadamente, permitindo observar suas animações sem a sobreposição dos créditos de produção.\n\n" +
  "Dragon Ball Super: Beerus estreou em 11 de outubro na Fuji TV e apresenta uma versão aprimorada da história originalmente exibida em Dragon Ball Super. " +
  "A produção incorpora cenas refeitas, novos trechos de animação e alterações na organização narrativa. " +
  "O primeiro episódio acompanha o despertar de Beerus depois de um longo período de sono, enquanto Goku e seus companheiros vivem os anos posteriores à derrota de Majin Boo. " +
  "No Japão, a distribuição digital começou em 12 de outubro por serviços como Prime Video e U-NEXT. " +
  "As datas e plataformas internacionais devem ser verificadas separadamente. " +
  "Os vídeos oficiais de abertura e encerramento são os materiais recomendados para ilustrar esta atualização, pois representam o desenvolvimento novo em relação às notícias anteriores sobre a estreia.";

const hashtags = [
  "#dragonballsuper",
  "#dragonball",
  "#beerus",
  "#anime",
  "#bagacastudios",
];

test("container social persistido ignora candidatos historicos acima de 2200 caracteres", () => {
  const social = buildBagacaSocialCaptionFromArticle({
    title,
    article,
    hashtags,
  });

  assert.equal(social.caption_length, 768);
  assert.equal(
    social.caption_sha256,
    "32bfd128df8b8cc49e4bcb54ec2e4e828fe0ed0eaca7476fb6b48113f06bb5d5"
  );

  const result = buildGroupInstagramReelCaption({
    title,
    article,
    hashtags,
    group: [
      {
        instagram_parent_container_id: "18132668015494545",
        instagram_caption_sha256: social.caption_sha256,
      },
      {
        instagram_parent_container_id: "18132668015494545",
        instagram_caption_sha256: social.caption_sha256,
      },
    ],
  });

  assert.equal(result.caption_sha256, social.caption_sha256);
  assert.equal(result.caption_length, 768);
});
