import type { CSSProperties, SyntheticEvent } from 'react'
import type { SiteTheme, ThemeValues } from '../types'
import fallbackLogo from '../assets/logo.svg'

export const DEFAULT_COLORS = { primary: '#4f46e5', secondary: '#e5e7eb' }

export const readableTextOn = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.179 ? '#ffffff' : '#111827'
}

// Use on <img onError>; also set referrerPolicy="no-referrer" on logo images
export const showFallbackLogo = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.onerror = null
  e.currentTarget.src = fallbackLogo
}

// Priority: user custom → suggested → defaults
export const resolveTheme = (theme?: SiteTheme, custom: ThemeValues | undefined = theme?.custom) => {
  const values = theme ? { ...theme.suggested, ...custom } : {}
  return {
    primary: values.primary ?? DEFAULT_COLORS.primary,
    secondary: values.secondary ?? DEFAULT_COLORS.secondary,
    logo: values.logo ?? fallbackLogo,
  }
}

export const themeVariables = ({ primary, secondary }: { primary: string; secondary: string }) => ({
  '--primary': primary,
  '--secondary': secondary,
  '--on-primary': readableTextOn(primary),
  '--on-secondary': readableTextOn(secondary),
}) as CSSProperties

export { fallbackLogo }
