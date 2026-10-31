import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { Input } from '../../components/ui/input.tsx'
import Button from '../../components/ui/AppButton.jsx'
import LocalReview from './LocalReview.jsx'
import template from '../../../../widgets/task.goals/template.txt?raw'
import design from '../../../../widgets/task.goals/design.json'
import './task-generated.css'

const dateLabel = value => {
  if (!value) return 'Not available'
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function progressArc(value) {
  const ratio = Math.max(0, Math.min(100, value)) / 100
  const angle = -Math.PI / 2 + ratio * Math.PI * 2
  const x = 50 + 42 * Math.cos(angle)
  const y = 50 + 42 * Math.sin(angle)
  return `M50 8 A42 42 0 ${ratio > .5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`
}

export default function Goals({ data, size = 'm', widgetId = 'task.goals', refresh }) {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => observer.disconnect()
  }, [])
  const value = useMemo(() => {
    const goals = (data?.items || []).map((row, index) => ({
      id: String(row.id), title: row.title, category: 'Goals', index,
      done: Number(row.progress) || 0, total: 100, metric: '% complete',
      target: dateLabel(row.target_date), next: 'Not available',
      nextIso: row.target_date || '', nextDate: dateLabel(row.target_date),
      nextDay: row.target_date?.slice(-2) || 'Not available',
      nextMonth: row.target_date ? new Date(`${row.target_date}T12:00:00`).toLocaleDateString([], { month: 'short' }) : 'Not available',
      recent: 'Not available', arc: progressArc(Number(row.progress) || 0),
      mode: row.mode, overdue: Boolean(row.overdue),
    }))
    return {
      ...design, previewSize: size === 'l' ? 'large' : 'medium',
      layout: size === 'l' ? 'grouped' : 'minimal', darkMode: theme === 'dark',
      colors: { light: { accent: 'var(--w-accent)', track: 'var(--w-border)' }, dark: { accent: 'var(--w-accent)', track: 'var(--w-border)' } },
      goals, categories: [{ id: 'goals', label: 'Goals', icon: 'target' }],
      labels: { ...design.labels, collectionNote: '', sampleNote: '', focusNote: '' },
    }
  }, [data, size, theme])
  if (!data || data.state === 'loading') return <div className="task-generated-content">Loading goals…</div>
  if (data.state === 'error' || data.error) return <div className="task-generated-content" role="alert">{data.error || 'Goals could not be loaded.'}</div>
  if (!value.goals.length) return <div className="task-generated-content">No goals saved yet. Add a goal to start tracking progress.<GoalActions widgetId="task.goals" refresh={refresh} /></div>
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <div className="task-generated-content">
    <details className="task-widget-compose"><summary>Add goal</summary><form onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      propose('add', { title: form.get('title'), target_date: form.get('target_date'), mode: 'manual', progress: 0, task_ids: [] })
    }}><label>Goal title<Input name="title" required maxLength={500} /></label><label>Target date<Input name="target_date" type="date" required /></label><Button type="submit">Review goal</Button></form></details>
    <WidgetRenderer template={template} data={value} theme={theme} />
    {value.goals.map(goal => goal.mode === 'manual' && <details key={goal.id} className="task-widget-settings"><summary>Update {goal.title}</summary><form onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      propose('progress', { id: Number(goal.id), progress: Number(form.get('progress')) })
    }}><label>Progress percent<Input name="progress" type="number" min={0} max={100} defaultValue={goal.done} required /></label><Button type="submit">Review progress</Button></form></details>)}
  </div>}</LocalReview>
}

function GoalActions({ widgetId, refresh }) {
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <details className="task-widget-compose"><summary>Add goal</summary><form onSubmit={event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    propose('add', { title: form.get('title'), target_date: form.get('target_date'), mode: 'manual', progress: 0, task_ids: [] })
  }}><label>Goal title<Input name="title" required maxLength={500} /></label><label>Target date<Input name="target_date" type="date" required /></label><Button type="submit">Review goal</Button></form></details>}</LocalReview>
}
