import { createClient } from "@supabase/supabase-js";
import { hasValidWireGeekAuth, hasValidAutomationKey } from "./auth.js";
import { repairMissingPublicationGroup } from "../lib/publication-group-repair.mjs";

function getSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  ).trim();

  if (!url || !key) {
    throw new Error("Supabase nao configurado.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Metodo nao permitido.",
    });
  }

  let authenticated = false;
  try {
    authenticated =
      hasValidWireGeekAuth(req) &&
      (
        Boolean(String(process.env.WIREGEEK_ACCESS_KEY || "").trim()) ||
        hasValidAutomationKey(req)
      );
  } catch {
    // Malformed cookies fail closed.
  }

  if (!authenticated) {
    return res.status(401).json({
      success: false,
      error: "Nao autorizado.",
    });
  }

  if (process.env.WIREGEEK_PUBLICATION_REPAIR_ENABLED !== "1") {
    return res.status(403).json({
      success: false,
      code: "PUBLICATION_REPAIR_DISABLED",
      error: "Reparo de grupos de publicacao desativado.",
    });
  }

  try {
    const result = await repairMissingPublicationGroup({
      supabase: getSupabase(),
      noticiaId: req.body?.noticia_id,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(409).json({
      success: false,
      code: "PUBLICATION_GROUP_REPAIR_FAILED",
      error: error?.message || "Falha ao reparar o grupo de publicacao.",
    });
  }
}
