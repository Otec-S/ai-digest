#!/usr/bin/env node
import { Command } from "commander";
import { findTopic, loadConfig, parseSince } from "./config.js";
import { collectCandidates, enrichWithFullText } from "./collect/index.js";
import { finishRun, insertItem, openDatabase, startRun } from "./db.js";
import { dedupeCandidates, markCandidatesSeen } from "./dedupe.js";
import { rankCandidates } from "./rank.js";
import { generateDigest } from "./agent/digest.js";
import { loadEnv, requireTelegramConfig } from "./env.js";
import { renderMarkdownReport, reportPath, writeMarkdownReport } from "./render/markdown.js";
import { formatDigestMessages, sendDigest } from "./render/telegram.js";
import { notifyFailure } from "./notify.js";
import { logger } from "./logger.js";

const DEFAULT_CONFIG_PATH = "config/topics.yaml";
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

class RunTimeoutError extends Error {
  constructor() {
    super(`Запуск превысил жёсткий лимит в ${RUN_TIMEOUT_MS / 60_000} минут`);
  }
}

function withHardTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RunTimeoutError()), RUN_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface RunOptions {
  topic: string;
  dryRun?: boolean;
  since?: string;
  config: string;
}

async function run(options: RunOptions): Promise<void> {
  const env = loadEnv();
  const appConfig = loadConfig(options.config);
  const topic = findTopic(appConfig, options.topic);

  const sinceMs = Date.now() - (options.since ? parseSince(options.since) : topic.lookback_hours * 60 * 60 * 1000);

  logger.info({ topic: topic.id, since: new Date(sinceMs).toISOString() }, "Начинаю сбор кандидатов");

  const rawCandidates = await collectCandidates(topic, sinceMs);
  const db = openDatabase(env.DB_PATH);
  const now = new Date();
  const runId = options.dryRun ? null : startRun(db, { topicId: topic.id, startedAt: now.toISOString() });

  try {
    await runPipeline(options, topic, env, db, runId, rawCandidates, now);
  } catch (error) {
    if (runId !== null) {
      finishRun(db, runId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    db.close();
    throw error;
  }
}

async function runPipeline(
  options: RunOptions,
  topic: ReturnType<typeof findTopic>,
  env: ReturnType<typeof loadEnv>,
  db: ReturnType<typeof openDatabase>,
  runId: number | null,
  rawCandidates: Awaited<ReturnType<typeof collectCandidates>>,
  now: Date,
): Promise<void> {
  const deduped = dedupeCandidates(rawCandidates, db, topic.id, now);
  const ranked = rankCandidates(deduped, topic, now.getTime());

  logger.info(
    { raw: rawCandidates.length, afterDedupe: deduped.length, afterRank: ranked.length },
    "Кандидаты отфильтрованы и отранжированы",
  );

  const enriched = await enrichWithFullText(ranked);

  logger.info({ count: enriched.length }, "Вызываю агента для составления дайджеста");
  const { result: digest, usage } = await generateDigest(topic, enriched);
  logger.info(
    { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd },
    "Агент отработал",
  );

  if (options.dryRun) {
    console.log(`\nТема: ${topic.title} (${topic.id})`);
    console.log(`Сырых кандидатов: ${rawCandidates.length}, после дедупа: ${deduped.length}, в топ-отборе: ${ranked.length}`);
    console.log(
      `Токены: ${usage.inputTokens} вход / ${usage.outputTokens} выход, стоимость: $${usage.costUsd.toFixed(4)}\n`,
    );

    if (digest.nothing_new || digest.items.length === 0) {
      console.log("Нечего показать: агент не нашёл релевантных новостей.");
    } else {
      for (const item of digest.items) {
        const marker = item.importance === 3 ? "🔥" : item.importance === 2 ? "▸" : "·";
        console.log(`${marker} [${item.importance}] ${item.title} (${item.tags.join(", ")})`);
        console.log(`  ${item.summary}`);
        console.log(`  Почему важно: ${item.why_it_matters}`);
        console.log(`  ${item.source} — ${item.url}\n`);
      }
    }
    db.close();
    return;
  }

  const path = reportPath(topic.id, now);
  writeMarkdownReport(path, renderMarkdownReport(topic, digest, now));
  logger.info({ path }, "Отчёт записан");

  for (const item of digest.items) {
    insertItem(db, {
      runId: runId as number,
      topicId: topic.id,
      url: item.url,
      title: item.title,
      summary: item.summary,
      whyItMatters: item.why_it_matters,
      importance: item.importance,
      source: item.source,
      publishedAt: item.published_at,
    });
  }

  const telegramConfig = requireTelegramConfig(env);
  const messages = formatDigestMessages(topic, digest, now);
  await sendDigest(telegramConfig, messages);
  logger.info({ messages: messages.length }, "Дайджест отправлен в Telegram");

  markCandidatesSeen(db, deduped, topic.id, now);
  finishRun(db, runId as number, {
    status: digest.nothing_new || digest.items.length === 0 ? "no_news" : "ok",
    finishedAt: new Date().toISOString(),
    candidatesCount: rawCandidates.length,
    itemsCount: digest.items.length,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
  });
  db.close();
}

const program = new Command();

program
  .name("ai-digest")
  .description("Сбор и суммаризация новостей по темам через Claude Agent SDK")
  .command("run")
  .requiredOption("--topic <id>", "id темы из config/topics.yaml")
  .option("--dry-run", "не писать в БД и не слать в Telegram, только вывести в консоль")
  .option("--since <window>", 'окно свежести, например "24h" или "7d" (переопределяет lookback_hours)')
  .option("--config <path>", "путь к конфигу тем", DEFAULT_CONFIG_PATH)
  .action(async (options: RunOptions) => {
    try {
      await withHardTimeout(run(options));
      process.exit(0);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Запуск завершился ошибкой");
      await notifyFailure(options.topic, error);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
