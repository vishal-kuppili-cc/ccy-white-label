import { useState, type FormEvent } from 'react'
import { fetchPageTheme } from './services/pageTheme'
import type { SiteItem, ThemeValues } from './types'
import { resolveTheme, showFallbackLogo, themeVariables } from './utils/theme'
import './App.css'

function App() {
  const [url, setUrl] = useState('')
  const [item, setItem] = useState<SiteItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const { suggested, logoOptions } = await fetchPageTheme(url.trim())
      setItem({
        url: url.trim(),
        theme: { suggested, logoOptions, generatedAt: new Date().toISOString() },
      })
    } catch (err) {
      setError((err as Error).message)
      setItem(null)
    } finally {
      setLoading(false)
    }
  }

  const setCustom = (patch: ThemeValues) => {
    setItem((current) => {
      if (!current?.theme) return current
      return { ...current, theme: { ...current.theme, custom: { ...current.theme.custom, ...patch } } }
    })
  }

  const theme = resolveTheme(item?.theme)

  return (
    <div id="page">
      <header>
        <h1>Site Theme Extraction</h1>
        <p>Paste a public website URL to pull its brand colours and logo into a themed preview.</p>
      </header>

      <form onSubmit={generate} className="url-form">
        <input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Analyzing…' : 'Generate theme'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {item?.theme && (
        <div className="result">
          <section className="preview-card" style={themeVariables(theme)}>
            <img
              src={theme.logo}
              alt="Site logo"
              referrerPolicy="no-referrer"
              onError={showFallbackLogo}
              className="preview-logo"
            />
            <p className="preview-url">{item.url}</p>
            <div className="preview-buttons">
              <button type="button" className="btn-primary">
                Primary
              </button>
              <button type="button" className="btn-secondary">
                Secondary
              </button>
            </div>
          </section>

          <section className="overrides">
            <h2>Fine-tune</h2>
            <label>
              Primary colour
              <input
                type="color"
                value={theme.primary}
                onChange={(e) => setCustom({ primary: e.target.value })}
              />
            </label>
            <label>
              Secondary colour
              <input
                type="color"
                value={theme.secondary}
                onChange={(e) => setCustom({ secondary: e.target.value })}
              />
            </label>

            {item.theme.logoOptions.length > 1 && (
              <div className="logo-options">
                <span>Logo</span>
                <div className="logo-grid">
                  {item.theme.logoOptions.map((logoUrl) => (
                    <button
                      key={logoUrl}
                      type="button"
                      className={logoUrl === theme.logo ? 'logo-choice selected' : 'logo-choice'}
                      onClick={() => setCustom({ logo: logoUrl })}
                    >
                      <img src={logoUrl} alt="" referrerPolicy="no-referrer" onError={showFallbackLogo} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="meta">Generated {new Date(item.theme.generatedAt).toLocaleString()}</p>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
