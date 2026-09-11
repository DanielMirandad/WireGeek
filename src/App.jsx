import { cleanEditorialText } from "../lib/editorial-rules.mjs";
import { buildBannerRequest } from "../lib/banner-request.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Check, CheckCircle2, Clock, Copy,
  Hash, Newspaper, Radio, RefreshCw, Zap, ImageIcon,
  Calendar, Archive,
} from "lucide-react";

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
  return cleanEditorialText(str);
}

function normalizeNewsItem(item={}) {
  return {
    id:             item.id,
    categoria:      String(item.categoria||"geek").toLowerCase(),
    titulo:         removeDashes(item.titulo||"Sem título"),
    titulo_curto:   removeDashes(item.titulo_curto||item.short_title||""),
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
    final_banners:  Array.isArray(item.final_banners)?item.final_banners.slice(0,2):[],
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
function BannerSection({ item }) {
  const [generating, setGenerating] = useState(false);
  const [banners, setBanners] = useState(
    Array.isArray(item.final_banners)
      ? item.final_banners
      : []
  );
  const [error, setError] = useState("");
  const [updatingPublication, setUpdatingPublication] = useState(null);

  const [shortTitle, setShortTitle] = useState(item.titulo_curto || "");
  const [imageOverrides, setImageOverrides] = useState(["", ""]);

  useEffect(() => {
    setShortTitle(item.titulo_curto || "");
    setImageOverrides(["", ""]);
    setBanners(
      Array.isArray(item.final_banners)
        ? item.final_banners
        : []
    );
    setError("");
    setUpdatingPublication(null);
  }, [
    item.id,
    item.titulo,
    item.titulo_curto,
    item.final_banners,
  ]);

  async function generateBanner() {
    setGenerating(true);
    setError("");
    setBanners([]);

    try {
      const payload = buildBannerRequest(item, { shortTitle, images: imageOverrides });

      // Em modo automatico, nenhuma imagem deve chegar preselecionada
      // dentro dos banners. O backend escolhe as duas imagens distintas.
      if (payload.image_mode === "automatic" && Array.isArray(payload.banners)) {
        payload.banners = payload.banners.map((banner) => ({
          ...banner,
          image_url: "",
        }));
      }

      console.log(
        "WIRE/GEEK: PAYLOAD REAL /api/banner",
        JSON.stringify(payload, null, 2)
      );
      const response = await fetch("/api/banner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.banners) || data.banners.length !== 2) {
        const details = Array.isArray(data.details) ? data.details.join("; ") : data.details;
        throw new Error([
          details || data.error || "Não foi possível gerar os dois banners.",
          data.aviso,
        ].filter(Boolean).join(" "));
      }

      setBanners(data.banners);
    } catch (err) {
      console.error("WIRE/GEEK: erro ao gerar banners:", err);
      setError(err.message || "Erro ao gerar os banners.");
    } finally {
      setGenerating(false);
    }
  }

  async function updatePublication(publicationId, acao) {
    if (!publicationId) return;

    setUpdatingPublication(publicationId);
    setError("");

    try {
      const response = await fetch("/api/publicacoes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: publicationId,
          acao,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success || !data.publicacao) {
        throw new Error(
          data.details ||
          data.error ||
          "Não foi possível atualizar a publicação."
        );
      }

      setBanners(current =>
        current.map(banner =>
          banner.publication_id === publicationId
            ? {
                ...banner,
                status: data.publicacao.status,
              }
            : banner
        )
      );
    } catch (err) {
      console.error("WIRE/GEEK: erro ao atualizar publicação:", err);
      setError(err.message || "Erro ao atualizar a publicação.");
    } finally {
      setUpdatingPublication(null);
    }
  }

  async function dryRunPublication(publicationId) {
    if (!publicationId) return;

    setUpdatingPublication(publicationId);
    setError("");

    try {
      const response = await fetch("/api/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: publicationId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success || !data.dry_run) {
        throw new Error(
          data?.error ||
          data?.details ||
          "Nao foi possivel testar a publicacao."
        );
      }

      setBanners((current) =>
        current.map((banner) =>
          banner.publication_id === publicationId
            ? {
                ...banner,
                publish_dry_run: true,
              }
            : banner
        )
      );
    } catch (err) {
      console.error(
        "WIRE/GEEK: erro no dry-run de publicacao:",
        err
      );
      setError(
        err.message ||
        "Erro ao testar a publicacao."
      );
    } finally {
      setUpdatingPublication(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#263b36] bg-[#07110f] p-4">
        <div className="mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8ca39d]">
            GERAÇÃO DE BANNERS
          </div>
          <h3 className="mt-1 text-lg font-bold text-white">
            {item.briefing_source
              ? "Banners finais do Briefing"
              : "Gerar dois banners Wire/Geek"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#a9bab5]">
            {item.briefing_source
              ? "Os banners desta notícia foram criados pelo Briefing Geek Diário e importados diretamente."
              : "Dois highlights, duas imagens diferentes e o modelo visual aprovado."}
          </p>
        </div>

        <div className={item.briefing_source ? "hidden" : ""}>
        <label className="mb-4 block text-sm text-[#a9bab5]">
          Título do banner
          <input
            value={shortTitle}
            onChange={event => setShortTitle(event.target.value)}
            maxLength={24}
            disabled={generating}
            placeholder="Nome do assunto, como One Piece"
            className="mt-2 w-full rounded-lg border border-[#263b36] bg-[#0f1a1c] px-3 py-2 text-white"
          />
        </label>

        <details className="mb-4 text-sm text-[#a9bab5]">
          <summary className="cursor-pointer">Escolher as duas imagens</summary>
          <p className="my-2">
            Deixe os campos vazios para buscar imagens. Para escolher as fotos, informe as duas URLs.
          </p>
          {imageOverrides.map((url, index) => (
            <label key={index} className="mb-3 block">
              Imagem {index + 1}
              <input
                type="url"
                value={url}
                onChange={event =>
                  setImageOverrides(current =>
                    current.map((value, position) =>
                      position === index ? event.target.value : value
                    )
                  )
                }
                disabled={generating}
                placeholder="https://.../foto.jpg"
                className="mt-1 w-full rounded-lg border border-[#263b36] bg-[#0f1a1c] px-3 py-2 text-white"
              />
            </label>
          ))}
        </details>

        <button
          type="button"
          onClick={generateBanner}
          disabled={generating}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00d084] px-4 py-3 font-semibold text-black transition hover:bg-[#22e59b] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ImageIcon size={18} />
          {generating ? "Gerando banners..." : "Gerar dois banners"}
        </button>
        </div>

        {item.briefing_source && banners.length !== 2 && (
          <div className="rounded-lg border border-[#263b36] bg-[#07110f] p-3 text-sm text-[#a9bab5]">
            Os dois banners finais ainda não estão vinculados a esta notícia.
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {banners.length === 2 && (
          <div className="mt-4 space-y-4">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#5c6f6b]">
              DOIS BANNERS GERADOS
            </div>

            {banners.map((bannerItem, index) => {
              const source = bannerItem.banner_url ||
                (bannerItem.data?.startsWith("data:")
                  ? bannerItem.data
                  : bannerItem.data
                    ? `data:${bannerItem.mimeType};base64,${bannerItem.data}`
                    : "");

              return (
                <div
                  key={bannerItem.banner_url || index}
                  className="overflow-hidden rounded-lg border border-[#263b36] bg-[#0b1513]"
                >
                  <img
                    src={source}
                    alt={`${bannerItem.titulo_curto || item.titulo || "Banner"} ${index + 1}`}
                    className="w-full"
                  />

                  <div className="p-3">
                    {bannerItem.publication_id ? (
                      <>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#7f9690]">
                            PUBLICAÇÃO #{bannerItem.publication_id}
                          </span>

                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#a9bab5]">
                            {bannerItem.status || "AGUARDANDO_APROVACAO"}
                          </span>
                        </div>

                        {bannerItem.status === "AGUARDANDO_APROVACAO" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updatePublication(
                                  bannerItem.publication_id,
                                  "aprovar"
                                )
                              }
                              disabled={
                                updatingPublication ===
                                bannerItem.publication_id
                              }
                              className="rounded-lg bg-[#00d084] px-3 py-2 text-sm font-bold text-black transition hover:bg-[#22e59b] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {updatingPublication === bannerItem.publication_id
                                ? "Salvando..."
                                : "APROVAR"}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                updatePublication(
                                  bannerItem.publication_id,
                                  "rejeitar"
                                )
                              }
                              disabled={
                                updatingPublication ===
                                bannerItem.publication_id
                              }
                              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              REJEITAR
                            </button>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-[#263b36] bg-[#07110f] px-3 py-2 text-center text-sm font-semibold text-[#a9bab5]">
                            {bannerItem.status === "APROVADO" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  dryRunPublication(
                                    bannerItem.publication_id
                                  )
                                }
                                disabled={
                                  updatingPublication ===
                                  bannerItem.publication_id
                                }
                                className="w-full rounded-lg bg-[#00d084] px-3 py-2 text-sm font-bold text-black transition hover:bg-[#22e59b] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {updatingPublication ===
                                bannerItem.publication_id
                                  ? "Testando..."
                                  : bannerItem.publish_dry_run
                                    ? "DRY-RUN OK"
                                    : "PUBLICAR (TESTE)"}
                              </button>
                            ) : bannerItem.status === "REJEITADO"
                              ? "PUBLICAÇÃO REJEITADA"
                              : bannerItem.status}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center text-xs text-[#7f9690]">
                        Banner gerado sem registro de aprovação.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// --- APP ---
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

function DispatchCard({ item, index }) {
  const [tab, setTab] = useState("materia");
  const { words, minutes } = estimateReading(item.materia);
  const catColor = CATEGORY_COLOR[item.categoria] || "#e0452f";

  const tabs = [
    { id: "materia", label: "Matéria", icon: Newspaper },
    { id: "highlights", label: "Highlights", icon: Zap },
    { id: "hashtags", label: "Hashtags", icon: Hash },
    { id: "banner", label: "Banner", icon: ImageIcon },
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

                {tab === "banner" && (
          <BannerSection item={item} />
        )}

      </div>
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
  const [briefingBannerFiles, setBriefingBannerFiles] = useState([]);
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

  async function importBriefing() {
    if (briefingImporting) return;

    const payload = briefingText.trim();

    if (!payload) {
      setBriefingError(
        "Cole o bloco WIREGEEK_JSON do Briefing Geek Diário."
      );
      return;
    }

    if (briefingBannerFiles.length !== 10) {
      setBriefingError(
        "Selecione exatamente os 10 banners finais do Briefing Geek Diário."
      );
      return;
    }

    const invalidFile =
      briefingBannerFiles.find(
        file =>
          !/^image\/(png|jpeg|webp)$/i.test(
            file.type || ""
          ) ||
          file.size > 10 * 1024 * 1024
      );

    if (invalidFile) {
      setBriefingError(
        "Todos os banners devem ser PNG, JPEG ou WebP e ter no máximo 10 MB."
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

      const news =
        data.edition.news.map(
          normalizeNewsItem
        );

      const validationError =
        validateEdition(news);

      if (validationError) {
        throw new Error(validationError);
      }

      if (news.length !== 5) {
        throw new Error(
          `O Briefing deve conter exatamente 5 notícias. Foram recebidas ${news.length}.`
        );
      }

      const importedBanners =
        news.map(() => []);

      let uploadedCount = 0;

      for (
        let newsIndex = 0;
        newsIndex < news.length;
        newsIndex++
      ) {
        const item = news[newsIndex];
        const noticiaId = Number(item.id);

        if (
          !Number.isInteger(noticiaId) ||
          noticiaId <= 0
        ) {
          throw new Error(
            `A notícia ${newsIndex + 1} não recebeu um noticia_id válido.`
          );
        }

        for (
          let bannerIndex = 0;
          bannerIndex < 2;
          bannerIndex++
        ) {
          const fileIndex =
            newsIndex * 2 + bannerIndex;

          const file =
            briefingBannerFiles[fileIndex];

          const bannerSpec =
            Array.isArray(item.banners)
              ? item.banners[bannerIndex]
              : null;

          const headline = String(
            bannerSpec?.banner_title ||
            item.highlights?.[bannerIndex] ||
            item.titulo_curto ||
            item.titulo ||
            ""
          ).trim();

          if (!file) {
            throw new Error(
              `Banner ${fileIndex + 1} não encontrado.`
            );
          }

          if (!headline) {
            throw new Error(
              `Headline ausente para o banner ${fileIndex + 1}.`
            );
          }

          setTicker(
            `IMPORTANDO BANNER ${fileIndex + 1}/10 · NOTÍCIA ${newsIndex + 1}/5`
          );

          const url =
            "/api/banner" +
            "?mode=briefing-final" +
            "&noticia_id=" +
            encodeURIComponent(noticiaId) +
            "&headline=" +
            encodeURIComponent(headline);

          const bannerResponse =
            await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type":
                  file.type ||
                  "image/png",
              },
              credentials: "include",
              body: file,
            });

          const bannerData =
            await bannerResponse
              .json()
              .catch(() => ({}));

          if (
            !bannerResponse.ok ||
            !bannerData?.success
          ) {
            throw new Error(
              [
                `Falha ao importar o banner ${fileIndex + 1}/10.`,
                bannerData?.details ||
                  bannerData?.error,
                uploadedCount
                  ? `${uploadedCount} banner(s) já foram salvos antes da falha.`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")
            );
          }

          importedBanners[
            newsIndex
          ].push(bannerData);

          uploadedCount += 1;
        }
      }

      const newsWithFinalBanners =
        news.map(
          (item, index) => ({
            ...item,
            final_banners:
              importedBanners[index],
          })
        );

      const newEdition = {
        title:
          data.edition.title ||
          "Briefing Geek Diário",

        generatedAt:
          data.edition.generatedAt ||
          new Date().toISOString(),

        news: newsWithFinalBanners,
      };

      setEdition(newEdition);
      setStatus("done");

      setTicker(
        `BRIEFING IMPORTADO · ${newsWithFinalBanners.length} DESPACHOS · 10 BANNERS`
      );

      setActiveFilter("all");
      setBriefingImportOpen(false);
      setBriefingText("");
      setBriefingBannerFiles([]);

      try {
        localStorage.setItem(
          todayKey(),
          JSON.stringify(newEdition)
        );
      } catch {}
    } catch (error) {
      setBriefingError(
        error?.message ||
        "Não foi possível importar o Briefing Geek Diário."
      );

      setTicker(
        "FALHA NA IMPORTAÇÃO DO BRIEFING"
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
                Cole o WIREGEEK_JSON e selecione os 10 banners finais. O WireGeek salvará 2 banners para cada uma das 5 notícias e enviará tudo para aprovação.
              </p>
            </div>

            <div className="space-y-3 p-4">
              <textarea
                value={briefingText}
                onChange={(event) => setBriefingText(event.target.value)}
                disabled={briefingImporting}
                rows={12}
                spellCheck={false}
                placeholder={'WIREGEEK_JSON\n{\n  "title": "Briefing Geek Diário",\n  "news": [...]\n}'}
                className="w-full resize-y border border-[#3a4a4d] bg-[#07110f] px-3 py-3 font-mono text-[11px] leading-5 text-[#d8dfd9] outline-none transition focus:border-[#e0452f] disabled:opacity-60"
              />

              <div className="border border-[#3a4a4d] bg-[#07110f] p-3">
                <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#d8dfd9]">
                  10 banners finais
                </label>

                <p className="mt-1 text-[11px] leading-5 text-[#7a8f8a]">
                  Selecione os 10 arquivos de uma vez. Eles serão ordenados pelo nome: 1–2 para a notícia 1, 3–4 para a notícia 2, até 9–10 para a notícia 5.
                </p>

                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  disabled={briefingImporting}
                  onChange={(event) => {
                    const selected =
                      Array.from(
                        event.target.files || []
                      ).sort((a, b) =>
                        a.name.localeCompare(
                          b.name,
                          undefined,
                          {
                            numeric: true,
                            sensitivity: "base",
                          }
                        )
                      );

                    setBriefingBannerFiles(
                      selected
                    );

                    if (
                      selected.length !== 10
                    ) {
                      setBriefingError(
                        `Selecione exatamente 10 banners. Selecionados: ${selected.length}.`
                      );
                    } else {
                      setBriefingError("");
                    }
                  }}
                  className="mt-3 block w-full text-[11px] text-[#8fa39d] file:mr-3 file:border-0 file:bg-[#243436] file:px-3 file:py-2 file:font-mono file:text-[10px] file:font-bold file:uppercase file:text-[#f4f0e8]"
                />

                <div className="mt-2 font-mono text-[10px] text-[#8fa39d]">
                  {briefingBannerFiles.length}/10 selecionados
                </div>

                {briefingBannerFiles.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto border-t border-[#243436] pt-2">
                    {briefingBannerFiles.map(
                      (file, index) => (
                        <div
                          key={`${file.name}-${file.size}-${index}`}
                          className="font-mono text-[9px] leading-5 text-[#5c6f6b]"
                        >
                          {String(
                            index + 1
                          ).padStart(
                            2,
                            "0"
                          )}{" · "}
                          {file.name}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {briefingError && (
                <div className="flex items-start gap-2 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-2.5 text-[12px] text-[#f0a89a]">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{briefingError}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={importBriefing}
                  disabled={
                    briefingImporting ||
                    !briefingText.trim() ||
                    briefingBannerFiles.length !== 10
                  }
                  className="inline-flex items-center gap-2 bg-[#e0452f] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0a1315] transition-colors hover:bg-[#f05a42] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Newspaper size={14}/>
                  {briefingImporting ? "Importando..." : "Importar e salvar"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBriefingImportOpen(false);
                    setBriefingError("");
                    setBriefingBannerFiles([]);
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
