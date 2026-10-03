import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

function normalizeSiteEditorialBody(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n\n");
}

function normalizeSiteEditorialExcerpt(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function validateSiteEditorialDraft({
  body,
  excerpt,
}) {
  const normalizedBody =
    normalizeSiteEditorialBody(
      body
    );

  const normalizedExcerpt =
    normalizeSiteEditorialExcerpt(
      excerpt
    );

  const paragraphs =
    normalizedBody
      ? normalizedBody.split(
          /\n\s*\n/
        )
      : [];

  const errors = [];

  if (
    normalizedBody.length < 1800 ||
    normalizedBody.length > 3500
  ) {
    errors.push(
      "A materia precisa ter entre 1800 e 3500 caracteres."
    );
  }

  if (
    paragraphs.length < 6 ||
    paragraphs.length > 10
  ) {
    errors.push(
      "A materia precisa ter entre 6 e 10 paragrafos."
    );
  }

  if (
    normalizedExcerpt.length < 120 ||
    normalizedExcerpt.length > 280
  ) {
    errors.push(
      "O resumo precisa ter entre 120 e 280 caracteres."
    );
  }

  return {
    valid:
      errors.length === 0,

    body:
      normalizedBody,

    excerpt:
      normalizedExcerpt,

    bodyLength:
      normalizedBody.length,

    excerptLength:
      normalizedExcerpt.length,

    paragraphCount:
      paragraphs.length,

    errors,
  };
}

export default function SitePublicationPanel({
  item,
  publications = [],
}) {
  const noticiaId =
    Number(
      item?.id ||
      item?.noticia_id ||
      0
    );

  const mountedRef =
    useRef(true);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    publishing,
    setPublishing,
  ] =
    useState(false);

  const [
    publication,
    setPublication,
  ] =
    useState(null);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    manualImageUrl,
    setImageUrl,
  ] =
    useState(null);

  const approvedImageUrl = publications
    .filter((row) =>
      Number(row?.noticia_id) === noticiaId &&
      ["APROVADO", "PUBLICANDO", "PUBLICADO"].includes(row?.status)
    )
    .sort((a, b) => Number(a.carousel_position) - Number(b.carousel_position))
    .map((row) => String(row.source_image_url || "").trim())
    .find((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    }) || "";

  // An explicit manual edit, including clearing the field, wins over hydration.
  const imageUrl = manualImageUrl ?? (publication?.image_url || approvedImageUrl);

  const [
    generating,
    setGenerating,
  ] =
    useState(false);

  const [
    siteExcerpt,
    setSiteExcerpt,
  ] =
    useState("");

  const [
    siteBody,
    setSiteBody,
  ] =
    useState("");

  const [
    editorialApproved,
    setEditorialApproved,
  ] =
    useState(false);

  const loadStatus =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        if (
          !Number.isInteger(
            noticiaId
          ) ||
          noticiaId <= 0
        ) {
          return null;
        }

        if (!silent) {
          setLoading(true);
          setError("");
        }

        try {
          const response =
            await fetch(
              `/api/publicacoes?mode=site-publish&noticia_id=${encodeURIComponent(
                noticiaId
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
              data?.error ||
              `Falha verificando site. HTTP ${response.status}.`
            );
          }

          if (!mountedRef.current) {
            return null;
          }

          const current =
            data?.published === true
              ? data?.data || null
              : null;

          setPublication(
            current
          );

          if (current?.excerpt) {
            setSiteExcerpt(
              (currentValue) =>
                currentValue ||
                current.excerpt
            );
          }

          if (current?.body) {
            setSiteBody(
              (currentValue) =>
                currentValue ||
                current.body
            );
          }

          return current;
        } catch (err) {
          if (
            mountedRef.current &&
            !silent
          ) {
            setError(
              err?.message ||
              "Nao foi possivel verificar o site."
            );
          }

          return null;
        } finally {
          if (
            mountedRef.current &&
            !silent
          ) {
            setLoading(false);
          }
        }
      },
      [
        noticiaId,
      ]
    );

  useEffect(() => {
    setImageUrl(null);
    setPublication(null);
    setSiteExcerpt("");
    setSiteBody("");
    setEditorialApproved(false);
    setError("");
  }, [
    noticiaId,
  ]);

  useEffect(() => {
    mountedRef.current =
      true;

    loadStatus();

    return () => {
      mountedRef.current =
        false;
    };
  }, [
    loadStatus,
  ]);

  const editorialValidation =
    validateSiteEditorialDraft({
      body:
        siteBody,

      excerpt:
        siteExcerpt,
    });

  async function generateEditorial() {
    if (
      generating ||
      publishing ||
      loading ||
      !Number.isInteger(
        noticiaId
      ) ||
      noticiaId <= 0
    ) {
      return;
    }

    setGenerating(true);
    setEditorialApproved(false);
    setError("");

    try {
      const response =
        await fetch(
          "/api/publicacoes?mode=site-publish",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials:
              "include",

            body:
              JSON.stringify({
                action:
                  "generate-editorial",

                force_regenerate: Boolean(siteBody),

                noticia_id:
                  noticiaId,
              }),
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        const details =
          Array.isArray(
            data?.details
          )
            ? data.details.join(" ")
            : typeof data?.details === "string"
              ? data.details
              : "";

        throw new Error(
          [
            data?.error,
            details,
          ]
            .filter(Boolean)
            .join(" ") ||
          "Falha gerando materia. HTTP " +
            response.status +
            "."
        );
      }

      const generatedBody =
        String(
          data?.data?.materia_site ||
          ""
        );

      const generatedExcerpt =
        String(
          data?.data?.resumo_site ||
          ""
        );

      if (
        !generatedBody ||
        !generatedExcerpt
      ) {
        throw new Error(
          "O backend nao retornou materia e resumo editoriais."
        );
      }

      if (!mountedRef.current) {
        return;
      }

      setSiteBody(
        generatedBody
      );

      setSiteExcerpt(
        generatedExcerpt
      );

      setEditorialApproved(
        false
      );
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err?.message ||
          "Nao foi possivel gerar a materia do site."
        );
      }
    } finally {
      if (mountedRef.current) {
        setGenerating(false);
      }
    }
  }

  function approveEditorial() {
    if (!editorialValidation.valid) {
      setEditorialApproved(
        false
      );

      setError(
        editorialValidation.errors[0] ||
        "Materia editorial invalida."
      );

      return;
    }

    setError("");
    setEditorialApproved(true);
  }

  async function publish() {
    if (
      publishing ||
      generating ||
      !Number.isInteger(
        noticiaId
      ) ||
      noticiaId <= 0
    ) {
      return;
    }

    if (!editorialValidation.valid) {
      setError(
        editorialValidation.errors[0] ||
        "Materia editorial invalida."
      );

      return;
    }

    if (!editorialApproved) {
      setError(
        "Aprove a materia antes de publicar no site."
      );

      return;
    }

    const officialImageUrl =
      String(
        imageUrl || ""
      ).trim();

    if (!officialImageUrl) {
      setError(
        "Informe uma imagem oficial para publicar no site."
      );
      return;
    }

    let parsedImageUrl;

    try {
      parsedImageUrl =
        new URL(
          officialImageUrl
        );
    } catch {
      setError(
        "A URL da imagem oficial e invalida."
      );
      return;
    }

    if (
      parsedImageUrl.protocol !== "https:" ||
      parsedImageUrl.username ||
      parsedImageUrl.password
    ) {
      setError(
        "A imagem oficial precisa usar HTTPS."
      );
      return;
    }

    setPublishing(true);
    setError("");

    try {
      const response =
        await fetch(
          "/api/publicacoes?mode=site-publish",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials:
              "include",

            body:
              JSON.stringify({
                action:
                  "publish",

                noticia_id:
                  noticiaId,

                image_url:
                  officialImageUrl,

                materia_site:
                  editorialValidation.body,

                resumo_site:
                  editorialValidation.excerpt,
              }),
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        /*
         * Uma falha de rede pode ser ambigua.
         * Conferimos o banco uma vez, sem repetir POST.
         */
        const confirmed =
          await loadStatus({
            silent: true,
          });

        if (confirmed) {
          if (
            mountedRef.current
          ) {
            setPublication(
              confirmed
            );
          }

          return;
        }

        throw new Error(
          data?.error ||
          `Falha publicando no site. HTTP ${response.status}.`
        );
      }

      if (
        mountedRef.current
      ) {
        setPublication(
          data?.data || null
        );
      }
    } catch (err) {
      if (
        mountedRef.current
      ) {
        setError(
          err?.message ||
          "Nao foi possivel confirmar a publicacao no site."
        );
      }
    } finally {
      if (
        mountedRef.current
      ) {
        setPublishing(false);
      }
    }
  }

  if (
    !Number.isInteger(
      noticiaId
    ) ||
    noticiaId <= 0
  ) {
    return (
      <div className="border border-wg-border-strong bg-wg-surface p-3">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-wg-muted">
          Site
        </div>

        <div className="mt-2 font-mono text-[10px] text-wg-muted">
          Noticia ainda sem ID persistido.
        </div>
      </div>
    );
  }

  const published =
    Boolean(
      publication?.slug
    );

  return (
    <div className="border border-wg-border bg-wg-surface p-3">
      <div className="mb-3 border border-wg-border bg-wg-raised p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-wg-text">
              Materia editorial do site
            </div>

            <div className="mt-1 max-w-2xl font-mono text-[9px] leading-4 text-wg-muted">
              Gere a versao expandida, revise o texto e aprove manualmente antes de publicar.
            </div>
          </div>

          <button
            type="button"
            onClick={
              generateEditorial
            }
            disabled={
              loading ||
              generating ||
              publishing
            }
            className="border border-wg-border-strong px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-wg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating
              ? "Gerando materia..."
              : siteBody
                ? "Gerar novamente"
                : "Gerar materia"}
          </button>
        </div>

        <div className="mt-4">
          <label
            htmlFor={`site-excerpt-${noticiaId}`}
            className="block font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-wg-muted"
          >
            Resumo do site
          </label>

          <textarea
            id={`site-excerpt-${noticiaId}`}
            value={
              siteExcerpt
            }
            onChange={(event) => {
              setSiteExcerpt(
                event.target.value
              );

              setEditorialApproved(
                false
              );
            }}
            disabled={
              generating ||
              publishing
            }
            rows={3}
            placeholder="Gere a materia para criar o resumo editorial."
            className="wg-field mt-2 resize-y font-mono leading-5"
          />

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-wg-muted">
            <span>
              {editorialValidation.excerptLength}/280 caracteres
            </span>

            <span>
              minimo 120
            </span>
          </div>
        </div>

        <div className="mt-4">
          <label
            htmlFor={`site-body-${noticiaId}`}
            className="block font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-wg-muted"
          >
            Materia completa
          </label>

          <textarea
            id={`site-body-${noticiaId}`}
            value={
              siteBody
            }
            onChange={(event) => {
              setSiteBody(
                event.target.value
              );

              setEditorialApproved(
                false
              );
            }}
            disabled={
              generating ||
              publishing
            }
            rows={16}
            placeholder="A materia expandida aparecera aqui para revisao."
            className="wg-field mt-2 resize-y font-mono leading-5"
          />

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-wg-muted">
            <span>
              {editorialValidation.bodyLength}/3500 caracteres
            </span>

            <span>
              minimo 1800
            </span>

            <span>
              {editorialValidation.paragraphCount} paragrafos
            </span>

            <span>
              esperado 6-10
            </span>
          </div>
        </div>

        <div className="mt-4 border-t border-wg-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div
                className={`font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${
                  editorialApproved
                    ? "text-wg-success"
                    : editorialValidation.valid
                      ? "text-wg-warning"
                      : "text-wg-muted"
                }`}
              >
                {editorialApproved
                  ? "Materia aprovada"
                  : editorialValidation.valid
                    ? "Pronta para aprovacao"
                    : "Materia ainda fora do contrato"}
              </div>

              {!editorialValidation.valid &&
                (
                  siteBody ||
                  siteExcerpt
                ) && (
                  <div className="mt-1 font-mono text-[9px] leading-4 text-wg-danger">
                    {editorialValidation.errors[0]}
                  </div>
                )}
            </div>

            <button
              type="button"
              onClick={
                approveEditorial
              }
              disabled={
                generating ||
                publishing ||
                !editorialValidation.valid
              }
              className="wg-button wg-button-primary wg-button-compact font-mono uppercase tracking-[0.12em]"
            >
              {editorialApproved
                ? "Materia aprovada"
                : "Aprovar materia"}
            </button>
          </div>
        </div>
      </div>

      <div className="border border-wg-border bg-wg-raised p-3">
        <label
          htmlFor={`site-image-${noticiaId}`}
          className="block font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-wg-muted"
        >
          Imagem oficial da materia
        </label>

        <input
          id={`site-image-${noticiaId}`}
          type="url"
          value={imageUrl}
          onChange={(event) =>
            setImageUrl(
              event.target.value
            )
          }
          disabled={
            publishing ||
            generating
          }
          placeholder="https://..."
          className="wg-field mt-2 font-mono"
        />

        <div className="mt-2 font-mono text-[9px] leading-4 text-wg-muted">
          A imagem editorial aprovada e preenchida automaticamente quando disponivel. Voce pode substituir por outra imagem real oficial ou primaria ligada diretamente a noticia.
        </div>
      </div>

<div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-wg-text">
            Site Bagaca
          </div>

          <div className="mt-1 font-mono text-[9px] text-wg-muted">
            {loading
              ? "Verificando publicacao..."
              : published
                ? "Publicada no site"
                : "Ainda nao publicada"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              loadStatus()
            }
            disabled={
              loading ||
              generating ||
              publishing
            }
            className="wg-button wg-button-secondary wg-button-compact font-mono uppercase tracking-[0.12em]"
          >
            Verificar status
          </button>

          <button
            type="button"
            onClick={publish}
            disabled={
              loading ||
              generating ||
              publishing ||
              !editorialApproved ||
              !editorialValidation.valid
            }
            className="wg-button wg-button-primary wg-button-compact font-mono uppercase tracking-[0.12em]"
          >
            {publishing
              ? "Publicando..."
              : published
                ? "Atualizar no site"
                : "Publicar no site"}
          </button>
        </div>
      </div>

      {published &&
        publication?.site_url && (
          <div className="mt-3 border-t border-wg-border pt-3">
            <a
              href={
                publication.site_url
              }
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-wg-success underline underline-offset-4"
            >
              Abrir materia
            </a>
          </div>
        )}

      {error && (
        <div className="mt-3 border border-wg-danger bg-wg-danger-soft px-3 py-2 font-mono text-[10px] leading-5 text-wg-danger">
          {error}
        </div>
      )}
    </div>
  );
}
