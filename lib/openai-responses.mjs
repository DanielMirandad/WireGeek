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
  instructions,
  input,
  tools,
  toolChoice,
  reasoning,
  text,
  maxOutputTokens,
  timeoutMs = 30000,
}) {
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