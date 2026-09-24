import { describe, expect, it } from "vitest";
import { compactMarkdown } from "./fetchArticle.js";

describe("compactMarkdown", () => {
  it("удаляет картинки, оставляет текст ссылок без url и схлопывает пробелы", () => {
    const input = "Intro  ![logo](https://x/y.png)\n\n\n\nSee [the docs](https://example.com/docs)   now";
    expect(compactMarkdown(input)).toBe("Intro\n\nSee the docs now");
  });
});
