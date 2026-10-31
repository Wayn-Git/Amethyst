export const MUSIC_DESIGNS = [
  {
    id: 'media-md-01',
    number: 1,
    name: 'Evermusic',
    family: 'evermusic',
    caption: 'Apple iOS Now Playing with adaptive squircle art and 5-button transport',
  },
  {
    id: 'media-md-02',
    number: 2,
    name: 'Dynamic Island',
    family: 'island',
    caption: 'Compact dark pill with circular play button and live progress scrubber',
  },
  {
    id: 'media-md-03',
    number: 3,
    name: 'Vinyl Groove',
    family: 'vinyl',
    caption: 'Circular record disc aesthetic with rotating center and track ledger',
  },
  {
    id: 'media-md-04',
    number: 4,
    name: 'Editorial',
    family: 'editorial',
    caption: 'High-contrast typography, large artist headings, and clean transport',
  },
]

export const DEFAULT_MUSIC_DESIGN = 'media-md-01'

export function getMusicDesign(designId) {
  if (!designId) return MUSIC_DESIGNS[0]
  if (designId === 'now-playing-01' || designId === 'media-md-01') return MUSIC_DESIGNS[0]
  if (designId === 'now-playing-02' || designId === 'media-md-02') return MUSIC_DESIGNS[1]
  if (designId === 'now-playing-03' || designId === 'media-md-03') return MUSIC_DESIGNS[2]
  if (designId === 'now-playing-04' || designId === 'media-md-04') return MUSIC_DESIGNS[3]

  const byId = MUSIC_DESIGNS.find(d => d.id === designId)
  if (byId) return byId

  const number = Number(String(designId || '').split('-').at(-1))
  return MUSIC_DESIGNS.find(d => d.number === number) || MUSIC_DESIGNS[0]
}
