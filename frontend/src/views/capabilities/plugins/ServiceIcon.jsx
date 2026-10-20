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
  Sparkles,
} from 'lucide-react'

const THESVG_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/glincker/thesvg@v0.6.0/public/icons'

const THESVG_MAPPINGS = {
  gmail: 'gmail',
  googledrive: 'google-drive',
  google_drive: 'google-drive',
  googlecalendar: 'google-calendar',
  googlesheets: 'google-sheets',
  googledocs: 'google-docs',
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
}

const DOMAIN_MAPPINGS = {
  gmail: 'mail.google.com',
  googledrive: 'drive.google.com',
  google_drive: 'drive.google.com',
  googlecalendar: 'calendar.google.com',
  googlesheets: 'sheets.google.com',
  googledocs: 'docs.google.com',
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
  weather: CloudSun,
  health: Heart,
  terminal: Terminal,
  filesystem: FolderTree,
  files: FolderTree,
  mcp: Server,
}

export default function ServiceIcon({ card, size = 'default' }) {
  // stage:
  // 0 = primary (card.logo or Composio API)
  // 1 = secondary (thesvg CDN)
  // 2 = tertiary (Google high-res faviconV2)
  // 3 = quaternary (Google S2 favicon)
  // 4 = vector icon or monogram
  const [stage, setStage] = useState(0)

  // Reset stage whenever card changes
  useEffect(() => {
    setStage(0)
  }, [card?.slug, card?.logo, card?.domain])

  const slug = (card?.slug || card?.name || '').toLowerCase().trim()
  const sizeClass =
    size === 'hero' || size === 'large'
      ? 'is-large'
      : size === 'tiny'
        ? 'is-tiny'
        : size === 'small'
          ? 'is-small'
          : ''
  const vectorIconSize =
    size === 'hero' || size === 'large' ? 36 : size === 'tiny' ? 12 : size === 'small' ? 16 : 24

  // Resolve URLs
  const composioLogo =
    card?.logo || (slug ? `https://logos.composio.dev/api/${slug}` : null)
  const thesvgSlug = THESVG_MAPPINGS[slug]
  const thesvgUrl = thesvgSlug
    ? `${THESVG_CDN_BASE}/${thesvgSlug}/default.svg`
    : null
  const domain = card?.domain || DOMAIN_MAPPINGS[slug]
  const gstaticUrl = domain
    ? `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`
    : null
  const googleS2Url = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    : null

  // 0: Composio / explicit card.logo
  if (stage === 0 && composioLogo) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={composioLogo}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(thesvgUrl ? 1 : gstaticUrl ? 2 : 4)}
        />
      </div>
    )
  }

  // 1: TheSVG CDN
  if (stage <= 1 && thesvgUrl) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={thesvgUrl}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(gstaticUrl ? 2 : 4)}
        />
      </div>
    )
  }

  // 2: Google gstatic faviconV2 (high-res 128px)
  if (stage <= 2 && gstaticUrl) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={gstaticUrl}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(googleS2Url ? 3 : 4)}
        />
      </div>
    )
  }

  // 3: Google S2 favicon
  if (stage <= 3 && googleS2Url) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={googleS2Url}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(4)}
        />
      </div>
    )
  }

  // 4: Lucide Vector Icon if known
  const LucideIcon = TOOL_ICONS[slug]
  if (LucideIcon) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <LucideIcon
          size={vectorIconSize}
          className="text-accent shrink-0"
          strokeWidth={1.8}
        />
      </div>
    )
  }

  // Fallback: Crisp Monogram
  const letter = (card?.label || card?.name || card?.slug || '?')
    .slice(0, 1)
    .toUpperCase()

  return (
    <div className={`plugin-squircle-icon-box ${sizeClass}`}>
      <span className="plugin-squircle-icon-monogram">{letter}</span>
    </div>
  )
}
