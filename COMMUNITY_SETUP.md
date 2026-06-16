# Community Q&A — Setup

The site is still **plain static HTML**. The community page (`community.html`) talks to two
tiny Vercel serverless functions in `/api`. No framework, no build step — Vercel runs them
automatically, installs `package.json` deps, runs `prisma generate`, and reads your secret
keys from **Environment Variables** (the browser never sees them).

```
community.html  ──fetch──▶  /api/ask        ──▶  Groq (answer) + Prisma/Postgres (store) + Resend (email)
                ──fetch──▶  /api/questions  ──▶  Prisma/Postgres (recent answered questions feed)
```

## 1. Get three keys

| Service | Where | Env var |
|---|---|---|
| **Groq** — LLM answers | https://console.groq.com/keys | `GROQ_API_KEY` (+ optional `GROQ_MODEL`) |
| **Postgres (Neon)** — storage | https://neon.tech → project → Connection string (**pooled**) | `DATABASE_URL` |
| **Resend** — email | https://resend.com/api-keys | `RESEND_API_KEY` (+ `FROM_EMAIL`, optional `NOTIFY_EMAIL`) |

## 2. Create the database table (Prisma)

The schema lives in `prisma/schema.prisma`. Once `DATABASE_URL` is set:

```bash
cp .env.example .env     # paste your real DATABASE_URL (and other keys) into .env
npm install              # installs deps + runs `prisma generate`
npm run db:push          # creates the `community_questions` table in your DB
```

`npm run db:push` reads `DATABASE_URL` from `.env`. Re-run it any time you change the schema.
Optional: `npm run db:studio` opens Prisma Studio to browse the data.

## 3. Add the keys to Vercel

Vercel → your project → **Settings → Environment Variables** → add each key (Production +
Preview). See `.env.example` for the full list and formats.

## 4. Deploy

If the repo is connected to Vercel, just push — Vercel detects `/api`, runs `npm install`
(which triggers `prisma generate` via the `postinstall` script), and serves everything.
Otherwise: `npm i -g vercel` then `vercel`.

## 5. Test locally (optional)

```bash
npm i -g vercel
vercel dev               # serves the HTML + /api together at localhost:3000
```

> Plain `python -m http.server` / double-clicking the HTML works for the page UI, but `/api/*`
> only runs under `vercel dev` or on Vercel. Until keys are set, the page degrades gracefully:
> the form works, shows a "being set up" note, and the feed stays empty.

## Notes
- **Privacy:** the public feed never exposes emails — only name (optional), question, answer.
- **Cost control:** answers are capped at ~800 tokens; consider rate limiting before a wide launch.
- **Model:** set `GROQ_MODEL` to whatever your Groq account supports (e.g. `llama-3.3-70b-versatile`).
- **Prisma on Vercel:** the generator includes the `rhel-openssl-3.0.x` binary target so the
  query engine works in Vercel's serverless runtime; `postinstall` runs `prisma generate` on deploy.
