import { Button, Input, Textarea } from '../../components/ui/bento/index.jsx'
import { StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'

export default function Capture({ refresh }) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(approved) {
    setBusy(true); setMessage('')
    try {
      if (approved === undefined) setDraft(await request('/widgets/lib.capture/actions/add', 'POST', { title, text }))
      else {
        const result = await request(`/widgets/lib.capture/drafts/${draft.draft_id}`, 'POST', { approved })
        setDraft(null)
        if (result.state === 'applied') { setTitle(''); setText(''); setMessage('Note saved to vault.'); refresh(); window.dispatchEvent(new Event('dashboard-items-changed')) }
        else setMessage('Note was not saved.')
      }
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <div>{message && <StateView role="status">{message}</StateView>}{draft ? <section aria-label="Review note"><h3>{draft.item.title}</h3><p>{draft.item.text}</p><Button variant="primary" type="submit" disabled={busy} onClick={() => submit(true)}>Approve save</Button><Button type="submit" disabled={busy} onClick={() => submit(false)}>Reject save</Button></section> : <form onSubmit={event => { event.preventDefault(); submit() }}><label>Note title<Input required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Note text<Textarea required maxLength={20000} value={text} onChange={event => setText(event.target.value)} /></label><Button type="submit" disabled={busy}>Review note</Button></form>}</div>
}
