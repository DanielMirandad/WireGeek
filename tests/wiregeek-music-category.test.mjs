import test from "node:test";
import assert from "node:assert/strict";
import {
  WIREGEEK_CATEGORIES,
  normalizeWireGeekCategory,
  isWireGeekCategory,
} from "../lib/wiregeek-categories.mjs";
import { readFileSync } from "node:fs";

test("musica e uma categoria canonica do WireGeek", () => {
  assert.ok(WIREGEEK_CATEGORIES.includes("musica"));
  assert.equal(normalizeWireGeekCategory("musica"), "musica");
  assert.equal(normalizeWireGeekCategory("Música"), "musica");
  assert.equal(normalizeWireGeekCategory("music"), "musica");
  assert.equal(isWireGeekCategory("musica"), true);
});

test("renderer possui label para musica", () => {
  const source = readFileSync(
    new URL("../lib/banner-renderer-briefing.mjs", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /musica:\s*"MUSICA"/
  );
});

test("prompt editorial contempla musica", () => {
  const source = readFileSync(
    new URL("../lib/wiregeek-contract.mjs", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /-\s*musica\./i
  );
});