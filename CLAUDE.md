# AkylBot — память проекта

AI-ассистент медиа «Тимур и команда» (Татарстан). Telegram-бот на Next.js,
деплой на Vercel, LLM — Groq (`openai/gpt-oss-120b` + встроенный browser_search).

## Структура проекта

```
/app
  /api/webhook/route.ts  — приём апдейтов Telegram (POST, проверка secret_token)
  layout.tsx, page.tsx   — заглушка-лендинг
/lib
  groq.ts      — клиент Groq + системный промпт
  telegram.ts  — sendMessage / запрос контакта / проверка российского номера
  store.ts     — in-memory история диалога (макс. 10 сообщений) и верификация
CLAUDE.md      — этот файл
.env.example   — список переменных без значений
```

## Переменные окружения (Vercel → Settings → Environment Variables)

| Имя | Что это |
|---|---|
| `GROQ_API_KEY` | ключ из console.groq.com |
| `TELEGRAM_BOT_TOKEN` | токен от @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | произвольная строка, та же что в setWebhook |
| `UPSTASH_REDIS_REST_URL` | (опц.) Upstash Redis — постоянная память |
| `UPSTASH_REDIS_REST_TOKEN` | (опц.) токен Upstash REST API |
| `TELEGRAM_ADMIN_ID` | (опц.) user_id админа для команд /alert_* |

Секреты НЕ хардкодятся в коде и не коммитятся (.gitignore закрывает .env*).

## Архитектурные решения

- **Webhook, не polling** — serverless-совместимо, Vercel будит функцию на каждый апдейт.
- **Защита вебхука** — Telegram шлёт заголовок `X-Telegram-Bot-Api-Secret-Token`,
  сверяем с `TELEGRAM_WEBHOOK_SECRET`, иначе 401.
- **Верификация пользователя** — при первом сообщении бот просит контакт
  кнопкой `request_contact`; пропускаем только если номер российский
  (11 цифр, начинается с 7/8) и контакт принадлежит самому пользователю.
- **Хранилище** — Upstash Redis (REST, без SDK), если заданы env-переменные;
  иначе фоллбэк на in-memory (сбрасывается при холодном старте Vercel).
  Хранится: верификация, язык пользователя, история диалога (макс. 10 сообщений).
- **Модель** — `openai/gpt-oss-120b` со встроенным `browser_search`
  (tool_choice: auto): модель сама ищет в интернете свежие новости/факты.
- **Стриминг ответа** — бот мгновенно шлёт «✍️ Отвечаю...», затем плавно
  дописывает через editMessageText (не чаще раза в 1.5 сек, лимиты Telegram).
  Финал — markdown модели конвертируется в HTML (mdToHtml в telegram.ts).
- **Реакции** — бот с вероятностью 30% ставит эмодзи-реакцию (setMessageReaction).
- **Язык** — /settings с inline-кнопками: русский / татарский / английский.
  Промпт для татарского усилен (саф татар теле, сингармонизм, без русизмов).
- **Оповещения об опасности** — админ (TELEGRAM_ADMIN_ID) командами
  /alert_bpla, /alert_rocket, /alert_clear рассылает предупреждение
  (БПЛА / ракетная опасность / отбой) по всем чатам из реестра
  (Redis SET "chats", регистрация при каждом сообщении).
- **Авто-радар** — /api/radar парсит веб-зеркало публичного канала
  t.me/s/<RADAR_CHANNEL>, классифицирует новые посты по ключевым словам
  (бпла/ракет/отбой) и рассылает оповещения сам. Дёргается внешним кроном
  (cron-job.org, раз в минуту) с ?key=<TELEGRAM_WEBHOOK_SECRET>.
  Последний обработанный пост — в KV "radar:last".
- **Фоллбэки Groq** — стрим+поиск → без стрима+поиск → без поиска,
  чтобы «✍️ Отвечаю...» никогда не зависало без ответа.
- **Премиум-эмодзи** — в приветствии можно использовать `<tg-emoji emoji-id="...">⭐</tg-emoji>`
  (parse_mode=HTML); кастомные эмодзи в сообщениях бота отображаются, только если
  у владельца бота активен Telegram Premium, иначе показывается фоллбэк-эмодзи.
- Ответы LLM шлются без parse_mode, чтобы markdown модели не ломал отправку.

## Что сделано

- [x] Скелет Next.js (App Router, TypeScript)
- [x] `/api/webhook` с проверкой секрета
- [x] Интеграция Groq (llama-3.3-70b-versatile), системный промпт AkylBot
- [x] Верификация по контакту + проверка российского номера
- [x] Красивое приветствие (HTML, blockquote)
- [x] История диалога с лимитом 10 сообщений
- [x] .env.example, .gitignore

## Что осталось / следующие шаги для деплоя

1. Импортировать репозиторий в Vercel (vercel.com/new), задать 3 env-переменные.
2. После деплоя установить вебхук:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>.vercel.app/api/webhook&secret_token=<SECRET>"
   ```
   Проверить: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
3. (Опционально) Перенести историю/верификацию в Vercel KV или Upstash.
4. (Опционально) Ротировать токен бота, если он засветился где-то в переписке.
5. (Опционально) Вставить реальные `emoji-id` премиум-эмодзи в WELCOME.
