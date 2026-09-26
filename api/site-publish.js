import { createClient } from "@supabase/supabase-js";
import { hasValidWireGeekAuth } from "./auth.js";

function normalizePositiveInteger(value) {
  const parsed = Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

class InputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputValidationError";
  }
}
function normalizeOfficialImageUrl(value) {
  const raw =
    String(
      value || ""
    ).trim();

  if (!raw) {
    throw new InputValidationError(
      "image_url oficial e obrigatoria."
    );
  }

  let parsed;

  try {
    parsed =
      new URL(raw);
  } catch {
    throw new InputValidationError(
      "image_url precisa ser uma URL valida."
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw new InputValidationError(
      "image_url precisa usar HTTPS publico."
    );
  }

  parsed.hash = "";

  return parsed.toString();
}
function getSupabase() {
  const url = String(
    process.env.SUPABASE_URL || ""
  ).trim();

  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  ).trim();

  if (!url || !key) {
    throw new Error(
      "Supabase nao configurado."
    );
  }

  return createClient(
    url,
    key,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function getPublishEndpoint() {
  const raw = String(
    process.env.BAGACA_SITE_PUBLISH_URL ||
    ""
  ).trim();

  if (!raw) {
    throw new Error(
      "BAGACA_SITE_PUBLISH_URL nao configurada."
    );
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "BAGACA_SITE_PUBLISH_URL invalida."
    );
  }

  const local =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1";

  if (
    parsed.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      parsed.protocol === "http:" &&
      local
    )
  ) {
    throw new Error(
      "BAGACA_SITE_PUBLISH_URL precisa usar HTTPS."
    );
  }

  if (
    parsed.pathname.replace(/\/+$/, "") !==
    "/api/integrations/wiregeek/publish"
  ) {
    throw new Error(
      "BAGACA_SITE_PUBLISH_URL aponta para endpoint inesperado."
    );
  }

  parsed.hash = "";
  parsed.search = "";

  return parsed;
}

function siteUrlFromPublication(
  endpoint,
  publication
) {
  const slug = String(
    publication?.slug || ""
  ).trim();

  if (!slug) {
    return null;
  }

  return new URL(
    `/noticias/${encodeURIComponent(slug)}`,
    endpoint.origin
  ).toString();
}

async function loadSitePublication(
  supabase,
  noticiaId
) {
  const {
    data,
    error,
  } = await supabase
    .from("site_news")
    .select(
      "id,origin,external_id,wiregeek_noticia_id,slug,category,title,image_url,published_at,status"
    )
    .eq(
      "origin",
      "wiregeek"
    )
    .eq(
      "wiregeek_noticia_id",
      noticiaId
    )
    .limit(2);

  if (error) {
    throw new Error(
      "Nao foi possivel consultar publicacao no site: " +
      error.message
    );
  }

  const rows =
    Array.isArray(data)
      ? data
      : [];

  if (rows.length > 1) {
    throw new Error(
      "Mais de uma publicacao do site encontrada para esta noticia."
    );
  }

  return rows[0] || null;
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET" &&
    req.method !== "POST"
  ) {
    res.setHeader(
      "Allow",
      "GET, POST"
    );

    return res.status(405).json({
      success: false,
      error:
        "Metodo nao permitido.",
    });
  }

  if (!hasValidWireGeekAuth(req)) {
    return res.status(401).json({
      success: false,
      error:
        "Nao autorizado.",
    });
  }

  const noticiaId =
    normalizePositiveInteger(
      req.method === "GET"
        ? req.query?.noticia_id
        : req.body?.noticia_id
    );

  if (!noticiaId) {
    return res.status(422).json({
      success: false,
      error:
        "noticia_id invalido.",
    });
  }

  try {
    const supabase =
      getSupabase();

    if (req.method === "GET") {
      const publication =
        await loadSitePublication(
          supabase,
          noticiaId
        );

      let siteUrl = null;

      if (publication) {
        try {
          siteUrl =
            siteUrlFromPublication(
              getPublishEndpoint(),
              publication
            );
        } catch {
          siteUrl = null;
        }
      }

      return res.status(200).json({
        success: true,
        published:
          Boolean(publication),

        data:
          publication
            ? {
                ...publication,
                site_url: siteUrl,
              }
            : null,
      });
    }

    const imageUrl =
      normalizeOfficialImageUrl(
        req.body?.image_url
      );

    const endpoint =
      getPublishEndpoint();

    const publishKey =
      String(
        process.env.BAGACA_SITE_PUBLISH_KEY ||
        ""
      ).trim();

    if (!publishKey) {
      throw new Error(
        "BAGACA_SITE_PUBLISH_KEY nao configurada."
      );
    }

    const upstream =
      await fetch(
        endpoint.toString(),
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${publishKey}`,
          },

          body:
            JSON.stringify({
              noticia_id:
                noticiaId,

              image_url:
                imageUrl,
            }),

          signal:
            AbortSignal.timeout(
              30000
            ),
        }
      );

    const upstreamData =
      await upstream
        .json()
        .catch(() => ({}));

    if (!upstream.ok) {
      return res
        .status(
          upstream.status >= 500
            ? 502
            : upstream.status
        )
        .json({
          success: false,

          error:
            upstreamData?.error ||
            `Site respondeu com HTTP ${upstream.status}.`,

          upstream_status:
            upstream.status,
        });
    }

    /*
     * Nao confiamos apenas na resposta HTTP.
     * Confirmamos a persistencia real em site_news.
     */
    const publication =
      await loadSitePublication(
        supabase,
        noticiaId
      );

    if (!publication) {
      return res.status(502).json({
        success: false,
        error:
          "O site respondeu com sucesso, mas a publicacao nao foi confirmada no banco.",
      });
    }

    return res
      .status(
        upstream.status === 201
          ? 201
          : 200
      )
      .json({
        success: true,

        action:
          upstreamData?.action ||
          "published",

        data: {
          ...publication,

          site_url:
            siteUrlFromPublication(
              endpoint,
              publication
            ),
        },
      });
  } catch (error) {
    if (error instanceof InputValidationError) {
      return res.status(422).json({
        success: false,
        error: error.message,
      });
    }
    console.error(
      "WIRE/GEEK: erro em site-publish:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Erro interno ao publicar no site.",
    });
  }
}
