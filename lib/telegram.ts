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

// Отправляет сообщение и возвращает его message_id (для последующих edit)
export async function sendMessageReturnId(
  chatId: number,
  text: string
): Promise<number | null> {
  const res = await sendWithFallback({ chat_id: chatId, text, parse_mode: "HTML" });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.result?.message_id ?? null;
}

// Редактирование сообщения (для плавного дописывания ответа).
// При ошибке HTML-парсинга повторяет без parse_mode.
export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  html = false
) {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };
  if (html) payload.parse_mode = "HTML";
  const res = await call("editMessageText", payload);
  if (!res.ok && html) {
    return call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.replace(/<[^>]+>/g, ""),
    });
  }
  return res;
}

// Реакция бота на сообщение пользователя (👍 🔥 ❤️ и т.д.)
export async function setReaction(chatId: number, messageId: number, emoji: string) {
  return call("setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }],
  });
}

// Фото по file_id с подписью (caption до 1024 символов)
export async function sendPhoto(
  chatId: number,
  photo: string,
  caption?: string
) {
  return call("sendPhoto", {
    chat_id: chatId,
    photo,
    ...(caption ? { caption: caption.slice(0, 1024), parse_mode: "HTML" } : {}),
  });
}

export async function deleteMessage(chatId: number, messageId: number) {
  return call("deleteMessage", { chat_id: chatId, message_id: messageId });
}

export async function answerCallback(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

// Конвертация markdown от LLM в HTML Telegram:
// сначала экранируем HTML, затем **bold**, `code`, заголовки.
export function mdToHtml(s: string): string {
  // Убираем цифровые сноски [1], [2][3] и т.д. (артефакты Tavily/поиска)
  let t = s.replace(/\[\d+\]/g, "");
  t = t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  t = t.replace(/```[\w]*\n?([\s\S]+?)```/g, "<pre>$1</pre>");
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  t = t.replace(/__(.+?)__/g, "<i>$1</i>");
  t = t.replace(/^#{1,6}\s*(.+)$/gm, "<b>$1</b>");
  return t;
}

// Российские номера: +7XXXXXXXXXX, 7XXXXXXXXXX или 8XXXXXXXXXX (11 цифр)
export function isRussianPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"));
}
