// Category schema for Composio and system integrations in Amethyst
export const CONNECTOR_CATEGORIES = [
  {
    id: 'developer',
    title: 'Developer Tools & Code',
    shortTitle: 'Developer',
    desc: 'Source control, CI/CD, issue trackers, terminal tooling, databases, and cloud infrastructure.',
    matchCategories: [
      'developer tools',
      'databases',
      'model context protocol',
      'infrastructure',
      'security & identity tools',
      'server monitoring',
    ],
    matchSlugs: [
      'github',
      'linear',
      'gitlab',
      'supabase',
      'jira',
      'sentry',
      'posthog',
      'bitbucket',
      'docker',
      's3',
    ],
  },
  {
    id: 'ai',
    title: 'AI, Agents & LLM Tools',
    shortTitle: 'AI & Agents',
    desc: 'Intelligent model providers, autonomous agents, prompt execution, and multimodal AI.',
    matchCategories: [
      'artificial intelligence',
      'ai chatbots',
      'ai agents',
    ],
    matchSlugs: [
      'openai',
      'anthropic',
      'perplexity',
      'gemini',
      'elevenlabs',
      'replicate',
      'groq',
      'huggingface',
    ],
  },
  {
    id: 'communication',
    title: 'Communication & Messaging',
    shortTitle: 'Communication',
    desc: 'Real-time team messaging, inbox dispatch, SMS, and video conferencing.',
    matchCategories: [
      'communication',
      'email',
      'phone & sms',
      'email newsletters',
      'team chat',
      'messaging',
    ],
    matchSlugs: [
      'slack',
      'gmail',
      'discord',
      'zoom',
      'telegram',
      'teams',
      'twilio',
      'sendgrid',
      'outlook',
    ],
  },
  {
    id: 'productivity',
    title: 'Productivity, Docs & Projects',
    shortTitle: 'Productivity',
    desc: 'Collaborative workspaces, cloud documents, sheets, scheduling, and project boards.',
    matchCategories: [
      'productivity',
      'project management',
      'documents',
      'scheduling & booking',
      'forms & surveys',
      'spreadsheets',
      'notes',
      'file management & storage',
      'time tracking software',
      'team collaboration',
      'signatures',
      'task management',
    ],
    matchSlugs: [
      'notion',
      'googledrive',
      'google_drive',
      'googlecalendar',
      'googlesheets',
      'googledocs',
      'airtable',
      'asana',
      'clickup',
      'trello',
      'coda',
      'todoist',
      'dropbox',
    ],
  },
  {
    id: 'web',
    title: 'Web Scraping, Search & Research',
    shortTitle: 'Web & Research',
    desc: 'Live internet search engines, deep web crawlers, content extractors, and research tools.',
    matchCategories: [
      'web scraping & browser',
      'web search & research',
      'web & data',
      'search',
      'scraping',
      'places & weather',
      'people & contact data',
    ],
    matchSlugs: [
      'tavily',
      'firecrawl',
      'exa',
      'duckduckgo',
      'perplexity',
      'web_scraper',
      'wikipedia',
      'hackernews',
      'arxiv',
      'serper',
    ],
  },
  {
    id: 'crm_commerce',
    title: 'CRM, Sales & Commerce',
    shortTitle: 'CRM & Sales',
    desc: 'Customer relationships, marketing automation, e-commerce, and billing platforms.',
    matchCategories: [
      'crm',
      'marketing automation',
      'ecommerce',
      'accounting',
      'sales',
      'payment',
      'finance',
      'payment processing',
    ],
    matchSlugs: [
      'hubspot',
      'salesforce',
      'stripe',
      'shopify',
      'pipedrive',
      'zoho',
      'chargebee',
      'quickbooks',
    ],
  },
  {
    id: 'media_social',
    title: 'Design, Media & Social',
    shortTitle: 'Design & Media',
    desc: 'Vector design, image generation, audio streaming, and social broadcasting.',
    matchCategories: [
      'images & design',
      'video & audio',
      'social media accounts',
      'social media marketing',
      'media',
      'social',
      'community',
    ],
    matchSlugs: [
      'figma',
      'canva',
      'adobe',
      'spotify',
      'youtube',
      'twitter',
      'x',
      'reddit',
      'medium',
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics & Observability',
    shortTitle: 'Analytics',
    desc: 'Product telemetry, event tracking, performance diagnostics, and metrics.',
    matchCategories: ['analytics'],
    matchSlugs: ['google-analytics', 'mixpanel', 'segment', 'amplitude'],
  },
]

export function categorizeCards(cards = []) {
  const sections = []
  const allocatedSlugs = new Set()

  for (const catDef of CONNECTOR_CATEGORIES) {
    const matched = cards.filter((c) => {
      const slug = (c.slug || c.name || '').toLowerCase()
      const cat = (c.category || '').toLowerCase()
      if (
        (catDef.matchCategories.includes(cat) ||
          catDef.matchSlugs.includes(slug)) &&
        !allocatedSlugs.has(slug)
      ) {
        allocatedSlugs.add(slug)
        return true
      }
      return false
    })

    if (matched.length > 0) {
      sections.push({
        ...catDef,
        cards: matched,
      })
    }
  }

  // Catch remaining cards into a clean Utilities / Other Integrations bucket
  const remaining = cards.filter(
    (c) => !allocatedSlugs.has((c.slug || c.name || '').toLowerCase())
  )
  if (remaining.length > 0) {
    sections.push({
      id: 'other',
      title: 'General Utilities & Extended Tools',
      shortTitle: 'Other Tools',
      desc: 'Calculators, weather, location services, and specialized integration tools.',
      cards: remaining,
    })
  }

  return sections
}
