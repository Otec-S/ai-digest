# ai-digest

CLI-сервис, который по расписанию собирает свежие материалы из интернета по заданным темам,
прогоняет их через Claude Agent SDK и присылает дайджест в Telegram.

## Как это работает

1. Собирает кандидатов из RSS-фидов темы (и, опционально, через Brave Search).
2. Отбрасывает дубликаты (по каноническому URL и по нечёткому сходству заголовков).
3. Эвристически ранжирует кандидатов и вытягивает полный текст лучших статей.
4. Прогоняет их через Claude Agent SDK: модель фильтрует нерелевантное, ранжирует по важности,
   пишет саммари и возвращает строгий JSON.
5. Пишет отчёт в `reports/`, сохраняет данные в SQLite и отправляет дайджест в Telegram.

## Стек

Node.js 22, TypeScript (strict, ESM), `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `zod`,
`rss-parser`, `@mozilla/readability` + `jsdom` + `turndown`, `commander`, `pino`, `vitest`.

## Быстрый старт

```bash
npm ci
cp .env.example .env   # заполните ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

Проверка без записи в БД и без отправки в Telegram:

```bash
npm run dev -- run --topic=ai-industry --dry-run --since=48h
```

Реальный прогон (пишет в SQLite, `reports/`, шлёт в Telegram):

```bash
npm run dev -- run --topic=ai-industry
```

## CLI

```
ai-digest run --topic=<id> [--dry-run] [--since=24h] [--config=path/to/topics.yaml]
```

- `--topic` — id темы из `config/topics.yaml` (обязателен).
- `--dry-run` — ничего не пишет и не отправляет, только печатает результат в консоль.
- `--since` — окно свежести (`24h`, `7d`, ...), переопределяет `lookback_hours` темы.
- `--config` — путь к файлу конфига тем (по умолчанию `config/topics.yaml`).

## Конфигурация тем

Темы описываются в `config/topics.yaml` и валидируются через zod при старте. Пример:

```yaml
defaults:
  lookback_hours: 24
  max_items: 8
  max_articles_to_fetch: 15
  language: ru
  model: claude-sonnet-4-5

topics:
  - id: ai-industry
    title: "Новинки AI-индустрии"
    feeds: [...]
    search_queries: [...]
    exclude_keywords: [...]
    relevance_prompt: >
      Что важно, а что нет для этой темы.
```

`id` темы должен быть slug'ом (`^[a-z0-9-]+$`). Поля темы переопределяют `defaults`.

## Переменные окружения

См. `.env.example`. Обязательны `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
(последние два — только для реальной отправки, не для `--dry-run`). `BRAVE_API_KEY` опционален.

## Тесты

```bash
npm test
```

Покрыты: экранирование MarkdownV2, разбиение длинных сообщений на части, канонизация URL и
нечёткий дедуп заголовков, парсинг и валидация конфига тем.

## Деплой

Пошаговая инструкция для Ubuntu VPS (systemd timer) — в [`deploy/README.md`](deploy/README.md).

## Структура проекта

```
src/
├─ index.ts        # CLI и оркестрация пайплайна
├─ config.ts        # загрузка и валидация config/topics.yaml
├─ env.ts            # валидация переменных окружения
├─ db.ts             # SQLite: runs, seen_urls, items
├─ dedupe.ts         # канонизация URL, нечёткий дедуп заголовков
├─ rank.ts           # эвристическое ранжирование кандидатов
├─ notify.ts         # алерт об ошибке в Telegram
├─ logger.ts         # pino
├─ collect/          # сбор из RSS/поиска, извлечение текста статей
├─ agent/            # промпт, вызов Claude Agent SDK, zod-схема ответа
└─ render/           # рендер в markdown и Telegram (MarkdownV2)
```
