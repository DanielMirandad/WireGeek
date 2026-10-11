import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { hasValidWireGeekAuth } from "./auth.js";
import sitePublishHandler from "../lib/site-publish-handler.mjs";
import {
  createInternalSiteCaller,
  runSiteAutopublish,
} from "../lib/site-autopublish.mjs";

function hasValidCronAuth(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();

  if (!secret) {
    return false;
  }

  const provided = String(req.headers?.authorization || "").trim();
  const expected = `Bearer ${secret}`;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

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

/*
 * GET  -> cron da Vercel (Authorization: Bearer CRON_SECRET).
 * POST -> execucao manual (sessao ou chave de automacao do WireGeek).
 * ?dry_run=1 (GET) ou {"dry_run":true} (POST) lista as candidatas sem gerar
 * nem publicar nada, mesmo com SITE_AUTOPUBLISH desligado.
 */
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({ error: "Metodo nao permitido." });
  }

  const manual = req.method === "POST";

  if (!(manual ? hasValidWireGeekAuth(req) : hasValidCronAuth(req))) {
    return res.status(401).json({ error: "Acesso nao autorizado." });
  }

  const dryRun = manual
    ? req.body?.dry_run === true
    : String(req.query?.dry_run || "") === "1";

  try {
    const result = await runSiteAutopublish({
      supabase: getSupabase(),
      callAction: createInternalSiteCaller(sitePublishHandler),
      dryRun,
    });

    console.log(
      "WIRE/GEEK: site-autopublish",
      JSON.stringify({
        dry_run: dryRun,
        status: result.status,
        published: result.body?.published?.length ?? 0,
        skipped: result.body?.skipped?.length ?? 0,
        enabled: result.body?.enabled,
      })
    );

    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("WIRE/GEEK: erro em site-autopublish:", error);

    return res.status(500).json({
      success: false,
      error: "Nao foi possivel executar a publicacao automatica.",
    });
  }
}
