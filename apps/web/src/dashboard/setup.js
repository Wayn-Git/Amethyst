export const sourceNames = { googlecalendar: 'Google Calendar', gmail: 'Gmail', github: 'GitHub', slack: 'Slack' }
export function widgetRequirements(manifest) {
  const sources = (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).filter(Boolean)
  const connectors = [...new Set([...(manifest.requires || []).filter(value => value.startsWith('connector:')).map(value => value.slice(10)), ...sources.filter(value => value.type === 'composio').map(value => value.toolkit).filter(Boolean)])]
  const location = ['glance.weather', 'glance.air', 'glance.sun'].includes(manifest.id)
  const media = manifest.id === 'glance.music'
  const model = sources.some(value => value.type === 'llm') || (manifest.requires || []).some(value => value.startsWith('model'))
  const steps = connectors.map(id => `Connect ${sourceNames[id] || id} in Connected apps. Complete sign-in, return here, then check live data.`)
  if (location) steps.push('Choose a city, use device location, or enter coordinates below. A location is shared by Weather, Air quality, and Sunrise and sunset. No weather API key is required.')
  if (media) steps.push('Run Amethyst on Linux with busctl available in the same desktop session as your media player.', 'Open a player that supports MPRIS desktop controls and start a track. Return here and check live data. A phone or another computer does not expose its player to this desktop.', 'Only controls reported by the player are enabled. Playback changes still require approval.')
  if (model) steps.push('Configure an available local or cloud model in Model settings. Model-backed results are generated asynchronously.')
  if (!steps.length) steps.push(sources.some(value => value.type === 'library') || manifest.id.startsWith('lib.') ? 'Save or import items in Library, then check live data here. This widget reads the existing vault; an empty vault is not a connection failure.' : 'This widget uses existing Amethyst data. Open the widget to inspect its records or available settings, then check live data. An empty source is not a connection failure.')
  return { connectors, location, media, model, steps }
}

export function widgetStatus(manifest, data) {
  if (data.state === 'loading') return 'Checking source…'
  if (data.state === 'error') return 'Live data unavailable'
  if (data.state === 'not-connected') return 'Setup required'
  if (data.payload?.set_location) return 'Choose a location'
  if (manifest.id === 'glance.music' && data.payload?.supported === false) return 'Desktop media is not supported on this host'
  if (manifest.id === 'glance.music' && !data.payload?.active_player) return 'No desktop player found'
  if (data.stale || data.state === 'stale') return 'Cached data · refresh needed'
  if (data.state === 'empty') return 'Source available · no items'
  return 'Data available'
}

