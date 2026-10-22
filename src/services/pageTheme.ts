import type { SiteTheme } from '../types'

// '' = same origin or a dev proxy (Vite's server.proxy forwards /api to the Express server).
const API_BASE = ''

export async function fetchPageTheme(url: string): Promise<Pick<SiteTheme, 'suggested' | 'logoOptions'>> {
  const res = await fetch(`${API_BASE}/api/page-theme?url=${encodeURIComponent(url)}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Couldn't generate a theme (HTTP ${res.status})`)
  const { primary, secondary, logo, logoOptions } = body
  return { suggested: { primary, secondary, logo }, logoOptions }
}
