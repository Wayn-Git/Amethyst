import { useState } from 'react'
import { Button } from '../ui/bento/index.jsx'
import Drawer from '../../dashboard/Drawer.jsx'
import WidgetSetup from '../../dashboard/WidgetSetup.jsx'
import { useWidget } from '../../dashboard/useWidget.js'
import { useDashboard } from '../../dashboard/context.js'
import { designBlocker, targetsForDesign } from './designs.js'

function LiveSetup({ manifest }) {
  const { data, busy, refresh } = useWidget(manifest, true)
  const { openWidget } = useDashboard()
  return <WidgetSetup manifest={manifest} data={data} busy={busy} refresh={refresh} onConfigure={openWidget ? () => openWidget(manifest.id) : undefined} />
}

export default function DesignSetup({ design, onClose }) {
  const { manifests } = useDashboard()
  const targets = targetsForDesign(design, manifests)
  const [selected, setSelected] = useState(targets[0]?.id)
  const manifest = targets.find(value => value.id === selected) || targets[0]
  const blocker = designBlocker(design)
  return <Drawer title={`${design.name} · Setup & status`} description={design.id} onClose={onClose}>
    {manifest ? <>{targets.length > 1 && <div className="widget-buttons" role="group" aria-label="Live data source">{targets.map(value => <Button key={value.id} aria-pressed={manifest.id === value.id} onClick={() => setSelected(value.id)}>{value.title}</Button>)}</div>}<LiveSetup key={manifest.id} manifest={manifest} /></> : <section className="widget-setup-screen"><div className="widget-setup-status" role="status"><strong>Live integration unavailable</strong><p>{blocker?.reason || 'This installation has no enabled widget that can supply this design’s data and controls.'}</p></div><h3>What is required</h3><ul>{(blocker?.requirements || ['An enabled, working widget provider for this design. Check widget availability and the server logs.']).map(step => <li key={step}>{step}</li>)}</ul><p>This cannot be enabled by entering credentials in the current app. The required integration or controls must be implemented first. The example remains a design preview and cannot be added as live data.</p><Button onClick={onClose}>Back to designs</Button></section>}
  </Drawer>
}
