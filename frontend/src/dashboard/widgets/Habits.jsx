import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/task.habits/template.txt?raw'
import design from '../../../../widgets/task.habits/design.json'
import LocalReview from './LocalReview.jsx'
import { Input } from '../../components/ui/input.tsx'
import Button from '../../components/ui/AppButton.jsx'
import { Select } from '../../components/ui/bento/index.jsx'
import { bestStreak } from './habitStreaks.js'
import './task-generated.css'

const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export default function Habits({ data, refresh, widgetId, size = 'm' }) {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => observer.disconnect()
  }, [])
  const value = useMemo(() => {
    const now = new Date(`${data?.today || dateKey(new Date())}T12:00:00`)
    const today = dateKey(now)
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now)
      date.setDate(now.getDate() - 6 + index)
      return { index, short: date.toLocaleDateString([], { weekday: 'short' }).slice(0, 2), label: date.toLocaleDateString([], { weekday: 'long' }), date: dateKey(date) }
    })
    const habits = (data?.items || []).map((row, index) => {
      const historyDays = new Set(row.history_days || [])
      const week = days.map(day => historyDays.has(day.date) ? 1 : 0)
      const done = historyDays.has(today)
      const current = Number(row.streak) || 0
      return {
        id: String(row.id), index, title: row.title, shortName: row.title,
        period: row.period, done, current, currentLabel: `${current}${row.period === 'weekly' ? 'w' : 'd'}`,
        streakBefore: row.streak - Number(done), bestBefore: bestStreak([...historyDays], row.period, row.target), completed: week.reduce((sum, mark) => sum + mark, 0), week,
      }
    })
    const leader = [...habits].sort((a, b) => b.current - a.current)[0] || null
    return {
      ...design, appearance: theme, sizeChoice: size === 'l' ? 'large' : 'medium', days, habits, leader, completeSurface: 'var(--w-surface-secondary)',
      periods: [{ id: 'daily', label: 'Daily', icon: 'sun' }, { id: 'weekly', label: 'Weekly', icon: 'calendar' }],
      labels: {
        ...design.labels, sampleDate: '', weekPeriod: 'Last 7 days',
        historyScope: 'Marks show saved check-ins; blank days are not marked as missed.', localNote: '',
      },
    }
  }, [data, size, theme])
  if (!data || data.state === 'loading') return <div className="task-generated-content">Loading habits…</div>
  if (data.state === 'error' || data.error) return <div className="task-generated-content" role="alert">{data.error || 'Habits could not be loaded.'}</div>
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <div className="task-generated-content">
    <details className="task-widget-compose"><summary>Add habit</summary><form onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      propose('add', { title: form.get('title'), period: form.get('period'), target: Number(form.get('target')) })
    }}><label>Habit title<Input name="title" required maxLength={500} /></label><label>Period<Select name="period" defaultValue="daily"><option value="daily">Daily</option><option value="weekly">Weekly</option></Select></label><label>Target per period<Input name="target" type="number" min={1} max={100} defaultValue={1} required /></label><Button type="submit">Review habit</Button></form></details>
    {!value.habits.length ? <p>No habits saved yet. Add one to start a check-in streak.</p> : <WidgetRenderer template={template} data={value} theme={theme} onAction={action => {
    if (action?.type !== 'task.habits.checkin') return
    const habit = data?.items?.find(row => String(row.id) === String(action.payload?.id))
    if (habit && !habit.history_days?.includes(data.today)) propose('checkin', { id: Number(habit.id) })
    }} />}
  </div>}</LocalReview>
}
