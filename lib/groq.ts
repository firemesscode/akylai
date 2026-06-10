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

const FAIL_TEXT = "Кичерегез! Что-то пошло не так, попробуй ещё раз 🙏";

async function tryStream(
  messages: any[],
  withTools: boolean,
  onPartial: (text: string) => Promise<void>
): Promise<string> {
  const params: any = {
    model: MODEL,
    messages,
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
  };
  if (withTools) {
    params.tools = [{ type: "browser_search" }];
    params.tool_choice = "auto";
  }
  const stream = await getClient().chat.completions.create(params);

  let full = "";
  let lastSent = 0;
  let lastTime = Date.now();

  for await (const chunk of stream as any) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      full += delta;
      const now = Date.now();
      // Плавное дописывание: не чаще раза в ~1.5 сек (лимиты Telegram)
      if (now - lastTime > 1500 && full.length - lastSent > 60) {
        lastTime = now;
        lastSent = full.length;
        await onPartial(full);
      }
    }
  }
  return full.trim();
}

async function tryPlain(messages: any[], withTools: boolean): Promise<string> {
  const params: any = {
    model: MODEL,
    messages,
    max_tokens: 2048,
    temperature: 0.7,
  };
  if (withTools) {
    params.tools = [{ type: "browser_search" }];
    params.tool_choice = "auto";
  }
  const completion: any = await getClient().chat.completions.create(params);
  return completion.choices?.[0]?.message?.content?.trim() ?? "";
}

// Диагностика для /debug: пробует все три варианта и возвращает отчёт
export async function debugGroq(): Promise<string> {
  const messages: any[] = [
    { role: "user", content: "Скажи одно слово: работаю" },
  ];
  const report: string[] = [];
  report.push(`key: ${process.env.GROQ_API_KEY ? "задан (" + process.env.GROQ_API_KEY.slice(0, 7) + "...)" : "НЕ ЗАДАН!"}`);
  report.push(`model: ${MODEL}`);

  try {
    const r = await tryPlain(messages, false);
    report.push(`без поиска: OK — "${r.slice(0, 50)}"`);
  } catch (e: any) {
    report.push(`без поиска: ОШИБКА — ${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 300)}`);
  }

  try {
    const r = await tryPlain(messages, true);
    report.push(`с поиском: OK — "${r.slice(0, 50)}"`);
  } catch (e: any) {
    report.push(`с поиском: ОШИБКА — ${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 300)}`);
  }

  try {
    const r = await tryStream(messages, true, async () => {});
    report.push(`стрим+поиск: OK — "${r.slice(0, 50)}"`);
  } catch (e: any) {
    report.push(`стрим+поиск: ОШИБКА — ${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 300)}`);
  }

  return report.join("\n\n");
}

// Цепочка фоллбэков: стрим с поиском → без стрима с поиском →
// без поиска. Что-то из этого должно ответить.
export async function askGroqStream(
  history: ChatMessage[],
  lang: Lang,
  onPartial: (text: string) => Promise<void>
): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt(lang) },
    ...history,
  ];

  try {
    const r = await tryStream(messages, true, onPartial);
    if (r) return r;
  } catch (e) {
    console.error("Groq stream+tools failed:", e);
  }

  try {
    const r = await tryPlain(messages, true);
    if (r) return r;
  } catch (e) {
    console.error("Groq plain+tools failed:", e);
  }

  try {
    const r = await tryPlain(messages, false);
    if (r) return r;
  } catch (e) {
    console.error("Groq plain failed:", e);
  }

  return FAIL_TEXT;
}
