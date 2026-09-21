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

  const noticiaId =
    Number(
      item?.id ||
      item?.noticia_id ||
      0
    );

  /*
   * Uma nova geracao pode reutilizar os mesmos
   * publication_id enquanto atualiza banner_url
   * e publication_group_id no backend.
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

  /*
   * Estado exclusivo do publisher.
   *
   * publisherBusy:
   * - asset
   * - prepare
   * - preflight
   * - publish
   */
  const [
    publisherBusy,
    setPublisherBusy,
  ] =
    useState("");

  const [
    publisherError,
    setPublisherError,
  ] =
    useState("");

  const [
    publisherInfo,
    setPublisherInfo,
  ] =
    useState("");

  const [
    preflight,
    setPreflight,
  ] =
    useState(null);

  const [
    reelAsset,
    setReelAsset,
  ] =
    useState(null);

  const [
    publishConfirmed,
    setPublishConfirmed,
  ] =
    useState(false);

  /*
   * Bloqueio de seguranca local.
   *
   * Fica true quando uma chamada mutavel
   * pode ter produzido efeito cujo resultado
   * nao conseguimos comprovar.
   *
   * NUNCA fazemos retry automatico.
   */
  const [
    publishLocked,
    setPublishLocked,
  ] =
    useState(false);


  async function postPublisher(payload) {
    const response =
      await fetch(
        "/api/publicar",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          credentials: "include",
          body: JSON.stringify(
            payload
          ),
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    return {
      response,
      data,
    };
  }


  async function loadGroup() {
    if (
      !publicationId &&
      !noticiaId
    ) {
      return;
    }

    setLoading(true);
    setError("");

    /*
     * Qualquer refresh invalida um preflight anterior.
     * A autorizacao precisa refletir o estado atual.
     */
    setPreflight(null);
    setPublishConfirmed(false);

    try {
      const groupUrl =
        publicationId
          ? `/api/publicacoes?id=${encodeURIComponent(
              publicationId
            )}`
          : `/api/publicacoes?noticia_id=${encodeURIComponent(
              noticiaId
            )}`;

      const response =
        await fetch(
          groupUrl,
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

      const loadedRows =
        Array.isArray(data?.publicacoes)
          ? data.publicacoes
          : [];

      /*
       * Estados nos quais uma nova tentativa
       * de publicacao deve ficar bloqueada.
       */
      const publishedEvidence =
        loadedRows.some(
          (row) =>
            row?.status === "PUBLICADO" ||
            Boolean(row?.published_at) ||
            Boolean(row?.instagram_post_id)
        );

      const manualReview =
        loadedRows.some(
          (row) =>
            row?.instagram_status ===
            "VERIFICAR_MANUALMENTE"
        );

      const publishingEvidence =
        loadedRows.some(
          (row) =>
            row?.status === "PUBLICANDO" ||
            row?.instagram_status ===
            "PUBLICANDO"
        );

      if (
        publishedEvidence ||
        manualReview ||
        publishingEvidence
      ) {
        setPublishLocked(true);
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


  async function updatePublication(
    id,
    acao
  ) {
    const targetId =
      Number(id);

    if (
      !Number.isInteger(targetId) ||
      targetId <= 0 ||
      ![
        "aprovar",
        "rejeitar",
      ].includes(acao)
    ) {
      return;
    }

    setActionId(targetId);
    setActionError("");
    setPublisherError("");
    setPublisherInfo("");
    setPreflight(null);
    setPublishConfirmed(false);

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
              id: targetId,
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


  const rows =
    Array.isArray(group?.publicacoes)
      ? group.publicacoes
      : [];

  const activePublicationId =
    Number(
      publicationId ||
      rows[0]?.id ||
      0
    );

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

  const allApproved =
    rows.length === 2 &&
    rows.every(
      (row) =>
        row?.status ===
        "APROVADO"
    );

  const manualReview =
    rows.some(
      (row) =>
        row?.instagram_status ===
        "VERIFICAR_MANUALMENTE"
    );

  const publishingEvidence =
    rows.some(
      (row) =>
        row?.status ===
          "PUBLICANDO" ||
        row?.instagram_status ===
          "PUBLICANDO"
    );

  const lastInstagramError =
    String(
      rows.find(
        (row) =>
          String(
            row?.last_error ||
            ""
          ).trim()
      )?.last_error ||
      ""
    ).trim();

  const parentIds = [
    ...new Set(
      rows
        .map(
          (row) =>
            String(
              row
                ?.instagram_parent_container_id ||
              ""
            ).trim()
        )
        .filter(Boolean)
    ),
  ];

  const childIds =
    rows.flatMap(
      (row) =>
        Array.isArray(
          row
            ?.instagram_child_container_ids
        )
          ? row
              .instagram_child_container_ids
              .map(
                (value) =>
                  String(
                    value ||
                    ""
                  ).trim()
              )
              .filter(Boolean)
          : []
    );

  const currentParentId =
    parentIds.length === 1
      ? parentIds[0]
      : "";

  const hasLegacyChildren =
    childIds.length > 0;

  const groupInconsistent =
    rows.length === 2 &&
    parentIds.length > 1;

  const assetReady =
    Boolean(
      reelAsset?.success ===
        true &&
      reelAsset?.mode ===
        "instagram_reel_asset" &&
      reelAsset?.publication_type ===
        "REEL" &&
      reelAsset?.publish_called ===
        false &&
      reelAsset
        ?.instagram_api_called ===
        false &&
      reelAsset
        ?.asset
        ?.immutable ===
        true &&
      String(
        reelAsset
          ?.publication_group_id ||
        ""
      ) ===
        String(
          group
            ?.publication_group_id ||
          ""
        ) &&
      String(
        reelAsset
          ?.asset
          ?.storage_path ||
        ""
      ).startsWith(
        `instagram-reels/${
          group
            ?.publication_group_id ||
          ""
        }-`
      ) &&
      /^https:\/\//i.test(
        String(
          reelAsset
            ?.asset
            ?.video_url ||
          ""
        )
      ) &&
      /^[0-9a-f]{64}$/i.test(
        String(
          reelAsset
            ?.asset
            ?.sha256 ||
          ""
        )
      )
    );

  const canGenerateAsset =
    rows.length === 2 &&
    allApproved &&
    !published &&
    !manualReview &&
    !publishingEvidence &&
    !hasLegacyChildren &&
    parentIds.length === 0 &&
    !publisherBusy &&
    actionId === null;

  const canCreateContainer =
    canGenerateAsset &&
    assetReady &&
    !publishLocked;

  /*
   * Preflight e somente leitura.
   *
   * Ele continua permitido depois de uma
   * incerteza na criacao do container, desde
   * que o parent tenha sido persistido.
   */
  const canPreflight =
    rows.length === 2 &&
    allApproved &&
    !published &&
    !manualReview &&
    !publishingEvidence &&
    !hasLegacyChildren &&
    parentIds.length === 1 &&
    !publisherBusy &&
    actionId === null;

  const preflightParentId =
    String(
      preflight
        ?.instagram
        ?.parent_container_id ||
      ""
    ).trim();

  const preflightAccountId =
    String(
      preflight
        ?.instagram
        ?.account_id ||
      ""
    ).trim();

  const preflightGroupId =
    String(
      preflight
        ?.publication_group_id ||
      ""
    ).trim();

  const currentGroupId =
    String(
      group?.publication_group_id ||
      ""
    ).trim();

  const preflightReady =
    preflight?.success === true &&
    preflight?.mode ===
      "instagram_publish_preflight" &&
    preflight?.publication_type ===
      "REEL" &&
    preflight?.ready_to_publish ===
      true &&
    preflight?.publish_called ===
      false &&
    preflight
      ?.instagram
      ?.media_type ===
      "REELS" &&
    preflight
      ?.instagram
      ?.share_to_feed ===
      true &&
    preflight
      ?.instagram
      ?.parent_status_code ===
      "FINISHED" &&
    Array.isArray(
      preflight
        ?.instagram
        ?.child_containers
    ) &&
    preflight
      .instagram
      .child_containers
      .length === 0 &&
    Number(
      preflight
        ?.caption
        ?.hashtags_count
    ) === 5 &&
    preflightParentId &&
    preflightParentId ===
      currentParentId &&
    preflightGroupId &&
    preflightGroupId ===
      currentGroupId &&
    preflightAccountId;

  const canPublish =
    Boolean(
      preflightReady &&
      publishConfirmed &&
      !publishLocked &&
      !published &&
      !manualReview &&
      !publishingEvidence &&
      !publisherBusy &&
      actionId === null
    );


  async function prepareReelAsset() {
    if (!canGenerateAsset) {
      return;
    }

    setPublisherBusy("asset");
    setPublisherError("");
    setPublisherInfo("");
    setPreflight(null);
    setPublishConfirmed(false);

    try {
      const {
        response,
        data,
      } =
        await postPublisher({
          id:
            activePublicationId,

          instagram_reel_asset:
            true,
        });

      if (!response.ok) {
        /*
         * Nenhuma chamada Meta ocorre
         * neste modo.
         */
        setReelAsset(null);

        setPublisherError(
          data?.details ||
          data?.error ||
          `Falha gerando MP4 imutavel. HTTP ${response.status}.`
        );

        return;
      }

      const storagePath =
        String(
          data
            ?.asset
            ?.storage_path ||
          ""
        ).trim();

      const videoUrl =
        String(
          data
            ?.asset
            ?.video_url ||
          ""
        ).trim();

      const sha256 =
        String(
          data
            ?.asset
            ?.sha256 ||
          ""
        ).trim();

      const valid =
        data?.success === true &&
        data?.mode ===
          "instagram_reel_asset" &&
        data?.publication_type ===
          "REEL" &&
        data?.publish_called ===
          false &&
        data?.instagram_api_called ===
          false &&
        String(
          data?.publication_group_id ||
          ""
        ) ===
          String(
            group
              ?.publication_group_id ||
            ""
          ) &&
        data
          ?.asset
          ?.immutable ===
          true &&
        storagePath.startsWith(
          `instagram-reels/${
            group
              ?.publication_group_id ||
            ""
          }-`
        ) &&
        /^https:\/\//i.test(
          videoUrl
        ) &&
        /^[0-9a-f]{64}$/i.test(
          sha256
        ) &&
        Number(
          data
            ?.caption
            ?.hashtags_count
        ) === 5;

      if (!valid) {
        setReelAsset(null);

        throw new Error(
          "O backend retornou um asset fora do contrato imutavel esperado."
        );
      }

      setReelAsset(data);

      setPublisherInfo(
        data?.asset?.reused === true
          ? "MP4 imutavel existente validado. Nenhuma chamada Meta foi executada."
          : "MP4 imutavel gerado e validado. Nenhuma chamada Meta foi executada."
      );
    }
    catch (err) {
      setReelAsset(null);

      setPublisherError(
        err?.message ||
        "Nao foi possivel gerar o MP4 imutavel."
      );
    }
    finally {
      setPublisherBusy("");
    }
  }


  async function createReelContainer() {
    if (!canCreateContainer) {
      return;
    }

    setPublisherBusy("prepare");
    setPublisherError("");
    setPublisherInfo("");
    setPreflight(null);
    setPublishConfirmed(false);

    try {
      const {
        response,
        data,
      } =
        await postPublisher({
          id:
            activePublicationId,

          instagram_containers:
            true,
        });

      if (!response.ok) {
        const message =
          data?.details ||
          data?.error ||
          `Falha preparando Reel. HTTP ${response.status}.`;

        /*
         * 5xx pode acontecer depois de POST /media.
         * Nao criamos outro container automaticamente.
         */
        if (
          response.status >= 500
        ) {
          setPublishLocked(true);

          setPublisherError(
            `${message} O resultado da criação pode ser ambíguo. NÃO tente criar outro container antes de atualizar e auditar o estado.`
          );
        }
        else {
          setPublisherError(
            message
          );
        }

        await loadGroup();
        return;
      }

      const parentId =
        String(
          data
            ?.instagram
            ?.parent_container_id ||
          ""
        ).trim();

      const children =
        data
          ?.instagram
          ?.child_containers;

      const responseValid =
        data?.success === true &&
        data?.mode ===
          "instagram_reel_container_only" &&
        data?.publication_type ===
          "REEL" &&
        data?.publish_called ===
          false &&
        parentId &&
        Array.isArray(children) &&
        children.length === 0 &&
        data
          ?.instagram
          ?.persisted ===
          true &&
        data
          ?.instagram
          ?.parent_status_code ===
          "FINISHED";

      if (!responseValid) {
        setPublishLocked(true);

        setPublisherError(
          "O backend respondeu à preparação do Reel com um estado inesperado. O container NÃO será recriado automaticamente. Atualize o status antes de qualquer nova ação."
        );

        await loadGroup();
        return;
      }

      setPublisherInfo(
        `Reel preparado e FINISHED. Container ${parentId}. Execute o preflight antes de publicar.`
      );

      await loadGroup();
    }
    catch (err) {
      /*
       * Falha de rede também é ambígua:
       * o POST /media pode ter chegado ao backend.
       */
      setPublishLocked(true);

      setPublisherError(
        `${
          err?.message ||
          "Falha de rede preparando o Reel."
        } O resultado pode ser ambíguo. NÃO tente criar outro container antes de atualizar e auditar o estado.`
      );

      await loadGroup();
    }
    finally {
      setPublisherBusy("");
    }
  }


  async function runPreflight() {
    if (!canPreflight) {
      return;
    }

    setPublisherBusy("preflight");
    setPublisherError("");
    setPublisherInfo("");
    setPreflight(null);
    setPublishConfirmed(false);

    try {
      const {
        response,
        data,
      } =
        await postPublisher({
          id:
            activePublicationId,

          instagram_publish_preflight:
            true,
        });

      if (!response.ok) {
        setPublisherError(
          data?.details ||
          data?.error ||
          `Preflight falhou. HTTP ${response.status}.`
        );

        if (
          data?.already_published ===
            true ||
          data?.publish_called ===
            true
        ) {
          setPublishLocked(true);
          await loadGroup();
        }

        return;
      }

      const parentId =
        String(
          data
            ?.instagram
            ?.parent_container_id ||
          ""
        ).trim();

      const accountId =
        String(
          data
            ?.instagram
            ?.account_id ||
          ""
        ).trim();

      const returnedGroupId =
        String(
          data
            ?.publication_group_id ||
          ""
        ).trim();

      const publicationIds =
        Array.isArray(
          data?.publication_ids
        )
          ? data.publication_ids
          : [];

      const children =
        data
          ?.instagram
          ?.child_containers;

      const valid =
        data?.success === true &&
        data?.mode ===
          "instagram_publish_preflight" &&
        data?.publication_type ===
          "REEL" &&
        data?.ready_to_publish ===
          true &&
        data?.publish_called ===
          false &&
        returnedGroupId ===
          currentGroupId &&
        publicationIds.length ===
          2 &&
        publicationIds.some(
          (value) =>
            Number(value) ===
            activePublicationId
        ) &&
        accountId &&
        parentId ===
          currentParentId &&
        data
          ?.instagram
          ?.media_type ===
          "REELS" &&
        data
          ?.instagram
          ?.share_to_feed ===
          true &&
        data
          ?.instagram
          ?.parent_status_code ===
          "FINISHED" &&
        Array.isArray(children) &&
        children.length === 0 &&
        Number(
          data
            ?.caption
            ?.hashtags_count
        ) === 5;

      if (!valid) {
        throw new Error(
          "O preflight retornou dados inconsistentes com o grupo atualmente carregado."
        );
      }

      /*
       * Um preflight valido prova que:
       * - grupo ainda esta APROVADO;
       * - parent persistido e FINISHED;
       * - conta e grupo conferem;
       * - nenhum media_publish foi executado.
       */
      setPublishLocked(false);
      setPreflight(data);

      setPublisherInfo(
        "Preflight aprovado. Revise os dados abaixo e confirme explicitamente a publicação."
      );
    }
    catch (err) {
      setPreflight(null);

      setPublisherError(
        err?.message ||
        "Não foi possível concluir o preflight."
      );
    }
    finally {
      setPublisherBusy("");
    }
  }


  async function publishReel() {
    if (!canPublish) {
      return;
    }

    /*
     * Copiar a autorizacao exata validada
     * pelo preflight.
     */
    const expectedParentId =
      preflightParentId;

    const expectedGroupId =
      preflightGroupId;

    const expectedAccountId =
      preflightAccountId;

    setPublisherBusy("publish");
    setPublisherError("");
    setPublisherInfo("");

    try {
      const {
        response,
        data,
      } =
        await postPublisher({
          id:
            activePublicationId,

          instagram_publish:
            true,

          publish_confirmation:
            `PUBLICAR_INSTAGRAM_${activePublicationId}`,

          expected_parent_container_id:
            expectedParentId,

          expected_publication_group_id:
            expectedGroupId,

          expected_account_id:
            expectedAccountId,
        });

      const publishCalled =
        data?.publish_called ===
        true;

      const doNotRetry =
        data?.do_not_retry ===
        true;

      if (!response.ok) {
        if (
          publishCalled ||
          doNotRetry
        ) {
          setPublishLocked(true);
          setPublishConfirmed(false);
          setPreflight(null);

          if (
            data?.publish_succeeded ===
            true
          ) {
            setPublisherError(
              `${
                data?.error ||
                "O Instagram confirmou a publicação, mas houve uma falha posterior."
              } NÃO publique novamente. O banco precisa ser auditado/reparado.`
            );
          }
          else {
            setPublisherError(
              `${
                data?.error ||
                "O resultado de media_publish não pôde ser confirmado."
              } NÃO tente novamente. Verifique o Instagram e o estado do grupo antes de qualquer nova ação.`
            );
          }

          await loadGroup();
          return;
        }

        setPublisherError(
          data?.details ||
          data?.error ||
          `Publicação bloqueada. HTTP ${response.status}.`
        );

        return;
      }

      const successValid =
        data?.success === true &&
        data?.mode ===
          "instagram_publish" &&
        data?.publish_called ===
          true &&
        data?.published ===
          true &&
        data?.do_not_retry ===
          true &&
        String(
          data
            ?.publication_group_id ||
          ""
        ) ===
          expectedGroupId &&
        String(
          data
            ?.instagram
            ?.parent_container_id ||
          ""
        ) ===
          expectedParentId &&
        String(
          data
            ?.instagram
            ?.account_id ||
          ""
        ) ===
          expectedAccountId &&
        Boolean(
          String(
            data
              ?.instagram
              ?.post_id ||
            ""
          ).trim()
        );

      if (!successValid) {
        /*
         * A resposta chegou depois de uma chamada
         * que pode ter publicado.
         */
        setPublishLocked(true);
        setPublishConfirmed(false);
        setPreflight(null);

        setPublisherError(
          "A resposta após media_publish não corresponde ao contrato esperado. NÃO tente publicar novamente; atualize o status e faça auditoria manual."
        );

        await loadGroup();
        return;
      }

      const resultPermalink =
        String(
          data
            ?.instagram
            ?.permalink ||
          ""
        ).trim();

      const postId =
        String(
          data
            ?.instagram
            ?.post_id ||
          ""
        ).trim();

      setPublishLocked(true);
      setPublishConfirmed(false);
      setPreflight(null);

      setPublisherInfo(
        resultPermalink
          ? `Reel publicado com sucesso: ${resultPermalink}`
          : `Reel publicado com sucesso. Instagram media ID: ${postId}.`
      );

      await loadGroup();
    }
    catch (err) {
      /*
       * CRITICO:
       *
       * Em erro de rede depois que o usuario
       * confirmou a publicacao, nao sabemos se
       * media_publish chegou ou nao à Meta.
       *
       * Nunca repetir automaticamente.
       */
      setPublishLocked(true);
      setPublishConfirmed(false);
      setPreflight(null);

      setPublisherError(
        `${
          err?.message ||
          "A conexão foi interrompida durante a publicação."
        } O resultado pode ser ambíguo. NÃO tente publicar novamente. Atualize o status e verifique o Instagram primeiro.`
      );

      await loadGroup();
    }
    finally {
      setPublisherBusy("");
    }
  }


  useEffect(() => {
    setGroup(null);
    setError("");
    setActionError("");
    setPublisherError("");
    setPublisherInfo("");
    setPreflight(null);
    setReelAsset(null);
    setPublishConfirmed(false);
    setPublishLocked(false);

    if (
      publicationId ||
      noticiaId
    ) {
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
    noticiaId,
    publicationRefreshKey,
  ]);


  if (
    !publicationId &&
    !noticiaId
  ) {
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
            2 editoriais + CTA · Instagram Reel
          </p>
        </div>

        <button
          type="button"
          onClick={loadGroup}
          disabled={
            loading ||
            Boolean(publisherBusy)
          }
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


      {publisherError && (
        <div className="flex items-start gap-2 border border-[#e0452f]/60 bg-[#1a1214] px-3 py-3 font-mono text-[10px] leading-5 text-[#f0a89a]">
          <AlertCircle
            size={14}
            className="mt-0.5 shrink-0"
          />

          <span>{publisherError}</span>
        </div>
      )}


      {publisherInfo && (
        <div className="flex items-start gap-2 border border-[#5fbf7a]/40 bg-[#0c1813] px-3 py-3 font-mono text-[10px] leading-5 text-[#9ed8ad]">
          <CheckCircle2
            size={14}
            className="mt-0.5 shrink-0"
          />

          <span>{publisherInfo}</span>
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


                    {status ===
                      "AGUARDANDO_APROVACAO" && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updatePublication(
                              row.id,
                              "aprovar"
                            )
                          }
                          disabled={
                            actionId !== null ||
                            Boolean(publisherBusy)
                          }
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
                          disabled={
                            actionId !== null ||
                            Boolean(publisherBusy)
                          }
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


          {manualReview && (
            <div className="border border-[#e0452f]/60 bg-[#1a1214] p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#f0a89a]">
                Verificação manual obrigatória
              </div>

              <p className="mt-2 font-mono text-[10px] leading-5 text-[#d9a59b]">
                O resultado de uma tentativa de publicação é incerto. Não execute uma nova publicação antes de verificar o Instagram e reconciliar o estado do grupo.
              </p>

              {lastInstagramError && (
                <p className="mt-2 break-words font-mono text-[9px] leading-5 text-[#8f7772]">
                  {lastInstagramError}
                </p>
              )}
            </div>
          )}


          {publishingEvidence &&
            !published && (
            <div className="border border-[#d8b45f]/40 bg-[#18160d] p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#d8b45f]">
                Publicação em estado intermediário
              </div>

              <p className="mt-2 font-mono text-[10px] leading-5 text-[#a99c73]">
                O grupo está PUBLICANDO. Nenhuma nova tentativa será liberada pela interface.
              </p>
            </div>
          )}


          {hasLegacyChildren && (
            <div className="border border-[#e0452f]/50 bg-[#1a1214] p-3 font-mono text-[10px] leading-5 text-[#f0a89a]">
              Existem child containers de carrossel persistidos neste grupo. O Reel permanece bloqueado até auditoria manual.
            </div>
          )}


          {groupInconsistent && (
            <div className="border border-[#e0452f]/50 bg-[#1a1214] p-3 font-mono text-[10px] leading-5 text-[#f0a89a]">
              Há mais de um parent container persistido no grupo. Publicação bloqueada.
            </div>
          )}


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


          {!published &&
            !manualReview &&
            !publishingEvidence &&
            !hasLegacyChildren &&
            !groupInconsistent && (
            <div className="space-y-3 border border-[#344447] bg-[#0d1719] p-4">

              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#f4f0e8]">
                  Instagram Reel
                </div>

                <p className="mt-1 font-mono text-[9px] leading-5 text-[#667b77]">
                  Fluxo controlado: MP4 imutável → container → preflight → confirmação explícita → media_publish.
                </p>
              </div>


              <div className="grid gap-2 sm:grid-cols-2">
                <div className="border border-[#263b36] bg-[#0b1416] p-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-wider text-[#5c6f6b]">
                    Container
                  </div>

                  <div className="mt-1 break-all font-mono text-[9px] text-[#8fa39d]">
                    {currentParentId ||
                      "Ainda não preparado"}
                  </div>
                </div>

                <div className="border border-[#263b36] bg-[#0b1416] p-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-wider text-[#5c6f6b]">
                    Editoriais
                  </div>

                  <div className="mt-1 font-mono text-[9px] text-[#8fa39d]">
                    {allApproved
                      ? "2 / 2 APROVADOS"
                      : "Aguardando aprovação"}
                  </div>
                </div>
              </div>


              {!currentParentId &&
                !assetReady && (
                <button
                  type="button"
                  onClick={prepareReelAsset}
                  disabled={!canGenerateAsset}
                  className="w-full border border-[#d8b45f]/60 bg-[#18160d] px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#d8b45f] transition hover:bg-[#211e10] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {publisherBusy ===
                  "asset"
                    ? "Gerando MP4..."
                    : "Gerar MP4 imutável"}
                </button>
              )}


              {!currentParentId &&
                assetReady && (
                <div className="space-y-2">
                  <div className="border border-[#5fbf7a]/40 bg-[#0c1813] p-3">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#5fbf7a]">
                      MP4 imutável validado
                    </div>

                    <div className="mt-2 break-all font-mono text-[8px] leading-5 text-[#8fa39d]">
                      {reelAsset?.asset?.storage_path}
                    </div>

                    <div className="mt-1 font-mono text-[8px] text-[#667b77]">
                      SHA256:{" "}
                      {String(
                        reelAsset
                          ?.asset
                          ?.sha256 ||
                        ""
                      ).slice(0, 16)}
                      …
                    </div>

                    <a
                      href={
                        reelAsset
                          ?.asset
                          ?.video_url
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block font-mono text-[9px] uppercase tracking-wider text-[#9ab8c4] underline hover:text-[#d8dfd9]"
                    >
                      Revisar MP4
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={createReelContainer}
                    disabled={!canCreateContainer}
                    className="w-full border border-[#d8b45f]/60 bg-[#18160d] px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#d8b45f] transition hover:bg-[#211e10] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {publisherBusy ===
                    "prepare"
                      ? "Criando container..."
                      : "Criar container Reel"}
                  </button>
                </div>
              )}


              {currentParentId && (
                <button
                  type="button"
                  onClick={runPreflight}
                  disabled={!canPreflight}
                  className="w-full border border-[#5b7c89] bg-[#101a1e] px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#9ab8c4] transition hover:bg-[#142229] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {publisherBusy ===
                  "preflight"
                    ? "Verificando Reel..."
                    : "Verificar Reel / Preflight"}
                </button>
              )}


              {publishLocked &&
                !preflightReady && (
                <div className="border border-[#e0452f]/40 bg-[#1a1214] px-3 py-2.5 font-mono text-[9px] leading-5 text-[#d9a59b]">
                  Nova ação mutável bloqueada por segurança. Use “Atualizar status” e, se houver um único parent persistido, execute apenas o preflight de leitura.
                </div>
              )}


              {preflightReady && (
                <div className="space-y-3 border border-[#5fbf7a]/40 bg-[#0c1813] p-3">

                  <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#5fbf7a]">
                    <CheckCircle2
                      size={13}
                    />

                    Preflight aprovado
                  </div>


                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#667b77]">
                        Conta Instagram
                      </div>

                      <div className="mt-1 break-all font-mono text-[9px] text-[#d8dfd9]">
                        {preflightAccountId}
                      </div>
                    </div>

                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#667b77]">
                        Parent container
                      </div>

                      <div className="mt-1 break-all font-mono text-[9px] text-[#d8dfd9]">
                        {preflightParentId}
                      </div>
                    </div>

                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#667b77]">
                        Tipo
                      </div>

                      <div className="mt-1 font-mono text-[9px] text-[#d8dfd9]">
                        REELS · share_to_feed=true
                      </div>
                    </div>

                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#667b77]">
                        Caption
                      </div>

                      <div className="mt-1 font-mono text-[9px] text-[#d8dfd9]">
                        {preflight?.caption?.caption_length} caracteres · {preflight?.caption?.hashtags_count} hashtags
                      </div>
                    </div>
                  </div>


                  {preflight
                    ?.instagram
                    ?.video_url && (
                    <a
                      href={
                        preflight
                          .instagram
                          .video_url
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block font-mono text-[9px] uppercase tracking-wider text-[#9ab8c4] underline hover:text-[#d8dfd9]"
                    >
                      Abrir MP4 aprovado
                    </a>
                  )}


                  <label className="flex cursor-pointer items-start gap-2 border border-[#344447] bg-[#0b1416] p-3">
                    <input
                      type="checkbox"
                      checked={
                        publishConfirmed
                      }
                      onChange={
                        (event) =>
                          setPublishConfirmed(
                            event.target
                              .checked
                          )
                      }
                      disabled={
                        Boolean(
                          publisherBusy
                        )
                      }
                      className="mt-0.5"
                    />

                    <span className="font-mono text-[9px] leading-5 text-[#9aa9a5]">
                      Confirmo que revisei o Reel, a conta, o container e desejo publicar agora no Instagram. Esta ação chama media_publish e não terá retry automático.
                    </span>
                  </label>


                  <button
                    type="button"
                    onClick={publishReel}
                    disabled={!canPublish}
                    className="w-full border border-[#e0452f] bg-[#351714] px-3 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#f2a596] transition hover:bg-[#4a1d18] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {publisherBusy ===
                    "publish"
                      ? "Publicando..."
                      : "Publicar agora no Instagram"}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}


      <div className="border border-[#3a4a4d] bg-[#0b1416] px-3 py-2.5 font-mono text-[9px] leading-5 text-[#5c6f6b]">
        Fluxo Reel: MP4 imutável → container persistido → preflight obrigatório → confirmação explícita. Nenhum retry automático de media_publish.
      </div>

    </div>
  );
}
