import Parser from "rss-parser";
import { logger } from "../logger.js";
import type { Candidate } from "./types.js";

const FEED_TIMEOUT_MS = 10_000;
const parser = new Parser({ timeout: FEED_TIMEOUT_MS });

/** Скачивает один RSS-фид и превращает его записи в кандидатов. Ошибка фида не бросается наружу. */
async function fetchFeed(feedUrl: string): Promise<Candidate[]> {
  const feed = await parser.parseURL(feedUrl);
  const source = feed.title ?? new URL(feedUrl).hostname;

  return (feed.items ?? [])
    .filter((item): item is typeof item & { link: string } => Boolean(item.link))
    .map((item) => ({
      url: item.link,
      title: item.title ?? "(без заголовка)",
      source,
      publishedAt: item.isoDate ?? item.pubDate ?? null,
      snippet: item.contentSnippet ?? item.content ?? "",
    }));
}

/** Параллельно опрашивает все фиды. Упавший фид логируется как предупреждение и не прерывает сбор. */
export async function collectFromFeeds(feedUrls: string[]): Promise<Candidate[]> {
  const results = await Promise.allSettled(feedUrls.map(fetchFeed));

  const candidates: Candidate[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    } else {
      logger.warn(
        { feedUrl: feedUrls[index], error: String(result.reason) },
        "Не удалось загрузить RSS-фид",
      );
    }
  });

  return candidates;
}
