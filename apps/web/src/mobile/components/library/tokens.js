/* Shared design tokens for the mobile Library revamp.
   Source of truth: docs/agent-context/sections/library-revamp-design.md
   (extracted from the "Amethyst Library Revamp" design boards). */

export const INK = '#151517'
export const MUTED = '#636366'
export const FADED = '#8E8E93'
export const CANVAS = '#F2F2F7'
export const CARD = '#FFFFFF'
export const LINE = '#ECECF0'
export const BLUE = '#0B5FD9'
export const DEEP_BLUE = '#0A55C4'
export const RED = '#FF3B30'
export const DANGER_RED = '#B3261E'
export const DANGER_BG = '#FDECEA'
export const SUCCESS_GREEN = '#34C759'
export const SUCCESS_BG = '#E3F3E9'
export const SUCCESS_TX = '#12663A'
export const RATING_GOLD = '#F5A524'
export const RATING_BG = '#FBEBC8'
export const RATING_TX = '#6B4300'
export const TILE_BORDER = '#D8D8DE'

/* Per-kind palette used by thumbs, badges and tiles across every screen. */
export const KIND_META = {
  video: { label: 'Video', plural: 'Videos', color: '#2B3040', tint: '#E4EDFC', tintText: '#0A55C4' },
  article: { label: 'Article', plural: 'Articles', color: '#4C5A8A', tint: '#E4EDFC', tintText: '#0A55C4' },
  post: { label: 'Post', plural: 'Posts', color: '#1F3D2B', tint: '#E4F5EA', tintText: '#14703A' },
  movie: { label: 'Movie', plural: 'Movies', color: '#1E2A4F', tint: '#E4EDFC', tintText: '#0A55C4' },
  recipe: { label: 'Recipe', plural: 'Recipes', color: '#C2561A', tint: '#FDEBDD', tintText: '#A8480E' },
  game: { label: 'Game', plural: 'Games', color: '#0C4A54', tint: '#DDF1F3', tintText: '#0B5560' },
  note: { label: 'Note', plural: 'Notes', color: '#E8E8ED', tint: '#E4EDFC', tintText: '#0A55C4' },
  book: { label: 'Book', plural: 'Books', color: '#3157C8', tint: '#E4EDFC', tintText: '#0A55C4' },
  place: { label: 'Place', plural: 'Places', color: '#0C3A46', tint: '#E4EDFC', tintText: '#0A55C4' },
  podcast: { label: 'Podcast', plural: 'Podcasts', color: '#2B3040', tint: '#E4EDFC', tintText: '#0A55C4' },
  product: { label: 'Product', plural: 'Products', color: '#3A3A3C', tint: '#E4EDFC', tintText: '#0A55C4' },
  other: { label: 'Save', plural: 'Saves', color: '#3A3A3C', tint: '#EFECF6', tintText: '#3A3A3C' },
}

/* Aliases collapse onto canonical kinds before palette lookup. */
export function canonicalKind(raw) {
  const value = String(raw || '').toLowerCase()
  if (value === 'reel') return 'video'
  if (value === 'film' || value === 'show' || value === 'series') return 'movie'
  if (value === 'novel' || value === 'reading') return 'book'
  if (value === 'destination' || value === 'restaurant' || value === 'cafe') return 'place'
  if (value === 'quote') return 'note'
  if (value === 'link' || value === 'page') return 'article'
  if (value === 'image') return 'other'
  return KIND_META[value] ? value : 'other'
}

export const STATUS_LABELS = {
  movie: { unstarted: 'Watchlist', in_progress: 'Watching', completed: 'Watched' },
  game: { unstarted: 'Wishlist', in_progress: 'Playing', completed: 'Played' },
  book: { unstarted: 'Want to read', in_progress: 'Reading', completed: 'Read' },
  place: { unstarted: 'Want to go', in_progress: 'Planned', completed: 'Been there' },
  recipe: { unstarted: 'To cook', in_progress: 'Cooking', completed: 'Cooked' },
  default: { unstarted: 'Wishlist', in_progress: 'In progress', completed: 'Done' },
}

export function statusLabelFor(kind, progress) {
  const labels = STATUS_LABELS[kind] || STATUS_LABELS.default
  return labels[progress] || labels.unstarted
}

/* Shared shadow recipes from the boards. */
export const CARD_SHADOW = '0 1px 2px rgba(0,0,0,.05), 0 6px 18px rgba(0,0,0,.06)'
export const CARD_SHADOW_SOFT = '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)'
export const JUMP_SHADOW = (color) => `0 8px 20px ${color}44`
