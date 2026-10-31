import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/task.kanban/template.txt?raw'
import design from '../../../../widgets/task.kanban/design.json'
import LocalReview from './LocalReview.jsx'
import './task-generated.css'
import { Input } from '../../components/ui/input.tsx'
import Button from '../../components/ui/AppButton.jsx'

export default function Kanban({ data, size = 'm', full = false, refresh, widgetId }) {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => observer.disconnect()
  }, [])
  const value = useMemo(() => {
    const projects = (data?.items || []).map(board => {
      const stages = board.columns.map((column, index) => ({
        id: column.id, label: column.title, short: column.title,
        icon: column.status === 'done' ? 'check' : 'empty-circle',
        color: column.status === 'done' ? 'success' : 'secondary',
        next: board.columns[index + 1]?.id || column.id,
        actionLabel: index === board.columns.length - 1 ? 'No next stage' : `Move to ${board.columns[index + 1].title}`,
      }))
      return {
        id: String(board.id), name: board.title,
        tasks: board.cards.map((card, index) => ({
          id: String(card.id), title: card.title, stage: card.column_id,
          initialStage: card.column_id, owner: 'Not available', due: 'Not available',
          priority: 'Not available', rank: index, tone: 'secondary', editable: Boolean(card.editable),
        })),
        stages,
      }
    })
    const selected = projects[0]
    return {
      ...design, darkMode: theme === 'dark',
      sizeChoice: full || size === 'l' ? 'large' : size === 's' ? 'small' : 'medium',
      projectChoice: selected?.id || '', moves: 0,
      projects, stages: selected?.stages || [],
      ui: { ...design.ui, subtitle: '', snapshot: '', localNote: '', projectLabel: 'Project', allDoneNote: 'All tasks in this project are complete.', nextMove: 'Next task', progressEyebrow: 'Project progress' },
      sizeOptions: design.sizeOptions || [],
    }
  }, [data, size, full, theme])
  if (!data || data.state === 'loading') return <div className="task-generated-content">Loading projects…</div>
  if (data.state === 'error' || data.error) return <div className="task-generated-content" role="alert">{data.error || 'Projects could not be loaded.'}</div>
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <div className="task-generated-content">
    <details className="task-widget-compose"><summary>New project</summary><form onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      propose('project', { title: form.get('title') })
    }}><label>Project name<Input name="title" required maxLength={500} /></label><Button type="submit">Review project</Button></form></details>
    {!value.projects.length ? <p>No local projects yet. Create one to organise tasks.</p> : <>
    <WidgetRenderer template={template} data={value} theme={theme} onAction={action => {
    if (action?.type !== 'task.kanban.move') return
    const { project_id, id, column_id } = action.payload || {}
    const card = data?.items?.find(board => String(board.id) === String(project_id))?.cards?.find(item => String(item.id) === String(id))
    if (card?.editable && column_id) propose('move', { project_id: Number(project_id), id: Number(id), column_id })
    }} />
    {(data.items || []).map(board => <details key={`columns-${board.id}`} className="task-widget-settings"><summary>Configure {board.title}</summary><form onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const columns = board.columns.map(column => ({ ...column, title: form.get(`column-${column.id}`) }))
      propose('configure', { project_id: Number(board.id), columns })
    }}>{board.columns.map(column => <label key={column.id}>{column.status.replace('_', ' ')}<Input name={`column-${column.id}`} defaultValue={column.title} required maxLength={100} /></label>)}<Button type="submit">Review columns</Button></form></details>)}
    </>}
  </div>}</LocalReview>
}
