import type { TopicConfig } from "../config.js";
import { logger } from "../logger.js";
import { collectFromFeeds } from "./rss.js";
import { collectFromSearch, TavilyProvider } from "./search.js";
import { fetchArticleText } from "./fetchArticle.js";
import type { Candidate } from "./types.js";

function isRecent(candidate: Candidate, sinceMs: number): boolean {
  if (!candidate.publishedAt) return true; // нет даты — не отбрасываем на этом этапе
  const published = Date.parse(candidate.publishedAt);
  if (Number.isNaN(published)) return true;
  return published >= sinceMs;
}

function matchesExcludeKeywords(candidate: Candidate, excludeKeywords: string[]): boolean {
  if (excludeKeywords.length === 0) return false;
  const haystack = `${candidate.title} ${candidate.snippet}`.toLowerCase();
  return excludeKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

/** Собирает кандидатов из RSS и (если задан ключ и есть search_queries) поиска, фильтрует по свежести и exclude_keywords. */
export async function collectCandidates(
  topic: TopicConfig,
  sinceMs: number,
  tavilyApiKey?: string,
): Promise<Candidate[]> {
  const fromFeeds = await collectFromFeeds(topic.feeds);

  let fromSearch: Candidate[] = [];
  if (topic.search_queries.length > 0) {
    if (tavilyApiKey) {
      fromSearch = await collectFromSearch(new TavilyProvider(tavilyApiKey), topic.search_queries);
    } else {
      logger.warn(
        { topic: topic.id },
        "В теме заданы search_queries, но TAVILY_API_KEY не задан — шаг поиска пропущен",
      );
    }
  }

  return [...fromFeeds, ...fromSearch].filter(
    (candidate) => isRecent(candidate, sinceMs) && !matchesExcludeKeywords(candidate, topic.exclude_keywords),
  );
}

/** Параллельно вытягивает полный текст для отобранных кандидатов, неудачи оставляют snippet. */
export async function enrichWithFullText(candidates: Candidate[]): Promise<Candidate[]> {
  return Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      fullText: await fetchArticleText(candidate.url),
    })),
  );
}
