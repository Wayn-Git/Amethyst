import { Button, Input, Select, Ring } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { WidgetRow } from '../primitives.jsx'
import LocalReview from './LocalReview.jsx'

export default function Goals({ data, widgetId, refresh }) {
  const [mode, setMode] = useState('manual')
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <>
    <details className="widget-form-disclosure" open={!data?.items?.length}><summary>New goal</summary><form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); propose('add', { title: form.get('title'), target_date: form.get('date'), mode, progress: Number(form.get('progress') || 0), task_ids: form.getAll('tasks').map(Number) }) }}>
      <label>Goal title<Input name="title" required maxLength="500" /></label>
      <label>Target date<Input name="date" type="date" required /></label>
      <label>Progress source<Select value={mode} onChange={e => setMode(e.target.value)}><option value="manual">Manual</option><option value="tasks">Linked tasks</option></Select></label>
      {mode === 'manual' ? <label>Progress percent<Input name="progress" type="number" min="0" max="100" defaultValue="0" required /></label> : <label>Linked tasks<Select name="tasks" multiple required>{(data?.tasks || []).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</Select></label>}
      <Button type="submit">Create goal</Button>
    </form></details>
    <ul>{(data?.items || []).map(row => <WidgetRow key={row.id}><strong>{row.title}</strong><div className="widget-metric"><Ring value={row.progress} label={`${row.title} progress percent`} /></div><p>Target: {row.target_date} · Progress: {row.progress}%{row.overdue && ' · Overdue'}</p>{row.mode === 'manual' ? <form onSubmit={e => { e.preventDefault(); propose('progress', { id: row.id, progress: Number(new FormData(e.currentTarget).get('progress')) }) }}><label>Progress for {row.title}<Input name="progress" type="number" required min="0" max="100" defaultValue={row.progress} /></label><Button type="submit">Update progress</Button></form> : <p>Linked to {row.task_ids.length} tasks</p>}</WidgetRow>)}</ul>
  </>}</LocalReview>
}
