// Adapted from Wigggle UI's MIT Widget primitive; see vendor/LICENSE.md.
export function Widget({ as: Tag = 'div', className = '', size = 'm', design = 'default', variant = 'default', ...props }) {
  return <Tag className={`wigggle-widget ${className}`} data-wigggle-size={size} data-wigggle-design={design} data-wigggle-variant={variant} {...props} />
}
export function WidgetContent({ className = '', ...props }) { return <div className={`wigggle-content ${className}`} {...props} /> }
