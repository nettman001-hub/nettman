import {
  AI_ENGINE_PRESETS,
  type AiEngine,
  type AiRequestConfig,
} from "./ai-config.ts";
import { planCustomAiEndpoint } from "./ai-custom-endpoint.ts";

export type StructuredAiInput = {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  maxOutputTokens: number;
};

export type AiProviderRequest = {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function providerEndpoint(config: AiRequestConfig): string {
  if (config.engine === "custom") {
    return planCustomAiEndpoint(config.endpoint).requestEndpoint;
  }

  const endpoint = AI_ENGINE_PRESETS[config.engine].endpoint;
  return config.engine === "deepseek"
    ? `${endpoint.replace(/\/+$/, "")}/chat/completions`
    : endpoint;
}

function withoutUnsupportedSchemaConstraints(value: unknown, engine: AiEngine): unknown {
  if (Array.isArray(value)) {
    return value.map((nested) => withoutUnsupportedSchemaConstraints(nested, engine));
  }
  if (!isObject(value)) return value;

  const result: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "minLength" || key === "maxLength") continue;
    if (
      (engine === "anthropic" || engine === "openrouter") &&
      (key === "maxItems" || key === "minimum" || key === "maximum")
    ) {
      continue;
    }
    if (
      (engine === "anthropic" || engine === "openrouter") &&
      key === "minItems" &&
      nested !== 0 &&
      nested !== 1
    ) {
      continue;
    }
    result[key] = withoutUnsupportedSchemaConstraints(nested, engine);
  }
  return result;
}

function schemaForEngine(engine: AiEngine, schema: Record<string, unknown>): Record<string, unknown> {
  if (engine !== "anthropic" && engine !== "gemini" && engine !== "openrouter") {
    return schema;
  }
  return withoutUnsupportedSchemaConstraints(schema, engine) as Record<string, unknown>;
}

function structuredJsonInstructions(
  instructions: string,
  schema: Record<string, unknown>,
): string {
  return [
    instructions,
    "반드시 설명이나 마크다운 없이 JSON 객체 하나만 반환하세요.",
    `다음 JSON 스키마와 동일한 키와 구조를 사용하세요:\n${JSON.stringify(schema)}`,
  ].join("\n\n");
}

export function buildAiProviderRequest(
  config: AiRequestConfig,
  input: StructuredAiInput,
  options: {
    nativeStructuredOutput?: boolean;
    disableDeepseekThinking?: boolean;
  } = {},
): AiProviderRequest {
  const endpoint = providerEndpoint(config);
  const schema = schemaForEngine(config.engine, input.schema);
  const nativeStructuredOutput = options.nativeStructuredOutput !== false;

  if (config.engine === "anthropic") {
    return {
      endpoint,
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: {
        model: config.model,
        max_tokens: input.maxOutputTokens,
        system: input.instructions,
        messages: [{ role: "user", content: input.input }],
        output_config: {
          ...(config.reasoningEffort === "default"
            ? {}
            : { effort: config.reasoningEffort }),
          format: {
            type: "json_schema",
            schema,
          },
        },
      },
    };
  }

  if (config.engine === "gemini") {
    return {
      endpoint,
      headers: {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: {
        model: config.model,
        input: input.input,
        system_instruction: input.instructions,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema,
        },
        generation_config: {
          max_output_tokens: input.maxOutputTokens,
          thinking_summaries: "none",
          ...(config.reasoningEffort === "default"
            ? {}
            : { thinking_level: config.reasoningEffort }),
        },
        store: false,
      },
    };
  }

  if (config.engine === "deepseek") {
    const jsonInstructions = structuredJsonInstructions(input.instructions, schema);
    const thinkingEnabled =
      config.model.trim().toLowerCase().includes("pro") &&
      !options.disableDeepseekThinking;
    return {
      endpoint,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: {
        model: config.model,
        messages: [
          { role: "system", content: jsonInstructions },
          { role: "user", content: input.input },
        ],
        max_tokens: input.maxOutputTokens,
        stream: false,
        ...(nativeStructuredOutput ? { response_format: { type: "json_object" } } : {}),
        // Keep the product tiers distinct: Flash prioritizes complete output,
        // while Pro reasons first. A Pro repair can explicitly disable thinking
        // when reasoning consumed the output budget before JSON was completed.
        thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
        ...(!thinkingEnabled || config.reasoningEffort === "default"
          ? {}
          : { reasoning_effort: config.reasoningEffort }),
      },
    };
  }

  if (config.engine === "openrouter") {
    return {
      endpoint,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: {
        model: config.model,
        messages: [
          { role: "system", content: input.instructions },
          { role: "user", content: input.input },
        ],
        max_tokens: input.maxOutputTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.name,
            strict: true,
            schema,
          },
        },
        provider: { require_parameters: true },
        ...(config.reasoningEffort === "default"
          ? {}
          : { reasoning: { effort: config.reasoningEffort } }),
      },
    };
  }

  if (
    config.engine === "custom" &&
    planCustomAiEndpoint(config.endpoint).style === "chat-completions"
  ) {
    const jsonInstructions = structuredJsonInstructions(input.instructions, schema);
    return {
      endpoint,
      headers: {
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: {
        model: config.model,
        messages: [
          { role: "system", content: jsonInstructions },
          { role: "user", content: input.input },
        ],
        max_tokens: input.maxOutputTokens,
        stream: false,
        ...(nativeStructuredOutput
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: input.name,
                  strict: true,
                  schema,
                },
              },
            }
          : {}),
      },
    };
  }

  const customPromptOnly = config.engine === "custom" && !nativeStructuredOutput;
  return {
    endpoint,
    headers: {
      ...(
        config.engine === "custom" && !config.apiKey
          ? {}
          : { Authorization: `Bearer ${config.apiKey}` }
      ),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: {
      model: config.model,
      instructions: customPromptOnly
        ? structuredJsonInstructions(input.instructions, schema)
        : input.instructions,
      input: input.input,
      store: false,
      ...(config.reasoningEffort === "default"
        ? {}
        : { reasoning: { effort: config.reasoningEffort } }),
      max_output_tokens: input.maxOutputTokens,
      ...(nativeStructuredOutput
        ? {
            text: {
              format: {
                type: "json_schema",
                name: input.name,
                strict: true,
                schema,
              },
            },
          }
        : {}),
    },
  };
}

function openAiResponseText(payload: JsonObject): string | null {
  if (typeof payload.status === "string" && payload.status !== "completed") return null;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  if (!Array.isArray(payload.output)) return null;
  const parts: string[] = [];
  for (const item of payload.output) {
    if (!isObject(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isObject(content) &&
        (content.type === "output_text" || content.type === "text" || content.type === undefined) &&
        typeof content.text === "string" &&
        content.text.trim()
      ) {
        parts.push(content.text);
      }
    }
  }
  const text = parts.join("");
  return text.trim() ? text : null;
}

function anthropicResponseText(payload: JsonObject): string | null {
  if (payload.stop_reason !== "end_turn" || !Array.isArray(payload.content)) return null;
  const text = payload.content
    .filter((item) => isObject(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => (item as JsonObject).text as string)
    .join("");
  return text.trim() ? text : null;
}

function geminiResponseText(payload: JsonObject): string | null {
  if (payload.status !== "completed" || !Array.isArray(payload.steps)) return null;
  for (let index = payload.steps.length - 1; index >= 0; index -= 1) {
    const step = payload.steps[index];
    if (!isObject(step) || step.type !== "model_output" || !Array.isArray(step.content)) {
      continue;
    }
    const text = step.content
      .filter((item) => isObject(item) && item.type === "text" && typeof item.text === "string")
      .map((item) => (item as JsonObject).text as string)
      .join("");
    if (text.trim()) return text;
  }
  return null;
}

function chatCompletionResponseText(payload: JsonObject): string | null {
  if (!Array.isArray(payload.choices) || !isObject(payload.choices[0])) return null;
  const choice = payload.choices[0];
  if (
    typeof choice.finish_reason === "string" &&
    choice.finish_reason !== "stop" &&
    choice.finish_reason !== "length" &&
    choice.finish_reason !== "max_tokens"
  ) {
    return null;
  }
  if (!isObject(choice.message) || choice.message.refusal) return null;
  const message = choice.message;
  if (isObject(message.parsed) || Array.isArray(message.parsed)) {
    return JSON.stringify(message.parsed);
  }
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (isObject(content)) {
    if (typeof content.text === "string" && content.text.trim()) return content.text;
    if (typeof content.output_text === "string" && content.output_text.trim()) {
      return content.output_text;
    }
    if (isObject(content.json) || Array.isArray(content.json)) {
      return JSON.stringify(content.json);
    }
    if (isObject(content.value) || Array.isArray(content.value)) {
      return JSON.stringify(content.value);
    }
    if (typeof content.value === "string" && content.value.trim()) return content.value;
    return JSON.stringify(content);
  }
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (item) =>
          isObject(item) &&
          (item.type === "text" || item.type === "output_text" || item.type === undefined) &&
          typeof item.text === "string",
      )
      .map((item) => (item as JsonObject).text as string)
      .join("");
    if (text.trim()) return text;
  }
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (
        isObject(toolCall) &&
        isObject(toolCall.function) &&
        typeof toolCall.function.arguments === "string" &&
        toolCall.function.arguments.trim()
      ) {
        return toolCall.function.arguments;
      }
    }
  }
  if (
    isObject(message.function_call) &&
    typeof message.function_call.arguments === "string" &&
    message.function_call.arguments.trim()
  ) {
    return message.function_call.arguments;
  }
  return null;
}

export function parseAiProviderResponse(
  engine: AiEngine,
  value: unknown,
  endpoint?: string,
): string | null {
  if (!isObject(value)) return null;
  if (engine === "anthropic") return anthropicResponseText(value);
  if (engine === "gemini") return geminiResponseText(value);
  if (engine === "deepseek") return chatCompletionResponseText(value);
  if (engine === "openrouter") return chatCompletionResponseText(value);
  if (
    engine === "custom" &&
    endpoint &&
    planCustomAiEndpoint(endpoint).style === "chat-completions"
  ) {
    const text = chatCompletionResponseText(value) ?? openAiResponseText(value);
    if (text) return text;
    if (
      "choices" in value ||
      "output" in value ||
      "output_text" in value ||
      "status" in value ||
      "error" in value ||
      "usage" in value
    ) {
      return null;
    }
    return JSON.stringify(value);
  }
  if (engine === "custom") {
    const text = openAiResponseText(value) ?? chatCompletionResponseText(value);
    if (text) return text;
    if (
      "choices" in value ||
      "output" in value ||
      "output_text" in value ||
      "status" in value ||
      "error" in value ||
      "usage" in value
    ) {
      return null;
    }
    return JSON.stringify(value);
  }
  return openAiResponseText(value);
}
