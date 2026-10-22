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
// Substring match, not \b-bounded: CSS Modules / styled-components emit hashed class
// names like .Button_root__a1b2c where no word boundary follows "button".
const BUTTON_SELECTOR = /btn|button|cta/i
const BUTTON_PROPS = /^(background|background-color|color|border-color|border-radius)$/i
// Consumer/retail brand sites often carry their color in a hero banner's background
// rather than a CTA button (confirmed in benchmarking: food/consumer sites were the
// category most likely to yield zero color signal from the button-only pass).
const HERO_SELECTOR = /hero|banner|jumbotron|masthead/i
const HERO_PROPS = /^(background|background-color|background-image)$/i
const MAX_BUTTON_COLORS = 8
const MAX_LOGO_CANDIDATES = 6
const PARENT_LOOKBACK = 300
// Plain substring match (not \b-bounded, to still catch hashed classnames like
// .Logo_root__xyz), but excludes "logout"/"logoff"/"logon" where "logo" is a coincidental
// fragment of "log" + a suffix, not the word "logo" (caught matching
// "homepage_emergency-logout.avif" on monzo.com).
const LOGO_WORD = /logo(?!ut\b|ff\b|n\b)/i
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

// "tweet-" covers Twitter/X's widgets.js embed, which (unlike most iframe-isolated embeds)
// injects a <style> block with its own CSS variables straight into the host page, found
// leaking through as a false brand-colour candidate on starlingbank.com's embedded tweet.
const THIRD_PARTY_VARIABLE = /^--(swiper|bs|tw|plyr|toastify|fa|ck|mdc|slick|tweet)-/i
const THIRD_PARTY_SELECTOR = /onetrust|\bot-|cookie|consent|swiper|slick|recaptcha|intercom|drift/i
// Only "system" palettes (Bootstrap, MUI, Chakra, Ant, Bulma) are listed here, not
// Tailwind's utility scale: those frameworks ship a fixed, nameable default palette that's
// rarely chosen deliberately as a real brand color, whereas Tailwind compiles arbitrary
// utility classes with no such signal, so blocklisting its stock shades would risk demoting
// genuinely-chosen brand colors that happen to coincide with a Tailwind default.
const FRAMEWORK_DEFAULT_COLORS = new Set([
  // Bootstrap
  '#007bff', '#0d6efd', '#6c757d', '#28a745', '#198754', '#17a2b8', '#0dcaf0', '#ffc107', '#dc3545',
  '#343a40', '#212529', '#f8f9fa', '#6610f2', '#6f42c1', '#e83e8c', '#d63384', '#fd7e14', '#20c997',
  // Material UI
  '#1976d2', '#9c27b0', '#f44336', '#ff9800', '#2196f3', '#4caf50',
  // Chakra UI
  '#3182ce', '#319795', '#38a169', '#e53e3e', '#805ad5', '#d53f8c', '#718096',
  // Ant Design
  '#1890ff', '#1677ff', '#52c41a', '#faad14', '#f5222d',
  // Bulma
  '#00d1b2', '#3273dc', '#3298dc', '#48c78e', '#ffe08a', '#f14668',
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

const fetchText = (
  url: string,
  maxBytes: number,
  apiKey: string | undefined,
  redirectsLeft = MAX_REDIRECTS
): Promise<string> =>
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
          const afterCheck = apiKey
            ? isFlaggedUnsafe(next, apiKey).then((unsafe) => {
                if (unsafe) throw new Error('Redirected to a site flagged as unsafe')
              })
            : Promise.resolve()
          return resolve(afterCheck.then(() => fetchText(next, maxBytes, apiKey, redirectsLeft - 1)))
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

type LogoSource = 'inline-svg' | 'header-img' | 'img' | 'apple-touch-icon' | 'favicon' | 'og:image'

const MAX_INLINE_SVG_BYTES = 20_000
const MAX_INLINE_SVG_SCANNED = 50

// First non-"www" hostname label, e.g. "spartanfx" from "www.spartanfx.co.uk".
// Used so a logo's alt/class/aria-label matching the brand name counts, even
// without the literal word "logo" (common for plain wordmark images/SVGs).
const brandToken = (pageUrl: string) => {
  const label = new URL(pageUrl).hostname.split('.').filter((l) => l !== 'www')[0]
  return label && label.length >= 3 ? label : null
}

const findLogoCandidates = (html: string, links: Record<string, string>[], ogImage: string | null, pageUrl: string) => {
  const candidates: { url: string; source: LogoSource }[] = []
  const add = (href: string | undefined, source: LogoSource) => {
    const url = toAbsoluteUrl(href, pageUrl)
    if (url && isPublicHttpUrl(url) && !candidates.some((c) => c.url === url)) candidates.push({ url, source })
  }
  const brand = brandToken(pageUrl)
  const brandRegex = brand ? new RegExp(brand, 'i') : null
  const mentionsLogoWord = (v: string | undefined) => !!v && LOGO_WORD.test(v)
  // Brand-name matching is restricted to deliberate descriptive text (alt/aria-label/<title>).
  // class/id and parent containers routinely mention the brand name on unrelated elements
  // (footers, trust badges, promo banners), so matching the brand there is too broad.
  const mentionsBrandName = (v: string | undefined) => !!v && !!brandRegex?.test(v)

  const headers = [...html.matchAll(/<header\b[\s\S]*?<\/header>/gi)].map(
    (m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]
  )
  const inHeader = (index: number) => headers.some(([start, end]) => index >= start && index < end)

  // Inline SVG wordmarks (e.g. <svg class="logo">...</svg>) have no URL to point at,
  // so they're added as self-contained data: URIs instead. Logo sprite sheets tend to
  // be large and won't mention "logo" or the brand name in their own attributes/<title>,
  // so the size cap and mention check together keep this from matching icon sprites.
  let svgScanned = 0
  for (const m of html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
    if (svgScanned++ >= MAX_INLINE_SVG_SCANNED) break
    const block = m[0]
    if (block.length > MAX_INLINE_SVG_BYTES) continue
    const attrs = parseAttributes(block.match(/<svg\b[^>]*>/i)?.[0] ?? '<svg>')
    const title = block.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
    const classIdMatch = [attrs.class, attrs.id].some(mentionsLogoWord)
    const labelMatchesLogoWord = [attrs['aria-label'], title].some(mentionsLogoWord)
    // Same reasoning as the <img> brand-name check below: only trust a brand-name match
    // (without the word "logo") inside the header, since an unrelated inline chart/icon
    // elsewhere on the page can have an aria-label/title that mentions the brand name too.
    const labelMatchesBrand = inHeader(m.index ?? 0) && [attrs['aria-label'], title].some(mentionsBrandName)
    if (!classIdMatch && !labelMatchesLogoWord && !labelMatchesBrand) continue
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(block).toString('base64')}`
    candidates.push({ url: dataUrl, source: 'inline-svg' })
  }

  const headerImages: string[] = []
  const otherImages: string[] = []
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const index = m.index ?? 0
    const attrs = parseAttributes(m[0])
    const src = attrs.src || attrs['data-src'] || attrs.srcset?.split(/[\s,]/)[0]
    if (!src || src.startsWith('data:')) continue
    if (SOCIAL_IMAGE.test(src) || SOCIAL_IMAGE.test(attrs.alt ?? '')) continue
    const header = inHeader(index)
    // Brand-name-in-alt is only trusted inside <header>: a real logo's alt text is short
    // and deliberate ("Monzo", "Monzo logo"), but content images anywhere on the page
    // routinely mention the brand name in a long descriptive caption (confirmed on
    // monzo.com: a CMA bank-ranking chart's alt text mentions "Monzo" mid-sentence and
    // isn't the logo at all), so outside the header that signal is too noisy to trust.
    const ownMention = [attrs.class, attrs.id, src].some(mentionsLogoWord) || (header && mentionsBrandName(attrs.alt))
    const parent = directParent(html, index)
    const parentMention = [parent?.class, parent?.id].some(mentionsLogoWord)
    if (!ownMention && !parentMention) continue
    ;(header ? headerImages : otherImages).push(src)
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

const summarizePage = async (pageUrl: string, apiKey: string | undefined) => {
  const html = await fetchText(pageUrl, MAX_HTML_BYTES, apiKey)
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
  const linkedCss = await Promise.all(
    stylesheetUrls.map((href) => fetchText(href, MAX_CSS_BYTES, apiKey).catch(() => ''))
  )
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
  const heroBackgroundCounts = new Map<string, number>()
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim()
    if (THIRD_PARTY_SELECTOR.test(selector)) continue
    const isButton = BUTTON_SELECTOR.test(selector)
    const isHero = HERO_SELECTOR.test(selector)
    if (!isButton && !isHero) continue

    if (isHero) {
      for (const declaration of m[2].split(';')) {
        const [prop, ...rest] = declaration.split(':')
        const name = prop?.trim().toLowerCase()
        if (!name || !HERO_PROPS.test(name)) continue
        for (const color of extractColors(rest.join(':').trim())) {
          heroBackgroundCounts.set(color, (heroBackgroundCounts.get(color) ?? 0) + 1)
        }
      }
    }
    if (!isButton) continue

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
    heroBackgrounds: rankColors(heroBackgroundCounts),
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
    summary = await summarizePage(target, safeBrowsingApiKey)
  } catch (error) {
    return { status: 502, body: { error: `Couldn't read this site: ${(error as Error).message}` } }
  }
  return { status: 200, body: await respond(summary) }
}
