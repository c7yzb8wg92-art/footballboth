// Gemini AI client with Google Search grounding.
// Returns FRESH news from the live web in plain JSON.

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function buildPrompt(topic, count, today) {
  return `You are an elite football (soccer) news aggregator. Today is ${today}.

Use Google Search to find the LATEST and most RECENT REAL news about: ${topic}.
ONLY include news from the last 48 hours. Prioritize breaking, confirmed, and most impactful stories.

Return ONLY a valid raw JSON array (no markdown fences, no commentary) of EXACTLY ${count} news items. Each item must be:
{
  "title": string (concise headline, max 110 chars),
  "body": string (1-2 sentences with key facts),
  "tag": one of "Breaking" "Confirmed" "Rumor" "Official" "Record" "Award" "Matchday" "Champion" "Injury" "Result" "Transfer" "Draw",
  "source": real source name (e.g. "BBC Sport", "Fabrizio Romano", "Marca"),
  "emoji": single emoji that fits the story,
  "hoursAgo": number (0-48),
  "url": full URL to the source article if you can find one, else ""
}`;
}

function extractJsonArray(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return [];
}

export async function aiFetchNews({ apiKey, topic, count = 6 }) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(topic, count, today) }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('\n') ?? '';
  const raw = extractJsonArray(text);
  return raw.slice(0, count).map((r, i) => ({
    title: String(r.title ?? 'Untitled').slice(0, 160),
    body: String(r.body ?? '').slice(0, 400),
    tag: r.tag ?? 'Update',
    source: r.source ?? 'AI Wire',
    emoji: r.emoji ?? '⚽',
    hoursAgo: Math.max(0, Math.min(48, Number(r.hoursAgo) || i + 1)),
    url: r.url || '',
  }));
}

export async function aiAnswerQuestion({ apiKey, question }) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a football expert. Today is ${today}. Use Google Search to find current, accurate information.
Answer this football question concisely (max 4 short paragraphs, use emojis where helpful, never invent facts):

${question}`,
        }],
      }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return (
    data?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('\n').trim() ??
    "Sorry, I couldn't find an answer."
  );
}
