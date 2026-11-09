import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import BrandMark from '../components/BrandMark.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import './fennel-home.css'

// Emil Kowalski spring transition token
const springTransition = {
  type: 'spring',
  stiffness: 380,
  damping: 26,
}

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
    health,
    theme,
    setTheme,
    DARK_THEMES,
  } = useApp()

  const isDark = (DARK_THEMES || ['dark', 'graphite', 'ink', 'nocturne', 'nvidia', 'cursor']).includes(theme)
  const toggleTheme = useCallback(() => {
    setTheme(isDark ? 'paper' : 'graphite')
  }, [isDark, setTheme])

  const [promptDraft, setPromptDraft] = useState('')
  const [effortTier, setEffortTier] = useState('Max')

  // Real backend state
  const [confirmations, setConfirmations] = useState([])
  const [tasks, setTasks] = useState([])
  const [libraryFiles, setLibraryFiles] = useState([])
  const [automations, setAutomations] = useState([])
  const [capabilities, setCapabilities] = useState({ skills: [], connectors: [] })

  // Load real data only - ZERO mock/fake features
  const loadData = useCallback(async () => {
    try {
      // 1. Pending confirmations
      const confs = await api.confirmations().catch(() => [])
      setConfirmations(Array.isArray(confs) ? confs : confs?.confirmations || [])

      // 2. Real tasks
      const tData = await api.tasks({ bucket: 'all', limit: 30 }).catch(() => [])
      setTasks(Array.isArray(tData) ? tData : tData?.tasks || [])

      // 3. Real library documents
      const libData = await api.library({ limit: 8 }).catch(() => ({ items: [] }))
      setLibraryFiles(libData?.items || [])

      // 4. Real automations
      const autoData = await api.automations().catch(() => ({ automations: [] }))
      setAutomations(autoData?.automations || [])

      // 5. Real capabilities
      const capsData = await api.capabilities().catch(() => ({ skills: [], connectors: [] }))
      setCapabilities({
        skills: capsData?.skills || [],
        connectors: capsData?.connectors || [],
      })
    } catch {
      // Quiet fallback
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }, [])

  const userName = userProfile?.name || userProfile?.full_name || 'Wayne'

  // Dynamic date
  const dateFormatted = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date())
  }, [])

  // Stats computed from real data
  const finishedTasksCount = useMemo(() => {
    return tasks.filter((t) => t.completed || t.status === 'done').length
  }, [tasks])

  const pendingTasksCount = useMemo(() => {
    return tasks.filter((t) => !t.completed && t.status !== 'done').length
  }, [tasks])

  // Handle Approve / Reject Confirmation
  const handleDecide = useCallback(
    async (id, allow) => {
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

  const activeConnectors = capabilities.connectors || []
  const availableToolsCount = health?.tools || 66

  return (
    <motion.div
      className="fennel-home-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Top Bar matching Screenshot 1 */}
      <header className="fennel-top-bar">
        <div className="fennel-top-bar-left">
          {compact && !railOpen && (
            <motion.button
              type="button"
              className="fennel-sidebar-trigger-btn"
              onClick={toggleRail}
              whileTap={{ scale: 0.94 }}
              title="Open navigation"
              aria-label="Open navigation"
            >
              <Icon name="sidebar" size={17} />
            </motion.button>
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
          <motion.button
            type="button"
            className="fennel-search-bar"
            onClick={() => setOverlay('palette')}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            title="Search in project — ⌘K"
          >
            <Icon name="search" size={14} className="fennel-search-icon" />
            <span className="fennel-search-placeholder">Search in project</span>
            <kbd className="fennel-search-kbd">⌘K</kbd>
          </motion.button>
        </div>

        {/* Right Actions */}
        <div className="fennel-top-bar-right">
          <motion.button
            type="button"
            className="fennel-theme-btn"
            onClick={toggleTheme}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            <AnimatePresence mode="wait" initial={false}>
              {isDark ? (
                <motion.span
                  key="sun"
                  initial={{ scale: 0.6, rotate: -40, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0.6, rotate: 40, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: 'inline-flex' }}
                >
                  <Icon name="sun" size={15} />
                </motion.span>
              ) : (
                <motion.span
                  key="moon"
                  initial={{ scale: 0.6, rotate: 40, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0.6, rotate: -40, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: 'inline-flex' }}
                >
                  <Icon name="moon" size={15} />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>

          <motion.button
            type="button"
            className="fennel-share-btn"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href)
              toast('Workspace URL copied', 'good')
            }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
          >
            <Icon name="share" size={13} />
            <span>Share</span>
          </motion.button>

          <motion.button
            type="button"
            className="fennel-overflow-btn"
            onClick={() => setOverlay('shortcuts')}
            whileTap={{ scale: 0.92 }}
            title="Keyboard shortcuts"
          >
            <Icon name="dots" size={15} />
          </motion.button>
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
              {confirmations.length > 0
                ? `${confirmations.length} action${confirmations.length > 1 ? 's' : ''} require your approval.`
                : 'All actions confirmed.'}{' '}
              {finishedTasksCount > 0
                ? `${finishedTasksCount} task${finishedTasksCount > 1 ? 's' : ''} completed.`
                : `${pendingTasksCount} task${pendingTasksCount === 1 ? '' : 's'} in queue.`}
            </p>
          </div>

          {/* Right: Prompt Card */}
          <motion.div
            className="fennel-prompt-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springTransition, delay: 0.05 }}
          >
            <textarea
              className="fennel-prompt-input"
              rows={2}
              placeholder="Ask Amethyst to research, plan, or build..."
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendPrompt()
                }
              }}
            />
            <div className="fennel-prompt-footer">
              <div className="fennel-prompt-tools-left">
                <span className="fennel-prompt-hint">
                  Press <kbd>↵ Enter</kbd> to ask
                </span>
              </div>

              <div className="fennel-prompt-tools-right">
                <motion.button
                  type="button"
                  className="fennel-tier-pill"
                  onClick={() =>
                    setEffortTier((prev) => (prev === 'Max' ? 'High' : prev === 'High' ? 'Fast' : 'Max'))
                  }
                  whileTap={{ scale: 0.94 }}
                  title="Cycle reasoning effort"
                >
                  <Icon name="spark" size={11} />
                  <span>{effortTier}</span>
                </motion.button>

                <motion.button
                  type="button"
                  className={`fennel-prompt-submit-btn${promptDraft.trim() ? ' is-ready' : ''}`}
                  onClick={handleSendPrompt}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  title="Send to Agent (Enter)"
                >
                  <Icon name="arrow-up" size={15} />
                </motion.button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* 4 Metric Stat Cards Row */}
        <motion.div
          className="fennel-stats-grid"
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: {
                staggerChildren: 0.05,
                delayChildren: 0.08,
              },
            },
          }}
        >
          <motion.div
            className="fennel-stat-card"
            variants={{
              hidden: { opacity: 0, y: 12 },
              show: { opacity: 1, y: 0, transition: springTransition },
            }}
            whileHover={{ y: -3, transition: springTransition }}
          >
            <div className="fennel-stat-header">
              <Icon name="spark" size={14} className="fennel-stat-icon" />
              <span>Available tools</span>
            </div>
            <div className="fennel-stat-val">{availableToolsCount}</div>
            <div className="fennel-stat-diff">{capabilities.skills.length} skills active</div>
          </motion.div>

          <motion.div
            className="fennel-stat-card"
            variants={{
              hidden: { opacity: 0, y: 12 },
              show: { opacity: 1, y: 0, transition: springTransition },
            }}
            whileHover={{ y: -3, transition: springTransition }}
          >
            <div className="fennel-stat-header">
              <Icon name="check" size={14} className="fennel-stat-icon" />
              <span>Tasks completed</span>
            </div>
            <div className="fennel-stat-val">{finishedTasksCount}</div>
            <div className="fennel-stat-diff">{pendingTasksCount} remaining in queue</div>
          </motion.div>

          <motion.div
            className="fennel-stat-card"
            variants={{
              hidden: { opacity: 0, y: 12 },
              show: { opacity: 1, y: 0, transition: springTransition },
            }}
            whileHover={{ y: -3, transition: springTransition }}
          >
            <div className="fennel-stat-header">
              <Icon name="clock" size={14} className="fennel-stat-icon" />
              <span>Waiting for you</span>
            </div>
            <div className="fennel-stat-val">{confirmations.length}</div>
            <div className="fennel-stat-diff">
              {confirmations.length === 0 ? 'Queue is clear' : 'Requires approval'}
            </div>
          </motion.div>

          <motion.div
            className="fennel-stat-card"
            variants={{
              hidden: { opacity: 0, y: 12 },
              show: { opacity: 1, y: 0, transition: springTransition },
            }}
            whileHover={{ y: -3, transition: springTransition }}
          >
            <div className="fennel-stat-header">
              <Icon name="files" size={14} className="fennel-stat-icon" />
              <span>Files & captures</span>
            </div>
            <div className="fennel-stat-val">{libraryFiles.length}</div>
            <div className="fennel-stat-diff">Stored in Library</div>
          </motion.div>
        </motion.div>

        {/* Main 2-Column Content Grid */}
        <div className="fennel-main-grid">
          {/* Left Column (Needs your approval + Running now) */}
          <div className="fennel-main-left-col">
            {/* Needs your approval Card */}
            <motion.section
              className="fennel-card"
              whileHover={{ y: -2, transition: springTransition }}
            >
              <div className="fennel-card-header">
                <div className="fennel-card-title-group">
                  <h2 className="fennel-card-title">Needs your approval</h2>
                  <span className="fennel-count-pill">{confirmations.length}</span>
                </div>
                {confirmations.length > 0 && (
                  <button
                    type="button"
                    className="fennel-see-all-btn"
                    onClick={() => setView('tasks')}
                  >
                    See all
                  </button>
                )}
              </div>

              <div className="fennel-approvals-list">
                <AnimatePresence initial={false}>
                  {confirmations.length === 0 ? (
                    <motion.div
                      className="fennel-empty-state"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="fennel-empty-icon-wrap">
                        <Icon name="check-circle" size={18} />
                      </span>
                      <div className="fennel-empty-text">
                        <div className="fennel-empty-heading">All caught up</div>
                        <div className="fennel-empty-sub">
                          When dangerous agent actions need confirmation, they will appear here for one-click approval.
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    confirmations.map((item) => (
                      <motion.div
                        key={item.id}
                        className="fennel-approval-row"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={springTransition}
                      >
                        <div className="fennel-approval-left">
                          <span className="fennel-app-icon fennel-app-icon--mail">
                            <Icon name="shield" size={15} />
                          </span>
                          <div className="fennel-approval-text">
                            <div className="fennel-approval-title">
                              {item.title || item.operation || 'Security confirmation required'}
                            </div>
                            <div className="fennel-approval-meta">
                              {item.agent || 'Amethyst Director'} · Action confirmation
                            </div>
                          </div>
                        </div>

                        <div className="fennel-approval-actions">
                          <motion.button
                            type="button"
                            className="fennel-btn-reject"
                            onClick={() => handleDecide(item.id, false)}
                            whileTap={{ scale: 0.94 }}
                          >
                            Reject
                          </motion.button>
                          <motion.button
                            type="button"
                            className="fennel-btn-approve"
                            onClick={() => handleDecide(item.id, true)}
                            whileTap={{ scale: 0.94 }}
                          >
                            Approve
                          </motion.button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </motion.section>

            {/* Running now / Background Tasks Card */}
            <motion.section
              className="fennel-card"
              whileHover={{ y: -2, transition: springTransition }}
            >
              <div className="fennel-card-header">
                <div className="fennel-card-title-group">
                  <h2 className="fennel-card-title">Automations & background</h2>
                  <span className="fennel-count-pill">{automations.length}</span>
                </div>
                <button
                  type="button"
                  className="fennel-see-all-btn"
                  onClick={() => setView('automations')}
                >
                  Manage
                </button>
              </div>

              <div className="fennel-running-list">
                {automations.length === 0 ? (
                  <div className="fennel-empty-state">
                    <span className="fennel-empty-icon-wrap">
                      <Icon name="clock" size={18} />
                    </span>
                    <div className="fennel-empty-text">
                      <div className="fennel-empty-heading">No background tasks running</div>
                      <div className="fennel-empty-sub">
                        Automations and scheduled background routines will display live status here.
                      </div>
                    </div>
                  </div>
                ) : (
                  automations.map((auto) => (
                    <div key={auto.id} className="fennel-running-row">
                      <div className="fennel-running-left">
                        <span className="fennel-agent-dot-avatar">
                          <Icon name="clock" size={13} />
                        </span>
                        <div className="fennel-running-details">
                          <div className="fennel-running-name">{auto.name || auto.title}</div>
                          <div className="fennel-running-subtitle">
                            {auto.schedule || 'Scheduled automation'}
                          </div>
                        </div>
                      </div>

                      <div className="fennel-running-right">
                        <span className="fennel-badge-status">
                          {auto.enabled !== false ? 'Active' : 'Paused'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.section>
          </div>

          {/* Right Column (Recent files + Your agents) */}
          <div className="fennel-main-right-col">
            {/* Recent files Card */}
            <motion.section
              className="fennel-card"
              whileHover={{ y: -2, transition: springTransition }}
            >
              <div className="fennel-card-header">
                <h2 className="fennel-card-title">Recent files</h2>
                <button
                  type="button"
                  className="fennel-see-all-btn"
                  onClick={() => setView('library')}
                >
                  Open Library
                </button>
              </div>

              <div className="fennel-files-list">
                {libraryFiles.length === 0 ? (
                  <div className="fennel-empty-state">
                    <span className="fennel-empty-icon-wrap">
                      <Icon name="files" size={18} />
                    </span>
                    <div className="fennel-empty-text">
                      <div className="fennel-empty-heading">No files yet</div>
                      <div className="fennel-empty-sub">
                        Research summaries and captures saved in Library will show here.
                      </div>
                    </div>
                  </div>
                ) : (
                  libraryFiles.slice(0, 4).map((file) => (
                    <motion.button
                      key={file.id}
                      type="button"
                      className="fennel-file-row"
                      onClick={() => setView('library')}
                      whileHover={{ x: 2 }}
                    >
                      <div className="fennel-file-left">
                        <span className="fennel-file-icon">
                          <Icon name="file" size={14} />
                        </span>
                        <div className="fennel-file-text">
                          <div className="fennel-file-title">{file.title || 'Untitled document'}</div>
                          <div className="fennel-file-meta">{file.kind || 'Document'}</div>
                        </div>
                      </div>
                      <Icon name="chevron-right" size={13} className="fennel-file-arrow" />
                    </motion.button>
                  ))
                )}
              </div>
            </motion.section>

            {/* Active System & Capabilities */}
            <motion.section
              className="fennel-card"
              whileHover={{ y: -2, transition: springTransition }}
            >
              <div className="fennel-card-header">
                <div className="fennel-card-title-group">
                  <h2 className="fennel-card-title">Agent & capabilities</h2>
                  <span className="fennel-count-pill">{capabilities.skills.length + 1}</span>
                </div>
                <button
                  type="button"
                  className="fennel-see-all-btn"
                  onClick={() => setView('capabilities')}
                >
                  Configure
                </button>
              </div>

              <div className="fennel-agents-grid">
                <motion.div
                  className="fennel-agent-tile"
                  whileHover={{ y: -3, transition: springTransition }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    setAppMode('agent')
                    setView('chat')
                  }}
                >
                  <span className="fennel-agent-tile-icon fennel-agent-tile-icon--primary">
                    <BrandMark size={16} glow={false} />
                  </span>
                  <span className="fennel-agent-tile-name">Director</span>
                  <span className="fennel-agent-tile-status">
                    <span className="fennel-status-dot" />
                    Ready
                  </span>
                </motion.div>

                {activeConnectors.map((c) => (
                  <motion.div
                    key={c.id || c.name}
                    className="fennel-agent-tile"
                    whileHover={{ y: -3, transition: springTransition }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setView('capabilities')}
                  >
                    <span className="fennel-agent-tile-icon fennel-agent-tile-icon--connector">
                      <Icon name="plug" size={15} />
                    </span>
                    <span className="fennel-agent-tile-name">{c.name || c.id}</span>
                    <span className="fennel-agent-tile-status">
                      <span className="fennel-status-dot" />
                      Active
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.section>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
