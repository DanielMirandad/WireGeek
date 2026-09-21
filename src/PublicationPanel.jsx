import { useEffect, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Radio,
} from "lucide-react";

export default function PublicationPanel({ item }) {
  const generatedSlides =
    Array.isArray(item?.briefing_generated_banners)
      ? item.briefing_generated_banners
      : [];

  const editorialSlides =
    generatedSlides.filter(
      (slide) =>
        slide?.type === "editorial" &&
        Number(slide?.publication_id) > 0
    );

  const publicationId =
    Number(
      editorialSlides[0]?.publication_id ||
      0
    );

  /*
   * Uma nova geracao pode reutilizar os mesmos
   * publication_id enquanto atualiza banner_url
   * e publication_group_id no backend.
   *
   * Por isso publicationId sozinho nao e suficiente
   * para invalidar o grupo carregado no componente.
   */
  const publicationRefreshKey =
    editorialSlides
      .map(
        (slide) =>
          [
            Number(
              slide?.publication_id ||
              0
            ),
            String(
              slide?.banner_url ||
              ""
            ),
          ].join(":")
      )
      .join("|");

  const [group, setGroup] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [actionId, setActionId] =
    useState(null);

  const [actionError, setActionError] =
    useState("");

  async function loadGroup() {
    if (!publicationId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response =
        await fetch(
          `/api/publicacoes?id=${encodeURIComponent(
            publicationId
          )}`,
          {
            method: "GET",
            credentials: "include",
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.details ||
          data?.error ||
          `Falha ao carregar grupo. HTTP ${response.status}.`
        );
      }

      setGroup(data);
    }
    catch (err) {
      setError(
        err?.message ||
        "Nao foi possivel carregar a publicacao."
      );
    }
    finally {
      setLoading(false);
    }
  }

  async function updatePublication(id, acao) {
    const publicationId = Number(id);

    if (
      !Number.isInteger(publicationId) ||
      publicationId <= 0 ||
      !["aprovar", "rejeitar"].includes(acao)
    ) {
      return;
    }

    setActionId(publicationId);
    setActionError("");

    try {
      const response =
        await fetch(
          "/api/publicacoes",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              id: publicationId,
              acao,
            }),
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.details ||
          data?.error ||
          `Falha ao atualizar publicação. HTTP ${response.status}.`
        );
      }

      await loadGroup();
    }
    catch (err) {
      setActionError(
        err?.message ||
        "Não foi possível atualizar a publicação."
      );
    }
    finally {
      setActionId(null);
    }
  }

  useEffect(() => {
    setGroup(null);
    setError("");

    if (publicationId) {
      console.log(
        "WIRE/GEEK: recarregando grupo de publicacao",
        {
          publication_id:
            publicationId,

          refresh_key:
            publicationRefreshKey,
        }
      );

      loadGroup();
    }
  }, [
    publicationId,
    publicationRefreshKey,
  ]);

  if (!publicationId) {
    return (
      <div className="border border-[#3a4a4d] bg-[#0b1416] px-3 py-4">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a8f8a]">
          Publicação indisponível
        </div>

        <p className="mt-2 font-mono text-[11px] leading-5 text-[#5c6f6b]">
          Esta notícia ainda não possui publicações materializadas pelo modo Briefing.
        </p>
      </div>
    );
  }

  const rows =
    Array.isArray(group?.publicacoes)
      ? group.publicacoes
      : [];

  const published =
    rows.some(
      (row) =>
        row?.status === "PUBLICADO" ||
        Boolean(row?.published_at) ||
        Boolean(row?.instagram_post_id)
    );

  const permalink =
    String(
      rows.find(
        (row) =>
          String(
            row?.instagram_url ||
            ""
          ).trim()
      )?.instagram_url ||
      ""
    ).trim();

  return (
    <div className="space-y-4">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243436] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Radio
              size={13}
              className="text-[#e0452f]"
            />

            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#f4f0e8]">
              Publicação
            </span>
          </div>

          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#667b77]">
            2 editoriais + CTA · Instagram
          </p>
        </div>

        <button
          type="button"
          onClick={loadGroup}
          disabled={loading}
          className="inline-flex items-center gap-1.5 border border-[#3a4a4d] px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider text-[#8fa39d] transition hover:border-[#e0452f] hover:text-[#e0452f] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw
            size={11}
            className={
              loading
                ? "animate-spin"
                : ""
            }
          />

          {loading
            ? "Atualizando..."
            : "Atualizar status"}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#f0a89a]">
          <AlertCircle
            size={14}
            className="mt-0.5 shrink-0"
          />

          <span>{error}</span>
        </div>
      )}

    {actionError && (
      <div className="flex items-start gap-2 border border-[#e0452f]/50 bg-[#1a1214] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#f0a89a]">
        <AlertCircle
          size={14}
          className="mt-0.5 shrink-0"
        />

        <span>{actionError}</span>
      </div>
    )}

      {!error &&
        loading &&
        rows.length === 0 && (
          <div className="border border-[#263b36] bg-[#0b1416] px-3 py-4 font-mono text-[11px] text-[#7a8f8a]">
            Carregando grupo de publicação...
          </div>
        )}

      {!error &&
        !loading &&
        group &&
        rows.length !== 2 && (
          <div className="border border-[#e0452f]/50 bg-[#1a1214] px-3 py-3 font-mono text-[10px] text-[#f0a89a]">
            Grupo inconsistente: esperados 2 editoriais, recebidos {rows.length}.
          </div>
        )}

      {rows.length === 2 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map(
              (row, index) => {
                const status =
                  String(
                    row?.status ||
                    "DESCONHECIDO"
                  );

                const success =
                  status === "APROVADO" ||
                  status === "PUBLICADO";

                return (
                  <div
                    key={row.id}
                    className="border border-[#344447] bg-[#101b1e] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">

                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#667b77]">
                          Editorial{" "}
                          {row.carousel_position ||
                            index + 1}
                        </div>

                        <div
                          className={`mt-1 flex items-center gap-1.5 font-mono text-[10px] font-bold ${
                            success
                              ? "text-[#5fbf7a]"
                              : status === "REJEITADO"
                                ? "text-[#e0452f]"
                                : "text-[#d8dfd9]"
                          }`}
                        >
                          {success && (
                            <CheckCircle2
                              size={11}
                            />
                          )}

                          {status}
                        </div>
                      </div>

                      <span className="font-mono text-[9px] text-[#5c6f6b]">
                        ID {row.id}
                      </span>
                    </div>

                  {row.banner_url && (
                    <div className="mt-3 space-y-2">
                      <a
                        href={row.banner_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden border border-[#263b36] bg-[#0b1416]"
                      >
                        <img
                          src={row.banner_url}
                          alt={`Preview do editorial ${
                            row.carousel_position ||
                            index + 1
                          }`}
                          loading="lazy"
                          className="block h-auto w-full object-contain"
                        />
                      </a>

                      <a
                        href={row.banner_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block font-mono text-[9px] uppercase tracking-wider text-[#7a8f8a] underline hover:text-[#f4f0e8]"
                      >
                        Abrir banner
                      </a>
                    </div>
                  )}

                  {status === "AGUARDANDO_APROVACAO" && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updatePublication(
                            row.id,
                            "aprovar"
                          )
                        }
                        disabled={actionId !== null}
                        className="border border-[#5fbf7a]/60 bg-[#0c1813] px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wider text-[#5fbf7a] transition hover:bg-[#10241a] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {actionId === row.id
                          ? "Processando..."
                          : "Aprovar"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updatePublication(
                            row.id,
                            "rejeitar"
                          )
                        }
                        disabled={actionId !== null}
                        className="border border-[#e0452f]/60 bg-[#1a1214] px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wider text-[#e0452f] transition hover:bg-[#241619] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {actionId === row.id
                          ? "Processando..."
                          : "Rejeitar"}
                      </button>
                    </div>
                  )}

                    {row.instagram_status && (
                      <div className="mt-3 border-t border-[#243436] pt-2 font-mono text-[9px] text-[#667b77]">
                        Instagram:{" "}
                        <span className="text-[#8fa39d]">
                          {row.instagram_status}
                        </span>
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>

          <div className="border border-[#263b36] bg-[#0b1416] p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#667b77]">
              Grupo
            </div>

            <div className="mt-1 break-all font-mono text-[10px] text-[#8fa39d]">
              {group.publication_group_id}
            </div>
          </div>

          {published && (
            <div className="border border-[#5fbf7a]/40 bg-[#0c1813] p-3">

              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#5fbf7a]">
                Publicado no Instagram
              </div>

              {permalink && (
                <a
                  href={permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-mono text-[10px] text-[#d8dfd9] underline hover:text-[#5fbf7a]"
                >
                  Abrir publicação
                </a>
              )}
            </div>
          )}
        </>
      )}

      <div className="border border-[#3a4a4d] bg-[#0b1416] px-3 py-2.5 font-mono text-[9px] leading-5 text-[#5c6f6b]">
      Aprovação editorial habilitada. Esta tela ainda não cria containers nem publica no Instagram.
      </div>

    </div>
  );
}
