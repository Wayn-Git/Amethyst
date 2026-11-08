const families = {
  'glance.clock': {
    category: 'clock',
    names: ['Analog', 'Flip Cards', 'Words', 'Day & Night Strip'],
  },
  'glance.weather': {
    category: 'weather',
    names: ['Scene', 'Poster Type', 'Temperature Curve', 'Range Dial'],
  },
  'glance.music': {
    category: 'media',
    names: ['Vinyl', 'Waveform', 'Cassette', 'Album Art'],
  },
  'glance.next-event': {
    category: 'calendar',
    names: ['Countdown Ring', 'Ticket', 'Day Timeline', 'Desk Calendar'],
  },
  'glance.air': {
    category: 'air',
    names: ['Gauge', 'AQI Scale', 'Particles', 'Skyline'],
  },
  'glance.sun': {
    category: 'sun',
    names: ['Landscape', '24-Hour Dial', 'Sun Path', 'Split Day'],
  },
  'glance.travel': {
    category: 'travel',
    names: ['Light Map', 'Dark Map', 'Transit Line', 'Boarding Pass'],
  },
  'glance.pc': {
    category: 'pc',
    names: ['Activity Rings', 'Dot Dials', 'Level Meters', 'Terminal'],
  },
}

export function widgetVariations(widgetId) {
  const family = families[widgetId]
  return family?.choices || family?.names.map((name, index) => ({
    id: `${family.category}-sm-${String(index + 1).padStart(2, '0')}`,
    name,
    caption: 'Adapts to the widget size',
  })) || []
}

export function variationNumber(design) {
  const number = Number(String(design || '').split('-').at(-1))
  return Number.isInteger(number) && number > 0 ? number : 1
}
