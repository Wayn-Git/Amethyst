import { widgetTone } from './layout.js'
import { useState } from 'react'
import Button from '../components/ui/AppButton.jsx'
import Icon from '../components/Icon.jsx'
import Sync from './widgets/Sync.jsx'
import Quiet from './widgets/Quiet.jsx'
import Shortcuts from './widgets/Shortcuts.jsx'
import AddWidget from './AddWidget.jsx'
import Connectors from './widgets/Connectors.jsx'
import { useDashboard } from './context.js'

const SECTIONS = [['sys.connectors', 'Connections', 'link'], ['dash.sync', 'Refresh status', 'refresh'], ['dash.quiet', 'Quiet hours', 'moon'], ['dash.shortcuts', 'Keyboard shortcuts', 'keyboard'], ['dash.gallery', 'Widget gallery', 'grid']]
export default function HomeSettings({ settingsId }) {
  const { connections, manageConnections } = useDashboard()
  const [selected, setSelected] = useState(null)
  const active = selected || settingsId || 'dash.sync'
  return <div className="today-settings"><div className="today-settings-tabs" role="tablist" aria-label="Home settings">{SECTIONS.map(([id, title, icon], index) => <Button key={id} id={`settings-tab-${id}`} role="tab" aria-selected={active === id} aria-controls={`home-${id}`} tabIndex={active === id ? 0 : -1} variant="ghost" onClick={() => setSelected(id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + SECTIONS.length) % SECTIONS.length; setSelected(SECTIONS[next][0]); document.getElementById(`settings-tab-${SECTIONS[next][0]}`)?.focus() } }}><Icon name={icon} size={16} />{title}</Button>)}</div>{SECTIONS.map(([id, title]) => <section key={id} id={`home-${id}`} role="tabpanel" aria-labelledby={`settings-tab-${id}`} hidden={active !== id} tabIndex={0}><h3>{title}</h3><div className={id === 'dash.gallery' ? undefined : 'widget-home today-widgets'}><div className={id === 'dash.gallery' ? undefined : 'home-widget widget-adoption'} data-widget={id} data-tone={widgetTone(id)}>{id === 'sys.connectors' ? <Connectors data={connections.data} refresh={connections.refresh} checking={connections.busy} healthError={connections.error} manage={manageConnections} /> : id === 'dash.sync' ? <Sync /> : id === 'dash.quiet' ? <Quiet /> : id === 'dash.shortcuts' ? <Shortcuts data={{ shortcuts: [['⌘K / Ctrl+K', 'Search and capture'], ['Alt+R', 'Refresh Home'], ['Alt+E', 'Edit layout'], ['Alt+Q', 'Snooze refresh for one hour'], ['Arrow keys on move handle', 'Move widget'], ['Arrow keys on resize handle', 'Resize widget'], ['Escape', 'Close drawer or cancel drag']] }} /> : <AddWidget compact />}</div></div></section>)}</div>
}
