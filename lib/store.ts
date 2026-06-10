import type { ChatMessage } from "./groq";

// Хранилище: Upstash Redis (если заданы UPSTASH_REDIS_REST_URL/TOKEN) —
// тогда верификация, язык и история переживают холодные старты Vercel.
// Без Redis — фоллбэк на in-memory (сбрасывается при холодном старте).

export type Lang = "ru" | "tt" | "en";

const MAX_HISTORY = 10;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const hasRedis = Boolean(REDIS_URL && REDIS_TOKEN);

async function redis(cmd: (string | number)[]): Promise<any> {
  const res = await fetch(REDIS_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) {
    console.error("Redis error:", await res.text());
    return null;
  }
  const data = await res.json();
  return data.result;
}

// --- in-memory фоллбэк ---
const memVerified = new Set<number>();
const memLang = new Map<number, Lang>();
const memHistories = new Map<number, ChatMessage[]>();
const memChats = new Set<number>();

// Реестр чатов для рассылки оповещений (тревога БПЛА/ракетная)
export async function registerChat(chatId: number): Promise<void> {
  if (hasRedis) {
    await redis(["SADD", "chats", String(chatId)]);
    return;
  }
  memChats.add(chatId);
}

// Универсальные get/set (например, id последнего поста канала-радара)
const memKv = new Map<string, string>();

export async function kvGet(key: string): Promise<string | null> {
  if (hasRedis) {
    const v = await redis(["GET", key]);
    return typeof v === "string" ? v : null;
  }
  return memKv.get(key) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (hasRedis) {
    await redis(["SET", key, value]);
    return;
  }
  memKv.set(key, value);
}

export async function getAllChats(): Promise<number[]> {
  if (hasRedis) {
    const res = await redis(["SMEMBERS", "chats"]);
    return Array.isArray(res) ? res.map(Number) : [];
  }
  return [...memChats];
}

export async function isVerified(userId: number): Promise<boolean> {
  if (hasRedis) return (await redis(["GET", `verified:${userId}`])) === "1";
  return memVerified.has(userId);
}

export async function markVerified(userId: number): Promise<void> {
  if (hasRedis) {
    await redis(["SET", `verified:${userId}`, "1"]);
    return;
  }
  memVerified.add(userId);
}

export async function getLang(chatId: number): Promise<Lang> {
  if (hasRedis) {
    const v = await redis(["GET", `lang:${chatId}`]);
    if (v === "ru" || v === "tt" || v === "en") return v;
    return "ru";
  }
  return memLang.get(chatId) ?? "ru";
}

export async function setLang(chatId: number, lang: Lang): Promise<void> {
  if (hasRedis) {
    await redis(["SET", `lang:${chatId}`, lang]);
    return;
  }
  memLang.set(chatId, lang);
}

export async function getHistory(chatId: number): Promise<ChatMessage[]> {
  if (hasRedis) {
    const raw = await redis(["GET", `hist:${chatId}`]);
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as ChatMessage[];
      } catch {}
    }
    return [];
  }
  return memHistories.get(chatId) ?? [];
}

export async function pushHistory(chatId: number, msg: ChatMessage): Promise<void> {
  const h = await getHistory(chatId);
  h.push(msg);
  // максимум 10 сообщений для экономии токенов
  while (h.length > MAX_HISTORY) h.shift();
  if (hasRedis) {
    await redis(["SET", `hist:${chatId}`, JSON.stringify(h)]);
    return;
  }
  memHistories.set(chatId, h);
}
