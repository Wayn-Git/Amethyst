import { Button } from '../../components/ui/bento/index.jsx'
import { useDashboard } from '../context.js'

export default function Palette() {
  const { openPalette } = useDashboard()
  return <><p>Search Library, widgets, tasks and actions. Capture a note with approval.</p><Button type="submit" onClick={openPalette}>Open command palette</Button><p>⌘K / Ctrl+K</p></>
}
