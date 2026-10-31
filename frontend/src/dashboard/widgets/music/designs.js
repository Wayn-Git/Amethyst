export const MUSIC_DESIGNS = [
  {
    id: 'now-playing-01',
    number: 1,
    name: 'Evermusic',
    family: 'evermusic',
    caption: 'Apple iOS Now Playing with adaptive squircle art and 5-button transport',
  },
  {
    id: 'now-playing-02',
    number: 2,
    name: 'Dynamic Island',
    family: 'island',
    caption: 'Compact dark pill with circular play button and live progress scrubber',
  },
  {
    id: 'now-playing-03',
    number: 3,
    name: 'Vinyl Groove',
    family: 'vinyl',
    caption: 'Circular record disc aesthetic with rotating center and track ledger',
  },
  {
    id: 'now-playing-04',
    number: 4,
    name: 'Editorial',
    family: 'editorial',
    caption: 'High-contrast typography, large artist headings, and clean transport',
  },
]

export const DEFAULT_MUSIC_DESIGN = 'now-playing-01'

export function getMusicDesign(designId) {
  if (!designId) return MUSIC_DESIGNS[0]
  return MUSIC_DESIGNS.find(d => d.id === designId) || MUSIC_DESIGNS[0]
}
