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

export async function createOpenAIResponse({
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
            JSON.stringify(body),

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
      if (response.status === 429) {
        // Log only an allowlisted diagnostic category; never provider messages,
        // headers, IDs, request content or credentials.
        const providerCode = payload?.error?.code;
        const providerType = payload?.error?.type;
        const categories = new Set([
          'insufficient_quota', 'rate_limit_exceeded',
          'tokens', 'requests',
        ]);
        const category = categories.has(providerCode)
          ? providerCode
          : categories.has(providerType) ? providerType : 'unknown';
        const rawDelay = response.headers?.get?.('retry-after');
        const numericDelay = rawDelay && /^\\d{1,4}$/.test(rawDelay) ? Number(rawDelay) : null;
        console.warn('WIRE/GEEK: limite OpenAI', {
          flow: purpose,
          model,
          category,
          retry_after_seconds: numericDelay !== null && numericDelay <= 3600 ? numericDelay : null,
        });
      }
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