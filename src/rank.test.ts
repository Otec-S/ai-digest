import { describe, expect, it } from "vitest";
import { rankCandidates, rankingKeywords } from "./rank.js";
import type { TopicConfig } from "./config.js";
import type { Candidate } from "./collect/types.js";

const baseTopic: TopicConfig = {
  id: "t",
  title: "t",
  feeds: [],
  search_queries: ["LLM agent framework launch"],
  keywords: [],
  exclude_keywords: [],
  relevance_prompt: "test",
  lookback_hours: 24,
  max_items: 8,
  max_articles_to_fetch: 15,
  language: "ru",
  model: "claude-sonnet-5-5",
  filter_model: "claude-haiku-4-5",
  max_candidates_to_filter: 2,
};

const now = Date.parse("2026-09-24T00:00:00Z");

function candidate(title: string, url = "https://example.com/a"): Candidate {
  return { url, title, source: "x", publishedAt: new Date(now).toISOString(), snippet: "" };
}

describe("rankingKeywords", () => {
  it("разбивает search_queries на отдельные слова и отбрасывает короткие", () => {
    expect(rankingKeywords({ ...baseTopic, search_queries: ["AI model release"] })).toEqual(["model", "release"]);
  });

  it("предпочитает явный keywords", () => {
    expect(rankingKeywords({ ...baseTopic, keywords: ["MCP", "Claude"] })).toEqual(["mcp", "claude"]);
  });
});

describe("rankCandidates", () => {
  it("поднимает статьи с совпадением отдельных слов запроса и режет до max_candidates_to_filter", () => {
    const ranked = rankCandidates(
      [candidate("Weather today"), candidate("New agent framework released"), candidate("Stocks fall")],
      baseTopic,
      now,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.title).toBe("New agent framework released");
  });

  it("опускает arXiv ниже обычного источника даже при совпадении ключевых слов", () => {
    const ranked = rankCandidates(
      [candidate("LLM agent framework paper", "https://arxiv.org/abs/1"), candidate("Agent news", "https://example.com/n")],
      baseTopic,
      now,
    );
    expect(ranked[0]?.url).toBe("https://example.com/n");
  });
});
