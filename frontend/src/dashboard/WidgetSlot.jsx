import { memo, useState } from 'react'
import Button from '../components/ui/AppButton.jsx'
import Select from '../components/ui/NativeSelect.jsx'
import Icon from '../components/Icon.jsx'

export default memo(function WidgetSlot({ id, title, size, sizes, editing, dragging, move, resize, grip, children }) {
  const [collapsed, setCollapsed] = useState(false)
  return <section className={`home-slot${dragging ? ' is-drag-target' : ''}`} data-slot-id={id} data-size={size} data-collapsed={collapsed || undefined} aria-label={`${title} slot`}>
    <div className="home-slot-controls">
      <Button size="small" variant="ghost" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} onClick={() => setCollapsed(value => !value)}><Icon name={collapsed ? 'plus' : 'minus'} size={14} />{collapsed && title}</Button>
      {editing && <>
        <Button className="home-drag" size="small" {...grip('move', id)} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); move(id, ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) } }} aria-label={`Move ${title}`}><Icon name="grid" size={14} /></Button>
        <Button className="home-mobile-move" size="small" onClick={() => move(id, -1)} aria-label={`Move ${title} up`}>↑</Button>
        <Button className="home-mobile-move" size="small" onClick={() => move(id, 1)} aria-label={`Move ${title} down`}>↓</Button>
        <Select aria-label={`Size ${title}`} value={size} onChange={event => resize(id, { size: event.target.value })}>{sizes.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</Select>
        <Button className="home-resize" size="small" {...grip('resize', id)} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); const index = sizes.indexOf(size); resize(id, { size: sizes[Math.max(0, Math.min(sizes.length - 1, index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1)))] }) } }} aria-label={`Resize ${title}`}><Icon name="expand" size={14} /></Button>
      </>}
    </div>
    <div hidden={collapsed}>{children}</div>
  </section>
})
