# Technique Quiz (`technique_quiz`)

Музыкальная викторина для iPad/ТВ (AirPlay) по текстам песен.

## Правила игры

- **Фристайл:** 8 раундов, только вопросы с ответом в одну строку; после остановки фрагмента участники продолжают текст вслух, затем открывается правильное продолжение.
- **Викторина:** в пул попадают **все** раунды с ответом из одной или нескольких строк.
  - **Одна строка ответа** — четыре варианта на выбор (отвлекающие из других однострочных раундов).
  - **Две строки** — четыре варианта; текст варианта с **переносом строки** между двумя строками ответа.
  - **Три и больше** — **порядок строк** (перетаскивание или ↑↓), затем подтверждение.
- За одну сессию играется до 14 раундов в викторине и до 8 однострочных раундов во фристайле (из пула не скрытых в `rounds.ts`).

## Локальный запуск

```bash
npm install
npm run dev
```

Игра: **http://localhost:18768/**.

## Multiplayer через PartyKit

Мультиплеер работает как Jackbox: главный экран открывается на компьютере/ТВ/планшете, телефоны игроков открывают controller UI по коду комнаты.

```bash
nvm use
npm install
npm run dev -- --host 127.0.0.1
npm run party:dev
```

- Host: `http://127.0.0.1:18768/room/ABC123/host`
- Player: `http://127.0.0.1:18768/join/ABC123`
- Быстрые тестовые комнаты начинаются с `E2E`, например `E2EQA1`: в них таймеры короче и первые раунды детерминированы.

Переменные окружения:

```bash
VITE_APP_URL=http://localhost:18768
VITE_PARTYKIT_HOST=localhost:1999
VITE_MULTIPLAYER_SERVER_URL=http://localhost:1999
```

PartyKit хранит состояние комнаты на сервере. Клиент хранит стабильный `clientId`, host token и player id в `localStorage`, поэтому refresh host/player не создаёт дубликаты и сохраняет имя/счёт/ответы/голоса.

## Проверки

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
```

`test:e2e` сам поднимает Vite и PartyKit. Для Playwright может понадобиться один раз установить браузеры: `npx playwright install chromium`.

## Редактор раундов (только `npm run dev`)

Открой в браузере: **http://localhost:5173/editor**

- **Аудио:** поле пути к файлу в `public/content/audio/music/` или загрузка с диска (копия в `music/`). Волна, **Play**, **Фрагмент** (весь выбранный отрезок) и **Хвост** (последние ~2,5 с фрагмента).
- **Genius:** поиск по тегам или имени файла `Исполнитель - Название`; приписки вида `(feat. …)` из названия убираются из запроса.
- **Текст:** строки, подсказки, ответ (несколько строк подряд после последней подсказки). Любой непустой ответ участвует в викторине.
- **Фон видео:** путь вида `bg/…` относительно `public/content/video/`; можно загрузить файл — он сохранится в `public/content/video/bg/`.
- **Сохранить** — запись в `src/content/rounds/rounds.ts`.
- **Push базы** (dev): `git add` / `commit` / `push` для `rounds.ts`, `public/content/audio/music/`, `public/content/audio/ui/`, `public/content/video/`; время последнего успешного push и число треков хранятся в `localStorage` этого браузера.
- Экспорт **rounds.ts** / **JSON** и импорт JSON для бэкапа.
- В прод-сборке (`npm run build`) редактор **не входит** в бандл игры.

Папку `editor-local/` можно использовать для черновиков (см. `.gitignore`).

## Деплой на GitHub Pages

### Вариант 1: GitHub Actions (автоматически)

1. Создай репозиторий на GitHub (например, `username/technique_quiz`)
2. Включи Pages: Settings → Pages → Source: GitHub Actions
3. Запушь код в ветку `main` — деплой запустится автоматически
4. Сайт будет доступен по адресу: `https://username.github.io/technique_quiz/`

### Вариант 2: Вручную через gh-pages

```bash
npm install -D gh-pages
npm run deploy
```

Убедись, что в Settings → Pages выбран источник «Deploy from a branch», ветка `gh-pages`, папка `/ (root)`.

## Деплой PartyKit / WebSocket backend

Статический frontend можно оставить на GitHub Pages или любом CDN, но мультиплеер требует стабильный WebSocket/backend runtime.

Рекомендуемый путь:

1. Деплой PartyKit managed/cloud-prem:
   ```bash
   npm run party:deploy
   ```
2. В production frontend задать `VITE_PARTYKIT_HOST=<your-party>.partykit.dev` или Cloudflare host.
3. Для HTTPS сайта backend должен быть доступен по WSS.

VPS fallback:

- PartyKit напрямую ориентирован на managed PartyKit/Cloudflare Durable Objects; обычный VPS self-hosting для Durable Object semantics awkward.
- Совместимый fallback — отдельный Node/WebSocket backend с теми же message contracts из `src/multiplayer/messages.ts`, persistent storage, sticky rooms, reverse proxy и WSS.
- Если выбран VPS, используйте Docker или process manager, reverse proxy с HTTPS/WSS, restart policy, healthcheck endpoint, stdout/stderr logs, log rotation, and memory alerts. Ожидаемая память для текущей комнаты мала, но держите headroom для медиа/CDN и нескольких комнат.
- Не запускайте `partykit dev` как production service.

## Переименование репозитория на GitHub

После смены имени репозитория на `technique_quiz` обнови URL у себя:

```bash
git remote set-url origin https://github.com/<user>/technique_quiz.git
```

Локальную папку можно переименовать вручную; на работу проекта это не влияет.

## Структура проекта

- `public/content/` — медиа (аудио, видео, фото)
- `src/content/rounds/rounds.ts` — массив раундов: `title`, `lyrics`, `audioFile`, опционально фон YouTube/видео, тайминг `start`/`end`
- `src/helpers/quizConfig.ts` — глобальные тайминги и пути к общим медиа
