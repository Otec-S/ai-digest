import type { Candidate } from "./collect/types.js";
import type { TopicConfig } from "./config.js";

const DOMAIN_WEIGHTS: Record<string, number> = {
  "anthropic.com": 1.5,
  "openai.com": 1.5,
  "blog.google": 1.3,
  "huggingface.co": 1.3,
  "arxiv.org": 1.2,
  "news.ycombinator.com": 0.8,
};

const DEFAULT_DOMAIN_WEIGHT = 1;
const MAX_FRESHNESS_SCORE = 3;
const FRESHNESS_HALF_LIFE_HOURS = 12;
const KEYWORD_MATCH_SCORE = 1;

function freshnessScore(publishedAt: string | null, now: number): number {
  if (!publishedAt) return MAX_FRESHNESS_SCORE / 2;
  const publishedMs = Date.parse(publishedAt);
  if (Number.isNaN(publishedMs)) return MAX_FRESHNESS_SCORE / 2;

  const ageHours = Math.max(0, (now - publishedMs) / (60 * 60 * 1000));
  // Экспоненциальный спад: свежие статьи получают ~максимум, старые стремятся к нулю.
  return MAX_FRESHNESS_SCORE * Math.pow(0.5, ageHours / FRESHNESS_HALF_LIFE_HOURS);
}

function domainWeight(url: string): number {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return DOMAIN_WEIGHTS[hostname] ?? DEFAULT_DOMAIN_WEIGHT;
  } catch {
    return DEFAULT_DOMAIN_WEIGHT;
  }
}

function keywordMatchScore(candidate: Candidate, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = `${candidate.title} ${candidate.snippet}`.toLowerCase();
  const matches = keywords.filter((kw) => haystack.includes(kw.toLowerCase())).length;
  return matches * KEYWORD_MATCH_SCORE;
}

export function scoreCandidate(candidate: Candidate, topic: TopicConfig, now: number): number {
  return (
    freshnessScore(candidate.publishedAt, now) * domainWeight(candidate.url) +
    keywordMatchScore(candidate, topic.search_queries)
  );
}

/** Эвристически ранжирует кандидатов и возвращает топ `topic.max_articles_to_fetch`. */
export function rankCandidates(candidates: Candidate[], topic: TopicConfig, now = Date.now()): Candidate[] {
  return [...candidates]
    .sort((a, b) => scoreCandidate(b, topic, now) - scoreCandidate(a, topic, now))
    .slice(0, topic.max_articles_to_fetch);
}
