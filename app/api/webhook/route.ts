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
// ID ниже — плейсхолдеры; заменить на реальные custom_emoji_id
// (пользователь пришлёт). Фоллбэк-эмодзи внутри тега виден всем без Premium.
const E = {
  hello:    `<tg-emoji emoji-id="PLACEHOLDER_HELLO">🤝</tg-emoji>`,
  news:     `<tg-emoji emoji-id="PLACEHOLDER_NEWS">🍉</tg-emoji>`,
  history:  `<tg-emoji emoji-id="PLACEHOLDER_HISTORY">🏛</tg-emoji>`,
  question: `<tg-emoji emoji-id="PLACEHOLDER_QUESTION">🤔</tg-emoji>`,
  tea:      `<tg-emoji emoji-id="PLACEHOLDER_TEA">🫖</tg-emoji>`,
  lock:     `<tg-emoji emoji-id="PLACEHOLDER_LOCK">🔐</tg-emoji>`,
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

  // ВРЕМЕННЫЙ РЕЖИМ СБОРА ЭМОДЗИ: ответы AI отключены.
  // Бот на любое сообщение показывает custom_emoji_id премиум-эмодзи в нём.
  // Когда ID собраны — убрать блок до "// КОНЕЦ ВРЕМЕННОГО РЕЖИМА".
  {
    const entities: any[] = message.entities ?? [];
    const ids = entities
      .filter((e: any) => e.type === "custom_emoji")
      .map((e: any, i: number) => {
        const fallback = text.slice(e.offset, e.offset + e.length);
        return `${fallback} — <code>${e.custom_emoji_id}</code>`;
      })
      .join("\n");
    await sendMessage(
      chatId,
      ids
        ? `Найденные emoji_id:\n${ids}`
        : "Пришли сообщение с премиум-эмодзи — покажу их ID. (Ответы AI временно отключены.)"
    );
    return;
  }
  // КОНЕЦ ВРЕМЕННОГО РЕЖИМА

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
