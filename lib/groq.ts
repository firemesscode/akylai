import Groq from "groq-sdk";

const MODEL = "llama-3.3-70b-versatile";

export const SYSTEM_PROMPT = `Ты AkylBot — AI-ассистент медиа "Тимур и команда" из Татарстана.
Отвечаешь на русском и татарском языках.
Знаешь культуру, историю, новости и жизнь Татарстана.
Отвечаешь кратко, живо, как друг — не как робот.`;

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
    max_tokens: 1024,
    temperature: 0.7,
  });

  return (
    completion.choices[0]?.message?.content?.trim() ||
    "Кичерегез! Что-то пошло не так, попробуй ещё раз 🙏"
  );
}
