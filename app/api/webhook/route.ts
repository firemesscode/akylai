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
const E = {
  star:    `<tg-emoji emoji-id="5368324170671202286">⭐</tg-emoji>`,
  fire:    `<tg-emoji emoji-id="5188311512791393083">🔥</tg-emoji>`,
  gem:     `<tg-emoji emoji-id="5471952986970267163">💎</tg-emoji>`,
  wave:    `<tg-emoji emoji-id="5373141891321699086">👋</tg-emoji>`,
  robot:   `<tg-emoji emoji-id="5350537653374174062">🤖</tg-emoji>`,
  mosque:  `<tg-emoji emoji-id="5372981976804366741">🕌</tg-emoji>`,
  news:    `<tg-emoji emoji-id="5379748062124056898">📰</tg-emoji>`,
  chat:    `<tg-emoji emoji-id="5373168472843038101">💬</tg-emoji>`,
  check:   `<tg-emoji emoji-id="5379748062124056900">✅</tg-emoji>`,
  lock:    `<tg-emoji emoji-id="5373141891321699001">🔐</tg-emoji>`,
};

const WELCOME = (name: string) => `${E.star}<b> Сәлам, ${name}!</b> ${E.star}

${E.robot} Я — <b>AkylBot</b>, AI-ассистент медиа
<b>«Тимур и команда»</b> из Татарстана 🇷🇺

<blockquote>${E.mosque} Культура и история Татарстана
${E.news} Новости и жизнь республики
${E.chat} Говорю на русском и татарском</blockquote>

${E.fire} Спрашивай что угодно — отвечу как друг, а не как робот!`;

const ASK_CONTACT = `${E.wave} <b>Привет!</b>

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

  // /emoji — показывает custom_emoji_id всех премиум-эмодзи в сообщении.
  // Пришли боту сообщение с нужными эмодзи, потом /emoji — получишь их ID.
  if (text === "/emoji") {
    const entities: any[] = message.entities ?? [];
    const ids = entities
      .filter((e: any) => e.type === "custom_emoji")
      .map((e: any) => `<code>${e.custom_emoji_id}</code>`)
      .join("\n");
    await sendMessage(
      chatId,
      ids
        ? `Найденные emoji_id:\n${ids}`
        : "Перешли сообщение с премиум-эмодзи, затем напиши /emoji — покажу их ID."
    );
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
