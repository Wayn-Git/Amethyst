import Icon from '../Icon.jsx'

/** Modern error state card with subtle luminous accent and clear recovery action. */
export default function ErrorState({
  title = 'Unable to load content',
  message,
  onRetry,
  retryLabel = 'Try again',
}) {
  return (
    <div className="amethyst-error-box" role="alert">
      <div className="amethyst-error-icon-wrap">
        <Icon name="alert" size={20} className="amethyst-error-icon" />
      </div>
      <div className="amethyst-error-body">
        <h3 className="amethyst-error-title">{title}</h3>
        {message && <p className="amethyst-error-message">{message}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          className="btn btn--small amethyst-error-action"
          onClick={onRetry}
        >
          <Icon name="refresh" size={13} />
          <span>{retryLabel}</span>
        </button>
      )}
    </div>
  )
}
