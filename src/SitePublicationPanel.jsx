import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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
              `/api/site-publish?noticia_id=${encodeURIComponent(
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

  async function publish() {
    if (
      publishing ||
      !Number.isInteger(
        noticiaId
      ) ||
      noticiaId <= 0
    ) {
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
          "/api/site-publish",
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
                noticia_id:
                  noticiaId,

                image_url:
                  officialImageUrl,
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
          disabled={publishing}
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
              publishing
            }
            className="border border-[#e0452f] bg-[#e0452f]/10 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#e0452f] disabled:opacity-40"
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
