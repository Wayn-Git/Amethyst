import {
  Archive,
  ArrowDown,
  ArrowElbowDownLeft,
  ArrowUpRight,
  ArrowsClockwise,
  BookmarkSimple,
  Books,
  CaretLeft,
  CaretRight,
  ChatTeardropText,
  Check,
  Circuitry,
  ClockCountdown,
  Copy,
  DotsThree,
  Envelope,
  EnvelopeOpen,
  FolderOpen,
  Gauge,
  GlobeHemisphereWest,
  Image as ImageSquare,
  Info,
  Key,
  Keyboard,
  Link,
  ListBullets,
  ListChecks,
  Lock,
  MagnifyingGlass,
  NotePencil,
  Paperclip,
  PaperPlaneRight,
  Play,
  PlugsConnected,
  Plus,
  PushPin,
  ShareNetwork,
  SidebarSimple,
  Sidebar as SidebarRight,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  Star,
  Stop,
  Sun,
  Terminal,
  Trash,
  User,
  VideoCamera,
  WarningCircle,
  X,
} from '@phosphor-icons/react'

/* One icon set, one stroke weight, one grid.

   The marks used to be hand-drawn paths, and it showed: strokes disagreed by a
   third of a pixel, optical sizes drifted, and every new one was a small act of
   invention. Phosphor is a real family drawn on a 24px grid, so a row of icons
   lines up because the typeface-equivalent says so, not because each path was
   nudged until it looked close.

   The `<Icon name="…">` API is deliberately unchanged: the names describe what
   the thing does in AMETHYST -- `plug`, `spark`, `logs` -- not what the drawing is
   called upstream, so swapping the family again would touch this file only. */

const MARKS = {
  alert: WarningCircle,
  archive: Archive,
  back: CaretLeft,
  book: Books,
  bookmark: BookmarkSimple,
  chat: ChatTeardropText,
  check: Check,
  chevron: CaretRight,
  clock: ClockCountdown,
  copy: Copy,
  cpu: Circuitry,
  dash: Gauge,
  dots: DotsThree,
  edit: NotePencil,
  'arrow-up-right': ArrowUpRight,
  folder: FolderOpen,
  globe: GlobeHemisphereWest,
  grid: SquaresFour,
  image: ImageSquare,
  info: Info,
  key: Key,
  keyboard: Keyboard,
  layout: SidebarRight,
  link: Link,
  list: ListBullets,
  lock: Lock,
  logs: ListChecks,
  mail: Envelope,
  'mail-open': EnvelopeOpen,
  paperclip: Paperclip,
  pin: PushPin,
  play: Play,
  plug: PlugsConnected,
  plus: Plus,
  refresh: ArrowsClockwise,
  search: MagnifyingGlass,
  send: PaperPlaneRight,
  share: ShareNetwork,
  sidebar: SidebarSimple,
  sliders: SlidersHorizontal,
  spark: Sparkle,
  star: Star,
  stop: Stop,
  sun: Sun,
  term: Terminal,
  trash: Trash,
  user: User,
  video: VideoCamera,
  wrap: ArrowElbowDownLeft,
  x: X,
}

// Phosphor's own default weight is too light against a dark panel; `regular`
// at 1.5px reads at 13-16px, which is where nearly every icon here sits.
export default function Icon({ name, size = 18, weight = 'regular', ...rest }) {
  const Mark = MARKS[name]
  if (!Mark) return null
  return <Mark size={size} weight={weight} aria-hidden="true" {...rest} />
}
