import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api, fmtDate } from '../api.js'
import Skeleton from '../components/Skeleton.jsx'
import ErrorState from '../components/ui/ErrorState.jsx'

// Four Today Dashboard Cards
import TodayTasksCard from './today/TodayTasksCard.jsx'
import TodayMailsCard from './today/TodayMailsCard.jsx'
import TodayMemoryCard from './today/TodayMemoryCard.jsx'
import TodayLibraryCard from './today/TodayLibraryCard.jsx'
import './today/today.css'

const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function greeting(hour) {
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Today Section - Reworked into four interactive, fixed-size, theme-aware cards:
 * 1. Tasks Card (all tasks, visual progress fill, detail popup, contribution graph, add task)
 * 2. Recent Mails Card (recent emails, in-card reader, dismiss action)
 * 3. Recent Memory Card (prompt-framed "Do you remember...", exactly 2 memories, accent gradient)
 * 4. Library Card (today's saves only, short title + thumbnail, resets daily)
 */
export default function Today() {
  const rootRef = useRef(null)
  const { toast, setView } = useApp()
  const [tasks, setTasks] = useState([])
  const [completedTasks, setCompletedTasks] = useState([])
  const [todaySignals, setTodaySignals] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const loadToken = useRef(0)

  useViewEntrance(rootRef, [loading])

  const loadData = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const [allTasksRes, completedTasksRes, todayRes] = await Promise.all([
        api.tasks({ bucket: 'all', limit: 200 }).catch(() => []),
        api.tasks({ bucket: 'completed', limit: 500 }).catch(() => []),
        api.today().catch(() => null),
      ])

      if (loadToken.current !== token) return
      setTasks(Array.isArray(allTasksRes) ? allTasksRes : [])
      setCompletedTasks(Array.isArray(completedTasksRes) ? completedTasksRes : [])
      setTodaySignals(todayRes?.signals || null)
      setError(null)
    } catch (err) {
      if (loadToken.current !== token) return
      setError(err.message)
    } finally {
      if (loadToken.current === token) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const handleProgress = () => {
      loadData()
    }
    window.addEventListener('storage', handleProgress)
    window.addEventListener('amethyst-task-progress-updated', handleProgress)
    return () => {
      window.removeEventListener('storage', handleProgress)
      window.removeEventListener('amethyst-task-progress-updated', handleProgress)
    }
  }, [loadData])

  const now = new Date()

  if (error) {
    return (
      <div className="view" ref={rootRef}>
        <div className="view-inner view-inner--wide">
          <header className="vheader" data-enter>
            <div>
              <h1>Today</h1>
            </div>
          </header>
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </div>
    )
  }

  return (
    <div className="view today-view" ref={rootRef}>
      <div className="view-inner view-inner--wide">
        {/* Top Header matching reference visual foundation */}
        <header className="vheader" data-enter style={{ marginBottom: 8 }}>
          <div>
            <h1>{greeting(now.getHours())}</h1>
            <div className="vheader-sub">
              {WEEKDAY[(now.getDay() + 6) % 7]}, {fmtDate(now.toISOString())}
            </div>
          </div>
          <div className="vheader-actions">
            <button
              type="button"
              className="btn btn--ghost"
              style={{ borderRadius: 9999 }}
              onClick={loadData}
              title="Refresh dashboard"
            >
              <Icon name="refresh" size={15} /> Refresh
            </button>
          </div>
        </header>

        {loading ? (
          /* Component-accurate skeleton matching the 4 bento cards */
          <div className="today-dashboard-grid" aria-hidden="true" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {/* 1. Tasks Card Skeleton */}
            <div className="today-card" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <Skeleton w={100} h={18} r={5} />
                <Skeleton w={42} h={18} rounded />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-raised)', borderRadius: 10 }}>
                  <Skeleton w={18} h={18} rounded />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <Skeleton w={`${55 + (i * 15)}%`} h={13} r={4} />
                    <Skeleton w="32%" h={10} r={3} />
                  </div>
                </div>
              ))}
            </div>

            {/* 2. Mails Card Skeleton */}
            <div className="today-card" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <Skeleton w={110} h={18} r={5} />
                <Skeleton w={48} h={18} rounded />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--surface-raised)', borderRadius: 10 }}>
                  <Skeleton w={26} h={26} rounded />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <Skeleton w={`${60 + (i * 12)}%`} h={13} r={4} />
                    <Skeleton w="85%" h={10} r={3} />
                  </div>
                </div>
              ))}
            </div>

            {/* 3. Memory Card Skeleton */}
            <div className="today-card" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <Skeleton w={120} h={18} r={5} />
                <Skeleton w={36} h={18} rounded />
              </div>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} style={{ padding: '12px 14px', background: 'var(--surface-raised)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Skeleton w="40%" h={12} r={3} />
                  <Skeleton w="95%" h={13} r={4} />
                  <Skeleton w="75%" h={11} r={3} />
                </div>
              ))}
            </div>

            {/* 4. Library Card Skeleton */}
            <div className="today-card" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <Skeleton w={90} h={18} r={5} />
                <Skeleton w={50} h={18} rounded />
              </div>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 12px', background: 'var(--surface-raised)', borderRadius: 10, alignItems: 'center' }}>
                  <Skeleton w={64} h={48} r={8} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Skeleton w="80%" h={13} r={4} />
                    <Skeleton w="50%" h={10} r={3} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* 4-Card Bento Grid System */
          <div className="today-dashboard-grid" data-enter>
            {/* 1. Tasks Card */}
            <TodayTasksCard
              tasks={tasks}
              completedTasks={completedTasks}
              onTasksChange={loadData}
              toast={toast}
            />

            {/* 2. Recent Mails Card */}
            <TodayMailsCard toast={toast} />

            {/* 3. Recent Memory Card */}
            <TodayMemoryCard setView={setView} />

            {/* 4. Library Card */}
            <TodayLibraryCard
              setView={setView}
              todayItems={todaySignals?.library?.items}
            />
          </div>
        )}
      </div>
    </div>
  )
}
