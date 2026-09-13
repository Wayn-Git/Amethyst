import Icon from '../Icon.jsx'
import MediaGallery from './MediaGallery.jsx'
import Chart from './Chart.jsx'
import Comparison from './Comparison.jsx'
import Itinerary from './Itinerary.jsx'
import Options from './Options.jsx'
import Quiz from './Quiz.jsx'
import Recipe from './Recipe.jsx'
import StepGuide from './StepGuide.jsx'
import Translation from './Translation.jsx'

/* Widget type -> renderer.
 *
 * No renderer calls a model or the API: everything on screen came out of the
 * one extraction the turn already paid for, and a control that had to ask the
 * server what it meant would make an interactive answer slower than the prose
 * it replaced. */
const RENDERERS = {
  recipe: Recipe,
  step_guide: StepGuide,
  quiz: Quiz,
  comparison: Comparison,
  itinerary: Itinerary,
  translation: Translation,
  chart: Chart,
  options: Options,
}

/* The frame's furniture. Every widget is titled and labelled the same way, so
   the chrome is defined once here rather than eight times in eight renderers --
   which is also what stops a renderer quietly inventing its own header. */
const FURNITURE = {
  recipe: { icon: 'list', label: 'Recipe' },
  step_guide: { icon: 'logs', label: 'Guide' },
  quiz: { icon: 'chat', label: 'Quiz' },
  comparison: { icon: 'grid', label: 'Comparison' },
  itinerary: { icon: 'globe', label: 'Itinerary' },
  translation: { icon: 'page', label: 'Translation' },
  chart: { icon: 'dash', label: 'Chart' },
  options: { icon: 'logs', label: 'Options' },
}

/* What has to be present for a widget to be worth drawing.
 *
 * Each renderer already returns null when handed nothing to show, but the frame
 * wraps the renderer and cannot see that it did -- so an empty payload used to
 * draw a header with a blank space under it, which is worse than the prose it
 * replaced. Checked here instead, where the caller can still fall back. */
const CONTENT = {
  recipe: (d) => d.ingredients?.length || d.steps?.length,
  step_guide: (d) => d.steps?.length,
  quiz: (d) => d.questions?.length,
  comparison: (d) => d.items?.length,
  itinerary: (d) => d.days?.length,
  translation: (d) => d.translation,
  chart: (d) => d.series?.length,
  options: (d) => d.options?.length,
}

/** What to call this widget in its header.
 *
 * Every schema but `translation` carries a title. That one names two languages
 * instead, which is the more useful heading anyway. */
function headingFor(type, data) {
  if (type === 'translation') {
    return `${data.source_language} → ${data.target_language}`
  }
  return data.title || FURNITURE[type]?.label || 'Answer'
}

export default function WidgetRenderer({ widget }) {
  const Renderer = RENDERERS[widget?.type]
  // A type this build does not know is not an error worth showing. The caller
  // falls back to rendering the message as prose, which is what a widget was
  // an improvement on rather than a replacement for.
  if (!Renderer || !widget?.data) return null
  if (!CONTENT[widget.type](widget.data)) return null

  const { icon, label } = FURNITURE[widget.type]

  return (
    <div className="widget-frame">
      {/* The header is the part that says "this is a thing the assistant made",
          as distinct from the message it is sitting in. It stays put while the
          body below it changes underneath -- a quiz moves through its questions
          and a guide through its steps without the frame ever moving. */}
      <div className="widget-frame-head">
        <span className="widget-frame-icon"><Icon name={icon} size={13} /></span>
        <span className="widget-frame-title">{headingFor(widget.type, widget.data)}</span>
        <span className="widget-frame-label">{label}</span>
      </div>
      <div className="widget-frame-body">
        <Renderer data={widget.data} />
        {/* Media is a garnish and sits below the answer, never in place of it.
            Renders nothing when there is none, which is most of the time. */}
        <MediaGallery media={widget.media} />
      </div>
    </div>
  )
}
