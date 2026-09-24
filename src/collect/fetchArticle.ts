import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { logger } from "../logger.js";

const FETCH_TIMEOUT_MS = 15_000;
// Для summary в 2–3 предложения хватает начала статьи; каждый лишний символ — входные токены агента.
const MAX_CONTENT_CHARS = 4_000;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const turndown = new TurndownService();

// jsdom по умолчанию тратит очень много CPU на парсинг <script>/<style> реальных страниц
// (мегабайты минифицированного CSS/JS) и шлёт ошибки парсинга CSS в консоль — Readability
// этот контент не использует, поэтому вырезаем его до создания DOM.
const silentConsole = new VirtualConsole();

function stripScriptsAndStyles(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
}

/** Убирает из markdown то, что для суммаризации бесполезно, но стоит токенов: картинки, url ссылок, лишние пробелы. */
export function compactMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Скачивает статью и вытягивает основной текст через Readability. При неудаче возвращает null. */
export async function fetchArticleText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = stripScriptsAndStyles(await response.text());

    const dom = new JSDOM(html, { url, virtualConsole: silentConsole });
    const article = new Readability(dom.window.document).parse();
    if (!article?.content) {
      return null;
    }

    const markdown = compactMarkdown(turndown.turndown(article.content));
    return markdown.slice(0, MAX_CONTENT_CHARS);
  } catch (error) {
    logger.warn({ url, error: String(error) }, "Не удалось извлечь текст статьи, оставляю snippet");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
