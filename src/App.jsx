import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Check, CheckCircle2, Clock, Copy,
  Hash, Newspaper, Radio, RefreshCw, Zap, ImageIcon, Calendar,
} from "lucide-react";

// â”€â”€â”€ CONSTANTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
const NEWS_PER_CATEGORY = 3;

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

// â”€â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  throw lastError||new Error("Falha apos multiplas tentativas.");
}
function estimateReading(text) {
  const words = String(text||"").trim().split(/\s+/).filter(Boolean);
  return { words: words.length, minutes: Math.max(1,Math.round(words.length/200)) };
}

// Remove travessÃµes de todos os campos
function removeDashes(str) {
  return String(str||"").replace(/[â€”â€“]/g, ",").replace(/\s{2,}/g, " ").trim();
}

function normalizeNewsItem(item={}) {
  return {
    categoria:    String(item.categoria||"geek").toLowerCase(),
    titulo:       removeDashes(item.titulo||"Sem titulo"),
    publicado_em: item.publicado_em||"Ultimas 24h",
    materia:      removeDashes(item.materia||""),
    highlights:   Array.isArray(item.highlights)?item.highlights.slice(0,4).map(removeDashes):[],
    hashtags:     Array.isArray(item.hashtags)?item.hashtags.slice(0,5):[],
    fontes:       Array.isArray(item.fontes)?item.fontes.slice(0,3):[],
    image_query:  item.image_query||item.titulo||"",
  };
}
function validateEdition(news) {
  if (!Array.isArray(news)||news.length!==CATEGORY_ORDER.length*NEWS_PER_CATEGORY)
    return `Aedicao precisa conter exatamente ${CATEGORY_ORDER.length*NEWS_PER_CATEGORY} noticias.`;
  for (const cat of CATEGORY_ORDER) {
    const count = news.filter(n=>n.categoria===cat).length;
    if (count!==NEWS_PER_CATEGORY) return `"${cat}" deve ter ${NEWS_PER_CATEGORY} noticias (encontrado: ${count}).`;
  }
  for (const item of news) {
    if (!item.titulo||!item.materia) return "Noticia sem titulo ou materia.";
    if (item.highlights.length!==4) return `"${item.titulo}" precisa de 4 highlights.`;
    if (item.hashtags.length!==5)   return `"${item.titulo}" precisa de 5 hashtags.`;
  }
  return null;
}

// â”€â”€â”€ BANNER PROMPT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildBannerCommand(item) {
  const highlights = (item.highlights || [])
    .slice(0, 4)
    .map((h, i) => `${i + 1}. ${h}`)
    .join("\\n");

  return `CLAUDE IA, EXECUTE ESTA TAREFA NO CANVA.

Voce e o responsavel pela criacao do banner do Wire/Geek.

NAO apenas explique.
NAO apenas escreva um prompt.
EXECUTE a criacao utilizando a integracao do Canva disponivel para voce.

MARCA:
Wire/Geek

ESTUDIO:
Bagaca Studios

CATEGORIA:
${item.categoria || ""}

TITULO:
${item.titulo || ""}

SUBTITULO:
${item.subtitulo || ""}

HIGHLIGHTS:
${highlights}

MATERIA:
${item.materia || ""}

HASHTAGS:
${(item.hashtags || []).join(" ")}

CONSULTA DE IMAGEM:
${item.image_query || item.titulo || ""}

DIRECAO VISUAL:
- Estilo jornalistico geek moderno.
- Visual impactante.
- Tipografia forte.
- Hierarquia clara entre titulo, subtitulo e imagem.
- Utilizar imagem real relacionada ao assunto.
- Manter identidade visual consistente do Wire/Geek.
- Inserir Bagaca Studios de forma discreta.
- Todo texto visual deve estar em portugues brasileiro.
- Nao inventar personagens, logos ou acontecimentos.
- Nao utilizar imagem generica quando houver imagem real apropriada.

CANVA:
1. Use o template do Wire/Geek definido para banners.
2. Crie uma nova versao do design.
3. Substitua titulo e subtitulo pelos dados da noticia.
4. Escolha uma imagem real adequada ao assunto.
5. Ajuste enquadramento, contraste e legibilidade.
6. Mantenha a identidade visual do Wire/Geek.
7. Finalize o banner pronto para revisao.
8. Retorne o link do design criado no Canva.

EXECUTE AGORA NO CANVA.`;
}

function BannerSection({ item }) {
  const [copied, setCopied] = React.useState(false);

  const command = buildBannerCommand(item);

  async function requestClaudeBanner() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);

      window.open(
        "https://claude.ai/new",
        "_blank",
        "noopener,noreferrer"
      );

      setTimeout(() => {
        setCopied(false);
      }, 5000);
    } catch (error) {
      console.error(
        "WIRE/GEEK: erro ao preparar solicitacao para Claude:",
        error
      );

      window.open(
        "https://claude.ai/new",
        "_blank",
        "noopener,noreferrer"
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#263b36] bg-[#07110f] p-4">
        <div className="mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8ca39d]">
            GERACAO DE BANNER
          </div>

          <h3 className="mt-1 text-lg font-bold text-white">
            Gerar banner com Claude + Canva
          </h3>

          <p className="mt-2 text-sm leading-6 text-[#a9bab5]">
            O Wire/Geek prepara os dados da noticia.
            O Claude IA recebe a solicitacao e executa
            a criacao do banner utilizando o Canva.
          </p>
        </div>

        <button
          type="button"
          onClick={requestClaudeBanner}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00d084] px-4 py-3 font-semibold text-black transition hover:bg-[#22e59b]"
        >
          <ImageIcon size={18} />

          {copied
            ? "Solicitacao copiada. Cole no Claude."
            : "Gerar Banner com Claude + Canva"}
        </button>

        <div className="mt-3 rounded-lg border border-[#263b36] bg-black/30 p-3">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#5c6f6b]">
            FLUXO
          </div>

          <div className="text-xs leading-5 text-[#9fb0ab]">
            1. Wire/Geek prepara os dados
            <br />
            2. Claude recebe a solicitacao
            <br />
            3. Claude executa a tarefa
            <br />
            4. Claude utiliza o Canva
            <br />
            5. Canva gera o banner
            <br />
            6. Claude retorna o link do design
          </div>
        </div>
      </div>
    </div>
  );

const tabs = [
    {id:"materia",    label:"Materia",    icon:Newspaper},
    {id:"highlights", label:"Highlights", icon:Zap},
    {id:"hashtags",   label:"Hashtags",   icon:Hash},
    {id:"banner",     label:"Banner",     icon:ImageIcon},
  ];

  return (
    <article className="relative border border-[#3a4a4d] bg-[#0f1a1c]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a4a4d] bg-[#132025] px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] text-[#7a8f8a]">DESPACHO {String(index+1).padStart(2,"0")}</span>
          <span className="border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.2em]" style={{borderColor:catColor+"80",color:catColor}}>
            {CATEGORY_LABEL[item.categoria]||"PAUTA"}
          </span>
          {item.publicado_em && (
            <span className="border border-[#5fbf7a]/40 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[#5fbf7a]">
              {item.publicado_em}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] text-[#5c6f6b]">{new Date().toLocaleDateString("pt-BR")}</span>
      </div>

      {/* Titulo */}
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-xl font-black leading-tight text-[#f4f0e8] sm:text-2xl" style={{fontFamily:"'Archivo Black', sans-serif"}}>
          {item.titulo}
        </h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-[#243436] px-4">
        {tabs.map(({id,label,icon:Icon})=>{
          const active=tab===id;
          return (
            <button key={id} type="button" onClick={()=>setTab(id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                active?"border-[#e0452f] text-[#f4f0e8]":"border-transparent text-[#7a8f8a] hover:text-[#cfd8d4]"
              }`}>
              <Icon size={12}/>{label}
            </button>
          );
        })}
      </div>

      {/* Conteudo */}
      <div className="p-4">
        {tab==="materia" && (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#5c6f6b]">
                <Clock size={11}/>{minutes} min Â· {words} palavras Â· {item.materia.length} chars
              </span>
              <CopyButton text={`${item.titulo}\n\n${item.materia}\n\n${RODAPE_FIXO}`} label="Copiar materia"/>
            </div>

            {/* Lead destacado */}
            <div className="mb-4 border-l-2 pl-3" style={{borderColor:catColor}}>
              <h5 className="text-[15px] font-black leading-snug text-[#f4f0e8]" style={{fontFamily:"'Archivo Black', sans-serif"}}>
                {item.titulo}
              </h5>
            </div>

            <div style={{fontFamily:"'Source Serif 4', Georgia, serif"}}>
              <FormattedArticle text={item.materia}/>
            </div>

            {item.fontes.length>0 && (
              <div className="mt-5 border-t border-[#243436] pt-3">
                <span className="mb-2 block font-mono text-[9px] tracking-[0.2em] text-[#5c6f6b]">FONTES DA APURACAO</span>
                <ul className="space-y-1">
                  {item.fontes.map((source,i)=>(
                    <li key={i} className="font-mono text-[10px] text-[#7a8f8a]">
                      {source.url
                        ? <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-[#3a4a4d] underline-offset-2 hover:text-[#e0452f]">{source.nome||source.url}</a>
                        : source.nome}
                      {source.publicado_em?` Â· ${source.publicado_em}`:""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 border-t border-[#243436] pt-3">
              <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#8fa39d]">{RODAPE_FIXO}</pre>
            </div>
          </div>
        )}

        {tab==="highlights" && (
          <div className="space-y-3">
            <div className="mb-1 flex items-center justify-between">
              <Stamp>Sensacionalista</Stamp>
              <CopyButton text={item.highlights.join("\n")} label="Copiar"/>
            </div>
            <ul className="space-y-2">
              {item.highlights.map((h,i)=>(
                <li key={i} className="flex gap-3 border-l-2 border-[#e0452f] bg-[#1a2628] px-3 py-2.5">
                  <span className="shrink-0 font-mono text-[10px] text-[#e0452f] mt-0.5">{i+1}</span>
                  <span className="font-mono text-[12px] leading-snug text-[#f4f0e8]">{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab==="hashtags" && (
          <div>
            <div className="mb-3 flex justify-end">
              <CopyButton text={item.hashtags.join(" ")} label="Copiar hashtags"/>
            </div>
            <div className="flex flex-wrap gap-2">
              {item.hashtags.map((tag,i)=>(
                <span key={i} className="border border-[#e0452f]/40 px-2 py-1 font-mono text-[11px] text-[#e0452f]">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {tab==="banner" && <BannerSection item={item}/>}
      </div>

      {/* Footer rodape */}
      <div className="border-t border-[#243436] bg-[#0c1618] px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.2em] text-[#5c6f6b]">RODAPE FIXO</span>
          <CopyButton text={RODAPE_FIXO} label="Copiar rodape"/>
        </div>
        <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#8fa39d]">{RODAPE_FIXO}</pre>
      </div>
    </article>
  );
}

// â”€â”€â”€ SCHEDULER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SchedulerBadge({nextRun,isEnabled}) {
  if(!isEnabled) return <span className="inline-flex items-center gap-1.5 border border-[#3a4a4d] px-2 py-1 font-mono text-[10px] tracking-wider text-[#5c6f6b]"><Calendar size={11}/>AUTO 7H Â· INATIVO</span>;
  return <span className="inline-flex items-center gap-1.5 border border-[#5fbf7a]/40 px-2 py-1 font-mono text-[10px] tracking-wider text-[#5fbf7a]"><Calendar size={11}/>AUTO 7H Â· {nextRun||"..."}</span>;
}

// â”€â”€â”€ APP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function GeekNewsWire() {
  const [status,   setStatus]   = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [edition,  setEdition]  = useState(null);
  const [ticker,   setTicker]   = useState("PREPARANDO TRANSMISSAO");
  const [schedulerEnabled, setSchedulerEnabled] = useState(false);
  const [nextRun,  setNextRun]  = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const schedulerRef = useRef(null);

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

  async function generate() {
  if (status === "loading") return;

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
          prompt: `Gere a edicao de hoje com exatamente ${
            CATEGORY_ORDER.length * NEWS_PER_CATEGORY
          } noticias reais: ${NEWS_PER_CATEGORY} de cada categoria (games, geek, cinema, anime). Todas publicadas nas ultimas 24 horas. Busque na web antes de escrever. Nunca use travessao. Responda somente com o JSON solicitado.`,
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
      throw new Error(
        `Erro no backend ${response.status}: ${body.slice(0, 300)}`
      );
    }

    const data = await response.json();

    const text = String(data?.text || "").trim();

    if (!text) {
      throw new Error("Backend nao retornou JSON.");
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
        throw new Error("JSON invalido retornado pelo backend.");
      }

      parsed = JSON.parse(cleaned.slice(start, end + 1));
    }

    const news = (parsed.news || []).map(normalizeNewsItem);

    const validationError = validateEdition(news);

    if (validationError) {
      throw new Error(validationError);
    }

    const newEdition = {
      generatedAt: new Date().toISOString(),
      news,
    };

    setEdition(newEdition);
    setStatus("done");
    setTicker(`APURACAO CONCLUIDA Â· ${news.length} DESPACHOS`);
    setActiveFilter("all");

    try {
      localStorage.setItem(todayKey(), JSON.stringify(newEdition));
    } catch {}
  } catch (err) {
    setErrorMsg(err?.message || "Falha desconhecida.");
    setStatus("error");
    setTicker("FALHA NA APURACAO");
  } finally {
    clearInterval(interval);
  }
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
            <div className="mt-1 font-mono text-[9px] tracking-[0.25em] text-[#5c6f6b]">BAGACA STUDIOS Â· NEWSROOM 3.0</div>
          </div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-[#5c6f6b]">GAMES Â· GEEK Â· CINEMA Â· ANIME</span>
        </div>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[#8fa39d]">
          Central editorial para apuracao diaria. 4 categorias, 3 noticias cada, banners no Canva com imagens reais.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 border border-[#5fbf7a]/40 px-2 py-1 font-mono text-[10px] tracking-wider text-[#5fbf7a]">
            <CheckCircle2 size={11}/>ULTIMAS 24H
          </span>
          {CATEGORY_ORDER.map(cat=>(
            <span key={cat} className="inline-flex items-center gap-1.5 border border-[#3a4a4d] px-2 py-1 font-mono text-[10px] tracking-wider" style={{color:CATEGORY_COLOR[cat]}}>
              {NEWS_PER_CATEGORY}x {CATEGORY_LABEL[cat]}
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
              {status==="loading"?"Apurando...":"Apurar Noticias"}
            </button>
            <button type="button" onClick={toggleScheduler}
              className={`inline-flex items-center gap-2 border px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${schedulerEnabled?"border-[#5fbf7a]/50 text-[#5fbf7a] hover:bg-[#5fbf7a]/10":"border-[#3a4a4d] text-[#7a8f8a] hover:border-[#5fbf7a]/50 hover:text-[#5fbf7a]"}`}>
              <Calendar size={14}/>{schedulerEnabled?"Auto 7H Â· Ativo":"Ativar Auto 7H"}
            </button>
          </div>
          {edition && (
            <div className="text-right">
              <div className="font-mono text-[10px] text-[#5c6f6b]">ULTIMA APURACAO</div>
              <div className="font-mono text-[11px] text-[#8fa39d]">{new Date(edition.generatedAt).toLocaleTimeString("pt-BR")}</div>
            </div>
          )}
        </div>

        {/* Status grid */}
        {edition && (
          <div className="mb-5 grid grid-cols-4 border border-[#243436] bg-[#0c1618]">
            {CATEGORY_ORDER.map(cat=>{
              const count=summary.byCategory[cat]||0,ok=count===NEWS_PER_CATEGORY,color=CATEGORY_COLOR[cat];
              return (
                <div key={cat} className="border-r border-[#243436] px-3 py-2 last:border-r-0">
                  <div className="font-mono text-[9px] tracking-[0.2em]" style={{color}}>{cat}</div>
                  <div className={`mt-0.5 font-mono text-[10px] ${ok?"text-[#5fbf7a]":"text-[#e0452f]"}`}>
                    {ok?`${count}/${NEWS_PER_CATEGORY} âœ“`:`${count}/${NEWS_PER_CATEGORY}`}
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
            <div className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[#7a8f8a]">REDACAO EM ESPERA</div>
            Nenhuma edicao gerada hoje. Inicie a apuracao ou ative o agendamento para as 7h.
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
          <span>WIRE/GEEK 3.0 Â· BAGACA STUDIOS</span>
          <span>EDICOES SALVAS Â· AUTO 7H Â· BANNERS COM IMAGENS REAIS</span>
        </div>
      </footer>
    </div>
  );
}






