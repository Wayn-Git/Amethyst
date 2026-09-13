import { useState } from 'react'
import Icon from '../Icon.jsx'
import { copyText } from '../../api.js'

/* Source beside target, and a copy button on the half people actually want.
 *
 * Copy is the entire reason this is a widget: the translation is one selection
 * away in prose too, but selecting it out of a sentence that also explains it is
 * the bit that is annoying. */

export default function Translation({ data }) {
  const [done, setDone] = useState(false)

  return (
    <div className="widget widget-translation">
      <div className="widget-pane">
        <span className="widget-lang">{data.source_language}</span>
        <p>{data.source}</p>
      </div>
      <div className="widget-pane is-target">
        <span className="widget-lang">{data.target_language}</span>
        <p>{data.translation}</p>
        <button
          type="button"
          className="msg-copy"
          title="Copy translation"
          aria-label="Copy translation"
          onClick={async () => {
            setDone(await copyText(data.translation) ? 'ok' : 'no')
            setTimeout(() => setDone(false), 1500)
          }}
        >
          <Icon name={done === 'ok' ? 'check' : done === 'no' ? 'x' : 'copy'} size={13} />
        </button>
      </div>
    </div>
  )
}
