import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Highlights({ data, refresh, widgetId }) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(approved) {
    setBusy(true); setError('')
    try {
      if (approved === undefined) setDraft(await request(`/widgets/${widgetId}/actions/add`, 'POST', { title, text, source_id: Number(source) }))
      else {
        const result = await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
        setDraft(null)
        if (result.state === 'applied') { setTitle(''); setText(''); await refresh() }
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <>{error && <StateView role="alert">{error}</StateView>}{draft ? <section aria-label="Review highlight"><h3>{draft.item.title}</h3><blockquote>{draft.item.text}</blockquote><p>Source article {draft.item.source_id}</p><button disabled={busy} onClick={() => save(true)}>Approve save</button><button disabled={busy} onClick={() => save(false)}>Reject save</button></section> : <form onSubmit={event => { event.preventDefault(); save() }}><label>Highlight title<input required maxLength={400} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Highlight text<textarea required maxLength={20000} value={text} onChange={e => setText(e.target.value)} /></label><label>Source article<select aria-label="Source article" required value={source} onChange={e => setSource(e.target.value)}><option value="">Choose an article</option>{(data?.articles || []).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button disabled={busy}>Review highlight</button></form>}<ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><a href={`/today?source=library&item=${item.id}`}>{item.title}</a><blockquote>{item.text}</blockquote><a href={`/today?source=library&item=${item.source_id}`}>{item.source_title}</a></WidgetRow>)}</ul></>
}
