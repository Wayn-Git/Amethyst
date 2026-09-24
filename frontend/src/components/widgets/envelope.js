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
  'image_gallery',
  'data_table',
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

  return { type: payload.type, data: payload.data, media: Array.isArray(payload.media) ? payload.media : [] }
}

/** Parses message text that may contain one or more embedded widget envelopes
 * interspersed with markdown prose.
 *
 * Returns an array of blocks:
 *   [{ type: 'text', content: string }] or
 *   [{ type: 'widget', widget: { type: string, data: object, media: array } }]
 */
export function parseContentBlocks(text) {
  if (!text) return []
  const openingFence = '```' + FENCE
  if (!text.includes(openingFence)) {
    return [{ type: 'text', content: text }]
  }

  const blocks = []
  let cursor = 0

  while (cursor < text.length) {
    const startIndex = text.indexOf(openingFence, cursor)
    if (startIndex === -1) {
      const remaining = text.slice(cursor)
      if (remaining.trim()) {
        blocks.push({ type: 'text', content: remaining })
      }
      break
    }

    if (startIndex > cursor) {
      const prefix = text.slice(cursor, startIndex)
      if (prefix.trim()) {
        blocks.push({ type: 'text', content: prefix })
      }
    }

    const bodyStart = startIndex + openingFence.length
    const endIndex = text.indexOf('```', bodyStart)
    if (endIndex === -1) {
      const remaining = text.slice(startIndex)
      if (remaining.trim()) {
        blocks.push({ type: 'text', content: remaining })
      }
      break
    }

    const body = text.slice(bodyStart, endIndex).trim()
    cursor = endIndex + 3

    let parsed = null
    try {
      const payload = JSON.parse(body)
      if (
        payload &&
        typeof payload === 'object' &&
        WIDGET_TYPES.includes(payload.type) &&
        payload.data &&
        typeof payload.data === 'object'
      ) {
        parsed = {
          type: payload.type,
          data: payload.data,
          media: Array.isArray(payload.media) ? payload.media : [],
        }
      }
    } catch {
      parsed = null
    }

    if (parsed) {
      blocks.push({ type: 'widget', widget: parsed })
    } else {
      blocks.push({ type: 'text', content: text.slice(startIndex, cursor) })
    }
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: text }]
}

