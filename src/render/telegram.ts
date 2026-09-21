import type { DigestResult, DigestItem } from "../agent/schema.js";
import type { TopicConfig } from "../config.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const MARKDOWN_V2_SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;
const IMPORTANCE_MARKER: Record<1 | 2 | 3, string> = { 3: "🔥", 2: "▸", 1: "·" };

/** Экранирует спецсимволы MarkdownV2 в обычном тексте. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_SPECIAL_CHARS, (char) => `\\${char}`);
}

/** Экранирует URL для использования внутри `[текст](url)` — там спецсимволы нужны только `)` и `\`. */
export function escapeMarkdownV2Url(url: string): string {
  return url.replace(/[)\\]/g, (char) => `\\${char}`);
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function formatItemBlock(item: DigestItem): string {
  const marker = IMPORTANCE_MARKER[item.importance];
  let sourceLabel: string;
  try {
    sourceLabel = new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    sourceLabel = item.source;
  }

  return [
    `${marker} *${escapeMarkdownV2(item.title)}*`,
    escapeMarkdownV2(item.summary),
    `_Почему важно:_ ${escapeMarkdownV2(item.why_it_matters)}`,
    `[${escapeMarkdownV2(sourceLabel)}](${escapeMarkdownV2Url(item.url)})`,
  ].join("\n");
}

/**
 * Формирует одно или несколько сообщений в MarkdownV2, готовых к отправке в Telegram.
 * Режет по границам пунктов, если итог превышает лимит в 4096 символов.
 */
export function formatDigestMessages(topic: TopicConfig, digest: DigestResult, date: Date): string[] {
  const header = `*${escapeMarkdownV2(topic.title)}* · ${escapeMarkdownV2(formatDate(date))}`;

  if (digest.nothing_new || digest.items.length === 0) {
    return [`${header}\n\nНичего нового по теме сегодня нет\\.`];
  }

  const blocks = digest.items.map(formatItemBlock);

  const messages: string[] = [];
  let current = header;

  for (const block of blocks) {
    const candidate = `${current}\n\n${block}`;
    if (candidate.length > TELEGRAM_MAX_MESSAGE_LENGTH && current !== header) {
      messages.push(current);
      current = `${header}\n\n${block}`;
    } else {
      current = candidate;
    }
  }
  messages.push(current);

  return messages;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Отправляет одно сообщение в Telegram с ретраями на 5xx/429/таймаут (экспоненциальная задержка). */
export async function sendTelegramMessage(config: TelegramConfig, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
      });
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    if (response.ok) return;

    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES) {
      const body = await response.text();
      throw new Error(`Telegram API вернул ${response.status}: ${body}`);
    }

    await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
  }
}

/** Отправляет весь дайджест, разбитый на сообщения, последовательно. */
export async function sendDigest(config: TelegramConfig, messages: string[]): Promise<void> {
  for (const message of messages) {
    await sendTelegramMessage(config, message);
  }
}
