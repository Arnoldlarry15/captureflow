# CaptureFlow

### AI-Native Cognitive Infrastructure

> Drag. Release. Your AI memory handles the rest.

CaptureFlow reduces the friction between thought and structured memory. Draw a selection box over any region of any page — CaptureFlow screenshots it, sends it to Gemini Vision for structured extraction, and persists the resulting knowledge artifacts to Supabase in real time.

---

## Stack

- **React 18** + Vite
- **Tailwind CSS**
- **Gemini 2.5 Flash** — vision extraction, report generation
- **Gemini TTS** — audio briefing synthesis
- **Supabase** — Postgres + Realtime sync

---

## Setup (Local Dev)

### 1. Check Node.js

```bash
node -v   # needs v18+
npm -v
```

If not installed → https://nodejs.org (grab LTS)

### 2. Clone / download this folder, then:

```bash
cd captureflow
npm install
```

### 3. Set up Supabase database

1. Go to supabase.com → your project → SQL Editor
2. Paste the contents of `supabase-schema.sql`
3. Click Run

### 4. Wire your environment variables

Your `.env` file is already configured with your keys.
If you ever need to reset it, copy `.env.example` → `.env` and fill in:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GEMINI_API_KEY`

### 5. Run it

```bash
npm run dev
```

Opens at http://localhost:3000

---

## How to Use

- **Ctrl+F** or **Right-Click → Capture Selection** to enter capture mode
- Drag a box over any content on the page
- Release — Gemini extracts structured knowledge artifacts automatically
- Open the sidebar (hamburger or bottom-left button) to view captures
- Use **Reports** tab to generate summaries, knowledge graphs, slide outlines, or audio briefings
- Use **+ Inject** tab to paste raw text for AI structuring

---

## Deploy to Vercel

### Option A — CLI

```bash
npm install -g vercel
vercel
```

When prompted, add your environment variables in the Vercel dashboard:
Settings → Environment Variables → add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_GEMINI_API_KEY

### Option B — GitHub

1. Push to GitHub (`.env` is gitignored — your keys stay local)
2. Import repo at vercel.com/new
3. Add the three env vars in Vercel dashboard
4. Deploy — every push to main auto-deploys

---

## Security Notes

- `.env` is gitignored — never push it
- The Supabase anon key is safe for frontend use
- Sessions are identified by a UUID stored in localStorage
- For production: add Supabase RLS policies scoped by user auth

---

## Project Structure

```
captureflow/
├── index.html              # Vite entry point
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json             # Vercel deploy config
├── supabase-schema.sql     # Run once in Supabase SQL editor
├── .env                    # Your keys (gitignored)
├── .env.example            # Template for others
├── .gitignore
└── src/
    ├── main.jsx            # React root
    ├── index.css           # Tailwind directives
    └── App.jsx             # Entire application
```
