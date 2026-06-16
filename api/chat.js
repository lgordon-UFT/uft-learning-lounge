// POST /api/chat
// Body: { messages: [{ role: 'user'|'assistant', content }] }
// Multi-turn conversation for the "Lounge Assistant" chat widget, powered by Groq.

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROK_API_KEY;

const SYSTEM_PROMPT = `You are the "Lounge Assistant" (nickname: Pix), the friendly AI guide
for the UFT Learning Lounge — a professional-learning community for United Federation of
Teachers (UFT) staff learning to use AI at work. The Learning Lounge runs an AI workshop series:
  • Session 1 — Anatomy of a Prompt (LLM basics + the Role/Context/Task/Format framework)
  • Session 2 — AI Personas (reusable personas for your UFT role)
  • Session 3 — The Prompt Ladder (a gamified prompting challenge)

You chat conversationally. Be warm, concise, and practical, for a smart non-technical audience.
Use short paragraphs or tight bullet lists. Give concrete, UFT-flavored examples when helpful.
Never invent specific UFT policy, benefits, or contract details — if a question needs that, say
so and suggest the visitor email Sade Strickland (Assistant to the UFT VP of CTE) at
sstrickland@uft.org. Never tell anyone to paste confidential member data into a public AI tool.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!GROQ_API_KEY) {
    return res.status(200).json({ reply: null, configured: false });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (!messages.length) {
    return res.status(400).json({ error: 'No message provided.' });
  }

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.6,
        max_completion_tokens: 700,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('[chat] Groq error:', r.status, t.slice(0, 200));
      return res.status(502).json({ error: 'The AI service returned an error.' });
    }
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    return res.status(200).json({ reply: reply || 'Sorry — I didn’t catch that. Could you rephrase?', configured: true });
  } catch (err) {
    console.error('[chat] error:', err.message);
    return res.status(502).json({ error: 'The AI service is unavailable right now.' });
  }
}
