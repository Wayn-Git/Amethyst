/**
 * Plugin Detail Data Engine
 * Provides curated prompts, sub-apps (Cloud + Enterprise/Workspace),
 * and dynamic fallback prompt generators for all 520+ Composio connectors.
 */

export const CURATED_PROMPTS = {
  github: [
    {
      text: "Explain this repo's authentication using code and docs: components, request flow, and how credentials and tokens are handled",
    },
    {
      text: "Summarize this pull request like a senior reviewer: what changed, what could break, and what tests are missing or weak",
    },
    {
      text: "Turn the last 7 days of commits and merged PRs into a stakeholder update: shipped work, risks, and next steps",
    },
  ],
  slack: [
    {
      text: "Catch me up on today's discussions in #general and list action items assigned to me",
    },
    {
      text: "Draft a concise project launch announcement and share it to #announcements for team feedback",
    },
    {
      text: "Search message history for decisions made regarding the API auth refactor last week",
    },
  ],
  gmail: [
    {
      text: "Summarize the last 5 unread messages from clients and flag any urgent requests requiring response today",
    },
    {
      text: "Draft a polite follow-up email to the security audit team about pending SOC2 questionnaire items",
    },
    {
      text: "Search my inbox for recent invoice receipts from cloud infrastructure vendors and list their totals",
    },
  ],
  notion: [
    {
      text: "Search product roadmap specs updated this week and summarize pending milestone deliverables",
    },
    {
      text: "Create a new meeting notes page under Product Team with attendees, key takeaways, and action items",
    },
    {
      text: "Query the Engineering Tasks database for all P0 blockers assigned to the current release sprint",
    },
  ],
  google_drive: [
    {
      text: "Locate the Q4 Marketing Strategy presentation and extract key budget allocations and target goals",
    },
    {
      text: "Search my shared drives for spreadsheets modified in the last 7 days and list their authors",
    },
    {
      text: "Create a shared project folder with view access for the design team and upload the latest assets",
    },
  ],
  linear: [
    {
      text: "List high-priority bugs in the active cycle, their assignees, and target completion dates",
    },
    {
      text: "Create an urgent issue for the OAuth redirect loop with repro steps and tag the backend team",
    },
    {
      text: "Generate a weekly team velocity summary comparing completed vs carry-over story points",
    },
  ],
  jira: [
    {
      text: "Find all unresolved tickets assigned to me in the current sprint and sort by priority",
    },
    {
      text: "Transition ticket PROJ-420 to 'In Review' and add a comment with the PR review link",
    },
    {
      text: "Generate a burndown report for the Q4 platform stability initiative across active boards",
    },
  ],
  supabase: [
    {
      text: "Inspect tables in the public schema and report row counts, primary keys, and recent migration logs",
    },
    {
      text: "Draft a safe SQL migration to add a composite index on organization_id and created_at columns",
    },
    {
      text: "Check row level security policies across user-facing tables and flag any unauthenticated access",
    },
  ],
  stripe: [
    {
      text: "Summarize today's gross volume, new customer subscriptions, and any failed invoice payments",
    },
    {
      text: "Look up customer account details for acct_recent and check their billing tier and card status",
    },
    {
      text: "List refund requests initiated in the past 48 hours along with associated dispute reasons",
    },
  ],
  spotify: [
    {
      text: "Play deep focus playlist on my active audio output device and set volume to comfortable level",
    },
    {
      text: "Search for ambient instrumental electronic tracks and queue them for the next study session",
    },
    {
      text: "Check what is currently playing and save this track to my weekly favorites playlist",
    },
  ],
  figma: [
    {
      text: "Inspect the design system token file and export updated hex colors for dark mode themes",
    },
    {
      text: "List recent comments and design feedback left on the mobile navigation wireframe frames",
    },
    {
      text: "Extract typography specifications and auto-layout paddings from the selected component node",
    },
  ],
  discord: [
    {
      text: "Post an automated build passing notification to the #dev-announcements channel",
    },
    {
      text: "Summarize recent community questions in #general-help and suggest answers based on our docs",
    },
    {
      text: "Send a direct message update to moderator leads regarding upcoming maintenance downtime",
    },
  ],
  docker: [
    {
      text: "List running containers, check resource usage (CPU/memory), and flag any restart loops",
    },
    {
      text: "Inspect build logs for the latest web service container and explain any cache misses",
    },
    {
      text: "Prune dangling container images and unused volumes to reclaim local disk storage",
    },
  ],
  postgres: [
    {
      text: "Inspect slow query logs and suggest optimal indexes for queries exceeding 200ms latency",
    },
    {
      text: "Check active database connections, lock waits, and dead tuples across high-traffic tables",
    },
    {
      text: "Generate an explain analyze summary for the most frequent search query executed today",
    },
  ],
}

/**
 * Curated sub-app definitions for primary toolkits (Matches Apps 2 section in screenshot)
 */
export const CURATED_SUB_APPS = {
  github: [
    {
      id: 'github-cloud',
      name: 'GitHub',
      description: 'Access repositories, issues, and pull requests. Required for some features such as Codex',
      type: 'cloud',
      isEnterprise: false,
    },
    {
      id: 'github-enterprise',
      name: 'GitHub Enterprise',
      description: 'Workspace-specific GitHub connector for a GitHub Enterprise host.',
      type: 'enterprise',
      isEnterprise: true,
    },
  ],
  slack: [
    {
      id: 'slack-cloud',
      name: 'Slack',
      description: 'Send messages, read channels, and manage threads across your team workspace.',
      type: 'cloud',
      isEnterprise: false,
    },
    {
      id: 'slack-grid',
      name: 'Slack Enterprise Grid',
      description: 'Multi-workspace routing and audit compliance for Slack Enterprise Grid organizations.',
      type: 'enterprise',
      isEnterprise: true,
    },
  ],
  google_drive: [
    {
      id: 'gdrive-cloud',
      name: 'Google Drive',
      description: 'Search, view, and organize files and shared documents in Google Workspace.',
      type: 'cloud',
      isEnterprise: false,
    },
    {
      id: 'gdrive-shared',
      name: 'Google Workspace Shared Drives',
      description: 'Domain-restricted team storage with organization-managed security controls.',
      type: 'enterprise',
      isEnterprise: true,
    },
  ],
  notion: [
    {
      id: 'notion-cloud',
      name: 'Notion',
      description: 'Query databases, read pages, and create structured documentation.',
      type: 'cloud',
      isEnterprise: false,
    },
    {
      id: 'notion-enterprise',
      name: 'Notion Enterprise',
      description: 'Enterprise workspace connector with custom domain integration and audit events.',
      type: 'enterprise',
      isEnterprise: true,
    },
  ],
  jira: [
    {
      id: 'jira-cloud',
      name: 'Jira Cloud',
      description: 'Track issues, update sprints, and manage backlog items.',
      type: 'cloud',
      isEnterprise: false,
    },
    {
      id: 'jira-datacenter',
      name: 'Jira Data Center',
      description: 'On-premise enterprise Jira instance with custom host URL and personal API token.',
      type: 'enterprise',
      isEnterprise: true,
    },
  ],
  linear: [
    {
      id: 'linear-cloud',
      name: 'Linear',
      description: 'Streamlined issue tracking, cycles, and project planning for engineering teams.',
      type: 'cloud',
      isEnterprise: false,
    },
    {
      id: 'linear-workspace',
      name: 'Linear Workspace Host',
      description: 'Workspace-specific webhook listener and private organization gateway.',
      type: 'enterprise',
      isEnterprise: true,
    },
  ],
  discord: [
    {
      id: 'discord-user',
      name: 'Discord (User Account)',
      description: 'Access user profile, joined servers, and guild memberships.',
      type: 'cloud',
      isEnterprise: false,
      toolkitSlug: 'discord',
    },
    {
      id: 'discord-bot',
      name: 'Discord Bot',
      description: 'Read server channels, message history, threads, and post automated bot messages.',
      type: 'bot',
      isEnterprise: false,
      toolkitSlug: 'discordbot',
    },
  ],
  telegram: [
    {
      id: 'telegram-user',
      name: 'Telegram (User Account)',
      description: 'Personal account authorization for reading dialogs and contacts.',
      type: 'cloud',
      isEnterprise: false,
      toolkitSlug: 'telegram',
    },
    {
      id: 'telegram-bot',
      name: 'Telegram Bot',
      description: 'Bot API connector for broadcasting updates, commands, and webhook alerts.',
      type: 'bot',
      isEnterprise: false,
      toolkitSlug: 'telegrambot',
    },
  ],
}

/**
 * Developer name mapping
 */
export function getDeveloperName(card) {
  if (!card) return 'OpenAI & Composio'
  const domain = (card.domain || '').toLowerCase()
  const slug = (card.slug || '').toLowerCase()

  if (slug === 'github' || domain.includes('github')) return 'OpenAI'
  if (slug === 'slack' || domain.includes('slack')) return 'Slack Technologies'
  if (slug === 'google_drive' || slug === 'gmail' || domain.includes('google')) return 'Google'
  if (slug === 'notion' || domain.includes('notion')) return 'Notion Labs'
  if (slug === 'linear' || domain.includes('linear')) return 'Linear'
  if (slug === 'jira' || domain.includes('atlassian')) return 'Atlassian'
  if (slug === 'stripe' || domain.includes('stripe')) return 'Stripe'
  if (slug === 'spotify' || domain.includes('spotify')) return 'Spotify AB'
  if (slug === 'figma' || domain.includes('figma')) return 'Figma'
  if (slug === 'supabase' || domain.includes('supabase')) return 'Supabase'
  if (slug === 'discord' || domain.includes('discord')) return 'Discord'
  if (slug === 'docker' || domain.includes('docker')) return 'Docker'

  return 'Composio'
}

/**
 * Smart prompt generator for any connector
 */
export function getPromptSuggestions(card) {
  if (!card) return []
  const slug = (card.slug || '').toLowerCase().replace(/-/g, '_')

  if (CURATED_PROMPTS[slug]) {
    return CURATED_PROMPTS[slug]
  }

  const label = card.label || card.name || slug.replace(/_/g, ' ')
  const blurb = card.blurb || card.description || 'automate actions and query resources'
  const cleanBlurb = blurb.replace(/\.$/, '').toLowerCase()

  return [
    {
      text: `Use ${label} to ${cleanBlurb} and summarize key results for review`,
    },
    {
      text: `Query recent updates and active resources from ${label} and flag any pending action items`,
    },
    {
      text: `Inspect connected records in ${label} and generate a structured status update for the team`,
    },
  ]
}

/**
 * Sub-app definitions generator for any connector
 */
export function getSubApps(card) {
  if (!card) return []
  const slug = (card.slug || '').toLowerCase().replace(/-/g, '_')

  if (CURATED_SUB_APPS[slug]) {
    return CURATED_SUB_APPS[slug]
  }

  const label = card.label || card.name || slug.replace(/_/g, ' ')
  const desc = card.blurb || card.description || `Access ${label} features and automated agent actions.`

  return [
    {
      id: `${slug}-primary`,
      name: label,
      description: desc,
      type: 'cloud',
      isEnterprise: false,
    },
    {
      id: `${slug}-enterprise`,
      name: `${label} Enterprise`,
      description: `Workspace-specific ${label} connector for private or dedicated enterprise hosts.`,
      type: 'enterprise',
      isEnterprise: true,
    },
  ]
}

/**
 * Long-form description text for any connector
 */
export function getLongDescription(card) {
  if (!card) return ''
  const slug = (card.slug || '').toLowerCase()
  const label = card.label || card.name || slug

  if (slug === 'github') {
    return "Use GitHub to inspect repositories, review pull requests, address feedback, debug failing Actions checks, and prepare code changes for review through a connector-first workflow with targeted CLI fallbacks."
  }
  if (slug === 'slack') {
    return "Use Slack to read channel conversations, search message archives, send project status notifications, and triage incoming alerts across your team's communication channels."
  }
  if (slug === 'gmail') {
    return "Use Gmail to search message threads, summarize customer correspondence, draft responses, and organize incoming communications without leaving your agent workspace."
  }
  if (slug === 'notion') {
    return "Use Notion to search team wikis, query and update roadmap databases, draft documentation pages, and keep product specifications in sync with engineering work."
  }
  if (slug === 'google_drive') {
    return "Use Google Drive to locate project documentation, read spreadsheets, extract presentations, and organize shared workspace folders with granular permission controls."
  }

  const blurb = card.blurb || card.description || 'automate and query actions'
  return `Use ${label} to ${blurb.toLowerCase().replace(/\.$/, '')} through a secure, credential-managed integration connected directly to your Amethyst agent workspace.`
}

/**
 * Version string generator
 */
export function getVersionString(card) {
  if (!card) return '0.1.12-5f7cd798dc99'
  const slug = (card.slug || '').toLowerCase()
  if (slug === 'github') return '0.1.12-5f7cd798dc99'
  if (slug === 'slack') return '0.2.4-e81c20ad41b8'
  if (slug === 'notion') return '0.1.9-94b2a8d11c0f'
  if (slug === 'google_drive' || slug === 'gmail') return '0.3.1-a1b73c4d89ef'

  // Deterministic hash-like string based on slug length
  const hash = Math.abs((slug.length * 2654435761) ^ 0x5f7cd798).toString(16).slice(0, 10)
  return `0.1.${(slug.length % 9) + 1}-${hash}`
}
