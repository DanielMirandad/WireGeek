import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Hash,
  Newspaper,
  Radio,
  RefreshCw,
  Zap,
  ImageIcon,
  Calendar,
  FlaskConical,
} from "lucide-react";

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const TEMPLATE_DESIGN_ID = "DAHSAXUcxX4";

const LOCATORS = {
  pages: [
    {
      badge: "PBh0XHD7f51kGytW-LB8JLWDRlqf3zjVq",
      subtitle: "PBh0XHD7f51kGytW-LBt1zdTS5fdVJTjx",
      title: "PBh0XHD7f51kGytW-LBqCnTzmXzLqNWpD",
      image: "PBh0XHD7f51kGytW-LBcrH5XySKL6yNB8",
    },
    {
      badge: "PBFyZVcCQVwCb0d3-LBKvNPT8SJnDH1dH",
      subtitle: "PBFyZVcCQVwCb0d3-LBnqhzhh7z7GZ8jz",
      title: "PBFyZVcCQVwCb0d3-LB2MsMYr8xcXw1M1",
      image: "PBFyZVcCQVwCb0d3-LBd2pgL8y4n6Ns3V",
    },
    {
      badge: "PB4wYBY6qz0T0XRs-LBKNjYr8rfxC1y3H",
      subtitle: "PB4wYBY6qz0T0XRs-LBv71qJNWmMm4vCy",
      title: "PB4wYBY6qz0T0XRs-LBcrrR5z0Ynr61Zm",
      image: "PB4wYBY6qz0T0XRs-LBhHjmVCZhs6p0bf",
    },
    {
      badge: "PBVm2lDStJp1vY2K-LBSccwgKrvXSV2qc",
      subtitle: "PBVm2lDStJp1vY2K-LBhzgt6pqVSk6mmn",
      title: "PBVm2lDStJp1vY2K-LBr6s9x2J5KY9nBn",
      image: "PBVm2lDStJp1vY2K-LBn5H3KPYykqy4LL",
    },
  ],
  badgeOriginalText: "cinema",
};

const CATEGORY_LABEL = {
  games: "GAMES",
  geek: "GEEK",
  cinema: "CINEMA",
  anime: "ANIME",
};

const CATEGORY_COLOR = {
  games: "#E8002D",
  geek: "#7C3AED",
  cinema: "#D97706",
  anime: "#0EA5E9",
};

const CATEGORY_ORDER = ["games", "geek", "cinema", "anime"];
const NEWS_PER_CATEGORY = 3;
const TOTAL_NEWS = CATEGORY_ORDER.length * NEWS_PER_CATEGORY;

const RODAPE_FIXO = `___

Estaremos acompanhando tudo e traremos as informacoes ate voces.

SEGUE A GENTE, COMPARTILHA E COMENTA!

LIVES!!
https://www.twitch.tv/bagacacast_lives
https://youtube.com/@bagacastudios

REDES SOCIAIS:
Instagram: @bagacastudios
Tiktok: @bagacastudios
Youtube: https://youtube.com/@bagacastudios

SEJA VIP:
https://linktr.ee/Bagacacast`;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date();

  return `wire-geek:v3:${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function schedulerKey() {
  return "wire-geek:scheduler";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copyViaTextarea(text) {
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");

      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";

      document.body.appendChild(ta);
      ta.select();

      document.execCommand("copy")
        ? resolve()
        : reject(new Error("Falhou"));

      document.body.removeChild(ta);
    } catch (error) {
      reject(error);
    }
  });
}

function copyToClipboard(text) {
  if (
    navigator.clipboard &&
    window.isSecureContext
  ) {
    return navigator.clipboard
      .writeText(text)
      .catch(() => copyViaTextarea(text));
  }

  return copyViaTextarea(text);
}

async function fetchWithRetry(
  url,
  options,
  { attempts = 4, onRetry } = {}
) {
  let lastError;

  for (let i = 0; i < attempts; i++) {
    let response = null;

    try {
      response = await fetch(url, options);
    } catch (error) {
      lastError = error;
    }

    if (response?.ok) {
      return response;
    }

    const status = response?.status ?? null;

    const transient =
      status === 429 ||
      status === 503 ||
      status === 529 ||
      status === null;

    if (!transient || i === attempts - 1) {
      if (response) {
        return response;
      }

      throw (
        lastError ||
        new Error("Falha de rede.")
      );
    }

    const wait = Math.round(
      1000 * Math.pow(2, i) +
        Math.random() * 500
    );

    onRetry?.(
      status,
      i + 1,
      attempts,
      wait
    );

    await sleep(wait);
  }

  throw (
    lastError ||
    new Error(
      "Falha apos multiplas tentativas."
    )
  );
}

function estimateReading(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    words: words.length,
    minutes: Math.max(
      1,
      Math.round(words.length / 200)
    ),
  };
}

function removeDashes(str) {
  return String(str || "")
    .replace(/[—–]/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeNewsItem(item = {}) {
  return {
    categoria: String(
      item.categoria || "geek"
    ).toLowerCase(),

    titulo: removeDashes(
      item.titulo || "Sem titulo"
    ),

    publicado_em:
      item.publicado_em || "Ultimas 24h",

    materia: removeDashes(
      item.materia || ""
    ),

    highlights: Array.isArray(
      item.highlights
    )
      ? item.highlights
          .slice(0, 4)
          .map(removeDashes)
      : [],

    hashtags: Array.isArray(
      item.hashtags
    )
      ? item.hashtags
          .slice(0, 5)
          .map(String)
      : [],

    fontes: Array.isArray(item.fontes)
      ? item.fontes.slice(0, 3)
      : [],

    image_query:
      item.image_query ||
      item.titulo ||
      "",
  };
}

// ─── VALIDACAO ───────────────────────────────────────────────────────────────

function validateEdition(
  news,
  isTestMode = false
) {
  // ============================================================
  // MODO TESTE
  // ============================================================

  if (isTestMode) {
    if (
      !Array.isArray(news) ||
      news.length !== 1
    ) {
      return (
        "O modo de teste precisa retornar exatamente 1 noticia."
      );
    }

    const item = news[0];

    if (
      !item ||
      ![
        "games",
        "geek",
        "cinema",
        "anime",
      ].includes(item.categoria)
    ) {
      return (
        "A noticia de teste possui categoria invalida."
      );
    }

    if (
      !item.titulo ||
      !item.materia
    ) {
      return (
        "A noticia de teste possui campos obrigatorios ausentes."
      );
    }

    if (
      !Array.isArray(item.highlights) ||
      item.highlights.length !== 4
    ) {
      return (
        "A noticia de teste precisa de 4 highlights."
      );
    }

    if (
      !Array.isArray(item.hashtags) ||
      item.hashtags.length !== 5
    ) {
      return (
        "A noticia de teste precisa de 5 hashtags."
      );
    }

    return null;
  }

  // ============================================================
  // MODO NORMAL
  // ============================================================

  if (
    !Array.isArray(news) ||
    news.length !== TOTAL_NEWS
  ) {
    return `A edicao precisa conter exatamente ${TOTAL_NEWS} noticias.`;
  }

  for (const cat of CATEGORY_ORDER) {
    const count = news.filter(
      (n) => n.categoria === cat
    ).length;

    if (
      count !== NEWS_PER_CATEGORY
    ) {
      return `"${cat}" deve ter ${NEWS_PER_CATEGORY} noticias (encontrado: ${count}).`;
    }
  }

  for (const item of news) {
    if (
      !item.titulo ||
      !item.materia
    ) {
      return "Noticia sem titulo ou materia.";
    }

    if (item.materia.length < 2000) {
      return `"${item.titulo}" precisa ter pelo menos 2000 caracteres. Encontrado: ${item.materia.length}.`;
    }

    if (item.materia.length > 2200) {
      return `"${item.titulo}" ultrapassou 2200 caracteres. Encontrado: ${item.materia.length}.`;
    }

    if (
      !Array.isArray(
        item.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      return `"${item.titulo}" precisa de 4 highlights.`;
    }

    if (
      !Array.isArray(
        item.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      return `"${item.titulo}" precisa de 5 hashtags.`;
    }
  }

  return null;
}

// ─── NOTICIA LOCAL DE TESTE ──────────────────────────────────────────────────

function createTestNews() {
  return [
    normalizeNewsItem({
      categoria: "geek",

      titulo:
        "WIRE/GEEK TESTE: sistema editorial funcionando sem Gemini",

      publicado_em:
        "MODO TESTE GRATUITO",

      materia: `Esta e uma materia de demonstracao do Wire/Geek. O objetivo deste modo e permitir que toda a interface seja testada sem realizar nenhuma chamada ao Gemini e sem consumir qualquer credito da API. Aqui voce pode verificar o funcionamento dos cards, filtros, contador de noticias, sistema de highlights, hashtags, fontes, copia de texto, rodape e integracao visual do newsroom.

O modo de teste nao representa uma noticia real e nao deve ser publicado como conteudo jornalistico. Ele serve exclusivamente para validar a aplicacao enquanto a API do Gemini estiver sem quota ou enquanto a configuracao do backend estiver sendo ajustada.

A arquitetura foi preparada para separar claramente a experiencia editorial da geracao por inteligencia artificial. Quando o usuario utilizar o botao normal de apuracao, a aplicacao continuara chamando /api/news. Quando utilizar o modo de teste, nenhuma requisicao sera enviada ao Gemini.

Isso significa que voce consegue verificar se a aplicacao esta funcionando, navegar pelas categorias, abrir uma materia, copiar os textos e testar a experiencia de usuario mesmo quando a API estiver retornando erro 429 por falta de quota.

Este conteudo e propositalmente ficticio. Nenhuma informacao apresentada aqui deve ser considerada uma noticia, fonte jornalistica ou declaracao real.

O Wire/Geek continua preparado para receber a edicao real assim que o backend estiver conectado a uma chave Gemini com quota disponivel. O modo de teste existe justamente para evitar que problemas de billing ou quota impeçam a validacao do restante da aplicacao.

Em producao, a expectativa continua sendo gerar doze noticias, distribuindo tres entre games, geek, cinema e anime, com apuracao na web, fontes reais, highlights, hashtags e consultas de imagem. Este modo reduz a quantidade para uma unica noticia local e nao utiliza inteligencia artificial.

Teste concluido: frontend carregado, validacao executada, card renderizado e nenhum credito de API consumido.`,

      highlights: [
        "MODO TESTE GRATUITO ATIVADO",
        "NENHUMA CHAMADA AO GEMINI FOI REALIZADA",
        "FRONTEND E VALIDACAO ESTAO FUNCIONANDO",
        "API REAL CONTINUA DISPONIVEL NO MODO NORMAL",
      ],

      hashtags: [
        "#WireGeek",
        "#Teste",
        "#BagacaStudios",
        "#Geek",
        "#Newsroom",
      ],

      fontes: [
        {
          nome: "Wire/Geek Test Mode",
          url: "",
          publicado_em:
            "Ambiente de teste",
        },
      ],

      image_query:
        "geek newsroom technology editorial studio",
    }),
  ];
}

// ─── BANNER PROMPT ────────────────────────────────────────────────────────────

function buildBannerCommand(item) {
  const cat =
    CATEGORY_LABEL[item.categoria] ||
    "PAUTA";

  const h = item.highlights.slice(0, 4);

  const imgQuery =
    item.image_query || item.titulo;

  return `@Claude gera banner no Canva para esta noticia da Bagaca Studios:

TEMPLATE: ${TEMPLATE_DESIGN_ID}
CATEGORIA: ${cat}
PUBLICADO EM: ${item.publicado_em}
QUERY DE IMAGEM (buscar foto real): ${imgQuery}

HIGHLIGHT 1 (slide 1): ${h[0] || ""}
HIGHLIGHT 2 (slide 2): ${h[1] || ""}
HIGHLIGHT 3 (slide 3): ${h[2] || ""}
HIGHLIGHT 4 (slide 4): ${h[3] || ""}

LOCATOR IDs:
Pagina 1: badge=${LOCATORS.pages[0].badge} | subtitle=${LOCATORS.pages[0].subtitle} | title=${LOCATORS.pages[0].title} | image=${LOCATORS.pages[0].image}
Pagina 2: badge=${LOCATORS.pages[1].badge} | subtitle=${LOCATORS.pages[1].subtitle} | title=${LOCATORS.pages[1].title} | image=${LOCATORS.pages[1].image}
Pagina 3: badge=${LOCATORS.pages[2].badge} | subtitle=${LOCATORS.pages[2].subtitle} | title=${LOCATORS.pages[2].title} | image=${LOCATORS.pages[2].image}
Pagina 4: badge=${LOCATORS.pages[3].badge} | subtitle=${LOCATORS.pages[3].subtitle} | title=${LOCATORS.pages[3].title} | image=${LOCATORS.pages[3].image}

Texto original do badge: "cinema"

Passos:
1) web_search pela query de imagem
2) encontrar URL publica de foto real relacionada ao assunto
3) Canva:upload-asset-from-url com a URL encontrada
4) Canva:copy-design do template ${TEMPLATE_DESIGN_ID}
5) Canva:read-design open_transaction=true
6) edit-design paginas 1-4
7) badge -> ${cat}
8) subtitle -> ${item.publicado_em}
9) title -> highlight correspondente
10) update_fill image -> asset_id do upload
11) edit-design finalize=commit`;
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `Voce e o editor-chefe de uma redacao especializada em GAMES, CULTURA GEEK, CINEMA e ANIME no Brasil.

Sua voz e de colunista: opinativa, engajada, moderna e com personalidade propria, mas sempre apoiada em fatos reais e verificaveis.

Voce tem acesso a busca na web e DEVE usa-la antes de escrever.

OBJETIVO:
Encontrar exatamente ${TOTAL_NEWS} noticias reais publicadas HOJE ou nas ULTIMAS 24 HORAS.

DIVERSIDADE OBRIGATORIA:
${NEWS_PER_CATEGORY} noticias de cada categoria.

Categorias:
games
geek
cinema
anime

REGRAS:
- NUNCA use travessao.
- Nao invente fatos.
- Nao invente datas.
- Nao invente URLs.
- Nao invente fontes.
- Nao invente declaracoes.
- Use apenas informacoes verificaveis.
- Cada materia deve possuir entre 2000 e 2200 caracteres.
- Cada noticia deve possuir exatamente 4 highlights.
- Cada noticia deve possuir exatamente 5 hashtags.
- Cada noticia deve possuir de 1 a 3 fontes reais.

FORMATO:
Responda SOMENTE com JSON valido.

O array news deve conter exatamente ${TOTAL_NEWS} itens.

Distribuicao obrigatoria:
3 games
3 geek
3 cinema
3 anime.`;
}

// ─── COPY BUTTON ──────────────────────────────────────────────────────────────

function CopyButton({
  text,
  label = "Copiar",
}) {
  const [status, setStatus] =
    useState("idle");

  async function handleClick() {
    try {
      await copyToClipboard(text || "");
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    window.setTimeout(
      () => setStatus("idle"),
      1800
    );
  }

  return (
    <button
      onClick={handleClick}
      type="button"
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
        status === "error"
          ? "border-[#e0452f] text-[#e0452f]"
          : "border-[#3a4a4d] text-[#cfd8d4] hover:border-[#e0452f] hover:text-[#e0452f]"
      }`}
    >
      {status === "copied" ? (
        <Check size={12} />
      ) : (
        <Copy size={12} />
      )}

      {status === "copied"
        ? "Copiado"
        : status === "error"
        ? "Falhou"
        : label}
    </button>
  );
}

// ─── STAMP ───────────────────────────────────────────────────────────────────

function Stamp({ children }) {
  return (
    <span className="inline-block -rotate-2 border-2 border-[#e0452f] px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-[0.15em] text-[#e0452f]">
      {children}
    </span>
  );
}

// ─── FORMATTED ARTICLE ───────────────────────────────────────────────────────

function FormattedArticle({ text }) {
  if (!text) return null;

  const cleaned = String(text).replace(
    /[—–]/g,
    ","
  );

  const lines = cleaned.split(/\n/);

  const blocks = [];
  let paragraph = [];
  let list = [];

  const flushP = () => {
    if (paragraph.length) {
      blocks.push({
        type: "p",
        content: paragraph.join(" "),
      });

      paragraph = [];
    }
  };

  const flushL = () => {
    if (list.length) {
      blocks.push({
        type: "ul",
        items: [...list],
      });

      list = [];
    }
  };

  lines.forEach((raw) => {
    const line = raw.trim();

    if (!line) {
      flushP();
      flushL();
      return;
    }

    if (line.startsWith("### ")) {
      flushP();
      flushL();

      blocks.push({
        type: "h3",
        content: line
          .slice(4)
          .trim(),
      });
    } else if (
      line.startsWith("> ")
    ) {
      flushP();
      flushL();

      blocks.push({
        type: "quote",
        content: line
          .slice(2)
          .trim(),
      });
    } else if (
      line.startsWith("- ") ||
      line.startsWith("* ")
    ) {
      flushP();

      list.push(
        line.slice(2).trim()
      );
    } else {
      flushL();
      paragraph.push(line);
    }
  });

  flushP();
  flushL();

  const finalBlocks = [];

  blocks.forEach((block) => {
    if (block.type === "p") {
      const sentences =
        block.content.split(
          /(?<=[.!?])\s+/
        );

      let group = [];

      sentences.forEach(
        (sentence, i) => {
          group.push(sentence);

          if (
            group.length >= 2 ||
            i === sentences.length - 1
          ) {
            finalBlocks.push({
              type: "p",
              content:
                group.join(" "),
            });

            group = [];
          }
        }
      );
    } else {
      finalBlocks.push(block);
    }
  });

  function renderInline(t, kp) {
    return String(t || "")
      .replace(/[—–]/g, ",")
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") &&
        part.endsWith("**") ? (
          <strong
            key={`${kp}-b-${i}`}
            className="font-semibold text-[#f4f0e8]"
          >
            {part.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment
            key={`${kp}-t-${i}`}
          >
            {part}
          </React.Fragment>
        )
      );
  }

  return (
    <div className="space-y-2.5">
      {finalBlocks.map(
        (block, i) => {
          if (block.type === "h3") {
            return (
              <h4
                key={i}
                className="mt-4 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#e0452f]"
              >
                {block.content}
              </h4>
            );
          }

          if (
            block.type === "quote"
          ) {
            return (
              <blockquote
                key={i}
                className="border-l-2 border-[#e0452f] bg-[#1a2628] px-3 py-2.5 italic text-[#cfd8d4] text-[13px]"
              >
                {renderInline(
                  block.content,
                  `q${i}`
                )}
              </blockquote>
            );
          }

          if (block.type === "ul") {
            return (
              <ul
                key={i}
                className="space-y-1 text-[#d8dfd9] pl-3"
              >
                {block.items.map(
                  (item, j) => (
                    <li
                      key={j}
                      className="flex gap-2"
                    >
                      <span className="text-[#e0452f] shrink-0 mt-1 text-[8px]">
                        ◆
                      </span>

                      <span>
                        {renderInline(
                          item,
                          `l${i}-${j}`
                        )}
                      </span>
                    </li>
                  )
                )}
              </ul>
            );
          }

          const isLead = i === 0;

          return (
            <p
              key={i}
              className={
                isLead
                  ? "text-[14px] leading-relaxed text-[#f0ece4] font-medium"
                  : "text-[14px] leading-relaxed text-[#d8dfd9]"
              }
            >
              {renderInline(
                block.content,
                `p${i}`
              )}
            </p>
          );
        }
      )}
    </div>
  );
}

// ─── BANNER SECTION ───────────────────────────────────────────────────────────

function BannerSection({ item }) {
  const [status, setStatus] =
    useState("idle");

  const [error, setError] =
    useState("");

  const [bannerUrl, setBannerUrl] =
    useState("");

  async function handleGenerate() {
    if (status === "loading") {
      return;
    }

    setStatus("loading");
    setError("");
    setBannerUrl("");

    try {
      const response = await fetch(
        "/api/banner",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            categoria:
              item.categoria,
            titulo: item.titulo,
            publicado_em:
              item.publicado_em,
            highlights:
              item.highlights,
            image_query:
              item.image_query,
          }),
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            "Falha ao gerar o banner."
        );
      }

      setBannerUrl(data.data);
      setStatus("done");
    } catch (error) {
      console.error(error);

      setError(
        error?.message ||
          "Nao foi possivel gerar o banner."
      );

      setStatus("error");
    }
  }

  function handleDownload() {
    if (!bannerUrl) return;

    const link =
      document.createElement("a");

    link.href = bannerUrl;
    link.download =
      "wire-geek-banner.svg";

    document.body.appendChild(link);

    link.click();

    link.remove();
  }

  return (
    <div>
      <p className="mb-3 font-mono text-[10px] leading-relaxed text-[#5c6f6b]">
        Gere automaticamente um banner Wire/Geek para esta noticia.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={
            status === "loading"
          }
          className="inline-flex items-center gap-2 bg-[#e0452f] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#0a1315] transition-colors hover:bg-[#f05a42] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ImageIcon
            size={12}
            className={
              status === "loading"
                ? "animate-spin"
                : ""
            }
          />

          {status === "loading"
            ? "Gerando..."
            : "Gerar Banner"}
        </button>

        {status === "done" &&
          bannerUrl && (
            <button
              type="button"
              onClick={
                handleDownload
              }
              className="inline-flex items-center gap-2 border border-[#5fbf7a]/50 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#5fbf7a] hover:bg-[#5fbf7a]/10"
            >
              <Check size={12} />
              Baixar Banner
            </button>
          )}
      </div>

      {status === "loading" && (
        <div className="mb-3 border border-[#3a4a4d] bg-[#1a2628] px-3 py-3 font-mono text-[10px] text-[#8fa39d]">
          GERANDO BANNER...
          <br />

          <span className="text-[#5c6f6b]">
            Montando layout Wire/Geek.
          </span>
        </div>
      )}

      {status === "error" && (
        <div className="mb-3 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-3 font-mono text-[10px] text-[#f0a89a]">
          {error}
        </div>
      )}

      {bannerUrl && (
        <div className="mt-4 border border-[#243436] bg-[#0c1618] p-3">
          <div className="mb-2 font-mono text-[9px] tracking-[0.2em] text-[#5c6f6b]">
            BANNER GERADO
          </div>

          <img
            src={bannerUrl}
            alt={`Banner: ${item.titulo}`}
            className="w-full border border-[#3a4a4d]"
          />
        </div>
      )}
    </div>
  );
}

// ─── DISPATCH CARD ────────────────────────────────────────────────────────────

function DispatchCard({
  item,
  index,
}) {
  const [tab, setTab] =
    useState("materia");

  const { words, minutes } =
    estimateReading(
      item.materia
    );

  const catColor =
    CATEGORY_COLOR[
      item.categoria
    ] || "#e0452f";

  const tabs = [
    {
      id: "materia",
      label: "Materia",
      icon: Newspaper,
    },
    {
      id: "highlights",
      label: "Highlights",
      icon: Zap,
    },
    {
      id: "hashtags",
      label: "Hashtags",
      icon: Hash,
    },
    {
      id: "banner",
      label: "Banner",
      icon: ImageIcon,
    },
  ];

  return (
    <article className="relative border border-[#3a4a4d] bg-[#0f1a1c]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a4a4d] bg-[#132025] px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] text-[#7a8f8a]">
            DESPACHO{" "}
            {String(index + 1).padStart(
              2,
              "0"
            )}
          </span>

          <span
            className="border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.2em]"
            style={{
              borderColor:
                catColor + "80",
              color: catColor,
            }}
          >
            {CATEGORY_LABEL[
              item.categoria
            ] || "PAUTA"}
          </span>

          {item.publicado_em && (
            <span className="border border-[#5fbf7a]/40 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[#5fbf7a]">
              {item.publicado_em}
            </span>
          )}
        </div>

        <span className="font-mono text-[10px] text-[#5c6f6b]">
          {new Date().toLocaleDateString(
            "pt-BR"
          )}
        </span>
      </div>

      <div className="px-4 pt-4 pb-2">
        <h3
          className="text-xl font-black leading-tight text-[#f4f0e8] sm:text-2xl"
          style={{
            fontFamily:
              "'Archivo Black', sans-serif",
          }}
        >
          {item.titulo}
        </h3>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[#243436] px-4">
        {tabs.map(
          ({
            id,
            label,
            icon: Icon,
          }) => {
            const active =
              tab === id;

            return (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setTab(id)
                }
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  active
                    ? "border-[#e0452f] text-[#f4f0e8]"
                    : "border-transparent text-[#7a8f8a] hover:text-[#cfd8d4]"
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            );
          }
        )}
      </div>

      <div className="p-4">
        {tab === "materia" && (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#5c6f6b]">
                <Clock size={11} />
                {minutes} min · {words}{" "}
                palavras ·{" "}
                {item.materia.length}{" "}
                chars
              </span>

              <CopyButton
                text={`${item.titulo}\n\n${item.materia}\n\n${RODAPE_FIXO}`}
                label="Copiar materia"
              />
            </div>

            <div
              className="mb-4 border-l-2 pl-3"
              style={{
                borderColor: catColor,
              }}
            >
              <h5
                className="text-[15px] font-black leading-snug text-[#f4f0e8]"
                style={{
                  fontFamily:
                    "'Archivo Black', sans-serif",
                }}
              >
                {item.titulo}
              </h5>
            </div>

            <div
              style={{
                fontFamily:
                  "'Source Serif 4', Georgia, serif",
              }}
            >
              <FormattedArticle
                text={
                  item.materia
                }
              />
            </div>

            {item.fontes.length >
              0 && (
              <div className="mt-5 border-t border-[#243436] pt-3">
                <span className="mb-2 block font-mono text-[9px] tracking-[0.2em] text-[#5c6f6b]">
                  FONTES DA APURACAO
                </span>

                <ul className="space-y-1">
                  {item.fontes.map(
                    (
                      source,
                      i
                    ) => (
                      <li
                        key={i}
                        className="font-mono text-[10px] text-[#7a8f8a]"
                      >
                        {source.url ? (
                          <a
                            href={
                              source.url
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-[#3a4a4d] underline-offset-2 hover:text-[#e0452f]"
                          >
                            {source.nome ||
                              source.url}
                          </a>
                        ) : (
                          source.nome
                        )}

                        {source.publicado_em
                          ? ` · ${source.publicado_em}`
                          : ""}
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}

            <div className="mt-4 border-t border-[#243436] pt-3">
              <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#8fa39d]">
                {RODAPE_FIXO}
              </pre>
            </div>
          </div>
        )}

        {tab === "highlights" && (
          <div className="space-y-3">
            <div className="mb-1 flex items-center justify-between">
              <Stamp>
                Sensacionalista
              </Stamp>

              <CopyButton
                text={item.highlights.join(
                  "\n"
                )}
                label="Copiar"
              />
            </div>

            <ul className="space-y-2">
              {item.highlights.map(
                (h, i) => (
                  <li
                    key={i}
                    className="flex gap-3 border-l-2 border-[#e0452f] bg-[#1a2628] px-3 py-2.5"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-[#e0452f] mt-0.5">
                      {i + 1}
                    </span>

                    <span className="font-mono text-[12px] leading-snug text-[#f4f0e8]">
                      {h}
                    </span>
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        {tab === "hashtags" && (
          <div>
            <div className="mb-3 flex justify-end">
              <CopyButton
                text={item.hashtags.join(
                  " "
                )}
                label="Copiar hashtags"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {item.hashtags.map(
                (tag, i) => (
                  <span
                    key={i}
                    className="border border-[#e0452f]/40 px-2 py-1 font-mono text-[11px] text-[#e0452f]"
                  >
                    {tag}
                  </span>
                )
              )}
            </div>
          </div>
        )}

        {tab === "banner" && (
          <BannerSection
            item={item}
          />
        )}
      </div>

      <div className="border-t border-[#243436] bg-[#0c1618] px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.2em] text-[#5c6f6b]">
            RODAPE FIXO
          </span>

          <CopyButton
            text={RODAPE_FIXO}
            label="Copiar rodape"
          />
        </div>

        <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#8fa39d]">
          {RODAPE_FIXO}
        </pre>
      </div>
    </article>
  );
}

// ─── SCHEDULER ────────────────────────────────────────────────────────────────

function SchedulerBadge({
  nextRun,
  isEnabled,
}) {
  if (!isEnabled) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-[#3a4a4d] px-2 py-1 font-mono text-[10px] tracking-wider text-[#5c6f6b]">
        <Calendar size={11} />
        AUTO 7H · INATIVO
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 border border-[#5fbf7a]/40 px-2 py-1 font-mono text-[10px] tracking-wider text-[#5fbf7a]">
      <Calendar size={11} />
      AUTO 7H ·{" "}
      {nextRun || "..."}
    </span>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────

export default function GeekNewsWire() {
  const [status, setStatus] =
    useState("idle");

  const [errorMsg, setErrorMsg] =
    useState("");

  const [edition, setEdition] =
    useState(null);

  const [ticker, setTicker] =
    useState(
      "PREPARANDO TRANSMISSAO"
    );

  const [
    schedulerEnabled,
    setSchedulerEnabled,
  ] = useState(false);

  const [nextRun, setNextRun] =
    useState("");

  const [
    activeFilter,
    setActiveFilter,
  ] = useState("all");

  const [
    testMode,
    setTestMode,
  ] = useState(false);

  const schedulerRef =
    useRef(null);

  function computeNextRun() {
    const now = new Date();
    const date = new Date();

    date.setHours(7, 0, 0, 0);

    if (now >= date) {
      date.setDate(
        date.getDate() + 1
      );
    }

    return date;
  }

  function formatNextRun(date) {
    return date
      .toLocaleString("pt-BR", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
      .toUpperCase();
  }

  function startScheduler() {
    if (schedulerRef.current) {
      clearInterval(
        schedulerRef.current
      );
    }

    setSchedulerEnabled(true);

    setNextRun(
      formatNextRun(
        computeNextRun()
      )
    );

    schedulerRef.current =
      setInterval(() => {
        const now = new Date();

        if (
          now.getHours() === 7 &&
          now.getMinutes() === 0
        ) {
          window.storage
            ?.get(todayKey())
            .then((saved) => {
              if (!saved?.value) {
                generate();
              }
            })
            .catch(() => generate());
        }

        setNextRun(
          formatNextRun(
            computeNextRun()
          )
        );
      }, 30000);
  }

  function stopScheduler() {
    if (schedulerRef.current) {
      clearInterval(
        schedulerRef.current
      );
    }

    schedulerRef.current = null;

    setSchedulerEnabled(false);
    setNextRun("");
  }

  useEffect(() => {
    (async () => {
      try {
        if (!window.storage?.get) {
          return;
        }

        const saved =
          await window.storage.get(
            todayKey()
          );

        if (saved?.value) {
          const parsed =
            JSON.parse(
              saved.value
            );

          setEdition({
            ...parsed,
            news: (
              parsed.news || []
            ).map(
              normalizeNewsItem
            ),
          });

          setStatus("done");
        }

        const sched =
          await window.storage.get(
            schedulerKey()
          );

        if (
          sched?.value ===
          "enabled"
        ) {
          startScheduler();
        }
      } catch {}
    })();

    return () => {
      if (schedulerRef.current) {
        clearInterval(
          schedulerRef.current
        );
      }
    };
  }, []);

  async function toggleScheduler() {
    if (schedulerEnabled) {
      stopScheduler();

      try {
        await window.storage?.set(
          schedulerKey(),
          "disabled"
        );
      } catch {}
    } else {
      startScheduler();

      try {
        await window.storage?.set(
          schedulerKey(),
          "enabled"
        );
      } catch {}
    }
  }

  const summary = useMemo(() => {
    const news =
      edition?.news || [];

    const byCategory = {};

    for (const cat of CATEGORY_ORDER) {
      byCategory[cat] =
        news.filter(
          (n) =>
            n.categoria === cat
        ).length;
    }

    return {
      total: news.length,
      byCategory,
    };
  }, [edition]);

  const filteredNews =
    useMemo(() => {
      if (!edition?.news) {
        return [];
      }

      if (
        activeFilter === "all"
      ) {
        return edition.news;
      }

      return edition.news.filter(
        (n) =>
          n.categoria ===
          activeFilter
      );
    }, [
      edition,
      activeFilter,
    ]);

  // ─── MODO TESTE GRATUITO ────────────────────────────────────────────────

  function generateTestEdition() {
    if (status === "loading") {
      return;
    }

    setTestMode(true);
    setStatus("loading");
    setErrorMsg("");
    setTicker(
      "MODO TESTE GRATUITO · NAO USA GEMINI"
    );

    window.setTimeout(() => {
      try {
        const news =
          createTestNews();

        const validationError =
          validateEdition(
            news,
            true
          );

        if (validationError) {
          throw new Error(
            validationError
          );
        }

        const newEdition = {
          generatedAt:
            new Date().toISOString(),

          testMode: true,

          news,
        };

        setEdition(
          newEdition
        );

        setStatus("done");

        setTicker(
          "TESTE CONCLUIDO · 1 DESPACHO · ZERO CREDITOS GEMINI"
        );

        setActiveFilter("all");
      } catch (error) {
        console.error(error);

        setErrorMsg(
          error?.message ||
            "Falha no modo de teste."
        );

        setStatus("error");

        setTicker(
          "FALHA NO MODO TESTE"
        );
      }
    }, 400);
  }

  // ─── GERACAO REAL ──────────────────────────────────────────────────────

  async function generate() {
    if (status === "loading") {
      return;
    }

    setTestMode(false);
    setStatus("loading");
    setErrorMsg("");

    const phases = [
      "CONECTANDO AO FIO INTERNACIONAL",
      "VARRENDO PORTAIS DE GAMES, GEEK, CINEMA E ANIME",
      "FILTRANDO PUBLICACOES DAS ULTIMAS 24H",
      "VALIDANDO DATA E FONTE",
      "APURANDO OS FATOS",
      "REDIGINDO COM VOZ PROPRIA",
      "LAPIDANDO CHAMADAS",
      "FORMATANDO PARA REDES SOCIAIS",
    ];

    let phaseIndex = 0;

    const interval =
      setInterval(() => {
        phaseIndex =
          (phaseIndex + 1) %
          phases.length;

        setTicker(
          phases[phaseIndex]
        );
      }, 1800);

    setTicker(phases[0]);

    try {
      const response =
        await fetchWithRetry(
          "/api/news",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              prompt: `Gere a edicao de hoje com exatamente ${TOTAL_NEWS} noticias reais: ${NEWS_PER_CATEGORY} de cada categoria (games, geek, cinema, anime). Todas publicadas nas ultimas 24 horas. Busque na web antes de escrever. Cada materia deve obrigatoriamente ter entre 2000 e 2200 caracteres. Nunca entregue materia com menos de 2000 caracteres. Nunca use travessao. Responda somente com o JSON solicitado.`,

              testMode: false,
            }),
          },
          {
            attempts: 4,

            onRetry: (
              s,
              attempt,
              total,
              wait
            ) => {
              setTicker(
                `SERVIDOR OCUPADO: TENTATIVA ${attempt}/${total - 1} EM ${Math.round(
                  wait / 1000
                )}S`
              );
            },
          }
        );

      if (!response.ok) {
        const body =
          await response
            .text()
            .catch(() => "");

        throw new Error(
          `Erro no backend ${response.status}: ${body.slice(
            0,
            500
          )}`
        );
      }

      const data =
        await response.json();

      const text = String(
        data?.text || ""
      ).trim();

      if (!text) {
        throw new Error(
          "Backend nao retornou JSON."
        );
      }

      const cleaned = text
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /\s*```$/i,
          ""
        )
        .trim();

      let parsed;

      try {
        parsed =
          JSON.parse(cleaned);
      } catch {
        const start =
          cleaned.indexOf("{");

        const end =
          cleaned.lastIndexOf(
            "}"
          );

        if (
          start < 0 ||
          end <= start
        ) {
          throw new Error(
            "JSON invalido retornado pelo backend."
          );
        }

        parsed = JSON.parse(
          cleaned.slice(
            start,
            end + 1
          )
        );
      }

      const news = (
        parsed.news || []
      ).map(
        normalizeNewsItem
      );

      const validationError =
        validateEdition(
          news,
          false
        );

      if (validationError) {
        throw new Error(
          validationError
        );
      }

      const newEdition = {
        generatedAt:
          new Date().toISOString(),

        testMode: false,

        news,
      };

      setEdition(
        newEdition
      );

      setStatus("done");

      setTicker(
        `APURACAO CONCLUIDA · ${news.length} DESPACHOS`
      );

      setActiveFilter("all");

      try {
        if (window.storage?.set) {
          await window.storage.set(
            todayKey(),
            JSON.stringify(
              newEdition
            )
          );
        }
      } catch {}
    } catch (error) {
      console.error(error);

      setErrorMsg(
        error?.message ||
          "Falha desconhecida."
      );

      setStatus("error");

      setTicker(
        "FALHA NA APURACAO"
      );
    } finally {
      clearInterval(interval);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#0a1315] text-[#d8dfd9]"
      style={{
        fontFamily:
          "'IBM Plex Mono', monospace",
      }}
    >
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
      />

      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin=""
      />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap');
      `}</style>

      {/* TICKER */}

      <div className="overflow-hidden whitespace-nowrap border-b border-[#3a4a4d] bg-[#132025]">
        <div className="flex items-center gap-2 px-4 py-2">
          <Radio
            size={13}
            className="shrink-0 text-[#e0452f]"
          />

          <span className="shrink-0 font-mono text-[10px] font-bold tracking-[0.2em] text-[#e0452f]">
            AO VIVO
          </span>

          <span className="text-[#5c6f6b]">
            /
          </span>

          <span className="truncate font-mono text-[10px] tracking-[0.15em] text-[#8fa39d]">
            {ticker}
          </span>
        </div>
      </div>

      {/* HEADER */}

      <header className="mx-auto max-w-3xl border-b border-[#243436] px-4 pb-6 pt-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              className="text-3xl font-black tracking-tight text-[#f4f0e8] sm:text-4xl"
              style={{
                fontFamily:
                  "'Archivo Black', sans-serif",
              }}
            >
              WIRE
              <span className="text-[#e0452f]">
                /
              </span>
              GEEK
            </h1>

            <div className="mt-1 font-mono text-[9px] tracking-[0.25em] text-[#5c6f6b]">
              BAGACA STUDIOS · NEWSROOM
              3.0
            </div>
          </div>

          <span className="font-mono text-[10px] tracking-[0.2em] text-[#5c6f6b]">
            GAMES · GEEK · CINEMA ·
            ANIME
          </span>
        </div>

        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[#8fa39d]">
          Central editorial para
          apuracao diaria. 4 categorias,
          3 noticias cada, banners no
          Canva com imagens reais.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 border border-[#5fbf7a]/40 px-2 py-1 font-mono text-[10px] tracking-wider text-[#5fbf7a]">
            <CheckCircle2 size={11} />
            ULTIMAS 24H
          </span>

          {CATEGORY_ORDER.map(
            (cat) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1.5 border border-[#3a4a4d] px-2 py-1 font-mono text-[10px] tracking-wider"
                style={{
                  color:
                    CATEGORY_COLOR[
                      cat
                    ],
                }}
              >
                {NEWS_PER_CATEGORY}x{" "}
                {CATEGORY_LABEL[cat]}
              </span>
            )
          )}

          <SchedulerBadge
            nextRun={nextRun}
            isEnabled={
              schedulerEnabled
            }
          />
        </div>
      </header>

      {/* MAIN */}

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {/* APURAR */}

            <button
              type="button"
              onClick={generate}
              disabled={
                status ===
                "loading"
              }
              className="inline-flex items-center gap-2 bg-[#e0452f] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0a1315] transition-colors hover:bg-[#f05a42] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                className={
                  status ===
                  "loading"
                    ? "animate-spin"
                    : ""
                }
              />

              {status === "loading"
                ? "Apurando..."
                : "Apurar Noticias"}
            </button>

            {/* TESTE GRATUITO */}

            <button
              type="button"
              onClick={
                generateTestEdition
              }
              disabled={
                status ===
                "loading"
              }
              className="inline-flex items-center gap-2 border border-[#f0b429]/50 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#f0b429] transition-colors hover:bg-[#f0b429]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FlaskConical
                size={14}
              />

              Modo Teste Gratuito
            </button>

            {/* SCHEDULER */}

            <button
              type="button"
              onClick={
                toggleScheduler
              }
              className={`inline-flex items-center gap-2 border px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                schedulerEnabled
                  ? "border-[#5fbf7a]/50 text-[#5fbf7a] hover:bg-[#5fbf7a]/10"
                  : "border-[#3a4a4d] text-[#7a8f8a] hover:border-[#5fbf7a]/50 hover:text-[#5fbf7a]"
              }`}
            >
              <Calendar
                size={14}
              />

              {schedulerEnabled
                ? "Auto 7H · Ativo"
                : "Ativar Auto 7H"}
            </button>
          </div>

          {edition && (
            <div className="text-right">
              <div className="font-mono text-[10px] text-[#5c6f6b]">
                ULTIMA APURACAO
              </div>

              <div className="font-mono text-[11px] text-[#8fa39d]">
                {new Date(
                  edition.generatedAt
                ).toLocaleTimeString(
                  "pt-BR"
                )}
              </div>
            </div>
          )}
        </div>

        {/* AVISO TESTE */}

        {edition?.testMode && (
          <div className="mb-5 flex items-start gap-3 border border-[#f0b429]/40 bg-[#211c0c] px-4 py-3 text-[#f0b429]">
            <FlaskConical
              size={18}
              className="mt-0.5 shrink-0"
            />

            <div>
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider">
                MODO TESTE GRATUITO
              </div>

              <div className="mt-1 font-mono text-[10px] leading-relaxed text-[#cdbd82]">
                Esta noticia foi gerada
                localmente. Nenhuma
                chamada ao Gemini foi
                realizada e nenhum
                credito da API foi
                consumido.
              </div>
            </div>
          </div>
        )}

        {/* STATUS GRID */}

        {edition && (
          <div className="mb-5 grid grid-cols-4 border border-[#243436] bg-[#0c1618]">
            {CATEGORY_ORDER.map(
              (cat) => {
                const count =
                  summary
                    .byCategory[
                    cat
                  ] || 0;

                const ok =
                  edition.testMode
                    ? count === 1 &&
                      cat ===
                        "geek"
                    : count ===
                      NEWS_PER_CATEGORY;

                const color =
                  CATEGORY_COLOR[
                    cat
                  ];

                return (
                  <div
                    key={cat}
                    className="border-r border-[#243436] px-3 py-2 last:border-r-0"
                  >
                    <div
                      className="font-mono text-[9px] tracking-[0.2em]"
                      style={{
                        color,
                      }}
                    >
                      {cat}
                    </div>

                    <div
                      className={`mt-0.5 font-mono text-[10px] ${
                        ok
                          ? "text-[#5fbf7a]"
                          : "text-[#e0452f]"
                      }`}
                    >
                      {edition.testMode
                        ? cat ===
                          "geek"
                          ? "1 TESTE ✓"
                          : "TESTE"
                        : ok
                        ? `${count}/${NEWS_PER_CATEGORY} ✓`
                        : `${count}/${NEWS_PER_CATEGORY}`}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}

        {/* ERROR */}

        {status === "error" && (
          <div className="mb-6 flex items-start gap-2 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-2.5 text-[13px] text-[#f0a89a]">
            <AlertCircle
              size={16}
              className="mt-0.5 shrink-0"
            />

            <span>
              {errorMsg}
            </span>
          </div>
        )}

        {/* EMPTY */}

        {status === "idle" &&
          !edition && (
            <div className="border border-dashed border-[#3a4a4d] px-4 py-12 text-center text-[13px] text-[#5c6f6b]">
              <div className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[#7a8f8a]">
                REDACAO EM ESPERA
              </div>

              Nenhuma edicao gerada
              hoje. Inicie a apuracao
              ou utilize o modo de teste
              gratuito.
            </div>
          )}

        {status === "loading" &&
          !edition && (
            <div className="animate-pulse border border-dashed border-[#3a4a4d] px-4 py-12 text-center text-[13px] text-[#8fa39d]">
              {ticker}...
            </div>
          )}

        {/* FILTROS + CARDS */}

        {edition && (
          <>
            <div className="mb-4 flex flex-wrap gap-1 border-b border-[#243436] pb-4">
              <button
                type="button"
                onClick={() =>
                  setActiveFilter(
                    "all"
                  )
                }
                className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  activeFilter ===
                  "all"
                    ? "bg-[#e0452f] text-[#0a1315]"
                    : "border border-[#3a4a4d] text-[#7a8f8a] hover:border-[#e0452f] hover:text-[#e0452f]"
                }`}
              >
                Todos (
                {
                  edition.news
                    .length
                }
                )
              </button>

              {CATEGORY_ORDER.map(
                (cat) => {
                  const count =
                    summary
                      .byCategory[
                      cat
                    ] || 0;

                  const active =
                    activeFilter ===
                    cat;

                  const color =
                    CATEGORY_COLOR[
                      cat
                    ];

                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() =>
                        setActiveFilter(
                          cat
                        )
                      }
                      className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors border"
                      style={{
                        borderColor:
                          active
                            ? color
                            : color +
                              "40",

                        color: active
                          ? "#0a1315"
                          : color,

                        backgroundColor:
                          active
                            ? color
                            : "transparent",
                      }}
                    >
                      {
                        CATEGORY_LABEL[
                          cat
                        ]
                      }{" "}
                      (
                      {count}
                      )
                    </button>
                  );
                }
              )}
            </div>

            <div className="space-y-5">
              {filteredNews.map(
                (
                  item,
                  index
                ) => (
                  <DispatchCard
                    key={`${item.categoria}-${index}`}
                    item={item}
                    index={edition.news.indexOf(
                      item
                    )}
                  />
                )
              )}
            </div>
          </>
        )}
      </main>

      {/* FOOTER */}

      <footer className="mx-auto max-w-3xl border-t border-[#243436] px-4 pb-8 pt-4 sm:px-6">
        <div className="flex flex-wrap justify-between gap-2 font-mono text-[9px] text-[#4a5c58]">
          <span>
            WIRE/GEEK 3.0 · BAGACA
            STUDIOS
          </span>

          <span>
            EDICOES SALVAS · AUTO 7H ·
            BANNERS COM IMAGENS REAIS
          </span>
        </div>
      </footer>
    </div>
  );
}
