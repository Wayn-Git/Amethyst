import { useEffect, useState } from 'react'
import { WidgetPresentation } from '../dashboard/WidgetFrame.jsx'
import { DashboardContext } from '../dashboard/context.js'
import { Button, Select } from '../components/ui/bento/index.jsx'
import { widgetTone, GLANCE_WIDGETS } from '../dashboard/layout.js'
import manifests from './widgets/manifests.json'
import { fixtures } from './widgets/fixtures.js'
import '../dashboard/home.css'
import '../dashboard/home-shell.css'
import '../dashboard/widget-patterns.css'
import '../dashboard/home-bento.css'
import './widgets/gallery.css'

const states = ['ready', 'loading', 'empty', 'error', 'stale', 'not-connected']
const groups = ['glance', 'needs-you', 'communication', 'agent', 'library', 'tasks', 'developer', 'feed', 'system', 'dashboard']
const themes = ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']
export default function Widgets() {
  const params = new URLSearchParams(location.search)
  const [group, setGroup] = useState(params.get('group') || 'glance')
  const [state, setState] = useState(params.get('state') || 'ready')
  const [theme, setTheme] = useState(params.get('theme') || 'paper')
  const [message, setMessage] = useState('Fixtures only. Actions are simulated; no accounts or saved layouts are used.')
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme === 'system' ? media.matches ? 'graphite' : 'paper' : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.dataset.themeMode = ['graphite', 'ink', 'nocturne', 'nvidia'].includes(resolved) ? 'dark' : 'light'
      document.documentElement.classList.toggle('dark', document.documentElement.dataset.themeMode === 'dark')
    }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
  const report = () => setMessage('Sample action only. Nothing was changed outside this gallery.')
  const context = { now: new Date(), manifests, layout: { widgets: manifests.slice(0, 3).map(({ id }) => ({ id })) }, records: Object.fromEntries(manifests.slice(0, 3).map(({ id }) => [id, { state: 'ready', synced_at: new Date().toISOString() }])), quiet: false, quietSettings: {}, saveQuiet: report, refreshAll: report, removeWidget: report, setEditing: report, connectSource: report, openWidget: report, openPalette: report, toggleWidget: report, addWidget: report }
  return <main className="bento-foundation widget-home widget-review">
    <header className="review-toolbar"><h1>Widget reference gallery</h1><p>Labelled sample data · development only · all manifest sizes</p>
      <div><label>Group<Select aria-label="Group" value={group} onChange={e => setGroup(e.target.value)}>{groups.map(value => <option key={value}>{value}</option>)}</Select></label>
      <label>State<Select aria-label="State" value={state} onChange={e => setState(e.target.value)}>{['all', ...states].map(value => <option key={value}>{value}</option>)}</Select></label>
      <label>Theme<Select aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value)}>{themes.map(value => <option key={value}>{value}</option>)}</Select></label><Button onClick={report}>Check sample action</Button></div><p role="status">{message}</p>
    </header>
    <DashboardContext.Provider value={context}><div className="review-grid">
      {manifests.filter(m => m.group === group).flatMap(manifest => manifest.sizes.flatMap(size => (state === 'all' ? states : [state]).map(sampleState => {
        const payload = fixtures[manifest.id]
        const emptyPayload = { ...payload, items: [], history: [], feeds: [], runs: [], shortcuts: [] }
        const data = { payload: sampleState === 'empty' ? emptyPayload : payload, state: sampleState, synced_at: new Date().toISOString(), stale: sampleState === 'stale', error: sampleState === 'error' ? 'Sample: source could not refresh.' : null }
        return <section className="review-example" data-size={size} key={`${manifest.id}-${size}-${sampleState}`} aria-label={`${manifest.id} ${size} ${sampleState}`}>
          <p className="review-caption">{manifest.id} · {size.toUpperCase()} · {sampleState} · SAMPLE</p>
          <div className="review-tile" data-tone={widgetTone(manifest.id)}><WidgetPresentation manifest={manifest} size={size} data={data} busy={false} refresh={report} tile={GLANCE_WIDGETS.includes(manifest.id)} /></div>
        </section>
      })))}
    </div></DashboardContext.Provider>
  </main>
}
