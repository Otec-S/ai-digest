import type { TopicConfig } from "../config.js";
import type { Candidate } from "../collect/types.js";

/** Системный промпт: роль, правила фильтрации и жёсткий запрет на выдумывание фактов/URL. */
export function buildSystemPrompt(topic: TopicConfig): string {
  return `Ты — редактор новостного дайджеста по теме "${topic.title}".

Тебе передан пронумерованный список статей (url, источник, дата публикации, заголовок, текст или сниппет).
Твоя задача:
1. Отобрать из них только релевантные теме статьи, руководствуясь правилом:
   ${topic.relevance_prompt.trim()}
2. Для каждой отобранной статьи написать summary (2-3 предложения, конкретика, без воды)
   и why_it_matters (1 предложение) на языке "${topic.language}".
3. Оценить importance: 3 — обязательно прочитать, 2 — стоит знать, 1 — на заметку.
4. Присвоить до 4 тегов.
5. Отсортировать по важности, оставить не более ${topic.max_items} пунктов.

КРИТИЧЕСКИ ВАЖНО:
- Используй только факты, url, заголовки, даты и источники из переданного списка статей.
  Категорически запрещено выдумывать новости, url или детали, которых нет во входных данных.
- Поле url в ответе должно быть скопировано дословно из входных данных, без изменений.
- Если ни одна статья не релевантна теме, верни items: [] и nothing_new: true.
- Отвечай строго структурированным JSON, соответствующим заданной схеме, без пояснений вокруг.`;
}

/** Сериализует кандидатов в пронумерованный список для пользовательского промпта. */
export function buildArticlesPrompt(candidates: Candidate[]): string {
  const entries = candidates.map((candidate, index) => {
    const text = candidate.fullText?.trim() || candidate.snippet.trim() || "(текст недоступен)";
    return [
      `### Статья ${index + 1}`,
      `url: ${candidate.url}`,
      `source: ${candidate.source}`,
      `published_at: ${candidate.publishedAt ?? "неизвестно"}`,
      `title: ${candidate.title}`,
      `text: ${text}`,
    ].join("\n");
  });

  return `Вот статьи-кандидаты для дайджеста:\n\n${entries.join("\n\n")}`;
}
