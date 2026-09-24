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

const MIN_KEYWORD_LENGTH = 3;

/**
 * Ключевые слова для ранжирования: явный `keywords` из конфига, иначе отдельные слова из
 * `search_queries`. Целые фразы запросов («LLM agent framework launch») почти никогда не
 * встречаются в заголовках дословно, поэтому матчить их как подстроку бесполезно.
 */
export function rankingKeywords(topic: TopicConfig): string[] {
  const source = topic.keywords.length > 0 ? topic.keywords : topic.search_queries.flatMap((q) => q.split(/\s+/));
  const words = source.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= MIN_KEYWORD_LENGTH);
  return [...new Set(words)];
}

function keywordMatchScore(candidate: Candidate, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = `${candidate.title} ${candidate.snippet}`.toLowerCase();
  const matches = keywords.filter((kw) => haystack.includes(kw)).length;
  return matches * KEYWORD_MATCH_SCORE;
}

export function scoreCandidate(candidate: Candidate, keywords: string[], now: number): number {
  return freshnessScore(candidate.publishedAt, now) * domainWeight(candidate.url) + keywordMatchScore(candidate, keywords);
}

/** Эвристически ранжирует кандидатов и возвращает топ `topic.max_candidates_to_filter` для предварительного отбора. */
export function rankCandidates(candidates: Candidate[], topic: TopicConfig, now = Date.now()): Candidate[] {
  const keywords = rankingKeywords(topic);
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, keywords, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topic.max_candidates_to_filter)
    .map(({ candidate }) => candidate);
}
