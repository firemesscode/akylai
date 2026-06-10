import { NextRequest, NextResponse } from "next/server";
import { askGroq } from "@/lib/groq";
import {
  sendMessage,
  sendContactRequest,
  removeKeyboard,
  sendChatAction,
  isRussianPhone,
} from "@/lib/telegram";
import { isVerified, markVerified, getHistory, pushHistory } from "@/lib/store";

export const maxDuration = 60;

// Премиум-эмодзи через <tg-emoji emoji-id="...">фоллбэк</tg-emoji>
// Работают только если у владельца бота есть Telegram Premium.
// Получить emoji_id: перешли нужный эмодзи боту @idstickerbot
// Замени ID ниже на свои — сейчас стоят популярные публичные паки.
// Премиум-эмодзи. Фоллбэк внутри тега виден тем, у кого нет Premium.
const E = {
  hello:    `<tg-emoji emoji-id="5192822796115256248">😍</tg-emoji>`,
  news:     `<tg-emoji emoji-id="5474632681490753024">🇷🇺</tg-emoji>`,
  history:  `<tg-emoji emoji-id="5424656265940846126">😀</tg-emoji>`,
  question: `<tg-emoji emoji-id="5449694349023519633">👨‍💻</tg-emoji>`,
  tea:      `<tg-emoji emoji-id="5408949445985312258">🌮</tg-emoji>`,
  lock:     `<tg-emoji emoji-id="5449694349023519633">👨‍💻</tg-emoji>`,
};

const WELCOME = (name: string) => `<b>Привет, ${name}!</b>${E.hello}

Я — бот акыл, созданный медиа СМИ "Тимур и команда" специально для Татарстана

<blockquote>${E.news} Новости Татарстана и Казани
${E.history} История и культура
${E.question} Интересные вопросы</blockquote>

Расскажу отвечу обо всем из этого списка, задай вопрос...${E.tea}`;

const ASK_CONTACT = `${E.hello} <b>Привет!</b>

${E.lock} Перед входом — быстрая проверка.
Нажми кнопку ниже, чтобы поделиться номером.

<blockquote>Доступ открыт для российских номеров (+7).
Контакт используется только для верификации.</blockquote>`;

function handle(update: any): Promise<void> {
  return processUpdate(update).catch((e) => {
    console.error("Update processing error:", e);
  });
}

async function processUpdate(update: any) {
  const message = update.message;
  if (!message) return;

  const chatId: number = message.chat.id;
  const userId: number = message.from?.id;
  if (!chatId || !userId) return;

  // 1. Пришёл контакт — верификация
  if (message.contact) {
    if (message.contact.user_id !== userId) {
      await sendMessage(chatId, "Нужно поделиться <b>своим</b> контактом 🙂");
      return;
    }
    if (isRussianPhone(message.contact.phone_number)) {
      markVerified(userId);
      await removeKeyboard(chatId, WELCOME(message.from.first_name ?? "дус"));
    } else {
      await removeKeyboard(
        chatId,
        "😔 Извини, доступ пока только для российских номеров (+7)."
      );
    }
    return;
  }

  // 2. Не верифицирован — просим контакт
  if (!isVerified(userId)) {
    await sendContactRequest(chatId, ASK_CONTACT);
    return;
  }

  // 3. Обычный текст — отвечаем через Groq
  const text: string | undefined = message.text;
  if (!text) return;

  if (text === "/start") {
    await sendMessage(chatId, WELCOME(message.from.first_name ?? "дус"));
    return;
  }

  await sendChatAction(chatId);
  pushHistory(chatId, { role: "user", content: text });
  const answer = await askGroq(getHistory(chatId));
  pushHistory(chatId, { role: "assistant", content: answer });
  await sendMessage(chatId, answer, { parse_mode: undefined });
}

export async function POST(req: NextRequest) {
  // Проверка секрета вебхука
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json();
  await handle(update);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ status: "AkylBot webhook is alive" });
}
