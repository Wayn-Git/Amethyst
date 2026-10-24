import { useDashboard } from '../context.js'
export default function Gallery() {
  const { manifests, layout, toggleWidget, editing, setEditing } = useDashboard()
  return <><p>Choose widgets. Drag their move handles to reorder, or use arrow keys.</p><div className="widget-gallery">{manifests.map(m => <label className="widget-check" key={m.id}><input type="checkbox" checked={layout.widgets.some(w => w.id === m.id)} onChange={() => toggleWidget(m.id)} />{m.title}</label>)}</div><button onClick={() => setEditing(!editing)}>{editing ? 'Finish editing' : 'Edit layout'}</button></>
}
