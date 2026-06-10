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

// Премиум-эмодзи (tg-emoji) отображаются, только если у владельца бота
// есть Telegram Premium; для остальных показывается обычный эмодзи-фоллбэк.
const WELCOME = (name: string) => `<b>✨ Сәлам, ${name}! ✨</b>

Я — <b>AkylBot</b> 🤖, AI-ассистент медиа <b>«Тимур и команда»</b> из Татарстана 🇷🇺

<blockquote>🕌 Культура и история Татарстана
📰 Новости и жизнь республики
💬 Говорю на русском и татарском</blockquote>

Спрашивай что угодно — отвечу как друг, а не как робот 😉`;

const ASK_CONTACT = `<b>👋 Привет!</b>

Чтобы начать, подтверди номер телефона — нажми кнопку
<b>«📱 Поделиться контактом»</b> ниже.

<i>Доступ открыт для российских номеров (+7).</i>`;

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
