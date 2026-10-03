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
// Service failures are never stored. Restarting a server clears every entry.
export function createGenerationCache({ name, ttlMs, maxEntries, now = Date.now }) {
  const entries = new Map();
  const pending = new Map();
  return {
    async run(key, produce, { refresh = false, cacheIf = () => true } = {}) {
      const time = now();
      for (const [id, entry] of entries) if (entry.expires <= time) entries.delete(id);
      if (refresh) entries.delete(key);
      if (pending.has(key)) {
        console.log('WIRE/GEEK: geracao compartilhada', { flow: name });
        return structuredClone(await pending.get(key));
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
      const task = Promise.resolve().then(produce).then(value => {
        if (cacheIf(value)) {
          entries.set(key, { value: structuredClone(value), expires: now() + ttlMs });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        }
        return value;
      });
      pending.set(key, task);
      try { return structuredClone(await task); }
      finally { if (pending.get(key) === task) pending.delete(key); }
    },
  };
}
