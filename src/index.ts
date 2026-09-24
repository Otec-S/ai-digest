#!/usr/bin/env node
import { Command } from "commander";
import { findTopic, loadConfig, parseSince } from "./config.js";
import { collectCandidates, enrichWithFullText } from "./collect/index.js";
import { finishRun, insertItem, openDatabase, startRun } from "./db.js";
import { dedupeCandidates, markCandidatesSeen } from "./dedupe.js";
import { rankCandidates } from "./rank.js";
import { filterCandidates, generateDigest } from "./agent/digest.js";
import { addUsage, emptyUsage } from "./agent/client.js";
import { buildFilterPrompt } from "./agent/prompt.js";
import type { DigestResult } from "./agent/schema.js";
import type { Candidate } from "./collect/types.js";
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

/** Грубая оценка токенов без обращения к API (~4 символа на токен для смеси латиницы/кириллицы). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface RunOptions {
  topic: string;
  dryRun?: boolean;
  /** false при --no-agent. */
  agent: boolean;
  since?: string;
  config: string;
}

async function run(options: RunOptions): Promise<void> {
  const env = loadEnv();
  const appConfig = loadConfig(options.config);
  const topic = findTopic(appConfig, options.topic);

  const sinceMs = Date.now() - (options.since ? parseSince(options.since) : topic.lookback_hours * 60 * 60 * 1000);

  logger.info({ topic: topic.id, since: new Date(sinceMs).toISOString() }, "Начинаю сбор кандидатов");

  const rawCandidates = await collectCandidates(topic, sinceMs, env.TAVILY_API_KEY);
  const db = openDatabase(env.DB_PATH);
  const now = new Date();
  const runId = options.dryRun || !options.agent ? null : startRun(db, { topicId: topic.id, startedAt: now.toISOString() });

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

  if (!options.agent) {
    const filterPrompt = buildFilterPrompt(ranked);
    console.log(`\nТема: ${topic.title} (${topic.id}) — режим без вызова модели`);
    console.log(`Сырых кандидатов: ${rawCandidates.length}, после дедупа: ${deduped.length}, на отбор: ${ranked.length}`);
    console.log(`Промпт отбора (${topic.filter_model}): ~${estimateTokens(filterPrompt)} токенов\n`);
    console.log(filterPrompt);
    db.close();
    return;
  }

  let usage = emptyUsage();
  let selected: Candidate[] = [];
  if (ranked.length > 0) {
    const filtered = await filterCandidates(topic, ranked);
    selected = filtered.selected;
    usage = addUsage(usage, filtered.usage);
    logger.info({ count: selected.length, costUsd: filtered.usage.costUsd }, "Предварительный отбор завершён");
  }

  let digest: DigestResult = { items: [], nothing_new: true };
  if (selected.length > 0) {
    const enriched = await enrichWithFullText(selected);
    logger.info({ count: enriched.length }, "Вызываю агента для составления дайджеста");
    const outcome = await generateDigest(topic, enriched);
    digest = outcome.result;
    usage = addUsage(usage, outcome.usage);
  } else {
    logger.info("Релевантных кандидатов нет — суммаризация пропущена");
  }
  logger.info(
    { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd },
    "Агент отработал",
  );

  if (options.dryRun) {
    console.log(`\nТема: ${topic.title} (${topic.id})`);
    console.log(
      `Сырых кандидатов: ${rawCandidates.length}, после дедупа: ${deduped.length}, на отбор: ${ranked.length}, отобрано: ${selected.length}`,
    );
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

  // Помечаем только то, что модель реально рассмотрела; остальные кандидаты остаются на следующий запуск.
  markCandidatesSeen(db, ranked, topic.id, now);
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
  .description("Сбор и суммаризация новостей по темам через Claude API")
  .command("run")
  .requiredOption("--topic <id>", "id темы из config/topics.yaml")
  .option("--dry-run", "не писать в БД и не слать в Telegram, только вывести в консоль")
  .option("--no-agent", "не вызывать модель: показать промпт отбора и его примерный размер (для отладки сбора/ранжирования)")
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
