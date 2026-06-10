import Groq from "groq-sdk";

// gpt-oss-120b: reasoning + встроенный browser_search (поиск в интернете)
const MODEL = "openai/gpt-oss-120b";

export const SYSTEM_PROMPT = `Ты AkylBot — AI-ассистент медиа "Тимур и команда" из Татарстана.
Отвечаешь на русском и татарском языках.
Знаешь культуру, историю, новости и жизнь Татарстана.
Отвечаешь кратко, живо, как друг — не как робот.
Если вопрос про свежие новости, события, цены, погоду или факты,
которые могли измениться — используй поиск в интернете и отвечай
по актуальным данным. Не вставляй в ответ сырые ссылки без необходимости.`;

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

export async function askGroq(history: ChatMessage[]): Promise<string> {
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
    max_tokens: 2048,
    temperature: 0.7,
    // Встроенный серверный инструмент Groq: модель сама решает,
    // когда искать в интернете (tool_choice: "auto").
    tools: [{ type: "browser_search" } as any],
    tool_choice: "auto",
  } as any);

  return (
    completion.choices[0]?.message?.content?.trim() ||
    "Кичерегез! Что-то пошло не так, попробуй ещё раз 🙏"
  );
}
