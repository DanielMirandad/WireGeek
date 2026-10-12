import useSiteDraft from './useSiteDraft.js';
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
    paragraphs.length < 3 ||
    paragraphs.length > 5
  ) {
    errors.push(
      "A materia precisa ter entre 3 e 5 paragrafos."
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
  const draft = useSiteDraft(noticiaId, publication?.image_url || approvedImageUrl);
  const siteBody = draft.fields.materia_site;
  const siteExcerpt = draft.fields.resumo_site;
  const setSiteBody = draft.setBody;
  const setSiteExcerpt = draft.setExcerpt;
  const setImageUrl = draft.setImage;
  const imageUrl = draft.fields.image_url ?? (publication?.image_url || approvedImageUrl);
  const selectionRef = useRef({ id: noticiaId });
  if (selectionRef.current.id !== noticiaId) selectionRef.current = { id: noticiaId };
  const selection = selectionRef.current;

  const [
    generating,
    setGenerating,
  ] =
    useState(false);



  const [
    editorialApproved,
    setEditorialApproved,
  ] =
    useState(false);

  // Draft persistence never grants editorial approval.
  const [reviewDraft, setReviewDraft] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [approvalReceipt, setApprovalReceipt] = useState(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const [savedApproval, setSavedApproval] = useState(null);


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

          if (!mountedRef.current || selectionRef.current !== selection) {
            return null;
          }

          const current =
            data?.published === true
              ? data?.data || null
              : null;

          setPublication(
            current
          );

          return current;
        } catch (err) {
          if (
            mountedRef.current && selectionRef.current === selection &&
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
            mountedRef.current && selectionRef.current === selection &&
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
    setPublication(null);
    setGenerating(false);
    setPublishing(false);
    setReviewing(false);
    setSavingApproval(false);
    setEditorialApproved(false);
    setReviewDraft(null);
    setApprovalReceipt(null);
    setSavedApproval(null);
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
      draft.blocked ||
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
    setApprovalReceipt(null);
    setSavedApproval(null);
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
        if (data?.review?.materia_site && data?.review?.resumo_site && mountedRef.current && selectionRef.current === selection) {
          draft.generated(String(data.review.materia_site), String(data.review.resumo_site));
          setReviewDraft(null);
          setApprovalReceipt(null);
          setSavedApproval(null);
          setError("");
          return;
        }
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

      if (!mountedRef.current || selectionRef.current !== selection) {
        return;
      }

      setReviewDraft(null);
      setApprovalReceipt(data?.data?.approval_receipt || null);

      draft.generated(generatedBody, generatedExcerpt);

      setEditorialApproved(
        false
      );
    } catch (err) {
      if (mountedRef.current && selectionRef.current === selection) {
        setError(
          err?.message ||
          "Nao foi possivel gerar a materia do site."
        );
      }
    } finally {
      if (mountedRef.current && selectionRef.current === selection) {
        setGenerating(false);
      }
    }
  }

  async function verifyReviewDraft(override = null) {
    const selectedDraft = override || reviewDraft;
    if (!selectedDraft || reviewing || generating || publishing || savingApproval) return;
    setReviewing(true);
    setError("");
    setEditorialApproved(false);
    try {
      const response = await fetch("/api/publicacoes?mode=site-publish", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify-editorial",
          noticia_id: noticiaId,
          materia_site: selectedDraft.materia_site,
          resumo_site: selectedDraft.resumo_site,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data?.review && mountedRef.current && selectionRef.current === selection) setReviewDraft(data.review);
        const details = Array.isArray(data?.details) ? data.details.join(" ") : "";
        throw new Error([data?.error, details].filter(Boolean).join(" ") || "Falha verificando revisao.");
      }
      if (!data?.data?.materia_site || !data?.data?.resumo_site) {
        throw new Error("Resposta de verificacao incompleta.");
      }
      if (mountedRef.current && selectionRef.current === selection) {
        draft.generated(data.data.materia_site, data.data.resumo_site);
        setReviewDraft(null);
        setApprovalReceipt(data.data.approval_receipt || null);
        setSavedApproval(null);
      }
    } catch (err) {
      if (mountedRef.current && selectionRef.current === selection) setError(err?.message || "Falha verificando revisao.");
    } finally {
      if (mountedRef.current && selectionRef.current === selection) setReviewing(false);
    }
  }

  async function approveEditorial() {
    if (reviewDraft || !editorialValidation.valid || savingApproval || generating || reviewing) {
      setError(reviewDraft ? "Verifique o rascunho corrigido antes de aprovar." :
        "A materia ainda nao atende ao contrato editorial.");
      return;
    }
    if (!approvalReceipt) {
      setError("Esta versao precisa ser verificada novamente antes de ser salva.");
      return;
    }
    setSavingApproval(true);
    setError("");
    try {
      const response = await fetch("/api/publicacoes?mode=site-publish", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve-editorial", noticia_id: noticiaId,
          materia_site: siteBody, resumo_site: siteExcerpt,
          approval_receipt: approvalReceipt,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.data) {
        throw new Error(result?.error || "Nao foi possivel salvar a aprovacao.");
      }
      if (mountedRef.current && selectionRef.current === selection) {
        setSavedApproval(result.data);
        setEditorialApproved(true);
      }
    } catch (err) {
      if (mountedRef.current && selectionRef.current === selection) {
        setEditorialApproved(false);
        setError(err?.message || "Falha ao salvar aprovacao editorial.");
      }
    } finally {
      if (mountedRef.current && selectionRef.current === selection) setSavingApproval(false);
    }
  }

  async function publish() {
    if (
      draft.blocked ||
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
            mountedRef.current && selectionRef.current === selection
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
        mountedRef.current && selectionRef.current === selection
      ) {
        setPublication(
          data?.data || null
        );
      }
    } catch (err) {
      if (
        mountedRef.current && selectionRef.current === selection
      ) {
        setError(
          err?.message ||
          "Nao foi possivel confirmar a publicacao no site."
        );
      }
    } finally {
      if (
        mountedRef.current && selectionRef.current === selection
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
              Gere a versao expandida e publique quando o texto estiver dentro do contrato editorial.
            </div>
          </div>

          <button
            type="button"
            onClick={
              generateEditorial
            }
            disabled={
              draft.blocked ||
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

        {reviewDraft && (
          <div className="mt-4 border border-wg-danger bg-wg-raised p-3">
            <div className="font-mono text-[10px] font-bold uppercase text-wg-danger">
              Rascunho rejeitado — somente revisao, publicacao bloqueada
            </div>
            <div className="mt-2 font-mono text-[10px] text-wg-muted">
              {reviewDraft.issue?.unidade
                ? `Unidade editorial ${reviewDraft.issue.unidade}`
                : "Verificacao pendente"}
              {reviewDraft.issue?.claim
                ? ` — Afirmacao contestada: ${reviewDraft.issue.claim}`
                : ""}
            </div>
            {reviewDraft.issue?.reason && (
              <p className="mt-2 font-mono text-[10px] text-wg-danger">
                Motivo informado pelo verificador: {reviewDraft.issue.reason}
              </p>
            )}
            {reviewDraft.issue?.quote && (
              <p className="mt-2 font-mono text-[10px] text-wg-muted">
                Trecho citado: {reviewDraft.issue.quote}
              </p>
            )}
            {reviewDraft.issue?.candidate && (
              <p className="mt-2 font-mono text-[10px] text-wg-muted">
                Trecho continuo localizado na fonte (somente diagnostico, nao aprovado):
                {" "}{reviewDraft.issue.candidate}
              </p>
            )}
            {reviewDraft.issue?.source_url && (
              <p className="mt-1 break-all font-mono text-[9px] text-wg-muted">
                Fonte: {reviewDraft.issue.source_url}
              </p>
            )}
            <label className="mt-3 block font-mono text-[9px] uppercase text-wg-muted">
              Resumo em revisao
              <textarea
                value={reviewDraft.resumo_site}
                onChange={event => setReviewDraft(current => ({
                  ...current, resumo_site: event.target.value,
                }))}
                rows={3}
                maxLength={280}
                disabled={reviewing}
                className="wg-field mt-2 resize-y font-mono leading-5"
              />
            </label>
            <label className="mt-3 block font-mono text-[9px] uppercase text-wg-muted">
              Materia rejeitada — edite e verifique novamente
              <textarea
                value={reviewDraft.materia_site}
                onChange={event => setReviewDraft(current => ({
                  ...current, materia_site: event.target.value,
                }))}
                rows={14}
                maxLength={3500}
                disabled={reviewing}
                className="wg-field mt-2 resize-y font-mono leading-5"
              />
            </label>
            <div className="mt-2 font-mono text-[9px] text-wg-muted">
              O texto rejeitado permanece apenas nesta sessao da pagina. A nova verificacao pode consumir uma chamada OpenAI.
            </div>
            <button
              type="button"
              onClick={verifyReviewDraft}
              disabled={reviewing || generating || publishing}
              className="wg-button wg-button-secondary wg-button-compact mt-3 font-mono uppercase"
            >
              {reviewing ? "Verificando revisao..." : "Verificar texto corrigido"}
            </button>
          </div>
        )}

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
              setApprovalReceipt(null);
              setSavedApproval(null);

              setEditorialApproved(
                false
              );
            }}
            disabled={
              draft.blocked ||
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
              setApprovalReceipt(null);
              setSavedApproval(null);

              setEditorialApproved(
                false
              );
            }}
            disabled={
              draft.blocked ||
              generating ||
              publishing
            }
            rows={16}
            placeholder="A materia expandida aparecera aqui para edicao."
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
              esperado 3-5
            </span>
          </div>
        </div>

        <div className="mt-4 border-t border-wg-border pt-3">
          <div
            className={`font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${
              editorialValidation.valid
                ? "text-wg-success"
                : "text-wg-muted"
            }`}
          >
            {editorialValidation.valid
              ? "Materia dentro do contrato"
              : "Materia ainda fora do contrato"}
          </div>

          {!editorialValidation.valid &&
            (siteBody || siteExcerpt) && (
              <div className="mt-1 font-mono text-[9px] leading-4 text-wg-danger">
                {editorialValidation.errors[0]}
              </div>
            )}
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
              draft.blocked ||
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
              draft.blocked ||
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
              draft.blocked ||
              loading ||
              generating ||
              publishing ||
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

      <div role="status" className="mt-2 font-mono text-[10px] text-wg-muted">
        {({ loading: 'Carregando rascunho...', pending: 'Alteracoes aguardando salvamento...',
          saving: 'Salvando rascunho...', saved: 'Rascunho salvo', idle: 'Rascunho editorial',
          error: 'Rascunho nao salvo', 'load-error': 'Rascunho indisponivel; recarregue para tentar novamente.' })[draft.status]}
        {draft.error && <span role="alert"> {draft.error}</span>}
        {draft.status === 'error' && <button type="button" onClick={draft.retry}>Tentar salvar novamente</button>}
      </div>

      {error && (
        <div className="mt-3 border border-wg-danger bg-wg-danger-soft px-3 py-2 font-mono text-[10px] leading-5 text-wg-danger">
          {error}
        </div>
      )}
    </div>
  );
}
