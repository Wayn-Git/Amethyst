export default function Select({ className = '', loading = false, disabled, ...props }) {
  return <select className={`ui-select ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props} />
}
