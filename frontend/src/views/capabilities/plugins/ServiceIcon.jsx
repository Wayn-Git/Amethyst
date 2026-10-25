import { useState, useEffect } from 'react'
import {
  Calculator,
  Database,
  Globe,
  CloudSun,
  Heart,
  Terminal,
  FolderTree,
  Server,
  Layers,
  BookOpen,
} from 'lucide-react'

const THESVG_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/glincker/thesvg@v0.6.0/public/icons'

const THESVG_MAPPINGS = {
  gmail: 'gmail',
  googledrive: 'google-drive',
  google_drive: 'google-drive',
  'google-drive': 'google-drive',
  googlecalendar: 'google-calendar',
  google_calendar: 'google-calendar',
  'google-calendar': 'google-calendar',
  googlesheets: 'google-sheets',
  google_sheets: 'google-sheets',
  'google-sheets': 'google-sheets',
  googledocs: 'google-docs',
  google_docs: 'google-docs',
  'google-docs': 'google-docs',
  github: 'github',
  slack: 'slack',
  notion: 'notion',
  linear: 'linear',
  jira: 'jira',
  asana: 'asana',
  trello: 'trello',
  sentry: 'sentry',
  posthog: 'posthog',
  discord: 'discord',
  twitter: 'twitter',
  x: 'twitter',
  reddit: 'reddit',
  zapier: 'zapier',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  dropbox: 'dropbox',
  airtable: 'airtable',
  figma: 'figma',
  stripe: 'stripe',
  spotify: 'spotify',
  supabase: 'supabase',
  canva: 'canva',
  adobe: 'adobe',
  gitlab: 'gitlab',
  bitbucket: 'bitbucket',
  outlook: 'microsoft-outlook',
  telegram: 'telegram',
  whatsapp: 'whatsapp',
  zoom: 'zoom',
  clickup: 'clickup',
  todoist: 'todoist',
  zendesk: 'zendesk',
  intercom: 'intercom',
}

const DOMAIN_MAPPINGS = {
  gmail: 'mail.google.com',
  googledrive: 'drive.google.com',
  google_drive: 'drive.google.com',
  'google-drive': 'drive.google.com',
  googlecalendar: 'calendar.google.com',
  google_calendar: 'calendar.google.com',
  'google-calendar': 'calendar.google.com',
  googlesheets: 'sheets.google.com',
  google_sheets: 'sheets.google.com',
  'google-sheets': 'sheets.google.com',
  googledocs: 'docs.google.com',
  google_docs: 'docs.google.com',
  'google-docs': 'docs.google.com',
  github: 'github.com',
  slack: 'slack.com',
  notion: 'notion.so',
  linear: 'linear.app',
  supabase: 'supabase.com',
  sentry: 'sentry.io',
  posthog: 'posthog.com',
  discord: 'discord.com',
  twitter: 'x.com',
  x: 'x.com',
  reddit: 'reddit.com',
  zapier: 'zapier.com',
  hubspot: 'hubspot.com',
  salesforce: 'salesforce.com',
  jira: 'atlassian.com',
  asana: 'asana.com',
  trello: 'trello.com',
  dropbox: 'dropbox.com',
  airtable: 'airtable.com',
  figma: 'figma.com',
  stripe: 'stripe.com',
  spotify: 'spotify.com',
  canva: 'canva.com',
  adobe: 'adobe.com',
  medium: 'medium.com',
  tavily: 'tavily.com',
  firecrawl: 'firecrawl.dev',
  exa: 'exa.ai',
  langsearch: 'langsearch.com',
  composio: 'composio.dev',
  duckduckgo: 'duckduckgo.com',
  wikipedia: 'wikipedia.org',
  hackernews: 'news.ycombinator.com',
  arxiv: 'arxiv.org',
  weather: 'weather.com',
  health: 'apple.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
  zoom: 'zoom.us',
  clickup: 'clickup.com',
  todoist: 'todoist.com',
  zendesk: 'zendesk.com',
  intercom: 'intercom.com',
}

const TOOL_ICONS = {
  calculator: Calculator,
  sql: Database,
  web_scraper: Globe,
  webscraper: Globe,
  weather: CloudSun,
  health: Heart,
  terminal: Terminal,
  filesystem: FolderTree,
  files: FolderTree,
  mcp: Server,
  duckduckgo: Globe,
  wikipedia: BookOpen,
  arxiv: Layers,
  hackernews: Terminal,
}

export default function ServiceIcon({ card, size = 'default' }) {
  // stage:
  // 0 = primary (thesvg CDN or explicit custom non-Composio logo)
  // 1 = Google high-res faviconV2 (128px)
  // 2 = Google S2 favicon
  // 3 = Composio API logo
  // 4 = monogram
  const [stage, setStage] = useState(0)

  useEffect(() => {
    setStage(0)
  }, [card?.slug, card?.logo, card?.domain])

  const slug = (card?.slug || card?.name || '').toLowerCase().trim()
  const cleanSlug = slug.replace(/[-_]/g, '')
  const sizeClass =
    size === 'hero' || size === 'large'
      ? 'is-large'
      : size === 'tiny'
        ? 'is-tiny'
        : size === 'small'
          ? 'is-small'
          : ''
  const vectorIconSize =
    size === 'hero' || size === 'large' ? 36 : size === 'tiny' ? 14 : size === 'small' ? 16 : 26

  // Built-in tool vectors (e.g. calculator, sql, web_scraper) render directly without network fallback grid
  const ToolIcon = TOOL_ICONS[slug] || TOOL_ICONS[cleanSlug]
  if (ToolIcon) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <ToolIcon size={vectorIconSize} className="text-dim" />
      </div>
    )
  }

  const isComposioCdn =
    typeof card?.logo === 'string' && card.logo.includes('logos.composio.dev')
  const customLogo = card?.logo && !isComposioCdn ? card.logo : null

  const thesvgSlug = THESVG_MAPPINGS[slug] || THESVG_MAPPINGS[cleanSlug]
  const thesvgUrl = thesvgSlug
    ? `${THESVG_CDN_BASE}/${thesvgSlug}/default.svg`
    : null

  const domain = card?.domain || DOMAIN_MAPPINGS[slug] || DOMAIN_MAPPINGS[cleanSlug]
  const gstaticUrl = domain
    ? `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`
    : null
  const googleS2Url = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    : null

  const composioLogo = card?.logo || (slug ? `https://logos.composio.dev/api/${cleanSlug || slug}` : null)

  // Primary source: custom non-composio logo, or official thesvg vector, or Google 128px favicon
  const primaryUrl = customLogo || thesvgUrl || gstaticUrl || composioLogo

  // 0: Primary (thesvg vector or custom non-Composio logo)
  if (stage === 0 && primaryUrl) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={primaryUrl}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => {
            if (gstaticUrl && primaryUrl !== gstaticUrl) setStage(1)
            else if (googleS2Url) setStage(2)
            else if (composioLogo && primaryUrl !== composioLogo) setStage(3)
            else setStage(4)
          }}
        />
      </div>
    )
  }

  // 1: Google gstatic faviconV2 (high-res 128px)
  if (stage <= 1 && gstaticUrl) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={gstaticUrl}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(googleS2Url ? 2 : composioLogo ? 3 : 4)}
        />
      </div>
    )
  }

  // 2: Google S2 favicon
  if (stage <= 2 && googleS2Url) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={googleS2Url}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(composioLogo ? 3 : 4)}
        />
      </div>
    )
  }

  // 3: Composio API logo
  if (stage <= 3 && composioLogo) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={composioLogo}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(4)}
        />
      </div>
    )
  }

  // Monogram fallback
  const label = card?.label || card?.name || slug
  const letter = (label[0] || '?').toUpperCase()
  const hues = [210, 260, 290, 330, 25, 140, 175]
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash << 5) - hash + slug.charCodeAt(i)
    hash |= 0
  }
  const hue = hues[Math.abs(hash) % hues.length]

  return (
    <div className={`plugin-squircle-icon-box ${sizeClass}`}>
      <div
        className="plugin-squircle-icon-monogram"
        style={{
          background: `hsl(${hue}, 45%, 18%)`,
          color: `hsl(${hue}, 85%, 72%)`,
          border: `1px solid hsl(${hue}, 40%, 28%)`,
        }}
      >
        {letter}
      </div>
    </div>
  )
}
