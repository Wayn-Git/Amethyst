import { useEffect, useState } from 'react'
import { ArrowUpRight, Settings } from 'lucide-react'
import * as UI from '../components/ui/bento'
import './ui.css'
const themes = ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']
export default function UIShowcase() {
  const [theme, setTheme] = useState('paper'), [checked, setChecked] = useState(false), [segment, setSegment] = useState('day'), [notice, setNotice] = useState('Example toast')
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'graphite' : 'paper') : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.dataset.themeMode = ['graphite','ink','nocturne','nvidia'].includes(resolved) ? 'dark' : 'light'
    }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
  return <main className="ui-showcase bento-foundation"><header><p>AMETHYST / FOUNDATION</p><h1>Shape, space, signal.</h1><p>Design samples only. Every number below is a labelled fixture, never live widget data.</p><UI.Select aria-label="Theme" value={theme} onChange={event => setTheme(event.target.value)}>{themes.map(name => <option key={name}>{name}</option>)}</UI.Select></header>
    <UI.BentoGrid>
      <UI.Tile size="s"><UI.TileHeader title="Stat · sample"/><UI.Stat value={24} label="Example count"/></UI.Tile>
      <UI.Tile size="s" tone="dark"><UI.TileHeader title="Ring · sample"/><UI.Ring value={72} label="Example percent"/></UI.Tile>
      <UI.Tile size="wide" tone="accent"><UI.TileHeader title="Segments · sample"><UI.IconBadge><ArrowUpRight/></UI.IconBadge></UI.TileHeader><UI.SegmentedBar value={60} label="Example completion"/></UI.Tile>
      <UI.Tile size="m" tone="dark"><UI.TileHeader title="Sparkline · sample"><UI.Chip>Sample</UI.Chip></UI.TileHeader><UI.Stat value={18} label="Example total"/><UI.Sparkline values={[4, 8, 6, 12, 10, 18]} label="Example sequence"/></UI.Tile>
      <UI.Tile size="tall" tone="accent"><UI.TileHeader title="Gauge · sample"/><UI.Gauge value={42} label="Example gauge"/><UI.Row trailing={<UI.Initials name="Sample Person"/>}>Initials</UI.Row><UI.Chip>Stale</UI.Chip></UI.Tile>
      <UI.Tile size="l"><UI.TileHeader title="States"/><UI.Skeleton/><UI.EmptyState message="No items yet." action={<UI.Button onClick={() => setNotice('Example action')}>Add item</UI.Button>}/><UI.ErrorState message="Example failure" onRetry={() => setNotice('Example retry')}/><UI.Toast action={<UI.Button onClick={() => setNotice('Example undone')}>Undo</UI.Button>}>{notice}</UI.Toast></UI.Tile>
      <UI.SplitTile size="wide"><UI.Stat value={12} label="First sample"/><UI.Stat value={8} label="Second sample"/></UI.SplitTile>
      <UI.ConnectTile size="s" source="example source" onConnect={() => setNotice('Example connect')}/>
    </UI.BentoGrid>
    <h2>Tones and sizes</h2><UI.BentoGrid>{['light','dark','accent'].flatMap(tone => ['s','m','l','wide','tall'].map(size => <UI.Tile key={tone + size} tone={tone} size={size}><UI.TileHeader title={`${tone} / ${size}`}/><UI.Stat value="Aa" label="Type specimen"/></UI.Tile>))}</UI.BentoGrid>
    <h2>Controls</h2><p>Hover, press, or Tab to each enabled control to inspect its real interaction states. Disabled and loading examples are inert.</p>
    {['default', 'disabled', 'loading'].map(state => {
      const props = { disabled: state === 'disabled', loading: state === 'loading' }
      return <section className="ui-control-specimen" key={state} aria-label={`${state} controls`}><h3>{state}</h3><div className="ui-control-row">
        {['primary','secondary','ghost','destructive'].map(variant => <UI.Button key={variant} variant={variant} {...props}>{variant}</UI.Button>)}
        <UI.IconButton label={`${state} settings`} {...props}><Settings size={18}/></UI.IconButton>
        <UI.Input aria-label={`${state} input`} placeholder="Input" {...props}/>
        <UI.Select aria-label={`${state} select`} {...props}><option>Select</option><option>Second option</option></UI.Select>
        <label><UI.Checkbox aria-label={`${state} checkbox`} checked={checked} onCheckedChange={setChecked} {...props}/> Checkbox</label>
        <UI.Switch label={`${state} switch`} on={checked} onChange={setChecked} {...props}/>
        <UI.Segmented aria-label={`${state} period`} value={segment} onValueChange={setSegment} options={[{value:'day',label:'Day'},{value:'week',label:'Week'}]} {...props}/>
        <UI.Menu label={`${state} menu`} items={[{label:'Example action',onClick:() => setNotice('Menu action')},{label:'Unavailable',disabled:true}]} {...props}/>
        <UI.Tooltip label="Helpful label"><UI.Button {...props}>Tooltip</UI.Button></UI.Tooltip><UI.Kbd>⌘ K</UI.Kbd>
      </div></section>
    })}
    <section className="ui-control-specimen"><h3>Validation and unavailable numbers</h3><UI.Input aria-label="Invalid input" aria-invalid="true" defaultValue="Invalid example"/><UI.Ring label="Missing value"/><UI.Sparkline values={[]} label="Empty series"/></section>
  </main>
}
