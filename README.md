# Site Theme Extraction

Paste a public website URL and get back a preview card themed with that site's own
primary/secondary button colours and logo. See [site-theme-extraction.md](site-theme-extraction.md)
for the full pipeline design and [site-theme-summary.md](site-theme-summary.md) for the
executive summary.

Pipeline: Safe Browsing safety check → fetch HTML/CSS (no JS execution) → filter out noise
(cookie banners, third-party widgets, framework defaults) → local Ollama (`tinyllama`) picks
colours/logo from the filtered options → code validates the AI's answer and falls back to its
own ranking if the answer is invalid or the AI call fails.

## Project layout

```
server/
  index.ts        Express app, wires the two API routes
  pageSummary.ts  Steps 1–3: safety check, fetch, filter
  pageTheme.ts    Step 4: Ollama choice + validation
src/
  services/pageTheme.ts  Client fetch helper
  utils/theme.ts         Apply a theme (contrast colours, fallback logo)
  App.tsx                UI: URL form, preview card, colour/logo overrides
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start Ollama (local AI, no API key needed)

```bash
docker pull ollama/ollama
docker run -it -v ~/ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
docker exec -it ollama ollama run tinyllama
```

(If the container already exists, use `docker start ollama` instead of `docker run`.)

### 3. Add your Google Safe Browsing API key

```bash
cp .env.example .env
```

Edit `.env` and set `SAFE_BROWSING_API_KEY` (Google Cloud Console → enable "Safe Browsing API"
→ create an API key). If you leave it unset, the server still runs — it just skips the safety
check and logs a warning.

### 4. Run it

```bash
npm run dev
```

This starts the Vite client (`http://localhost:5173`) and the Express API
(`http://localhost:3001`) together. Vite proxies `/api/*` requests to the Express server (see
`vite.config.ts`), so the browser only ever talks to `localhost:5173`.

## Production build

```bash
npm run build
npm start
```

`npm start` runs the Express server with `NODE_ENV=production`, which serves the built client
from `dist/` directly — no separate static host or CORS setup needed.

## Notes

- `SAFE_BROWSING_API_KEY` only ever lives in `.env` on the server; it's never sent to the
  browser.
- Ollama runs entirely on your machine — no AI API key, no per-request cost, no site content
  leaves localhost.
- If a site can't be read, is flagged unsafe, or the AI call fails, the app still returns a
  result using the code's own colour/logo ranking (see `sources` in the API response).
