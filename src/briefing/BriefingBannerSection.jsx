import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  hasBriefingBannerSpecs,
  buildBriefingClientPayload,
  applyManualBannerImages,
} from "./briefing-banner-contract.js";
export default function BriefingBannerSection({ item }) {
  const briefingReady = hasBriefingBannerSpecs(item);

  const bannerMode = "briefing";

  const [generating, setGenerating] = useState(false);
  const [banners, setBanners] = useState(
    Array.isArray(item.final_banners)
      ? item.final_banners
      : []
  );
  const [error, setError] = useState("");

  const [
    manualImageUrls,
    setManualImageUrls,
  ] = useState(["", ""]);
  const [updatingPublication, setUpdatingPublication] = useState(null);

  const autoGenerationRef = useRef("");

  useEffect(() => {
    setBanners(
      Array.isArray(item.final_banners)
        ? item.final_banners
        : []
    );
    setError("");
    setManualImageUrls(["", ""]);
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
      let payload;
      let endpoint;

      /*
       * ==============================================
       * BRIEFING
       * ==============================================
       */
      if (bannerMode === "briefing") {
        const briefingItem =
          item;

        if (
          !hasBriefingBannerSpecs(
            briefingItem
          )
        ) {
          throw new Error(
            "O modo Briefing exige titulo_curto canônico e exatamente dois highlights editoriais."
          );
        }

        payload =
          buildBriefingClientPayload(
            briefingItem
          );

        payload =
          applyManualBannerImages(
            payload,
            manualImageUrls
          );

        endpoint =
          "/api/banner-briefing";


        console.log(
          "WIRE/GEEK: geração pelo modo Briefing",
          {
            noticia_id:
              item.id ||
              null,

            titulo:
              item.titulo,

            quantidade:
              payload.banners.length,

            tipos:
              payload.banners.map(
                (banner) =>
                  banner.type
              ),
          }
        );
      }

            console.log(
        "WIRE/GEEK: PAYLOAD REAL /api/banner",
        JSON.stringify(
          payload,
          null,
          2
        )
      );

      const response =
        await fetch(
          endpoint,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials:
              "include",

            body:
              JSON.stringify(
                payload
              ),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success ||
        !Array.isArray(
          data.banners
        ) ||
        (data.banners.length < 2 || data.banners.length > 3)
      ) {
        const details =
          Array.isArray(
            data.details
          )
            ? data.details.join(
                "; "
              )
            : data.details;

        const diagnosticDetails = [
          `HTTP ${response.status}`,
          `code: ${
            typeof data.code === "string" &&
            data.code.trim()
              ? data.code.trim()
              : "null"
          }`,
          `error: ${
            data.error ||
            "Não foi possível gerar os banners do Briefing."
          }`,
          `details: ${details || "null"}`,
        ].join(" | ");

        console.error(
          "WIRE/GEEK: diagnóstico HTTP da geração de banners:",
          {
            status: response.status,
            code: data.code || null,
            error: data.error || null,
            details: data.details || null,
          }
        );

        throw new Error(
          [
            diagnosticDetails,
            data.aviso,
          ]
            .filter(Boolean)
            .join(" ")
        );
      }

      /*
       * O resultado materializado precisa existir tambem
       * no item compartilhado pelas abas.
       *
       * PublicationPanel le briefing_generated_banners
       * diretamente deste item.
       */
      const generatedBanners =
        data.banners.map(
          (banner) => ({
            ...banner,
          })
        );

      item.briefing_generated_banners =
        generatedBanners;

      item.final_banners =
        generatedBanners;

      item.briefing_source =
        true;

      console.log(
        "WIRE/GEEK: Briefing sincronizado com Publicacao",
        {
          noticia_id:
            item.id || null,

          publication_ids:
            generatedBanners
              .map(
                banner =>
                  Number(
                    banner?.publication_id ||
                    0
                  )
              )
              .filter(
                id => id > 0
              ),
        }
      );

      setBanners(
        generatedBanners
      );
    }
    catch (err) {
      console.error(
        "WIRE/GEEK: erro ao gerar banners:",
        err
      );

      setError(
        err.message ||
        "Erro ao gerar os banners."
      );
    }
    finally {
      setGenerating(false);
    }
  }


  useEffect(() => {
    if (banners.length > 0) {
      return;
    }

    if (generating) {
      return;
    }

    const generationKey =
      String(
        item.id ||
        item.titulo ||
        ""
      ) +
      ":" +
      bannerMode;

    if (!generationKey) {
      return;
    }

    if (
      autoGenerationRef.current === generationKey
    ) {
      return;
    }

    autoGenerationRef.current = generationKey;

    console.log(
      "WIRE/GEEK: iniciando geracao automatica de banners",
      {
        noticia_id: item.id || null,
        titulo: item.titulo,
        titulo_curto: item.titulo_curto || "",
      }
    );

    generateBanner();
  }, [
    item.id,
    item.titulo,
    bannerMode,
  ]);

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
          <div className="mb-2 rounded border border-[#263b36] bg-[#0b1714] px-2 py-1 font-mono text-[10px] text-[#8ca39d]">
            DIAGNÓSTICO BUILD 4afbd324
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8ca39d]">
            GERAÇÃO DE BANNERS
          </div>
          <h3 className="mt-1 text-lg font-bold text-white">
            {item.briefing_source
              ? "Banners finais do Briefing"
              : "Gerar banners do Briefing"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#a9bab5]">
            {item.briefing_source
              ? "Os banners desta notícia foram criados pelo Briefing Geek 2h e importados diretamente."
              : "Dois highlights, duas imagens diferentes e o modelo visual aprovado."}
          </p>
        </div>

        <div
          className={`mb-4 grid gap-2 grid-cols-1`}
        >
          <button
            type="button"
            disabled={
              generating ||
              !briefingReady
            }
            onClick={() => {
setBanners([]);
              setError("");
              autoGenerationRef.current =
                "";
            }}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
              bannerMode ===
              "briefing"
                ? "border-[#00d084] bg-[#00d084]/10 text-[#00d084]"
                : "border-[#263b36] bg-[#0f1a1c] text-[#8ca39d]"
            } ${
              !briefingReady
                ? "cursor-not-allowed opacity-40"
                : ""
            }`}
          >
            BRIEFING
          </button>


        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {[0, 1].map((index) => (
            <label
              key={index}
              className="block rounded-lg border border-[#263b36] bg-[#0b1513] p-3"
            >
              <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.16em] text-[#8ca39d]">
                Imagem manual - Banner {index + 1}
              </span>

              <input
                type="url"
                value={manualImageUrls[index]}
                disabled={generating}
                onChange={(event) => {
                  const value =
                    event.target.value;

                  setManualImageUrls(
                    (current) =>
                      current.map(
                        (currentValue, currentIndex) =>
                          currentIndex === index
                            ? value
                            : currentValue
                      )
                  );
                }}
                placeholder="https://.../imagem.jpg"
                className="w-full rounded-lg border border-[#263b36] bg-[#07110f] px-3 py-2 text-sm text-white outline-none transition placeholder:text-[#4f625d] focus:border-[#00d084]"
              />

              <span className="mt-2 block text-[11px] leading-5 text-[#6f8580]">
                Opcional. Vazio mantem a busca automatica.
              </span>
            </label>
          ))}
        </div>

        <button
          type="button"
          onClick={generateBanner}
          disabled={
            generating ||
            !briefingReady
          }
          className="mb-4 w-full rounded-lg bg-[#00d084] px-4 py-3 text-sm font-bold text-black transition hover:bg-[#22e59b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating
            ? "GERANDO..."
            : manualImageUrls.some(
                (url) =>
                  String(url).trim()
              )
              ? "GERAR COM IMAGEM MANUAL"
              : "GERAR / REGERAR BANNERS"}
        </button>


        {!briefingReady && (
          <div className="mb-4 rounded-lg border border-[#263b36] bg-[#07110f] p-3 text-xs leading-5 text-[#7f9690]">
            O modo Briefing ficará disponível quando esta notícia tiver titulo_curto canônico e exatamente dois highlights editoriais completos.
          </div>
        )}

        {banners.length === 0 && !error && (
          <div className="rounded-lg border border-[#263b36] bg-[#07110f] p-3 text-sm text-[#a9bab5]">
            {generating
              ? "Buscando duas imagens diferentes e gerando os banners..."
              : "Preparando geração automática dos banners..."}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {banners.length > 0 && (
          <div className="mt-4 space-y-4">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#5c6f6b]">
              {banners.length} SLIDES GERADOS
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
