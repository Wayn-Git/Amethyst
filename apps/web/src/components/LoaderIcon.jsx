import React from 'react'

export function LoaderIcon({ type }) {
  switch (type) {
    case 'pixels':
      return (
        <span className="ld-pixels">
          <i /><i /><i />
          <i /><i /><i />
        </span>
      )
    case 'halo':
      return <span className="ld-halo" />
    case 'orbit':
      return (
        <span className="ld-orbit">
          <i /><i /><i />
        </span>
      )
    case 'wake':
      return (
        <span className="ld-wake">
          <i /><i /><i />
        </span>
      )
    case 'pulse':
      return (
        <span className="ld-pulse">
          <i /><i /><i /><i />
        </span>
      )
    case 'shift':
      return (
        <span className="ld-shift">
          <i />
        </span>
      )
    case 'ellipsis':
      return (
        <span className="ld-ellipsis">
          <i /><i /><i />
        </span>
      )
    case 'ripple':
      return (
        <span className="ld-ripple">
          <i /><i />
        </span>
      )
    case 'clock':
      return (
        <span className="ld-clock">
          <i />
        </span>
      )
    case 'drop':
      return (
        <span className="ld-drop">
          <i />
        </span>
      )
    case 'scanner':
      return (
        <span className="ld-scanner">
          <i />
        </span>
      )
    case 'card':
      return (
        <span className="ld-card">
          <i />
        </span>
      )
    case 'dial':
      return <span className="ld-dial" />
    case 'beacon':
      return (
        <span className="ld-beacon">
          <i />
        </span>
      )
    case 'duet':
      return (
        <span className="ld-duet">
          <i /><i />
        </span>
      )
    case 'tumble':
      return (
        <span className="ld-tumble">
          <i />
        </span>
      )
    default:
      return (
        <span className="ld-pixels">
          <i /><i /><i />
          <i /><i /><i />
        </span>
      )
  }
}

export default LoaderIcon
