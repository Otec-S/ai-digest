import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    topic_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    candidates_count INTEGER,
    items_count INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS seen_urls (
    url_hash TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title_hash TEXT,
    first_seen_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_seen_topic_date ON seen_urls(topic_id, first_seen_at)`,
  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id),
    topic_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    why_it_matters TEXT,
    importance INTEGER,
    source TEXT,
    published_at TEXT,
    feedback INTEGER
  )`,
];

export type AppDatabase = Database.Database;

/** Открывает (или создаёт) файл SQLite и прогоняет миграции. */
export function openDatabase(path: string): AppDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  for (const migration of MIGRATIONS) {
    db.exec(migration);
  }
  return db;
}

export interface RunRecord {
  topicId: string;
  startedAt: string;
}

/** Создаёт запись о запуске со статусом running, возвращает её id. */
export function startRun(db: AppDatabase, record: RunRecord): number {
  const result = db
    .prepare(`INSERT INTO runs (topic_id, started_at, status) VALUES (?, ?, 'running')`)
    .run(record.topicId, record.startedAt);
  return Number(result.lastInsertRowid);
}

export interface FinishRunUpdate {
  status: "ok" | "failed" | "no_news";
  finishedAt: string;
  candidatesCount?: number;
  itemsCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
}

export function finishRun(db: AppDatabase, runId: number, update: FinishRunUpdate): void {
  db.prepare(
    `UPDATE runs SET status = ?, finished_at = ?, candidates_count = ?, items_count = ?,
       input_tokens = ?, output_tokens = ?, cost_usd = ?, error = ?
     WHERE id = ?`,
  ).run(
    update.status,
    update.finishedAt,
    update.candidatesCount ?? null,
    update.itemsCount ?? null,
    update.inputTokens ?? null,
    update.outputTokens ?? null,
    update.costUsd ?? null,
    update.error ?? null,
    runId,
  );
}

export interface SeenUrlRecord {
  urlHash: string;
  topicId: string;
  url: string;
  titleHash: string | null;
  firstSeenAt: string;
}

export function insertSeenUrl(db: AppDatabase, record: SeenUrlRecord): void {
  db.prepare(
    `INSERT OR IGNORE INTO seen_urls (url_hash, topic_id, url, title_hash, first_seen_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(record.urlHash, record.topicId, record.url, record.titleHash, record.firstSeenAt);
}

export function isUrlSeen(db: AppDatabase, urlHash: string): boolean {
  const row = db.prepare(`SELECT 1 FROM seen_urls WHERE url_hash = ?`).get(urlHash);
  return row !== undefined;
}

interface SeenTitleRow {
  title_hash: string;
}

/** Возвращает нормализованные заголовки, увиденные по теме за последние `days` дней. */
export function getRecentTitleHashes(db: AppDatabase, topicId: string, sinceIso: string): string[] {
  const rows = db
    .prepare(
      `SELECT title_hash FROM seen_urls WHERE topic_id = ? AND first_seen_at >= ? AND title_hash IS NOT NULL`,
    )
    .all(topicId, sinceIso) as SeenTitleRow[];
  return rows.map((row) => row.title_hash);
}

export interface ItemRecord {
  runId: number;
  topicId: string;
  url: string;
  title: string;
  summary: string | null;
  whyItMatters: string | null;
  importance: number | null;
  source: string | null;
  publishedAt: string | null;
}

export function insertItem(db: AppDatabase, item: ItemRecord): void {
  db.prepare(
    `INSERT INTO items (run_id, topic_id, url, title, summary, why_it_matters, importance, source, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.runId,
    item.topicId,
    item.url,
    item.title,
    item.summary,
    item.whyItMatters,
    item.importance,
    item.source,
    item.publishedAt,
  );
}
