import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY обязателен"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  TAVILY_API_KEY: z.string().optional(),
  DB_PATH: z.string().default("./data/digest.db"),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof envSchema>;

/** Валидирует переменные окружения, обязательные всегда (агент нужен и в --dry-run). */
export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Некорректные переменные окружения: ${details}`);
  }
  return parsed.data;
}

/** Дополнительно требует TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID — нужны только для реальной отправки. */
export function requireTelegramConfig(env: Env): { botToken: string; chatId: string } {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID обязательны для отправки дайджеста (не в --dry-run)");
  }
  return { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
}
