/*
 * Publicacao automatica no site Bagaca.
 *
 * Encadeia as acoes que ja existem em lib/site-publish-handler.mjs:
 *   generate-editorial -> approve-editorial -> publish
 * Nenhum portao do handler e contornado: a geracao so devolve recibo quando a
 * verificacao contra as fontes passa, a aprovacao exige esse recibo e o
 * publish exige a aprovacao gravada no banco.
 *
 * Seguranca desta camada:
 *  - desligada por padrao (SITE_AUTOPUBLISH=on liga);
 *  - limite de publicacoes por janela de 24h (SITE_AUTOPUBLISH_DAILY_LIMIT, padrao 3);
 *  - so considera noticias recentes (SITE_AUTOPUBLISH_WINDOW_HOURS, padrao 48),
 *    para nao publicar historico antigo ao ligar;
 *  - numero de tentativas por execucao limitado (falhas nao entram em loop);
 *  - nunca toca Meta/Instagram.
 */

const REQUIRED_ENV = [
  "WIREGEEK_AUTOMATION_KEY",
  "WIREGEEK_ACCESS_KEY",
  "BAGACA_SITE_PUBLISH_URL",
  "BAGACA_SITE_PUBLISH_KEY",
];

const IMAGE_STATUSES = ["APROVADO", "PUBLICADO"];
const HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_RUN = 6;

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function readAutopublishConfig(env = process.env) {
  return {
    enabled:
      String(env.SITE_AUTOPUBLISH || "")
        .trim()
        .toLowerCase() === "on",
    dailyLimit: clampInt(env.SITE_AUTOPUBLISH_DAILY_LIMIT, 3, 1, 10),
    windowHours: clampInt(env.SITE_AUTOPUBLISH_WINDOW_HOURS, 48, 6, 168),
  };
}

/*
 * Chama o handler de publicacao do site em processo, como o proprio WireGeek
 * faria por HTTP, usando a chave de automacao ja existente.
 */
export function createInternalSiteCaller(handler, env = process.env) {
  return function callAction(body) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      const req = {
        method: "POST",
        headers: {
          "x-wiregeek-automation-key": String(
            env.WIREGEEK_AUTOMATION_KEY || ""
          ),
        },
        query: { mode: "site-publish" },
        body,
      };

      const res = {
        statusCode: 200,
        setHeader() {},
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          finish({ status: this.statusCode, body: payload });
          return this;
        },
      };

      Promise.resolve(handler(req, res))
        .then(() =>
          finish({
            status: 500,
            body: { success: false, error: "Handler sem resposta." },
          })
        )
        .catch(reject);
    });
  };
}

function succeeded(result) {
  return (
    result &&
    result.status >= 200 &&
    result.status < 300 &&
    result.body?.success === true
  );
}

function skip(noticiaId, stage, result) {
  return {
    noticia_id: noticiaId,
    stage,
    code: result?.body?.code || `HTTP_${result?.status ?? "ERRO"}`,
    error: String(result?.body?.error || "Falha sem detalhe.").slice(0, 300),
  };
}

function failure(status, code, error, extra = {}) {
  return { status, body: { success: false, code, error, ...extra } };
}

export async function runSiteAutopublish({
  supabase,
  callAction,
  env = process.env,
  now = Date.now(),
  dryRun = false,
}) {
  const config = readAutopublishConfig(env);

  const base = {
    success: true,
    enabled: config.enabled,
    dry_run: dryRun,
    daily_limit: config.dailyLimit,
    window_hours: config.windowHours,
    published: [],
    skipped: [],
  };

  if (!config.enabled && !dryRun) {
    return { status: 200, body: base };
  }

  if (!dryRun) {
    const missing = REQUIRED_ENV.filter(
      (name) => !String(env[name] || "").trim()
    );

    if (missing.length) {
      return failure(
        503,
        "AUTOPUBLISH_NOT_CONFIGURED",
        "Variaveis de ambiente ausentes para a publicacao automatica.",
        { missing }
      );
    }
  }

  // Limite por janela de 24h, contando tambem publicacoes manuais.
  const dayStart = new Date(now - 24 * HOUR_MS).toISOString();

  const recent = await supabase
    .from("site_news")
    .select("id")
    .eq("origin", "wiregeek")
    .gte("published_at", dayStart);

  if (recent.error) {
    return failure(
      503,
      "AUTOPUBLISH_STORAGE_UNAVAILABLE",
      "Nao foi possivel contar as publicacoes recentes."
    );
  }

  const remaining = config.dailyLimit - (recent.data?.length || 0);

  base.remaining_before = Math.max(0, remaining);

  if (remaining <= 0) {
    return { status: 200, body: { ...base, limit_reached: true } };
  }

  // Candidatas: noticias com imagem editorial aprovada, dentro da janela.
  const windowStart = new Date(
    now - config.windowHours * HOUR_MS
  ).toISOString();

  const rows = await supabase
    .from("publicacoes")
    .select("noticia_id,criado_em")
    .in("status", IMAGE_STATUSES)
    .not("source_image_url", "is", null)
    .gte("criado_em", windowStart)
    .order("criado_em", { ascending: false })
    .limit(100);

  if (rows.error) {
    return failure(
      503,
      "AUTOPUBLISH_STORAGE_UNAVAILABLE",
      "Nao foi possivel listar as noticias candidatas."
    );
  }

  const ids = [
    ...new Set(
      (rows.data || [])
        .map((row) => Number(row.noticia_id))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];

  if (!ids.length) {
    return { status: 200, body: { ...base, candidates: [] } };
  }

  const [alreadyPublished, approvals] = await Promise.all([
    supabase
      .from("site_news")
      .select("wiregeek_noticia_id")
      .eq("origin", "wiregeek")
      .in("wiregeek_noticia_id", ids),
    supabase
      .from("site_editorial_approvals")
      .select("noticia_id")
      .in("noticia_id", ids),
  ]);

  if (alreadyPublished.error || approvals.error) {
    return failure(
      503,
      "AUTOPUBLISH_STORAGE_UNAVAILABLE",
      "Nao foi possivel conferir publicacoes e aprovacoes existentes."
    );
  }

  const published = new Set(
    (alreadyPublished.data || []).map((row) => Number(row.wiregeek_noticia_id))
  );

  const approved = new Set(
    (approvals.data || []).map((row) => Number(row.noticia_id))
  );

  const candidates = ids.filter((id) => !published.has(id));

  if (dryRun) {
    return {
      status: 200,
      body: {
        ...base,
        candidates: candidates.map((id) => ({
          noticia_id: id,
          has_approval: approved.has(id),
        })),
      },
    };
  }

  const maxAttempts = Math.min(remaining * 2, MAX_ATTEMPTS_PER_RUN);
  let attempts = 0;

  for (const noticiaId of candidates) {
    if (base.published.length >= remaining || attempts >= maxAttempts) {
      break;
    }

    attempts += 1;

    try {
      // Aprovacao ja gravada: publica sem gerar de novo (evita custo de IA).
      if (!approved.has(noticiaId)) {
        const generated = await callAction({
          action: "generate-editorial",
          noticia_id: noticiaId,
        });

        const receipt = generated?.body?.data?.approval_receipt;

        if (!succeeded(generated) || !receipt) {
          base.skipped.push(skip(noticiaId, "generate", generated));
          continue;
        }

        const approval = await callAction({
          action: "approve-editorial",
          noticia_id: noticiaId,
          materia_site: generated.body.data.materia_site,
          resumo_site: generated.body.data.resumo_site,
          approval_receipt: receipt,
        });

        if (!succeeded(approval)) {
          base.skipped.push(skip(noticiaId, "approve", approval));
          continue;
        }
      }

      const result = await callAction({
        action: "publish",
        noticia_id: noticiaId,
      });

      if (!succeeded(result)) {
        base.skipped.push(skip(noticiaId, "publish", result));
        continue;
      }

      base.published.push({
        noticia_id: noticiaId,
        action: result.body.action || "published",
        site_url: result.body.data?.site_url || null,
      });
    } catch (error) {
      base.skipped.push({
        noticia_id: noticiaId,
        stage: "exception",
        code: "AUTOPUBLISH_EXCEPTION",
        error: String(error?.message || "Erro inesperado.").slice(0, 300),
      });
    }
  }

  base.attempts = attempts;

  return { status: 200, body: base };
}
