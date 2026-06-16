// POST /api/ask
// Body: { name?, email?, question }
// 1) Generates an answer with Groq   2) Stores the Q&A in Postgres via Prisma
// 3) Emails the answer to the asker + a copy to the admin via Resend
//
// Every step degrades gracefully: if a given service's env var is missing,
// that step is skipped and the rest still runs. The page stays usable before
// any keys are configured.

import { prisma } from '../lib/prisma.js';
import { Resend } from 'resend';

// Accept either spelling — Groq (correct) or a GROK_ typo — to be forgiving.
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROK_API_KEY;

const SYSTEM_PROMPT = `You are "Lounge Assistant", the friendly AI helper for the UFT Learning Lounge —
a professional-learning community for United Federation of Teachers (UFT) staff who are
learning to use AI at work. The Learning Lounge runs a short AI workshop series:
  • Session 1 — Anatomy of a Prompt (LLM basics + the Role/Context/Task/Format framework)
  • Session 2 — AI Personas (reusable personas for your UFT role)
  • Session 3 — The Prompt Ladder (a gamified prompting challenge)

Answer questions about AI, prompting, personas, and the workshop content. Be warm, clear,
and practical. Write for a smart non-technical audience (UFT staff across many departments).
Keep answers concise — a few short paragraphs or a tight bullet list. Use plain language,
give a concrete UFT-flavored example when helpful, and never invent UFT policy details —
if asked something only UFT staff can answer, say so and suggest they contact their office.
Never tell anyone to paste confidential member data into a public AI tool.`;

// Groq — OpenAI-compatible chat completions API (https://console.groq.com/docs)
async function askGroq(question) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
      temperature: 0.5,
      max_completion_tokens: 800,
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Groq ${r.status}: ${body.slice(0, 300)}`);
  }
  const data = await r.json();
  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('Groq returned an empty answer.');
  return answer;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Vercel parses JSON bodies automatically; guard for safety.
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const name = (body.name || '').toString().trim().slice(0, 120);
  const email = (body.email || '').toString().trim().slice(0, 200);
  const question = (body.question || '').toString().trim().slice(0, 2000);

  if (question.length < 3) {
    return res.status(400).json({ error: 'Please enter a question (at least a few characters).' });
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address doesn’t look right.' });
  }

  const hasGroq = !!GROQ_API_KEY;
  const hasDb = !!process.env.DATABASE_URL;
  const hasResend = !!process.env.RESEND_API_KEY;

  // 1) Answer with Groq
  let answer = null;
  let aiConfigured = hasGroq;
  if (hasGroq) {
    try {
      answer = await askGroq(question);
    } catch (err) {
      console.error('[ask] Groq error:', err.message);
      aiConfigured = false;
    }
  }
  if (!answer) {
    answer =
      'Thanks for your question! AI answers aren’t switched on yet, but your question ' +
      'has been received and a UFT colleague will follow up. Check back soon.';
  }

  // 2) Store via Prisma
  let stored = false;
  if (hasDb) {
    try {
      await prisma.communityQuestion.create({
        data: {
          name: name || null,
          email: email || null,
          question,
          answer,
          aiAnswered: aiConfigured,
        },
      });
      stored = true;
    } catch (err) {
      console.error('[ask] Prisma error:', err.message);
    }
  }

  // 3) Email via Resend
  if (hasResend) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.FROM_EMAIL || 'UFT Learning Lounge <onboarding@resend.dev>';
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#22201c">
          <h2 style="color:#002855">UFT Learning Lounge</h2>
          <p style="color:#7a776c;margin:0 0 16px">Your question to the Question Café:</p>
          <blockquote style="border-left:3px solid #b8920e;margin:0 0 18px;padding:4px 16px;color:#22201c">${escapeHtml(
            question
          )}</blockquote>
          <p style="font-weight:700;color:#002855">Answer</p>
          <div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(answer)}</div>
          <hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
          <p style="color:#b5b2aa;font-size:13px">United Federation of Teachers · Professional Learning</p>
        </div>`;

      if (email) {
        await resend.emails.send({
          from,
          to: email,
          subject: 'Your UFT Learning Lounge question',
          html,
        });
      }
      if (process.env.NOTIFY_EMAIL) {
        await resend.emails.send({
          from,
          to: process.env.NOTIFY_EMAIL,
          subject: `New community question${name ? ' from ' + name : ''}`,
          html: `<p><strong>Q:</strong> ${escapeHtml(question)}</p><p><strong>From:</strong> ${escapeHtml(
            name || 'Anonymous'
          )} ${email ? '(' + escapeHtml(email) + ')' : ''}</p><hr><div style="white-space:pre-wrap">${escapeHtml(
            answer
          )}</div>`,
        });
      }
    } catch (err) {
      console.error('[ask] Resend error:', err.message);
    }
  }

  return res.status(200).json({ answer, stored, aiConfigured });
}
