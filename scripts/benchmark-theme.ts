import fs from 'node:fs'

const SITES: { url: string; category: string }[] = [
  { url: 'https://www.google.com', category: 'tech' },
  { url: 'https://www.microsoft.com', category: 'tech' },
  { url: 'https://www.apple.com', category: 'tech' },
  { url: 'https://www.amazon.com', category: 'tech' },
  { url: 'https://www.meta.com', category: 'tech' },
  { url: 'https://www.netflix.com', category: 'tech' },
  { url: 'https://www.spotify.com', category: 'tech' },
  { url: 'https://www.salesforce.com', category: 'tech' },
  { url: 'https://www.adobe.com', category: 'tech' },
  { url: 'https://slack.com', category: 'tech' },
  { url: 'https://www.dropbox.com', category: 'tech' },
  { url: 'https://github.com', category: 'tech' },
  { url: 'https://www.atlassian.com', category: 'tech' },
  { url: 'https://www.shopify.com', category: 'tech' },
  { url: 'https://www.figma.com', category: 'tech' },
  { url: 'https://stripe.com', category: 'fintech' },
  { url: 'https://www.paypal.com', category: 'fintech' },
  { url: 'https://squareup.com', category: 'fintech' },
  { url: 'https://www.visa.com', category: 'fintech' },
  { url: 'https://www.mastercard.com', category: 'fintech' },
  { url: 'https://www.americanexpress.com', category: 'fintech' },
  { url: 'https://www.revolut.com', category: 'fintech' },
  { url: 'https://wise.com', category: 'fintech' },
  { url: 'https://www.coinbase.com', category: 'fintech' },
  { url: 'https://robinhood.com', category: 'fintech' },
  { url: 'https://www.etoro.com', category: 'fintech' },
  { url: 'https://www.currencycloud.com', category: 'fintech' },
  { url: 'https://www.spartanfx.co.uk', category: 'fintech' },
  { url: 'https://www.chase.com', category: 'banking' },
  { url: 'https://www.bankofamerica.com', category: 'banking' },
  { url: 'https://www.wellsfargo.com', category: 'banking' },
  { url: 'https://online.citi.com', category: 'banking' },
  { url: 'https://www.goldmansachs.com', category: 'banking' },
  { url: 'https://www.hsbc.com', category: 'banking' },
  { url: 'https://www.barclays.co.uk', category: 'banking' },
  { url: 'https://www.capitalone.com', category: 'banking' },
  { url: 'https://www.linkedin.com', category: 'social' },
  { url: 'https://x.com', category: 'social' },
  { url: 'https://www.reddit.com', category: 'social' },
  { url: 'https://www.pinterest.com', category: 'social' },
  { url: 'https://www.tiktok.com', category: 'social' },
  { url: 'https://www.snapchat.com', category: 'social' },
  { url: 'https://www.twitch.tv', category: 'social' },
  { url: 'https://discord.com', category: 'social' },
  { url: 'https://www.whatsapp.com', category: 'social' },
  { url: 'https://telegram.org', category: 'social' },
  { url: 'https://www.walmart.com', category: 'retail' },
  { url: 'https://www.target.com', category: 'retail' },
  { url: 'https://www.bestbuy.com', category: 'retail' },
  { url: 'https://www.costco.com', category: 'retail' },
  { url: 'https://www.ikea.com', category: 'retail' },
  { url: 'https://www.nike.com', category: 'retail' },
  { url: 'https://www.adidas.com', category: 'retail' },
  { url: 'https://www.zara.com', category: 'retail' },
  { url: 'https://www2.hm.com', category: 'retail' },
  { url: 'https://www.etsy.com', category: 'retail' },
  { url: 'https://www.ebay.com', category: 'retail' },
  { url: 'https://www.wayfair.com', category: 'retail' },
  { url: 'https://aliexpress.us', category: 'retail' },
  { url: 'https://www.fedex.com', category: 'logistics' },
  { url: 'https://www.dhl.com', category: 'logistics' },
  { url: 'https://www.delta.com', category: 'travel' },
  { url: 'https://www.united.com', category: 'travel' },
  { url: 'https://www.aa.com', category: 'travel' },
  { url: 'https://www.southwest.com', category: 'travel' },
  { url: 'https://www.britishairways.com', category: 'travel' },
  { url: 'https://www.emirates.com', category: 'travel' },
  { url: 'https://www.expedia.com', category: 'travel' },
  { url: 'https://www.booking.com', category: 'travel' },
  { url: 'https://www.marriott.com', category: 'travel' },
  { url: 'https://www.hilton.com', category: 'travel' },
  { url: 'https://www.nytimes.com', category: 'media' },
  { url: 'https://www.cnn.com', category: 'media' },
  { url: 'https://www.bbc.com', category: 'media' },
  { url: 'https://www.foxnews.com', category: 'media' },
  { url: 'https://www.bloomberg.com', category: 'media' },
  { url: 'https://www.forbes.com', category: 'media' },
  { url: 'https://www.wsj.com', category: 'media' },
  { url: 'https://www.theverge.com', category: 'media' },
  { url: 'https://www.starbucks.com', category: 'food' },
  { url: 'https://www.mcdonalds.com', category: 'food' },
  { url: 'https://www.coca-cola.com', category: 'food' },
  { url: 'https://www.pepsi.com', category: 'food' },
  { url: 'https://www.dominos.com', category: 'food' },
  { url: 'https://www.chipotle.com', category: 'food' },
  { url: 'https://www.tesla.com', category: 'auto' },
  { url: 'https://www.toyota.com', category: 'auto' },
  { url: 'https://www.ford.com', category: 'auto' },
  { url: 'https://www.bmw.com', category: 'auto' },
  { url: 'https://www.mercedes-benz.com', category: 'auto' },
  { url: 'https://www.honda.com', category: 'auto' },
  { url: 'https://www.verizon.com', category: 'telecom' },
  { url: 'https://www.att.com', category: 'telecom' },
  { url: 'https://www.t-mobile.com', category: 'telecom' },
  { url: 'https://www.vodafone.com', category: 'telecom' },
  { url: 'https://www.wikipedia.org', category: 'misc' },
  { url: 'https://duckduckgo.com', category: 'misc' },
  { url: 'https://www.mozilla.org', category: 'misc' },
  { url: 'https://wordpress.com', category: 'misc' },
  { url: 'https://www.cloudflare.com', category: 'misc' },
  { url: 'https://www.oracle.com', category: 'misc' },
  { url: 'https://www.ibm.com', category: 'misc' },
  { url: 'https://www.intel.com', category: 'misc' },
  { url: 'https://www.nvidia.com', category: 'misc' },
  { url: 'https://www.samsung.com', category: 'misc' },
  { url: 'https://www.airbnb.com', category: 'misc' },
]

const BASE = 'http://localhost:3001'
const CONCURRENCY = 5
const TIMEOUT_MS = 15_000

interface Result {
  url: string
  category: string
  ok: boolean
  status: number
  error?: string
  ms: number
  logoCandidates?: number
  logoSources?: string[]
  coloredButtonBg?: number
  neutralButtonBg?: number
  cssVariables?: number
  buttonRules?: number
}

async function benchmarkSite(site: { url: string; category: string }): Promise<Result> {
  const start = Date.now()
  try {
    const res = await fetch(`${BASE}/api/page-summary?url=${encodeURIComponent(site.url)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.json().catch(() => ({}))
    const ms = Date.now() - start
    if (!res.ok) return { url: site.url, category: site.category, ok: false, status: res.status, error: body.error, ms }
    const backgrounds = body.buttonBackgrounds ?? []
    const colored = backgrounds.filter((c: { neutral: unknown }) => !c.neutral).length
    return {
      url: site.url,
      category: site.category,
      ok: true,
      status: res.status,
      ms,
      logoCandidates: (body.logoCandidates ?? []).length,
      logoSources: (body.logoCandidates ?? []).map((l: { source: string }) => l.source),
      coloredButtonBg: colored,
      neutralButtonBg: backgrounds.length - colored,
      cssVariables: Object.keys(body.cssVariables ?? {}).length,
      buttonRules: (body.buttonRules ?? []).length,
    }
  } catch (err) {
    return { url: site.url, category: site.category, ok: false, status: 0, error: (err as Error).message, ms: Date.now() - start }
  }
}

async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return results
}

function pct(n: number, d: number) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a'
}

async function main() {
  console.log(`Benchmarking ${SITES.length} sites, concurrency ${CONCURRENCY}...`)
  const results = await runPool(SITES, CONCURRENCY, benchmarkSite)
  fs.writeFileSync('benchmark-results.json', JSON.stringify(results, null, 2))

  const ok = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  console.log(`\nTotal: ${results.length}, OK: ${ok.length}, Failed: ${failed.length}`)

  console.log('\n--- Failures (by category) ---')
  for (const r of failed) console.log(`  [${r.category}] ${r.url} -> ${r.status} ${r.error}`)

  const zeroColoredButtons = ok.filter((r) => (r.coloredButtonBg ?? 0) === 0)
  const zeroCssVars = ok.filter((r) => (r.cssVariables ?? 0) === 0)
  const zeroBoth = ok.filter((r) => (r.coloredButtonBg ?? 0) === 0 && (r.cssVariables ?? 0) === 0)
  const zeroLogos = ok.filter((r) => (r.logoCandidates ?? 0) === 0)

  console.log(`\n--- Among successful fetches (${ok.length}) ---`)
  console.log(`Zero colored button backgrounds: ${zeroColoredButtons.length} (${pct(zeroColoredButtons.length, ok.length)})`)
  console.log(`Zero brand CSS variables: ${zeroCssVars.length} (${pct(zeroCssVars.length, ok.length)})`)
  console.log(`Zero color signal at all (both): ${zeroBoth.length} (${pct(zeroBoth.length, ok.length)})`)
  console.log(`Zero logo candidates: ${zeroLogos.length} (${pct(zeroLogos.length, ok.length)})`)

  console.log('\n--- "Zero color signal" sites by category ---')
  console.log([...zeroBoth.reduce((m, r) => m.set(r.category, (m.get(r.category) ?? 0) + 1), new Map<string, number>())])
  console.log('Sites with zero color signal:', zeroBoth.map((r) => r.url))

  console.log('\n--- "Zero logo" sites ---')
  console.log(zeroLogos.map((r) => r.url))

  const sourceCounts = new Map<string, number>()
  for (const r of ok) for (const s of r.logoSources ?? []) sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1)
  console.log('\n--- Logo source distribution (across all candidates found) ---')
  console.log([...sourceCounts.entries()].sort((a, b) => b[1] - a[1]))

  console.log('\n--- Avg timing (ms) ---')
  console.log((ok.reduce((s, r) => s + r.ms, 0) / ok.length).toFixed(0))

  console.log('\n--- Failure reason breakdown ---')
  const failureCounts = new Map<string, number>()
  for (const r of failed) {
    const key = `${r.status}: ${(r.error ?? 'unknown').slice(0, 60)}`
    failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1)
  }
  console.log([...failureCounts.entries()].sort((a, b) => b[1] - a[1]))
}

main()
