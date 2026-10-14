import { useState } from 'react'
import { WidgetRow } from '../primitives.jsx'
import LocalReview from './LocalReview.jsx'

export default function Goals({ data, widgetId, refresh }) {
  const [mode, setMode] = useState('manual')
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <>
    <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); propose('add', { title: form.get('title'), target_date: form.get('date'), mode, progress: Number(form.get('progress') || 0), task_ids: form.getAll('tasks').map(Number) }) }}>
      <label>Goal title<input name="title" required maxLength="500" /></label>
      <label>Target date<input name="date" type="date" required /></label>
      <label>Progress source<select value={mode} onChange={e => setMode(e.target.value)}><option value="manual">Manual</option><option value="tasks">Linked tasks</option></select></label>
      {mode === 'manual' ? <label>Progress percent<input name="progress" type="number" min="0" max="100" defaultValue="0" required /></label> : <label>Linked tasks<select name="tasks" multiple required>{(data?.tasks || []).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>}
      <button>Create goal</button>
    </form>
    <ul>{(data?.items || []).map(row => <WidgetRow key={row.id}><strong>{row.title}</strong><p>Target: {row.target_date} · Progress: {row.progress}%{row.overdue && ' · Overdue'}</p>{row.mode === 'manual' ? <form onSubmit={e => { e.preventDefault(); propose('progress', { id: row.id, progress: Number(new FormData(e.currentTarget).get('progress')) }) }}><label>Progress for {row.title}<input name="progress" type="number" required min="0" max="100" defaultValue={row.progress} /></label><button>Update progress</button></form> : <p>Linked to {row.task_ids.length} tasks</p>}</WidgetRow>)}</ul>
  </>}</LocalReview>
}
