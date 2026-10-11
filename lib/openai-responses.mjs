import { createClient } from '@supabase/supabase-js';
import { executeReservedHomologation } from './paid-homologation-reserved-transport.mjs';
import { randomUUID } from 'node:crypto';
import { assertPaidHomologationTransportReady } from './paid-homologation-gate.mjs';

const OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses";

function openAIError(code, cause) {
  const error = new Error(code);
  if (cause) error.cause = cause;
  return error;
}

function openAIHttpError(status) {
  if (status === 401 || status === 403) return "OPENAI_AUTH_ERROR";
  if (status === 404) return "OPENAI_MODEL_OR_ENDPOINT_ERROR";
  if (status === 429) return "OPENAI_RATE_LIMITED";
  if (status >= 500) return "OPENAI_UPSTREAM_ERROR";
  return "OPENAI_REQUEST_REJECTED";
}

function getApiKey() {
  const apiKey =
    String(
      process.env.OPENAI_API_KEY || ""
    ).trim();

  if (!apiKey) {
    throw openAIError(
      "OPENAI_API_KEY_MISSING"
    );
  }

  return apiKey;
}

export function getOpenAIModel(
  envName,
  fallback
) {
  return String(
    process.env[envName] ||
    fallback
  ).trim();
}

export function imageDataUrl(
  buffer,
  mimeType = "image/jpeg"
) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError(
      "A imagem precisa ser um Buffer."
    );
  }

  return (
    "data:" +
    mimeType +
    ";base64," +
    buffer.toString("base64")
  );
}

function extractOutputText(response) {
  if (
    typeof response?.output_text ===
      "string" &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  const parts = [];

  for (
    const item of
      Array.isArray(response?.output)
        ? response.output
        : []
  ) {
    for (
      const content of
        Array.isArray(item?.content)
          ? item.content
          : []
    ) {
      if (
        content?.type === "output_text" &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("").trim();
}

async function requestOpenAIUnreserved({
  model,
  purpose = 'unspecified',
  instructions,
  input,
  tools,
  toolChoice,
  reasoning,
  text,
  maxOutputTokens,
  timeoutMs = 30000,
  reservedBody = null,
}) {
  const started = Date.now();
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const body = {
      model,
      input,
    };

    if (instructions) {
      body.instructions =
        instructions;
    }

    if (
      Array.isArray(tools) &&
      tools.length
    ) {
      body.tools = tools;
    }

    if (toolChoice) {
      body.tool_choice =
        toolChoice;
    }

    if (
      reasoning &&
      typeof reasoning === "object"
    ) {
      body.reasoning =
        reasoning;
    }

    if (text) {
      body.text = text;
    }

    if (
      Number.isInteger(
        maxOutputTokens
      ) &&
      maxOutputTokens > 0
    ) {
      body.max_output_tokens =
        maxOutputTokens;
    }

    const apiKey = getApiKey();
    let response;

    try {
      response =
        await fetch(
        OPENAI_RESPONSES_URL,
        {
          method: "POST",

          headers: {
            Authorization:
              "Bearer " +
              getApiKey(),

            "Content-Type":
              "application/json",
          },

          body:
            reservedBody ?? JSON.stringify(body),

          signal:
            controller.signal,
        }
      );
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        throw openAIError(
          "OPENAI_TIMEOUT",
          error
        );
      }

      throw openAIError(
        "OPENAI_NETWORK_ERROR",
        error
      );
    }

    let payload;

    try {
      payload =
        await response.json();
    } catch (error) {
      throw openAIError(
        "OPENAI_INVALID_RESPONSE",
        error
      );
    }

    const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    console.log('WIRE/GEEK: consumo OpenAI', {
      flow: purpose,
      model,
      http_status: response.status,
      duration_ms: Date.now() - started,
      input_tokens: tokenCount(payload?.usage?.input_tokens),
      output_tokens: tokenCount(payload?.usage?.output_tokens),
      cached_input_tokens: tokenCount(payload?.usage?.input_tokens_details?.cached_tokens),
      reasoning_tokens: tokenCount(payload?.usage?.output_tokens_details?.reasoning_tokens),
      web_search_calls: Array.isArray(payload?.output) ? payload.output.filter(item => item?.type === 'web_search_call').length : null,
    });

    if (!response.ok) {
      throw openAIError(
        openAIHttpError(
          response.status
        )
      );
    }

    return {
      response: payload,
      text:
        extractOutputText(
          payload
        ),
    };
  } finally {
    clearTimeout(timer);
  }
}
export async function createOpenAIResponse(options) {
  if (process.env.VERCEL_ENV === 'preview' &&
      process.env.VERCEL_GIT_COMMIT_REF === 'fix/editorial-test-cost-gate' &&
      process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED !== '1') {
    throw openAIError('HOMOLOGATION_PREVIEW_DISABLED');
  }
  if (process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED !== '1') {
    return requestOpenAIUnreserved(options);
  }
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.VERCEL_GIT_COMMIT_REF !== 'fix/editorial-test-cost-gate') {
    throw openAIError('HOMOLOGATION_PREVIEW_BRANCH_REQUIRED');
  }
  // The paid pilot is opt-in and deny-by-default. No unguarded path may be
  // reached after this branch, including rejected ledger reservations.
  const { model, purpose, input, instructions, tools, toolChoice, reasoning, text, maxOutputTokens } = options || {};
  if (!['site-editorial', 'site-editorial-verification'].includes(purpose) ||
      typeof input !== 'string' || !input ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
      tools != null || toolChoice != null ||
      (reasoning != null && typeof reasoning !== 'object') ||
      options?.serviceTier != null || options?.promptCacheRetention != null ||
      options?.promptCacheKey != null || options?.background != null) {
    throw openAIError('HOMOLOGATION_REQUEST_UNBOUNDED');
  }
  const pilotId = String(process.env.WIREGEEK_HOMOLOGATION_PILOT_ID || '');
  const newsId = Number(process.env.WIREGEEK_HOMOLOGATION_NEWS_ID);
  const arm = String(process.env.WIREGEEK_HOMOLOGATION_ARM || '');
  const supabaseUrl = String(process.env.SUPABASE_URL || '');
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!pilotId || !serviceKey || !supabaseUrl || !['luna','sol'].includes(arm)) {
    throw openAIError('HOMOLOGATION_LEDGER_NOT_CONFIGURED');
  }
  // Byte size conservatively bounds token count for text-only requests;
  // account for all serialized fields, not merely the caller's article text.
  // Serialize exactly the fields sent by the HTTP client. Freeze their
  // serialized bytes before reserving, so inputs cannot change in transit.
  const payload = { model, input };
  if (instructions) payload.instructions = instructions;
  if (reasoning) payload.reasoning = reasoning;
  if (text) payload.text = text;
  payload.max_output_tokens = maxOutputTokens;
  payload.service_tier = 'default';
  const serializedBody = JSON.stringify(payload);
  // UTF-8 byte length is a deliberately oversized ceiling for plain text.
  // Additional overhead is reserved for message framing and tokenization.
  const maxInputTokens = Buffer.byteLength(serializedBody, 'utf8') + 4096;
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens > 128000) {
    throw openAIError('HOMOLOGATION_INPUT_LIMIT_EXCEEDED');
  }
  const { boundReservedTextCost } = await import('./paid-homologation-pricing.mjs');
  const reserveMicroUsd = boundReservedTextCost({model,maxInputTokens,maxOutputTokens});
  if (reserveMicroUsd == null || reserveMicroUsd > 1_000_000) {
    throw openAIError('HOMOLOGATION_PRICE_UNBOUNDED');
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await executeReservedHomologation({
    supabase,
    reservation: {pilotId,newsId,arm,stage:purpose,model,maxInputTokens,maxOutputTokens,
      reserveMicroUsd,idempotencyKey:randomUUID()},
    send: async () => {
      const sent = await requestOpenAIUnreserved({...options, reservedBody: serializedBody});
      return sent.response;
    },
  });
  if (!result.success) throw openAIError(result.code);
  return {response:result.response,text:extractOutputText(result.response)};
}
