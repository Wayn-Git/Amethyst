/* Service & Brand Icons powered by theSVG (thesvg.org) & high-precision vector primitives.
   6,500+ authentic vector brand marks served via immutable CDN with zero tracing errors.
   Follows Apple Human Interface Guidelines: squircle bounds, ambient specular rims, and fluid haptic states.
*/

import { useState } from 'react'

const THESVG_CDN_BASE = 'https://cdn.jsdelivr.net/gh/glincker/thesvg@v0.6.0/public/icons'

/* Canonical slug mappings for the entire catalogue and ecosystem integrations */
const ICON_SLUGS = {
  // Agent Core Tools
  'chrome-devtools': { slug: 'chrome', variant: 'default' },
  chrome: { slug: 'chrome', variant: 'default' },
  playwright: { slug: 'playwright', variant: 'default' },
  exa: { slug: 'exa', variant: 'color' },
  tavily: { slug: 'tavily', variant: 'color' },
  firecrawl: { slug: 'firecrawl', variant: 'default', invertDark: true },
  thesvg: { slug: 'thesvg', variant: 'default' },

  // User Connectors
  github: { slug: 'github', variant: 'default', invertDark: true },
  vercel: { slug: 'vercel', variant: 'default', invertDark: true },
  apple: { slug: 'apple', variant: 'default', invertDark: true },
  'microsoft-todo': { slug: 'microsoft-todo', variant: 'default' },
  microsoft: { slug: 'microsoft', variant: 'default' },
  linkedin: { slug: 'linkedin', variant: 'default' },
  spotify: { slug: 'spotify', variant: 'default' },

  // Google Workspace apps
  google: { slug: 'google', variant: 'default' },
  'google-workspace': { slug: 'google', variant: 'default' },
  gmail: { slug: 'gmail', variant: 'default' },
  'google-gmail': { slug: 'gmail', variant: 'default' },
  calendar: { slug: 'google-calendar', variant: 'default' },
  'google-calendar': { slug: 'google-calendar', variant: 'default' },
  drive: { slug: 'google-drive', variant: 'default' },
  'google-drive': { slug: 'google-drive', variant: 'default' },
  docs: { slug: 'google-docs', variant: 'default' },
  'google-docs': { slug: 'google-docs', variant: 'default' },
  sheets: { slug: 'google-sheets', variant: 'default' },
  'google-sheets': { slug: 'google-sheets', variant: 'default' },
  slides: { slug: 'google-slides', variant: 'default' },
  'google-slides': { slug: 'google-slides', variant: 'default' },
  forms: { slug: 'google-forms', variant: 'default' },
  'google-forms': { slug: 'google-forms', variant: 'default' },
  tasks: { slug: 'google-tasks', variant: 'default' },
  'google-tasks': { slug: 'google-tasks', variant: 'default' },
  chat: { slug: 'google-chat', variant: 'default' },
  'google-chat': { slug: 'google-chat', variant: 'default' },
  maps: { slug: 'google-maps', variant: 'default' },
  'google-maps': { slug: 'google-maps', variant: 'default' },

  // Popular Ecosystem Services
  slack: { slug: 'slack', variant: 'default' },
  notion: { slug: 'notion', variant: 'default' },
  figma: { slug: 'figma', variant: 'default' },
  stripe: { slug: 'stripe', variant: 'default' },
  dropbox: { slug: 'dropbox', variant: 'default' },
  canva: { slug: 'canva', variant: 'default' },
  hubspot: { slug: 'hubspot', variant: 'default' },
  trello: { slug: 'trello', variant: 'default' },
  discord: { slug: 'discord', variant: 'default' },
  linear: { slug: 'linear', variant: 'default' },
  raycast: { slug: 'raycast', variant: 'default' },
  resend: { slug: 'resend', variant: 'default', invertDark: true },
  supabase: { slug: 'supabase', variant: 'default' },
  openai: { slug: 'openai', variant: 'default', invertDark: true },
  anthropic: { slug: 'anthropic', variant: 'default', invertDark: true },
  docker: { slug: 'docker', variant: 'default' },
  aws: { slug: 'aws', variant: 'default' },
  cloudflare: { slug: 'cloudflare', variant: 'default' },
}

/* System primitives that represent abstract concepts rather than commercial brands */
const PRIMITIVES = new Set(['fetch', 'memory', 'browser'])

export default function ServiceIcon({ name, size = 34, kind = 'connector', className = '' }) {
  const [loadFailed, setLoadFailed] = useState(false)

  const cleanName = (name || '').toLowerCase().trim()
  const mapping = ICON_SLUGS[cleanName]
  const isPrimitive = PRIMITIVES.has(cleanName) || kind === 'skill'

  // Dynamic CDN URL calculation
  let iconUrl = null
  let invertOnDark = false

  if (mapping) {
    iconUrl = `${THESVG_CDN_BASE}/${mapping.slug}/${mapping.variant || 'default'}.svg`
    invertOnDark = !!mapping.invertDark
  } else if (!isPrimitive && cleanName && !loadFailed) {
    // Attempt automatic theSVG resolution for any named connector (e.g. "airtable", "jira", etc.)
    iconUrl = `${THESVG_CDN_BASE}/${encodeURIComponent(cleanName)}/default.svg`
  }

  // 1. theSVG Brand Vector Graphic
  if (iconUrl && !loadFailed) {
    return (
      <span
        className={`apple-svc-tile apple-svc--brand ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
        }}
        aria-hidden="true"
      >
        <img
          src={iconUrl}
          alt=""
          className={`apple-svc-img${invertOnDark ? ' apple-svc-invert' : ''}`}
          style={{
            maxWidth: invertOnDark ? '82%' : '100%',
            maxHeight: invertOnDark ? '82%' : '100%',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
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
        className={`apple-svc-tile apple-svc--primitive apple-svc--${cleanName} ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
        }}
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
          {cleanName === 'fetch' && (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M3.6 12h16.8" />
              <path d="M12 3c2.5 2.7 3.8 5.8 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.8-3.8-9s1.3-6.3 3.8-9z" />
            </>
          )}
          {cleanName === 'memory' && (
            <>
              <circle cx="6.5" cy="8.5" r="2.5" />
              <circle cx="17.5" cy="7.5" r="2.5" />
              <circle cx="13" cy="17" r="2.8" />
              <path d="M8.6 9.8 11.4 15M9 7.8l6-.2M15.5 9.4 14 14.5" />
            </>
          )}
          {cleanName === 'browser' && (
            <>
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M3 9h18" />
              <circle cx="6.5" cy="6.5" r=".75" fill="currentColor" />
              <circle cx="9.5" cy="6.5" r=".75" fill="currentColor" />
              <circle cx="12.5" cy="6.5" r=".75" fill="currentColor" />
            </>
          )}
          {!['fetch', 'memory', 'browser'].includes(cleanName) && (
            <>
              <path d="M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14l-7-3-7 3V6z" />
              <path d="M9 9h6M9 13h4" />
            </>
          )}
        </svg>
      </span>
    )
  }

  // 3. Apple-grade Monogram Fallback Tile
  return (
    <span
      className={`apple-svc-tile apple-svc--monogram ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        fontSize: Math.max(11, Math.round(size * 0.44)),
      }}
      aria-hidden="true"
    >
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}
