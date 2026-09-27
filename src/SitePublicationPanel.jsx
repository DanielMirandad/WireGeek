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
    imageUrl,
    setImageUrl,
  ] =
    useState("");

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

          if (current?.image_url) {
            setImageUrl(
              (currentValue) =>
                currentValue ||
                current.image_url
            );
          }

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
    setImageUrl("");
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
      <div className="border border-[#3a4a4d] bg-[#0b1416] p-3">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a8f8a]">
          Site
        </div>

        <div className="mt-2 font-mono text-[10px] text-[#5c6f6b]">
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
    <div className="border border-[#344447] bg-[#0b1416] p-3">
      <div className="mb-3 border border-[#243436] bg-[#101b1e] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#f4f0e8]">
              Materia editorial do site
            </div>

            <div className="mt-1 max-w-2xl font-mono text-[9px] leading-4 text-[#5c6f6b]">
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
            className="border border-[#3a4a4d] px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aaca8] disabled:cursor-not-allowed disabled:opacity-40"
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
            className="block font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aaca8]"
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
            className="mt-2 w-full resize-y border border-[#344447] bg-[#081012] px-3 py-2 font-mono text-[10px] leading-5 text-[#f4f0e8] outline-none placeholder:text-[#455552] focus:border-[#e0452f] disabled:opacity-50"
          />

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-[#5c6f6b]">
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
            className="block font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aaca8]"
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
            className="mt-2 w-full resize-y border border-[#344447] bg-[#081012] px-3 py-2 font-mono text-[10px] leading-5 text-[#f4f0e8] outline-none placeholder:text-[#455552] focus:border-[#e0452f] disabled:opacity-50"
          />

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-[#5c6f6b]">
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

        <div className="mt-4 border-t border-[#243436] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div
                className={`font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${
                  editorialApproved
                    ? "text-[#5fbf7a]"
                    : editorialValidation.valid
                      ? "text-[#d7b45d]"
                      : "text-[#7a8f8a]"
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
                  <div className="mt-1 font-mono text-[9px] leading-4 text-[#9a6f6f]">
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
              className="border border-[#5fbf7a] bg-[#5fbf7a]/10 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#5fbf7a] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {editorialApproved
                ? "Materia aprovada"
                : "Aprovar materia"}
            </button>
          </div>
        </div>
      </div>

      <div className="border border-[#243436] bg-[#101b1e] p-3">
        <label
          htmlFor={`site-image-${noticiaId}`}
          className="block font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aaca8]"
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
          className="mt-2 w-full border border-[#344447] bg-[#081012] px-3 py-2 font-mono text-[10px] text-[#f4f0e8] outline-none placeholder:text-[#455552] focus:border-[#e0452f] disabled:opacity-50"
        />

        <div className="mt-2 font-mono text-[9px] leading-4 text-[#5c6f6b]">
          Use somente uma imagem real oficial ou primaria ligada diretamente a noticia.
        </div>
      </div>

<div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#f4f0e8]">
            Site Bagaca
          </div>

          <div className="mt-1 font-mono text-[9px] text-[#5c6f6b]">
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
            className="border border-[#3a4a4d] px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aaca8] disabled:opacity-40"
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
            className="border border-[#e0452f] bg-[#e0452f]/10 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#e0452f] disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="mt-3 border-t border-[#243436] pt-3">
            <a
              href={
                publication.site_url
              }
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#5fbf7a] underline underline-offset-4"
            >
              Abrir materia
            </a>
          </div>
        )}

      {error && (
        <div className="mt-3 border border-[#7a3030] bg-[#2a1414] px-3 py-2 font-mono text-[10px] leading-5 text-[#e89999]">
          {error}
        </div>
      )}
    </div>
  );
}
