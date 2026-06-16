// GET /api/questions
// Returns the most recent AI-answered questions for the public community feed.
// Emails are never returned. Degrades to an empty list if the DB isn't set up.

import { prisma } from '../lib/prisma.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(200).json({ questions: [], configured: false });
  }

  try {
    const rows = await prisma.communityQuestion.findMany({
      where: { aiAnswered: true, NOT: { answer: null } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { name: true, question: true, answer: true, createdAt: true },
    });
    return res.status(200).json({ questions: rows, configured: true });
  } catch (err) {
    console.error('[questions] Prisma error:', err.message);
    return res.status(200).json({ questions: [], configured: false });
  }
}
