import type { TopicConfig } from "../config.js";
import type { Candidate } from "../collect/types.js";

const MAX_FILTER_SNIPPET_CHARS = 300;

/** Системный промпт предварительного отбора: только решение «релевантно / нет» по заголовку и сниппету. */
export function buildFilterSystemPrompt(topic: TopicConfig, maxRelevant: number): string {
  return `Ты отбираешь статьи для новостного дайджеста по теме "${topic.title}".
Правило релевантности:
${topic.relevance_prompt.trim()}

По заголовку и сниппету выбери номера релевантных статей, самые важные первыми, не более ${maxRelevant}.
Если релевантных нет, верни пустой список.`;
}

/** Компактный список кандидатов для отбора: номер, источник, заголовок, укороченный сниппет. */
export function buildFilterPrompt(candidates: Candidate[]): string {
  return candidates
    .map((candidate, index) => {
      const snippet = candidate.snippet.trim().replace(/\s+/g, " ").slice(0, MAX_FILTER_SNIPPET_CHARS);
      return `[${index + 1}] ${candidate.source} | ${candidate.title}${snippet ? `\n${snippet}` : ""}`;
    })
    .join("\n\n");
}

/** Системный промпт суммаризации: роль, правила и формат ответа. */
export function buildSystemPrompt(topic: TopicConfig): string {
  return `Ты — редактор новостного дайджеста по теме "${topic.title}".

Тебе передан пронумерованный список статей (источник, заголовок, текст или сниппет).
Твоя задача:
1. Отобрать из них только релевантные теме статьи, руководствуясь правилом:
   ${topic.relevance_prompt.trim()}
2. Для каждой отобранной статьи указать её номер в article_index, написать title, summary
   (2-3 предложения, конкретика, без воды) и why_it_matters (1 предложение) на языке "${topic.language}".
3. Оценить importance: 3 — обязательно прочитать, 2 — стоит знать, 1 — на заметку.
4. Присвоить до 4 тегов.
5. Отсортировать по важности, оставить не более ${topic.max_items} пунктов.

Используй только факты из переданных статей, ничего не додумывай.
Если ни одна статья не релевантна теме, верни items: [] и nothing_new: true.`;
}

/** Сериализует кандидатов в пронумерованный список для пользовательского промпта. */
export function buildArticlesPrompt(candidates: Candidate[]): string {
  const entries = candidates.map((candidate, index) => {
    const text = candidate.fullText?.trim() || candidate.snippet.trim() || "(текст недоступен)";
    return [
      `### Статья ${index + 1}`,
      `source: ${candidate.source}`,
      `published_at: ${candidate.publishedAt ?? "неизвестно"}`,
      `title: ${candidate.title}`,
      `text: ${text}`,
    ].join("\n");
  });

  return entries.join("\n\n");
}
