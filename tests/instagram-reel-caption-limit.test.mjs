import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildInstagramReelCaption, buildGroupInstagramReelCaption } from "../lib/instagram-reel.mjs";

const hashtags = ["#games", "#geek", "#noticias", "#reels", "#bagacastudios"];

test("new Reel trims only article to fit 2200 characters", () => {
  const article = ("Notícia verificada sobre um lançamento anunciado oficialmente. ").repeat(45);
  const result = buildInstagramReelCaption({ article, hashtags, profileUsernames: ["bagacastudios"] });
  assert.ok(result.caption_length <= 2200);
  assert.ok(result.caption.includes("Leia a matéria completa no nosso site\nLink na Bio\n\nCURTE E COMPARTILHA!"));
  assert.ok(result.caption.includes("Perfis: @bagacastudios"));
  assert.ok(result.caption.endsWith(hashtags.join(" ")));
  assert.ok(result.caption.includes("…"));
  assert.equal(result.caption_sha256.length, 64);
});

test("short Reel article is preserved", () => {
  const article = "Texto editorial curto.";
  const result = buildInstagramReelCaption({ article, hashtags });
  assert.ok(result.caption.startsWith(article + "\n\n"));
  assert.equal(result.caption_length, result.caption.length);
});

test("new group without container applies same caption limit", () => {
  const result = buildGroupInstagramReelCaption({
    article: "Matéria sobre videogames. ".repeat(150),
    hashtags,
    group: [{ instagram_parent_container_id: null }],
  });
  assert.ok(result.caption_length <= 2200);
});


test("historical container with a valid long caption is matched without applying new limit", () => {
  const article = "Noticia historica sobre jogos e lancamentos. ".repeat(54);
  const footer = [
    "---",
    "Estaremos acompanhando tudo e traremos as informações até vocês.",
    "SEGUE A GENTE, COMPARTILHA E COMENTA!",
    "LIVES TODOS OS SÁBADOS!!",
    "https://www.twitch.tv/bagacacast_lives",
    "https://youtube.com/@bagacastudios",
    "REDES SOCIAIS:",
    "Instagram: @bagacastudios",
    "Youtube: @bagacastudios",
    "SEJA VIP:",
    "https://linktr.ee/Bagacacast",
    "CANAL DE CORTES:",
    "https://www.youtube.com/@CortesBCastOficial",
  ].join("\n");
  const caption = [article.trim(), footer, hashtags.join(" ")].join("\n\n");
  assert.ok(caption.length > 2200);
  const hash = createHash("sha256").update(caption, "utf8").digest("hex");
  const result = buildGroupInstagramReelCaption({
    article, hashtags,
    group: [{ instagram_parent_container_id: "existing-container", instagram_caption_sha256: hash }],
  });
  assert.equal(result.caption, caption);
  assert.equal(result.caption_sha256, hash);
});
