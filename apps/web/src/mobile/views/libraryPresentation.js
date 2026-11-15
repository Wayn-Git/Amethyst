const KIND_SCREENS = {
  article: 'article',
  newsletter: 'article',
  paper: 'article',
  note: 'note',
  post: 'post',
  video: 'video',
  reel: 'video',
  podcast: 'podcast',
  music: 'podcast',
  movie: 'movie',
  film: 'movie',
  show: 'movie',
  series: 'movie',
  recipe: 'recipe',
  game: 'game',
  book: 'book',
  novel: 'book',
  reading: 'book',
  place: 'place',
  destination: 'place',
  restaurant: 'place',
  cafe: 'place',
  product: 'product',
}

const RESOURCE_SCREENS = {
  recipe: 'recipe',
  food: 'recipe',
  game: 'game',
  movie: 'movie',
  show: 'movie',
  film: 'movie',
  book: 'book',
  place: 'place',
  destination: 'place',
  restaurant: 'place',
  cafe: 'place',
  travel: 'place',
}

export function getLibraryDetailScreen(item, resources = []) {
  if (!Array.isArray(resources)) {
    try { resources = JSON.parse(resources || '[]') } catch { resources = [] }
  }

  // 1. Entity attributes (e.g. Cuisine / Hours => place)
  const entity = item?.entity && typeof item.entity === 'object' ? item.entity : {}
  const attributeNames = Object.keys(entity.attributes || {}).map((name) => name.toLowerCase())
  if (attributeNames.some((name) => ['cuisine', 'hours', 'best for', 'season', 'location'].includes(name))) return 'place'

  // 2. Extracted resource overrides (e.g. recipe / book / movie referenced in video/article)
  const resourceScreen = resources
    .map((resource) => RESOURCE_SCREENS[String(resource?.type || '').toLowerCase()])
    .find(Boolean)
  if (resourceScreen) return resourceScreen

  // 3. Category overrides
  const category = String(item?.category || '').toLowerCase()
  if (category === 'movie' || category === 'book') return category
  if (category === 'travel') return 'place'
  if (category === 'food') return 'recipe'
  if (category === 'product' || category === 'shopping') return 'product'
  if (category === 'podcast') return 'podcast'

  // 4. Exact kind screen
  const kind = String(item?.kind || '').toLowerCase()
  if (KIND_SCREENS[kind]) return KIND_SCREENS[kind]

  return item?.is_reel ? 'video' : 'article'
}
