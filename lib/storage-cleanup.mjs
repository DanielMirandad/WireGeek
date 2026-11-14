// Apaga do Storage os banners e vídeos antigos do bucket wiregeek-banners.
// O plano gratuito do Supabase tem só 1 GB (compartilhado com o site do Bagaça) e este bucket passou disso.
// Depois de publicado, o Instagram e o YouTube já têm a cópia deles; só arquivos antigos são apagados.

export const WIREGEEK_BUCKET = "wiregeek-banners";
// "" = banners PNG na raiz do bucket; "instagram-reels" = vídeos.
export const WIREGEEK_FOLDERS = ["", "instagram-reels"];
export const DEFAULT_RETENTION_DAYS = 60;

async function listFolder(supabase, bucket, folder) {
  const files = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folder, { limit: pageSize, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) throw error;
    for (const item of data ?? []) {
      // Pastas vêm sem id/metadata; só arquivos entram.
      if (item.id || item.metadata) files.push(item);
    }
    if (!data || data.length < pageSize) break;
  }
  return files;
}

// Devolve { [pasta]: { removed, kept, bytes } }. dryRun: só conta, não apaga.
export async function cleanupOldStorage(
  supabase,
  { bucket = WIREGEEK_BUCKET, folders = WIREGEEK_FOLDERS, days = DEFAULT_RETENTION_DAYS, now = Date.now(), dryRun = false } = {}
) {
  const cutoff = now - days * 24 * 36e5;
  const summary = {};
  for (const folder of folders) {
    const files = await listFolder(supabase, bucket, folder);
    const old = files.filter((file) => {
      const created = Date.parse(file.created_at || file.updated_at || "");
      return Number.isFinite(created) && created < cutoff;
    });
    const bytes = old.reduce((sum, file) => sum + Number(file.metadata?.size || 0), 0);
    if (!dryRun) {
      for (let index = 0; index < old.length; index += 100) {
        const batch = old.slice(index, index + 100).map((file) => (folder ? `${folder}/${file.name}` : file.name));
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (error) throw error;
      }
    }
    summary[folder || "(raiz)"] = { removed: old.length, kept: files.length - old.length, bytes };
  }
  return summary;
}
