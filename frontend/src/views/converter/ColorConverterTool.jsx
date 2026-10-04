import { useMemo, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import Icon from '../../components/Icon.jsx'
import { useApp } from '../../store.jsx'

// Color math helpers
function hexToRgb(hex) {
  let c = (hex || '#7132F5').replace('#', '')
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
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase()
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
    return list.map((l) => `hsl(${hsl.h}, ${hsl.s}%, ${l}%)`)
  }, [hsl])

  return (
    <div className="fc-tool-workspace">
      <div className="fc-tool-grid">
        {/* Left: Interactive Visual Picker & Formats */}
        <div className="fc-tool-panel">
          <div className="flex items-center justify-between">
            <h3 className="fc-panel-title">Color Formats & Transforms</h3>
            <span className="fc-file-format-badge">{hexInput.toUpperCase()}</span>
          </div>
          <p className="fc-panel-desc">Interactive visual spectrum picker with precision mathematical transforms.</p>

          {/* react-colorful visual picker container */}
          <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-xl bg-[var(--fc-surface-2)] border border-[var(--fc-border)]">
            <div className="custom-color-picker-wrap">
              <HexColorPicker color={hexInput} onChange={(c) => setHexInput(c.toUpperCase())} />
            </div>

            <div className="flex-1 w-full flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-xl border border-[var(--fc-border)] shadow-sm shrink-0"
                  style={{ backgroundColor: hexInput }}
                />
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider block">
                    HEX Code
                  </label>
                  <input
                    type="text"
                    className="fc-input font-mono font-bold mt-1 text-sm uppercase"
                    value={hexInput}
                    onChange={(e) => setHexInput(e.target.value)}
                    placeholder="#7132F5"
                  />
                </div>
              </div>

              {/* Tonal Shades Swatches */}
              <div className="flex flex-col gap-1.5 mt-2">
                <span className="text-[11px] font-semibold text-[var(--fc-text-faint)] uppercase tracking-wider">
                  Harmonic Shades:
                </span>
                <div className="grid grid-cols-6 gap-2">
                  {shades.map((color, i) => (
                    <div
                      key={i}
                      className="h-8 rounded-lg cursor-pointer hover:scale-105 active:scale-95 transition-transform border border-[var(--fc-border)] shadow-xs"
                      style={{ backgroundColor: color }}
                      title={`Copy ${color}`}
                      onClick={() => copyVal(color, 'Shade')}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Formats List */}
          <div className="flex flex-col gap-2 mt-2">
            {[
              { label: 'HEX', val: rgbToHex(rgb.r, rgb.g, rgb.b) },
              { label: 'RGB', val: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
              { label: 'HSL', val: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
              { label: 'CMYK', val: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)` },
            ].map((f) => (
              <div
                key={f.label}
                className="flex items-center justify-between p-2.5 px-3.5 rounded-xl bg-[var(--fc-surface-2)] border border-[var(--fc-border)] text-sm"
              >
                <span className="text-xs font-mono font-bold text-[var(--fc-text-dim)] w-12">{f.label}</span>
                <span className="font-mono text-[var(--fc-text)] font-medium flex-1 text-xs">{f.val}</span>
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary text-xs h-7 py-0 px-2.5"
                  onClick={() => copyVal(f.val, f.label)}
                >
                  <Icon name="copy" size={12} />
                  <span>Copy</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Accessibility & Contrast Studio */}
        <div className="fc-tool-panel">
          <div className="flex items-center justify-between">
            <h3 className="fc-panel-title">Accessibility & Contrast</h3>
            <span className="text-xs font-mono text-[var(--fc-text-dim)]">WCAG 2.1 Standard</span>
          </div>
          <p className="fc-panel-desc">Real-time legibility ratio analysis against light and dark grounds.</p>

          {/* Live Text Preview Box */}
          <div
            className="w-full h-36 rounded-2xl flex flex-col items-center justify-center p-6 transition-colors shadow-inner border border-[var(--fc-border)]"
            style={{ backgroundColor: hexInput }}
          >
            <span
              className="text-lg font-bold tracking-tight transition-colors"
              style={{ color: Number(contrastWhite) > 4.5 ? '#ffffff' : '#000000' }}
            >
              The quick brown fox jumps
            </span>
            <span
              className="text-xs font-medium opacity-85 mt-1 transition-colors"
              style={{ color: Number(contrastWhite) > 4.5 ? '#ffffff' : '#000000' }}
            >
              Over the lazy dog · 14px Sample
            </span>
          </div>

          {/* Dual Ground Matrix */}
          <div className="grid grid-cols-2 gap-3 mt-1">
            {/* White Ground */}
            <div className="p-3.5 rounded-xl bg-[var(--fc-surface-2)] border border-[var(--fc-border)] flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                Against White
              </span>
              <div className="text-2xl font-bold font-mono text-[var(--fc-text)]">
                {contrastWhite} <span className="text-xs font-normal text-[var(--fc-text-dim)]">: 1</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                    Number(contrastWhite) >= 7.0
                      ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/25'
                      : Number(contrastWhite) >= 4.5
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                  }`}
                >
                  {Number(contrastWhite) >= 7.0
                    ? '✓ PASS (AAA)'
                    : Number(contrastWhite) >= 4.5
                    ? '✓ PASS (AA)'
                    : '✕ FAIL (< 4.5)'}
                </span>
              </div>
            </div>

            {/* Black Ground */}
            <div className="p-3.5 rounded-xl bg-[var(--fc-surface-2)] border border-[var(--fc-border)] flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">
                Against Black
              </span>
              <div className="text-2xl font-bold font-mono text-[var(--fc-text)]">
                {contrastBlack} <span className="text-xs font-normal text-[var(--fc-text-dim)]">: 1</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                    Number(contrastBlack) >= 7.0
                      ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/25'
                      : Number(contrastBlack) >= 4.5
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                  }`}
                >
                  {Number(contrastBlack) >= 7.0
                    ? '✓ PASS (AAA)'
                    : Number(contrastBlack) >= 4.5
                    ? '✓ PASS (AA)'
                    : '✕ FAIL (< 4.5)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
