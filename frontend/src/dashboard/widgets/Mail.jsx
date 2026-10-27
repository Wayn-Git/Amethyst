import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'
import { Initials, Chip, Switch } from '../../components/ui/bento/index.jsx'

export default function Mail({ data, refresh, widgetId }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function model(enabled) {
    setBusy(true); setError('')
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { model_enabled: enabled }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className={widgetId === 'need.inbox' ? 'widget-mail' : undefined}><details className="mail-source-note"><summary>About this inbox</summary><p>Gmail via Composio · up to 100 messages. Only short snippets are retained.</p></details>
    {widgetId === 'need.inbox' && <><div className="mail-toolbar"><span>Rank with model</span><Switch label="Rank with model" loading={busy} on={Boolean(data?.model_enabled)} onChange={model} /></div>
    {(busy) && <StateView role="status">Generating…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    {!data?.ranked && <p className="mail-ranking-note">Unread, then recent; model ranking is off or unavailable.</p>}
    </>}
    {!(data?.items?.length) ? (
      <div className="adoption-stack" style={{ alignItems: 'center', justifyContent: 'center', padding: '16px 8px', textAlign: 'center' }}>
        <p className="adoption-label" style={{ margin: '0 0 8px' }}>No messages found</p>
        <button
          type="button"
          className="widget-button"
          onClick={() => window.dispatchEvent(new CustomEvent('amethyst:open-connectors', { detail: 'gmail' }))}
        >
          Connect Gmail
        </button>
      </div>
    ) : widgetId === 'comm.unread' ? <ul className="widget-list adoption-unread">{(data?.items || []).map(group => <WidgetRow key={group.id}><div className="adoption-person-heading"><Initials name={group.from || 'Unknown sender'} /><strong>{group.from || 'Unknown sender'}</strong><Chip>{group.items.length} unread shown</Chip></div><ul>{group.items.map(item => <WidgetRow key={item.id}><div><strong>{item.subject}</strong><p className="adoption-label">{item.date}</p><p>{item.snippet}</p></div></WidgetRow>)}</ul></WidgetRow>)}</ul> : <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id} className="mail-item-row"><Initials name={item.from || 'Unknown sender'} /><div className="mail-row-copy"><div className="mail-row-meta"><span>{item.from}</span><Chip>{item.unread ? 'Unread' : 'Mail'}</Chip><span className="mail-date">{item.date}</span></div><strong>{item.subject}</strong><div className="mail-row-context"><p className="widget-row-secondary mail-snippet">{item.snippet}</p>{item.reason && <p className="mail-reason">Why: {item.reason}</p>}</div></div></WidgetRow>)}</ul>}
  </div>
}
