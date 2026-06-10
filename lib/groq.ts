import Groq from "groq-sdk";
import type { Lang } from "./store";

// Каскад моделей: если модель недоступна (кончился лимит, 429/5xx) —
// автоматически пробуем следующую. Первая в списке — основная.
type ModelCfg = {
  id: string;
  search: boolean;        // умеет ли искать в интернете
  browserTool?: boolean;  // нужен ли явный tools: browser_search (gpt-oss)
  hideReasoning?: boolean; // прятать <think> (qwen)
};

const MODELS: ModelCfg[] = [
  // агентная система Groq: веб-поиск и код встроены, ничего передавать не надо
  { id: "groq/compound", search: true },
  // gpt-oss: поиск через явный browser_search
  { id: "openai/gpt-oss-120b", search: true, browserTool: true },
  // запасные без поиска
  { id: "llama-3.3-70b-versatile", search: false },
  { id: "qwen/qwen3-32b", search: false, hideReasoning: true },
];

const LANG_RULES: Record<Lang, string> = {
  ru: "Отвечай на русском языке. Если пользователь пишет по-татарски — отвечай по-татарски.",
  tt: `Һәрвакыт саф татар телендә җавап бир (кириллица).
Татар теленең әдәби нормаларын сакла: дөрес аффикслар, сингармонизм,
татарча сүзләр кулланырга тырыш, русизмнардан кач.
Мисал өчен: "рәхмәт", "әйе", "юк", "бик яхшы", "сәлам".`,
  en: "Always reply in English.",
};

export function systemPrompt(lang: Lang, search: boolean): string {
  return `Ты AkylBot — AI-ассистент медиа "Тимур и команда" из Татарстана.
Знаешь культуру, историю, новости и жизнь Татарстана: Казань, татарский язык,
Сабантуй, эчпочмак и чак-чак, Тукай и Джалиль, КАМАЗ и Иннополис.
Отвечаешь кратко, живо, как друг — не как робот.

${LANG_RULES[lang]}

${search
  ? `Если вопрос про свежие новости, события, цены, погоду или факты,
которые могли измениться — используй поиск в интернете и отвечай
по актуальным данным.`
  : `У тебя НЕТ доступа в интернет. Если спрашивают про свежие новости
или события — честно скажи, что актуальных данных у тебя нет,
и предложи проверить официальные источники.`}

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

function buildParams(cfg: ModelCfg, messages: any[], stream: boolean): any {
  const params: any = {
    model: cfg.id,
    messages,
    max_tokens: 2048,
    temperature: 0.7,
  };
  if (stream) params.stream = true;
  if (cfg.hideReasoning) params.reasoning_format = "hidden";
  if (cfg.browserTool) {
    params.tools = [{ type: "browser_search" }];
    params.tool_choice = "auto";
  }
  return params;
}

async function tryStream(
  cfg: ModelCfg,
  messages: any[],
  onPartial: (text: string) => Promise<void>
): Promise<string> {
  const stream = await getClient().chat.completions.create(
    buildParams(cfg, messages, true)
  );

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

async function tryPlain(cfg: ModelCfg, messages: any[]): Promise<string> {
  const completion: any = await getClient().chat.completions.create(
    buildParams(cfg, messages, false)
  );
  return completion.choices?.[0]?.message?.content?.trim() ?? "";
}

// Каскад: для каждой модели пробуем стрим, затем без стрима;
// при любой ошибке (лимит, недоступность) переходим к следующей.
export async function askGroqStream(
  history: ChatMessage[],
  lang: Lang,
  onPartial: (text: string) => Promise<void>
): Promise<string> {
  for (const cfg of MODELS) {
    const messages = [
      { role: "system", content: systemPrompt(lang, cfg.search) },
      ...history,
    ];

    try {
      const r = await tryStream(cfg, messages, onPartial);
      if (r) return r;
    } catch (e) {
      console.error(`Groq stream failed (${cfg.id}):`, e);
    }

    try {
      const r = await tryPlain(cfg, messages);
      if (r) return r;
    } catch (e) {
      console.error(`Groq plain failed (${cfg.id}):`, e);
    }
  }

  return FAIL_TEXT;
}

// Диагностика для /debug: статус каждой модели каскада
export async function debugGroq(): Promise<string> {
  const report: string[] = [];
  report.push(
    `key: ${process.env.GROQ_API_KEY ? "задан (" + process.env.GROQ_API_KEY.slice(0, 7) + "...)" : "НЕ ЗАДАН!"}`
  );

  for (const cfg of MODELS) {
    const messages: any[] = [
      { role: "user", content: "Скажи одно слово: работаю" },
    ];
    try {
      const r = await tryPlain(cfg, messages);
      report.push(`${cfg.id}: OK — "${r.slice(0, 40)}"`);
    } catch (e: any) {
      report.push(
        `${cfg.id}: ОШИБКА — ${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 200)}`
      );
    }
  }

  return report.join("\n\n");
}
