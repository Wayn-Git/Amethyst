import { useState } from 'react'
import { WidgetRow } from '../primitives.jsx'
import LocalReview from './LocalReview.jsx'

function Columns({ board, propose }) {
  const [columns, setColumns] = useState(board.columns)
  function change(index, key, value) { setColumns(columns.map((col, i) => i === index ? { ...col, [key]: value } : col)) }
  function move(index, delta) { const next = [...columns]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setColumns(next) }
  return <form onSubmit={e => { e.preventDefault(); propose('configure', { project_id: board.id, columns }) }}>
    {columns.map((col, i) => <div key={col.id}>
      <label>Column {i + 1} name<input required maxLength="100" value={col.title} onChange={e => change(i, 'title', e.target.value)} /></label>
      <label>Column {i + 1} task status<select aria-label={`Column ${i + 1} task status`} value={col.status} onChange={e => change(i, 'status', e.target.value)}><option value="todo">To do</option><option value="in_progress">Doing</option><option value="done">Done</option></select></label>
      <button type="button" disabled={i === 0} aria-label={`Move ${col.title} earlier`} onClick={() => move(i, -1)}>Earlier</button>
      <button type="button" disabled={i === columns.length - 1} aria-label={`Move ${col.title} later`} onClick={() => move(i, 1)}>Later</button>
      <button type="button" aria-label={`Remove ${col.title} column`} onClick={() => setColumns(columns.filter((_, index) => index !== i))}>Remove column</button>
    </div>)}
    <button type="button" disabled={columns.length >= 12} onClick={() => setColumns([...columns, { id: crypto.randomUUID(), title: 'New column', status: 'todo' }])}>Add column</button><button>Save columns</button>
  </form>
}

export default function Kanban({ data, widgetId, refresh }) {
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <>
    <form onSubmit={e => { e.preventDefault(); propose('project', { title: new FormData(e.currentTarget).get('title') }) }}><label>Project name<input name="title" required maxLength="500" /></label><button>Create project</button></form>
    {(data?.items || []).map(board => <section key={board.id} aria-label={`Project ${board.title}`}>
      <h3>{board.title}</h3>
      <details><summary>Edit columns</summary><Columns key={JSON.stringify(board.columns)} board={board} propose={propose} /></details>
      <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); propose('move', { project_id: board.id, id: Number(form.get('task')), column_id: form.get('column') }) }}><label>Existing task<select aria-label="Existing task" name="task" required defaultValue=""><option value="" disabled>Select task</option>{(data?.tasks || []).filter(task => task.list_id !== board.id).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label>Destination column<select aria-label="Destination column" name="column">{board.columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}</select></label><button>Add existing task</button></form>
      {board.columns.map(col => <section key={col.id} aria-label={`${board.title}: ${col.title}`}><h4>{col.title}</h4><ul>{board.cards.filter(card => card.column_id === col.id).map(card => <WidgetRow key={card.id}><strong>{card.title}</strong>{card.editable ? <label>Move {card.title}<select aria-label={`Move ${card.title}`} value={col.id} onChange={e => propose('move', { project_id: board.id, id: card.id, column_id: e.target.value })}>{board.columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label> : <p>Edit in connected source.</p>}</WidgetRow>)}</ul></section>)}
    </section>)}
  </>}</LocalReview>
}
