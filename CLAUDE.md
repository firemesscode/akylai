# AkylBot — память проекта

AI-ассистент медиа «Тимур и команда» (Татарстан). Telegram-бот на Next.js,
деплой на Vercel, LLM — Groq (`llama-3.3-70b-versatile`).

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

Секреты НЕ хардкодятся в коде и не коммитятся (.gitignore закрывает .env*).

## Архитектурные решения

- **Webhook, не polling** — serverless-совместимо, Vercel будит функцию на каждый апдейт.
- **Защита вебхука** — Telegram шлёт заголовок `X-Telegram-Bot-Api-Secret-Token`,
  сверяем с `TELEGRAM_WEBHOOK_SECRET`, иначе 401.
- **Верификация пользователя** — при первом сообщении бот просит контакт
  кнопкой `request_contact`; пропускаем только если номер российский
  (11 цифр, начинается с 7/8) и контакт принадлежит самому пользователю.
- **История диалога** — in-memory Map, обрезается до 10 сообщений (экономия токенов).
  ⚠️ На Vercel память живёт только пока инстанс тёплый: при холодном старте
  история и верификация сбрасываются. Для прода → Vercel KV / Upstash Redis.
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
