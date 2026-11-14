import MovieScreen from '../components/library/MovieScreen.jsx'
import RecipeScreen from '../components/library/RecipeScreen.jsx'
import GameScreen from '../components/library/GameScreen.jsx'
import BookScreen from '../components/library/BookScreen.jsx'
import PlaceScreen from '../components/library/PlaceScreen.jsx'
import PodcastScreen from '../components/library/PodcastScreen.jsx'
import ProductScreen from '../components/library/ProductScreen.jsx'
import VideoDetailScreen from '../components/library/VideoDetailScreen.jsx'
import PostArticleScreen from '../components/library/PostArticleScreen.jsx'
import NoteChecklistScreen from '../components/library/NoteChecklistScreen.jsx'

/* Router for per-kind Library detail content (library revamp boards §8).
   The host (MobileLibraryItem) owns the top bar, tab strip, sheets and bottom
   dock; each kind screen owns its hero band, title, status controls and
   overview content. */

const SCREENS = {
  video: VideoDetailScreen,
  article: PostArticleScreen,
  post: PostArticleScreen,
  note: NoteChecklistScreen,
  movie: MovieScreen,
  recipe: RecipeScreen,
  game: GameScreen,
  book: BookScreen,
  place: PlaceScreen,
  podcast: PodcastScreen,
  product: ProductScreen,
}

export const KIND_SCREEN_NAMES = Object.keys(SCREENS)

export default function LibraryTypeDetails({
  item,
  screen,
  resources = [],
  sourceText = '',
  onUpdate,
  onOpenLink,
  onReEnrich,
  showToast,
}) {
  const Screen = SCREENS[screen] || SCREENS.article
  return (
    <Screen
      item={item}
      screen={screen}
      resources={resources}
      sourceText={sourceText}
      onUpdate={onUpdate}
      onOpenLink={onOpenLink}
      onReEnrich={onReEnrich}
      showToast={showToast}
    />
  )
}
