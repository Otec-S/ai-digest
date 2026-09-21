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
 * JSON Schema для `outputFormat` Claude Agent SDK. Держим руками в синхроне с DigestResult выше —
 * используемая версия zod (v3) не умеет генерировать JSON Schema сама.
 */
export const digestResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "nothing_new"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "why_it_matters", "url", "source", "published_at", "importance", "tags"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          why_it_matters: { type: "string" },
          url: { type: "string" },
          source: { type: "string" },
          published_at: { type: "string" },
          importance: { type: "integer", enum: [1, 2, 3] },
          tags: { type: "array", maxItems: 4, items: { type: "string" } },
        },
      },
    },
    nothing_new: { type: "boolean" },
  },
} as const;
