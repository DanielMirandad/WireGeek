import test from "node:test";
import assert from "node:assert/strict";
import { buildInstagramReelCaption, buildGroupInstagramReelCaption } from "../lib/instagram-reel.mjs";

const hashtags = ["#games", "#geek", "#noticias", "#reels", "#bagacastudios"];

test("new Reel trims only article to fit 2200 characters", () => {
  const article = ("Notícia verificada sobre um lançamento anunciado oficialmente. ").repeat(45);
  const result = buildInstagramReelCaption({ article, hashtags, profileUsernames: ["bagacastudios"] });
  assert.ok(result.caption_length <= 2200);
  assert.ok(result.caption.includes("Confira a matéria completa no Bagaça Studios."));
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
