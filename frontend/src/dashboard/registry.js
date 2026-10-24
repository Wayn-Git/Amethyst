import { lazy } from 'react'
export const WIDGETS = {
  'lib.resurface': lazy(() => import('./widgets/Library.jsx')),
  'lib.capture': lazy(() => import('./widgets/Capture.jsx')),
  'lib.inbox': lazy(() => import('./widgets/Library.jsx')),
  'need.snoozed': lazy(() => import('./widgets/NeedsItems.jsx')),
  'need.overdue': lazy(() => import('./widgets/NeedsItems.jsx')),
  'task.backlog': lazy(() => import('./widgets/Items.jsx')),
  'task.deadlines': lazy(() => import('./widgets/Items.jsx')),
  'task.reminders': lazy(() => import('./widgets/Items.jsx')),
  'task.today': lazy(() => import('./widgets/Items.jsx')),
  'glance.clock': lazy(() => import('./widgets/Clock.jsx')),
  'dash.sync': lazy(() => import('./widgets/Sync.jsx')),
  'dash.quiet': lazy(() => import('./widgets/Quiet.jsx')),
  'dash.shortcuts': lazy(() => import('./widgets/Shortcuts.jsx')),
  'dash.gallery': lazy(() => import('./widgets/Gallery.jsx')),
}
