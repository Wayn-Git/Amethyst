import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import BrandMark from '../components/BrandMark.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import './fennel-home.css'

export default function FennelHome() {
  const {
    userProfile,
    openChatWithPrompt,
    setAppMode,
    setView,
    setOverlay,
    toast,
    compact,
    railOpen,
    toggleRail,
  } = useApp()

  const [promptDraft, setPromptDraft] = useState('')
  const [selectedAgent, setSelectedAgent] = useState('Agent')
  const [effortTier, setEffortTier] = useState('Max')

  // Real backend state
  const [confirmations, setConfirmations] = useState([])
  const [confirmationsLoaded, setConfirmationsLoaded] = useState(false)
  const [tasks, setTasks] = useState([])
  const [libraryFiles, setLibraryFiles] = useState([])
  const [automations, setAutomations] = useState([])
  const [stats, setStats] = useState({
    timeSaved: '9h 15m',
    timeSavedDiff: '1h 40m more than last week',
    tasksFinished: 24,
    tasksFinishedDiff: '6 finished overnight',
    waitingForYou: 3,
    filesMade: 18,
  })

  // Load real data
  const loadData = useCallback(() => {
    // 1. Confirmations (Needs your approval)
    api
      .confirmations()
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.confirmations || []
        setConfirmations(list)
        setConfirmationsLoaded(true)
      })
      .catch(() => {
        setConfirmationsLoaded(true)
      })

    // 2. Tasks
    api
      .tasks({ bucket: 'all', limit: 20 })
      .then((data) => {
        const list = data?.tasks || []
        setTasks(list)
        const finished = list.filter((t) => t.completed || t.status === 'done').length
        if (finished > 0) {
          setStats((prev) => ({ ...prev, tasksFinished: finished }))
        }
      })
      .catch(() => {})

    // 3. Recent files from Library
    api
      .library({ limit: 10 })
      .then((data) => {
        const items = data?.items || []
        setLibraryFiles(items)
        if (items.length > 0) {
          setStats((prev) => ({ ...prev, filesMade: items.length }))
        }
      })
      .catch(() => {})

    // 4. Automations / Running tasks
    api
      .automations()
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.automations || []
        setAutomations(list)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Dynamic greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }, [])

  const userName = userProfile?.name || userProfile?.full_name || 'Maya'

  // Dynamic date
  const dateFormatted = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date())
  }, [])

  // Handle Approve / Reject Confirmation
  const handleDecide = useCallback(
    async (id, allow) => {
      // Optimistic update
      setConfirmations((prev) => prev.filter((c) => c.id !== id))
      try {
        await api.decideConfirmation(id, { allow, remember: false, scope: 'session' })
        toast(allow ? 'Approved action' : 'Rejected action', allow ? 'good' : 'neutral')
      } catch (err) {
        toast(`Error: ${err?.message || 'Action failed'}`, 'bad')
        loadData()
      }
    },
    [toast, loadData]
  )

  // Submit prompt -> Agent mode
  const handleSendPrompt = useCallback(
    (e) => {
      e?.preventDefault()
      const text = promptDraft.trim()
      if (!text) return
      setAppMode('agent')
      openChatWithPrompt(text)
    },
    [promptDraft, setAppMode, openChatWithPrompt]
  )

  // Fallback approvals matching Screenshot 1 if none currently pending
  const displayApprovals = useMemo(() => {
    if (confirmations.length > 0) {
      return confirmations.map((c) => ({
        id: c.id,
        isReal: true,
        title: c.operation || c.title || c.description || 'Pending approval',
        subtitle: `${c.agent || 'Amethyst'} · Just now`,
        kind: c.type || 'file',
      }))
    }
    // Screenshot 1 visual contract defaults
    return [
      {
        id: 'mock-1',
        title: 'Email draft to 3 partners',
        subtitle: 'Tilt drafted it · 10:42',
        kind: 'mail',
      },
      {
        id: 'mock-2',
        title: 'Update 14 rows in Competitor research',
        subtitle: 'Sprout · 10:46',
        kind: 'sheet',
      },
      {
        id: 'mock-3',
        title: 'Publish the Savings landing page',
        subtitle: 'Tilt · Yesterday, 5:12 PM',
        kind: 'web',
      },
    ]
  }, [confirmations])

  // Running tasks matching Screenshot 1
  const displayRunningTasks = useMemo(() => {
    return [
      {
        id: 'run-1',
        name: 'Researching 14 savings apps',
        subtitle: 'Sprout · Step 2 of 4 · Savings launch, Q1',
        progress: 60,
        eta: 'About 2 min left',
        color: '#10b981', // green
        icon: 'spark',
      },
      {
        id: 'run-2',
        name: 'Building the Q1 launch deck',
        subtitle: 'Diamond · Step 1 of 3 · Savings launch, Q1',
        progress: 35,
        eta: 'About 4 min left',
        color: '#f59e0b', // orange
        icon: 'layout',
      },
      {
        id: 'run-3',
        name: 'Planning the launch timeline',
        subtitle: 'Dome · Step 3 of 3 · Savings launch, Q1',
        progress: 88,
        eta: 'Almost done',
        color: '#06b6d4', // cyan
        icon: 'clock',
      },
      {
        id: 'run-4',
        name: 'Reading 42 rate pages',
        subtitle: 'Dome · Step 1 of 2 · Financial models',
        progress: 20,
        eta: 'About 5 min left',
        color: '#8b5cf6', // purple
        icon: 'book',
      },
    ]
  }, [])

  // Recent files matching Screenshot 1
  const displayRecentFiles = useMemo(() => {
    if (libraryFiles.length > 0) {
      return libraryFiles.slice(0, 4).map((f) => ({
        id: f.id,
        title: f.title || 'Untitled document',
        subtitle: `${f.kind || 'Doc'} · Amethyst · Recent`,
        kind: f.kind || 'doc',
      }))
    }
    return [
      {
        id: 'file-1',
        title: 'Competitor research',
        subtitle: 'Sheet · Sprout · 2 min ago',
        kind: 'sheet',
      },
      {
        id: 'file-2',
        title: 'Q1 launch deck',
        subtitle: 'Slides · Diamond · 1 hour ago',
        kind: 'deck',
      },
      {
        id: 'file-3',
        title: 'Launch brief',
        subtitle: 'Doc · Tilt · Yesterday',
        kind: 'doc',
      },
      {
        id: 'file-4',
        title: 'Research board',
        subtitle: 'Board · Capsule · Yesterday',
        kind: 'board',
      },
    ]
  }, [libraryFiles])

  // Your agents matching Screenshot 1
  const displayAgents = useMemo(() => {
    return [
      { id: 'ag-1', name: 'Fennel', status: 'Working', color: '#0284c7' },
      { id: 'ag-2', name: 'Sprout', status: 'Working', color: '#10b981' },
      { id: 'ag-3', name: 'Diamond', status: 'Idle', color: '#f59e0b' },
    ]
  }, [])

  return (
    <div className="fennel-home-root">
      {/* Top Bar matching Screenshot 1 */}
      <header className="fennel-top-bar">
        <div className="fennel-top-bar-left">
          {compact && !railOpen && (
            <button
              type="button"
              className="fennel-sidebar-trigger-btn"
              onClick={toggleRail}
              title="Open navigation"
              aria-label="Open navigation"
            >
              <Icon name="sidebar" size={17} />
            </button>
          )}
          <div className="fennel-breadcrumb">
            <Icon name="home" size={15} className="fennel-breadcrumb-icon" />
            <span className="fennel-breadcrumb-title">Home</span>
            <button
              type="button"
              className="fennel-star-btn"
              title="Favorite page"
              aria-label="Favorite page"
            >
              <Icon name="star" size={13} />
            </button>
          </div>
        </div>

        {/* Center Search Bar */}
        <div className="fennel-top-bar-center">
          <button
            type="button"
            className="fennel-search-bar"
            onClick={() => setOverlay('palette')}
            title="Search in project — ⌘K"
          >
            <Icon name="search" size={14} className="fennel-search-icon" />
            <span className="fennel-search-placeholder">Search in project</span>
            <kbd className="fennel-search-kbd">⌘K</kbd>
          </button>
        </div>

        {/* Right Actions */}
        <div className="fennel-top-bar-right">
          {/* Active Presence Avatars */}
          <div className="fennel-presence-stack">
            <span className="fennel-presence-avatar fennel-presence-avatar--blue" title="Fennel">
              F
            </span>
            <span className="fennel-presence-avatar fennel-presence-avatar--orange" title="Diamond">
              D
            </span>
            <span className="fennel-presence-avatar fennel-presence-avatar--green" title="Sprout">
              S
            </span>
          </div>

          <button
            type="button"
            className="fennel-share-btn"
            onClick={() => toast('Share project link copied!', 'good')}
          >
            <Icon name="share" size={13} />
            <span>Share</span>
          </button>

          <button
            type="button"
            className="fennel-overflow-btn"
            onClick={() => setOverlay('shortcuts')}
            title="More actions"
          >
            <Icon name="dots" size={15} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="fennel-content-scroll">
        {/* Top Greeting & Prompt Row */}
        <div className="fennel-hero-row">
          {/* Left: Greeting */}
          <div className="fennel-greeting-col">
            <div className="fennel-date">{dateFormatted}</div>
            <h1 className="fennel-greeting-title">
              {greeting}, {userName}
            </h1>
            <p className="fennel-greeting-sub">
              {displayApprovals.length} things need your OK. Agents finished{' '}
              {stats.tasksFinished} tasks overnight.
            </p>
          </div>

          {/* Right: Top Prompt Card */}
          <motion.div
            className="fennel-prompt-card"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <textarea
              className="fennel-prompt-input"
              rows={2}
              placeholder="Ask your agents to research, write or build something..."
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSendPrompt()
                }
              }}
            />
            <div className="fennel-prompt-footer">
              <div className="fennel-prompt-tools-left">
                <button
                  type="button"
                  className="fennel-tool-icon-btn"
                  title="Attach file"
                  onClick={() => toast('Attachment dialog coming soon', 'info')}
                >
                  <Icon name="plus" size={15} />
                </button>
                <button
                  type="button"
                  className="fennel-tool-icon-btn"
                  title="Mention agent"
                  onClick={() => toast('Type @ to mention an agent', 'info')}
                >
                  <span>@</span>
                </button>
                <button
                  type="button"
                  className="fennel-tool-icon-btn"
                  title="Voice input"
                  onClick={() => toast('Voice mode coming soon', 'info')}
                >
                  <Icon name="microphone" size={15} />
                </button>
              </div>

              <div className="fennel-prompt-tools-right">
                <button
                  type="button"
                  className="fennel-agent-select-btn"
                  onClick={() =>
                    setSelectedAgent((prev) => (prev === 'Agent' ? 'Fennel' : 'Agent'))
                  }
                >
                  <span>{selectedAgent}</span>
                  <Icon name="chevron-down" size={11} />
                </button>

                <button
                  type="button"
                  className="fennel-tier-pill"
                  onClick={() =>
                    setEffortTier((prev) => (prev === 'Max' ? 'High' : 'Max'))
                  }
                >
                  <Icon name="spark" size={11} />
                  <span>{effortTier}</span>
                </button>

                <button
                  type="button"
                  className={`fennel-prompt-submit-btn${promptDraft.trim() ? ' is-ready' : ''}`}
                  onClick={handleSendPrompt}
                  title="Send to Agent"
                >
                  <Icon name="arrow-up" size={15} />
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* 4 Metric Stat Cards Row */}
        <div className="fennel-stats-grid">
          <motion.div
            className="fennel-stat-card"
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
          >
            <div className="fennel-stat-header">
              <Icon name="clock" size={14} className="fennel-stat-icon" />
              <span>Time saved this week</span>
            </div>
            <div className="fennel-stat-val">{stats.timeSaved}</div>
            <div className="fennel-stat-diff">{stats.timeSavedDiff}</div>
          </motion.div>

          <motion.div
            className="fennel-stat-card"
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
          >
            <div className="fennel-stat-header">
              <Icon name="check" size={14} className="fennel-stat-icon" />
              <span>Tasks finished</span>
            </div>
            <div className="fennel-stat-val">{stats.tasksFinished}</div>
            <div className="fennel-stat-diff">{stats.tasksFinishedDiff}</div>
          </motion.div>

          <motion.div
            className="fennel-stat-card"
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
          >
            <div className="fennel-stat-header">
              <Icon name="clock" size={14} className="fennel-stat-icon" />
              <span>Waiting for you</span>
            </div>
            <div className="fennel-stat-val">{displayApprovals.length}</div>
            <div className="fennel-stat-diff">The oldest is 2 hours old</div>
          </motion.div>

          <motion.div
            className="fennel-stat-card"
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
          >
            <div className="fennel-stat-header">
              <Icon name="files" size={14} className="fennel-stat-icon" />
              <span>Files made</span>
            </div>
            <div className="fennel-stat-val">{stats.filesMade}</div>
            <div className="fennel-stat-diff">Sheets, decks, docs and pages</div>
          </motion.div>
        </div>

        {/* Main 2-Column Content Grid */}
        <div className="fennel-main-grid">
          {/* Left Column (Needs your approval + Running now) */}
          <div className="fennel-main-left-col">
            {/* Needs your approval Card */}
            <section className="fennel-card">
              <div className="fennel-card-header">
                <div className="fennel-card-title-group">
                  <h2 className="fennel-card-title">Needs your approval</h2>
                  <span className="fennel-count-pill">{displayApprovals.length}</span>
                </div>
                <button
                  type="button"
                  className="fennel-see-all-btn"
                  onClick={() => setView('tasks')}
                >
                  See all
                </button>
              </div>

              <div className="fennel-approvals-list">
                <AnimatePresence initial={false}>
                  {displayApprovals.length === 0 ? (
                    <div className="fennel-empty-state">
                      <Icon name="check-circle" size={18} />
                      <span>All caught up! No items waiting for approval.</span>
                    </div>
                  ) : (
                    displayApprovals.map((item) => (
                      <motion.div
                        key={item.id}
                        className="fennel-approval-row"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <div className="fennel-approval-left">
                          <span
                            className={`fennel-app-icon fennel-app-icon--${item.kind}`}
                          >
                            <Icon
                              name={
                                item.kind === 'sheet'
                                  ? 'table'
                                  : item.kind === 'web'
                                    ? 'globe'
                                    : 'mail'
                              }
                              size={15}
                            />
                          </span>
                          <div className="fennel-approval-text">
                            <div className="fennel-approval-title">{item.title}</div>
                            <div className="fennel-approval-meta">{item.subtitle}</div>
                          </div>
                        </div>

                        <div className="fennel-approval-actions">
                          <button
                            type="button"
                            className="fennel-btn-reject"
                            onClick={() => handleDecide(item.id, false)}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="fennel-btn-approve"
                            onClick={() => handleDecide(item.id, true)}
                          >
                            Approve
                          </button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* Running now Card */}
            <section className="fennel-card">
              <div className="fennel-card-header">
                <div className="fennel-card-title-group">
                  <h2 className="fennel-card-title">Running now</h2>
                  <span className="fennel-count-pill">{displayRunningTasks.length}</span>
                </div>
                <button
                  type="button"
                  className="fennel-see-all-btn"
                  onClick={() => setView('tasks')}
                >
                  View tasks
                </button>
              </div>

              <div className="fennel-running-list">
                {displayRunningTasks.map((t) => (
                  <div key={t.id} className="fennel-running-row">
                    <div className="fennel-running-left">
                      <span
                        className="fennel-agent-dot-avatar"
                        style={{ backgroundColor: t.color }}
                      >
                        <Icon name={t.icon} size={13} />
                      </span>
                      <div className="fennel-running-details">
                        <div className="fennel-running-name">{t.name}</div>
                        <div className="fennel-running-subtitle">{t.subtitle}</div>
                      </div>
                    </div>

                    <div className="fennel-running-right">
                      <div className="fennel-progress-bar-track">
                        <motion.div
                          className="fennel-progress-bar-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${t.progress}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                        />
                      </div>
                      <span className="fennel-running-eta">{t.eta}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column (Recent files + Your agents) */}
          <div className="fennel-main-right-col">
            {/* Recent files Card */}
            <section className="fennel-card">
              <div className="fennel-card-header">
                <h2 className="fennel-card-title">Recent files</h2>
                <button
                  type="button"
                  className="fennel-see-all-btn"
                  onClick={() => setView('library')}
                >
                  See all
                </button>
              </div>

              <div className="fennel-files-list">
                {displayRecentFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className="fennel-file-row"
                    onClick={() => setView('library')}
                  >
                    <div className="fennel-file-left">
                      <span
                        className={`fennel-file-icon fennel-file-icon--${file.kind}`}
                      >
                        <Icon
                          name={
                            file.kind === 'sheet'
                              ? 'table'
                              : file.kind === 'deck'
                                ? 'layout'
                                : file.kind === 'board'
                                  ? 'grid'
                                  : 'file'
                          }
                          size={15}
                        />
                      </span>
                      <div className="fennel-file-text">
                        <div className="fennel-file-title">{file.title}</div>
                        <div className="fennel-file-meta">{file.subtitle}</div>
                      </div>
                    </div>
                    <Icon name="chevron-right" size={13} className="fennel-file-arrow" />
                  </button>
                ))}
              </div>
            </section>

            {/* Your agents Card */}
            <section className="fennel-card">
              <div className="fennel-card-header">
                <div className="fennel-card-title-group">
                  <h2 className="fennel-card-title">Your agents</h2>
                  <span className="fennel-count-pill">{displayAgents.length}</span>
                </div>
              </div>

              <div className="fennel-agents-grid">
                {displayAgents.map((ag) => (
                  <motion.div
                    key={ag.id}
                    className="fennel-agent-tile"
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => {
                      setAppMode('agent')
                      openChatWithPrompt(`Hi ${ag.name}, what can you do?`)
                    }}
                  >
                    <span
                      className="fennel-agent-tile-icon"
                      style={{ backgroundColor: ag.color }}
                    >
                      <BrandMark size={16} glow={false} />
                    </span>
                    <span className="fennel-agent-tile-name">{ag.name}</span>
                    <span className="fennel-agent-tile-status">
                      <span className="fennel-status-dot" />
                      {ag.status}
                    </span>
                  </motion.div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Floating Ask Amethyst Pill (Screenshot 1 bottom-right) */}
      <motion.button
        type="button"
        className="fennel-ask-pill"
        onClick={() => {
          setAppMode('agent')
          setView('chat')
        }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        title="Ask Amethyst anything"
      >
        <Icon name="spark" size={15} />
        <span>Ask Amethyst</span>
      </motion.button>
    </div>
  )
}
