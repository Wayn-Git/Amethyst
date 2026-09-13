import { Component } from 'react'

/* A render failure in one view must not take the window with it.

   Without this, a malformed message or a null field somewhere deep in the
   transcript unmounts the whole tree and leaves a blank page with the reason
   only in the console -- the one place a user will not look. */

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[amethyst] render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    const msg = String(this.state.error?.message || this.state.error)
    const isChunkError =
      msg.toLowerCase().includes('module script') ||
      msg.toLowerCase().includes('dynamically imported module') ||
      msg.toLowerCase().includes('loading chunk')

    return (
      <div className="crash">
        <h2>{isChunkError ? 'A new version of AMETHYST is ready.' : 'That view stopped rendering.'}</h2>
        <p className="crash-detail">
          {isChunkError
            ? 'The application bundle was updated. Reloading will load the latest interface.'
            : msg}
        </p>
        <div className="crash-actions">
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload application
          </button>
          {!isChunkError && (
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          )}
        </div>
        <p className="crash-note">
          Your conversations are on the server, not in this page — nothing was lost.
        </p>
      </div>
    )
  }
}
