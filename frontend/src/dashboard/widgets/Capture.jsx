import { useEffect, useRef, useState } from 'react'
import { request } from '../api.js'

export default function Capture({ refresh }) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const input = useRef(null)
  useEffect(() => {
    function focus(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { if (!input.current) return; event.preventDefault(); event.stopImmediatePropagation(); input.current.focus() }
    }
    window.addEventListener('keydown', focus, true)
    return () => window.removeEventListener('keydown', focus, true)
  }, [])
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
  return <div>{message && <p role="status">{message}</p>}{draft ? <section aria-label="Review note"><h3>{draft.item.title}</h3><p>{draft.item.text}</p><button disabled={busy} onClick={() => submit(true)}>Approve save</button><button disabled={busy} onClick={() => submit(false)}>Reject save</button></section> : <form onSubmit={event => { event.preventDefault(); submit() }}><label>Note title<input ref={input} required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Note text<textarea required maxLength={20000} value={text} onChange={event => setText(event.target.value)} /></label><button disabled={busy}>Review note</button></form>}</div>
}
