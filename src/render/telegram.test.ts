import { describe, expect, it } from "vitest";
import { escapeMarkdownV2, escapeMarkdownV2Url, formatDigestMessages } from "./telegram.js";
import type { DigestResult } from "../agent/schema.js";
import type { TopicConfig } from "../config.js";

const topic: TopicConfig = {
  id: "ai-industry",
  title: "Новинки AI-индустрии",
  feeds: [],
  search_queries: [],
  keywords: [],
  exclude_keywords: [],
  relevance_prompt: "test",
  lookback_hours: 24,
  max_items: 8,
  max_articles_to_fetch: 15,
  language: "ru",
  model: "claude-sonnet-5-5",
  filter_model: "claude-haiku-4-5",
  max_candidates_to_filter: 40,
};

function makeItem(overrides: Partial<DigestResult["items"][number]> = {}): DigestResult["items"][number] {
  return {
    title: "Заголовок",
    summary: "Саммари.",
    why_it_matters: "Важно.",
    url: "https://example.com/article",
    source: "example.com",
    published_at: "2026-09-21T00:00:00Z",
    importance: 2,
    tags: [],
    ...overrides,
  };
}

describe("escapeMarkdownV2", () => {
  it("экранирует все спецсимволы MarkdownV2", () => {
    const input = "_*[]()~`>#+-=|{}.!\\";
    const expected = "\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\";
    expect(escapeMarkdownV2(input)).toBe(expected);
  });

  it("не трогает обычный текст", () => {
    expect(escapeMarkdownV2("Обычный текст 123")).toBe("Обычный текст 123");
  });

  it("экранирует смешанный текст с пунктуацией", () => {
    expect(escapeMarkdownV2("Claude 4.5: релиз!")).toBe("Claude 4\\.5: релиз\\!");
  });
});

describe("escapeMarkdownV2Url", () => {
  it("экранирует только ) и \\ внутри url", () => {
    expect(escapeMarkdownV2Url("https://example.com/a(b)c")).toBe("https://example.com/a(b\\)c");
  });

  it("не трогает url без спецсимволов", () => {
    expect(escapeMarkdownV2Url("https://example.com/path")).toBe("https://example.com/path");
  });
});

describe("formatDigestMessages", () => {
  it("формирует одно сообщение с заголовком и пунктами", () => {
    const digest: DigestResult = { items: [makeItem()], nothing_new: false };
    const [message] = formatDigestMessages(topic, digest, new Date("2026-09-21T00:00:00Z"));

    expect(message).toContain("21\\.09\\.2026"); // дата в шапке должна быть экранирована — точки reserved-символы в MarkdownV2
    expect(message).not.toContain("21.09.2026");
    expect(message).toContain("▸ *Заголовок*");
    expect(message).toContain("Саммари\\.");
    expect(message).toContain("_Почему важно:_ Важно\\.");
    expect(message).toContain("[example\\.com](https://example.com/article)");
  });

  it("возвращает короткую строку при nothing_new", () => {
    const digest: DigestResult = { items: [], nothing_new: true };
    const messages = formatDigestMessages(topic, digest, new Date("2026-09-21T00:00:00Z"));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Ничего нового");
  });

  it("использует правильные маркеры важности", () => {
    const digest: DigestResult = {
      items: [makeItem({ importance: 3, title: "Горячее" }), makeItem({ importance: 1, title: "На заметку" })],
      nothing_new: false,
    };
    const [message] = formatDigestMessages(topic, digest, new Date("2026-09-21T00:00:00Z"));

    expect(message).toContain("🔥 *Горячее*");
    expect(message).toContain("· *На заметку*");
  });

  it("режет длинный дайджест на несколько сообщений по границам пунктов", () => {
    const bigSummary = "Слово ".repeat(150); // один пункт заметно меньше лимита, но 5 штук уже не влезут в одно сообщение
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ title: `Статья ${i}`, summary: bigSummary, url: `https://example.com/${i}` }),
    );
    const digest: DigestResult = { items, nothing_new: false };
    const messages = formatDigestMessages(topic, digest, new Date("2026-09-21T00:00:00Z"));

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(4096);
    }
    // каждый пункт должен попасть в какое-то сообщение целиком, а не быть разрезанным
    for (let i = 0; i < items.length; i += 1) {
      const matchingMessages = messages.filter((m) => m.includes(`Статья ${i}`));
      expect(matchingMessages).toHaveLength(1);
    }
  });
});
