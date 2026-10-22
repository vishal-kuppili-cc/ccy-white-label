# Site Theme Extraction: Integration Guide

Give the app a website URL and get back the site's **primary button colour, secondary button colour and logo**. You can then use these to theme a preview card.

The pipeline has four steps:

1. **Safety check**: only public http(s) URLs are allowed (private and loopback IPs are blocked), and the URL is checked against Google Safe Browsing (this needs an API key).
2. **Fetch**: the page HTML and up to 4 of its stylesheets are downloaded. The page's JavaScript is never run.
3. **Summarise + filter**: the code pulls out brand colour variables, button colours and logo candidates, and filters out the noise (see [Filters](#filters)).
4. **AI choice + validation**: a local Ollama model (`tinyllama`, temperature 0) picks from a numbered list of options. Its answer is then checked in code, and if it's invalid the code falls back to its own ranking.

This works with any React app (Create React App, Vite, Next.js, Remix, etc.). Fetching sites and calling Ollama has to happen on a **Node server**: browsers can't read other sites' HTML and CSS (CORS), and the API key must stay secret. The React app calls `GET /api/page-theme?url=…` on that server.

```
React app  ──GET /api/page-theme?url=──▶  Node server (Express)  ──▶  Safe Browsing, target site, Ollama
```

Suggested layout:

```
server/
  index.ts             # Express app (section 2)
  pageSummary.ts       # steps 1–3 (section 3)
  pageTheme.ts         # step 4, Ollama (section 4)
src/
  services/pageTheme.ts
  utils/theme.js
```

---

## 1. Dependencies and environment

Requires Node 18 or later (for the built-in `fetch` and `AbortSignal.timeout`).

```bash
npm i express dotenv request-filtering-agent   # request-filtering-agent blocks connections to private IPs, including after DNS lookup and redirects
npm i -D tsx @types/express                    # tsx runs the TypeScript server directly; skip if you compile it another way
docker run -d --name ollama -p 11434:11434 ollama/ollama
docker exec ollama ollama pull tinyllama
```

`.env` (never commit this file; add it to `.gitignore`):

```env
SAFE_BROWSING_API_KEY=your-google-safe-browsing-key   # Google Cloud → enable "Safe Browsing API" → create API key
OLLAMA_URL=http://localhost:11434                     # optional, this is the default
OLLAMA_MODEL=tinyllama
```

If `SAFE_BROWSING_API_KEY` isn't set, the server logs a warning and skips the safety check. Every other step still runs.

## 2. Server wiring (`server/index.ts`)

```ts
import 'dotenv/config'
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

app.listen(Number(process.env.PORT) || 3001, () => console.log('Theme API on :3001'))
```

Run it with `npx tsx server/index.ts`.

### Connecting the React app

Choose one:

- **Same origin in production (recommended):** serve the React build from the same Express app with `app.use(express.static('build'))`, so `/api/...` works with no extra setup.
- **Dev proxy:** forward `/api` to `http://localhost:3001` in development. In Create React App, add `"proxy": "http://localhost:3001"` to `package.json`. Vite and webpack each have their own `proxy` setting in their dev server config.
- **Separate API host:** set an API base URL in the client (see `API_BASE` in section 5) and enable CORS on the server with `npm i cors` and `app.use(cors({ origin: 'https://your-app.com' }))`.

> **Next.js / Remix:** skip Express. Call `handlePageRequest` from a route handler instead, for example `app/api/page-theme/route.ts` that returns `Response.json(body, { status })`.

### Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/page-summary?url=` | The raw filtered summary (useful for debugging) |
| `GET /api/page-theme?url=` | `{ primary, secondary, logo, logoOptions[], sources, aiError? }` |

Errors come back as `{ error: string }`: **400** for an invalid or unsafe URL, **502** when the Safe Browsing check fails or the site can't be read.

---

## 3. Server: `server/pageSummary.ts` (steps 1–3)

This file doesn't depend on any framework. It exports `handlePageRequest`, which takes a URL and returns `{ status, body }`.

```ts
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'
import { useAgent } from 'request-filtering-agent'

const SAFE_BROWSING_URL = 'https://safebrowsing.googleapis.com/v4/threatMatches:find'
const TIMEOUT_MS = 5_000
const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const MAX_HTML_BYTES = 2_000_000
const MAX_CSS_BYTES = 500_000
const MAX_STYLESHEETS = 4
const MAX_VARIABLES = 20
const MAX_BUTTON_RULES = 10
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

const BRAND_VARIABLE = /primary|secondary|brand|button|btn|cta/i
const BUTTON_SELECTOR = /\b(btn|button|cta)\b/i
const BUTTON_PROPS = /^(background|background-color|color|border-color|border-radius)$/i
const MAX_BUTTON_COLORS = 8
const MAX_LOGO_CANDIDATES = 6
const PARENT_LOOKBACK = 300
const LOGO_WORD = /logo/i
const SOCIAL_IMAGE =
  /youtube|facebook|linkedin|instagram|twitter|tiktok|pinterest|whatsapp|\bx-logo/i

const directParent = (html: string, imgIndex: number) => {
  const before = html.slice(Math.max(0, imgIndex - PARENT_LOOKBACK), imgIndex)
  const openings = [...before.matchAll(/<(?!\/|source\b|picture\b)[a-z][\w-]*\b[^>]*>/gi)]
  const last = openings.at(-1)
  if (!last) return null
  const between = before.slice((last.index ?? 0) + last[0].length)
  return between.includes('</') ? null : parseAttributes(last[0])
}

const siteKey = (url: string) => new URL(url).hostname.split('.').slice(-2).join('.')
const BACKGROUND_PROPS = /^(background|background-color)$/i
const NEUTRAL_MAX_SATURATION = 0.15
const NEUTRAL_MIN_LIGHTNESS = 0.08
const NEUTRAL_MAX_LIGHTNESS = 0.95

const THIRD_PARTY_VARIABLE = /^--(swiper|bs|tw|plyr|toastify|fa|ck|mdc|slick)-/i
const THIRD_PARTY_SELECTOR = /onetrust|\bot-|cookie|consent|swiper|slick|recaptcha|intercom|drift/i
const FRAMEWORK_DEFAULT_COLORS = new Set([
  '#007bff', '#0d6efd', '#6c757d', '#28a745', '#198754', '#17a2b8', '#0dcaf0', '#ffc107', '#dc3545',
  '#343a40', '#212529', '#f8f9fa', '#6610f2', '#6f42c1', '#e83e8c', '#d63384', '#fd7e14', '#20c997',
])
const ALL_COLORS = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi

const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

const normalizeColor = (raw: string): string | null => {
  const value = raw.trim().toLowerCase()
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && hex[3] === '0') return null
      return '#' + [...hex.slice(0, 3)].map((c) => c + c).join('')
    }
    if (hex.length === 6) return value
    if (hex.length === 8) return hex.slice(6) === '00' ? null : '#' + hex.slice(0, 6)
    return null
  }
  const parts = value.match(/[\d.]+%?/g)?.map((p) => parseFloat(p)) ?? []
  if (parts.length < 3) return null
  if (parts[3] === 0) return null
  if (value.startsWith('rgb')) return '#' + parts.slice(0, 3).map(toHex).join('')
  const [h, sat, light] = [parts[0], parts[1] / 100, parts[2] / 100]
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return 255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return '#' + [f(0), f(8), f(4)].map(toHex).join('')
}

const extractColors = (value: string) =>
  [...value.matchAll(ALL_COLORS)].map((m) => normalizeColor(m[0])).filter((c): c is string => !!c)

const isPublicHttpUrl = (value: string) => {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname
  return !(
    host === 'localhost' || host.endsWith('.local') || host === '[::1]' ||
    /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

const isFlaggedUnsafe = async (url: string, apiKey: string) => {
  const res = await fetch(`${SAFE_BROWSING_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      client: { clientId: 'your-app-name', clientVersion: '0.0.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    }),
  })
  if (!res.ok) throw new Error(`Safe Browsing returned HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data.matches) && data.matches.length > 0
}

const fetchText = (url: string, maxBytes: number, redirectsLeft = MAX_REDIRECTS): Promise<string> =>
  new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.get(
      url,
      {
        agent: useAgent(url),
        timeout: FETCH_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/css,*/*', 'Accept-Encoding': 'gzip, deflate, br' },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && location) {
          res.resume()
          const next = new URL(location, url).href
          if (redirectsLeft === 0) return reject(new Error('Too many redirects'))
          if (!isPublicHttpUrl(next)) return reject(new Error('Redirected to a non-public URL'))
          return resolve(fetchText(next, maxBytes, redirectsLeft - 1))
        }
        if (status < 200 || status >= 300) {
          res.resume()
          return reject(new Error(`HTTP ${status}`))
        }
        const encoding = res.headers['content-encoding']
        let body: Readable = res
        if (encoding === 'gzip') body = res.pipe(zlib.createGunzip())
        else if (encoding === 'br') body = res.pipe(zlib.createBrotliDecompress())
        else if (encoding === 'deflate') body = res.pipe(zlib.createInflate())

        const chunks: Buffer[] = []
        let size = 0
        let done = false
        const finish = () => {
          if (done) return
          done = true
          resolve(Buffer.concat(chunks).toString('utf8'))
        }
        body.on('data', (chunk: Buffer) => {
          if (done) return
          chunks.push(chunk)
          size += chunk.length
          if (size >= maxBytes) { finish(); req.destroy() }
        })
        body.on('end', finish)
        body.on('error', (error) => !done && reject(error))
      }
    )
    req.on('timeout', () => req.destroy(new Error('Timed out')))
    req.on('error', reject)
  })

const parseAttributes = (tag: string) => {
  const attrs: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

const findTags = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => parseAttributes(m[0]))

const toAbsoluteUrl = (href: string | undefined, base: string) => {
  if (!href) return null
  try { return new URL(href, base).href } catch { return null }
}

const isNeutral = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1))
  return saturation < NEUTRAL_MAX_SATURATION || lightness < NEUTRAL_MIN_LIGHTNESS || lightness > NEUTRAL_MAX_LIGHTNESS
}

const neutralReason = (color: string) =>
  isNeutral(color) ? 'grey/white/black' : FRAMEWORK_DEFAULT_COLORS.has(color) ? 'framework default' : null

const rankColors = (counts: Map<string, number>) =>
  [...counts]
    .map(([color, count]) => ({ color, count, neutral: neutralReason(color) }))
    .sort((a, b) => Number(!!a.neutral) - Number(!!b.neutral) || b.count - a.count)
    .slice(0, MAX_BUTTON_COLORS)

type LogoSource = 'header-img' | 'img' | 'apple-touch-icon' | 'favicon' | 'og:image'

const findLogoCandidates = (html: string, links: Record<string, string>[], ogImage: string | null, pageUrl: string) => {
  const candidates: { url: string; source: LogoSource }[] = []
  const add = (href: string | undefined, source: LogoSource) => {
    const url = toAbsoluteUrl(href, pageUrl)
    if (url && isPublicHttpUrl(url) && !candidates.some((c) => c.url === url)) candidates.push({ url, source })
  }
  const headers = [...html.matchAll(/<header\b[\s\S]*?<\/header>/gi)].map(
    (m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]
  )
  const inHeader = (index: number) => headers.some(([start, end]) => index >= start && index < end)

  const headerImages: string[] = []
  const otherImages: string[] = []
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const index = m.index ?? 0
    const attrs = parseAttributes(m[0])
    const src = attrs.src || attrs['data-src'] || attrs.srcset?.split(/[\s,]/)[0]
    if (!src || src.startsWith('data:')) continue
    if (SOCIAL_IMAGE.test(src) || SOCIAL_IMAGE.test(attrs.alt ?? '')) continue
    const ownMention = [attrs.class, attrs.id, attrs.alt, src].some((v) => v && LOGO_WORD.test(v))
    const parent = directParent(html, index)
    const parentMention = [parent?.class, parent?.id].some((v) => v && LOGO_WORD.test(v))
    if (!ownMention && !parentMention) continue
    ;(inHeader(index) ? headerImages : otherImages).push(src)
  }
  const pageSite = siteKey(pageUrl)
  const ownSiteFirst = (srcs: string[]) =>
    srcs
      .map((src) => toAbsoluteUrl(src, pageUrl))
      .filter((url): url is string => !!url)
      .sort((a, b) => Number(siteKey(b) === pageSite) - Number(siteKey(a) === pageSite))
  ownSiteFirst(headerImages).forEach((url) => add(url, 'header-img'))
  ownSiteFirst(otherImages).forEach((url) => add(url, 'img'))

  const iconLinks = links.filter((l) => /\bicon\b/i.test(l.rel ?? ''))
  iconLinks.filter((l) => /apple-touch-icon/i.test(l.rel)).forEach((l) => add(l.href, 'apple-touch-icon'))
  iconLinks.filter((l) => !/apple-touch-icon/i.test(l.rel)).forEach((l) => add(l.href, 'favicon'))
  if (ogImage) add(ogImage, 'og:image')
  return candidates.slice(0, MAX_LOGO_CANDIDATES)
}

const summarizePage = async (pageUrl: string) => {
  const html = await fetchText(pageUrl, MAX_HTML_BYTES)
  const metas = findTags(html, 'meta')
  const links = findTags(html, 'link')
  const meta = (key: string) => metas.find((m) => m.name === key || m.property === key)?.content ?? null
  const logoCandidates = findLogoCandidates(html, links, meta('og:image'), pageUrl)

  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
  const stylesheetUrls = links
    .filter((l) => /\bstylesheet\b/i.test(l.rel ?? ''))
    .map((l) => toAbsoluteUrl(l.href, pageUrl))
    .filter((href): href is string => !!href && isPublicHttpUrl(href))
    .slice(0, MAX_STYLESHEETS)
  const linkedCss = await Promise.all(stylesheetUrls.map((href) => fetchText(href, MAX_CSS_BYTES).catch(() => '')))
  const css = [...inlineCss, ...linkedCss].join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

  const variables = new Map<string, string>()
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)) {
    const [name, value] = [m[1], m[2].trim()]
    if (variables.has(name) || !BRAND_VARIABLE.test(name) || THIRD_PARTY_VARIABLE.test(name)) continue
    const colors = extractColors(value)
    if (colors.length === 0) continue
    if (colors.every((c) => FRAMEWORK_DEFAULT_COLORS.has(c))) continue
    variables.set(name, colors[0])
  }
  const cssVariables = Object.fromEntries([...variables].slice(0, MAX_VARIABLES))

  const buttonRules: { selector: string; styles: Record<string, string[]> }[] = []
  const backgroundCounts = new Map<string, number>()
  const textCounts = new Map<string, number>()
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim()
    if (!BUTTON_SELECTOR.test(selector) || THIRD_PARTY_SELECTOR.test(selector)) continue
    const styles: Record<string, string[]> = {}
    for (const declaration of m[2].split(';')) {
      const [prop, ...rest] = declaration.split(':')
      const name = prop?.trim().toLowerCase()
      if (!name || !BUTTON_PROPS.test(name)) continue
      const value = rest.join(':').trim()
      const found = name === 'border-radius' ? [value] : extractColors(value)
      if (found.length) styles[name] = found
    }
    if (Object.keys(styles).length === 0) continue
    for (const [name, values] of Object.entries(styles)) {
      const counts = BACKGROUND_PROPS.test(name) ? backgroundCounts : name === 'color' ? textCounts : null
      if (!counts) continue
      for (const color of values) counts.set(color, (counts.get(color) ?? 0) + 1)
    }
    if (buttonRules.length < MAX_BUTTON_RULES) buttonRules.push({ selector: selector.slice(0, 120), styles })
  }

  return {
    url: pageUrl,
    title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null,
    siteName: meta('og:site_name'),
    logoCandidates,
    cssVariables,
    buttonBackgrounds: rankColors(backgroundCounts),
    buttonTextColors: rankColors(textCounts),
    buttonRules,
  }
}

export type PageSummary = Awaited<ReturnType<typeof summarizePage>>

// Checks the URL, reads and summarises the page, then returns whatever `respond` returns.
// Any failure returns an error instead. Works with any server framework.
export const handlePageRequest = async (
  target: string,
  safeBrowsingApiKey: string | undefined,
  respond: (summary: PageSummary) => Promise<unknown>
): Promise<{ status: number; body: unknown }> => {
  if (!isPublicHttpUrl(target)) return { status: 400, body: { error: 'Enter a public http(s) URL' } }
  if (safeBrowsingApiKey) {
    try {
      if (await isFlaggedUnsafe(target, safeBrowsingApiKey)) {
        return { status: 400, body: { error: 'This site is flagged as unsafe' } }
      }
    } catch (error) {
      return { status: 502, body: { error: `Couldn't check this site's safety: ${(error as Error).message}` } }
    }
  }
  let summary: PageSummary
  try {
    summary = await summarizePage(target)
  } catch (error) {
    return { status: 502, body: { error: `Couldn't read this site: ${(error as Error).message}` } }
  }
  return { status: 200, body: await respond(summary) }
}
```

---

## 4. Server: `server/pageTheme.ts` (step 4, Ollama)

```ts
import type { PageSummary } from './pageSummary'

const AI_TIMEOUT_MS = 60_000
const MAX_COLOR_OPTIONS = 6
const MAX_VARIABLE_OPTIONS = 5
const HEX = /^#[0-9a-f]{6}$/i
const MIN_COLOR_DISTANCE = 120

const colorDistance = (a: string, b: string) => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [x, y] = [rgb(a), rgb(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
const plainContrast = (hex: string) =>
  colorDistance(hex, '#000000') < colorDistance(hex, '#ffffff') ? '#ffffff' : '#000000'

type Source = 'ai' | 'fallback'

export interface PageTheme {
  primary: string | null
  secondary: string | null
  logo: string | null
  logoOptions: string[]
  sources: { primary: Source; secondary: Source; logo: Source }
  aiError?: string
}

export interface OllamaOptions {
  url: string
  model: string
}

// JSON schema the model must reply in (Ollama structured outputs)
const REPLY_FORMAT = {
  type: 'object',
  properties: { primary: { type: 'string' }, secondary: { type: 'string' }, logo: { type: 'integer' } },
  required: ['primary', 'secondary', 'logo'],
}

const SYSTEM_PROMPT =
  "You choose a website's brand button colours and logo from the options given. " +
  'Only use colours and logo numbers from the lists. Reply only with JSON.'

const buildPrompt = (summary: PageSummary) => {
  const colors = summary.buttonBackgrounds
    .slice(0, MAX_COLOR_OPTIONS)
    .map((c, i) => `${i + 1}. ${c.color} (used ${c.count} times${c.neutral ? ', neutral' : ''})`)
  const variables = Object.entries(summary.cssVariables)
    .slice(0, MAX_VARIABLE_OPTIONS)
    .map(([name, color]) => `${name}: ${color}`)
  const logos = summary.logoCandidates.map((l, i) => `${i + 1}. ${l.source}: ${l.url.split('/').pop()?.split('?')[0]}`)
  return [
    'Button background colours, most used first:', ...(colors.length ? colors : ['(none found)']), '',
    'Brand colour variables:', ...(variables.length ? variables : ['(none found)']), '',
    'Logo options:', ...(logos.length ? logos : ['(none found)']), '',
    'Choose the primary button colour, the secondary button colour, and the number of the best logo.',
  ].join('\n')
}

const rankedColors = (summary: PageSummary) => [
  ...new Set([
    ...summary.buttonBackgrounds.filter((c) => !c.neutral).map((c) => c.color),
    ...Object.values(summary.cssVariables),
    ...summary.buttonBackgrounds.filter((c) => c.neutral).map((c) => c.color),
  ]),
]

const askOllama = async (summary: PageSummary, ollama: OllamaOptions) => {
  const res = await fetch(`${ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      model: ollama.model,
      stream: false,
      format: REPLY_FORMAT,
      options: { temperature: 0, seed: 42 }, // deterministic
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(summary) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`)
  const data = await res.json()
  return JSON.parse(data.message.content) as { primary?: unknown; secondary?: unknown; logo?: unknown }
}

export const choosePageTheme = async (summary: PageSummary, ollama: OllamaOptions): Promise<PageTheme> => {
  const options = rankedColors(summary)
  const logos = summary.logoCandidates

  let reply: Awaited<ReturnType<typeof askOllama>> = {}
  let aiError: string | undefined
  try {
    reply = await askOllama(summary, ollama)
  } catch (error) {
    aiError = (error as Error).message
  }

  const asOption = (value: unknown) => {
    const color = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return HEX.test(color) && options.includes(color) ? color : null
  }
  const neutrals = new Set(summary.buttonBackgrounds.filter((c) => c.neutral).map((c) => c.color))
  const colored = options.filter((c) => !neutrals.has(c))

  const aiPrimary = asOption(reply.primary)
  const validPrimary = aiPrimary && (!neutrals.has(aiPrimary) || !colored.length) ? aiPrimary : null
  const primary = validPrimary ?? options[0] ?? null

  const aiSecondary = asOption(reply.secondary)
  const looksDifferent = (c: string) => !primary || colorDistance(c, primary) >= MIN_COLOR_DISTANCE
  const otherColored = colored.filter(looksDifferent)
  const validSecondary =
    aiSecondary && looksDifferent(aiSecondary) && (!neutrals.has(aiSecondary) || !otherColored.length)
      ? aiSecondary
      : null
  const secondary =
    validSecondary ??
    otherColored[0] ??
    options.find((c) => neutrals.has(c) && looksDifferent(c)) ??
    (primary ? plainContrast(primary) : null)

  const isLabelled = (l: { source: string }) => l.source === 'header-img' || l.source === 'img'
  const hasLabelled = logos.some(isLabelled)
  const logoNumber = Number.isInteger(reply.logo) ? (reply.logo as number) : 0
  const aiChoice = logos[logoNumber - 1]
  const aiLogo = aiChoice && (!hasLabelled || isLabelled(aiChoice)) ? aiChoice.url : null
  const logo = aiLogo ?? logos[0]?.url ?? null

  return {
    primary,
    secondary,
    logo,
    logoOptions: logos.map((l) => l.url),
    sources: {
      primary: validPrimary ? 'ai' : 'fallback',
      secondary: validSecondary ? 'ai' : 'fallback',
      logo: aiLogo ? 'ai' : 'fallback',
    },
    ...(aiError && { aiError }),
  }
}
```

---

## 5. Client

### Types

```ts
export interface ThemeValues {
  primary?: string | null
  secondary?: string | null
  logo?: string | null
}

export interface SiteTheme {
  suggested: ThemeValues   // from the AI/fallback
  custom?: ThemeValues     // user overrides
  logoOptions: string[]
  generatedAt: string
}
// Store it on whatever record holds the URL, e.g. { url, theme?: SiteTheme }
```

### `services/pageTheme.ts`

```ts
import type { SiteTheme } from '../types'

// '' = same origin or a dev proxy. For a separate API host, set this from your build tool's
// env (e.g. process.env.REACT_APP_API_BASE or import.meta.env.VITE_API_BASE) or hard-code it.
const API_BASE = ''

export async function fetchPageTheme(url: string): Promise<Pick<SiteTheme, 'suggested' | 'logoOptions'>> {
  const res = await fetch(`${API_BASE}/api/page-theme?url=${encodeURIComponent(url)}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Couldn't generate a theme (HTTP ${res.status})`)
  const { primary, secondary, logo, logoOptions } = body
  return { suggested: { primary, secondary, logo }, logoOptions }
}
```

### `utils/theme.js` (apply the theme)

```js
// Any fallback logo works: an imported asset (if your bundler supports it) or a public URL
import fallbackLogo from '../assets/logo.svg'

export const DEFAULT_COLORS = { primary: '#4f46e5', secondary: '#e5e7eb' }

export const readableTextOn = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.179 ? '#ffffff' : '#111827'
}

// Use on <img onError>; also set referrerPolicy="no-referrer" on logo images
export const showFallbackLogo = (e) => {
  e.currentTarget.onerror = null
  e.currentTarget.src = fallbackLogo
}

// Priority: user custom → suggested → defaults
export const resolveTheme = (theme, custom = theme?.custom) => {
  const values = theme ? { ...theme.suggested, ...custom } : {}
  return {
    primary: values.primary ?? DEFAULT_COLORS.primary,
    secondary: values.secondary ?? DEFAULT_COLORS.secondary,
    logo: values.logo ?? fallbackLogo,
  }
}

export const themeVariables = ({ primary, secondary }) => ({
  '--primary': primary,
  '--secondary': secondary,
  '--on-primary': readableTextOn(primary),
  '--on-secondary': readableTextOn(secondary),
})
```

Usage:

```jsx
const theme = resolveTheme(item.theme)
<div style={themeVariables(theme)}>
  <img src={theme.logo} referrerPolicy="no-referrer" onError={showFallbackLogo} />
  <button style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}>Primary</button>
  <button style={{ background: 'var(--secondary)', color: 'var(--on-secondary)' }}>Secondary</button>
</div>
```

### When to regenerate

- **Create**: generate the theme before saving. If generation fails, still save the item without a theme, so the defaults are used.
- **Update**: regenerate only when the URL changes, unless the caller passes `regenerateTheme: true` or `false` explicitly. If regeneration fails, **clear** the old theme so the item doesn't keep another site's look.

---

## Filters

| Filter | What it removes or demotes |
|---|---|
| URL guard | Non-http(s) URLs, localhost, `.local`, private, loopback and link-local IPs. The same check runs again on every redirect, and `request-filtering-agent` checks the resolved IP of each connection |
| Safe Browsing | Malware, phishing, unwanted software and potentially harmful applications |
| Size and time limits | HTML up to 2 MB, CSS up to 500 KB, 4 stylesheets, 5 redirects, 10 s fetch timeout, 60 s AI timeout |
| Brand variables | Keeps only `--*primary/secondary/brand/button/btn/cta*` variables. Drops third-party prefixes (`--bs-`, `--tw-`, `--swiper-`, …) and variables that only contain Bootstrap default colours |
| Button rules | Keeps selectors matching `btn/button/cta`. Skips cookie banners, consent pop-ups, OneTrust, sliders, reCAPTCHA, Intercom and Drift |
| Colour parsing | Normalises hex, rgb and hsl values (including those inside gradients and `var()` fallbacks) to `#rrggbb`. Drops transparent colours |
| Neutral ranking | Greys, near-white, near-black and framework defaults are listed **last** and labelled, not removed |
| Logo candidates | `<img>` elements mentioning "logo" in their own attributes or their direct parent's, with ones inside `<header>` first and the site's own domain first. Social media icons are skipped. Falls back to apple-touch-icon, then favicon, then og:image |
| AI validation | Colours must come from the option list. The primary must not be neutral if a coloured option exists. The secondary must have an RGB distance of at least 120 from the primary. The logo must be a labelled image when one exists. Anything invalid falls back to the code's own ranking (`sources` records which values came from the AI) |

## Security notes

- Keep `SAFE_BROWSING_API_KEY` in the server's `.env` only. Never give it a client-exposed prefix (`REACT_APP_`, `VITE_`, `NEXT_PUBLIC_`), because build tools copy those variables into the browser bundle.
- Add rate limiting (for example `express-rate-limit`) before exposing the server publicly, since each request fetches remote pages and runs the AI model.
- Ollama runs locally, so no AI API key is needed. If you switch to a hosted model, put its key in `.env` the same way and add an `Authorization` header in `askOllama`.
