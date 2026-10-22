export interface ThemeValues {
  primary?: string | null
  secondary?: string | null
  logo?: string | null
}

export interface SiteTheme {
  suggested: ThemeValues // from the AI/fallback
  custom?: ThemeValues // user overrides
  logoOptions: string[]
  generatedAt: string
}

export interface SiteItem {
  url: string
  theme?: SiteTheme
}
