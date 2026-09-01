import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api, serverTime } from '../api.js'
import { SkeletonCard, default as Skeleton } from '../components/Skeleton.jsx'
import Button from '../components/ui/Button.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import ErrorState from '../components/ui/ErrorState.jsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../components/ui/dropdown-menu.tsx'
import RunHistoryChart from '../components/automations/RunHistoryChart.jsx'
import TemplateGrid from '../components/automations/TemplateGrid.jsx'
import NewAutomationModal from '../components/automations/NewAutomationModal.jsx'
import EditAutomationModal from '../components/automations/EditAutomationModal.jsx'
import RunDetailModal from '../components/automations/RunDetailModal.jsx'

/* Automations: a turn that runs without anyone typing.

   Tabs: Automations (list + chart), Runs (history), Templates.
   Supports interval, daily_at, and weekly_at scheduling. */

function when(iso) {
  if (!iso) return '—'
  const at = serverTime(iso)
  if (!at) return iso
  const delta = at.getTime() - Date.now()
  const mins = Math.round(Math.abs(delta) / 60000)
  const size = mins < 60
    ? `${Math.max(1, mins)} minute${mins === 1 ? '' : 's'}`
    : mins < 1440
      ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'}`
      : `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'}`
  return delta >= 0 ? `in ${size}` : `${size} ago`
}

function formatSchedule(auto) {
  if (auto.schedule_type === 'daily_at' && auto.daily_at_time) {
    return `Daily at ${auto.daily_at_time}`
  }
  if (auto.schedule_type === 'weekly_at' && auto.daily_at_time) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return `${days[auto.weekly_day || 0]} at ${auto.daily_at_time}`
  }
  // Interval
  const mins = auto.every_minutes
  if (mins >= 60 * 24 * 7) return `Every ${mins / (60 * 24 * 7)} week${mins / (60 * 24 * 7) === 1 ? '' : 's'}`
  if (mins >= 60 * 24) return `Every ${mins / (60 * 24)} day${mins / (60 * 24) === 1 ? '' : 's'}`
  if (mins >= 60) return `Every ${mins / 60} hour${mins / 60 === 1 ? '' : 's'}`
  return `Every ${mins} minute${mins === 1 ? '' : 's'}`
}

function formatDuration(ms) {
  if (!ms) return '—'
  if (ms < 1000) return '<1s'
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

/** Scheduler health banner. Shows whether automations run when the app is closed. */
function SchedulerBanner({ scheduler }) {
  if (!scheduler) return null
  return (
    <div className={`auto-scheduler-banner${scheduler.external_configured ? '' : ' auto-scheduler-banner--warn'}`} data-enter>
      <div className="auto-scheduler-banner-left">
        <Icon name={scheduler.external_configured ? 'check-circle' : 'info'} size={14} />
        <span>
          {scheduler.external_configured
            ? 'Automations run in the background via GitHub Actions, even when the app is closed.'
            : 'Automations run while this server is up. Set up GitHub Actions for background execution.'}
        </span>
      </div>
      <div className="auto-scheduler-banner-right">
        {scheduler.timezone && (
          <span className="auto-scheduler-tz">
            <Icon name="clock" size={11} />
            {scheduler.timezone}
          </span>
        )}
        {scheduler.enabled_count > 0 && (
          <span className="auto-scheduler-count">
            {scheduler.enabled_count} active
          </span>
        )}
      </div>
    </div>
  )
}

/** Summary stats cards above the automation list. */
function StatsCards({ rows, stats }) {
  const activeCount = rows.filter((r) => r.enabled).length
  const totals = stats?.totals || {}
  const successRate = totals.total > 0
    ? Math.round(((totals.success || 0) / totals.total) * 100)
    : null

  return (
    <div className="auto-stats-cards" data-enter>
      <div className="auto-stats-card">
        <div className="auto-stats-card-value">{rows.length}</div>
        <div className="auto-stats-card-label">Automations</div>
      </div>
      <div className="auto-stats-card">
        <div className="auto-stats-card-value">{activeCount}</div>
        <div className="auto-stats-card-label">Active</div>
      </div>
      <div className="auto-stats-card">
        <div className="auto-stats-card-value">{totals.total || 0}</div>
        <div className="auto-stats-card-label">Runs (30d)</div>
      </div>
      {successRate !== null && (
        <div className="auto-stats-card">
          <div className={`auto-stats-card-value ${successRate >= 90 ? 'is-good' : successRate >= 50 ? 'is-warn' : 'is-bad'}`}>
            {successRate}%
          </div>
          <div className="auto-stats-card-label">Success rate</div>
        </div>
      )}
    </div>
  )
}

/** Automations list row with actions. */
function AutomationRow({ auto, busy: _busy, onAction, onEdit }) {
  return (
    <div className={`auto-table-row${auto.enabled ? '' : ' is-off'}`}>
      <div className="auto-table-cell auto-table-cell--name">
        <button type="button" className="auto-table-name-btn" onClick={() => onEdit(auto)}>
          <Icon name="zap" size={14} className="auto-table-icon" />
          <span>{auto.name}</span>
        </button>
        {auto.description && (
          <span className="auto-table-desc">{auto.description}</span>
        )}
      </div>
      <div className="auto-table-cell auto-table-cell--schedule">
        {formatSchedule(auto)}
      </div>
      <div className="auto-table-cell auto-table-cell--next">
        {auto.enabled ? when(auto.next_run_at) : 'Paused'}
      </div>
      <div className="auto-table-cell auto-table-cell--status">
        <span className={`auto-status-badge auto-status-badge--${auto.last_status || 'none'}`}>
          {auto.last_status === 'running' && <Icon name="clock" size={10} className="auto-spin-icon" />}
          {auto.last_status === 'ok' && <Icon name="check" size={10} />}
          {auto.last_status === 'error' && <Icon name="x" size={10} />}
          {auto.last_status === 'blocked' && <Icon name="warning" size={10} />}
          {auto.last_status === 'partial' && <Icon name="warning" size={10} />}
          {auto.enabled ? (auto.last_status || 'Idle') : 'Paused'}
        </span>
      </div>
      <div className="auto-table-cell auto-table-cell--actions">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="icon-btn"
            aria-label="Actions"
          >
            <Icon name="dots" size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
            <DropdownMenuItem onClick={() => onEdit(auto)}>
              <Icon name="edit" size={12} />
              <span>Edit</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction(auto, 'toggle')}>
              <Icon name={auto.enabled ? 'pause' : 'play'} size={12} />
              <span>{auto.enabled ? 'Pause' : 'Resume'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction(auto, 'run')}>
              <Icon name="play" size={12} />
              <span>Run now</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onAction(auto, 'delete')}>
              <Icon name="trash" size={12} />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** Runs tab content with clickable rows to open run details. */
function RunsTab({ onSelectRun }) {
  const [runs, setRuns] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.recentRuns(100).then((data) => {
      setRuns(data.runs || [])
    }).catch(() => setRuns([])).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="auto-runs-tab" aria-hidden="true">
        <div className="auto-runs-table">
          <div className="auto-runs-table-head">
            <span>Run</span>
            <span>Automation</span>
            <span>Duration</span>
            <span>Time</span>
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="auto-runs-row" style={{ pointerEvents: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Skeleton w={14} h={14} r={99} />
                <Skeleton w={120} h={12} r={4} />
              </div>
              <Skeleton w={150} h={13} r={4} />
              <Skeleton w={45} h={11} r={3} />
              <Skeleton w={75} h={11} r={3} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="auto-runs-tab">
      {runs.length === 0 ? (
        <EmptyState icon="clock">No runs yet. Create an automation and run it to see history here.</EmptyState>
      ) : (
        <div className="auto-runs-table">
          <div className="auto-runs-table-head">
            <span>Run</span>
            <span>Automation</span>
            <span>Duration</span>
            <span>Time</span>
          </div>
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className="auto-runs-row auto-runs-row--clickable"
              onClick={() => onSelectRun(run.id)}
            >
              <span className={`auto-runs-status auto-runs-status--${run.status}`}>
                {run.status === 'success' ? (
                  <Icon name="check" size={12} />
                ) : run.status === 'failed' ? (
                  <Icon name="x" size={12} />
                ) : run.status === 'running' ? (
                  <Icon name="clock" size={12} />
                ) : run.status === 'blocked' ? (
                  <Icon name="warning" size={12} />
                ) : run.status === 'partial' ? (
                  <Icon name="warning" size={12} />
                ) : (
                  <Icon name="minus" size={12} />
                )}
                <span className="auto-runs-summary">
                  {run.result_summary || run.error || 'No details'}
                </span>
              </span>
              <span className="auto-runs-auto-name">{run.automation_name}</span>
              <span className="auto-runs-duration">{formatDuration(run.duration_ms)}</span>
              <span className="auto-runs-time">
                {run.created_at ? new Date(run.created_at).toLocaleString() : '—'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Automations() {
  const rootRef = useRef(null)
  const { toast } = useApp()
  const [tab, setTab] = useState('automations')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newTemplate, setNewTemplate] = useState(null)
  const [editAuto, setEditAuto] = useState(null)
  const [stats, setStats] = useState(null)
  const [scheduler, setScheduler] = useState(null)
  const [selectedRunId, setSelectedRunId] = useState(null)
  useViewEntrance(rootRef)

  const load = useCallback(async () => {
    try {
      const data = await api.automations()
      setRows(data.automations || [])
      setError(null)
    } catch (err) {
      setError(err.message)
      toast(err.message, 'bad')
    } finally {
      setLoaded(true)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  // Load overall stats — the aggregate across all automations
  useEffect(() => {
    if (loaded && tab === 'automations') {
      api.automationOverallStats().then(setStats).catch(() => {})
    }
  }, [loaded, tab])

  // Load scheduler status once
  useEffect(() => {
    api.automationScheduler().then(setScheduler).catch(() => {})
  }, [])

  // Poll when a run is in flight
  useEffect(() => {
    if (!rows.some((r) => r.last_status === 'running')) return undefined
    const tick = setInterval(load, 4000)
    return () => clearInterval(tick)
  }, [rows, load])

  const act = useCallback(async (auto, action) => {
    setBusy(`${auto.id}:${action}`)
    try {
      if (action === 'run') {
        const job = await api.runAutomation(auto.id)
        toast(
          job.state === 'running' || job.state === 'queued'
            ? `"${auto.name}" is running`
            : `"${auto.name}": ${job.blocked_on || job.last_error || job.state}`,
          job.state === 'failed' ? 'bad' : job.blocked_on ? 'amber' : 'ok',
        )
      } else if (action === 'toggle') {
        await api.updateAutomation(auto.id, { enabled: !auto.enabled })
      } else if (action === 'delete') {
        if (!confirm(`Delete "${auto.name}"? Conversations it wrote are kept.`)) return
        await api.deleteAutomation(auto.id)
        toast('Automation deleted', 'info')
      }
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [load, toast])

  const handleNewFromTemplate = useCallback((template) => {
    setNewTemplate(template)
    setShowNew(true)
  }, [])

  const handleCreated = useCallback(() => {
    setShowNew(false)
    setNewTemplate(null)
    load()
  }, [load])

  const handleEditSaved = useCallback(() => {
    setEditAuto(null)
    load()
  }, [load])

  const handleEditDeleted = useCallback(() => {
    setEditAuto(null)
    load()
  }, [load])

  const totalRuns = useMemo(() => {
    if (!stats?.by_day) return 0
    return Object.values(stats.by_day).reduce((s, d) => s + (d.total || 0), 0)
  }, [stats])

  return (
    <div className="view" ref={rootRef}>
      <div className="view-inner view-inner--wide">
        <header className="auto-header" data-enter>
          <div className="auto-header-tabs">
            <button
              type="button"
              className={`auto-header-tab${tab === 'automations' ? ' is-active' : ''}`}
              onClick={() => setTab('automations')}
            >
              Automations
            </button>
            <button
              type="button"
              className={`auto-header-tab${tab === 'runs' ? ' is-active' : ''}`}
              onClick={() => setTab('runs')}
            >
              Runs
            </button>
            <button
              type="button"
              className={`auto-header-tab${tab === 'templates' ? ' is-active' : ''}`}
              onClick={() => setTab('templates')}
            >
              Templates
            </button>
          </div>
          <Button
            variant="primary"
            pill
            icon={<Icon name="plus" size={14} />}
            onClick={() => { setNewTemplate(null); setShowNew(true) }}
          >
            New Automation
          </Button>
        </header>

        {/* Scheduler status banner */}
        <SchedulerBanner scheduler={scheduler} />

        <AnimatePresence mode="wait">
          {tab === 'automations' && (
            <motion.div
              key="tab-automations"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {/* Stats summary cards */}
              {loaded && rows.length > 0 && (
                <StatsCards rows={rows} stats={stats} />
              )}

              {/* Run History Chart */}
              {loaded && rows.length > 0 && (
                <RunHistoryChart stats={stats} totalRuns={totalRuns} />
              )}

              {/* Automation List */}
              {!loaded && (
                <div className="auto-table" aria-hidden="true">
                  <div className="auto-table-head">
                    <span>Automation</span>
                    <span>Schedule</span>
                    <span>Next run</span>
                    <span>Status</span>
                    <span></span>
                  </div>
                  {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="auto-table-row" style={{ pointerEvents: 'none' }}>
                      <div className="auto-table-cell auto-table-cell--name">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                          <Skeleton w={16} h={16} r={4} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <Skeleton w={140} h={14} r={4} />
                            <Skeleton w={200} h={11} r={3} />
                          </div>
                        </div>
                      </div>
                      <div className="auto-table-cell"><Skeleton w={80} h={12} r={4} /></div>
                      <div className="auto-table-cell"><Skeleton w={65} h={12} r={4} /></div>
                      <div className="auto-table-cell"><Skeleton w={40} h={18} r={99} /></div>
                      <div className="auto-table-cell auto-table-cell--actions"><Skeleton w={24} h={24} r={6} /></div>
                    </div>
                  ))}
                </div>
              )}
              {loaded && error && <ErrorState message={error} onRetry={load} />}
              {loaded && !error && rows.length === 0 && !showNew && (
                <EmptyState icon="clock">
                  Nothing runs on its own yet. Create an automation or pick a template below.
                </EmptyState>
              )}

              {loaded && rows.length > 0 && (
                <div className="auto-table" data-enter>
                  <div className="auto-table-head">
                    <span>Automation</span>
                    <span>Schedule</span>
                    <span>Next run</span>
                    <span>Status</span>
                    <span></span>
                  </div>
                  {rows.map((auto) => (
                    <AutomationRow
                      key={auto.id}
                      auto={auto}
                      busy={busy}
                      onAction={act}
                      onEdit={setEditAuto}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'runs' && (
            <motion.div
              key="tab-runs"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <RunsTab onSelectRun={setSelectedRunId} />
            </motion.div>
          )}

          {tab === 'templates' && (
            <motion.div
              key="tab-templates"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <TemplateGrid onSelect={handleNewFromTemplate} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modals */}
        <AnimatePresence>
          {showNew && (
            <NewAutomationModal
              key="modal-new"
              template={newTemplate}
              onClose={() => { setShowNew(false); setNewTemplate(null) }}
              onCreated={handleCreated}
            />
          )}
          {editAuto && (
            <EditAutomationModal
              key={`modal-edit-${editAuto.id}`}
              automation={editAuto}
              onClose={() => setEditAuto(null)}
              onSaved={handleEditSaved}
              onDeleted={handleEditDeleted}
              onSelectRun={setSelectedRunId}
            />
          )}
          {selectedRunId && (
            <RunDetailModal
              key={`modal-run-${selectedRunId}`}
              runId={selectedRunId}
              onClose={() => setSelectedRunId(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
