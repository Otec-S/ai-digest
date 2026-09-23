import { logger } from "../logger.js";
import type { Candidate } from "./types.js";

const SEARCH_TIMEOUT_MS = 10_000;
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const MAX_RESULTS_PER_QUERY = 10;

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

interface TavilySearchResponse {
  results: TavilySearchResult[];
}

export interface SearchProvider {
  search(query: string): Promise<Candidate[]>;
}

/** Провайдер поиска через Tavily API (https://tavily.com) — используется для добора кандидатов по search_queries. */
export class TavilyProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<Candidate[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const response = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: MAX_RESULTS_PER_QUERY,
          search_depth: "basic",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Tavily ответил ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as TavilySearchResponse;

      return (data.results ?? []).map((result) => ({
        url: result.url,
        title: result.title,
        source: new URL(result.url).hostname,
        publishedAt: result.published_date ?? null,
        snippet: result.content ?? "",
      }));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Параллельно опрашивает провайдер по всем запросам темы. Упавший запрос логируется и не прерывает сбор. */
export async function collectFromSearch(
  provider: SearchProvider,
  queries: string[],
): Promise<Candidate[]> {
  const results = await Promise.allSettled(queries.map((query) => provider.search(query)));

  const candidates: Candidate[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    } else {
      logger.warn(
        { query: queries[index], error: String(result.reason) },
        "Не удалось выполнить поисковый запрос",
      );
    }
  });

  return candidates;
}
