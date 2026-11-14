import assert from "node:assert/strict";
import test from "node:test";

import { cleanupOldStorage } from "../lib/storage-cleanup.mjs";

const DAY = 24 * 36e5;
const now = Date.parse("2026-11-14T12:00:00Z");

function fakeSupabase(tree) {
  const removed = [];
  const client = {
    storage: {
      from: () => ({
        list: async (folder, { offset, limit }) => ({ data: (tree[folder] ?? []).slice(offset, offset + limit), error: null }),
        remove: async (paths) => {
          removed.push(...paths);
          return { error: null };
        },
      }),
    },
  };
  return { client, removed };
}

const file = (name, ageDays, size = 1048576) => ({
  id: name,
  name,
  created_at: new Date(now - ageDays * DAY).toISOString(),
  metadata: { size },
});

test("apaga só arquivos mais antigos que o prazo, na raiz e em instagram-reels", async () => {
  const { client, removed } = fakeSupabase({
    "": [file("velho.png", 90), file("novo.png", 5), { name: "instagram-reels", id: null }],
    "instagram-reels": [file("a.mp4", 70, 2097152), file("b.mp4", 10)],
  });
  const summary = await cleanupOldStorage(client, { days: 60, now });
  assert.deepEqual(removed, ["velho.png", "instagram-reels/a.mp4"]);
  assert.equal(summary["(raiz)"].removed, 1);
  assert.equal(summary["(raiz)"].kept, 1);
  assert.equal(summary["instagram-reels"].bytes, 2097152);
});

test("dry run só conta e não apaga", async () => {
  const { client, removed } = fakeSupabase({ "": [file("velho.png", 90)], "instagram-reels": [] });
  const summary = await cleanupOldStorage(client, { days: 60, now, dryRun: true });
  assert.deepEqual(removed, []);
  assert.equal(summary["(raiz)"].removed, 1);
});

test("ignora arquivo sem data", async () => {
  const { client, removed } = fakeSupabase({ "": [{ id: "x", name: "sem-data.png", metadata: {} }], "instagram-reels": [] });
  await cleanupOldStorage(client, { days: 60, now });
  assert.deepEqual(removed, []);
});
