import { useState } from 'react'
import Icon from '../../Icon.jsx'
import { api } from '../../../api.js'

export default function TasksView({
  tasks = [],
  query = '',
  activeIndex = 0,
  onSelect,
  onNavigateTasks,
  onRefreshTasks,
  onToast,
}) {
  const [filterBucket, setFilterBucket] = useState('all') // 'all' | 'my_day' | 'missed' | 'important' | 'completed'
  const [busyId, setBusyId] = useState(null)

  const cleanQ = query.toLowerCase().trim()

  const filteredTasks = tasks.filter((t) => {
    // Bucket filter
    if (filterBucket === 'completed' && t.status !== 'completed') return false
    if (filterBucket !== 'completed' && t.status === 'completed') return false
    if (filterBucket === 'important' && !t.important) return false
    if (filterBucket === 'my_day' && !t.my_day) return false
    if (filterBucket === 'missed' && (!t.due_at || new Date(t.due_at) >= new Date())) return false

    // Text search
    if (cleanQ) {
      return t.title?.toLowerCase().includes(cleanQ) || t.notes?.toLowerCase().includes(cleanQ)
    }
    return true
  })

  const handleToggleDone = async (e, task) => {
    e.stopPropagation()
    setBusyId(task.id)
    try {
      const nextStatus = task.status === 'completed' ? 'todo' : 'completed'
      await api.updateTask(task.id, { status: nextStatus })
      onRefreshTasks?.()
      onToast?.(nextStatus === 'completed' ? 'Task completed' : 'Task marked to do', 'ok')
    } catch {
      onToast?.('Could not update task', 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleStar = async (e, task) => {
    e.stopPropagation()
    setBusyId(task.id)
    try {
      await api.updateTask(task.id, { important: !task.important })
      onRefreshTasks?.()
      onToast?.(task.important ? 'Removed from important' : 'Marked as important', 'ok')
    } catch {
      onToast?.('Could not update task', 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const handleRescheduleTomorrow = async (e, task) => {
    e.stopPropagation()
    setBusyId(task.id)
    try {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const due = tomorrow.toISOString().split('T')[0]
      await api.updateTask(task.id, { due_at: due })
      onRefreshTasks?.()
      onToast?.('Rescheduled to tomorrow', 'ok')
    } catch {
      onToast?.('Could not reschedule task', 'bad')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="damon-tasks-panel" role="region" aria-label="Tasks Manager">
      {/* Top Bar: Buckets + Jump to Tasks View */}
      <div className="damon-tasks-topbar">
        <div className="damon-tasks-buckets">
          {[
            { id: 'all', label: 'All Tasks' },
            { id: 'my_day', label: 'My Day' },
            { id: 'missed', label: 'Overdue' },
            { id: 'important', label: 'Important' },
            { id: 'completed', label: 'Done' },
          ].map((b) => (
            <button
              key={b.id}
              type="button"
              className={`damon-bucket-btn${filterBucket === b.id ? ' is-active' : ''}`}
              onClick={() => setFilterBucket(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="damon-nav-jump-btn"
          onClick={onNavigateTasks}
          title="Open full Tasks section"
        >
          <span>Open Tasks</span>
          <Icon name="arrow-up-right" size={13} />
        </button>
      </div>

      {/* Quick Add Task from Query */}
      {query.trim() && (
        <div
          className="damon-quick-create-task"
          onClick={async () => {
            try {
              await api.createTask({ title: query.trim() })
              onRefreshTasks?.()
              onToast?.(`Created task “${query.trim()}”`, 'ok')
            } catch {
              onToast?.('Could not create task', 'bad')
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="damon-qc-icon">
            <Icon name="plus" size={14} />
          </div>
          <div className="damon-qc-content">
            <span className="damon-qc-title">Create new task: <strong>“{query.trim()}”</strong></span>
            <span className="damon-qc-hint">Press Enter or click to create</span>
          </div>
          <kbd className="kbd">↵ Create</kbd>
        </div>
      )}

      {/* Task List */}
      <div className="damon-tasks-list" role="listbox">
        {filteredTasks.length === 0 ? (
          <div className="damon-empty-state">
            <Icon name="check" size={24} />
            <p>No tasks matching this filter.</p>
            {query.trim() && (
              <span className="damon-empty-hint">
                Click “Create new task” above to add it.
              </span>
            )}
          </div>
        ) : (
          filteredTasks.map((t, i) => {
            const isSelected = i === activeIndex
            const isDone = t.status === 'completed'
            const isOverdue = t.due_at && new Date(t.due_at) < new Date() && !isDone
            const isBusy = busyId === t.id

            return (
              <div
                key={t.id}
                role="option"
                aria-selected={isSelected}
                data-active={isSelected}
                className={`damon-task-item${isSelected ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
                onClick={() => onSelect(t)}
              >
                {/* Complete checkbox */}
                <button
                  type="button"
                  className={`damon-task-check${isDone ? ' is-checked' : ''}`}
                  onClick={(e) => handleToggleDone(e, t)}
                  disabled={isBusy}
                  title={isDone ? 'Mark as to do' : 'Mark completed'}
                >
                  <Icon name={isDone ? 'check' : 'check'} size={12} />
                </button>

                {/* Task Details */}
                <div className="damon-task-details">
                  <span className="damon-task-title">{t.title}</span>
                  <div className="damon-task-tags">
                    {t.due_at && (
                      <span className={`damon-task-pill${isOverdue ? ' is-overdue' : ''}`}>
                        {isOverdue ? (
                          <>
                            <Icon name="alert" size={10} style={{ marginRight: 4 }} />
                            Overdue
                          </>
                        ) : `Due ${t.due_at}`}
                      </span>
                    )}
                    {t.my_day && <span className="damon-task-pill is-myday">My Day</span>}
                    {t.notes && <span className="damon-task-note-snippet">{t.notes}</span>}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="damon-task-actions">
                  {isOverdue && (
                    <button
                      type="button"
                      className="damon-action-btn"
                      onClick={(e) => handleRescheduleTomorrow(e, t)}
                      title="Reschedule to tomorrow"
                      disabled={isBusy}
                    >
                      <Icon name="clock" size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`damon-action-btn${t.important ? ' is-starred' : ''}`}
                    onClick={(e) => handleToggleStar(e, t)}
                    title={t.important ? 'Remove star' : 'Mark important'}
                    disabled={isBusy}
                  >
                    <Icon name="star" size={12} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
