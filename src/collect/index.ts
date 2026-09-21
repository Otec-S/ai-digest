import type { TopicConfig } from "../config.js";
import { collectFromFeeds } from "./rss.js";
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

/** Собирает кандидатов из RSS для темы, фильтрует по свежести и exclude_keywords. */
export async function collectCandidates(topic: TopicConfig, sinceMs: number): Promise<Candidate[]> {
  const fromFeeds = await collectFromFeeds(topic.feeds);

  return fromFeeds.filter(
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
