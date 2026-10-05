import { createClient } from "@supabase/supabase-js";

function projectRefFromUrl(value) {
  try {
    return new URL(String(value || "")).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ success: false });
  }

  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  ).trim();

  const ref = projectRefFromUrl(url);

  if (!url || !key) {
    return res.status(500).json({
      success: false,
      environment: process.env.VERCEL_ENV || null,
      project_ref: ref,
      error: "Supabase preview environment incomplete.",
    });
  }

  try {
    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const [edicoes, noticias] = await Promise.all([
      supabase.from("edicoes").select("id", { count: "exact", head: true }),
      supabase.from("noticias").select("id", { count: "exact", head: true }),
    ]);

    return res.status(200).json({
      success: !edicoes.error && !noticias.error,
      environment: process.env.VERCEL_ENV || null,
      git_ref: process.env.VERCEL_GIT_COMMIT_REF || null,
      project_ref: ref,
      counts: {
        edicoes: edicoes.count ?? null,
        noticias: noticias.count ?? null,
      },
      errors: {
        edicoes: edicoes.error?.message || null,
        noticias: noticias.error?.message || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      environment: process.env.VERCEL_ENV || null,
      git_ref: process.env.VERCEL_GIT_COMMIT_REF || null,
      project_ref: ref,
      error: String(error?.message || error).slice(0, 300),
    });
  }
}
