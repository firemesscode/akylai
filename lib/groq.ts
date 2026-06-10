import type { Lang } from "./store";
import { webSearch, needsSearch, formatResults } from "./search";

// OpenRouter — один API-ключ, 28+ бесплатных моделей, автопереключение.
// Ключ: openrouter.ai → Keys → Create Key (карта не нужна).
// Переменная: OPENROUTER_API_KEY (добавить в Vercel).
//
// Каскад: при 429/5xx автоматически переходим к следующей модели.
// :free — суффикс бесплатных моделей на OpenRouter.

const OR_BASE = "https://openrouter.ai/api/v1/chat/completions";

type ModelCfg = {
  id: string;
  search: boolean;
};

const MODELS: ModelCfg[] = [
  // Авторотатор OpenRouter — сам выбирает лучшую доступную бесплатную модель
  { id: "openrouter/auto", search: false },
  // Конкретные бесплатные модели — запасные, если авторотатор недоступен
  { id: "deepseek/deepseek-r1:free", search: false },
  { id: "meta-llama/llama-3.3-70b-instruct:free", search: false },
  { id: "qwen/qwen3-235b-a22b:free", search: false },
  { id: "google/gemini-2.0-flash-exp:free", search: false },
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

ИДЕНТИЧНОСТЬ:
- Ты AkylBot. Никогда не называй себя другим именем, не упоминай модель,
  компанию или технологию, на которой работаешь (не пиши "я Google", "я Llama",
  "я DeepSeek", "я языковая модель" и т.п.).
- Если спросят кто ты или на чём работаешь — говори просто: "Я AkylBot 🤖"
  и переводи тему обратно к Татарстану.

ФОРМАТ ОТВЕТА — строго обычный текст:
- НЕ используй markdown: никаких **, __, ##, \`\`\` и списков через * или -.
- Для списков используй эмодзи или просто новые строки.
- Не вставляй сырые URL без необходимости.`;
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const FAIL_TEXT = "Кичерегез! Что-то пошло не так, попробуй ещё раз 🙏";

function apiKey(): string {
  return process.env.OPENROUTER_API_KEY ?? "";
}

async function callOR(
  cfg: ModelCfg,
  messages: any[],
  stream: boolean
): Promise<Response> {
  return fetch(OR_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      "HTTP-Referer": "https://akylbot.vercel.app",
      "X-Title": "AkylBot",
    },
    body: JSON.stringify({
      model: cfg.id,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
      stream,
    }),
  });
}

async function tryStream(
  cfg: ModelCfg,
  messages: any[],
  onPartial: (text: string) => Promise<void>
): Promise<string> {
  const res = await callOR(cfg, messages, true);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let lastSent = 0;
  let lastTime = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") break;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
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
      } catch {}
    }
  }
  return full.trim();
}

async function tryPlain(cfg: ModelCfg, messages: any[]): Promise<string> {
  const res = await callOR(cfg, messages, false);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

// Каскад: для каждой модели пробуем стрим, затем без стрима;
// при любой ошибке (лимит, недоступность) переходим к следующей.
export async function askGroqStream(
  history: ChatMessage[],
  lang: Lang,
  onPartial: (text: string) => Promise<void>
): Promise<string> {
  // Если вопрос про свежие события — ищем через Tavily и добавляем в контекст
  const lastUserMsg = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  let searchSnippet = "";
  if (needsSearch(lastUserMsg)) {
    const results = await webSearch(lastUserMsg);
    searchSnippet = formatResults(results);
  }

  for (const cfg of MODELS) {
    const sysContent = systemPrompt(lang, !!searchSnippet || cfg.search) +
      (searchSnippet ? `\n\n${searchSnippet}` : "");
    const messages = [
      { role: "system", content: sysContent },
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

// Диагностика для /debug: статус ключа и каждой модели каскада
export async function debugGroq(): Promise<string> {
  const key = apiKey();
  const report: string[] = [];
  report.push(`key: ${key ? "задан (" + key.slice(0, 8) + "...)" : "НЕ ЗАДАН!"}`);
  report.push(`сервис: OpenRouter`);

  const test = [{ role: "user", content: "Скажи одно слово: работаю" }];
  for (const cfg of MODELS) {
    try {
      const r = await tryPlain(cfg, test);
      report.push(`${cfg.id}: ✅ "${r.slice(0, 40)}"`);
    } catch (e: any) {
      report.push(`${cfg.id}: ❌ ${String(e?.message ?? e).slice(0, 150)}`);
    }
  }
  return report.join("\n\n");
}
