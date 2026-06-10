import Groq from "groq-sdk";
import type { Lang } from "./store";

// gpt-oss-120b: reasoning + встроенный browser_search (поиск в интернете)
const MODEL = "openai/gpt-oss-120b";

const LANG_RULES: Record<Lang, string> = {
  ru: "Отвечай на русском языке. Если пользователь пишет по-татарски — отвечай по-татарски.",
  tt: `Һәрвакыт саф татар телендә җавап бир (кириллица).
Татар теленең әдәби нормаларын сакла: дөрес аффикслар, сингармонизм,
татарча сүзләр кулланырга тырыш, русизмнардан кач.
Мисал өчен: "рәхмәт", "әйе", "юк", "бик яхшы", "сәлам".`,
  en: "Always reply in English.",
};

export function systemPrompt(lang: Lang): string {
  return `Ты AkylBot — AI-ассистент медиа "Тимур и команда" из Татарстана.
Знаешь культуру, историю, новости и жизнь Татарстана: Казань, татарский язык,
Сабантуй, эчпочмак и чак-чак, Тукай и Джалиль, КАМАЗ и Иннополис.
Отвечаешь кратко, живо, как друг — не как робот.

${LANG_RULES[lang]}

Если вопрос про свежие новости, события, цены, погоду или факты,
которые могли измениться — используй поиск в интернете и отвечай
по актуальным данным.

ФОРМАТ ОТВЕТА — строго обычный текст:
- НЕ используй markdown: никаких **, __, ##, \`\`\` и списков через * или -.
- Для списков используй эмодзи или просто новые строки.
- Не вставляй сырые URL без необходимости.`;
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

let client: Groq | null = null;

function getClient(): Groq {
  if (!client) {
    client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return client;
}

// Стриминг: onPartial вызывается по мере прихода текста,
// возвращается полный ответ.
export async function askGroqStream(
  history: ChatMessage[],
  lang: Lang,
  onPartial: (text: string) => Promise<void>
): Promise<string> {
  const stream = await getClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: systemPrompt(lang) }, ...history],
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
    // Встроенный серверный инструмент Groq: модель сама решает,
    // когда искать в интернете.
    tools: [{ type: "browser_search" } as any],
    tool_choice: "auto",
  } as any);

  let full = "";
  let lastSent = 0;
  let lastTime = Date.now();

  for await (const chunk of stream as any) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      full += delta;
      const now = Date.now();
      // Плавное дописывание: редактируем сообщение не чаще раза в ~1.5 сек
      // и только если накопилось заметно нового текста (лимиты Telegram).
      if (now - lastTime > 1500 && full.length - lastSent > 60) {
        lastTime = now;
        lastSent = full.length;
        await onPartial(full);
      }
    }
  }

  return full.trim() || "Кичерегез! Что-то пошло не так, попробуй ещё раз 🙏";
}
