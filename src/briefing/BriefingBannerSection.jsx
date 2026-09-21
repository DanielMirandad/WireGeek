import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ImageIcon,
} from "lucide-react";
import {
  hasBriefingBannerSpecs,
  buildBriefingClientPayload,
} from "./briefing-banner-contract.js";
export default function BriefingBannerSection({ item, deriveShortTitle }) {
  const briefingReady = hasBriefingBannerSpecs(item);

  const bannerMode = "briefing";

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
  const autoGenerationRef = useRef("");

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
      let payload;
      let endpoint;
      let expectedCount;

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
            "O modo Briefing exige dois banners editoriais completos."
          );
        }

        payload =
          buildBriefingClientPayload(
            briefingItem
          );

        endpoint =
          "/api/banner-briefing";

        expectedCount = 3;

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
        data.banners.length !==
          expectedCount
      ) {
        const details =
          Array.isArray(
            data.details
          )
            ? data.details.join(
                "; "
              )
            : data.details;

        throw new Error(
          [
            details ||
              data.error ||
              `Não foi possível gerar os ${expectedCount} banners/slides.`,

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
        titulo_curto:
          item.titulo_curto ||
          deriveShortTitle(item.titulo),
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
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8ca39d]">
            GERAÇÃO DE BANNERS
          </div>
          <h3 className="mt-1 text-lg font-bold text-white">
            {item.briefing_source
              ? "Banners finais do Briefing"
              : "Gerar carrossel de 3 slides"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#a9bab5]">
            {item.briefing_source
              ? "Os banners desta notícia foram criados pelo Briefing Geek Diário e importados diretamente."
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
            BRIEFING · 3 SLIDES
          </button>


        </div>

        {!briefingReady && (
          <div className="mb-4 rounded-lg border border-[#263b36] bg-[#07110f] p-3 text-xs leading-5 text-[#7f9690]">
            O modo Briefing ficará disponível quando esta notícia tiver dois banner_title e dois highlights editoriais completos.
          </div>
        )}

        <div className="hidden">
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
          {generating ? "Gerando banners..." : "Gerar carrossel de 3 slides"}
        </button>
        </div>

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
              3 SLIDES GERADOS
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
