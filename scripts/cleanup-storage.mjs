// Apaga banners e vídeos com mais de STORAGE_RETENTION_DAYS dias (padrão 60) do bucket wiregeek-banners.
// Uso: node scripts/cleanup-storage.mjs [--dry-run]
// Variáveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { DEFAULT_RETENTION_DAYS, cleanupOldStorage } from "../lib/storage-cleanup.mjs";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  return value;
}

async function main() {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const days = Number(process.env.STORAGE_RETENTION_DAYS) > 0 ? Number(process.env.STORAGE_RETENTION_DAYS) : DEFAULT_RETENTION_DAYS;
  const dryRun = process.argv.includes("--dry-run");
  const summary = await cleanupOldStorage(supabase, { days, dryRun });
  for (const [folder, info] of Object.entries(summary)) {
    console.log(
      `${folder}: ${dryRun ? "apagaria" : "apagou"} ${info.removed} arquivo(s) com mais de ${days} dias (${(info.bytes / 1048576).toFixed(0)} MB); ficam ${info.kept}.`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`::error title=limpeza do Storage::${error?.message || error}`);
    process.exit(1);
  });
}
