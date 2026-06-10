import type { ChatMessage } from "./groq";

// In-memory хранилище. На Vercel serverless оно живёт пока тёплый инстанс
// (минуты), при холодном старте сбрасывается — пользователя попросят
// верифицироваться заново. Для продакшена заменить на Vercel KV / Upstash.

const MAX_HISTORY = 10;

const verified = new Set<number>();
const histories = new Map<number, ChatMessage[]>();

export function isVerified(userId: number): boolean {
  return verified.has(userId);
}

export function markVerified(userId: number) {
  verified.add(userId);
}

export function getHistory(chatId: number): ChatMessage[] {
  return histories.get(chatId) ?? [];
}

export function pushHistory(chatId: number, msg: ChatMessage) {
  const h = histories.get(chatId) ?? [];
  h.push(msg);
  // максимум 10 сообщений для экономии токенов
  while (h.length > MAX_HISTORY) h.shift();
  histories.set(chatId, h);
}
