// Tavily AI Search — бесплатно 1000 запросов/мес, без карты.
// Ключ: app.tavily.com → Sign Up → API Keys

const TAVILY_URL = "https://api.tavily.com/search";

export type SearchResult = {
  title: string;
  content: string;
  url: string;
};

export async function webSearch(query: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map((r: any) => ({
      title: r.title ?? "",
      content: (r.content ?? "").slice(0, 400),
      url: r.url ?? "",
    }));
  } catch {
    return [];
  }
}

// Ключевые слова, сигнализирующие что пользователь хочет свежую инфу
const SEARCH_RE =
  /новост|сводк|что нового|что случил|что происходит|сегодня|вчера|сейчас|обстановк|погод|цен[аыу]|курс|события|последн|актуальн|news|хәбәр|яңалык|бүген|хәзер/i;

export function needsSearch(text: string): boolean {
  return SEARCH_RE.test(text);
}

export function formatResults(results: SearchResult[]): string {
  if (!results.length) return "";
  return (
    "Свежие данные из интернета:\n\n" +
    results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
      .join("\n\n")
  );
}
