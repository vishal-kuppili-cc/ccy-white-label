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
  const heroColors = summary.heroBackgrounds
    .slice(0, MAX_COLOR_OPTIONS)
    .map((c, i) => `${i + 1}. ${c.color} (used ${c.count} times${c.neutral ? ', neutral' : ''})`)
  const logos = summary.logoCandidates.map((l, i) => {
    const label = l.url.startsWith('data:') ? '(inline SVG)' : l.url.split('/').pop()?.split('?')[0]
    return `${i + 1}. ${l.source}: ${label}`
  })
  return [
    'Button background colours, most used first:', ...(colors.length ? colors : ['(none found)']), '',
    'Brand colour variables:', ...(variables.length ? variables : ['(none found)']), '',
    'Hero/banner background colours (use only if no button colour fits better):',
    ...(heroColors.length ? heroColors : ['(none found)']), '',
    'Logo options:', ...(logos.length ? logos : ['(none found)']), '',
    'Choose the primary button colour, the secondary button colour, and the number of the best logo.',
  ].join('\n')
}

const rankedColors = (summary: PageSummary) => [
  ...new Set([
    ...summary.buttonBackgrounds.filter((c) => !c.neutral).map((c) => c.color),
    ...Object.values(summary.cssVariables),
    // Hero/banner background colour: a real signal (confirmed in benchmarking for
    // consumer/food brands that colour their hero section, not their CTA button), but
    // weaker than an actual button colour or a named brand variable, so it ranks after both.
    ...summary.heroBackgrounds.filter((c) => !c.neutral).map((c) => c.color),
    ...summary.buttonBackgrounds.filter((c) => c.neutral).map((c) => c.color),
    ...summary.heroBackgrounds.filter((c) => c.neutral).map((c) => c.color),
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
  const neutrals = new Set(
    [...summary.buttonBackgrounds, ...summary.heroBackgrounds].filter((c) => c.neutral).map((c) => c.color)
  )
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

  const isLabelled = (l: { source: string }) =>
    l.source === 'inline-svg' || l.source === 'header-img' || l.source === 'img'
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
