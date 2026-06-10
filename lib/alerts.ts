import { sendMessage } from "./telegram";
import { getAllChats } from "./store";

const ALERT_EMOJI = `<tg-emoji emoji-id="5264970043300524369">⚠️</tg-emoji>`;

export const ALERT_BPLA = `${ALERT_EMOJI} <b>ВНИМАНИЕ! БЕСПИЛОТНАЯ ОПАСНОСТЬ</b> ${ALERT_EMOJI}

<blockquote><b>На территории Татарстана объявлена угроза атаки БПЛА.</b>

🏠 Укройтесь в помещении, отойдите от окон
🚗 Не находитесь на открытых пространствах
📵 Не снимайте и не публикуйте работу ПВО
📻 Следите за официальными источниками</blockquote>

<i>Сохраняйте спокойствие. Отбой будет объявлен отдельным сообщением.</i>`;

export const ALERT_ROCKET = `${ALERT_EMOJI} <b>ВНИМАНИЕ! РАКЕТНАЯ ОПАСНОСТЬ</b> ${ALERT_EMOJI}

<blockquote><b>На территории Татарстана объявлена ракетная опасность.</b>

🏃 Немедленно пройдите в укрытие или подвал
🧱 Если укрытия нет — помещение без окон, несущие стены
🚗 Покиньте открытые пространства
📻 Следите за официальными источниками</blockquote>

<i>Сохраняйте спокойствие. Отбой будет объявлен отдельным сообщением.</i>`;

export const ALERT_CLEAR = `✅ <b>ОТБОЙ ТРЕВОГИ</b>

<blockquote>Угроза на территории Татарстана снята.
Можно вернуться к обычным делам.</blockquote>

<i>Берегите себя! 🤝</i>`;

export type AlertKind = "bpla" | "rocket" | "clear";

// Определяем тип тревоги по тексту поста канала-радара
export function classifyAlert(text: string): AlertKind | null {
  const t = text.toLowerCase();
  if (/отбо[йя]|отмен|миновал/.test(t)) return "clear";
  if (/беспилот|бпла|дрон|uav/.test(t)) return "bpla";
  if (/ракет/.test(t)) return "rocket";
  return null;
}

export function alertMessage(kind: AlertKind): string {
  if (kind === "bpla") return ALERT_BPLA;
  if (kind === "rocket") return ALERT_ROCKET;
  return ALERT_CLEAR;
}

export async function broadcast(text: string): Promise<number> {
  const chats = await getAllChats();
  let sent = 0;
  for (const id of chats) {
    try {
      await sendMessage(id, text);
      sent++;
    } catch {}
  }
  return sent;
}
