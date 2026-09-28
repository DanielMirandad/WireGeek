import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveBriefingBannerImages,
} from "../lib/banner-images-briefing.mjs";

function request() {
  return {
    mode: "briefing",
    titulo: "Notícia de teste",
    titulo_curto: "TESTE",
    source_urls: [
      "https://example.com/noticia",
    ],
    banners: [
      {
        type: "editorial",
        index: 0,
        banner_title: "TESTE",
        highlight:
          "Primeiro highlight editorial factual para validar o resolvedor de imagens.",
      },
      {
        type: "editorial",
        index: 1,
        banner_title: "TESTE",
        highlight:
          "Segundo highlight editorial factual para validar uma imagem diferente.",
      },
    ],
  };
}

const first = {
  url: "https://img.example.com/1.jpg",
};

const second = {
  url: "https://img.example.com/2.jpg",
};

test(
  "retorna duas imagens quando os dois banners possuem imagens distintas",
  async () => {
    let calls = 0;

    const result =
      await resolveBriefingBannerImages(
        request(),
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
          verifyPair:
            async () => [
              first,
              second,
            ],
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
  "retorna somente a primeira imagem quando a segunda nao pode ser resolvida",
  async () => {
    let calls = 0;

    const result =
      await resolveBriefingBannerImages(
        request(),
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
          verifyPair:
            async () => {
              throw new Error(
                "nao deveria verificar"
              );
            },
        }
      );

    assert.deepEqual(
      result,
      [first]
    );

    assert.equal(
      calls,
      3,
      "deve tentar resolver o segundo banner duas vezes"
    );
  }
);

test(
  "falha quando a primeira imagem nao pode ser resolvida",
  async () => {
    await assert.rejects(
      () =>
        resolveBriefingBannerImages(
          request(),
          {
            collectSourceImages:
              async () => [],
            resolveOneBanner:
              async () => {
                throw new Error(
                  "nenhuma imagem"
                );
              },
            verifyPair:
              async () => null,
          }
        ),
      /nenhuma imagem/
    );
  }
);

test(
  "rejeita o primeiro candidato do segundo banner quando o par e semelhante e tenta outro",
  async () => {
    const duplicate = {
      url:
        "https://img.example.com/duplicate.jpg",
    };

    let calls = 0;
    let pairChecks = 0;

    const result =
      await resolveBriefingBannerImages(
        request(),
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
          verifyPair:
            async (
              left,
              right
            ) => {
              pairChecks += 1;

              if (
                right.url ===
                duplicate.url
              ) {
                return null;
              }

              return [
                left,
                right,
              ];
            },
        }
      );

    assert.deepEqual(
      result,
      [first, second]
    );

    assert.equal(pairChecks, 2);
    assert.equal(calls, 3);
  }
);

test(
  "exige exatamente dois banners editoriais no contrato de entrada",
  async () => {
    const invalid = request();

    invalid.banners =
      invalid.banners.slice(0, 1);

    await assert.rejects(
      () =>
        resolveBriefingBannerImages(
          invalid,
          {}
        ),
      /exatamente 2 banners editoriais/
    );
  }
);