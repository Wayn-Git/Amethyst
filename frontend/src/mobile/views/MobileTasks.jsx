import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'

export default function MobileTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  // Compute current week dates
  const now = new Date()
  const currentDayOfWeek = now.getDay() // 0 = Sun, 1 = Mon ...
  // Calculate Monday of this week
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
    try {
      const res = await api.tasks()
      if (res?.tasks) {
        setTasks(res.tasks)
      }
    } catch (err) {
      console.warn('[MobileTasks] Load failed:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const toggleTask = async (task) => {
    const isCompleted = task.status === 'completed' || task.completed
    const nextStatus = isCompleted ? 'todo' : 'completed'

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: nextStatus, completed: !isCompleted } : t
      )
    )

    try {
      await api.updateTask(task.id, {
        status: nextStatus,
        completed: !isCompleted,
      })
    } catch (err) {
      console.error('[MobileTasks] Update failed:', err.message)
      loadTasks()
    }
  }

  const handleCreateTask = async (e) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setAdding(true)
    try {
      const created = await api.createTask({
        title: newTitle.trim(),
        status: 'todo',
        context: 'Mobile',
      })
      if (created) {
        setTasks((prev) => [...prev, created])
      } else {
        loadTasks()
      }
      setNewTitle('')
    } catch (err) {
      console.error('[MobileTasks] Create failed:', err.message)
    } finally {
      setAdding(false)
    }
  }

  const completedCount = tasks.filter((t) => t.status === 'completed' || t.completed).length
  const totalCount = tasks.length
  const leftCount = Math.max(0, totalCount - completedCount)
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 60

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
        <span className="ch">
          <span className="d" />
          To Do synced
        </span>
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

      {/* Black Status Banner Card */}
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

      {/* Section Subheader */}
      <div className="r sp">
        <span className="st">Today</span>
        <span className="m">Sorted by time</span>
      </div>

      {/* Task List in Card */}
      <div className="c" style={{ padding: '4px 16px' }}>
        {tasks.map((task, idx) => {
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
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                    {task.context || task.list_name || 'Study'}
                    {task.due ? `, ${task.due}` : ''}
                  </div>
                </div>
              </div>
              {idx < tasks.length - 1 && <div className="hr" />}
            </div>
          )
        })}

        {!tasks.length && !loading && (
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

        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: '#6E6E73' }}>
            Loading tasks…
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
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className="bt l"
          style={{ minHeight: 48, padding: '0 20px', flex: 'none' }}
        >
          {adding ? '…' : 'Add'}
        </button>
      </form>
    </motion.div>
  )
}
