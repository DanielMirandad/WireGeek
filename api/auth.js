import crypto from "node:crypto";

const SESSION_MAX_AGE = 8 * 60 * 60;

function sign(value) {
  return crypto
    .createHmac("sha256", process.env.WIREGEEK_ACCESS_KEY || "")
    .update(value)
    .digest("base64url");
}

function createSession() {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = String(timestamp);
  const signature = sign(payload);

  return `${payload}.${signature}`;
}

function isValidSession(token) {
  if (!token) return false;

  const [timestamp, signature] = String(token).split(".");

  if (!timestamp || !signature) return false;

  const issuedAt = Number(timestamp);

  if (!Number.isFinite(issuedAt)) return false;

  const age = Math.floor(Date.now() / 1000) - issuedAt;

  if (age < 0 || age > SESSION_MAX_AGE) {
    return false;
  }

  const expected = sign(timestamp);

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    providedBuffer,
    expectedBuffer
  );
}

function getCookie(req, name) {
  const header = req.headers?.cookie || "";

  const cookies = header.split(";");

  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(parts.join("="));
    }
  }

  return null;
}

export function hasValidSession(req) {
  return isValidSession(
    getCookie(req, "wiregeek_session")
  );
}

export function hasValidAutomationKey(req) {
  const expected = String(
    process.env.WIREGEEK_AUTOMATION_KEY || ""
  ).trim();

  const provided = String(
    req.headers?.["x-wiregeek-automation-key"] || ""
  ).trim();

  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (
    expectedBuffer.length !==
    providedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    providedBuffer
  );
}

export function hasValidWireGeekAuth(req) {
  return (
    hasValidSession(req) ||
    hasValidAutomationKey(req)
  );
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      authenticated: hasValidSession(req),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido.",
    });
  }

  const adminKey =
    process.env.WIREGEEK_ACCESS_KEY;

  const providedKey =
    req.body?.key;

  if (!adminKey) {
    console.error(
      "WIRE/GEEK: WIREGEEK_ACCESS_KEY nao configurada."
    );

    return res.status(500).json({
      error: "Autenticacao nao configurada.",
    });
  }

  if (
    typeof providedKey !== "string" ||
    providedKey !== adminKey
  ) {
    console.warn(
      "WIRE/GEEK: tentativa de login administrativo recusada."
    );

    return res.status(401).json({
      error: "Credencial invalida.",
    });
  }

  const session = createSession();

  res.setHeader(
    "Set-Cookie",
    [
      `wiregeek_session=${encodeURIComponent(session)}`,
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
      `Max-Age=${SESSION_MAX_AGE}`,
      process.env.NODE_ENV === "production"
        ? "Secure"
        : "",
    ]
      .filter(Boolean)
      .join("; ")
  );

  console.log(
    "WIRE/GEEK: login administrativo autorizado."
  );

  return res.status(200).json({
    authenticated: true,
    expiresIn: SESSION_MAX_AGE,
  });
}

