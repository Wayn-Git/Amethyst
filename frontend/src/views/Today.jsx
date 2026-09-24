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
        api.tasks({ bucket: 'all', limit: 100 }).catch(() => []),
        api.tasks({ bucket: 'completed', limit: 100 }).catch(() => []),
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
          /* Skeleton loading state with matching 4-card fixed grid */
          <div className="today-dashboard-grid" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="today-card" style={{ gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Skeleton w={110} h={18} />
                  <Skeleton w={50} h={18} rounded />
                </div>
                <Skeleton w="100%" h={65} style={{ borderRadius: 12 }} />
                <Skeleton w="100%" h={52} style={{ borderRadius: 12 }} />
                <Skeleton w="100%" h={52} style={{ borderRadius: 12 }} />
                <Skeleton w="80%" h={40} style={{ borderRadius: 12 }} />
              </div>
            ))}
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
