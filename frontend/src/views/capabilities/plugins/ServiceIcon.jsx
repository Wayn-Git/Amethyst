import { useState } from 'react'

export default function ServiceIcon({ card, size = 'default' }) {
  // stage: 0 = official logo, 1 = domain favicon, 2 = letter monogram
  const [stage, setStage] = useState(card?.logo ? 0 : card?.domain ? 1 : 2)

  const sizeClass = size === 'large' ? 'is-large' : size === 'small' ? 'is-small' : ''

  if (stage === 0 && card?.logo) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={card.logo}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(card.domain ? 1 : 2)}
        />
      </div>
    )
  }

  if (stage === 1 && card?.domain) {
    return (
      <div className={`plugin-squircle-icon-box ${sizeClass}`}>
        <img
          src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=128`}
          alt=""
          loading="lazy"
          className="plugin-squircle-icon-img"
          onError={() => setStage(2)}
        />
      </div>
    )
  }

  const letter = (card?.label || card?.name || card?.slug || '?').slice(0, 1).toUpperCase()
  return (
    <div className={`plugin-squircle-icon-box ${sizeClass}`}>
      <span className="plugin-squircle-icon-monogram">{letter}</span>
    </div>
  )
}
