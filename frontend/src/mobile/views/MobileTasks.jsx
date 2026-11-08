import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getTasks,
  createTask,
  completeTask,
} from '../msTodoClient.js'
import {
  getConnectionStatus,
  subscribeConnectionStatus,
  createMicrosoftAuthUrl,
  MS_DEFAULT_REDIRECT_URI,
} from '../connectionStatus.js'

export default function MobileTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [connectionState, setConnectionState] = useState('loading') // 'loading' | 'connected' | 'not_connected' | 'token_expired' | 'offline'
  const [showCompleted, setShowCompleted] = useState(false)
  const [currentListId, setCurrentListId] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  // Compute current week dates
  const now = new Date()
  const currentDayOfWeek = now.getDay() // 0 = Sun, 1 = Mon ...
  const monday = new Date(now)
  const diffToMonday = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek
  monday.setDate(now.getDate() + diffToMonday)

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, idx) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + idx)
    return {
      day: dayName,
      date: d.getDate(),
      fullDate: d,
      isToday: d.toDateString() === now.toDateString(),
    }
  })

  const [selectedDate, setSelectedDate] = useState(now.getDate())
  const monthYearString = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const loadTasks = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setConnectionState('offline')
      setLoading(false)
      return
    }

    const conn = getConnectionStatus()
    if (conn.microsoftTodo === 'missing') {
      setConnectionState('not_connected')
      setLoading(false)
      return
    }
    if (conn.microsoftTodo === 'expired') {
      setConnectionState('token_expired')
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await getTasks(null, { includeCompleted: true })
      const list = Array.isArray(res) ? res : res?.tasks || []
      setTasks(list)
      if (res.listId) setCurrentListId(res.listId)
      setConnectionState('connected')
    } catch (err) {
      if (err.isOffline || err.code === 'OFFLINE' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        setConnectionState('offline')
      } else if (err.code === 'TOKEN_EXPIRED' || err.status === 401) {
        setConnectionState('token_expired')
      } else if (err.code === 'NOT_CONNECTED') {
        setConnectionState('not_connected')
      } else {
        console.warn('[MobileTasks] Load failed:', err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTasks()

    const unsubscribe = subscribeConnectionStatus((status) => {
      if (status.microsoftTodo === 'missing') {
        setConnectionState('not_connected')
      } else if (status.microsoftTodo === 'expired') {
        setConnectionState('token_expired')
      }
    })

    const handleOnline = () => {
      if (connectionState === 'offline') {
        loadTasks()
      }
    }
    const handleOffline = () => {
      setConnectionState('offline')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      unsubscribe()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadTasks, connectionState])

  const toggleTask = async (task) => {
    const isCompleted = task.status === 'completed' || task.completed
    const nextStatus = isCompleted ? 'todo' : 'completed'
    const nextCompleted = !isCompleted

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: nextStatus, completed: nextCompleted } : t
      )
    )

    try {
      await completeTask(task.listId || currentListId, task.id, nextCompleted)
    } catch (err) {
      console.error('[MobileTasks] Update failed:', err.message)
      if (err.code === 'TOKEN_EXPIRED' || err.status === 401) {
        setConnectionState('token_expired')
      } else if (err.isOffline || err.code === 'OFFLINE') {
        setConnectionState('offline')
      }
      loadTasks()
    }
  }

  const handleCreateTask = async (e) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setAdding(true)
    try {
      const created = await createTask({
        title: newTitle.trim(),
        listId: currentListId,
      })
      if (created) {
        setTasks((prev) => [...prev, created])
      } else {
        await loadTasks()
      }
      setNewTitle('')
    } catch (err) {
      console.error('[MobileTasks] Create failed:', err.message)
      if (err.code === 'TOKEN_EXPIRED' || err.status === 401) {
        setConnectionState('token_expired')
      } else if (err.isOffline || err.code === 'OFFLINE') {
        setConnectionState('offline')
      }
    } finally {
      setAdding(false)
    }
  }

  const handleConnect = async () => {
    try {
      const { url } = await createMicrosoftAuthUrl({
        redirectUri: MS_DEFAULT_REDIRECT_URI,
      })
      if (url && typeof window !== 'undefined') {
        window.location.href = url
      }
    } catch (err) {
      console.error('[MobileTasks] Failed to initiate Microsoft connect:', err.message)
    }
  }

  const completedCount = tasks.filter((t) => t.status === 'completed' || t.completed).length
  const totalCount = tasks.length
  const leftCount = Math.max(0, totalCount - completedCount)
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const visibleTasks = showCompleted
    ? tasks
    : tasks.filter((t) => t.status !== 'completed' && !t.completed)

  return (
    <motion.div
      className="b"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="r sp">
        <div>
          <div className="gl">{monthYearString}</div>
          <h1 className="h">Tasks</h1>
        </div>

        {/* Dynamic status badge (Loading / Connected / Not connected / Token expired / Offline) */}
        {loading ? (
          <span className="ch">
            <span className="d" style={{ background: '#0071E3' }} />
            Loading…
          </span>
        ) : connectionState === 'connected' ? (
          <span className="ch">
            <span className="d" style={{ background: '#34C759' }} />
            To Do synced
          </span>
        ) : connectionState === 'not_connected' ? (
          <span className="ch" style={{ color: '#8E8E93' }}>
            <span className="d" style={{ background: '#8E8E93' }} />
            Not connected
          </span>
        ) : connectionState === 'token_expired' ? (
          <span className="ch" style={{ color: '#FF9500' }}>
            <span className="d" style={{ background: '#FF9500' }} />
            Token expired
          </span>
        ) : connectionState === 'offline' ? (
          <span className="ch" style={{ color: '#8E8E93' }}>
            <span className="d" style={{ background: '#8E8E93' }} />
            Offline
          </span>
        ) : null}
      </div>

      {/* Week Day Selector */}
      <div className="r sp" style={{ gap: 4 }}>
        {weekDays.map((item) => {
          const isSelected = item.date === selectedDate
          return (
            <motion.div
              key={item.day}
              className="col"
              whileTap={{ scale: 0.95 }}
              style={{
                alignItems: 'center',
                gap: 4,
                padding: '8px 6px',
                borderRadius: 16,
                minWidth: 44,
                cursor: 'pointer',
                background: isSelected ? '#FFFFFF' : 'transparent',
                boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,.08)' : 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}
              onClick={() => setSelectedDate(item.date)}
            >
              <span className="m" style={{ color: isSelected ? '#1D1D1F' : '#6E6E73' }}>
                {item.day}
              </span>
              <span style={{ fontWeight: isSelected ? 600 : 400, fontSize: 15 }}>
                {item.date}
              </span>
            </motion.div>
          )
        })}
      </div>

      {/* Status Progress Banner Card */}
      <div className="blk r sp" style={{ padding: '16px 18px', borderRadius: 24 }}>
        <div>
          <div className="st">{leftCount} left today</div>
          <div className="m" style={{ color: '#A9A6A0' }}>
            {completedCount} of {totalCount} done
          </div>
        </div>
        <div style={{ width: 120 }}>
          <div className="pb" style={{ background: '#2C2C2E' }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                background: '#fff',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* Offline banner alert if offline but has tasks */}
      {connectionState === 'offline' && tasks.length > 0 && (
        <div
          className="r"
          style={{
            background: '#F2F2F7',
            padding: '10px 14px',
            borderRadius: 14,
            fontSize: 12.5,
            color: '#6E6E73',
            gap: 8,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8E8E93', flex: 'none' }} />
          <span>Offline mode · Showing cached tasks</span>
        </div>
      )}

      {/* Section Subheader with Completed Tasks Toggle */}
      <div className="r sp" style={{ alignItems: 'center' }}>
        <span className="st">Today</span>
        <button
          type="button"
          className="ch"
          style={{
            cursor: 'pointer',
            fontSize: 12,
            padding: '4px 10px',
            background: showCompleted ? '#E5E5EA' : 'transparent',
            border: '1px solid #D1D1D6',
            borderRadius: 999,
            transition: 'background 0.15s ease',
          }}
          onClick={() => setShowCompleted((prev) => !prev)}
        >
          {showCompleted ? 'Hide completed' : `Show completed (${completedCount})`}
        </button>
      </div>

      {/* Task List / State Card */}
      <div className="c" style={{ padding: '4px 16px' }}>
        {/* State: Not connected */}
        {connectionState === 'not_connected' && !loading && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }} className="col">
            <svg
              viewBox="0 0 24 24"
              width="36"
              height="36"
              fill="none"
              stroke="#8E8E93"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: '0 auto 10px' }}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Not connected</div>
            <div className="m" style={{ maxWidth: 260, margin: '6px auto 16px', lineHeight: 1.4 }}>
              Connect your Microsoft To Do account to view and synchronize your tasks directly.
            </div>
            <button
              type="button"
              className="bt"
              style={{ alignSelf: 'center', minHeight: 40, padding: '0 20px' }}
              onClick={handleConnect}
            >
              Connect Microsoft To Do
            </button>
          </div>
        )}

        {/* State: Token expired */}
        {connectionState === 'token_expired' && !loading && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }} className="col">
            <svg
              viewBox="0 0 24 24"
              width="36"
              height="36"
              fill="none"
              stroke="#FF9500"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: '0 auto 10px' }}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#FF9500' }}>Token expired</div>
            <div className="m" style={{ maxWidth: 260, margin: '6px auto 16px', lineHeight: 1.4 }}>
              Your Microsoft sign-in session expired. Reconnect to resume sync.
            </div>
            <button
              type="button"
              className="bt"
              style={{ alignSelf: 'center', minHeight: 40, padding: '0 20px' }}
              onClick={handleConnect}
            >
              Reconnect
            </button>
          </div>
        )}

        {/* State: Offline (when no tasks cached) */}
        {connectionState === 'offline' && !tasks.length && !loading && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }} className="col">
            <svg
              viewBox="0 0 24 24"
              width="36"
              height="36"
              fill="none"
              stroke="#8E8E93"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: '0 auto 10px' }}
              aria-hidden="true"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Offline</div>
            <div className="m" style={{ maxWidth: 260, margin: '6px auto 0', lineHeight: 1.4 }}>
              No internet connection. Tasks will load when your device reconnects.
            </div>
          </div>
        )}

        {/* State: Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '28px 16px', color: '#6E6E73' }}>
            Loading tasks…
          </div>
        )}

        {/* State: Connected & Visible Tasks List */}
        {!loading &&
          connectionState !== 'not_connected' &&
          connectionState !== 'token_expired' &&
          visibleTasks.map((task, idx) => {
            const isDone = task.status === 'completed' || task.completed
            return (
              <div key={task.id || idx}>
                <div
                  className="r"
                  style={{ padding: '12px 0', cursor: 'pointer' }}
                  onClick={() => toggleTask(task)}
                >
                  {/* Round Checkbox */}
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isDone ? '#0071E3' : 'transparent',
                      border: isDone ? 'none' : '1.6px solid #8E8E93',
                      color: '#fff',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {isDone && (
                      <svg
                        viewBox="0 0 24 24"
                        width="13"
                        height="13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>

                  {/* Task Details */}
                  <div style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                    <div
                      style={{
                        fontWeight: 500,
                        textDecoration: isDone ? 'line-through' : 'none',
                        color: isDone ? '#6E6E73' : '#1D1D1F',
                        transition: 'color 0.15s',
                      }}
                    >
                      {task.title}
                    </div>
                    <div className="m" style={{ marginTop: 2 }}>
                      {task.context || task.list_name || 'Tasks'}
                      {task.due ? `, ${task.due}` : ''}
                    </div>
                  </div>
                </div>
                {idx < visibleTasks.length - 1 && <div className="hr" />}
              </div>
            )
          })}

        {/* Empty state: No tasks at all */}
        {!loading &&
          connectionState === 'connected' &&
          !tasks.length && (
            <div style={{ textAlign: 'center', padding: '32px 16px' }} className="col">
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                fill="none"
                stroke="#8E8E93"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ margin: '0 auto 8px' }}
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <div style={{ fontWeight: 600 }}>No tasks for today</div>
              <div className="m">Add a new task below to get started.</div>
            </div>
          )}

        {/* Empty state: Has tasks, but all completed and toggle is off */}
        {!loading &&
          connectionState === 'connected' &&
          tasks.length > 0 &&
          !visibleTasks.length && (
            <div style={{ textAlign: 'center', padding: '24px 16px' }} className="col">
              <div style={{ fontWeight: 500, color: '#6E6E73' }}>
                All tasks completed ({completedCount})
              </div>
              <button
                type="button"
                className="ch"
                style={{
                  alignSelf: 'center',
                  marginTop: 8,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                onClick={() => setShowCompleted(true)}
              >
                Show completed tasks
              </button>
            </div>
          )}
      </div>

      {/* Quick Add Inline Form */}
      <form onSubmit={handleCreateTask} className="r" style={{ marginTop: 4 }}>
        <input
          className="in"
          style={{
            background: '#FFFFFF',
            borderRadius: 999,
            padding: '0 18px',
            boxShadow: '0 1px 2px rgba(0,0,0,.05)',
          }}
          placeholder="Add a new task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          disabled={connectionState === 'not_connected' || connectionState === 'token_expired'}
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim() || connectionState === 'not_connected' || connectionState === 'token_expired'}
          className="bt l"
          style={{ minHeight: 48, padding: '0 20px', flex: 'none' }}
        >
          {adding ? '…' : 'Add'}
        </button>
      </form>
    </motion.div>
  )
}
