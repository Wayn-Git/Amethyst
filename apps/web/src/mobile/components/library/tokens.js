/* Shared design tokens for the mobile Library revamp.
   Source of truth: 37 design boards and specs (Ground #F2F2F7, ink #151517, secondary #636366). */

export const INK = '#151517'
export const MUTED = '#636366'
export const FADED = '#8E8E93'
export const CANVAS = '#F2F2F7'
export const CARD = '#FFFFFF'
export const LINE = '#ECECF0'
export const BLUE = '#0B5FD9'
export const DEEP_BLUE = '#0A55C4'
export const BLUE_PRESSED = '#0A55C4'
export const BLUE_SOFT = '#E4EDFC'
export const DANGER_RED = '#B3261E'
export const DANGER_BG = '#FDECEA'
export const SUCCESS_GREEN = '#14703A'
export const SUCCESS_BG = '#E4F5EA'
export const RATING_GOLD = '#F5A524'
export const TILE_BORDER = '#D8D8DE'

export const KIND_COLORS = {
  video: '#2B3040',
  article: '#4C5A8A',
  post: '#4C5A8A',
  recipe: '#C2561A',
  movie: '#1E2A4F',
  game: '#0C4A54',
  book: '#6D4C41',
  place: '#2E7D32',
  podcast: '#5C2D91',
  product: '#1A237E',
  note: '#3157C8',
  checklist: '#14703A',
}

/* Per-kind palette used by thumbs, badges and tiles across every screen. */
export const KIND_META = {
  video: { label: 'Video', plural: 'Videos', color: '#2B3040', tint: '#E4EDFC', tintText: '#0A55C4' },
  article: { label: 'Article', plural: 'Articles', color: '#4C5A8A', tint: '#E4EDFC', tintText: '#0A55C4' },
  post: { label: 'Post', plural: 'Posts', color: '#3D4663', tint: '#E4EDFC', tintText: '#0A55C4' },
  movie: { label: 'Movie', plural: 'Movies', color: '#1E2A4F', tint: '#E4EDFC', tintText: '#0A55C4' },
  recipe: { label: 'Recipe', plural: 'Recipes', color: '#C2561A', tint: '#FDEBDD', tintText: '#A8480E' },
  game: { label: 'Game', plural: 'Games', color: '#0C4A54', tint: '#DDF1F3', tintText: '#0B5560' },
  note: { label: 'Note', plural: 'Notes', color: '#3157C8', tint: '#E4EDFC', tintText: '#0A55C4' },
  book: { label: 'Book', plural: 'Books', color: '#E7DFD0', tint: '#E4EDFC', tintText: '#0A55C4', darkText: true },
  place: { label: 'Place', plural: 'Places', color: '#2E7D32', tint: '#E4EDFC', tintText: '#0A55C4' },
  podcast: { label: 'Podcast', plural: 'Podcasts', color: '#5C2D91', tint: '#E4EDFC', tintText: '#0A55C4' },
  product: { label: 'Product', plural: 'Products', color: '#1A237E', tint: '#E4EDFC', tintText: '#0A55C4' },
  other: { label: 'Save', plural: 'Saves', color: '#3A3A3C', tint: '#EFECF6', tintText: '#3A3A3C' },
}

/* 11 Canonical types in Filter and Sort */
export const ALL_11_TYPES = [
  { id: 'video', label: 'Videos' },
  { id: 'article', label: 'Articles' },
  { id: 'post', label: 'Posts' },
  { id: 'podcast', label: 'Podcasts' },
  { id: 'movie', label: 'Movies' },
  { id: 'recipe', label: 'Recipes' },
  { id: 'game', label: 'Games' },
  { id: 'book', label: 'Books' },
  { id: 'place', label: 'Places' },
  { id: 'product', label: 'Products' },
  { id: 'note', label: 'Notes' },
]

/* Aliases collapse onto canonical kinds before palette lookup. */
export function canonicalKind(raw) {
  const value = String(raw || '').toLowerCase()
  if (value === 'reel') return 'video'
  if (value === 'film' || value === 'show' || value === 'series') return 'movie'
  if (value === 'novel' || value === 'reading') return 'book'
  if (value === 'destination' || value === 'restaurant' || value === 'cafe') return 'place'
  if (value === 'quote' || value === 'checklist') return 'note'
  if (value === 'link' || value === 'page' || value === 'newsletter' || value === 'paper') return 'article'
  if (value === 'item' || value === 'shopping') return 'product'
  if (value === 'image') return 'other'
  return KIND_META[value] ? value : 'other'
}

export const STATUS_LABELS = {
  movie: { unstarted: 'Watchlist', in_progress: 'Watching', completed: 'Watched' },
  game: { unstarted: 'Wishlist', in_progress: 'Playing', completed: 'Played' },
  book: { unstarted: 'Want to read', in_progress: 'Reading', completed: 'Read' },
  place: { unstarted: 'Want to go', in_progress: 'Planned', completed: 'Been there' },
  recipe: { unstarted: 'To cook', in_progress: 'Cooking', completed: 'Cooked' },
  podcast: { unstarted: 'Queue', in_progress: 'Listening', completed: 'Done' },
  product: { unstarted: 'Wishlist', in_progress: 'Ordered', completed: 'Owned' },
  default: { unstarted: 'Wishlist', in_progress: 'In progress', completed: 'Done' },
}

export function statusLabelFor(kind, progress) {
  const labels = STATUS_LABELS[kind] || STATUS_LABELS.default
  return labels[progress] || labels.unstarted
}

export function normalizeTags(tags) {
  let list = []
  if (Array.isArray(tags)) list = tags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean)
  else if (typeof tags === 'string') {
    list = tags.split(/[\s,]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
  }
  return list.filter((t) => !/^(imdb|youtube|twitter|x|reddit|github)$/i.test(t))
}

/* Glass styles */
export const GLASS_STYLE = {
  background: 'rgba(255,255,255,.42)',
  WebkitBackdropFilter: 'blur(28px) saturate(200%)',
  backdropFilter: 'blur(28px) saturate(200%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 1px rgba(255,255,255,.55), 0 0 0 .5px rgba(0,0,0,.10), 0 8px 24px rgba(0,0,0,.12)',
}

export const GLASS_DARK_STYLE = {
  background: 'rgba(28,28,30,.72)',
  WebkitBackdropFilter: 'blur(28px) saturate(180%)',
  backdropFilter: 'blur(28px) saturate(180%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.22), inset 0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.25)',
}

export const GLASS_MAP_STYLE = {
  background: 'rgba(255,255,255,.55)',
  WebkitBackdropFilter: 'blur(28px) saturate(200%)',
  backdropFilter: 'blur(28px) saturate(200%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 1px rgba(255,255,255,.55), 0 0 0 .5px rgba(0,0,0,.10), 0 8px 24px rgba(0,0,0,.14)',
}

/* Card and sheet shadow recipes */
export const CARD_SHADOW = '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)'
export const SHEET_SHADOW = 'inset 0 1px 0 rgba(255,255,255,.95), 0 -8px 32px rgba(0,0,0,.14)'
export const ALERT_SHADOW = 'inset 0 1px 0 rgba(255,255,255,.95), 0 0 0 .5px rgba(0,0,0,.10), 0 24px 60px rgba(0,0,0,.30)'
export const JUMP_SHADOW = (color) => `0 8px 20px ${color}44`
