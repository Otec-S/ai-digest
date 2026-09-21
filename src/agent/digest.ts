import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TopicConfig } from "../config.js";
import type { Candidate } from "../collect/types.js";
import { logger } from "../logger.js";
import { buildArticlesPrompt, buildSystemPrompt } from "./prompt.js";
import { DigestResult, digestResultJsonSchema, type DigestResult as DigestResultType } from "./schema.js";

export interface DigestUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface DigestOutcome {
  result: DigestResultType;
  usage: DigestUsage;
}

const emptyUsage = (): DigestUsage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

function addUsage(a: DigestUsage, b: DigestUsage): DigestUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

interface AttemptResult {
  structuredOutput: unknown;
  usage: DigestUsage;
}

/** Один вызов агента: прогоняет query() до конца и вытаскивает structured_output и метрики токенов/стоимости. */
async function runAgentOnce(systemPrompt: string, userPrompt: string, model: string): Promise<AttemptResult> {
  const stream = query({
    prompt: userPrompt,
    options: {
      model,
      systemPrompt,
      tools: [],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      outputFormat: { type: "json_schema", schema: digestResultJsonSchema },
    },
  });

  for await (const message of stream) {
    if (message.type === "result") {
      if (message.subtype !== "success") {
        throw new Error(`Агент завершился с ошибкой (${message.subtype}): ${message.errors.join("; ")}`);
      }
      return {
        structuredOutput: message.structured_output,
        usage: {
          inputTokens: message.usage.input_tokens ?? 0,
          outputTokens: message.usage.output_tokens ?? 0,
          costUsd: message.total_cost_usd,
        },
      };
    }
  }

  throw new Error("Агент завершился без result-сообщения");
}

const MAX_ATTEMPTS = 2;

/** Вызывает Claude Agent SDK для составления дайджеста, с одной повторной попыткой при невалидном JSON. */
export async function generateDigest(topic: TopicConfig, candidates: Candidate[]): Promise<DigestOutcome> {
  const systemPrompt = buildSystemPrompt(topic);
  let userPrompt = buildArticlesPrompt(candidates);
  let usage = emptyUsage();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { structuredOutput, usage: attemptUsage } = await runAgentOnce(systemPrompt, userPrompt, topic.model);
    usage = addUsage(usage, attemptUsage);

    const parsed = DigestResult.safeParse(structuredOutput);
    if (parsed.success) {
      return { result: parsed.data, usage };
    }

    logger.warn(
      { attempt, error: parsed.error.message },
      "Ответ агента не прошёл zod-валидацию",
    );

    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`Ответ агента не прошёл валидацию после ${MAX_ATTEMPTS} попыток: ${parsed.error.message}`);
    }

    userPrompt = `${userPrompt}\n\n---\nТвой предыдущий ответ не прошёл валидацию по схеме. Ошибка: ${parsed.error.message}\nИсправь ответ, строго соблюдая структуру схемы.`;
  }

  throw new Error("Недостижимая ветка: цикл попыток завершился без результата");
}
