import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import TodayContributionGraph from './TodayContributionGraph.jsx'
import TaskDetailPopup from './TaskDetailPopup.jsx'
import { api } from '../../api.js'

/**
 * Task Card:
 * - Displays tasks added by the user
 * - Visual progress fill (% completion) on each task
 * - Interactive popup on click with % completion slider/steppers
 * - Hits 100% -> automatically marked done & removed from card
 * - Small GitHub-contribution-style graph rendered in accent color
 * - Button to add a new task directly from the card
 * - Fixed permanent size, scrolls internally
 * - Empty state: "No tasks yet."
 */
export default function TodayTasksCard({
  tasks = [],
  completedTasks = [],
  onTasksChange,
  toast,
}) {
  const [selectedTask, setSelectedTask] = useState(null)
  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [addingBusy, setAddingBusy] = useState(false)

  // Local storage cache for task progress values (0-100%)
  const [progressMap, setProgressMap] = useState(() => {
    try {
      const saved = localStorage.getItem('amethyst_task_progress')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  const saveProgress = useCallback((taskId, pct) => {
    setProgressMap((prev) => {
      const next = { ...prev, [taskId]: pct }
      try {
        localStorage.setItem('amethyst_task_progress', JSON.stringify(next))
      } catch {
        /* storage write failure ignored */
      }
      return next
    })
  }, [])

  // Open tasks (status not 'done' or 'cancelled')
  const openTasks = useMemo(() => {
    return tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  }, [tasks])

  const handleUpdateProgress = useCallback(
    (taskId, pct) => {
      saveProgress(taskId, pct)
    },
    [saveProgress],
  )

  const handleComplete = useCallback(
    async (taskId) => {
      try {
        saveProgress(taskId, 100)
        await api.updateTask(taskId, { status: 'done' })
        setSelectedTask(null)
        toast?.('Task completed and removed from card', 'ok')
        onTasksChange?.()
      } catch (err) {
        toast?.(err.message, 'bad')
      }
    },
    [onTasksChange, saveProgress, toast],
  )

  const handleQuickAdd = async (e) => {
    e?.preventDefault()
    const trimmed = newTitle.trim()
    if (!trimmed || addingBusy) return
    setAddingBusy(true)
    try {
      await api.createTask({ title: trimmed })
      setNewTitle('')
      setIsAdding(false)
      toast?.('Task created', 'ok')
      onTasksChange?.()
    } catch (err) {
      toast?.(err.message, 'bad')
    } finally {
      setAddingBusy(false)
    }
  }

  return (
    <section className="today-card">
      {/* Header */}
      <div className="today-card-head">
        <div className="today-card-title-group">
          <div className="today-card-icon-pill">
            <Icon name="check" size={16} />
          </div>
          <h3 className="today-card-title">Tasks</h3>
          <span className="today-card-badge">{openTasks.length} open</span>
        </div>

        <div className="today-card-actions">
          <button
            type="button"
            className="btn btn--small btn--primary"
            style={{ borderRadius: 9999, padding: '4px 12px', fontSize: 12 }}
            onClick={() => setIsAdding((v) => !v)}
          >
            <Icon name="plus" size={13} /> Add task
          </button>
        </div>
      </div>

      {/* GitHub-style Contribution Graph */}
      <TodayContributionGraph completedTasks={completedTasks} />

      {/* Quick Add Bar */}
      <AnimatePresence>
        {isAdding && (
          <motion.form
            onSubmit={handleQuickAdd}
            className="today-task-add-bar"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 10 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          >
            <input
              type="text"
              className="today-task-add-input"
              placeholder="What needs to be done? Press Enter to save"
              value={newTitle}
              autoFocus
              disabled={addingBusy}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn--small btn--primary"
              disabled={!newTitle.trim() || addingBusy}
              style={{ padding: '2px 8px', fontSize: 11, borderRadius: 6 }}
            >
              {addingBusy ? '…' : 'Add'}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Internal Scrollable Task List */}
      <div className="today-card-scroll">
        {openTasks.length === 0 ? (
          <div className="today-card-empty">
            <div className="today-empty-icon-wrap">
              <Icon name="check" size={24} />
            </div>
            <div className="today-empty-title">No tasks yet.</div>
            <div className="today-empty-desc">
              Your to-do items will appear here. Tap below to create your first task.
            </div>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => setIsAdding(true)}
            >
              <Icon name="plus" size={14} /> Add task
            </button>
          </div>
        ) : (
          <div className="today-task-list">
            {openTasks.map((task) => {
              const progress = progressMap[task.id] ?? (task.status === 'in_progress' ? 50 : 0)

              return (
                <div
                  key={task.id}
                  className="today-task-row"
                  onClick={() => setSelectedTask(task)}
                >
                  {/* Left Circle Indicator */}
                  <div
                    className="today-task-check-circle"
                    title="Click to view & complete"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleComplete(task.id)
                    }}
                  >
                    <Icon name="check" size={14} />
                  </div>

                  {/* Task Info & Progress */}
                  <div className="today-task-info">
                    <div className="today-task-title-row">
                      <span className="today-task-title">{task.title}</span>
                      <span className="today-task-pct">{progress}%</span>
                    </div>

                    {/* Visual Fill / Progress Indicator */}
                    <div className="today-task-bar-track">
                      <div
                        className="today-task-bar-fill"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Interactive Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          initialProgress={
            progressMap[selectedTask.id] ??
            (selectedTask.status === 'in_progress' ? 50 : 0)
          }
          onClose={() => setSelectedTask(null)}
          onUpdateProgress={handleUpdateProgress}
          onComplete={handleComplete}
        />
      )}
    </section>
  )
}
