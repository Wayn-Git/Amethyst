import { Button } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function DailyNote({ data, refresh, widgetId }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function create(approved) {
    setBusy(true); setError('')
    try {
      if (approved === undefined) setDraft(await request(`/widgets/${widgetId}/actions/create`, 'POST', { day: data.day }))
      else {
        const result = await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
        setDraft(null); if (approved && result.state !== 'applied') throw new Error('Permission denied. No changes were applied.'); await refresh()
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <><p>{data?.day}</p><p>{data?.prompt}</p>{error && <StateView role="alert">{error}</StateView>}{draft ? <section aria-label="Review daily note"><p>Create note for {draft.item.day}?</p><Button variant="primary" type="submit" disabled={busy} onClick={() => create(true)}>Approve create</Button><Button type="submit" disabled={busy} onClick={() => create(false)}>Reject create</Button></section> : data?.items?.length ? <a href={`/today?source=library&item=${data.items[0].id}`}>Open today's note</a> : <Button type="submit" disabled={busy || !data?.day} onClick={() => create()}>Review create today's note</Button>}</>
}
