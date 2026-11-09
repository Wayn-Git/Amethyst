import { TooltipProvider } from "./vendor/components/ui/tooltip"
import { Component, lazy, Suspense, useState } from 'react'
import { Button } from '../ui/bento/index.jsx'
import { useDashboard } from '../../dashboard/context.js'
import { catalog, CATEGORIES, targetsForDesign, designSize } from './designs.js'
import DesignSetup from './DesignSetup.jsx'
import './wigggle.css'

const modules = import.meta.glob('./vendor/registry/default/widgets/*/*/*.tsx')
const examples = Object.fromEntries(catalog.map(design => [design.id, lazy(modules[design.module])]))
class SampleBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { console.error('Wigggle design preview failed:', error) }
  render() { return this.state.failed ? <p role="alert">This design preview could not load.</p> : this.props.children }
}
export default function DesignCatalog() {
  const { manifests, layout, addWidget, resize } = useDashboard()
  const [category, setCategory] = useState('clock')
  const [setup, setSetup] = useState(null)
  const designs = catalog.filter(design => design.category === category)
  return <div className="wigggle-catalog">
    <div className="wigggle-catalog-heading"><h3>Wigggle UI</h3><span>92 designs · 8 categories</span><p>Design samples contain example data. Apply a design to use your existing widget’s data and controls.</p></div>
    <nav className="wigggle-categories" aria-label="Wigggle categories">{CATEGORIES.map(value => <Button key={value} variant="ghost" aria-pressed={category === value} onClick={() => setCategory(value)}>{value}<small>{catalog.filter(design => design.category === value).length}</small></Button>)}</nav>
    <div className="wigggle-design-grid">{designs.map(design => {
      const Example = examples[design.id], targets = targetsForDesign(design, manifests)
      return <section className="wigggle-design-example" data-design={design.id} data-size={design.size} key={design.id} aria-label={`${design.id} design sample`}>
        <header><strong>{design.name}</strong><span>{design.size.toUpperCase()} · Sample data</span></header>
        <div className="wigggle-sample" inert><SampleBoundary><Suspense fallback={<p role="status">Loading design…</p>}><TooltipProvider><Example /></TooltipProvider></Suspense></SampleBoundary></div>
        <div className="wigggle-apply">{targets.length ? targets.map(manifest => {
          const added = layout.widgets.some(item => item.id === manifest.id)
          return <Button key={manifest.id} size="small" onClick={() => added ? resize(manifest.id, { size: designSize(design, manifest), design: design.id }) : addWidget(manifest.id, designSize(design, manifest), design.id)}>{added ? 'Apply to' : 'Add'} {manifest.title}</Button>
        }) : <p>Live integration unavailable. Open setup to see what is missing.</p>}<Button size="small" variant="ghost" onClick={() => setSetup(design)}>Setup & status</Button></div>
      </section>
    })}</div>
    <a href="https://wigggle-ui.vercel.app/" target="_blank" rel="noreferrer">Wigggle UI · MIT license</a>
    {setup && <DesignSetup key={setup.id} design={setup} onClose={() => setSetup(null)} />}
  </div>
}
