/* The transcript form of a widget, and how to read it back.
 *
 * Mirrors `to_envelope`/`parse_envelope` in `backend/agent/widgets.py`. The
 * message table has no widget column, so a widget is persisted as a fenced JSON
 * block in the assistant message's own content -- which is what rebuilds it
 * when a conversation is reopened, since the `widget` event only ever arrives
 * once, live.
 *
 * React-free on purpose, so it can be tested under bare node the way
 * `markdown/parse.js` is. */

export const FENCE = 'amethyst:widget'

/* Kept in step with `WIDGET_MODELS` on the backend. A payload naming anything
   else is not a widget this build knows how to draw, and is left as prose. */
export const WIDGET_TYPES = [
  'recipe',
  'step_guide',
  'quiz',
  'comparison',
  'itinerary',
  'translation',
  'chart',
  'options',
]

/** The widget in `text`, or null if it does not hold one.
 *
 * Deliberately strict: the fence has to be the whole message. An ordinary
 * answer that happens to quote an envelope is still the prose it is, and
 * rendering it as a widget would be the model's example turned into UI. */
export function parseWidgetEnvelope(text) {
  const trimmed = (text ?? '').trim()
  const opening = '```' + FENCE
  if (!trimmed.startsWith(opening) || !trimmed.endsWith('```')) return null
  // `slice` rather than a regex: the body is JSON that can contain anything,
  // including the fence itself inside a string.
  const body = trimmed.slice(opening.length, -3).trim()

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  if (!WIDGET_TYPES.includes(payload.type)) return null
  if (!payload.data || typeof payload.data !== 'object') return null

  return { type: payload.type, data: payload.data }
}
