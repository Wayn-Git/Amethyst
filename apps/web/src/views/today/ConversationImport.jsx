import { Select as HouseSelect, Input as HouseInput, Button as HouseButton } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { api } from '../../api.js'

export default function ConversationImport({ onSaved, onClose }) {
  const [source, setSource] = useState('WhatsApp')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form className="day-track-form" onSubmit={async event => {
    event.preventDefault(); setError(''); setBusy(true)
    const values = new FormData(event.currentTarget)
    const file = values.get('file')
    try {
      if (!file?.size) throw new Error('Choose a conversation export.')
      if (file.size > 2_000_000) throw new Error('Choose a text or JSON export smaller than 2 MB.')
      await api.importTodayConversation({ source, title: values.get('title'), content: await file.text(), state: values.get('state'), day_first: values.get('dateOrder') !== 'month', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      onSaved()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }}>
    <h2>Bring a conversation into Today</h2>
    <p className="day-meta">Processed by your local Amethyst server. Saves the three latest message excerpts, not the full export. Reimport with the same title to update it. This does not enable live syncing.</p>
    <label>Source<HouseSelect value={source} onChange={event => setSource(event.target.value)}><option>WhatsApp</option><option>Instagram</option></HouseSelect></label>
    <label>Conversation title<HouseInput autoFocus name="title" required maxLength={240} placeholder="Design group" /></label>
    <label>Export file<HouseInput name="file" type="file" required accept={source === 'WhatsApp' ? '.txt' : '.json'} /></label>
    <p className="day-meta">{source === 'WhatsApp' ? 'Use Export chat → Without media, then select the .txt file.' : 'Use the JSON download of your Instagram information, then select the conversation’s message_1.json.'}</p>
    {source === 'WhatsApp' && <label>Dates in this export<HouseSelect name="dateOrder"><option value="day">Day / month / year</option><option value="month">Month / day / year</option></HouseSelect></label>}
    <label>What needs to happen?<HouseSelect name="state"><option value="needs_reply">I need to reply</option><option value="waiting">Waiting for them</option><option value="backlog">Keep for later</option></HouseSelect></label>
    {error && <p role="alert" className="day-due">{error}</p>}
    <div className="day-actions"><HouseButton type="submit" className="day-primary" disabled={busy}>{busy ? 'Importing…' : 'Import conversation'}</HouseButton><HouseButton type="button" onClick={onClose}>Cancel</HouseButton></div>
  </form>
}
