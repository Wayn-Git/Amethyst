import React from 'react'

export const DAEMON_TABS = [
  { id: 'all', label: 'All' },
  { id: 'apps', label: 'Apps' },
  { id: 'files', label: 'Files' },
  { id: 'web', label: 'Web' },
  { id: 'library', label: 'Library' },
  { id: 'people', label: 'People' },
  { id: 'actions', label: 'Actions' },
]
export const MODES = DAEMON_TABS

export default function DamonModes({ activeTab, onSelectTab }) {
  return (
    <div className="damon-tabs" role="tablist" aria-label="Search categories">
      {DAEMON_TABS.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`damon-tab${isActive ? ' is-active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            tabIndex={-1}
          >
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
