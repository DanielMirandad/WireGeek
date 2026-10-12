import test from "node:test";
import assert from "node:assert/strict";

import { shortenEditorialDisplayCopy } from "../lib/banner-copy-recovery.mjs";

test("encurta somente a copy visual preservando pontuacao final", () => {
  assert.equal(
    shortenEditorialDisplayCopy(
      "Dragon Ball Super: Beerus disponibilizou abertura e encerramento sem créditos."
    ),
    "Dragon Ball Super: Beerus disponibilizou abertura e encerramento sem."
  );
});

test("nao encurta abaixo do minimo seguro", () => {
  assert.equal(
    shortenEditorialDisplayCopy("Texto curto aqui.", { minWords: 3 }),
    ""
  );
});

test("remove pontuacao intermediaria solta ao encurtar", () => {
  assert.equal(
    shortenEditorialDisplayCopy("Goku, Beerus e Shenlong aparecem juntos."),
    "Goku, Beerus e Shenlong aparecem."
  );
});
