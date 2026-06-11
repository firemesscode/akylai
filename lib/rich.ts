// Rich Messages (Bot API 10.1): отправка структурированного контента
// через sendRichMessage с GFM-markdown или HTML.
// Фоллбэк на обычный sendMessage если метод не поддерживается.

const API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Конвертирует HTML-ответ бота в GFM-markdown для Rich Messages
export function htmlToMarkdown(html: string): string {
  let t = html;
  // <b>text</b> → **text**
  t = t.replace(/<b>([\s\S]*?)<\/b>/g, "**$1**");
  // <i>text</i> → *text*
  t = t.replace(/<i>([\s\S]*?)<\/i>/g, "*$1*");
  // <code>text</code> → `text`
  t = t.replace(/<code>([\s\S]*?)<\/code>/g, "`$1`");
  // <pre>text</pre> → ```text```
  t = t.replace(/<pre>([\s\S]*?)<\/pre>/g, "```\n$1\n```");
  // <blockquote>text</blockquote> → > text
  t = t.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, inner) =>
    inner.trim().split("\n").map((l: string) => `> ${l}`).join("\n")
  );
  // Убираем оставшиеся HTML-теги
  t = t.replace(/<[^>]+>/g, "");
  return t.trim();
}

// Отправка rich-сообщения через Bot API 10.1 sendRichMessage.
// Принимает готовый HTML-ответ, конвертирует в markdown.
// Возвращает true если успешно.
export async function sendRichMessage(
  chatId: number,
  content: string
): Promise<boolean> {
  const markdown = htmlToMarkdown(content);
  try {
    const res = await fetch(`${API()}/sendRichMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        content: {
          type: "markdown",
          text: markdown,
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      // Если метод не поддерживается (старый сервер / не 10.1) — тихо фоллбэк
      if (!err.includes("unknown")) {
        console.error("sendRichMessage failed:", err);
      }
    }
    return res.ok;
  } catch {
    return false;
  }
}

// Стриминг rich-черновика (sendRichMessageDraft из Bot API 10.1)
export async function sendRichMessageDraft(
  chatId: number,
  draftId: number,
  content: string
): Promise<boolean> {
  const markdown = htmlToMarkdown(content);
  try {
    const res = await fetch(`${API()}/sendRichMessageDraft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        draft_id: draftId,
        content: {
          type: "markdown",
          text: markdown,
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
