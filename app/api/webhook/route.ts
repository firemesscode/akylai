import { NextRequest, NextResponse } from "next/server";
import { askGroqStream } from "@/lib/groq";
import {
  sendMessage,
  sendContactRequest,
  removeKeyboard,
  sendChatAction,
  sendMessageReturnId,
  editMessage,
  setReaction,
  answerCallback,
  sendPhoto,
  mdToHtml,
  isRussianPhone,
} from "@/lib/telegram";
import {
  isVerified,
  markVerified,
  getHistory,
  pushHistory,
  getLang,
  setLang,
  registerChat,
  kvGet,
  kvSet,
  type Lang,
} from "@/lib/store";
import { ALERT_BPLA, ALERT_ROCKET, ALERT_CLEAR, broadcast } from "@/lib/alerts";

export const maxDuration = 60;

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

Расскажу отвечу обо всем из этого списка, задай вопрос...${E.tea}

⚙️ Язык ответов: /settings`;

const ASK_CONTACT = `${E.hello} <b>Привет!</b>

${E.lock} Перед входом — быстрая проверка.
Нажми кнопку ниже, чтобы поделиться номером.

<blockquote>Доступ открыт для российских номеров (+7).
Контакт используется только для верификации.</blockquote>`;

// Плейсхолдер «отвечаю» на языке пользователя
const TYPING: Record<Lang, string> = {
  ru: "✍️ Отвечаю...",
  tt: "✍️ Җавап язам...",
  en: "✍️ Typing...",
};

const LANG_SAVED: Record<Lang, string> = {
  ru: "✅ Готово! Теперь отвечаю на русском.",
  tt: "✅ Булды! Хәзер татарча җавап бирәм.",
  en: "✅ Done! I'll reply in English now.",
};

// Реакции, которые бот может ставить на сообщения пользователя
const REACTIONS = ["👍", "🔥", "❤️", "🤝", "😁"];

function isAdmin(userId: number): boolean {
  // user_id владельца бота; можно переопределить через TELEGRAM_ADMIN_ID
  const admin = process.env.TELEGRAM_ADMIN_ID || "1570654259";
  return String(userId) === admin;
}

function handle(update: any): Promise<void> {
  return processUpdate(update).catch((e) => {
    console.error("Update processing error:", e);
  });
}

async function processUpdate(update: any) {
  // Нажатие inline-кнопки (настройки языка)
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

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
      await markVerified(userId);
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
  if (!(await isVerified(userId))) {
    await sendContactRequest(chatId, ASK_CONTACT);
    return;
  }

  // Регистрируем чат для рассылки оповещений
  registerChat(chatId).catch(() => {});

  // Админ прислал фото с подписью /setnewsphoto — сохраняем file_id,
  // эта картинка будет прикрепляться к новостным ответам
  if (message.photo && isAdmin(userId)) {
    if ((message.caption ?? "").trim() === "/setnewsphoto") {
      const best = message.photo[message.photo.length - 1];
      await kvSet("news_photo", best.file_id);
      await sendMessage(chatId, "🖼 Готово! Эта картинка будет у новостных ответов.");
      return;
    }
  }

  // 3. Обычный текст
  const text: string | undefined = message.text;
  if (!text) return;

  // Команды оповещения — только для админа (TELEGRAM_ADMIN_ID)
  if (text.startsWith("/alert") && isAdmin(userId)) {
    let payload = "";
    if (text === "/alert_bpla") payload = ALERT_BPLA;
    else if (text === "/alert_rocket") payload = ALERT_ROCKET;
    else if (text === "/alert_clear") payload = ALERT_CLEAR;
    else {
      await sendMessage(
        chatId,
        `Команды оповещения:
/alert_bpla — 🛸 беспилотная опасность
/alert_rocket — 🚀 ракетная опасность
/alert_clear — ✅ отбой тревоги`
      );
      return;
    }
    const sent = await broadcast(payload);
    await sendMessage(chatId, `📢 Оповещение отправлено: ${sent} чат(ов).`);
    return;
  }

  if (text === "/start") {
    await sendMessage(chatId, WELCOME(message.from.first_name ?? "дус"));
    return;
  }

  if (text === "/settings") {
    await sendMessage(chatId, "⚙️ <b>Настройки</b>\n\nНа каком языке отвечать?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🇷🇺 Русский", callback_data: "lang:ru" },
            { text: "🌙 Татарча", callback_data: "lang:tt" },
            { text: "🇬🇧 English", callback_data: "lang:en" },
          ],
        ],
      },
    });
    return;
  }

  const lang = await getLang(chatId);

  // Запрос похож на новости/сводку — прикрепляем новостную картинку
  if (/новост|сводк|что нового|что происходит|news|хәбәр|яңалык/i.test(text)) {
    const photoId = await kvGet("news_photo");
    if (photoId) {
      await sendPhoto(chatId, photoId);
    }
  }

  // Иногда бот реагирует на сообщение эмодзи (не блокируем основной поток)
  if (Math.random() < 0.3 && message.message_id) {
    setReaction(
      chatId,
      message.message_id,
      REACTIONS[Math.floor(Math.random() * REACTIONS.length)]
    ).catch(() => {});
  }

  // Мгновенный плейсхолдер, затем плавное дописывание через editMessageText
  await sendChatAction(chatId);
  const placeholderId = await sendMessageReturnId(chatId, TYPING[lang]);

  await pushHistory(chatId, { role: "user", content: text });
  const history = await getHistory(chatId);

  const answer = await askGroqStream(history, lang, async (partial) => {
    if (placeholderId) {
      // Промежуточные версии шлём без HTML (текст ещё может быть оборван)
      await editMessage(chatId, placeholderId, partial + " ▌");
    }
  });

  await pushHistory(chatId, { role: "assistant", content: answer });

  // Финальная версия: markdown от модели конвертируем в HTML
  const pretty = mdToHtml(answer);
  if (placeholderId) {
    await editMessage(chatId, placeholderId, pretty, true);
  } else {
    await sendMessage(chatId, pretty);
  }
}

async function handleCallback(cq: any) {
  const data: string = cq.data ?? "";
  const chatId: number | undefined = cq.message?.chat?.id;
  const messageId: number | undefined = cq.message?.message_id;

  if (data.startsWith("lang:") && chatId) {
    const lang = data.slice(5) as Lang;
    if (lang === "ru" || lang === "tt" || lang === "en") {
      await setLang(chatId, lang);
      await answerCallback(cq.id);
      if (messageId) {
        await editMessage(chatId, messageId, LANG_SAVED[lang]);
      }
      return;
    }
  }
  await answerCallback(cq.id);
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
