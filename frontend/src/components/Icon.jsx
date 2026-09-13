import {
  Archive,
  ArrowDown,
  ArrowElbowDownLeft,
  Asterisk,
  ArrowUpRight,
  ArrowsClockwise,
  ArrowsIn,
  ArrowsOut,
  BookmarkSimple,
  Books,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChatTeardropText,
  Check,
  Circuitry,
  CodeSimple,
  ClockCountdown,
  Copy,
  DotsThree,
  DownloadSimple,
  Envelope,
  Eye,
  FileText,
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
  MinusCircle,
  Moon,
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
  Gear,
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
  /* Four marks were being asked for by name and had no entry, so `Icon`
     returned null and the button around them rendered as a label with a hole
     in it -- "Manage" and "Uninstall" in the connector drawer, the
     jump-to-latest pill in chat, and the pairing glyph in the OAuth sheet. */
  brand: Asterisk,
  down: ArrowDown,
  'minus-circle': MinusCircle,
  settings: Gear,
  archive: Archive,
  back: CaretLeft,
  book: Books,
  bookmark: BookmarkSimple,
  'caret-down': CaretDown,
  'caret-up': CaretUp,
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
  moon: Moon,
  mail: Envelope,
  'mail-open': EnvelopeOpen,
  eye: Eye,
  code: CodeSimple,
  expand: ArrowsOut,
  collapse: ArrowsIn,
  download: DownloadSimple,
  page: FileText,
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

/* Optical weight.

   A stroke that is right at 14px is heavy at 28px, because Phosphor's weights
   are a fixed fraction of the 256-unit grid rather than a fixed number of
   device pixels. The old file pinned everything to `regular` and the result
   is what "I don't like the icons" usually means: marks in a 13px status row
   and marks in a 32px empty-state illustration drawn with visibly different
   optical density, so no size looked deliberate.

   Below 20px `regular` is the floor -- `light` at 14px disappears into a
   hairline on a light ground. At 20px and up `light` is correct, and it is
   also what the reference set uses at display sizes.

   `filled` exists for one job: the selected item in a navigation list. An
   outline mark that gains a fill on selection is the cheapest unambiguous
   "you are here" there is, and it survives being read at a glance, in
   greyscale, and by someone who cannot tell the accent colour from the text
   colour. */
export default function Icon({ name, size = 18, weight, filled = false, ...rest }) {
  const Mark = MARKS[name]
  if (!Mark) {
    // A missing mark used to render as nothing, which turns an icon-only
    // button into an invisible hit target. Loud in development, silent and
    // space-holding in production, so the row does not reflow.
    if (import.meta.env?.DEV) console.warn(`Icon: no mark named "${name}"`)
    return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size }} />
  }
  const w = weight ?? (filled ? 'fill' : size >= 20 ? 'light' : 'regular')
  return <Mark size={size} weight={w} aria-hidden="true" {...rest} />
}
