import { useCallback, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import { AnimatePresence, motion } from 'framer-motion'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

const PRESETS = [
  { label: 'Instagram Square (1080×1080)', width: 1080, height: 1080 },
  { label: 'Instagram Story (1080×1920)', width: 1080, height: 1920 },
  { label: 'Twitter/X Header (1500×500)', width: 1500, height: 500 },
  { label: 'YouTube Thumbnail (1280×720)', width: 1280, height: 720 },
  { label: 'Favicon (32×32)', width: 32, height: 32 },
  { label: 'HD 1080p (1920×1080)', width: 1920, height: 1080 },
]

export default function ImageResizerTool() {
  const { toast } = useApp()
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [filePreview, setFilePreview] = useState(null)
  const [origDimensions, setOrigDimensions] = useState({ width: 0, height: 0 })
  const [isDragging, setIsDragging] = useState(false)

  // Resize controls
  const [mode, setMode] = useState('dimensions') // 'dimensions' | 'percentage' | 'preset'
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [lockAspectRatio, setLockAspectRatio] = useState(true)
  const [percentage, setPercentage] = useState(50)
  const [quality, setQuality] = useState(85)
  const [targetFormat, setTargetFormat] = useState('png')
  const [grayscale, setGrayscale] = useState(false)
  const [rotateAngle, setRotateAngle] = useState(0)

  // Status
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      toast('Please select a valid image file (PNG, JPG, WebP, etc.)', 'bad')
      return
    }

    setFile(selectedFile)
    setResult(null)

    const objectUrl = URL.createObjectURL(selectedFile)
    setFilePreview(objectUrl)

    const img = new Image()
    img.onload = () => {
      setOrigDimensions({ width: img.naturalWidth, height: img.naturalHeight })
      setWidth(img.naturalWidth)
      setHeight(img.naturalHeight)
    }
    img.src = objectUrl

    // Set default target format to original ext if supported
    const ext = selectedFile.name.split('.').pop()?.toLowerCase() || 'png'
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'].includes(ext)) {
      setTargetFormat(ext === 'jpeg' ? 'jpg' : ext)
    } else {
      setTargetFormat('png')
    }
  }

  const handleWidthChange = (val) => {
    setWidth(val)
    if (lockAspectRatio && origDimensions.width > 0 && origDimensions.height > 0 && val) {
      const ratio = origDimensions.height / origDimensions.width
      setHeight(Math.round(val * ratio))
    }
  }

  const handleHeightChange = (val) => {
    setHeight(val)
    if (lockAspectRatio && origDimensions.width > 0 && origDimensions.height > 0 && val) {
      const ratio = origDimensions.width / origDimensions.height
      setWidth(Math.round(val * ratio))
    }
  }

  const applyPreset = (preset) => {
    setWidth(preset.width)
    setHeight(preset.height)
  }

  const handleProcess = async () => {
    if (!file) {
      toast('Please upload an image first', 'bad')
      return
    }

    setProcessing(true)
    try {
      // 1. Upload image
      const up = await api.converterUpload([file])
      const fileId = up.uploaded[0]?.file_id
      if (!fileId) throw new Error('Upload failed')

      // 2. Perform resize / compression
      const options = {
        quality,
        width: mode === 'dimensions' || mode === 'preset' ? width : '',
        height: mode === 'dimensions' || mode === 'preset' ? height : '',
        percentage: mode === 'percentage' ? percentage : '',
        angle: rotateAngle,
      }

      // If grayscale is requested or format is different, operation is resize
      const res = await api.converterProcess({
        file_id: fileId,
        operation: 'resize',
        target_format: targetFormat,
        options,
      })

      setResult(res)
      toast('Image successfully resized and processed!', 'good')
    } catch (err) {
      console.error(err)
      toast(`Resize failed: ${err.message}`, 'bad')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="fc-tool-workspace">
      {!file ? (
        <div
          className={`fc-dropzone-shell${isDragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer?.files?.[0]) {
              handleFileSelect(e.dataTransfer.files[0])
            }
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="fc-dropzone-core">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFileSelect(e.target.files[0])
                  e.target.value = ''
                }
              }}
            />
            <div className="fc-drop-featured-icon">
              <Icon name="image" size={26} />
            </div>
            <div className="fc-drop-prompt-group">
              <h2 className="fc-drop-heading">
                {isDragging ? 'Release to resize image' : 'Drop your image here, or click to browse'}
              </h2>
              <p className="fc-drop-subtext">
                Lossless resizing, format transcoding, and WebP compression · 100% on-device
              </p>
            </div>
            <div className="fc-drop-format-tags">
              {['JPG', 'PNG', 'WEBP', 'AVIF', 'GIF', 'TIFF', 'BMP'].map((fmt) => (
                <span key={fmt} className="fc-format-tag-pill">.{fmt}</span>
              ))}
            </div>
            <div className="fc-drop-action-row">
              <button
                type="button"
                className="fc-btn fc-btn-primary fc-btn-pill"
                onClick={(e) => {
                  e.stopPropagation()
                  fileInputRef.current?.click()
                }}
              >
                <span>Select Image</span>
                <span className="fc-btn-icon-bubble">
                  <Icon name="arrow-right" size={13} />
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="fc-tool-grid">
          {/* Left Panel: Resizing and Quality Controls */}
          <div className="fc-tool-panel">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--fc-border)]">
              <div className="fc-panel-title">Resizer & Compressor Settings</div>
              <button
                type="button"
                className="fc-btn fc-btn-danger-ghost text-xs"
                onClick={() => {
                  setFile(null)
                  setFilePreview(null)
                  setResult(null)
                }}
              >
                <Icon name="trash" size={14} />
                <span>Change Image</span>
              </button>
            </div>

            {/* Resize Mode Selector */}
            <div className="flex flex-col gap-2 mt-4">
              <label className="text-xs font-semibold text-[var(--fc-text)]">Resize By</label>
              <div className="fc-mode-tabs">
                {[
                  { id: 'dimensions', label: 'Dimensions (px)' },
                  { id: 'percentage', label: 'Percentage (%)' },
                  { id: 'preset', label: 'Social Presets' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`fc-mode-tab${mode === m.id ? ' is-active' : ''}`}
                    onClick={() => setMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode: Dimensions */}
            {mode === 'dimensions' && (
              <div className="flex flex-col gap-3 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--fc-text-dim)]">Width (px)</label>
                    <input
                      type="number"
                      min="1"
                      className="fc-input font-mono"
                      value={width}
                      onChange={(e) => handleWidthChange(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--fc-text-dim)]">Height (px)</label>
                    <input
                      type="number"
                      min="1"
                      className="fc-input font-mono"
                      value={height}
                      onChange={(e) => handleHeightChange(Number(e.target.value))}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--fc-text)] mt-1">
                  <input
                    type="checkbox"
                    checked={lockAspectRatio}
                    onChange={(e) => setLockAspectRatio(e.target.checked)}
                    className="rounded accent-[var(--fc-accent)]"
                  />
                  <span>Lock Aspect Ratio ({origDimensions.width}×{origDimensions.height})</span>
                </label>
              </div>
            )}

            {/* Mode: Percentage */}
            {mode === 'percentage' && (
              <div className="flex flex-col gap-3 mt-4">
                <div className="flex items-center justify-between text-xs text-[var(--fc-text)]">
                  <span>Scale Percentage</span>
                  <span className="font-mono font-semibold text-[var(--fc-accent)]">{percentage}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="200"
                  step="5"
                  value={percentage}
                  onChange={(e) => setPercentage(Number(e.target.value))}
                  className="fc-range-slider w-full"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  {[25, 50, 75, 100, 150, 200].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className={`px-2.5 py-1 text-xs rounded-md border font-mono transition ${
                        percentage === pct
                          ? 'bg-[var(--fc-accent)] border-[var(--fc-accent-line)] text-white'
                          : 'bg-[var(--fc-surface-2)] border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[var(--fc-surface-3)]'
                      }`}
                      onClick={() => setPercentage(pct)}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Mode: Presets */}
            {mode === 'preset' && (
              <div className="flex flex-col gap-2 mt-4">
                <label className="text-xs font-medium text-[var(--fc-text-dim)]">Standard Sizes</label>
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={`text-left p-2 rounded-lg text-xs border transition ${
                        width === p.width && height === p.height
                          ? 'bg-[var(--fc-accent-wash)] border-[var(--fc-accent-soft)] text-[var(--fc-accent)]'
                          : 'bg-[var(--fc-surface-2)] border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[var(--fc-surface-3)]'
                      }`}
                      onClick={() => applyPreset(p)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quality & Output Format */}
            <div className="flex flex-col gap-3 mt-5 pt-4 border-t border-[var(--fc-border)]">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--fc-text-dim)]">Output Format</label>
                  <select
                    className="fc-select font-mono uppercase"
                    value={targetFormat}
                    onChange={(e) => setTargetFormat(e.target.value)}
                  >
                    <option value="png">PNG</option>
                    <option value="jpg">JPG</option>
                    <option value="webp">WebP</option>
                    <option value="avif">AVIF</option>
                    <option value="ico">ICO</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs font-medium text-[var(--fc-text)]">
                    <span>Quality</span>
                    <span className="font-mono text-[var(--fc-accent)]">{quality}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="fc-range-slider w-full mt-2"
                  />
                </div>
              </div>

              {/* Rotation & Grayscale */}
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--fc-text-dim)]">Rotation</label>
                  <select
                    className="fc-select"
                    value={rotateAngle}
                    onChange={(e) => setRotateAngle(Number(e.target.value))}
                  >
                    <option value="0">None (0°)</option>
                    <option value="90">90° Clockwise</option>
                    <option value="180">180° Half turn</option>
                    <option value="270">270° Counter-clockwise</option>
                  </select>
                </div>

                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--fc-text)]">
                    <input
                      type="checkbox"
                      checked={grayscale}
                      onChange={(e) => setGrayscale(e.target.checked)}
                      className="rounded accent-[var(--fc-accent)]"
                    />
                    <span>Convert to Grayscale</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Execute Button */}
            <button
              type="button"
              className="fc-btn fc-btn-primary w-full mt-6 py-2.5 h-auto text-sm"
              disabled={processing}
              onClick={handleProcess}
            >
              <Icon name="convert" size={16} />
              <span>{processing ? 'Processing Image…' : 'Resize & Optimize Image'}</span>
            </button>
          </div>

          {/* Right Panel: Preview & Result */}
          <div className="fc-tool-panel flex flex-col justify-between">
            <div>
              <div className="fc-panel-title mb-3">Image Preview</div>
              <div className="p-3 rounded-xl bg-[var(--fc-surface-2)] border border-[var(--fc-border)] flex flex-col items-center justify-center min-h-[260px] overflow-hidden">
                {filePreview && (
                  <img
                    src={filePreview}
                    alt="Preview"
                    className="max-h-64 object-contain rounded-lg shadow-md"
                  />
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-[var(--fc-text-faint)] mt-3 px-1">
                <span className="font-semibold text-[var(--fc-text)]">{file.name}</span>
                <span className="font-mono">
                  {origDimensions.width}×{origDimensions.height} px · {formatBytes(file.size)}
                </span>
              </div>
            </div>

            {/* Processing Result */}
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                    <Icon name="check-circle" size={18} />
                    <span>Processed Successfully!</span>
                  </div>
                  <span className="text-xs font-mono text-emerald-400">
                    {(result.elapsed_ms / 1000).toFixed(2)}s
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-[var(--fc-text)]">
                  <span>New file size:</span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-semibold text-emerald-400">{formatBytes(result.size)}</span>
                    {file.size > 0 && (
                      <span className="text-[var(--fc-text-dim)]">
                        ({Math.round(((result.size - file.size) / file.size) * 100)}%)
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <a
                    href={api.converterDownloadUrl(result.job_id)}
                    download={result.filename}
                    className="fc-btn fc-btn-success flex-1"
                  >
                    <Icon name="download" size={15} />
                    <span>Download Resized Image</span>
                  </a>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
