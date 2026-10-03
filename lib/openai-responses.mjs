const OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses";

function getApiKey() {
  const apiKey =
    String(
      process.env.OPENAI_API_KEY || ""
    ).trim();

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY nao configurada."
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

    const response =
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

    const payload =
      await response.json();

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
      const message =
        String(
          payload?.error?.message ||
          ""
        ).trim();

      throw new Error(
        message ||
        "OpenAI Responses API retornou HTTP " +
          response.status +
          "."
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