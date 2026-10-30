import catalog from './catalog.json'
export { catalog }
export const CATEGORIES = ['clock', 'calendar', 'weather', 'media', 'productivity', 'dashboard', 'stocks', 'sports']
export function targetsForDesign(design, manifests) {
  const number = Number(design.id.split('-').at(-1))
  let ids = []
  if (design.category === 'clock') ids = number <= 9 ? ['glance.clock'] : number === 10 ? ['task.reminders'] : number === 11 ? ['task.focus'] : []
  if (design.category === 'calendar' && design.id !== 'calendar-lg-01') ids = ['glance.next-event', 'task.agenda']
  if (design.category === 'weather' && design.id !== 'weather-sm-09') ids = ['glance.weather']
  if (design.category === 'media' && !['media-md-04', 'media-sm-06', 'media-sm-07', 'media-sm-08'].includes(design.id)) ids = ['glance.music']
  if (design.category === 'productivity') ids = number === 3 && design.size === 's' ? ['task.focus'] : [5, 6, 7].includes(number) ? ['task.habits'] : ['task.today', 'task.backlog', 'task.goals']
  if (design.category === 'dashboard') ids = design.id === 'dashboard-md-01' ? ['sys.vault'] : design.id === 'dashboard-sm-06' ? ['lib.capture'] : design.id === 'dashboard-sm-05' || design.id === 'dashboard-md-02' ? ['sys.connectors'] : ['agent.usage']
  return manifests.filter(manifest => ids.includes(manifest.id))
}
export function defaultDesign(id) {
  return id === 'glance.clock' ? 'clock-sm-05' : id === 'glance.weather' ? 'weather-md-02' : id === 'glance.music' ? 'media-md-02'
    : id === 'glance.next-event' ? 'calendar-sm-06' : id.startsWith('task.') ? 'productivity-md-02' : 'dashboard-md-01'
}
export function designSize(design, manifest) { return manifest.sizes.includes(design.size) ? design.size : manifest.sizes.includes('m') ? 'm' : manifest.sizes[0] }
