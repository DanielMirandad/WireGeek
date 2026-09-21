import BriefingBannerSection from "./briefing/BriefingBannerSection.jsx";
import PublicationPanel from "./PublicationPanel.jsx";
import { cleanBriefingText } from "../lib/briefing-text.mjs";
import { parseBriefingRealInput } from "./briefing-real-input.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Check, CheckCircle2, Clock, Copy,
  Hash, Newspaper, Radio, RefreshCw, Zap, ImageIcon,
  Calendar, Archive,
} from "lucide-react";

import {
  hasBriefingBannerSpecs,
  buildBriefingClientPayload,
} from "./briefing/briefing-banner-contract.js";

// --- CONSTANTES ---
const TEMPLATE_DESIGN_ID = "DAHSAXUcxX4";
const LOCATORS = {
  pages: [
    { badge: "PBh0XHD7f51kGytW-LB8JLWDRlqf3zjVq", subtitle: "PBh0XHD7f51kGytW-LBt1zdTS5fdVJTjx", title: "PBh0XHD7f51kGytW-LBqCnTzmXzLqNWpD", image: "PBh0XHD7f51kGytW-LBcrH5XySKL6yNB8" },
    { badge: "PBFyZVcCQVwCb0d3-LBKvNPT8SJnDH1dH", subtitle: "PBFyZVcCQVwCb0d3-LBnqhzhh7z7GZ8jz", title: "PBFyZVcCQVwCb0d3-LB2MsMYr8xcXw1M1", image: "PBFyZVcCQVwCb0d3-LBd2pgL8y4n6Ns3V" },
    { badge: "PB4wYBY6qz0T0XRs-LBKNjYr8rfxC1y3H", subtitle: "PB4wYBY6qz0T0XRs-LBv71qJNWmMm4vCy", title: "PB4wYBY6qz0T0XRs-LBcrrR5z0Ynr61Zm", image: "PB4wYBY6qz0T0XRs-LBhHjmVCZhs6p0bf" },
    { badge: "PBVm2lDStJp1vY2K-LBSccwgKrvXSV2qc", subtitle: "PBVm2lDStJp1vY2K-LBhzgt6pqVSk6mmn", title: "PBVm2lDStJp1vY2K-LBr6s9x2J5KY9nBn", image: "PBVm2lDStJp1vY2K-LBn5H3KPYykqy4LL" },
  ],
  badgeOriginalText: "cinema",
};

const CATEGORY_LABEL  = { games: "GAMES", geek: "GEEK", cinema: "CINEMA", anime: "ANIME" };
const CATEGORY_COLOR  = { games: "#E8002D", geek: "#7C3AED", cinema: "#D97706", anime: "#0EA5E9" };
const CATEGORY_ORDER  = ["games", "geek", "cinema", "anime"];

const RODAPE_FIXO = `---

Estaremos acompanhando tudo e traremos as informações até vocês.

SEGUE A GENTE, COMPARTILHA E COMENTA!

LIVES TODOS OS SÁBADOS!!
https://www.twitch.tv/bagacacast_lives
https://youtube.com/@bagacastudios

REDES SOCIAIS:
Instagram: @bagacastudios
TikTok: @bagacastudios
Youtube: @bagacastudios

SEJA VIP:
https://linktr.ee/Bagacacast

CANAL DE CORTES:
https://www.youtube.com/@CortesBCastOficial`;

// --- HELPERS ---
function todayKey()     { const d = new Date(); return `wire-geek:v3:${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function schedulerKey() { return "wire-geek:scheduler"; }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }

function copyViaTextarea(text) {
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly",""); ta.style.position="fixed"; ta.style.opacity="0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy") ? resolve() : reject(new Error("Falhou"));
      document.body.removeChild(ta);
    } catch(e) { reject(e); }
  });
}
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(() => copyViaTextarea(text));
  return copyViaTextarea(text);
}
async function fetchWithRetry(url, options, { attempts=4, onRetry }={}) {
  let lastError;
  for (let i=0; i<attempts; i++) {
    let response=null;
    try { response = await fetch(url, options); } catch(e) { lastError=e; }
    if (response?.ok) return response;
    const status = response?.status ?? null;
    const transient = status===429||status===503||status===529||status===null;
    if (!transient || i===attempts-1) { if (response) return response; throw lastError||new Error("Falha de rede."); }
    const wait = Math.round(1000*Math.pow(2,i)+Math.random()*500);
    onRetry?.(status,i+1,attempts,wait);
    await sleep(wait);
  }
  throw lastError||new Error("Falha após múltiplas tentativas.");
}
function estimateReading(text) {
  const words = String(text||"").trim().split(/\s+/).filter(Boolean);
  return { words: words.length, minutes: Math.max(1,Math.round(words.length/200)) };
}

// Remove travessões de todos os campos
function removeDashes(str) {
  return cleanBriefingText(str);
}

function deriveShortTitle(value) {
  const source = removeDashes(value || "")
    .replace(/[|/:].*$/, "")
    .trim();

  if (!source) return "";

  const words = source
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "";

  const first = words[0];
  const second = words[1] || "";

  /*
   * Siglas/franquias que normalmente usam
   * um segundo token numerico ou nominal.
   */
  if (
    /^(?:nhl|nba|fifa|fc|gta|ufc|f1)$/i.test(first) &&
    second
  ) {
    return `${first} ${second}`.slice(0, 40);
  }

  /*
   * Preservar nomes proprios compostos no inicio
   * do titulo da noticia.
   *
   * Exemplos:
   *
   * Minha Melhor Amiga lidera...
   * -> Minha Melhor Amiga
   *
   * Slow Horses é renovada...
   * -> Slow Horses
   *
   * Kingdom Hearts em Fortnite...
   * -> Kingdom Hearts
   *
   * Kia revela...
   * -> Kia
   */
  const titleWords = [];

  for (const word of words) {
    const token = String(word)
      .replace(
        /^[("'“‘]+|[)"'”’.,;:!?]+$/g,
        ""
      )
      .trim();

    if (!token) {
      continue;
    }

    if (titleWords.length === 0) {
      titleWords.push(word);
      continue;
    }

    const startsAsProperName =
      /^[A-ZÁÉÍÓÚÀÃÕÂÊÔÇ0-9]/u.test(
        token
      );

    if (!startsAsProperName) {
      break;
    }

    const candidate =
      [...titleWords, word]
        .join(" ");

    /*
     * Nunca cortar uma entidade no meio.
     * Se a entidade inteira ultrapassar esse
     * limite, o renderer cuidara do layout.
     */
    if (candidate.length > 60) {
      break;
    }

    titleWords.push(word);
  }

  if (titleWords.length >= 2) {
    return titleWords.join(" ");
  }

  return first.slice(0, 40);
}
function buildAutomaticBannerTitle(text = "", fallback = "") {
  const source = String(text || fallback || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!source) {
    return "NOVA ATUALIZAÇÃO";
  }

  return source
    .split(" ")
    .slice(0, 7)
    .join(" ")
    .replace(/[.,;:!?]+$/g, "")
    .trim()
    .toUpperCase();
}

function buildAutomaticBriefingBanners(item = {}) {
  const highlights =
    Array.isArray(item.highlights)
      ? item.highlights
          .map((value) =>
            String(value || "").trim()
          )
          .filter(Boolean)
          .slice(0, 2)
      : [];

  if (highlights.length !== 2) {
    throw new Error(
      `"${item?.titulo || "Notícia"}" precisa de exatamente 2 highlights para gerar os banners automaticamente.`
    );
  }

  const baseContext =
    String(
      item.contexto_visual ||
      item.titulo ||
      ""
    ).trim();

  const baseQuery =
    String(
      item.image_query ||
      item.titulo ||
      ""
    ).trim();

  return highlights.map(
    (highlight, index) => ({
      type: "editorial",

      banner_title:
        buildAutomaticBannerTitle(
          highlight,
          item.titulo_curto ||
          item.titulo
        ),

      highlight,

      visual_subject:
        baseContext ||
        item.titulo ||
        "",

      contexto_visual:
        index === 0
          ? baseContext
          : [
              baseContext,
              "Usar uma segunda imagem oficial claramente diferente do primeiro banner.",
              "Priorizar outro enquadramento, cena, personagem, composição ou material promocional oficial relacionado ao mesmo assunto.",
            ]
              .filter(Boolean)
              .join(" "),

      image_query:
        index === 0
          ? baseQuery
          : `${baseQuery} official alternate image still promotional`,
    })
  );
}

function prepareAutomaticBriefingItem(item = {}) {
  if (hasBriefingBannerSpecs(item)) {
    return item;
  }

  return {
    ...item,
    banners:
      buildAutomaticBriefingBanners(item),
  };
}

function normalizeNewsItem(item={}) {
  return {
    id:             item.id,
    categoria:      String(item.categoria||"geek").toLowerCase(),
    titulo:         removeDashes(item.titulo||"Sem título"),
    titulo_curto: removeDashes(
      item.titulo_curto ||
      item.short_title ||
      deriveShortTitle(item.titulo || item.title || "")
    ),
    publicado_em:   item.publicado_em||"Últimas 48h",
    materia:        removeDashes(item.materia||""),
    resumo:         removeDashes(item.resumo||""),
    por_que_importa: removeDashes(item.por_que_importa||""),
    highlights:     Array.isArray(item.highlights)?item.highlights.map(removeDashes):[],
    hashtags:       Array.isArray(item.hashtags)?item.hashtags.slice(0,5):[],
    fontes:         Array.isArray(item.fontes)?item.fontes.slice(0,3):[],
    contexto_visual: removeDashes(item.contexto_visual||""),
    image_query:    item.image_query||item.titulo||"",
    image_url:      item.image_url||item.imageUrl||item.imagem||"",
    url:            item.url||"",
    imagens:        Array.isArray(item.imagens)?item.imagens:[],
    banners:        Array.isArray(item.banners)?item.banners.slice(0,2):[],
    final_banners:  Array.isArray(item.final_banners)?item.final_banners.slice(0,3):[],
    briefing_generated_banners: Array.isArray(item.briefing_generated_banners)
      ? item.briefing_generated_banners.slice(0,3)
      : [],
    briefing_source: item.briefing_source === true,
  };
}
function validateEdition(news) {
  if (!Array.isArray(news) || news.length < 1 || news.length > 12)
    return "A edição deve conter entre 1 e 12 notícias.";

  for (const item of news) {
    if (!item.titulo || !item.materia)
      return "Notícia sem título ou matéria.";

    if (item.highlights.length !== 2) return `"${item.titulo}" precisa de 2 destaques.`;

    if (item.hashtags.length !== 5)
      return `"${item.titulo}" precisa de 5 hashtags.`;
  }

  return null;
}

// --- BANNER PROMPT ---

const BRIEFING_ONLY_LOCAL =
  import.meta.env.DEV;

const BRIEFING_LAB_ANIME = {
  categoria: "anime",

  titulo:
    "Chitose Is in the Ramune Bottle Cour 2 ganha novo trailer, músicas e estreia em 13 de outubro",

  contexto_visual:
    "Mostrar Saku Chitose e o elenco de Chitose Is in the Ramune Bottle. Priorizar material oficial da adaptação. Evitar personagens de outros romances escolares, fanart, imagens genéricas e close-ups extremos.",

  image_query:
    "Chitose Is in the Ramune Bottle Cour 2 Saku Chitose official key visual October 2026",

  fontes: [
    {
      nome: "Anime Corner",
      url:
        "https://animecorner.me/chitose-is-in-the-ramune-bottle-part-2-trailer-and-october-13-premiere-revealed-sora-amamiya-joins-cast/",
    },
  ],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "CHITOSE VOLTA EM 13 DE OUTUBRO",

      highlight:
        "Chitose Is in the Ramune Bottle retorna em 13 de outubro, com novo trailer, Sora Amamiya e duas músicas inéditas",

      visual_subject:
        "Chitose Is in the Ramune Bottle Cour 2, Saku Chitose e elenco principal",

      contexto_visual:
        "Mostrar Saku Chitose ou o elenco principal da adaptação oficial. Priorizar key visual ou material promocional do novo cour.",

      image_query:
        "Chitose Is in the Ramune Bottle Cour 2 Saku Chitose official key visual October 2026",
    },

    {
      type: "editorial",

      banner_title:
        "CIDER GIRL ABRE O NOVO COUR",

      highlight:
        "Cider Girl canta a nova abertura, enquanto aruma assume o encerramento da segunda parte produzida novamente pelo estúdio feel.",

      visual_subject:
        "Chitose Is in the Ramune Bottle Cour 2, novo cour e personagens mostrados no trailer",

      contexto_visual:
        "Usar uma segunda imagem oficial diferente do primeiro banner, ligada ao novo cour, trailer ou personagens da adaptação. Evitar close-up extremo.",

      image_query:
        "Chitose Is in the Ramune Bottle Cour 2 official trailer still new cour 2026",
    },
  ],
};

const BRIEFING_LAB_GAMES = {
  categoria: "games",

  titulo:
    "Onimusha: Way of the Sword alcança um milhão de unidades vendidas",

  contexto_visual:
    "Mostrar Onimusha: Way of the Sword usando material oficial do jogo. Priorizar Musashi, combate, gameplay ou key art oficial. Evitar jogos de outras franquias da Capcom, fanart, thumbnails de terceiros e imagens genéricas de samurais.",

  image_query:
    "Onimusha Way of the Sword Musashi official gameplay screenshot key art",

  fontes: [],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "ONIMUSHA CHEGA A 1 MILHÃO",

      highlight:
        "Onimusha: Way of the Sword alcançou um milhão de unidades vendidas e reforçou o retorno da clássica franquia da Capcom.",

      visual_subject:
        "Onimusha Way of the Sword, Musashi e combate",

      contexto_visual:
        "Mostrar Musashi ou uma cena clara de combate de Onimusha: Way of the Sword. Priorizar imagem oficial, gameplay ou key art reconhecível.",

      image_query:
        "Onimusha Way of the Sword Musashi official gameplay screenshot",
    },

    {
      type: "editorial",

      banner_title:
        "A FRANQUIA VOLTOU COM FORÇA",

      highlight:
        "O novo Onimusha marcou o retorno de um título inédito da série após duas décadas e encontrou forte resposta do público.",

      visual_subject:
        "Onimusha Way of the Sword, cenário, inimigos e ação",

      contexto_visual:
        "Usar uma segunda imagem oficial diferente do primeiro banner. Priorizar gameplay, inimigo, cenário ou outra composição que represente o jogo sem repetir o mesmo enquadramento.",

      image_query:
        "Onimusha Way of the Sword official gameplay enemy environment screenshot",
    },
  ],
};

function CopyButton({ text, label = "Copiar" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("WIRE/GEEK: erro ao copiar", error);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 border border-[#3a4a4d] px-2 py-1 font-mono text-[10px] text-[#8fa39d] transition hover:border-[#e0452f] hover:text-[#e0452f]"
    >
      <Copy size={11} />
      {copied ? "Copiado" : label}
    </button>
  );
}

function Stamp({ children }) {
  return (
    <span className="border border-[#e0452f]/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#e0452f]">
      {children}
    </span>
  );
}

function FormattedArticle({ text }) {
  return (
    <div className="space-y-3 text-[15px] leading-7 text-[#cfd8d4]">
      {String(text || "")
        .split(/\n+/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </div>
  );
}

const BRIEFING_LAB_CINEMA = {
  categoria: "cinema",

  titulo:
    "Superman ganha novo material oficial com foco no herói e em Metrópolis",

  contexto_visual:
    "Mostrar Superman usando material oficial do filme. Priorizar o herói uniformizado, Metrópolis, cenas de ação ou stills oficiais. Evitar adaptações antigas, fanart, cosplay, quadrinhos e imagens de outros atores ou versões do personagem.",

  image_query:
    "Superman movie official still Metropolis Superman David Corenswet",

  fontes: [],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "SUPERMAN VOLTA AOS CÉUS",

      highlight:
        "O novo filme coloca Superman novamente no centro da ação com uma abordagem visual focada no herói e em Metrópolis.",

      visual_subject:
        "Superman do novo filme, uniforme e Metrópolis",

      contexto_visual:
        "Mostrar Superman claramente reconhecível no novo filme. Priorizar still oficial ou material promocional cinematográfico com boa leitura do personagem.",

      image_query:
        "Superman movie David Corenswet official still flying Metropolis",
    },

    {
      type: "editorial",

      banner_title:
        "METRÓPOLIS ENTRA EM CENA",

      highlight:
        "O material promocional também destaca a escala da cidade e reforça o contraste entre o cotidiano de Clark Kent e a ação de Superman.",

      visual_subject:
        "Superman, Metrópolis e cenas do novo filme",

      contexto_visual:
        "Usar uma segunda imagem oficial diferente do primeiro banner. Priorizar Metrópolis, ação, Lois Lane, Clark Kent ou composição ampla ligada ao filme.",

      image_query:
        "Superman movie official still Metropolis Clark Kent Lois Lane",
    },
  ],
};

const BRIEFING_LAB_GEEK = {
  categoria: "geek",

  titulo:
    "Star Wars e Marvel se encontram em crossover histórico nos quadrinhos",

  contexto_visual:
    "Mostrar material oficial de Star Wars/Marvel: Hope Assembles. Priorizar arte promocional, capa oficial ou personagens de Star Wars e Marvel juntos. Evitar fanart, cosplay, brinquedos, montagens de terceiros e imagens genéricas de Star Wars.",

  image_query:
    "Star Wars Marvel Hope Assembles official cover David Marquez Kevin Smith",

  fontes: [],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "STAR WARS ENCONTRA A MARVEL",

      highlight:
        "Lucasfilm e Marvel unem oficialmente seus universos em Hope Assembles, minissérie escrita por Kevin Smith com arte de David Marquez.",

      visual_subject:
        "Star Wars Marvel Hope Assembles, Luke Skywalker, Leia, Han Solo e heróis Marvel",

      contexto_visual:
        "Usar arte oficial de Hope Assembles que deixe evidente o crossover entre Star Wars e Marvel. Priorizar capa ou arte promocional oficial com personagens reconhecíveis.",

      image_query:
        "Star Wars Marvel Hope Assembles official cover Luke Leia Avengers David Marquez",
    },

    {
      type: "editorial",

      banner_title:
        "DUAS GALÁXIAS NO MESMO QUADRINHO",

      highlight:
        "Luke, Leia e Han Solo cruzam o caminho de heróis da Marvel na primeira colaboração narrativa oficial entre os dois universos.",

      visual_subject:
        "Star Wars Marvel Hope Assembles, personagens dos dois universos",

      contexto_visual:
        "Usar uma segunda arte oficial diferente do primeiro banner. Priorizar outra capa, composição ou grupo de personagens que mostre claramente Star Wars e Marvel juntos.",

      image_query:
        "Star Wars Marvel Hope Assembles official comic art Avengers Spider-Man Luke Skywalker",
    },
  ],
};

function BriefingLab() {
  const [inputMode, setInputMode] = useState("real");
  const [payloadText, setPayloadText] = useState("");
  const [realItem, setRealItem] = useState(null);
  const [inputError, setInputError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);

  function loadRealItem(event) {
    event.preventDefault();
    try {
      const nextItem = parseBriefingRealInput(payloadText);
      setRealItem(nextItem);
      setLoadVersion(version => version + 1);
      setInputError("");
    } catch (error) {
      setRealItem(null);
      setInputError(error.message);
    }
  }

  const [fixtureKey, setFixtureKey] =
    useState("anime");

  const fixtures = {
    anime: BRIEFING_LAB_ANIME,
    games: BRIEFING_LAB_GAMES,
    cinema: BRIEFING_LAB_CINEMA,
    geek: BRIEFING_LAB_GEEK,
  };

  const fixture =
    inputMode === "real"
      ? realItem
      : fixtures[fixtureKey] || BRIEFING_LAB_ANIME;

  const options = [
    {
      id: "anime",
      label: "ANIME · CHITOSE",
    },
    {
      id: "games",
      label: "GAMES · ONIMUSHA",
    },
    {
      id: "cinema",
      label: "CINEMA · SUPERMAN",
    },
    {
      id: "geek",
      label: "GEEK · STAR WARS",
    },
  ];

  return (
    <section className="mb-8 border border-[#00d084]/40 bg-[#07110f] p-4 sm:p-5">

      <div className="mb-5 border-b border-[#263b36] pb-4">

        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#00d084]">
          BRIEFING LAB
        </div>

        <label className="mt-4 block text-sm text-[#a9bab5]">
          Origem do teste
          <select value={inputMode} onChange={event => setInputMode(event.target.value)} className="ml-3 rounded border border-[#263b36] bg-[#0f1a1c] p-2 text-white">
            <option value="real">Item real do Briefing Geek Diário</option>
            <option value="fixtures">Regressão · 4 fixtures aprovadas</option>
          </select>
        </label>

        {inputMode === "real" && (
          <form onSubmit={loadRealItem} className="mt-4 space-y-3">
            <label htmlFor="briefing-real-json" className="block text-sm text-[#a9bab5]">JSON de um único item do Briefing</label>
            <p id="briefing-real-help" className="text-sm text-[#8fa39d]">
              Informe categoria, titulo, fontes, contexto_visual, image_query e banners com dois editoriais (banner_title e highlight).
              imagens pode estar vazia ou ausente para busca automática. O CTA será acrescentado na geração.
            </p>
            <textarea id="briefing-real-json" aria-describedby="briefing-real-help" value={payloadText} onChange={event => setPayloadText(event.target.value)} rows={12} spellCheck={false} className="w-full rounded border border-[#263b36] bg-[#0f1a1c] p-3 font-mono text-xs text-white" />
            <button type="submit" disabled={!payloadText.trim()} className="rounded border border-[#00d084] px-4 py-2 text-sm text-[#00d084] disabled:opacity-40">Carregar item e gerar 3 slides</button>
            {inputError && <p role="alert" className="text-sm text-red-400">{inputError}</p>}
            {realItem && <p role="status" className="text-sm text-[#8fa39d]">Item carregado abaixo. Alterações no JSON só serão aplicadas ao carregar novamente.</p>}
          </form>
        )}

        {inputMode === "fixtures" && <div className="mt-4 grid gap-2 sm:grid-cols-2">

          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() =>
                setFixtureKey(
                  option.id
                )
              }
              className={`rounded-lg border px-3 py-2 font-mono text-[10px] font-bold tracking-wider transition ${
                fixtureKey === option.id
                  ? "border-[#00d084] bg-[#00d084]/10 text-[#00d084]"
                  : "border-[#263b36] text-[#8ca39d]"
              }`}
            >
              {option.label}
            </button>
          ))}

        </div>}

        <h2 className="mt-4 text-xl font-black leading-tight text-[#f4f0e8]">
          {fixture?.titulo || "Nenhum item real carregado"}
        </h2>

        <div className="mt-2 flex items-center gap-2">
          <span className="border border-[#263b36] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[#8ca39d]">
            {fixture?.categoria || "BRIEFING"}
          </span>

          <span className="font-mono text-[9px] uppercase tracking-wider text-[#5c6f6b]">
            {inputMode === "fixtures" ? "IMAGENS 100% AUTOMÁTICAS" : "TESTE COM ITEM REAL"}
          </span>
        </div>

        <p className="mt-3 text-sm leading-6 text-[#8fa39d]">
          Teste isolado do pipeline Briefing:
          2 banners editoriais + CTA.
        </p>

      </div>

      {fixture && <BriefingBannerSection deriveShortTitle={deriveShortTitle}
        key={inputMode === "real" ? `real-${loadVersion}` : fixtureKey}
        item={fixture}
      />}

    </section>
  );
}

function DispatchCard({ item, index }) {
  const [tab, setTab] = useState("materia");
  const { words, minutes } = estimateReading(item.materia);
  const catColor = CATEGORY_COLOR[item.categoria] || "#e0452f";

  const tabs = [
    { id: "materia", label: "Matéria", icon: Newspaper },
    { id: "highlights", label: "Highlights", icon: Zap },
    { id: "hashtags", label: "Hashtags", icon: Hash },
    { id: "publicacao", label: "Publicação", icon: Radio },

  ];

  return (
    <article className="relative border border-[#3a4a4d] bg-[#0f1a1c]">

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a4a4d] bg-[#132025] px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">

          <span className="font-mono text-[10px] text-[#7a8f8a]">
            DESPACHO {String(index + 1).padStart(2, "0")}
          </span>

          <span
            className="border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.2em]"
            style={{
              borderColor: `${catColor}80`,
              color: catColor
            }}
          >
            {CATEGORY_LABEL[item.categoria] || "PAUTA"}
          </span>

          {item.publicado_em && (
            <span className="border border-[#5fbf7a]/40 px-1.5 py-0.5 font-mono text-[10px] text-[#5fbf7a]">
              {item.publicado_em}
            </span>
          )}
        </div>

        <span className="font-mono text-[10px] text-[#5c6f6b]">
          {new Date().toLocaleDateString("pt-BR")}
        </span>
      </div>

      <div className="px-4 pb-2 pt-4">
        <h3
          className="text-xl font-black leading-tight text-[#f4f0e8] sm:text-2xl"
          style={{ fontFamily: "'Archivo Black', sans-serif" }}
        >
          {item.titulo}
        </h3>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[#243436] px-4">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[10px] font-mono uppercase tracking-wider ${
              tab === id
                ? "border-[#e0452f] text-[#f4f0e8]"
                : "border-transparent text-[#7a8f8a]"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div className="p-4">

        {tab === "materia" && (
          <div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#5c6f6b]">
                <Clock size={11} />
                {minutes} min · {words} palavras · {item.materia.length} caracteres
              </span>

                         <CopyButton
                text={`${item.titulo}\n\n${item.materia}\n\n${RODAPE_FIXO}`}
                label="Copiar matéria"
              />
            </div>

            <div

              className="mb-4 border-l-2 pl-3"
              style={{ borderColor: catColor }}
            >
              <h5 className="text-[15px] font-black leading-snug text-[#f4f0e8]">
                {item.titulo}
              </h5>
            </div>

            <FormattedArticle text={item.materia} />

            <div
              className="mt-6 border-t border-[#243436] pt-5"
              style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
            >
              <FormattedArticle text={RODAPE_FIXO} />
            </div>

            {item.fontes.length > 0 && (
              <div className="mt-5 border-t border-[#243436] pt-3">

                <span className="mb-2 block font-mono text-[9px] tracking-[0.2em] text-[#5c6f6b]">
                  FONTES DA APURAÇÃO
                </span>

                <ul className="space-y-1">
                  {item.fontes.map((source, i) => (
                    <li
                      key={i}
                      className="font-mono text-[10px] text-[#7a8f8a]"
                    >
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-[#e0452f]"
                        >
                          {source.nome || source.url}
                        </a>
                      ) : (
                        source.nome
                      )}

                      {source.publicado_em
                        ? ` · ${source.publicado_em}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>

        )}
              </div>
        )}

        {tab === "highlights" && (

  <div className="space-y-4">

    <div className="flex items-center justify-between border-b border-[#243436] pb-3">
      <div>
        <Stamp>Sensacionalista</Stamp>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#7a8f8a]">
          1 destaque editorial • até 20 palavras
        </p>
      </div>

      <CopyButton
        text={item.highlights.join("\n")}
        label="Copiar"
      />
    </div>

    <div className="grid gap-3">

      {item.highlights.map((highlight, i) => (
        <div
          key={i}
          className="group relative overflow-hidden border border-[#344447] bg-[#121e21] px-4 py-4 transition-all hover:border-[#e0452f]/70"
        >

          <div className="absolute left-0 top-0 h-full w-1 bg-[#e0452f]" />

          <div className="flex items-start gap-4">

            <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#e0452f]/50 bg-[#1b282b]">
              <span className="font-mono text-[11px] font-bold text-[#e0452f]">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>

            <div className="min-w-0 flex-1">

              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#667b77]">
                Destaque {String(i + 1).padStart(2, "0")}
              </div>

              <p className="font-mono text-[13px] font-medium leading-relaxed text-[#f4f0e8]">
                {highlight}
              </p>

            </div>

          </div>

        </div>
      ))}

    </div>

  </div>
)}

        {tab === "hashtags" && (
          <div>

            <div className="mb-3 flex justify-end">
              <CopyButton
                text={item.hashtags.join(" ")}
                label="Copiar hashtags"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {item.hashtags.map((tag, i) => (
                <span
                  key={i}
                  className="border border-[#e0452f]/40 px-2 py-1 font-mono text-[11px] text-[#e0452f]"
                >
                  {tag}
                </span>
              ))}
            </div>

          </div>
        )}



      </div>
      {tab === "publicacao" && (
        <div className="border-t border-[#243436] p-4">
          <PublicationPanel item={item} />
        </div>
      )}

    </article>

  );
}

function SchedulerBadge({ nextRun, isEnabled }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] tracking-wider ${
        isEnabled
          ? "border-[#5fbf7a]/40 text-[#5fbf7a]"
          : "border-[#3a4a4d] text-[#5c6f6b]"
      }`}
    >
      <Clock size={11} />
      {isEnabled
        ? `AUTO ÀS 7H · ${nextRun || "ATIVO"}`
        : "AUTO 7H DESATIVADO"}
    </span>
  );
}

export default function GeekNewsWire() {
  function openArchivedEdition(item) {
    const news = Array.isArray(item?.news)
      ? item.news.map(normalizeNewsItem)
      : [];

    setEdition({
      title: item?.titulo || "Edição Wire/Geek",
      generatedAt: item?.data_edicao || new Date().toISOString(),
      news,
    });

    setActiveFilter("all");
    setStatus(news.length > 0 ? "done" : "idle");
    setArchiveOpen(false);
  }
  async function loadArchive() {
    if (archiveLoading) return;

    setArchiveLoading(true);
    setArchiveError("");

    try {
      const response = await fetch("/api/edicoes", {
        method: "GET",
        credentials: "include",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error || `Arquivo respondeu com HTTP ${response.status}.`
        );
      }

      setArchive(Array.isArray(data?.edicoes) ? data.edicoes : []);
      setArchiveOpen(true);
    } catch (error) {
      setArchiveError(
        error?.message || "Não foi possível carregar o arquivo de edições."
      );
    } finally {
      setArchiveLoading(false);
    }
  }
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [adminKey, setAdminKey] = useState("");
  const [authError, setAuthError] = useState("");

  const [status,   setStatus]   = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [archive, setArchive] = useState([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [briefingImportOpen, setBriefingImportOpen] = useState(false);
  const [briefingText, setBriefingText] = useState("");
  const [briefingImporting, setBriefingImporting] = useState(false);
  const [briefingError, setBriefingError] = useState("");
const [edition,  setEdition]  = useState(null);
  const [ticker,   setTicker]   = useState("PREPARANDO TRANSMISSAO");
  const [schedulerEnabled, setSchedulerEnabled] = useState(false);
  const [nextRun,  setNextRun]  = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const schedulerRef = useRef(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const response = await fetch("/api/auth", {
          method: "GET",
          credentials: "include",
        });

        if (active) {
          const data = await response.json().catch(() => ({}));
          setAuthenticated(response.ok && data.authenticated === true);
        }
      } catch {
        if (active) {
          setAuthenticated(false);
        }
      } finally {
        if (active) {
          setAuthChecking(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function login() {
    if (!adminKey.trim()) {
      setAuthError("Informe a chave administrativa.");
      return;
    }

    setAuthError("");
    setAuthChecking(true);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ key: adminKey }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Falha na autenticacao.");
      }

      setAuthenticated(true);
      setAdminKey("");
    } catch (error) {
      setAuthenticated(false);
      setAuthError(error?.message || "Falha na autenticacao.");
    } finally {
      setAuthChecking(false);
    }
  }

  function computeNextRun() { const n=new Date(),d=new Date(); d.setHours(7,0,0,0); if(n>=d)d.setDate(d.getDate()+1); return d; }
  function formatNextRun(date) { return date.toLocaleString("pt-BR",{weekday:"short",hour:"2-digit",minute:"2-digit"}).toUpperCase(); }

  function startScheduler() {
    if(schedulerRef.current) clearInterval(schedulerRef.current);
    setSchedulerEnabled(true); setNextRun(formatNextRun(computeNextRun()));
    schedulerRef.current = setInterval(()=>{
      const now=new Date();
      if(now.getHours()===7&&now.getMinutes()===0) {
        Promise.resolve(localStorage.getItem(todayKey())).then(saved=>{ if(!saved) generate(); }).catch(()=>generate());
      }
      setNextRun(formatNextRun(computeNextRun()));
    },30000);
  }
  function stopScheduler() { if(schedulerRef.current) clearInterval(schedulerRef.current); schedulerRef.current=null; setSchedulerEnabled(false); setNextRun(""); }

  useEffect(()=>{
    (async()=>{
      try {
        if(!window.localStorage) return;
        const savedValue = localStorage.getItem(todayKey());
        if(savedValue) { const p=JSON.parse(savedValue); setEdition({...p,news:(p.news||[]).map(normalizeNewsItem)}); setStatus("done"); }
        const schedValue = localStorage.getItem(schedulerKey());
        if(schedValue==="enabled") startScheduler();
      } catch {}
    })();
    return()=>{ if(schedulerRef.current) clearInterval(schedulerRef.current); };
  },[]);

  async function toggleScheduler() {
    if(schedulerEnabled){ stopScheduler(); try{await Promise.resolve(localStorage.setItem(schedulerKey(), "disabled"));}catch{} }
    else{ startScheduler(); try{await Promise.resolve(localStorage.setItem(schedulerKey(), "enabled"));}catch{} }
  }

  const summary = useMemo(()=>{
    const news=edition?.news||[]; const byCategory={};
    for(const cat of CATEGORY_ORDER) byCategory[cat]=news.filter(n=>n.categoria===cat).length;
    return {total:news.length,byCategory};
  },[edition]);

  const filteredNews = useMemo(()=>{
    if(!edition?.news) return [];
    if(activeFilter==="all") return edition.news;
    return edition.news.filter(n=>n.categoria===activeFilter);
  },[edition,activeFilter]);

  async function generateCurrentEditionBriefing() {
    if (briefingImporting) return;

    const currentNews =
      Array.isArray(edition?.news)
        ? edition.news
        : [];

    if (!currentNews.length) {
      setBriefingError(
        "Gere ou carregue uma edição antes de gerar os banners."
      );
      return;
    }

    setBriefingImporting(true);
    setBriefingError("");
    setErrorMsg("");

    /*
     * Mantém a edição inteira na mesma ordem.
     *
     * Cada notícia bem-sucedida substitui
     * somente sua própria posição.
     */
    const resultNews =
      [...currentNews];

    const failures = [];

    let successCount = 0;

    try {
      for (
        let newsIndex = 0;
        newsIndex < currentNews.length;
        newsIndex++
      ) {
        try {
          const item =
            prepareAutomaticBriefingItem(
              currentNews[newsIndex]
            );

          const noticiaId =
            String(item?.id || "").trim();

          if (!noticiaId) {
            throw new Error(
              `A notícia ${newsIndex + 1} não possui noticia_id.`
            );
          }

          setTicker(
            `GERANDO 3 SLIDES · NOTÍCIA ${newsIndex + 1}/${currentNews.length}`
          );

          const briefingPayload =
            buildBriefingClientPayload(item);

          const bannerResponse =
            await fetch(
              "/api/banner-briefing",
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                credentials: "include",

                body: JSON.stringify({
                  ...briefingPayload,
                  noticia_id: noticiaId,
                  mode: "briefing",
                }),
              }
            );

          const bannerData =
            await bannerResponse
              .json()
              .catch(() => ({}));

          if (
            !bannerResponse.ok ||
            !bannerData?.success
          ) {
            throw new Error(
              bannerData?.details ||
              bannerData?.error ||
              `Falha ao gerar banners da notícia ${newsIndex + 1}. HTTP ${bannerResponse.status}.`
            );
          }

          if (
            !Array.isArray(
              bannerData?.banners
            ) ||
            bannerData.banners.length !== 3
          ) {
            throw new Error(
              `A notícia ${newsIndex + 1} não retornou os 3 slides esperados.`
            );
          }

          const editorialSlides =
            bannerData.banners.filter(
              (banner) =>
                banner?.type ===
                "editorial"
            );

          const ctaSlides =
            bannerData.banners.filter(
              (banner) =>
                banner?.type === "cta"
            );

          if (
            editorialSlides.length !== 2 ||
            ctaSlides.length !== 1
          ) {
            throw new Error(
              `A notícia ${newsIndex + 1} retornou composição inválida. Esperado: 2 editoriais + 1 CTA.`
            );
          }

          const generatedItem = {
            ...item,

            briefing_source: true,

            briefing_generated_banners:
              bannerData.banners,
          };

          /*
           * IMPORTANTE:
           * substitui exatamente a posição
           * da notícia processada.
           *
           * Não depende da quantidade
           * de sucessos anteriores.
           */
          resultNews[newsIndex] =
            generatedItem;

          successCount++;

          const partialEdition = {
            ...edition,

            news: [...resultNews],

            generatedAt:
              edition?.generatedAt ||
              new Date().toISOString(),
          };

          setEdition(
            partialEdition
          );

          try {
            localStorage.setItem(
              todayKey(),
              JSON.stringify(
                partialEdition
              )
            );
          } catch {}

          console.log(
            "WIRE/GEEK: BRIEFING PARCIAL PERSISTIDO",
            {
              noticia_id:
                noticiaId,

              indice:
                newsIndex,

              sucessos:
                successCount,

              total:
                currentNews.length,
            }
          );
        }
        catch (itemError) {
          const failedItem =
            currentNews[newsIndex];

          failures.push({
            index:
              newsIndex,

            id:
              failedItem?.id || null,

            titulo:
              failedItem?.titulo || "",

            error:
              itemError?.message ||
              "Falha desconhecida.",
          });

          console.error(
            "WIRE/GEEK: falha no briefing automatico da noticia:",
            {
              indice:
                newsIndex,

              noticia_id:
                failedItem?.id || null,

              titulo:
                failedItem?.titulo || "",

              erro:
                itemError?.message ||
                "Falha desconhecida.",
            }
          );

          /*
           * Não interrompe o lote.
           */
          setTicker(
            `NOTÍCIA ${newsIndex + 1} FALHOU · CONTINUANDO ${newsIndex + 2 <= currentNews.length ? `${newsIndex + 2}/${currentNews.length}` : ""}`
          );
        }
      }

      const finalEdition = {
        ...edition,

        news: [...resultNews],

        generatedAt:
          edition?.generatedAt ||
          new Date().toISOString(),
      };

      setEdition(
        finalEdition
      );

      setStatus("done");

      try {
        localStorage.setItem(
          todayKey(),
          JSON.stringify(
            finalEdition
          )
        );
      } catch {}

      if (failures.length) {
        setBriefingError(
          `${failures.length} notícia(s) não tiveram os banners gerados. As demais foram preservadas. Primeira falha: ${failures[0].titulo || `notícia ${failures[0].index + 1}`} — ${failures[0].error}`
        );

        setTicker(
          `BANNERS GERADOS · ${successCount} SUCESSO(S) · ${failures.length} FALHA(S)`
        );
      }
      else {
        setBriefingError("");

        setTicker(
          `BANNERS GERADOS · ${successCount} DESPACHOS · ${successCount * 3} SLIDES`
        );
      }

      console.log(
        "WIRE/GEEK: BRIEFING AUTOMATICO DA EDICAO CONCLUIDO",
        {
          noticias:
            currentNews.length,

          sucessos:
            successCount,

          falhas:
            failures.length,

          slides:
            successCount * 3,

          detalhes_falhas:
            failures,
        }
      );
    }
    catch (error) {
      /*
       * Este catch fica reservado apenas
       * para falhas inesperadas do lote,
       * fora do processamento individual.
       */
      console.error(
        "WIRE/GEEK: falha inesperada no briefing automatico da edicao:",
        error
      );

      setBriefingError(
        error?.message ||
        "Não foi possível concluir o processamento automático da edição."
      );

      setTicker(
        "FALHA INESPERADA NA GERAÇÃO AUTOMÁTICA"
      );
    }
    finally {
      setBriefingImporting(false);
    }
  }
async function importBriefing() {
    if (briefingImporting) return;

    const payload = briefingText.trim();

    if (!payload) {
      setBriefingError(
        "Cole o bloco WIREGEEK_JSON do Briefing Geek Diário."
      );
      return;
    }

    /*
     * O JSON original é a fonte de verdade do contrato visual.
     * /api/briefing-import continua responsável pela persistência
     * e pelos IDs das notícias.
     */
    let originalBriefing;

    try {
      const jsonStart = payload.indexOf("{");
      const jsonEnd = payload.lastIndexOf("}");

      if (
        jsonStart < 0 ||
        jsonEnd < jsonStart
      ) {
        throw new Error(
          "Bloco JSON não encontrado."
        );
      }

      originalBriefing = JSON.parse(
        payload.slice(
          jsonStart,
          jsonEnd + 1
        )
      );
    } catch (error) {
      setBriefingError(
        "Não foi encontrado JSON válido no bloco do Briefing Geek Diário."
      );
      return;
    }

    const originalNews =
      Array.isArray(originalBriefing?.news)
        ? originalBriefing.news
        : [];

    if (!originalNews.length) {
      setBriefingError(
        "O Briefing não contém notícias em news."
      );
      return;
    }

    setBriefingImporting(true);
    setBriefingError("");
    setErrorMsg("");

    setTicker(
      "IMPORTANDO BRIEFING GEEK DIÁRIO"
    );

    try {
      /*
       * ETAPA 1
       * Mantém o importador existente responsável por
       * validar/salvar a edição e devolver as notícias com ID.
       */
      const response = await fetch(
        "/api/briefing-import",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            text: payload,
          }),
        }
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (
        !response.ok ||
        !data?.success ||
        !Array.isArray(data?.edition?.news)
      ) {
        throw new Error(
          data?.details ||
          data?.error ||
          `Importação respondeu com HTTP ${response.status}.`
        );
      }

      const persistedNews =
        data.edition.news.map(
          normalizeNewsItem
        );

      if (
        persistedNews.length !==
        originalNews.length
      ) {
        throw new Error(
          `O Briefing possui ${originalNews.length} notícias, mas o importador retornou ${persistedNews.length}.`
        );
      }

      /*
       * A resposta persistida fornece ID e dados canônicos.
       * O JSON original fornece o contrato visual aprovado.
       *
       * Não deixar /api/briefing-import apagar:
       * - fontes
       * - contexto_visual
       * - image_query
       * - imagens
       * - banners
       */
      const news =
        persistedNews.map(
          (persistedItem, index) => {
            const originalItem =
              normalizeNewsItem(
                originalNews[index] || {}
              );

            return {
              ...persistedItem,

              fontes:
                originalItem.fontes,

              contexto_visual:
                originalItem.contexto_visual,

              image_query:
                originalItem.image_query,

              image_url:
                originalItem.image_url,

              imagens:
                originalItem.imagens,

              banners:
                originalItem.banners,

              /*
               * Os dois highlights também fazem parte
               * do contrato editorial do Briefing.
               */
              highlights:
                originalItem.highlights.length
                  ? originalItem.highlights
                  : persistedItem.highlights,
            };
          }
        );

      console.log(
        "WIRE/GEEK: CONTRATO VISUAL DO BRIEFING PRESERVADO",
        news.map((item, index) => ({
          noticia: index + 1,
          id: item.id || null,
          categoria: item.categoria,
          titulo: item.titulo,
          fontes:
            Array.isArray(item.fontes)
              ? item.fontes.length
              : 0,
          banners:
            Array.isArray(item.banners)
              ? item.banners.length
              : 0,
          imagens:
            Array.isArray(item.imagens)
              ? item.imagens.length
              : 0,
          image_query:
            Boolean(item.image_query),
          contexto_visual:
            Boolean(item.contexto_visual),
        }))
      );

      const validationError =
        validateEdition(news);

      if (validationError) {
        throw new Error(validationError);
      }

      /*
       * ETAPA 2
       * Cada notícia agora usa o pipeline Briefing aprovado.
       *
       * NÃO recebe arquivos prontos.
       * Usa exclusivamente o pipeline do Briefing.
       */
      const newsWithGeneratedBanners = [];

      for (
        let newsIndex = 0;
        newsIndex < news.length;
        newsIndex++
      ) {
        const item = news[newsIndex];

        const noticiaId = String(
          item?.id || ""
        ).trim();

        if (!noticiaId) {
          throw new Error(
            `A notícia ${newsIndex + 1} foi importada sem noticia_id.`
          );
        }

        if (!hasBriefingBannerSpecs(item)) {
          throw new Error(
            `A notícia ${newsIndex + 1} não possui os dois banners editoriais exigidos pelo modo Briefing.`
          );
        }

        setTicker(
          `GERANDO 3 SLIDES · NOTÍCIA ${newsIndex + 1}/${news.length}`
        );

        const briefingPayload =
          buildBriefingClientPayload(item);

        console.log(
          "WIRE/GEEK: GERANDO BRIEFING IMPORTADO",
          {
            noticia_id: noticiaId,
            noticia: newsIndex + 1,
            total: news.length,
            titulo: item.titulo,
            banners:
              briefingPayload?.banners?.length || 0,
          }
        );

        const bannerResponse =
          await fetch(
            "/api/banner-briefing",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              credentials: "include",
              body: JSON.stringify({
                ...briefingPayload,
                noticia_id: noticiaId,
                mode: "briefing",
              }),
            }
          );

        const bannerData =
          await bannerResponse
            .json()
            .catch(() => ({}));

        if (
          !bannerResponse.ok ||
          !bannerData?.success
        ) {
          throw new Error(
            bannerData?.details ||
            bannerData?.error ||
            `Falha ao gerar banners da notícia ${newsIndex + 1}. HTTP ${bannerResponse.status}.`
          );
        }

        if (
          !Array.isArray(bannerData?.banners) ||
          bannerData.banners.length !== 3
        ) {
          throw new Error(
            `A notícia ${newsIndex + 1} não retornou os 3 slides esperados.`
          );
        }

        const editorialSlides =
          bannerData.banners.filter(
            banner =>
              banner?.type === "editorial"
          );

        const ctaSlides =
          bannerData.banners.filter(
            banner =>
              banner?.type === "cta"
          );

        if (
          editorialSlides.length !== 2 ||
          ctaSlides.length !== 1
        ) {
          throw new Error(
            `A notícia ${newsIndex + 1} retornou uma composição inválida. Esperado: 2 editoriais + 1 CTA.`
          );
        }

        newsWithGeneratedBanners.push({
          ...item,

          /*
           * Mantemos item.banners intacto:
           * ele continua sendo o contrato editorial.
           */
          briefing_source: true,

          /*
           * Resultado materializado do Wire/Geek.
           */
          briefing_generated_banners:
            bannerData.banners,
        });
      }

      const newEdition = {
        ...data.edition,

        title:
          data.edition.title ||
          data.edition.titulo ||
          "Briefing Geek Diário",

        generatedAt:
          data.edition.generatedAt ||
          data.edition.generated_at ||
          data.edition.data_edicao ||
          new Date().toISOString(),

        news: newsWithGeneratedBanners,
      };

      setEdition(newEdition);
      setStatus("done");

      setTicker(
        `BRIEFING IMPORTADO · ${newsWithGeneratedBanners.length} DESPACHOS · ${newsWithGeneratedBanners.length * 3} SLIDES`
      );

      setActiveFilter("all");
      setBriefingImportOpen(false);
      setBriefingText("");

      try {
        localStorage.setItem(
          todayKey(),
          JSON.stringify(newEdition)
        );
      } catch {}

      console.log(
        "WIRE/GEEK: BRIEFING COMPLETO GERADO",
        {
          noticias:
            newsWithGeneratedBanners.length,
          slides:
            newsWithGeneratedBanners.length * 3,
        }
      );
    } catch (error) {
      console.error(
        "WIRE/GEEK: falha no Briefing automático:",
        error
      );

      setBriefingError(
        error?.message ||
        "Não foi possível importar e gerar o Briefing Geek Diário."
      );

      setTicker(
        "FALHA NA GERAÇÃO DO BRIEFING"
      );
    } finally {
      setBriefingImporting(false);
    }
  }
  async function generate() {
  if (status === "loading") return;

  setStatus("loading");
  setErrorMsg("");
  setEdition(null);

  const phases = [
    "CONECTANDO AO FIO INTERNACIONAL",
    "VARRENDO PORTAIS DE GAMES, GEEK, CINEMA E ANIME",
    "FILTRANDO PUBLICAÇÕES DAS ÚLTIMAS 48H",
    "VALIDANDO DATA E FONTE",
    "APURANDO OS FATOS",
    "REDIGINDO COM VOZ PRÓPRIA",
    "LAPIDANDO CHAMADAS",
    "FORMATANDO PARA REDES SOCIAIS",
  ];

  let phaseIndex = 0;

  const interval = setInterval(() => {
    phaseIndex = (phaseIndex + 1) % phases.length;
    setTicker(phases[phaseIndex]);
  }, 1800);

  setTicker(phases[0]);

  try {
    const response = await fetchWithRetry(
      "/api/news",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `Gere a edição de hoje com notícias reais. Se houver 12 ou mais notícias válidas, selecione as 12 melhores. Se houver de 1 a 11 notícias válidas, use todas. Se houver menos de 1 notícia válida, não publique. Preserve a categoria original de cada notícia (games, geek, cinema, anime). Considere notícias das últimas 48 horas. Busque na web antes de escrever. Nunca use travessão. Responda somente com o JSON solicitado.`,
        }),
      },
      {
        attempts: 4,
        onRetry: (s, a, t, w) => {
          setTicker(
            `SERVIDOR OCUPADO: TENTATIVA ${a}/${t - 1} EM ${Math.round(
              w / 1000
            )}S`
          );
        },
      }
    );

        if (!response.ok) {
      const body = await response.text().catch(() => "");
      let message = body;
      try {
        const problem = JSON.parse(body);
        message = [problem.error, ...(Array.isArray(problem.details) ? problem.details : [problem.details])].filter(Boolean).join(" ");
      } catch { /* Keep the server message if it did not return JSON. */ }
      throw new Error(message || `Backend respondeu com HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Backend não retornou JSON. Content-Type: ${contentType || "desconhecido"}${
          body ? ` | Resposta: ${body.slice(0, 300)}` : ""
        }`
      );
    }

    const data = await response.json();

    let news = [];

    if (Array.isArray(data?.news)) {
      news = data.news;
    } else {
      const text = String(data?.text || "").trim();

      if (!text) {
        throw new Error("Backend não retornou notícias.");
      }

      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      let parsed;

      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");

        if (start < 0 || end <= start) {
          throw new Error("JSON inválido retornado pelo backend.");
        }

        parsed = JSON.parse(cleaned.slice(start, end + 1));
      }

      news = Array.isArray(parsed?.news) ? parsed.news : [];
    }

    news = news.map(normalizeNewsItem);

    const validationError = validateEdition(news);

    if (validationError) {
      throw new Error(validationError);
    }

    const newEdition = {
      generatedAt: new Date().toISOString(),
      news,
    };

    const blockedCount = Array.isArray(data?.bloqueadas)
      ? data.bloqueadas.length
      : 0;

    setEdition(newEdition);
    setStatus("done");
    setTicker(
      `APURAÇÃO CONCLUÍDA · ${news.length} DESPACHOS` +
      (blockedCount ? ` · ${blockedCount} BLOQUEADA(S)` : "")
    );
    setActiveFilter("all");

    try {
      localStorage.setItem(todayKey(), JSON.stringify(newEdition));
    } catch {}
  } catch (err) {
    setErrorMsg(err?.message || "Falha desconhecida.");
    setStatus("error");
    setTicker("FALHA NA APURAÇÃO");
  } finally {
    clearInterval(interval);
  }
}

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0a1315] text-[#d8dfd9] flex items-center justify-center p-6"
        style={{ fontFamily: "\x27IBM Plex Mono\x27, monospace" }}>
        <div className="w-full max-w-md border border-[#3a4a4d] bg-[#0f1a1c] p-6 text-center">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-[#e0452f]">
            WIRE/GEEK
          </div>
          <div className="font-mono text-sm text-[#8fa39d]">
            VERIFICANDO SESSAO...
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#0a1315] text-[#d8dfd9] flex items-center justify-center p-6"
        style={{ fontFamily: "\x27IBM Plex Mono\x27, monospace" }}>
        <div className="w-full max-w-md border border-[#3a4a4d] bg-[#0f1a1c] p-6">
          <div className="mb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#e0452f]">
              ACESSO ADMINISTRATIVO
            </div>
            <h1 className="mt-2 text-2xl font-black text-[#f4f0e8]"
              style={{ fontFamily: "\x27Archivo Black\x27, sans-serif" }}>
              WIRE/GEEK
            </h1>
            <p className="mt-2 text-xs leading-5 text-[#7a8f8a]">
              Informe a chave administrativa para acessar o painel de apuracao.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              login();
            }}
            className="space-y-4"
          >
            <div>
              <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-[#8fa39d]">
                Chave administrativa
              </label>
              <input
                type="password"
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                autoComplete="current-password"
                autoFocus
                className="w-full border border-[#3a4a4d] bg-[#07110f] px-3 py-3 font-mono text-sm text-[#f4f0e8] outline-none transition focus:border-[#e0452f]"
                placeholder="Digite a chave de acesso"
              />
            </div>

            {authError && (
              <div className="flex gap-2 border border-[#e0452f]/40 bg-[#1a1010] p-3 text-xs text-[#e0452f]">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authChecking}
              className="flex w-full items-center justify-center gap-2 bg-[#e0452f] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0a1315] transition-colors hover:bg-[#f05a42] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {authChecking ? "Autenticando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a1315] text-[#d8dfd9]" style={{fontFamily:"'IBM Plex Mono', monospace"}}>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap');`}</style>

      {/* Ticker */}
      <div className="overflow-hidden whitespace-nowrap border-b border-[#3a4a4d] bg-[#132025]">
        <div className="flex items-center gap-2 px-4 py-2">
          <Radio size={13} className="shrink-0 text-[#e0452f]"/>
          <span className="shrink-0 font-mono text-[10px] font-bold tracking-[0.2em] text-[#e0452f]">AO VIVO</span>
          <span className="text-[#5c6f6b]">/</span>
          <span className="truncate font-mono text-[10px] tracking-[0.15em] text-[#8fa39d]">{ticker}</span>
        </div>
      </div>

      {/* Header */}
      <header className="mx-auto max-w-3xl border-b border-[#243436] px-4 pb-6 pt-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-[#f4f0e8] sm:text-4xl" style={{fontFamily:"'Archivo Black', sans-serif"}}>
              WIRE<span className="text-[#e0452f]">/</span>GEEK
            </h1>
            <div className="mt-1 font-mono text-[9px] tracking-[0.25em] text-[#5c6f6b]">BAGAÇA STUDIOS · NEWSROOM 3.0</div>
          </div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-[#5c6f6b]">GAMES · GEEK · CINEMA · ANIME</span>
        </div>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[#8fa39d]">
          Central editorial para apuração diária. 4 categorias, de 1 a 12 notícias, banners com imagens reais.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 border border-[#5fbf7a]/40 px-2 py-1 font-mono text-[10px] tracking-wider text-[#5fbf7a]">
            <CheckCircle2 size={11}/>ÚLTIMAS 48H
          </span>
          {CATEGORY_ORDER.map(cat=>(
            <span key={cat} className="inline-flex items-center gap-1.5 border border-[#3a4a4d] px-2 py-1 font-mono text-[10px] tracking-wider" style={{color:CATEGORY_COLOR[cat]}}>
              {CATEGORY_LABEL[cat]}
            </span>
          ))}
          <SchedulerBadge nextRun={nextRun} isEnabled={schedulerEnabled}/>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={generate} disabled={status==="loading"}
              className="inline-flex items-center gap-2 bg-[#e0452f] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0a1315] transition-colors hover:bg-[#f05a42] disabled:cursor-not-allowed disabled:opacity-50">
              <RefreshCw size={14} className={status==="loading"?"animate-spin":""}/>
              {status==="loading"?"Apurando...":"Apurar Notícias"}
            </button>
            <button
              type="button"
              onClick={loadArchive}
              disabled={archiveLoading}
              className="inline-flex items-center gap-2 border border-[#3a4a4d] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#d8dfd9] transition-colors hover:border-[#e0452f] hover:text-[#f4f0e8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Archive size={14}/>
              {archiveLoading ? "Carregando..." : "Arquivo de Edições"}
            </button>

            <button
              type="button"
              onClick={generateCurrentEditionBriefing}
              disabled={
                briefingImporting ||
                !edition?.news?.length
              }
              className="inline-flex items-center gap-2 bg-[#e0452f] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0a1315] transition-colors hover:bg-[#f05a42] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImageIcon size={14}/>

              {briefingImporting
                ? "Gerando banners..."
                : "Gerar banners da edição"}
            </button>

            <button
              type="button"
              onClick={() => {
                setBriefingImportOpen(current => !current);
                setBriefingError("");
              }}
              disabled={briefingImporting}
              className="inline-flex items-center gap-2 border border-[#3a4a4d] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#d8dfd9] transition-colors hover:border-[#e0452f] hover:text-[#f4f0e8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Newspaper size={14}/>
              {briefingImportOpen ? "Fechar Briefing" : "Importar Briefing"}
            </button>

            <button type="button" onClick={toggleScheduler}
              className={`inline-flex items-center gap-2 border px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${schedulerEnabled?"border-[#5fbf7a]/50 text-[#5fbf7a] hover:bg-[#5fbf7a]/10":"border-[#3a4a4d] text-[#7a8f8a] hover:border-[#5fbf7a]/50 hover:text-[#5fbf7a]"}`}>
              <Calendar size={14}/>{schedulerEnabled?"Auto às 7H · Ativo":"Ativar Auto às 7H"}
            </button>
          </div>
          {edition && (
            <div className="text-right">
              <div className="font-mono text-[10px] text-[#5c6f6b]">ÚLTIMA APURAÇÃO</div>
              <div className="font-mono text-[11px] text-[#8fa39d]">{new Date(edition.generatedAt).toLocaleTimeString("pt-BR")}</div>
            </div>
          )}
               </div>

        {briefingImportOpen && (
          <section className="mb-6 border border-[#243436] bg-[#0c1618]">
            <div className="border-b border-[#243436] px-4 py-3">
              <div className="font-mono text-[10px] font-bold tracking-[0.2em] text-[#e0452f]">
                IMPORTAR BRIEFING GEEK DIÁRIO
              </div>

              <p className="mt-2 text-[12px] leading-5 text-[#8fa39d]">
                Cole o WIREGEEK_JSON. O Wire/Geek usará o contrato editorial do Briefing,
                buscará e validará automaticamente as imagens e gerará 2 banners editoriais
                + 1 CTA para cada notícia.
              </p>
            </div>

            <div className="space-y-3 p-4">
              <textarea
                value={briefingText}
                onChange={(event) =>
                  setBriefingText(event.target.value)
                }
                disabled={briefingImporting}
                rows={14}
                spellCheck={false}
                placeholder={'WIREGEEK_JSON\n{\n  "title": "Briefing Geek Diário",\n  "news": [\n    {\n      "categoria": "anime",\n      "titulo": "...",\n      "contexto_visual": "...",\n      "image_query": "...",\n      "imagens": [],\n      "banners": [...]\n    }\n  ]\n}'}
                className="w-full resize-y border border-[#3a4a4d] bg-[#07110f] px-3 py-3 font-mono text-[11px] leading-5 text-[#d8dfd9] outline-none transition focus:border-[#e0452f] disabled:opacity-60"
              />

              <div className="border border-[#263b36] bg-[#07110f] px-3 py-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#5fbf7a]">
                  GERAÇÃO AUTOMÁTICA
                </div>

                <p className="mt-1 text-[11px] leading-5 text-[#8fa39d]">
                  Não é necessário selecionar imagens prontas.
                  Cada notícia será enviada ao modo Briefing aprovado:
                  busca real de imagens, validação visual, 2 banners editoriais e CTA.
                </p>
              </div>

              {briefingError && (
                <div className="flex items-start gap-2 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-2.5 text-[12px] text-[#f0a89a]">
                  <AlertCircle
                    size={15}
                    className="mt-0.5 shrink-0"
                  />
                  <span>{briefingError}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={importBriefing}
                  disabled={
                    briefingImporting ||
                    !briefingText.trim()
                  }
                  className="inline-flex items-center gap-2 bg-[#e0452f] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0a1315] transition-colors hover:bg-[#f05a42] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Newspaper size={14}/>

                  {briefingImporting
                    ? "Gerando..."
                    : "Importar e gerar banners"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBriefingImportOpen(false);
                    setBriefingError("");
                    setBriefingText("");
                  }}
                  disabled={briefingImporting}
                  className="border border-[#3a4a4d] px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-[#7a8f8a] transition-colors hover:border-[#e0452f] hover:text-[#e0452f] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </section>
        )}
        {archiveOpen && (
          <section className="mb-6 border border-[#243436] bg-[#0c1618]">
            <div className="flex items-center justify-between border-b border-[#243436] px-4 py-3">
              <div>
                <div className="font-mono text-[10px] font-bold tracking-[0.2em] text-[#e0452f]">
                  ARQUIVO DE EDIÇÕES
                </div>
                <div className="mt-1 font-mono text-[10px] text-[#5c6f6b]">
                  {archive.length} edição{archive.length === 1 ? "" : "ões"} armazenada{archive.length === 1 ? "" : "s"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setArchiveOpen(false)}
                className="border border-[#3a4a4d] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#7a8f8a] transition-colors hover:border-[#e0452f] hover:text-[#e0452f]"
              >
                Fechar
              </button>
            </div>

            {archiveError && (
              <div className="m-4 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-2.5 text-[12px] text-[#f0a89a]">
                {archiveError}
              </div>
            )}

            {!archiveError && archive.length === 0 && (
              <div className="px-4 py-8 text-center font-mono text-[11px] text-[#5c6f6b]">
                NENHUMA EDIÇÃO ARQUIVADA
              </div>
            )}

            {archive.length > 0 && (
              <div className="divide-y divide-[#243436]">
                {archive.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => openArchivedEdition(item)}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer px-4 py-3 transition-colors hover:bg-[#101c1e]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono text-[12px] font-bold text-[#d8dfd9]">
                        {item.titulo || "Edição Wire/Geek"}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-wider text-[#5c6f6b]">
                        {item.status || "sem status"}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[#7a8f8a]">
                      <span>
                        {item.data_edicao
                          ? new Date(item.data_edicao).toLocaleDateString("pt-BR")
                          : "Data não informada"}
                      </span>
                      <span>
                        {item.news?.length || 0} notícia{(item.news?.length || 0) === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Status grid */}
        {edition && (
          <div className="mb-5 grid grid-cols-4 border border-[#243436] bg-[#0c1618]">
            {CATEGORY_ORDER.map(cat=>{
              const count=summary.byCategory[cat]||0,color=CATEGORY_COLOR[cat];
              return (
                <div key={cat} className="border-r border-[#243436] px-3 py-2 last:border-r-0">
                  <div className="font-mono text-[9px] tracking-[0.2em]" style={{color}}>{cat}</div>
                  <div className={`mt-0.5 font-mono text-[10px] ${count > 0 ? "text-[#5fbf7a]" : "text-[#e0452f]"}`}>
                    {`${count} notícia${count===1?"":"s"}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {status==="error" && (
          <div className="mb-6 flex items-start gap-2 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-2.5 text-[13px] text-[#f0a89a]">
            <AlertCircle size={16} className="mt-0.5 shrink-0"/><span>{errorMsg}</span>
          </div>
        )}
        {status==="idle"&&!edition && (
          <div className="border border-dashed border-[#3a4a4d] px-4 py-12 text-center text-[13px] text-[#5c6f6b]">
            <div className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[#7a8f8a]">REDAÇÃO EM ESPERA</div>
            Nenhuma edição gerada hoje. Inicie a apuração ou ative o agendamento para às 7h.
          </div>
        )}
        {status==="loading"&&!edition && (
          <div className="animate-pulse border border-dashed border-[#3a4a4d] px-4 py-12 text-center text-[13px] text-[#8fa39d]">{ticker}...</div>
        )}

        {/* Filtros + cards */}
        {edition && (
          <>
            <div className="mb-4 flex flex-wrap gap-1 border-b border-[#243436] pb-4">
              <button type="button" onClick={()=>setActiveFilter("all")}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${activeFilter==="all"?"bg-[#e0452f] text-[#0a1315]":"border border-[#3a4a4d] text-[#7a8f8a] hover:border-[#e0452f] hover:text-[#e0452f]"}`}>
                Todos ({edition.news.length})
              </button>
              {CATEGORY_ORDER.map(cat=>{
                const count=summary.byCategory[cat]||0,active=activeFilter===cat,color=CATEGORY_COLOR[cat];
                return (
                  <button key={cat} type="button" onClick={()=>setActiveFilter(cat)}
                    className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors border"
                    style={{borderColor:active?color:color+"40",color:active?"#0a1315":color,backgroundColor:active?color:"transparent"}}>
                    {CATEGORY_LABEL[cat]} ({count})
                  </button>
                );
              })}
            </div>
            {BRIEFING_ONLY_LOCAL && (
              <BriefingLab />
            )}

            <div className="space-y-5">
              {filteredNews.map((item,index)=>(
                <DispatchCard key={`${item.categoria}-${index}`} item={item} index={edition.news.indexOf(item)}/>
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="mx-auto max-w-3xl border-t border-[#243436] px-4 pb-8 pt-4 sm:px-6">
        <div className="flex flex-wrap justify-between gap-2 font-mono text-[9px] text-[#4a5c58]">
          <span>WIRE/GEEK 3.0 · BAGAÇA STUDIOS</span>
          <span>EDIÇÕES SALVAS · AUTO 7H · BANNERS COM IMAGENS REAIS</span>
        </div>
      </footer>
    </div>
  );
}
