import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'

export default function QrGeneratorTool() {
  const { toast } = useApp()
  const [mode, setMode] = useState('url') // 'url' | 'wifi' | 'text' | 'email' | 'phone'
  const [url, setUrl] = useState('https://justconvert.io')
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
    if (mode === 'url') return url.trim() || 'https://amethyst.local'
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
          <div className="fc-panel-title">QR Code Configuration</div>

          {/* Mode Tabs */}
          <div className="fc-mode-tabs">
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
                className={`fc-mode-tab${mode === m.id ? ' is-active' : ''}`}
                onClick={() => setMode(m.id)}
              >
                <Icon name={m.icon} size={14} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* Contextual Form Inputs */}
          <div className="flex flex-col gap-3 mt-4">
            {mode === 'url' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Website URL</label>
                <input
                  type="url"
                  className="fc-input"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            )}

            {mode === 'text' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Content</label>
                <textarea
                  rows={4}
                  className="fc-textarea"
                  placeholder="Type any message, note, or raw data…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            )}

            {mode === 'wifi' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">Network Name (SSID)</label>
                  <input
                    type="text"
                    className="fc-input"
                    placeholder="e.g. Office_WiFi"
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">Password</label>
                  <input
                    type="text"
                    className="fc-input"
                    placeholder="Wi-Fi Password"
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">Security Type</label>
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
                <label className="text-xs font-medium text-slate-300">Email Address</label>
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
                <label className="text-xs font-medium text-slate-300">Phone Number</label>
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
            <div className="flex items-center gap-3 pt-2">
              <span className="text-xs font-medium text-slate-400">Download format:</span>
              <div className="flex items-center gap-1">
                {['png', 'svg'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`fc-target-chip${kind === f ? ' is-active' : ''}`}
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
          <div className="fc-qr-display-box">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="w-56 h-56 rounded-lg bg-white p-3 shadow-md"
              />
            ) : (
              <div className="w-56 h-56 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                Generating…
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 mt-4">
            {qrDataUrl && (
              <>
                <a
                  href={qrDataUrl}
                  download={`amethyst_qr_${mode}.${kind}`}
                  className="fc-btn fc-btn-primary"
                >
                  <Icon name="download" size={15} />
                  <span>Download QR ({kind.toUpperCase()})</span>
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
                  <Icon name="copy" size={15} />
                  <span>Copy Payload</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
