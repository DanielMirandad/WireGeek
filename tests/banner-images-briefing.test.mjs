import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveBriefingBannerImages,
} from "../lib/banner-images-briefing.mjs";

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
