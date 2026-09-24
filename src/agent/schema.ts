import { z } from "zod";

export const DigestItem = z.object({
  title: z.string(),
  summary: z.string(),
  why_it_matters: z.string(),
  url: z.string().url(),
  source: z.string(),
  published_at: z.string(),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tags: z.array(z.string()).max(4),
});

export const DigestResult = z.object({
  items: z.array(DigestItem),
  nothing_new: z.boolean(),
});

export type DigestItem = z.infer<typeof DigestItem>;
export type DigestResult = z.infer<typeof DigestResult>;

/**
 * Ответ модели на этапе суммаризации. url/source/published_at модель не пишет — они
 * подставляются в коде по `article_index` из входных кандидатов: это экономит выходные
 * токены и исключает искажённые/выдуманные URL.
 */
export const AgentDigestItem = z.object({
  article_index: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  why_it_matters: z.string(),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  // Ограничение «до 4 тегов» применяется в коде: maxItems в structured outputs поддерживается не везде.
  tags: z.array(z.string()),
});

export const AgentDigestResult = z.object({
  items: z.array(AgentDigestItem),
  nothing_new: z.boolean(),
});

export type AgentDigestResult = z.infer<typeof AgentDigestResult>;

/** Ответ модели на этапе предварительного отбора: номера релевантных статей. */
export const FilterResult = z.object({
  relevant: z.array(z.number().int().positive()),
});

export type FilterResult = z.infer<typeof FilterResult>;

/*
 * JSON Schema для `output_config.format`. Держим руками в синхроне с zod-схемами выше —
 * используемая версия zod (v3) не умеет генерировать JSON Schema сама.
 */
export const agentDigestResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "nothing_new"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["article_index", "title", "summary", "why_it_matters", "importance", "tags"],
        properties: {
          article_index: { type: "integer" },
          title: { type: "string" },
          summary: { type: "string" },
          why_it_matters: { type: "string" },
          importance: { type: "integer", enum: [1, 2, 3] },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    nothing_new: { type: "boolean" },
  },
};

export const filterResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["relevant"],
  properties: {
    relevant: { type: "array", items: { type: "integer" } },
  },
};
