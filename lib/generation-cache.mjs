import { createPersistentGenerationStore } from './persistent-generation-cache.mjs';
import { createHash } from 'node:crypto';

// Hash data only; prompts, images and credentials never appear in cache logs.
export function generationKey(value) {
  function normalize(item) {
    if (Buffer.isBuffer(item)) return { image_sha256: createHash('sha256').update(item).digest('hex') };
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
    return item;
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

// Process-local, bounded TTL cache. Pending work is shared, including refreshes.
// Service failures are never stored. Supabase survives process restarts.
// Persistent caching provides no distributed lock between instances.
export function createGenerationCache({ name, ttlMs, maxEntries, now = Date.now, persistent = createPersistentGenerationStore() }) {
  const entries = new Map();
  const pending = new Map();
  return {
    async run(key, produce, { refresh = false, cacheIf = () => true } = {}) {
      const time = now();
      for (const [id, entry] of entries) if (entry.expires <= time) entries.delete(id);
      if (refresh) entries.delete(key);
      const pendingKey = refresh ? `${key}:refresh` : (pending.has(`${key}:refresh`) ? `${key}:refresh` : key);
      if (pending.has(pendingKey)) {
        console.log('WIRE/GEEK: geracao compartilhada', { flow: name });
        return structuredClone(await pending.get(pendingKey));
      }
      if (entries.has(key)) {
        const entry = entries.get(key);
        entries.delete(key);
        entries.set(key, entry);
        console.log('WIRE/GEEK: resultado reutilizado', { flow: name });
        return structuredClone(entry.value);
      }
      // Do not evict active work and accidentally allow duplicate requests.
      if (pending.size >= maxEntries) throw Object.assign(new Error('Muitas geracoes em andamento. Tente novamente apos a conclusao.'), { statusCode: 503 });
      const previous = refresh ? pending.get(key) : null;
      const task = Promise.resolve().then(async () => {
        if (previous) await previous.catch(() => {});
        if (!refresh && persistent) {
          try {
            const stored = await persistent.get(name, key);
            const expires = Date.parse(stored?.expires_at);
            if (expires > now() && cacheIf(stored.payload)) {
              entries.set(key, { value: structuredClone(stored.payload), expires });
              while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
              return stored.payload;
            }
          } catch {
            console.warn('WIRE/GEEK: cache persistente indisponivel', { flow: name, operation: 'read' });
          }
        }
        const value = await produce();
        if (cacheIf(value)) {
          const created = now(), expires = created + ttlMs;
          entries.set(key, { value: structuredClone(value), expires });
          if (persistent) {
            try { await persistent.set(name, key, value, created, expires); }
            catch { console.warn('WIRE/GEEK: cache persistente indisponivel', { flow: name, operation: 'write' }); }
          }
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        }
        return value;
      });
      pending.set(pendingKey, task);
      try { return structuredClone(await task); }
      finally { if (pending.get(pendingKey) === task) pending.delete(pendingKey); }
    },
  };
}
