import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function MobileTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(new Date().getDate())
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

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

  // Toggle task completed state optimistically
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
      await api.createTask({
        title: newTitle.trim(),
        status: 'todo',
        context: 'Mobile',
      })
      setNewTitle('')
      await loadTasks()
    } catch (err) {
      console.error('[MobileTasks] Create failed:', err.message)
    } finally {
      setAdding(false)
    }
  }

  // Calculate current week days
  const now = new Date()
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' })
  const dayOfWeek = now.getDay()
  const diffToMonday = (dayOfWeek + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - diffToMonday)

  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return {
      name: d.toLocaleDateString('default', { weekday: 'short' }),
      date: d.getDate(),
      isToday: d.getDate() === now.getDate() && d.getMonth() === now.getMonth(),
    }
  })

  // Completed metrics from real tasks
  const completedList = tasks.filter((t) => t.status === 'completed' || t.completed)
  const remainingCount = tasks.length - completedList.length
  const totalCount = tasks.length
  const progressPercent = totalCount > 0 ? Math.round((completedList.length / totalCount) * 100) : 0

  return (
    <motion.div
      className="m-body"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="m-r m-sp">
        <div>
          <div className="m-gl">{monthName}</div>
          <h1 className="m-h">Tasks</h1>
        </div>
        <button
          type="button"
          className="m-ib"
          aria-label="Refresh tasks"
          onClick={() => {
            setLoading(true)
            loadTasks()
          }}
        >
          <Icon name="arrow-clockwise" size={20} />
        </button>
      </div>

      {/* Week Day Strip */}
      <div className="m-r m-sp">
        {weekDays.map((d) => {
          const isSelected = selectedDay === d.date
          return (
            <div
              key={d.date}
              className="m-col"
              style={{
                alignItems: 'center',
                gap: 4,
                padding: '8px 6px',
                borderRadius: 16,
                minWidth: 44,
                background: isSelected ? '#F9F8F6' : 'transparent',
                boxShadow: isSelected ? '0 2px 8px rgba(30,25,20,0.08)' : 'none',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedDay(d.date)}
            >
              <span className="m-m">{d.name}</span>
              <span style={{ fontWeight: isSelected ? 600 : 400 }}>{d.date}</span>
            </div>
          )
        })}
      </div>

      {/* Progress Summary Card */}
      <div className="m-blk m-r m-sp" style={{ padding: '16px 18px', borderRadius: 24 }}>
        <div>
          <div className="m-st">{remainingCount} left today</div>
          <div className="m-m">
            {completedList.length} of {totalCount} done
          </div>
        </div>
        <div style={{ width: 120 }}>
          <div className="m-pb">
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                background: '#D6F23E',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* Today Section Header */}
      <div className="m-r m-sp">
        <span className="m-st">Today</span>
        <span className="m-m">{tasks.length} total</span>
      </div>

      {/* Tasks List Card */}
      <div className="m-c" style={{ padding: '4px 16px' }}>
        {tasks.map((task, idx) => {
          const isDone = task.status === 'completed' || task.completed
          return (
            <div key={task.id || idx}>
              <div
                className="m-r"
                style={{ padding: '14px 0', cursor: 'pointer' }}
                onClick={() => toggleTask(task)}
              >
                {/* Checkbox */}
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isDone ? '#111113' : 'transparent',
                    color: '#D6F23E',
                    border: isDone ? 'none' : '1.6px solid #9A958E',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isDone && <Icon name="check" size={14} />}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      textDecoration: isDone ? 'line-through' : 'none',
                      color: isDone ? '#6E6A64' : '#141414',
                      transition: 'color 0.15s',
                    }}
                  >
                    {task.title}
                  </div>
                  <div className="m-m">
                    {task.context ||
                      task.list_name ||
                      (task.due ? `Due ${task.due}` : 'Task')}
                  </div>
                </div>
              </div>
              {idx < tasks.length - 1 && <div className="m-hr" />}
            </div>
          )
        })}

        {!tasks.length && !loading && (
          <div style={{ textAlign: 'center', padding: '32px 16px' }} className="m-col">
            <Icon
              name="check-circle"
              size={32}
              style={{ color: '#9A958E', margin: '0 auto 8px' }}
            />
            <div style={{ fontWeight: 600 }}>No tasks for today</div>
            <div className="m-m" style={{ marginTop: 4 }}>
              Add a new task below to get started.
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: '#6E6A64' }}>
            Loading tasks…
          </div>
        )}
      </div>

      {/* Quick Add Inline Form */}
      <form onSubmit={handleCreateTask} className="m-r" style={{ marginTop: 4 }}>
        <input
          className="m-in"
          style={{
            background: '#F6F4F1',
            borderRadius: 999,
            padding: '0 18px',
            boxShadow: '0 1px 2px rgba(30,25,20,0.05)',
          }}
          placeholder="Add a new task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className="m-bt l"
          style={{ minHeight: 48, padding: '0 20px', flex: 'none' }}
        >
          {adding ? '…' : 'Add'}
        </button>
      </form>
    </motion.div>
  )
}
