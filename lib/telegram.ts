const API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function call(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`Telegram ${method} failed:`, await res.text());
  }
  return res;
}

// Заменяет <tg-emoji ...>X</tg-emoji> на обычный эмодзи-фоллбэк X
function stripPremiumEmoji(text: string): string {
  return text.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, "$1");
}

// Отправка с авто-фоллбэком: если Telegram отклонил сообщение
// (невалидный emoji-id или у владельца бота нет Premium),
// повторяем без премиум-эмодзи.
async function sendWithFallback(payload: Record<string, unknown>) {
  const res = await call("sendMessage", payload);
  if (!res.ok && typeof payload.text === "string" && payload.text.includes("<tg-emoji")) {
    return call("sendMessage", { ...payload, text: stripPremiumEmoji(payload.text) });
  }
  return res;
}

export async function sendMessage(
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return sendWithFallback({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

// Клавиатура с кнопкой "Поделиться контактом" для верификации номера
export async function sendContactRequest(chatId: number, text: string) {
  return sendWithFallback({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

export async function removeKeyboard(chatId: number, text: string) {
  return sendWithFallback({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });
}

export async function sendChatAction(chatId: number, action = "typing") {
  return call("sendChatAction", { chat_id: chatId, action });
}

// Российские номера: +7XXXXXXXXXX, 7XXXXXXXXXX или 8XXXXXXXXXX (11 цифр)
export function isRussianPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"));
}
