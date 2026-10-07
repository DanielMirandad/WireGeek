import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  resolveBriefingBannerImages,
} from "../lib/banner-images-briefing.mjs";

import {
  searchImageCandidates,
} from "../lib/shared/banner-images.mjs";

import {
  applyManualBannerImages,
} from "../src/briefing/briefing-banner-contract.js";

import {
  APPROVED_BANNER_MODEL,
  measureApprovedVisualTitle,
  validateApprovedVisualTitleWidth,
} from "../lib/banner-renderer-briefing.mjs";
import { deriveFittingBannerVisualTitle } from "../lib/banner-title-briefing.mjs";

test("gerador de titulo visual compila como modulo JavaScript", () => {
  const check = spawnSync(process.execPath, ["--check", "lib/banner-title-briefing.mjs"], {
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr);
});

test("modelo aprovado mantem dimensoes, cores e tracking legivel", () => {
  const m = APPROVED_BANNER_MODEL;
  assert.equal(m.width, 1080);
  assert.equal(m.height, 1350);
  assert.equal(m.aspectRatio, "4:5");
  assert.equal(m.colors.orange, "#FF9700");
  assert.equal(m.thematicTitle.mainLetterSpacing, 2);
  assert.equal(m.thematicTitle.mainFontSize, 108);
  assert.equal(m.thematicTitle.themeFontSize, 72);
  assert.equal(m.editorial.fontSize, 44);
  assert.equal(m.brand.nameFontSize, 31);
});

test("valida largura real das duas linhas sem alterar o template", async () => {
  const model = APPROVED_BANNER_MODEL;
  const compact = await validateApprovedVisualTitleWidth("WARHAMMER", "SURVIVORS");
  assert.ok(compact.title_main <= model.thematicTitle.maxWidth);
  assert.ok(compact.title_theme <= model.thematicTitle.maxWidth);
  const long = await measureApprovedVisualTitle("WARHAMMER SURVIVORS", "SURVIVORS");
  assert.ok(long.title_main > compact.title_main);
  assert.equal(model.thematicTitle.mainFontSize, 108);
  assert.equal(model.thematicTitle.mainLetterSpacing, 2);
});

test("reprocessa somente titulo visual apos erro real de largura", async () => {
  const tried = [];
  const result = await deriveFittingBannerVisualTitle({ titulo: "Teste" }, {
    generate: async (_item, opts) => {
      tried.push(opts);
      return tried.length === 1
        ? { title_main: "LONGO", title_theme: "TEMA" }
        : { title_main: "CURTO", title_theme: "TEMA" };
    },
    validate: async main => {
      if (main === "LONGO") {
        throw Object.assign(new Error("TITLE_MAIN_TOO_LONG: 1200px"), {
          code: "TITLE_MAIN_TOO_LONG",
        });
      }
    },
  });
  assert.equal(result.title_main, "CURTO");
  assert.equal(tried.length, 2);
  assert.match(tried[1].layoutFeedback, /TITLE_MAIN_TOO_LONG/);
});

test("interrompe apos duas tentativas sem modificar texto canonico", async () => {
  const item = { titulo: "Titulo completo original" };
  let calls = 0;
  await assert.rejects(
    deriveFittingBannerVisualTitle(item, {
      generate: async () => {
        calls++;
        return { title_main: "MUITO LONGO", title_theme: "TEMA" };
      },
      validate: async () => {
        throw Object.assign(new Error("TITLE_MAIN_TOO_LONG"), {
          code: "TITLE_MAIN_TOO_LONG",
        });
      },
    }),
    /TITLE_MAIN_TOO_LONG/
  );
  assert.equal(calls, 2);
  assert.equal(item.titulo, "Titulo completo original");
});

function makeRequest() {
  return {
    mode: "briefing",
    titulo: "Noticia de teste",
    titulo_curto: "TESTE",
    source_urls: [],
    banners: [
      {
        type: "editorial",
        index: 0,
        banner_title: "TESTE",
        highlight:
          "Primeiro highlight factual usado no teste do resolvedor.",
      },
      {
        type: "editorial",
        index: 1,
        banner_title: "TESTE",
        highlight:
          "Segundo highlight factual usado no teste do resolvedor.",
      },
    ],
  };
}

function fp(id) {
  return {
    width: 1200,
    height: 1600,
    exactHash: id,
    fullHash: id,
    cropHash: id,
  };
}

function image(url, id) {
  return {
    url,
    imageBuffer:
      Buffer.from("buffer-" + id),
    fingerprint: fp(id),
  };
}

const first =
  image(
    "https://img.example.com/1.jpg",
    "first"
  );

const second =
  image(
    "https://img.example.com/2.jpg",
    "second"
  );

test(
  "retorna duas imagens editoriais distintas",
  async () => {
    let calls = 0;

    const result =
      await resolveBriefingBannerImages(
        makeRequest(),
        {
          collectSourceImages:
            async () => [],
          resolveOneBanner:
            async () => {
              calls += 1;
              return calls === 1
                ? first
                : second;
            },
          sameImage:
            () => false,
        }
      );

    assert.deepEqual(
      result,
      [first, second]
    );

    assert.equal(calls, 2);
  }
);

test(
  "mantem resultado parcial quando somente a primeira imagem existe",
  async () => {
    let calls = 0;

    const result =
      await resolveBriefingBannerImages(
        makeRequest(),
        {
          collectSourceImages:
            async () => [],
          resolveOneBanner:
            async () => {
              calls += 1;

              if (calls === 1) {
                return first;
              }

              throw new Error(
                "segunda indisponivel"
              );
            },
          sameImage:
            () => false,
        }
      );

    assert.deepEqual(
      result,
      [first]
    );

    assert.equal(calls, 3);
  }
);

test(
  "falha quando a primeira imagem nao existe",
  async () => {
    await assert.rejects(
      () =>
        resolveBriefingBannerImages(
          makeRequest(),
          {
            collectSourceImages:
              async () => [],
            resolveOneBanner:
              async () => {
                throw new Error(
                  "nenhuma imagem"
                );
              },
          }
        ),
      /nenhuma imagem/
    );
  }
);

test(
  "rejeita segunda imagem semelhante e tenta outra",
  async () => {
    const duplicate =
      image(
        "https://img.example.com/duplicate.jpg",
        "duplicate"
      );

    let calls = 0;
    let comparisons = 0;

    const result =
      await resolveBriefingBannerImages(
        makeRequest(),
        {
          collectSourceImages:
            async () => [],
          resolveOneBanner:
            async ({
              blockedUrls,
            }) => {
              calls += 1;

              if (calls === 1) {
                return first;
              }

              if (
                !blockedUrls.has(
                  duplicate.url
                )
              ) {
                return duplicate;
              }

              return second;
            },
          sameImage:
            (left, right) => {
              comparisons += 1;

              return (
                right ===
                duplicate.fingerprint
              );
            },
        }
      );

    assert.deepEqual(
      result,
      [first, second]
    );

    assert.equal(calls, 3);
    assert.equal(comparisons, 2);
  }
);

test(
  "baixa uma vez, valida o buffer e preserva buffer e fingerprint",
  async () => {
    const urls = [
      "https://img.example.com/real-1.jpg",
      "https://img.example.com/real-2.jpg",
    ];

    const request =
      makeRequest();

    request.banners[0].image_url =
      urls[0];

    request.banners[1].image_url =
      urls[1];

    const originals = new Map([
      [
        urls[0],
        image(urls[0], "real-1"),
      ],
      [
        urls[1],
        image(urls[1], "real-2"),
      ],
    ]);

    const downloaded = [];
    const validated = [];

    const result =
      await resolveBriefingBannerImages(
        request,
        {
          collectSourceImages:
            async () => [],

          downloadImage:
            async (url) => {
              downloaded.push(url);

              const current =
                originals.get(url);

              assert.ok(current);

              return current;
            },

          validateVisualCandidates:
            async ({
              images,
            }) => {
              assert.equal(
                images.length,
                1
              );

              assert.ok(
                Buffer.isBuffer(
                  images[0].imageBuffer
                )
              );

              validated.push(
                images[0]
              );

              return {
                distinct: true,
                images: [
                  {
                    index: 0,
                    approved: true,
                    reason: "ok",
                  },
                ],
              };
            },

          sameImage:
            () => false,
        }
      );

    assert.deepEqual(
      downloaded,
      urls
    );

    assert.equal(
      validated.length,
      2
    );

    assert.equal(
      result.length,
      2
    );

    assert.strictEqual(
      result[0].imageBuffer,
      originals.get(urls[0])
        .imageBuffer
    );

    assert.strictEqual(
      result[0].fingerprint,
      originals.get(urls[0])
        .fingerprint
    );

    assert.strictEqual(
      result[1].imageBuffer,
      originals.get(urls[1])
        .imageBuffer
    );

    assert.strictEqual(
      result[1].fingerprint,
      originals.get(urls[1])
        .fingerprint
    );

    assert.equal(
      downloaded.length,
      2
    );
  }
);

test(
  "exige exatamente dois banners editoriais",
  async () => {
    const request =
      makeRequest();

    request.banners =
      request.banners.slice(0, 1);

    await assert.rejects(
      () =>
        resolveBriefingBannerImages(
          request
        ),
      /exatamente 2 banners editoriais/
    );
  }
);

test('rejects duplicate pixels before vision and selects a different image', async () => {
  const request = makeRequest();
  const duplicate = image('https://img.example.com/same-pixels.jpg', 'same');
  request.banners[0].image_url = first.url;
  request.banners[1].image_candidates = [duplicate.url,second.url];
  const validated = [];
  const result = await resolveBriefingBannerImages(request, {
    collectSourceImages: async () => [],
    downloadImage: async url => new Map([[first.url,first],[duplicate.url,duplicate],[second.url,second]]).get(url),
    validateVisualCandidates: async ({images}) => { validated.push(images[0].url); },
    sameImage: (_left,right) => right === duplicate.fingerprint,
  });
  assert.deepEqual(result.map(item=>item.url),[first.url,second.url]);
  assert.deepEqual(validated,[first.url,second.url]);
});

test('same source image is downloaded once even when distinct editorial contexts review it', async () => {
  const request = makeRequest();
  request.banners[0].image_candidates = [second.url,first.url];
  request.banners[1].image_url = second.url;
  let downloads = 0, reviews = 0;
  const result = await resolveBriefingBannerImages(request, {
    collectSourceImages: async () => [],
    downloadImage: async url => { downloads++; return url === first.url ? first : second; },
    validateVisualCandidates: async ({images,highlights}) => {
      reviews++;
      if (images[0].url === second.url && highlights[0].startsWith('Primeiro')) throw new Error('wrong editorial context');
    },
    sameImage: () => false,
  });
  assert.equal(downloads,2);
  assert.equal(reviews,3);
  assert.deepEqual(result.map(item=>item.url),[first.url,second.url]);
});



test(
  "normaliza Tn somente para consultas de imagem",
  async () => {
    const {
      normalizeImageSearchQuery,
    } = await import(
      "../lib/banner-images-briefing.mjs"
    );

    assert.equal(
      normalizeImageSearchQuery("Serie T1"),
      "Serie temporada 1"
    );

    assert.equal(
      normalizeImageSearchQuery("Wednesday T3"),
      "Wednesday temporada 3"
    );

    assert.equal(
      normalizeImageSearchQuery(
        "Black Clover t2"
      ),
      "Black Clover temporada 2"
    );

    assert.equal(
      normalizeImageSearchQuery("Anime T10"),
      "Anime temporada 10"
    );

    assert.equal(
      normalizeImageSearchQuery(
        "Wednesday T3 official press"
      ),
      "Wednesday temporada 3 official press"
    );

    assert.equal(
      normalizeImageSearchQuery("AT3"),
      "AT3"
    );

    assert.equal(
      normalizeImageSearchQuery("T3X"),
      "T3X"
    );

    const canonical = {
      titulo_curto: "Wednesday T3",
    };

    normalizeImageSearchQuery(
      canonical.titulo_curto
    );

    assert.equal(
      canonical.titulo_curto,
      "Wednesday T3"
    );
  }
);


test(
  "busca aceita season como equivalente de temporada",
  async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          images_results: [
            {
              original:
                "https://img.example.com/wednesday-season-3.jpg",
              link:
                "https://example.com/wednesday",
              title:
                "Wednesday Season 3 first look",
              original_width: 1600,
              original_height: 900,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type":
              "application/json",
          },
        }
      );

    const result =
      await searchImageCandidates(
        "Wednesday temporada 3",
        {
          apiKey: "test-key",
          fetchImpl,
          semanticQuery:
            "Wednesday temporada 3",
        }
      );

    assert.equal(
      result.length,
      1
    );
  }
);

test(
  "busca rejeita numero de temporada diferente",
  async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          images_results: [
            {
              original:
                "https://img.example.com/wednesday-season-2.jpg",
              link:
                "https://example.com/wednesday",
              title:
                "Wednesday Season 2 first look",
              original_width: 1600,
              original_height: 900,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type":
              "application/json",
          },
        }
      );

    const result =
      await searchImageCandidates(
        "Wednesday temporada 3",
        {
          apiKey: "test-key",
          fetchImpl,
          semanticQuery:
            "Wednesday temporada 3",
        }
      );

    assert.equal(
      result.length,
      0
    );
  }
);

test(
  "busca protege temporadas 1 e 10",
  async () => {
    async function run(
      query,
      title,
      url
    ) {
      const fetchImpl = async () =>
        new Response(
          JSON.stringify({
            images_results: [
              {
                original: url,
                link:
                  "https://example.com/serie",
                title,
                original_width: 1600,
                original_height: 900,
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json",
            },
          }
        );

      return searchImageCandidates(
        query,
        {
          apiKey: "test-key",
          fetchImpl,
          semanticQuery: query,
        }
      );
    }

    const t1 =
      await run(
        "Serie temporada 1",
        "Serie Season 1 official still",
        "https://img.example.com/serie-season-1.jpg"
      );

    const t1Wrong =
      await run(
        "Serie temporada 1",
        "Serie Season 2 official still",
        "https://img.example.com/serie-season-2.jpg"
      );

    const t10 =
      await run(
        "Serie temporada 10",
        "Serie Season 10 official still",
        "https://img.example.com/serie-season-10.jpg"
      );

    const t10Wrong =
      await run(
        "Serie temporada 10",
        "Serie Season 1 official still",
        "https://img.example.com/serie-season-1-wrong.jpg"
      );

    assert.equal(t1.length, 1);
    assert.equal(t1Wrong.length, 0);
    assert.equal(t10.length, 1);
    assert.equal(t10Wrong.length, 0);
  }
);


test(
  "imagem manual tem prioridade sem alterar o modo automatico",
  () => {
    const original = {
      mode: "briefing",
      noticia_id: 123,
      banners: [
        {
          type: "editorial",
          image_url:
            "https://auto.example.com/1.jpg",
        },
        {
          type: "editorial",
          image_url:
            "https://auto.example.com/2.jpg",
        },
      ],
    };

    const result =
      applyManualBannerImages(
        original,
        [
          "https://manual.example.com/1.jpg",
          "",
        ]
      );

    assert.equal(
      result.banners[0].image_url,
      "https://manual.example.com/1.jpg"
    );

    assert.equal(
      result.banners[0].manual_image_override,
      true
    );

    assert.equal(
      result.banners[1].manual_image_override,
      false
    );

    assert.equal(
      result.banners[1].image_url,
      "https://auto.example.com/2.jpg"
    );

    assert.equal(
      original.banners[0].image_url,
      "https://auto.example.com/1.jpg"
    );

    assert.throws(
      () =>
        applyManualBannerImages(
          original,
          [
            "arquivo-local.jpg",
            "",
          ]
        ),
      /URL http ou https/
    );
  }
);


test(
  "imagem manual ignora Vision mas mantem validacoes tecnicas",
  async () => {
    const request =
      makeRequest();

    request.banners[0].image_url =
      "https://img.example.com/manual.jpg";

    request.banners[0].manual_image_override =
      true;

    request.banners[1].image_url =
      "https://img.example.com/automatic.jpg";

    const visualCalls = [];

    const result =
      await resolveBriefingBannerImages(
        request,
        {
          collectSourceImages:
            async () => [],

          downloadImage:
            async (url) =>
              image(
                url,
                url.includes("manual")
                  ? "manual"
                  : "automatic"
              ),

          validateVisualCandidates:
            async ({ images }) => {
              visualCalls.push(
                images[0].url
              );
            },

          sameImage:
            () => false,
        }
      );

    assert.equal(
      result[0].url,
      "https://img.example.com/manual.jpg"
    );

    assert.equal(
      result[1].url,
      "https://img.example.com/automatic.jpg"
    );

    assert.deepEqual(
      visualCalls,
      [
        "https://img.example.com/automatic.jpg",
      ]
    );
  }
);

test(
  "imagem manual invalida nao cai para busca automatica",
  async () => {
    const request =
      makeRequest();

    request.banners[0].image_url =
      "https://img.example.com/manual-fail.jpg";

    request.banners[0].manual_image_override =
      true;

    await assert.rejects(
      () =>
        resolveBriefingBannerImages(
          request,
          {
            collectSourceImages:
              async () => [
                {
                  url:
                    "https://img.example.com/fallback.jpg",
                },
              ],

            downloadImage:
              async (url) => {
                if (
                  url.includes(
                    "manual-fail"
                  )
                ) {
                  throw new Error(
                    "download falhou"
                  );
                }

                return image(
                  url,
                  "fallback"
                );
              },

            validateVisualCandidates:
              async () => {},

            sameImage:
              () => false,
          }
        ),
      /Imagem manual rejeitada/
    );
  }
);


test(
  "imagem manual nao cai para image_candidates automaticos",
  async () => {
    const request =
      makeRequest();

    request.banners[0].image_url =
      "https://img.example.com/manual-fail.jpg";

    request.banners[0].manual_image_override =
      true;

    request.banners[0].image_candidates = [
      {
        url:
          "https://img.example.com/automatic-explicit.jpg",
      },
    ];

    const downloaded = [];

    await assert.rejects(
      () =>
        resolveBriefingBannerImages(
          request,
          {
            collectSourceImages:
              async () => [],

            downloadImage:
              async (url) => {
                downloaded.push(url);

                if (
                  url.includes(
                    "manual-fail"
                  )
                ) {
                  throw new Error(
                    "download manual falhou"
                  );
                }

                return image(
                  url,
                  "automatic-explicit"
                );
              },

            validateVisualCandidates:
              async () => {},

            sameImage:
              () => false,
          }
        ),
      /Imagem manual rejeitada/
    );

    assert.deepEqual(
      downloaded,
      [
        "https://img.example.com/manual-fail.jpg",
      ]
    );
  }
);
