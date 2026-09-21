import crypto from "node:crypto";

const pending = new Map();
let canvaTokens = null;

const scopes = [
  "design:content:read",
  "design:content:write",
  "design:meta:read",
  "asset:read",
  "asset:write",
];

function config() {
  const clientId = String(process.env.CANVA_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.CANVA_CLIENT_SECRET || "").trim();
  const redirectUri = String(
    process.env.CANVA_REDIRECT_URI ||
      "http://127.0.0.1:3001/api/canva/callback"
  ).trim();
  if (!clientId || !clientSecret) throw new Error("Canva nao configurado.");
  return { clientId, clientSecret, redirectUri };
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function hasCanvaToken() {
  return Boolean(canvaTokens?.access_token);
}

export function getCanvaAccessToken() {
  return canvaTokens?.access_token || null;
}

async function createAutofill(body = {}) {
  const token = getCanvaAccessToken();
  if (!token) throw new Error("Canva ainda nao esta conectado.");
  const designId = String(body.design_id || "DAHVVf7QSXE").trim();
  const data = body.data && typeof body.data === "object" ? body.data : {};
  if (!Object.keys(data).length) throw new Error("Informe ao menos um campo em data.");
  const response = await fetch("https://api.canva.com/rest/v1/autofills", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "create_from_design",
      design_id: designId,
      title: String(body.title || "WireGeek - teste de autofill"),
      data,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Canva autofill falhou (${response.status}): ${result?.message || "erro desconhecido"}`);
  }
  return result;
}

async function getDesignDataset(designId) {
  const token = getCanvaAccessToken();
  if (!token) throw new Error("Canva ainda nao esta conectado.");
  const response = await fetch(
    `https://api.canva.com/rest/v1/designs/${encodeURIComponent(designId)}/dataset`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Canva dataset falhou (${response.status}): ${body?.message || "erro desconhecido"}`);
  }
  return body;
}

export default async function handler(req, res) {
    const path = req.url?.split("?")[0] || "";
    const isCallback = path.endsWith("callback");
    const isDataset = path.endsWith("dataset");
    const isAutofill = path.endsWith("autofill");
    const action = String(req.query?.action || (isDataset ? "dataset" : isAutofill ? "autofill" : isCallback ? "callback" : "authorize"));
    if (req.method !== "GET" && !(req.method === "POST" && action === "autofill")) {
      return res.status(405).json({ error: "Metodo nao permitido." });
    }

  try {
    const { clientId, clientSecret, redirectUri } = config();

    if (action === "dataset") {
      const designId = String(req.query?.design_id || "DAHVVf7QSXE").trim();
      return res.status(200).json(await getDesignDataset(designId));
    }

    if (action === "autofill") {
      return res.status(202).json(await createAutofill(req.body));
    }

    if (action === "authorize") {
      const state = base64url(crypto.randomBytes(32));
      const { verifier, challenge } = createPkce();
      pending.set(state, { verifier, createdAt: Date.now() });
      const url = new URL("https://www.canva.com/api/oauth/authorize");
      url.search = new URLSearchParams({
        code_challenge_method: "s256",
        code_challenge: challenge,
        response_type: "code",
        client_id: clientId,
        scope: scopes.join(" "),
        state,
        redirect_uri: redirectUri,
      });
      return res.redirect(url.toString());
    }

    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    const entry = pending.get(state);
    pending.delete(state);
    if (!code || !state || !entry || Date.now() - entry.createdAt > 10 * 60 * 1000) {
      return res.status(400).send("Autorizacao Canva invalida ou expirada.");
    }

    const response = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: entry.verifier,
        redirect_uri: redirectUri,
      }),
    });
    if (!response.ok) throw new Error(`Canva token exchange falhou (${response.status}).`);
    canvaTokens = await response.json();
    return res.status(200).send("Canva conectado com sucesso. Voce pode fechar esta aba.");
  } catch (error) {
    console.error("WIRE/GEEK: erro OAuth Canva:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
