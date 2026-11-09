import { useMemo } from 'react'
import { Sparkles, Clock, CheckCircle2 } from 'lucide-react'

// Curated realistic mock agent executions for top apps
const CURATED_PREVIEWS = {
  gmail: {
    prompt:
      'Summarize the last 5 messages in Q3 launch plan and capture decisions, open questions, and what I should follow up on next',
    duration: 'Worked for 12 seconds',
    summary:
      "Here's the recap of the last 5 messages in Q3 launch plan. The team agreed on a phased launch; final testing and customer communications still need confirmation.",
    sections: [
      {
        title: 'Decisions',
        items: [
          'Start with a small group of existing customers, then expand after a one-week pilot.',
          'Keep the new onboarding flow in scope; move advanced reporting to a later release.',
          'Use activation and support volume to decide whether to expand the rollout.',
        ],
      },
      {
        title: 'Open questions',
        items: [
          'Can engineering finish testing by Friday, or does the pilot need to move?',
          'Who will approve the customer email and update the help center before launch?',
        ],
      },
    ],
  },
  github: {
    prompt:
      'Find recent pull requests waiting for review on the amethyst repo, check CI status, and outline key diff areas',
    duration: 'Worked for 8 seconds',
    summary:
      'Found 2 open PRs requesting your review with all automated checks passing:',
    sections: [
      {
        title: 'Pull requests',
        items: [
          '#142 feat(mcp): Add persistent Composio session pooling — 14 files changed, all checks green.',
          '#139 fix(agent): Prevent redundant tool dispatch on timeout — 3 files changed, tests pass.',
        ],
      },
      {
        title: 'Recommended actions',
        items: [
          'Approve #139 to unblock the bugfix release.',
          'Review schema migrations in #142 before merging to main.',
        ],
      },
    ],
  },
  slack: {
    prompt:
      "Catch me up on today's discussions in #general and list action items assigned to me",
    duration: 'Worked for 6 seconds',
    summary:
      'Here is what happened today across active threads and direct mentions:',
    sections: [
      {
        title: 'Key updates',
        items: [
          'Sprint 14 demo scheduled for Thursday at 2:00 PM UTC.',
          'Design system tokens for dark mode deployed to staging.',
        ],
      },
      {
        title: 'Action items',
        items: [
          'Review the updated component tokens before tomorrow morning.',
          'Share deployment checklist in #dev-ops.',
        ],
      },
    ],
  },
  notion: {
    prompt:
      'Search product roadmap specs updated this week and summarize pending milestones',
    duration: 'Worked for 9 seconds',
    summary:
      'Found 3 product roadmap documents modified in your workspace in the last 7 days:',
    sections: [
      {
        title: 'Milestones',
        items: [
          'Plugins & Connectors UI overhaul: In progress, targeting high-polish parity.',
          'Zero-key browser OAuth: Validated and merged.',
          'Offline recovery mode: In architecture review.',
        ],
      },
    ],
  },
  google_drive: {
    prompt:
      'Locate the Q4 Marketing Strategy presentation and extract key budget allocations',
    duration: 'Worked for 8 seconds',
    summary:
      "Found 'Q4 Marketing Strategy Final.gslides' updated yesterday:",
    sections: [
      {
        title: 'Budget allocations',
        items: [
          'Developer marketing & community: $45,000 (40%)',
          'Paid search & awareness campaigns: $35,000 (32%)',
          'Content production & technical guides: $20,000 (18%)',
        ],
      },
    ],
  },
  linear: {
    prompt:
      'List high-priority bugs in the current cycle and their assignees',
    duration: 'Worked for 5 seconds',
    summary:
      'Found 3 unresolved issues marked urgent or high priority in Cycle 22:',
    sections: [
      {
        title: 'Active issues',
        items: [
          'AMY-402: OAuth popup blocker handling on Safari 18',
          'AMY-398: Tool search latency when marketplace exceeds 500 entries',
          'AMY-395: Preserve expanded category state across tab switches',
        ],
      },
    ],
  },
  spotify: {
    prompt: 'Play deep focus playlist and turn shuffle on',
    duration: 'Worked for 3 seconds',
    summary: 'Started playback on your active device:',
    sections: [
      {
        title: 'Now playing',
        items: [
          "Playlist: 'Deep Focus — Electronic & Ambient'",
          'Device: MacBook Pro (Shuffle: On, Volume: 70%)',
        ],
      },
    ],
  },
  supabase: {
    prompt:
      'Inspect tables in public schema and report row counts and recent migration status',
    duration: 'Worked for 6 seconds',
    summary: 'Connected to project database instance (eu-central-1):',
    sections: [
      {
        title: 'Schema summary',
        items: [
          '12 tables found, 42,108 total records indexed.',
          'All database migrations applied cleanly; zero pending locks.',
        ],
      },
    ],
  },
  web_scraper: {
    prompt: 'Extract the main documentation guide and API signatures from the provided URL',
    duration: 'Worked for 7 seconds',
    summary: 'Scraped and parsed 1 article cleanly into structured markdown:',
    sections: [
      {
        title: 'Extracted content',
        items: [
          'Overview and Getting Started guide preserved.',
          'Code samples and HTTP endpoint schemas cataloged cleanly.',
        ],
      },
    ],
  },
}

export default function PluginHeroPreview({ card }) {
  const preview = useMemo(() => {
    if (!card) return null
    const slug = (card.slug || '').toLowerCase().replace(/-/g, '_')
    if (CURATED_PREVIEWS[slug]) {
      return CURATED_PREVIEWS[slug]
    }

    // Dynamic high-quality fallback generator
    const label = card.label || card.name || 'this app'
    const blurb = card.blurb || card.description || 'automate workflows'
    return {
      prompt: `Use ${label} to ${blurb.toLowerCase().replace(/\.$/, '')} and return a structured summary`,
      duration: 'Worked for 6 seconds',
      summary: `Successfully executed actions through ${label}:`,
      sections: [
        {
          title: 'Key results',
          items: [
            `Queried ${label} API using your authenticated credentials.`,
            'Processed requested parameters and structured the response payload.',
          ],
        },
        {
          title: 'Next steps',
          items: [
            `Ask Amethyst to run follow-up queries or chain with other connectors.`,
          ],
        },
      ],
    }
  }, [card])

  if (!preview) return null

  return (
    <div className="plugin-hero-preview-wrapper" aria-label="Simulated interaction preview">
      <div className="plugin-hero-preview-backdrop">
        {/* User Request Bubble */}
        <div className="plugin-hero-user-bubble">
          <p>{preview.prompt}</p>
        </div>

        {/* Assistant Response Card */}
        <div className="plugin-hero-assistant-card">
          <div className="plugin-hero-execution-meta">
            <CheckCircle2 size={13} className="text-live shrink-0" />
            <span className="plugin-hero-duration">{preview.duration}</span>
          </div>

          <div className="plugin-hero-response-body">
            <p className="plugin-hero-summary-text">{preview.summary}</p>

            {preview.sections?.map((sec, idx) => (
              <div key={idx} className="plugin-hero-section-block">
                <div className="plugin-hero-section-title">{sec.title}</div>
                <ul className="plugin-hero-bullet-list">
                  {sec.items?.map((item, itemIdx) => (
                    <li key={itemIdx} className="plugin-hero-bullet-item">
                      <span className="plugin-hero-bullet-dot">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
