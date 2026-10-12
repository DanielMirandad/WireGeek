// Serialize writes for one panel so an older response cannot overwrite a newer edit.
export function createDraftAutosave({ save, notify = () => {}, delay = 1500,
  schedule = setTimeout, cancel = clearTimeout }) {
  let timer, pending = null, running = null, disposed = false;
  async function flush() {
    cancel(timer);
    if (running) return running;
    if (!pending) return;
    running = (async () => {
      while (pending) {
        const value = pending;
        pending = null;
        if (!disposed) notify('saving');
        try { await save(value); }
        catch (error) {
          // Retain the latest snapshot for explicit retry or the next edit.
          if (!pending) pending = value;
          if (!disposed) notify('error', error.message);
          throw error;
        }
      }
      if (!disposed) notify('saved');
    })().finally(() => { running = null; });
    return running;
  }
  return {
    update(value, immediate = false) {
      pending = { ...value };
      cancel(timer);
      if (!disposed) notify('pending');
      if (immediate) return flush();
      timer = schedule(() => { flush().catch(() => {}); }, delay);
    },
    flush,
    isDirty: () => Boolean(pending || running),
    dispose() { disposed = true; cancel(timer); return flush(); },
  };
}
