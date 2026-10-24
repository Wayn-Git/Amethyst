import { lazy } from 'react'
export const WIDGETS = {
  'task.backlog': lazy(() => import('./widgets/Items.jsx')),
  'task.today': lazy(() => import('./widgets/Items.jsx')),
  'glance.clock': lazy(() => import('./widgets/Clock.jsx')),
  'dash.sync': lazy(() => import('./widgets/Sync.jsx')),
  'dash.quiet': lazy(() => import('./widgets/Quiet.jsx')),
  'dash.shortcuts': lazy(() => import('./widgets/Shortcuts.jsx')),
  'dash.gallery': lazy(() => import('./widgets/Gallery.jsx')),
}
