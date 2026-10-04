export const LATEST_CACHE_KEY = "wire-geek:latest:v1";
// Local visual preparation is independent of the day and server response cache.
export const PREPARED_CACHE_KEY = "wire-geek:prepared:v1";

export function readPreparedEdition(storage, legacyKey) {
  for (const key of [PREPARED_CACHE_KEY, legacyKey]) {
    try {
      const saved = JSON.parse(storage?.getItem(key) || "null");
      if (Array.isArray(saved?.news)) return saved;
    } catch { /* Optional visual cache. */ }
  }
  return null;
}

export function savePreparedEdition(storage, edition, legacyKey) {
  for (const key of [PREPARED_CACHE_KEY, legacyKey]) {
    try { storage?.setItem(key, JSON.stringify(edition)); }
    catch { /* A disabled/full cache must not prevent local preparation. */ }
  }
}

function newsId(item) {
  return String(item?.noticia_id ?? item?.id ?? "").trim();
}

function hasPendingManualBanner(item) {
  const id = newsId(item);
  return Boolean(id) && Array.isArray(item?.briefing_generated_banners) &&
    item.briefing_generated_banners.some(slide => {
      if (slide?.type !== "editorial" || slide.publication_id != null ||
          (slide.noticia_id != null && String(slide.noticia_id) !== id) ||
          typeof slide.banner_url !== "string") return false;
      try { return ["https:", "http:"].includes(new URL(slide.banner_url).protocol); }
      catch { return false; }
    });
}

export const EDITION_POLL_MS = 60_000;

export function decodeLatestEdition(payload) {
  if (!payload || typeof payload.pending !== "boolean" || !Array.isArray(payload.edicoes) || payload.edicoes.length > 1) {
    throw new Error("Resposta de edições inválida.");
  }
  const stored = payload.edicoes[0];
  if (!stored) return null;
  const date = stored.criado_em || stored.data_edicao;
  if (!stored.id || !Number.isFinite(Date.parse(date)) || !Array.isArray(stored.news) || !stored.news.length ||
      stored.news.some(item => !item?.id || !item.titulo || !Array.isArray(item.highlights) || !Array.isArray(item.hashtags) || !Array.isArray(item.fontes))) {
    throw new Error("Edição recebida incompleta.");
  }
  return { id: stored.id, title: stored.titulo || "Edição Wire/Geek", generatedAt: date, news: stored.news };
}

export function sameEdition(a, b) {
  if (!a || !b) return a === b;
  if (!Array.isArray(a.news) || !Array.isArray(b.news) || a.news.some(item => !item?.id) || b.news.some(item => !item?.id)) return false;
  if (a.id && b.id) return String(a.id) === String(b.id);
  return a.news.length === b.news.length && a.news.every((item, index) =>
    item.id && String(item.id) === String(b.news[index]?.id)
  );
}

function normalizedEditorialValue(value) {
  return String(
    value ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function editorialVisualIdentity(item = {}) {
  return JSON.stringify({
    id:
      normalizedEditorialValue(
        item.id
      ),

    titulo:
      normalizedEditorialValue(
        item.titulo ||
        item.title
      ),

    titulo_curto:
      normalizedEditorialValue(
        item.titulo_curto ||
        item.short_title
      ),

    categoria:
      normalizedEditorialValue(
        item.categoria ||
        item.category
      ),

    highlights:
      Array.isArray(
        item.highlights
      )
        ? item.highlights.map(
            normalizedEditorialValue
          )
        : [],
  });
}

function sameEditorialVisualIdentity(
  previous,
  current
) {
  if (
    !previous ||
    !current
  ) {
    return false;
  }

  return (
    editorialVisualIdentity(
      previous
    ) ===
    editorialVisualIdentity(
      current
    )
  );
}

// Ordinary local visuals require the same edition and editorial identity.
// Pending manual banners survive by news ID; editorial fields always come from the server.
export function mergeLatestEdition(current, next) {
  if (!next || !Array.isArray(current?.news)) return next;
  const sameSavedEdition = sameEdition(current, next);
  const local = new Map(current.news.filter(item => newsId(item)).map(item => [newsId(item), item]));
  return { ...next, news: next.news.map(item => {
    const merged = {
      ...item,
    };

    const previous =
      local.get(
        newsId(item)
      );

    const canReuseVisualPreparation =
      sameSavedEdition && sameEditorialVisualIdentity(
        previous,
        item
      );

    if (canReuseVisualPreparation) {
      for (
        const field of [
          "banners",
          "final_banners",
          "briefing_generated_banners",
          "briefing_source",
          "contexto_visual",
          "image_query",
          "image_url",
        ]
      ) {
        if (
          previous?.[field] &&
          (
            !item[field] ||
            (
              Array.isArray(
                item[field]
              ) &&
              !item[field].length
            )
          )
        ) {
          merged[field] =
            previous[field];
        }
      }
    }

    // Pending manual previews belong to the news ID, not the edition/text version.
    // Never copy editorial fields or published local banners over server content.
    if (hasPendingManualBanner(previous)) {
      merged.briefing_generated_banners = previous.briefing_generated_banners.filter(
        slide => slide &&
          (slide.type === "cta" || (slide.type === "editorial" && slide.publication_id == null)) &&
          (slide.noticia_id == null || String(slide.noticia_id) === newsId(item))
      );
      merged.briefing_source = true;
    }

    return merged;
  }) };
}

// GET-only synchronization. It never starts a generation or publishes content.
export function createEditionSync({
  fetcher = fetch, storage, visible = () => true, onChange, onUnauthorized,
  setTimer = setTimeout, clearTimer = clearTimeout, pollMs = EDITION_POLL_MS, timeoutMs = 15_000,
}) {
  let stopped = false, paused = false, timer, controller, sequence = 0, confirmed = false;
  const schedule = () => {
    clearTimer(timer);
    if (!stopped) timer = setTimer(refresh, pollMs);
  };
  function readCache() {
    try { return decodeLatestEdition(JSON.parse(storage?.getItem(LATEST_CACHE_KEY) || "null")); }
    catch { return null; }
  }
  async function refresh() {
    if (stopped || controller) return;
    clearTimer(timer);
    if (paused || !visible()) { schedule(); return; }
    const serial = ++sequence;
    controller = new AbortController();
    const requestController = controller;
    const timeout = setTimer(() => requestController.abort(), timeoutMs);
    try {
      const response = await fetcher("/api/edicoes?latest=1", {
        method: "GET", credentials: "include", cache: "no-store", signal: requestController.signal,
      });
      if (stopped || serial !== sequence) return;
      if (response.status === 401) {
        stopped = true;
        try { storage?.removeItem(LATEST_CACHE_KEY); } catch { /* Optional cache. */ }
        onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error("Não foi possível consultar as edições.");
      const payload = await response.json();
      const edition = decodeLatestEdition(payload);
      if (stopped || serial !== sequence) return;
      if (payload.pending) { onChange({ state: "pending" }); return; }
      confirmed = true;
      try {
        if (edition) storage?.setItem(LATEST_CACHE_KEY, JSON.stringify(payload));
        else storage?.removeItem(LATEST_CACHE_KEY);
      } catch { /* A disabled/full cache must not prevent server loading. */ }
      onChange({ state: "ready", edition, checkedAt: new Date().toISOString() });
    } catch {
      if (stopped || serial !== sequence) return;
      const cached = !confirmed ? readCache() : null;
      onChange({ state: "offline", ...(cached ? { edition: cached, fromCache: true } : {}) });
    } finally {
      clearTimer(timeout);
      if (serial === sequence) { controller = null; schedule(); }
    }
  }
  return {
    refresh,
    setPaused(value) {
      if (paused === value) return;
      paused = value;
      ++sequence;
      controller?.abort();
      controller = null;
      if (!paused) void refresh();
      else schedule();
    },
    stop() {
      stopped = true;
      ++sequence;
      clearTimer(timer);
      controller?.abort();
      controller = null;
    },
  };
}
