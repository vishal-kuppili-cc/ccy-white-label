import 'dotenv/config'
import path from 'node:path'
import express from 'express'
import { handlePageRequest } from './pageSummary'
import { choosePageTheme } from './pageTheme'

const safeBrowsingApiKey = process.env.SAFE_BROWSING_API_KEY
const ollama = {
  url: process.env.OLLAMA_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'tinyllama',
}
if (!safeBrowsingApiKey) {
  console.warn('SAFE_BROWSING_API_KEY is not set; URLs will not be checked for safety')
}

const app = express()

// Sends the result of a handler as JSON, using the status it chose
const route = (respond: Parameters<typeof handlePageRequest>[2]) =>
  async (req: express.Request, res: express.Response) => {
    const { status, body } = await handlePageRequest(String(req.query.url ?? ''), safeBrowsingApiKey, respond)
    res.status(status).json(body)
  }

app.get('/api/page-summary', route(async (summary) => summary))
app.get('/api/page-theme', route((summary) => choosePageTheme(summary, ollama)))

// In production, serve the Vite build from the same Express app so /api/... works with no extra setup.
if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(import.meta.dirname, '..', 'dist')
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const port = Number(process.env.PORT) || 3001
app.listen(port, () => console.log(`Theme API on :${port}`))
