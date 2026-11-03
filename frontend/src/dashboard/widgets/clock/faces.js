// The clock has three families. Each face keeps the same data contract and
// changes only its composition, so every size can be validated independently.
export const CLOCK_FACES = [
  { id: 'clock-sm-01', number: 1, family: 'digital', name: 'Minimal', caption: 'Bold time, quiet detail' },
  { id: 'clock-sm-02', number: 2, family: 'digital', name: 'Precision', caption: 'Seconds and exact offset' },
  { id: 'clock-sm-03', number: 3, family: 'digital', name: 'Editorial', caption: 'Time beside dated tiles' },
  { id: 'clock-sm-04', number: 4, family: 'analog', name: 'Roman', caption: 'White dial, Roman numerals' },
  { id: 'clock-sm-05', number: 5, family: 'analog', name: 'Index', caption: 'Clean tick dial with date' },
  { id: 'clock-sm-06', number: 6, family: 'analog', name: 'Split', caption: 'Dial and digital reading' },
  { id: 'clock-sm-07', number: 7, family: 'world', name: 'World pair', caption: 'Local time plus two cities' },
  { id: 'clock-sm-08', number: 8, family: 'world', name: 'World grid', caption: 'Four cities in a grid' },
  { id: 'clock-sm-09', number: 9, family: 'world', name: 'World ledger', caption: 'A compact list of four cities' },
]

export const DEFAULT_CLOCK_FACE = 'clock-sm-01'

export function clockFace(design) {
  const number = Number(String(design || '').split('-').at(-1))
  return CLOCK_FACES.find(face => face.number === number) || CLOCK_FACES[0]
}

export function worldLimit(face, size) {
  if (face.number === 1) return 0
  if (face.number === 7) return size === 's' ? 1 : 2
  if (face.number === 8 || face.number === 9) return 4
  if (face.family === 'analog') return size === 'l' ? 4 : 0
  return size === 'l' ? 4 : size === 's' ? 0 : 2
}

export function showSeconds(face, _size) {
  if (face.number === 2) return true
  return face.number >= 4 && face.number <= 6
}
