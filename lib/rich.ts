// Rich Messages (Bot API 10.1): структурированные сообщения —
// секции, параграфы, списки, разделители, футер.
// Если sendRichMessage недоступен (сервер старее 10.1) — вызывающий
// код должен фоллбэкнуться на обычный sendMessage (HTML).

const API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

type RichText =
  | { type: "plain"; text: string }
  | { type: "bold"; text: RichText }
  | { type: "italic"; text: RichText }
  | { type: "custom_emoji"; emoji_id: string; text: RichText }
  | RichText[];

type RichBlock =
  | { type: "section_heading"; text: RichText }
  | { type: "paragraph"; text: RichText }
  | { type: "divider" }
  | { type: "footer"; text: RichText }
  | {
      type: "list";
      ordered?: boolean;
      items: { blocks: RichBlock[] }[];
    };

const plain = (text: string): RichText => ({ type: "plain", text });
const bold = (text: string): RichText => ({ type: "bold", text: plain(text) });
const italic = (text: string): RichText => ({ type: "italic", text: plain(text) });

// Конвертирует ответ модели (HTML-теги <b>/<i> + абзацы) в rich-блоки.
// Строка-заголовок (<b>...</b> отдельной строкой) → section_heading,
// последняя курсивная строка → footer, остальное → paragraph.
export function answerToRichBlocks(answer: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const paragraphs = answer.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  paragraphs.forEach((para, idx) => {
    const headingMatch = para.match(/^<b>(.+?)<\/b>$/s);
    const footerMatch = para.match(/^<i>(.+?)<\/i>$/s);

    if (headingMatch && !headingMatch[1].includes("\n")) {
      blocks.push({ type: "section_heading", text: bold(stripTags(headingMatch[1])) });
      return;
    }
    if (footerMatch && idx === paragraphs.length - 1) {
      blocks.push({ type: "divider" });
      blocks.push({ type: "footer", text: italic(stripTags(footerMatch[1])) });
      return;
    }
    blocks.push({ type: "paragraph", text: htmlToRichText(para) });
  });

  return blocks;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

// Разбирает <b>/<i> внутри абзаца в массив RichText
function htmlToRichText(s: string): RichText {
  const parts: RichText[] = [];
  const re = /<(b|i)>(.*?)<\/\1>/gs;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(plain(stripTags(s.slice(last, m.index))));
    parts.push(m[1] === "b" ? bold(stripTags(m[2])) : italic(stripTags(m[2])));
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(plain(stripTags(s.slice(last))));
  return parts.length === 1 ? parts[0] : parts;
}

// Отправка rich-сообщения; true — если сервер поддерживает и приняло
export async function sendRichMessage(
  chatId: number,
  blocks: RichBlock[]
): Promise<boolean> {
  try {
    const res = await fetch(`${API()}/sendRichMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        rich_message: { blocks },
      }),
    });
    if (!res.ok) {
      console.error("sendRichMessage failed:", await res.text());
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
  blocks: RichBlock[]
): Promise<boolean> {
  try {
    const res = await fetch(`${API()}/sendRichMessageDraft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        draft_id: draftId,
        rich_message: { blocks },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
