import { StateView } from '../primitives.jsx'
import { useState } from 'react'
import { useDashboard } from '../context.js'
export default function Quiet() {
  const { quiet, quietSettings, saveQuiet } = useDashboard()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(value) { setBusy(true); setError(''); try { await saveQuiet(value) } catch (err) { setError(err.message) } finally { setBusy(false) } }
  return <><StateView role="status">{quiet ? 'Quiet now. Automatic widget refresh paused.' : 'Automatic refresh allowed.'}</StateView><p>Applies to Home refresh only. System notifications and agent jobs are unchanged.</p><form key={JSON.stringify(quietSettings)} onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); save({ ...quietSettings, enabled: form.get('enabled') === 'on', start: form.get('start'), end: form.get('end'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }}><label className="widget-check"><input name="enabled" type="checkbox" defaultChecked={quietSettings.enabled} />Enable quiet hours</label><div className="quiet-times"><label>From<input required type="time" name="start" defaultValue={quietSettings.start || '22:00'} /></label><label>Until<input required type="time" name="end" defaultValue={quietSettings.end || '07:00'} /></label></div><button disabled={busy}>Save quiet hours</button></form><div className="widget-buttons"><button disabled={busy} onClick={() => save({ ...quietSettings, snoozed_until: new Date(Date.now() + 3600000).toISOString() })}>Snooze 1 hour</button><button disabled={busy} onClick={() => save({ ...quietSettings, enabled: false, snoozed_until: null })}>Resume refresh</button></div>{error && <StateView role="alert">{error}</StateView>}</>
}
