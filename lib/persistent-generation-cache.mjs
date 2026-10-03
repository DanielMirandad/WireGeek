import { createClient } from '@supabase/supabase-js';

// Server-only client. Never fall back to a public/anon key.
function client() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

// Persist only output contract fields; never request objects or OpenAI envelopes.
function outputPayload(namespace, value) {
  const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
  if (namespace === 'banner-title') return pick(value, ['title_main', 'title_theme']);
  if (namespace === 'briefing-vision') return {
    ...pick(value, ['approved', 'message', 'indexes']),
    result: { distinct: value.result.distinct, images: value.result.images.map(image => pick(image, ['index', 'approved', 'reason'])) },
  };
  if (namespace === 'site-editorial') return {
    status: value.status,
    json: { success: value.json.success, data: {
      ...pick(value.json.data, ['materia_site', 'resumo_site']),
      diagnostico: pick(value.json.data.diagnostico, ['caracteres', 'paragrafos', 'resumo_caracteres']),
      fontes_base: (Array.isArray(value.json.data.fontes_base) ? value.json.data.fontes_base : []).map(source => pick(source, ['nome', 'url', 'publicado_em'])),
      fontes_pesquisa: (Array.isArray(value.json.data.fontes_pesquisa) ? value.json.data.fontes_pesquisa : []).map(source => pick(source, ['title', 'url'])),
    } },
  };
  throw new Error('UNKNOWN_GENERATION_CACHE_NAMESPACE');
}

export function createPersistentGenerationStore(getClient = client, { now = Date.now } = {}) {
  let nextCleanup = -Infinity;
  // Best effort per store/instance: at most 100 expired rows every five minutes,
  // shared two-second deadline, never awaited by reads/writes; no cron required.
  function cleanup(db) {
    const time = now();
    if (time < nextCleanup) return;
    nextCleanup = time + 5 * 60 * 1000;
    void Promise.resolve().then(async () => {
      const signal = AbortSignal.timeout(2000);
      const { data, error } = await db.from('openai_generation_cache')
        .select('namespace,key_hash').lt('expires_at', 'now')
        .order('expires_at').limit(100).abortSignal(signal);
      if (error) throw new Error('GENERATION_CACHE_CLEANUP_FAILED');
      const groups = new Map();
      for (const row of data || []) {
        if (!groups.has(row.namespace)) groups.set(row.namespace, []);
        groups.get(row.namespace).push(row.key_hash);
      }
      for (const [namespace, keys] of groups) {
        // Recheck expires_at < database now() so concurrent renewals survive.
        const { error } = await db.from('openai_generation_cache').delete()
          .eq('namespace', namespace).in('key_hash', keys)
          .lt('expires_at', 'now').abortSignal(signal);
        if (error) throw new Error('GENERATION_CACHE_CLEANUP_FAILED');
      }
    }).catch(() => {
      console.warn('WIRE/GEEK: cache persistente indisponivel', { operation: 'cleanup' });
    });
  }
  return {
    async get(namespace, key) {
      const db = getClient();
      if (!db) return null;
      cleanup(db);
      const { data, error } = await db.from('openai_generation_cache')
        .select('payload,expires_at').eq('namespace', namespace).eq('key_hash', key)
        .abortSignal(AbortSignal.timeout(2000)).maybeSingle();
      if (error) throw new Error('GENERATION_CACHE_READ_FAILED');
      return data;
    },
    async set(namespace, key, payload, created, expires) {
      const db = getClient();
      if (!db) return;
      cleanup(db);
      const { error } = await db.from('openai_generation_cache').upsert({
        namespace, key_hash: key, payload: outputPayload(namespace, payload),
        created_at: new Date(created).toISOString(), expires_at: new Date(expires).toISOString(),
      }, { onConflict: 'namespace,key_hash' }).abortSignal(AbortSignal.timeout(2000));
      if (error) throw new Error('GENERATION_CACHE_WRITE_FAILED');
    },
  };
}
