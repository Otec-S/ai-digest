import { createHash } from "node:crypto";
import type { AppDatabase } from "./db.js";
import { getRecentTitleHashes, insertSeenUrl, isUrlSeen } from "./db.js";
import type { Candidate } from "./collect/types.js";

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref"]);
const TITLE_JACCARD_THRESHOLD = 0.8;
const FUZZY_DEDUPE_WINDOW_DAYS = 7;

/** Убирает трекинговые параметры, якорь и завершающий слеш, приводит хост к нижнему регистру. */
export function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || TRACKING_PARAM_PREFIXES.some((p) => key.toLowerCase().startsWith(p))) {
      params.delete(key);
    }
  }
  const sortedParams = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b)));
  url.search = sortedParams.toString();

  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  url.pathname = pathname;

  return url.toString();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Нормализует заголовок в множество токенов для нечёткого сравнения. */
export function titleTokens(title: string): string[] {
  const normalized = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
  if (!normalized) return [];
  return [...new Set(normalized.split(/\s+/))].sort();
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function encodeTokens(tokens: string[]): string {
  return tokens.join(" ");
}

function decodeTokens(encoded: string): string[] {
  return encoded.length === 0 ? [] : encoded.split(" ");
}

/**
 * Фильтрует кандидатов: отбрасывает уже виденные URL (по хэшу канонического URL)
 * и нечёткие дубликаты по заголовку (Jaccard >= 0.8) за последние 7 дней,
 * включая дубликаты внутри самого текущего набора кандидатов.
 */
export function dedupeCandidates(candidates: Candidate[], db: AppDatabase, topicId: string, now: Date): Candidate[] {
  const sinceIso = new Date(now.getTime() - FUZZY_DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const knownTitleTokenSets = getRecentTitleHashes(db, topicId, sinceIso).map(decodeTokens);

  const result: Candidate[] = [];
  const seenInBatchTokenSets: string[][] = [];

  for (const candidate of candidates) {
    const canonicalUrl = canonicalizeUrl(candidate.url);
    const urlHash = sha256(canonicalUrl);
    if (isUrlSeen(db, urlHash)) continue;

    const tokens = titleTokens(candidate.title);
    const isFuzzyDuplicate = [...knownTitleTokenSets, ...seenInBatchTokenSets].some(
      (existing) => jaccardSimilarity(tokens, existing) >= TITLE_JACCARD_THRESHOLD,
    );
    if (isFuzzyDuplicate) continue;

    seenInBatchTokenSets.push(tokens);
    result.push(candidate);
  }

  return result;
}

/** Помечает кандидатов как увиденных: пишет их канонический URL и токены заголовка в seen_urls. */
export function markCandidatesSeen(db: AppDatabase, candidates: Candidate[], topicId: string, now: Date): void {
  const nowIso = now.toISOString();
  for (const candidate of candidates) {
    const canonicalUrl = canonicalizeUrl(candidate.url);
    insertSeenUrl(db, {
      urlHash: sha256(canonicalUrl),
      topicId,
      url: canonicalUrl,
      titleHash: encodeTokens(titleTokens(candidate.title)),
      firstSeenAt: nowIso,
    });
  }
}
