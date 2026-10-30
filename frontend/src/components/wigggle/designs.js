import catalog from './catalog.json'
export { catalog }
export const CATEGORIES = ['clock', 'calendar', 'weather', 'media', 'productivity', 'dashboard', 'stocks', 'sports']
export function designBlocker(design) {
  if (design.category === 'stocks') return { reason: 'A live market-data provider is not implemented. The example prices and charts are not connected to an exchange.', requirements: ['A market-data provider with supported exchanges, symbols and quote history.', 'Provider credentials and licensing, if required by the chosen service.'] }
  if (design.category === 'sports') return { reason: 'A live sports-data provider is not implemented. Example fixtures and scores are not live results.', requirements: ['A scores and fixtures provider for the selected sport and competition.', 'Team selection and provider authentication, where required.'] }
  if (design.id === 'calendar-lg-01') return { reason: 'This design displays date-based prices. The current calendar integration supplies events, not airfare or booking prices.', requirements: ['A pricing provider and a selected route or booking search.', 'A supported action for selecting or opening a real result.'] }
  if (design.id === 'clock-sm-12') return { reason: 'This is an elapsed-time stopwatch. The existing Focus widget is a countdown timer and does not implement these stopwatch controls.', requirements: ['Working stopwatch start, pause and reset controls with elapsed-time state.'] }
  if (design.id === 'clock-sm-13') return { reason: 'The example time picker is not connected to the reminder scheduler.', requirements: ['A reminder creation flow connecting the selected time and timezone to the scheduler.', 'Approval and a saved reminder before claiming that an alarm is scheduled.'] }
  if (design.id === 'media-md-04') return { reason: 'The desktop player supplies the current track, not the album collection used by this design.', requirements: ['A media library or playlist provider with album artwork and selection controls.'] }
  if (['media-sm-06', 'media-sm-07'].includes(design.id)) return { reason: 'The current player widget supports play, pause and track navigation. The volume and favorite controls in this design are not connected.', requirements: ['Supported volume and favorite actions with player capability checks.', 'Approval for actions that change playback or the media library.'] }
  if (design.id === 'media-sm-08') return { reason: 'MPRIS track metadata does not supply the headphone battery and device state required by this design.', requirements: ['A supported device-status provider for the paired headphones.'] }
  return null
}
export function targetsForDesign(design, manifests) {
  const number = Number(design.id.split('-').at(-1))
  let ids = []
  if (design.category === 'clock') ids = number <= 9 ? ['glance.clock'] : number === 10 ? ['task.reminders'] : number === 11 ? ['task.focus'] : []
  if (design.category === 'calendar' && design.id !== 'calendar-lg-01') ids = ['glance.next-event', 'task.agenda']
  if (design.category === 'weather') ids = ['glance.weather']
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
