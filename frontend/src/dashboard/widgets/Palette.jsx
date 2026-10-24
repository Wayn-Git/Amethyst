import { useApp } from '../../store.jsx'

export default function Palette() {
  const { setOverlay } = useApp()
  return <><p>Search Library, widgets, tasks and actions. Capture a note with approval.</p><button onClick={() => setOverlay('palette')}>Open command palette</button><p>⌘K / Ctrl+K</p></>
}
