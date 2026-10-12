import test from "node:test";
import assert from "node:assert/strict";

import { repairMissingPublicationGroup } from "../lib/publication-group-repair.mjs";
import repairHandler from "../api/repair-publication-group.js";

const groupId = "11111111-1111-4111-8111-111111111111";

function safeRows(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    noticia_id: 7,
    publication_group_id: groupId,
    carousel_position: index + 1,
    status: "APROVADO",
    published_at: null,
    instagram_post_id: null,
    youtube_video_id: null,
  }));
}

function response() {
  return {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    },
    setHeader() {},
  };
}

test("repair helper accepts only one or two safe approved rows", async () => {
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: safeRows(2), error: null };
    },
  };

  const result = await repairMissingPublicationGroup({
    supabase,
    noticiaId: 7,
    requestedGroupId: groupId,
  });

  assert.equal(result.publication_group_id, groupId);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(calls, [
    {
      name: "repair_missing_publication_group",
      args: {
        p_noticia_id: 7,
        p_requested_group_id: groupId,
      },
    },
  ]);
});

test("repair helper rejects malformed or ambiguous results", async () => {
  await assert.rejects(
    () =>
      repairMissingPublicationGroup({
        supabase: { rpc: async () => ({ data: [], error: null }) },
        noticiaId: 7,
        requestedGroupId: groupId,
      }),
    /quantidade inesperada/
  );

  await assert.rejects(
    () =>
      repairMissingPublicationGroup({
        supabase: {
          rpc: async () => ({
            data: [
              {
                ...safeRows(1)[0],
                published_at: "2026-10-12T00:00:00Z",
              },
            ],
            error: null,
          }),
        },
        noticiaId: 7,
        requestedGroupId: groupId,
      }),
    /grupo seguro/
  );
});

test("repair endpoint is disabled by default before any database access", async () => {
  const keys = [
    "WIREGEEK_PUBLICATION_REPAIR_ENABLED",
    "WIREGEEK_AUTOMATION_KEY",
    "WIREGEEK_ACCESS_KEY",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    delete process.env.WIREGEEK_PUBLICATION_REPAIR_ENABLED;
    process.env.WIREGEEK_AUTOMATION_KEY = "repair-test-key";
    process.env.WIREGEEK_ACCESS_KEY = "";

    const req = {
      method: "POST",
      headers: {
        "x-wiregeek-automation-key": "repair-test-key",
      },
      body: {
        noticia_id: 7,
      },
    };

    const res = response();
    await repairHandler(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.data.code, "PUBLICATION_REPAIR_DISABLED");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
