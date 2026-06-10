import { NextRequest, NextResponse } from "next/server";
import { classifyAlert, alertMessage, broadcast } from "@/lib/alerts";
import { kvGet, kvSet } from "@/lib/store";

export const maxDuration = 60;

// Мониторинг публичного канала-радара через веб-зеркало t.me/s/<канал>.
// Дёргать раз в минуту внешним кроном (cron-job.org):
//   GET /api/radar?key=<TELEGRAM_WEBHOOK_SECRET>
// Канал задаётся переменной RADAR_CHANNEL (имя без @).

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const channel = process.env.RADAR_CHANNEL;
  if (!channel) {
    return NextResponse.json({ ok: false, error: "RADAR_CHANNEL not set" });
  }

  const res = await fetch(`https://t.me/s/${channel}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `t.me returned ${res.status}` });
  }
  const html = await res.text();

  // Посты: data-post="канал/12345" ... текст в .tgme_widget_message_text
  const posts: { id: number; text: string }[] = [];
  const blockRe = new RegExp(
    `data-post="${channel}/(\\d+)"[\\s\\S]*?(?:<div class="tgme_widget_message_text[^"]*"[^>]*>([\\s\\S]*?)<\\/div>|<\\/div>\\s*<\\/div>)`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const text = (m[2] ?? "")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
    posts.push({ id: Number(m[1]), text });
  }
  if (posts.length === 0) {
    return NextResponse.json({ ok: true, info: "no posts parsed" });
  }

  const lastSeen = Number((await kvGet("radar:last")) ?? 0);
  const fresh = posts.filter((p) => p.id > lastSeen).sort((a, b) => a.id - b.id);

  // Первый запуск: просто запоминаем позицию, не рассылаем старое
  if (lastSeen === 0) {
    await kvSet("radar:last", String(posts[posts.length - 1].id));
    return NextResponse.json({ ok: true, info: "initialized" });
  }

  let broadcasts = 0;
  for (const p of fresh) {
    const kind = classifyAlert(p.text);
    if (kind) {
      await broadcast(alertMessage(kind));
      broadcasts++;
    }
  }
  if (fresh.length > 0) {
    await kvSet("radar:last", String(fresh[fresh.length - 1].id));
  }

  return NextResponse.json({ ok: true, newPosts: fresh.length, broadcasts });
}
