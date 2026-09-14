import { useState } from 'react'
import AiProviderIcon from './AiProviderIcon.jsx'

const THESVG_CDN_BASE = 'https://cdn.jsdelivr.net/gh/glincker/thesvg@v0.6.0/public/icons'

/* Canonical slug mappings for ecosystem integrations */
const ICON_SLUGS = {
  'chrome-devtools': { slug: 'chrome', variant: 'default' },
  chrome: { slug: 'chrome', variant: 'default' },
  playwright: { slug: 'playwright', variant: 'default' },
  exa: { slug: 'exa', variant: 'color' },
  tavily: { slug: 'tavily', variant: 'color' },
  firecrawl: { slug: 'firecrawl', variant: 'default', invertDark: true },
  thesvg: { slug: 'thesvg', variant: 'default' },
  github: { slug: 'github', variant: 'default', invertDark: true },
  vercel: { slug: 'vercel', variant: 'default', invertDark: true },
  apple: { slug: 'apple', variant: 'default', invertDark: true },
  'microsoft-todo': { slug: 'microsoft-todo', variant: 'default' },
  microsoft: { slug: 'microsoft', variant: 'default' },
  linkedin: { slug: 'linkedin', variant: 'default' },
  spotify: { slug: 'spotify', variant: 'default' },
  google: { slug: 'google', variant: 'default' },
  'google-workspace': { slug: 'google', variant: 'default' },
  gmail: { slug: 'gmail', variant: 'default' },
  calendar: { slug: 'google-calendar', variant: 'default' },
  drive: { slug: 'google-drive', variant: 'default' },
  docs: { slug: 'google-docs', variant: 'default' },
  sheets: { slug: 'google-sheets', variant: 'default' },
  slack: { slug: 'slack', variant: 'default' },
  notion: { slug: 'notion', variant: 'default' },
  figma: { slug: 'figma', variant: 'default' },
  stripe: { slug: 'stripe', variant: 'default' },
  docker: { slug: 'docker', variant: 'default' },
}

const AI_PROVIDERS = new Set([
  'openai', 'anthropic', 'google', 'gemini', 'mistral', 'codestral',
  'deepseek', 'meta', 'llama', 'moonshot', 'kimi', 'minimax',
  'qwen', 'alibaba', 'nvidia', 'cloudflare', 'ollama', 'groq',
  'cohere', 'nous', 'kilocode', 'opencode', 'openrouter', 'auto', 'all'
])

const PRIMITIVES = new Set(['fetch', 'memory', 'browser'])

export default function ServiceIcon({
  name,
  service,
  provider,
  slug,
  size = 24,
  kind = 'connector',
  className = '',
}) {
  const [loadFailed, setLoadFailed] = useState(false)
  const raw = (name || service || provider || slug || '').toLowerCase().trim()

  // 1. AI Provider Vector Check
  const isAi =
    AI_PROVIDERS.has(raw) ||
    raw.startsWith('@cf') ||
    raw.includes('kimi') ||
    raw.includes('llama') ||
    raw.includes('gemini') ||
    raw.includes('mistral') ||
    raw.includes('gpt') ||
    raw.includes('claude') ||
    raw.includes('deepseek')

  if (isAi) {
    return (
      <span
        className={`apple-svc-tile apple-svc--ai ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-hidden="true"
      >
        <AiProviderIcon provider={raw} size={Math.round(size * 0.78)} />
      </span>
    )
  }

  const mapping = ICON_SLUGS[raw]
  const isPrimitive = PRIMITIVES.has(raw) || kind === 'skill'

  let iconUrl = null
  let invertOnDark = false

  if (mapping) {
    iconUrl = `${THESVG_CDN_BASE}/${mapping.slug}/${mapping.variant || 'default'}.svg`
    invertOnDark = !mapping.invertDark
  } else if (!isPrimitive && raw && !loadFailed) {
    iconUrl = `${THESVG_CDN_BASE}/${encodeURIComponent(raw)}/default.svg`
  }

  if (iconUrl && !loadFailed) {
    return (
      <span
        className={`apple-svc-tile apple-svc--brand ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        aria-hidden="true"
      >
        <img
          src={iconUrl}
          alt=""
          className={`apple-svc-img${invertOnDark ? ' apple-svc-invert' : ''}`}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onError={() => setLoadFailed(true)}
          loading="eager"
        />
      </span>
    )
  }

  // 2. High-precision Primitives (Fetch, Memory, Skills)
  if (isPrimitive) {
    return (
      <span
        className={`apple-svc-tile apple-svc--primitive apple-svc--${raw} ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        aria-hidden="true"
      >
        <svg
          width={size * 0.58}
          height={size * 0.58}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {raw === 'fetch' && (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M3.6 12h16.8" />
              <path d="M12 3c2.5 2.7 3.8 5.8 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.8-3.8-9s1.3-6.3 3.8-9z" />
            </>
          )}
          {raw === 'memory' && (
            <>
              <circle cx="6.5" cy="8.5" r="2.5" />
              <circle cx="17.5" cy="7.5" r="2.5" />
              <circle cx="13" cy="17" r="2.8" />
              <path d="M8.6 9.8 11.4 15M9 7.8l6-.2M15.5 9.4 14 14.5" />
            </>
          )}
          {raw === 'browser' && (
            <>
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M3 9h18" />
              <circle cx="6.5" cy="6.5" r=".75" fill="currentColor" />
              <circle cx="9.5" cy="6.5" r=".75" fill="currentColor" />
              <circle cx="12.5" cy="6.5" r=".75" fill="currentColor" />
            </>
          )}
          {!['fetch', 'memory', 'browser'].includes(raw) && (
            <>
              <path d="M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14l-7-3-7 3V6z" />
              <path d="M9 9h6M9 13h4" />
            </>
          )}
        </svg>
      </span>
    )
  }

  // 3. Fallback to AiProviderIcon generic chip rather than ugly '?'
  return (
    <span
      className={`apple-svc-tile apple-svc--fallback ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-hidden="true"
    >
      <AiProviderIcon provider={raw} size={Math.round(size * 0.72)} />
    </span>
  )
}
