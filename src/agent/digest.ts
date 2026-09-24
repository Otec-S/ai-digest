import type { TopicConfig } from "../config.js";
import type { Candidate } from "../collect/types.js";
import { logger } from "../logger.js";
import { callStructured, hasKnownPrice, type Usage } from "./client.js";
import { buildArticlesPrompt, buildFilterPrompt, buildFilterSystemPrompt, buildSystemPrompt } from "./prompt.js";
import {
  AgentDigestResult,
  agentDigestResultJsonSchema,
  FilterResult,
  filterResultJsonSchema,
  type DigestItem,
  type DigestResult,
} from "./schema.js";

export type { Usage as DigestUsage } from "./client.js";

export interface DigestOutcome {
  result: DigestResult;
  usage: Usage;
}

const FILTER_MAX_TOKENS = 1_000;
const DIGEST_MAX_TOKENS = 8_000;
const MAX_TAGS = 4;

function warnUnknownPrice(model: string): void {
  if (!hasKnownPrice(model)) {
    logger.warn({ model }, "Нет цены для модели — стоимость в отчёте будет 0");
  }
}

/** Возвращает элемент по 1-based номеру из ответа модели или null, если номер вне диапазона. */
function pickByIndex<T>(items: T[], index: number): T | null {
  return index >= 1 && index <= items.length ? (items[index - 1] ?? null) : null;
}

/**
 * Предварительный отбор дешёвой моделью по заголовкам и сниппетам: полные тексты скачиваются
 * и отправляются основной модели только для отобранных статей.
 */
export async function filterCandidates(
  topic: TopicConfig,
  candidates: Candidate[],
): Promise<{ selected: Candidate[]; usage: Usage }> {
  const maxRelevant = topic.max_articles_to_fetch;
  warnUnknownPrice(topic.filter_model);

  const { data, usage } = await callStructured({
    model: topic.filter_model,
    system: buildFilterSystemPrompt(topic, maxRelevant),
    user: buildFilterPrompt(candidates),
    jsonSchema: filterResultJsonSchema,
    zodSchema: FilterResult,
    maxTokens: FILTER_MAX_TOKENS,
  });

  const selected = [...new Set(data.relevant)]
    .map((index) => pickByIndex(candidates, index))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .slice(0, maxRelevant);

  return { selected, usage };
}

/** Составляет дайджест основной моделью; url/source/published_at берутся из кандидатов по номеру статьи. */
export async function generateDigest(topic: TopicConfig, candidates: Candidate[]): Promise<DigestOutcome> {
  warnUnknownPrice(topic.model);

  const { data, usage } = await callStructured({
    model: topic.model,
    system: buildSystemPrompt(topic),
    user: buildArticlesPrompt(candidates),
    jsonSchema: agentDigestResultJsonSchema,
    zodSchema: AgentDigestResult,
    maxTokens: DIGEST_MAX_TOKENS,
    // Суммаризация — несложная задача: низкий effort заметно сокращает токены размышлений.
    effort: "low",
  });

  const items: DigestItem[] = [];
  for (const item of data.items) {
    const candidate = pickByIndex(candidates, item.article_index);
    if (!candidate) {
      logger.warn({ articleIndex: item.article_index }, "Агент вернул несуществующий номер статьи — пункт пропущен");
      continue;
    }
    items.push({
      title: item.title,
      summary: item.summary,
      why_it_matters: item.why_it_matters,
      url: candidate.url,
      source: candidate.source,
      published_at: candidate.publishedAt ?? "неизвестно",
      importance: item.importance,
      tags: item.tags.slice(0, MAX_TAGS),
    });
  }

  return {
    // Модель не всегда соблюдает порядок из промпта — сортируем по важности сами (sort стабилен).
    result: { items: items.sort((a, b) => b.importance - a.importance).slice(0, topic.max_items), nothing_new: items.length === 0 || data.nothing_new },
    usage,
  };
}
