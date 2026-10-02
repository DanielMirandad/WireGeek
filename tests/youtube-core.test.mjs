import test from "node:test";
import assert from "node:assert/strict";

import {
  checkGroup,
} from "../lib/youtube-core.mjs";

const GROUP_ID =
  "2a300e77-f12c-4c74-b423-3814a4c5f956";

function row(position, overrides = {}) {
  return {
    carousel_position: position,
    publication_group_id: GROUP_ID,
    noticia_id: 361,
    cta_url: "https://example.com/cta.png",
    status: "APROVADO",
    ...overrides,
  };
}

test("checkGroup aceita 1 editorial aprovado", () => {
  const result =
    checkGroup([row(1)], GROUP_ID);

  assert.equal(result.length, 1);
  assert.equal(result[0].carousel_position, 1);
});

test("checkGroup aceita 2 editoriais aprovados", () => {
  const result =
    checkGroup(
      [row(2), row(1)],
      GROUP_ID
    );

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map(item => item.carousel_position),
    [1, 2]
  );
});

test("checkGroup aceita editorial publicado", () => {
  const result =
    checkGroup(
      [
        row(1, {
          status: "PUBLICADO",
        }),
      ],
      GROUP_ID
    );

  assert.equal(result.length, 1);
});

test("checkGroup rejeita grupo vazio", () => {
  assert.throws(
    () => checkGroup([], GROUP_ID),
    /Grupo editorial inválido/
  );
});

test("checkGroup rejeita mais de 2 editoriais", () => {
  assert.throws(
    () =>
      checkGroup(
        [row(1), row(2), row(3)],
        GROUP_ID
      ),
    /Grupo editorial inválido/
  );
});

test("checkGroup rejeita posições não consecutivas", () => {
  assert.throws(
    () =>
      checkGroup(
        [row(2)],
        GROUP_ID
      ),
    /grupo editorial válido/i
  );
});

test("checkGroup rejeita notícias divergentes", () => {
  assert.throws(
    () =>
      checkGroup(
        [
          row(1),
          row(2, {
            noticia_id: 999,
          }),
        ],
        GROUP_ID
      ),
    /grupo editorial válido/i
  );
});

test("checkGroup rejeita CTA divergente", () => {
  assert.throws(
    () =>
      checkGroup(
        [
          row(1),
          row(2, {
            cta_url:
              "https://example.com/outro.png",
          }),
        ],
        GROUP_ID
      ),
    /grupo editorial válido/i
  );
});
