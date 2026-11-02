import { CLOCK_FACES } from './widgets/clock/faces.js'

const families = {
  'glance.clock': { category: 'clock', choices: CLOCK_FACES.map(({ id, name, caption }) => ({ id, name, caption })) },
  'glance.weather': { category: 'weather', names: ['Storm Canvas', 'Navy Split', 'Cobalt Stack', 'Bento Cards', 'Dot-Matrix Teal'] },
  'glance.music': { category: 'media', names: ['Synced Lyrics', 'Obsidian Vinyl', 'Bento Audio', 'Full-Bleed Scrim', 'Terracotta Groove'] },
  'glance.next-event': { category: 'calendar', names: ['Split Calendar', 'Neon Countdown', 'Dot-Matrix Teal', 'Cobalt Agenda', 'Bento Time-Block'] },
  'glance.air': { category: 'air', names: ['Segmented Spectrum', 'Vertical Pill Gauges', 'Bordered Trend', 'Neon Ring Dark', 'Dot-Matrix Teal'] },
  'glance.sun': { category: 'sun', names: ['Horizon Arc Dial', 'Dusk Scrim', 'Dual-Time Bento', 'Solar Ring Dark', 'Terracotta Dawn'] },
  'glance.travel': { category: 'travel', names: ['Split-Flap Map', 'Route Nodes', 'Mode Stepper', 'Night Scrim', 'Cobalt Stack'] },
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
