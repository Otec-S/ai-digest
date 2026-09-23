# Деплой ai-digest на Ubuntu VPS

Пошаговая инструкция для запуска по расписанию через systemd timer.

## 1. Пользователь и директория

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin digest
sudo mkdir -p /opt/ai-digest
sudo chown digest:digest /opt/ai-digest
```

## 2. Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # должно быть v22.x
```

## 3. Клонирование и сборка

```bash
sudo -u digest git clone <URL_РЕПОЗИТОРИЯ> /opt/ai-digest
cd /opt/ai-digest
sudo -u digest npm ci
sudo -u digest npm run build
```

## 4. Конфигурация

Отредактируйте `config/topics.yaml` под свои темы (не забудьте настроить реальные RSS-фиды —
плейсхолдеры вроде `anthropic.com/news/rss.xml` могут не существовать, проверьте перед запуском).

Создайте `.env` из примера и заполните секреты:

```bash
sudo -u digest cp /opt/ai-digest/.env.example /opt/ai-digest/.env
sudo -u digest nano /opt/ai-digest/.env
sudo chmod 600 /opt/ai-digest/.env
```

Обязательные переменные: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
`TAVILY_API_KEY` — опционально (без него шаг добора через поиск пропускается).

## 5. Часовой пояс

Если сервер выделен только под этот проект — проще выставить системную таймзону:

```bash
sudo timedatectl set-timezone Asia/Tashkent
```

Это влияет на расписание `OnCalendar=` в таймерах и на даты в отчётах/сообщениях.

**Если сервер общий** (на нём уже что-то работает — другие сервисы, cron-задачи), менять
системную таймзону рискованно: сдвинутся логи и расписания чужих юнитов. В этом случае не трогайте
`timedatectl`, а пересчитайте `OnCalendar=` в `deploy/ai-digest@.timer` под текущую таймзону сервера
(узнать её: `timedatectl show --property=Timezone`) вручную.

## 6. Установка systemd-юнитов

```bash
sudo cp /opt/ai-digest/deploy/ai-digest@.service /etc/systemd/system/
sudo cp /opt/ai-digest/deploy/ai-digest@.timer /etc/systemd/system/
sudo cp /opt/ai-digest/deploy/ai-digest-alert@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Юниты шаблонные (`%i` = id темы из `config/topics.yaml`). Включите таймер для конкретной темы:

```bash
sudo systemctl enable --now ai-digest@ai-industry.timer
```

Проверить, когда сработает таймер:

```bash
systemctl list-timers ai-digest@*
```

Ручной прогон вне расписания (например, для проверки):

```bash
sudo systemctl start ai-digest@ai-industry.service
```

## 7. Логи

```bash
# логи конкретного запуска темы
journalctl -u ai-digest@ai-industry.service -n 100 --no-pager

# логи в реальном времени
journalctl -u ai-digest@ai-industry.service -f

# логи резервного алерта (срабатывает через OnFailure=, только при аварийном завершении)
journalctl -u ai-digest-alert@ai-industry.service -n 50
```

Логи пишутся в JSON (pino) — удобно фильтровать через `jq`:

```bash
journalctl -u ai-digest@ai-industry.service -o cat -n 200 | jq 'select(.level >= 40)'
```

## 8. Обновление после изменений в коде

```bash
cd /opt/ai-digest
sudo -u digest git pull
sudo -u digest npm ci
sudo -u digest npm run build
```

Юниты перечитывать не нужно, если сами файлы `.service`/`.timer` не менялись.

## 9. Добавление новой темы

1. Добавьте тему в `config/topics.yaml`.
2. `sudo systemctl enable --now ai-digest@<id-темы>.timer`.

Ничего пересобирать не нужно — темы читаются из конфига при каждом запуске.
