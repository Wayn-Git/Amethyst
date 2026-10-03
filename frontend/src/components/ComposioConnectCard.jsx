import Icon from './Icon.jsx'
import ServiceIcon from './ServiceIcon.jsx'

export function extractComposioAuth(content, toolName = '') {
  if (!content) return null
  let url = null
  let app = null

  if (typeof content === 'object') {
    url = content.redirect_url || content.redirectUrl || content.connection_url || content.connect_url || content.url
    app = content.app_name || content.appName || content.toolkit || content.integration
  } else if (typeof content === 'string') {
    const trimmed = content.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const obj = JSON.parse(trimmed)
        if (typeof obj === 'object' && obj !== null) {
          url = obj.redirect_url || obj.redirectUrl || obj.connection_url || obj.connect_url || obj.url
          app = obj.app_name || obj.appName || obj.toolkit || obj.integration
        }
      } catch {}
    }
    if (!url) {
      const match = content.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)?composio\.dev\/[^\s"'>)]+/)
      if (match) url = match[0]
    }
  }

  if (url && (String(url).includes('composio') || String(url).includes('redirect') || String(url).includes('oauth') || String(url).includes('connect'))) {
    if (!app && toolName) {
      const base = toolName.split('__mcp__')[0]
      app = base.split('_')[0]
    }
    return { url, app: app || 'App' }
  }
  return null
}

export default function ComposioConnectCard({ url, app = 'App' }) {
  const formattedApp = app ? app.charAt(0).toUpperCase() + app.slice(1) : 'App'
  return (
    <div
      className="composio-connect-card"
      style={{
        margin: '10px 0',
        padding: '12px 16px',
        borderRadius: '10px',
        border: '1px solid rgba(168, 85, 247, 0.28)',
        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(59, 130, 246, 0.04) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '8px',
            background: 'rgba(168, 85, 247, 0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ServiceIcon name={app.toLowerCase()} size={20} />
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            Authorize {formattedApp}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            Click below to complete authorization in Composio.
          </div>
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="btn btn--small btn--primary"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          padding: '6px 14px',
          fontWeight: 500,
        }}
      >
        <span>Authorize {formattedApp} with Composio</span>
        <Icon name="arrow-up-right" size={13} />
      </a>
    </div>
  )
}
