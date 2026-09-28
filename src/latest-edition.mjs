export const LATEST_CACHE_KEY = "wire-geek:latest:v1";
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

// Only local visual preparation survives a refresh of the same saved news item
// when the editorial identity is still the same.
// All editorial fields come from the server.
export function mergeLatestEdition(current, next) {
  if (!next || !sameEdition(current, next)) return next;
  const local = new Map(current.news.map(item => [String(item.id), item]));
  return { ...next, news: next.news.map(item => {
    const merged = {
      ...item,
    };

    const previous =
      local.get(
        String(item.id)
      );

    const canReuseVisualPreparation =
      sameEditorialVisualIdentity(
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
