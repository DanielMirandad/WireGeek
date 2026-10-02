import test from "node:test";
import assert from "node:assert/strict";

import {
  FIXED_INSTAGRAM_PROFILES,
  previewInstagramProfiles,
} from "../lib/instagram-profiles.mjs";

function createRow(overrides = {}) {
  return {
    status: "APROVADO",
    published_at: null,
    instagram_post_id: null,
    instagram_parent_container_id: null,
    instagram_caption_sha256: null,
    instagram_status: null,
    noticias: {
      artigo:
        "Nintendo anuncia novidades para games e Nintendo Switch 2.",
    },
    ...overrides,
  };
}

test("previewInstagramProfiles aceita 1 editorial valido", () => {
  const result =
    previewInstagramProfiles([
      createRow(),
    ]);

  assert.ok(Array.isArray(result));

  for (const username of FIXED_INSTAGRAM_PROFILES) {
    assert.ok(result.includes(username));
  }

  assert.ok(
    result.includes("nintendoamerica")
  );
});

test("previewInstagramProfiles aceita 2 editoriais validos", () => {
  const result =
    previewInstagramProfiles([
      createRow(),
      createRow(),
    ]);

  assert.ok(Array.isArray(result));

  for (const username of FIXED_INSTAGRAM_PROFILES) {
    assert.ok(result.includes(username));
  }
});

test("previewInstagramProfiles rejeita grupo vazio", () => {
  assert.equal(
    previewInstagramProfiles([]),
    null
  );
});

test("previewInstagramProfiles rejeita mais de 2 editoriais", () => {
  assert.equal(
    previewInstagramProfiles([
      createRow(),
      createRow(),
      createRow(),
    ]),
    null
  );
});

test("previewInstagramProfiles rejeita grupo ja publicado", () => {
  assert.equal(
    previewInstagramProfiles([
      createRow({
        status: "PUBLICADO",
        published_at:
          "2026-10-02T20:08:35.646Z",
        instagram_post_id:
          "18627300898021650",
        instagram_status:
          "PUBLICADO",
      }),
    ]),
    null
  );
});

test("previewInstagramProfiles rejeita grupo com container existente", () => {
  assert.equal(
    previewInstagramProfiles([
      createRow({
        instagram_parent_container_id:
          "18131347568494545",
      }),
    ]),
    null
  );
});