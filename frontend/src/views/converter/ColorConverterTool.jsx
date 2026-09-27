import { useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useApp } from '../../store.jsx'

// Color math helpers
function hexToRgb(hex) {
  let c = hex.replace('#', '')
  if (c.length === 3) c = c.split('').map((x) => x + x).join('')
  const num = parseInt(c, 16)
  if (isNaN(num) || c.length !== 6) return { r: 113, g: 50, b: 245 }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

function rgbToCmyk(r, g, b) {
  let c = 1 - r / 255
  let m = 1 - g / 255
  let y = 1 - b / 255
  const k = Math.min(c, Math.min(m, y))
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 }
  c = Math.round(((c - k) / (1 - k)) * 100)
  m = Math.round(((m - k) / (1 - k)) * 100)
  y = Math.round(((y - k) / (1 - k)) * 100)
  return { c, m, y, k: Math.round(k * 100) }
}

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

function getContrast(rgb1, rgb2) {
  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b)
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b)
  const brightest = Math.max(lum1, lum2)
  const darkest = Math.min(lum1, lum2)
  return (brightest + 0.05) / (darkest + 0.05)
}

export default function ColorConverterTool() {
  const { toast } = useApp()
  const [hexInput, setHexInput] = useState('#7132F5')

  const rgb = useMemo(() => hexToRgb(hexInput), [hexInput])
  const hsl = useMemo(() => rgbToHsl(rgb.r, rgb.g, rgb.b), [rgb])
  const cmyk = useMemo(() => rgbToCmyk(rgb.r, rgb.g, rgb.b), [rgb])

  const contrastWhite = useMemo(() => getContrast(rgb, { r: 255, g: 255, b: 255 }).toFixed(2), [rgb])
  const contrastBlack = useMemo(() => getContrast(rgb, { r: 0, g: 0, b: 0 }).toFixed(2), [rgb])

  const copyVal = (text, label) => {
    navigator.clipboard.writeText(text)
    toast(`Copied ${label}: ${text}`, 'good')
  }

  // Tonal shades
  const shades = useMemo(() => {
    const list = [15, 30, 45, 60, 75, 90]
    return list.map((l) => {
      // hsl with varying lightness
      return `hsl(${hsl.h}, ${hsl.s}%, ${l}%)`
    })
  }, [hsl])

  return (
    <div className="fc-tool-workspace">
      <div className="fc-tool-grid">
        {/* Left: Color Picker & Formats */}
        <div className="fc-tool-panel">
          <div className="fc-panel-title">Color Formats</div>

          {/* Visual Picker Row */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800 mt-2">
            <input
              type="color"
              value={rgbToHex(rgb.r, rgb.g, rgb.b)}
              onChange={(e) => setHexInput(e.target.value.toUpperCase())}
              className="w-14 h-14 rounded-lg cursor-pointer bg-transparent border-0"
            />
            <div className="flex-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">HEX Code</span>
              <input
                type="text"
                className="fc-input font-mono text-lg font-bold mt-1"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value)}
                placeholder="#000000"
              />
            </div>
          </div>

          {/* Formats List */}
          <div className="flex flex-col gap-2 mt-4">
            {[
              { label: 'HEX', val: rgbToHex(rgb.r, rgb.g, rgb.b).toUpperCase() },
              { label: 'RGB', val: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
              { label: 'HSL', val: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
              { label: 'CMYK', val: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)` },
            ].map((f) => (
              <div
                key={f.label}
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 text-sm"
              >
                <span className="text-xs font-mono font-semibold text-slate-400 w-12">{f.label}</span>
                <span className="font-mono text-white flex-1">{f.val}</span>
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary text-xs h-7 py-0 px-2.5"
                  onClick={() => copyVal(f.val, f.label)}
                >
                  <Icon name="copy" size={13} />
                  <span>Copy</span>
                </button>
              </div>
            ))}
          </div>

          {/* Color Swatch Shades */}
          <div className="flex flex-col gap-2 mt-4">
            <span className="text-xs font-medium text-slate-400">Tonal Shades:</span>
            <div className="grid grid-cols-6 gap-2">
              {shades.map((color, i) => (
                <div
                  key={i}
                  className="h-8 rounded-md cursor-pointer hover:scale-105 transition"
                  style={{ backgroundColor: color }}
                  title={color}
                  onClick={() => copyVal(color, 'Shade')}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: Contrast Analysis */}
        <div className="fc-tool-panel">
          <div className="fc-panel-title">Accessibility & Contrast Check</div>

          <div
            className="w-full h-32 rounded-xl flex items-center justify-center p-4 mt-2 transition"
            style={{ backgroundColor: hexInput }}
          >
            <span
              className="text-lg font-bold transition"
              style={{ color: Number(contrastWhite) > 4.5 ? '#ffffff' : '#000000' }}
            >
              Readable Text Sample
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            {/* White Text */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-400">On White Text</span>
              <div className="text-xl font-bold font-mono text-white">{contrastWhite} : 1</div>
              <span
                className={`text-xs font-semibold ${
                  Number(contrastWhite) >= 4.5 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {Number(contrastWhite) >= 4.5 ? '✓ PASS (WCAG AA)' : '✕ FAIL (< 4.5)'}
              </span>
            </div>

            {/* Black Text */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-400">On Black Text</span>
              <div className="text-xl font-bold font-mono text-white">{contrastBlack} : 1</div>
              <span
                className={`text-xs font-semibold ${
                  Number(contrastBlack) >= 4.5 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {Number(contrastBlack) >= 4.5 ? '✓ PASS (WCAG AA)' : '✕ FAIL (< 4.5)'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
