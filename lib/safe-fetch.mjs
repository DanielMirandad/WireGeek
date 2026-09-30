import {
  BlockList,
  isIP,
} from "node:net";

import {
  lookup as dnsLookup,
} from "node:dns/promises";

const blocked =
  new BlockList();

const ipv4Ranges = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

for (const [address, prefix] of ipv4Ranges) {
  blocked.addSubnet(
    address,
    prefix,
    "ipv4"
  );

  blocked.addSubnet(
    `::ffff:${address}`,
    96 + prefix,
    "ipv6"
  );
}

const ipv6Ranges = [
  ["::", 96],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

for (const [address, prefix] of ipv6Ranges) {
  blocked.addSubnet(
    address,
    prefix,
    "ipv6"
  );
}

const redirectStatus =
  new Set([
    301,
    302,
    303,
    307,
    308,
  ]);

function securityError(message) {
  const error =
    new Error(message);

  error.code =
    "ERR_WIREGEEK_UNSAFE_URL";

  return error;
}

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "")
    .split("%")[0];
}

function blockedAddress(value) {
  const address =
    normalizeHost(value);

  const family =
    isIP(address);

  if (family === 4) {
    return blocked.check(
      address,
      "ipv4"
    );
  }

  if (family === 6) {
    return blocked.check(
      address,
      "ipv6"
    );
  }

  return true;
}

async function validateHost(
  hostname,
  lookupImpl
) {
  const host =
    normalizeHost(hostname);

  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    throw securityError(
      "Destino local bloqueado."
    );
  }

  if (isIP(host)) {
    if (blockedAddress(host)) {
      throw securityError(
        "Endereco privado ou reservado bloqueado."
      );
    }

    return;
  }

  let answers;

  try {
    answers =
      await lookupImpl(
        host,
        {
          all: true,
          verbatim: true,
        }
      );
  } catch {
    throw securityError(
      "Falha ao validar DNS."
    );
  }

  if (!Array.isArray(answers)) {
    answers = [answers];
  }

  if (!answers.length) {
    throw securityError(
      "Destino sem endereco DNS."
    );
  }

  for (const answer of answers) {
    const address =
      String(
        answer?.address || ""
      );

    if (
      !address ||
      blockedAddress(address)
    ) {
      throw securityError(
        "DNS privado ou reservado bloqueado."
      );
    }
  }
}

export async function assertPublicHttpUrl(
  value,
  {
    lookupImpl = dnsLookup,
  } = {}
) {
  let url;

  try {
    url =
      value instanceof URL
        ? new URL(value.href)
        : new URL(
            String(value || "").trim()
          );
  } catch {
    throw securityError(
      "URL invalida."
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw securityError(
      "Protocolo bloqueado."
    );
  }

  if (
    url.username ||
    url.password
  ) {
    throw securityError(
      "Credenciais na URL bloqueadas."
    );
  }

  await validateHost(
    url.hostname,
    lookupImpl
  );

  return url;
}

export async function safeFetch(
  value,
  {
    fetchImpl = fetch,
    lookupImpl = dnsLookup,
    maxRedirects = 4,
    ...options
  } = {}
) {
  let current =
    await assertPublicHttpUrl(
      value,
      {
        lookupImpl,
      }
    );

  let redirects = 0;

  while (true) {
    const response =
      await fetchImpl(
        current,
        {
          ...options,
          redirect: "manual",
        }
      );

    if (
      !redirectStatus.has(
        response.status
      )
    ) {
      return response;
    }

    const location =
      response.headers?.get?.(
        "location"
      );

    if (!location) {
      return response;
    }

    if (
      redirects >= maxRedirects
    ) {
      throw securityError(
        "Limite de redirects excedido."
      );
    }

    const method =
      String(
        options.method || "GET"
      ).toUpperCase();

    if (
      method !== "GET" &&
      method !== "HEAD"
    ) {
      throw securityError(
        "Redirect inseguro bloqueado."
      );
    }

    const next =
      new URL(
        location,
        current
      );

    current =
      await assertPublicHttpUrl(
        next,
        {
          lookupImpl,
        }
      );

    redirects += 1;
  }
}