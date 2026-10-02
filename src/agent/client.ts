import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export interface Usage {
  /** Все входные токены: обычные + запись в кэш + чтение из кэша. */
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/** Цены $ за 1M токенов (вход / выход). Для неизвестной модели стоимость считается как 0 с предупреждением в логе. */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function hasKnownPrice(model: string): boolean {
  return model in PRICES_PER_MTOK;
}

function toUsage(model: string, usage: Anthropic.Usage): Usage {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const price = PRICES_PER_MTOK[model];
  const costUsd = price
    ? (usage.input_tokens * price.input +
        cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
        cacheRead * price.input * CACHE_READ_MULTIPLIER +
        usage.output_tokens * price.output) /
      1_000_000
    : 0;
  return { inputTokens: usage.input_tokens + cacheWrite + cacheRead, outputTokens: usage.output_tokens, costUsd };
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export interface StructuredCallParams<T> {
  model: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
}

/**
 * Один запрос к Messages API со structured output. Схема гарантируется API, zod-проверка —
 * страховка; повторов нет, чтобы сбой не удваивал расход токенов на весь вход.
 */
export async function callStructured<T>(params: StructuredCallParams<T>): Promise<{ data: T; usage: Usage }> {
  const response = await getClient().messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
    output_config: {
      format: { type: "json_schema", schema: params.jsonSchema },
      ...(params.effort ? { effort: params.effort } : {}),
    },
  });

  const usage = toUsage(params.model, response.usage);

  if (response.stop_reason === "refusal") {
    throw new Error(`Модель ${params.model} отказалась отвечать`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(`Ответ модели ${params.model} обрезан по max_tokens=${params.maxTokens}`);
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const parsed = params.zodSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Ответ модели ${params.model} не прошёл валидацию: ${parsed.error.message}`);
  }
  return { data: parsed.data, usage };
}
