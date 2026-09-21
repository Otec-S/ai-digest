import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DigestResult } from "../agent/schema.js";
import type { TopicConfig } from "../config.js";

const IMPORTANCE_MARKER: Record<1 | 2 | 3, string> = { 3: "🔥", 2: "▸", 1: "·" };

/** Формирует текст отчёта в markdown по теме и результату агента. */
export function renderMarkdownReport(topic: TopicConfig, digest: DigestResult, date: Date): string {
  const dateStr = date.toISOString().slice(0, 10);
  const header = `# ${topic.title} · ${dateStr}\n`;

  if (digest.nothing_new || digest.items.length === 0) {
    return `${header}\nНичего нового по теме не найдено.\n`;
  }

  const items = digest.items.map((item) => {
    const marker = IMPORTANCE_MARKER[item.importance];
    return [
      `## ${marker} ${item.title}`,
      "",
      item.summary,
      "",
      `_Почему важно:_ ${item.why_it_matters}`,
      "",
      `Источник: [${item.source}](${item.url}) · ${item.published_at}`,
      item.tags.length > 0 ? `Теги: ${item.tags.join(", ")}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n");
  });

  return `${header}\n${items.join("\n\n")}\n`;
}

/** Возвращает путь reports/YYYY-MM-DD-<topic>.md для указанной даты. */
export function reportPath(topicId: string, date: Date): string {
  const dateStr = date.toISOString().slice(0, 10);
  return `reports/${dateStr}-${topicId}.md`;
}

/** Пишет отчёт в файл, создавая директорию при необходимости. */
export function writeMarkdownReport(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}
