import { logger } from "./logger.js";

const TELEGRAM_API_TIMEOUT_MS = 10_000;

function firstErrorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? message;
}

/**
 * Шлёт короткий алерт в Telegram об аварийном завершении запуска.
 * Намеренно не использует MarkdownV2-экранирование и не ретраит — это путь для критических
 * ошибок, он должен быть максимально простым и не падать сам по себе.
 */
export async function notifyFailure(topicId: string, error: unknown): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    logger.warn("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы, алерт не отправлен");
    return;
  }

  const text = `⚠️ ai-digest: тема "${topicId}" завершилась с ошибкой\n${firstErrorLine(error)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
  } catch (notifyError) {
    logger.error({ error: String(notifyError) }, "Не удалось отправить алерт в Telegram");
  } finally {
    clearTimeout(timeout);
  }
}
