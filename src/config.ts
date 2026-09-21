import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const slugPattern = /^[a-z0-9-]+$/;

const topicDefaultsSchema = z.object({
  lookback_hours: z.number().int().positive(),
  max_items: z.number().int().positive(),
  max_articles_to_fetch: z.number().int().positive(),
  language: z.string().min(2),
  model: z.string().min(1),
});

const topicOverridesSchema = topicDefaultsSchema.partial().extend({
  id: z.string().regex(slugPattern, "id должен быть slug: только [a-z0-9-]"),
  title: z.string().min(1),
  feeds: z.array(z.string().url()).default([]),
  search_queries: z.array(z.string()).default([]),
  exclude_keywords: z.array(z.string()).default([]),
  relevance_prompt: z.string().min(1),
});

const rawConfigSchema = z.object({
  defaults: topicDefaultsSchema,
  topics: z.array(topicOverridesSchema).min(1),
});

export type TopicConfig = z.infer<typeof topicDefaultsSchema> & {
  id: string;
  title: string;
  feeds: string[];
  search_queries: string[];
  exclude_keywords: string[];
  relevance_prompt: string;
};

export interface AppConfig {
  topics: TopicConfig[];
}

/** Загружает и валидирует config/topics.yaml, применяя defaults к каждой теме. */
export function loadConfig(path: string): AppConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = rawConfigSchema.parse(parseYaml(raw));

  const ids = new Set<string>();
  const topics: TopicConfig[] = parsed.topics.map((topic) => {
    if (ids.has(topic.id)) {
      throw new Error(`Дублирующийся id темы в конфиге: ${topic.id}`);
    }
    ids.add(topic.id);

    return {
      id: topic.id,
      title: topic.title,
      feeds: topic.feeds,
      search_queries: topic.search_queries,
      exclude_keywords: topic.exclude_keywords,
      relevance_prompt: topic.relevance_prompt,
      lookback_hours: topic.lookback_hours ?? parsed.defaults.lookback_hours,
      max_items: topic.max_items ?? parsed.defaults.max_items,
      max_articles_to_fetch: topic.max_articles_to_fetch ?? parsed.defaults.max_articles_to_fetch,
      language: topic.language ?? parsed.defaults.language,
      model: topic.model ?? parsed.defaults.model,
    };
  });

  return { topics };
}

export function findTopic(config: AppConfig, id: string): TopicConfig {
  const topic = config.topics.find((t) => t.id === id);
  if (!topic) {
    const known = config.topics.map((t) => t.id).join(", ");
    throw new Error(`Тема "${id}" не найдена в конфиге. Доступные темы: ${known}`);
  }
  return topic;
}

/** Парсит строку окна вроде "24h", "7d" в миллисекунды. */
export function parseSince(value: string): number {
  const match = /^(\d+)([hd])$/.exec(value);
  if (!match) {
    throw new Error(`Неверный формат --since: "${value}". Ожидается вроде "24h" или "7d".`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const hourMs = 60 * 60 * 1000;
  return unit === "d" ? amount * 24 * hourMs : amount * hourMs;
}
