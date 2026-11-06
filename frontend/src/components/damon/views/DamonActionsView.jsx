import React from 'react'
import Icon from '../../Icon.jsx'
import { woxFuzzyMatch } from '../woxMatcher.js'

export const SYSTEM_ACTIONS = [
  {
    id: 'act-new-note',
    title: 'New note',
    subtitle: 'Create a new markdown note in Amethyst',
    icon: 'edit',
    shortcut: '⌘N',
    category: 'Amethyst',
    action: (app, nav) => nav('chat', 'Create a new note'),
  },
  {
    id: 'act-save-link',
    title: 'Save link to Library',
    subtitle: 'Capture current URL or clipboard to Library',
    icon: 'bookmark',
    shortcut: '⌘L',
    category: 'Amethyst',
    action: (app, nav) => nav('library'),
  },
  {
    id: 'act-open-settings',
    title: 'Open Settings',
    subtitle: 'Preferences, models, keys, and appearance',
    icon: 'settings',
    shortcut: '⌘,',
    category: 'Amethyst',
    action: (app, nav) => nav('settings'),
  },
  {
    id: 'act-nav-today',
    title: 'Go to Today Dashboard',
    subtitle: 'Active widgets, weather, schedule, and feed',
    icon: 'home',
    shortcut: '⌘1',
    category: 'Navigation',
    action: (app, nav) => nav('today'),
  },
  {
    id: 'act-nav-library',
    title: 'Go to Library',
    subtitle: 'Browse all articles, videos, and books',
    icon: 'book',
    shortcut: '⌘2',
    category: 'Navigation',
    action: (app, nav) => nav('library'),
  },
  {
    id: 'act-nav-memory',
    title: 'Go to Memory',
    subtitle: 'View long-term indexed agent knowledge',
    icon: 'cpu',
    shortcut: '⌘3',
    category: 'Navigation',
    action: (app, nav) => nav('memory'),
  },
  {
    id: 'act-sys-lock',
    title: 'Lock screen',
    subtitle: 'Lock current desktop session immediately',
    icon: 'lock',
    shortcut: '⌃⌘Q',
    category: 'System',
    provider_id: 'system',
    action_id: 'lock',
  },
  {
    id: 'act-sys-suspend',
    title: 'Suspend / Sleep',
    subtitle: 'Put computer into low-power sleep mode',
    icon: 'moon',
    shortcut: '⌥⌘⏏',
    category: 'System',
    provider_id: 'system',
    action_id: 'suspend',
  },
  {
    id: 'act-sys-restart',
    title: 'Restart computer',
    subtitle: 'Reboot system operating system',
    icon: 'refresh',
    shortcut: '⌃⌘⏏',
    category: 'System',
    provider_id: 'system',
    action_id: 'reboot',
  },
  {
    id: 'act-sys-shutdown',
    title: 'Shut down computer',
    subtitle: 'Safely power off machine',
    icon: 'power',
    shortcut: '⌃⌥⌘⏏',
    category: 'System',
    provider_id: 'system',
    action_id: 'shutdown',
  },
  {
    id: 'act-sys-vol-mute',
    title: 'Mute / Unmute audio',
    subtitle: 'Toggle master audio volume mute',
    icon: 'volume',
    shortcut: 'F10',
    category: 'Audio',
    provider_id: 'system',
    action_id: 'volume_mute',
  },
]

export default function DamonActionsView({
  query = '',
  selectedIndex = 0,
  onExecuteAction,
}) {
  const cleanQ = query.trim()

  const scoredActions = SYSTEM_ACTIONS.map((action) => {
    if (!cleanQ) return { action, score: 50 }
    const match = woxFuzzyMatch(action.title, cleanQ)
    const subMatch = woxFuzzyMatch(action.subtitle, cleanQ)
    const score = Math.max(match.score, subMatch.score * 0.7)
    return { action, score: match.isMatch || subMatch.isMatch ? score : 0 }
  })
    .filter((it) => it.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((it) => it.action)

  return (
    <div className="damon-actions-view-root">
      <div className="damon-section-group">
        <div className="damon-section-header">
          <div className="damon-section-title-wrap">
            <span>Actions & Commands</span>
            <span className="damon-section-count">{scoredActions.length}</span>
          </div>
        </div>

        <div className="damon-list-container">
          {scoredActions.length === 0 ? (
            <div className="damon-empty-state" style={{ padding: '30px 20px', textAlign: 'center' }}>
              <Icon name="zap" size={24} />
              <p style={{ marginTop: 8, color: 'var(--damon-text-muted)' }}>
                No commands matching “{query}”
              </p>
            </div>
          ) : (
            scoredActions.map((action, i) => {
              const isSelected = i === selectedIndex
              return (
                <button
                  key={action.id}
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onExecuteAction(action)}
                >
                  <div className="damon-row-icon-wrap">
                    <Icon name={action.icon} size={18} />
                  </div>
                  <div className="damon-row-main">
                    <div className="damon-row-title">{action.title}</div>
                    <div className="damon-row-subtitle">
                      <span className="damon-lib-kind-pill" style={{ marginRight: 6 }}>
                        {action.category}
                      </span>
                      {action.subtitle}
                    </div>
                  </div>
                  <div className="damon-row-trailing">
                    {action.shortcut && (
                      <kbd className="kbd">{action.shortcut}</kbd>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

