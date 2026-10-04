import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'

export default function QrGeneratorTool() {
  const { toast } = useApp()
  const [mode, setMode] = useState('url') // 'url' | 'wifi' | 'text' | 'email' | 'phone'
  const [url, setUrl] = useState('https://example.com')
  const [text, setText] = useState('')
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [wifiEnc, setWifiEnc] = useState('WPA')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [kind, setKind] = useState('png') // 'png' | 'svg'

  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loading, setLoading] = useState(false)

  // Construct payload text based on mode
  const getPayload = () => {
    if (mode === 'url') return url.trim() || 'https://example.com'
    if (mode === 'text') return text.trim() || 'Amethyst'
    if (mode === 'wifi') {
      const p = wifiPass ? `P:${wifiPass};` : ''
      return `WIFI:S:${wifiSsid};T:${wifiEnc};${p};`
    }
    if (mode === 'email') return `mailto:${email.trim()}`
    if (mode === 'phone') return `tel:${phone.trim()}`
    return url
  }

  // Generate QR code whenever payload or format changes
  useEffect(() => {
    const payload = getPayload()
    if (!payload.trim()) return

    let cancelled = false
    setLoading(true)

    const timer = setTimeout(() => {
      api.converterGenerateQR({
        content: payload,
        kind,
        scale: 10,
        border: 2,
      })
        .then((res) => {
          if (!cancelled && res?.data_url) {
            setQrDataUrl(res.data_url)
            setLoading(false)
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('QR generation error:', err)
            setLoading(false)
          }
        })
    }, 150)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [mode, url, text, wifiSsid, wifiPass, wifiEnc, email, phone, kind])

  return (
    <div className="fc-tool-workspace">
      <div className="fc-tool-grid">
        {/* Left: Input options */}
        <div className="fc-tool-panel">
          <div className="flex items-center justify-between">
            <h3 className="fc-panel-title">QR Code Configuration</h3>
            <span className="fc-file-format-badge">VECTOR ENGINE</span>
          </div>
          <p className="fc-panel-desc">Generate high-density, vector-scalable QR codes with instant format export.</p>

          {/* Mode Tabs */}
          <div className="fc-cat-tabs">
            {[
              { id: 'url', label: 'URL / Link', icon: 'link' },
              { id: 'text', label: 'Plain Text', icon: 'type' },
              { id: 'wifi', label: 'Wi-Fi Network', icon: 'wifi' },
              { id: 'email', label: 'Email', icon: 'mail' },
              { id: 'phone', label: 'Phone', icon: 'mobile' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                className={`fc-cat-tab${mode === m.id ? ' is-active' : ''}`}
                onClick={() => setMode(m.id)}
              >
                <Icon name={m.icon} size={13} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* Contextual Form Inputs */}
          <div className="flex flex-col gap-3.5 mt-2">
            {mode === 'url' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                  Target Website URL
                </label>
                <input
                  type="url"
                  className="fc-input font-mono text-sm"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            )}

            {mode === 'text' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                  Raw Text or Note
                </label>
                <textarea
                  rows={4}
                  className="fc-textarea font-mono text-xs"
                  placeholder="Paste or type content here…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            )}

            {mode === 'wifi' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                    Network Name (SSID)
                  </label>
                  <input
                    type="text"
                    className="fc-input"
                    placeholder="MyOfficeWiFi"
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                    Password
                  </label>
                  <input
                    type="text"
                    className="fc-input font-mono"
                    placeholder="WPA2 Password…"
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                    Encryption Security
                  </label>
                  <select
                    className="fc-select"
                    value={wifiEnc}
                    onChange={(e) => setWifiEnc(e.target.value)}
                  >
                    <option value="WPA">WPA / WPA2 / WPA3</option>
                    <option value="WEP">WEP</option>
                    <option value="nopass">None (Open)</option>
                  </select>
                </div>
              </>
            )}

            {mode === 'email' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                  Email Address
                </label>
                <input
                  type="email"
                  className="fc-input"
                  placeholder="hello@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            {mode === 'phone' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                  Phone Number
                </label>
                <input
                  type="tel"
                  className="fc-input"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}

            {/* Format choice */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--fc-border)]">
              <span className="text-xs font-medium text-[var(--fc-text-dim)]">Export format:</span>
              <div className="flex items-center gap-1.5">
                {['png', 'svg'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`fc-cat-tab${kind === f ? ' is-active' : ''}`}
                    onClick={() => setKind(f)}
                  >
                    .{f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Preview & Download */}
        <div className="fc-tool-panel items-center justify-center text-center">
          <div className="flex flex-col items-center gap-4">
            <div className={`p-3.5 rounded-2xl ${qrDataUrl ? 'bg-white shadow-lg' : 'bg-[var(--fc-surface-2)]'} border border-[var(--fc-border)] transition-colors duration-200`}>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR Code Preview"
                  className="w-56 h-56 rounded-xl block"
                />
              ) : (
                <div className="w-56 h-56 rounded-xl flex items-center justify-center text-[var(--fc-text-faint)] font-mono text-xs">
                  {loading ? 'Generating…' : 'Awaiting input'}
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-semibold text-[var(--fc-text)]">
                {kind === 'svg' ? 'Lossless Vector SVG' : 'High-Res Raster PNG'}
              </span>
              <span className="text-[11px] text-[var(--fc-text-faint)] font-mono max-w-xs truncate">
                {getPayload()}
              </span>
            </div>

            <div className="flex items-center gap-2.5 mt-2">
              {qrDataUrl && (
                <>
                  <a
                    href={qrDataUrl}
                    download={`amethyst_qr_${mode}.${kind}`}
                    className="fc-btn fc-btn-primary"
                  >
                    <Icon name="download" size={14} />
                    <span>Download {kind.toUpperCase()}</span>
                  </a>

                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(getPayload())
                      toast('Copied raw QR payload to clipboard!', 'good')
                    }}
                    title="Copy encoded payload"
                  >
                    <Icon name="copy" size={14} />
                    <span>Copy Payload</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
