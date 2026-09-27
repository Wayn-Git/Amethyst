import { useCallback, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import { AnimatePresence, motion } from 'framer-motion'

export default function OcrTool() {
  const { toast } = useApp()
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [filePreview, setFilePreview] = useState(null)
  const [extractedText, setExtractedText] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return
    setFile(selectedFile)
    setExtractedText('')

    if (selectedFile.type.startsWith('image/')) {
      setFilePreview(URL.createObjectURL(selectedFile))
    } else {
      setFilePreview(null)
    }

    // Automatically trigger extraction
    executeExtraction(selectedFile)
  }

  const executeExtraction = async (targetFile) => {
    const f = targetFile || file
    if (!f) {
      toast('Please select a file to extract text from', 'bad')
      return
    }

    setLoading(true)
    try {
      // 1. Upload file
      const up = await api.converterUpload([f])
      const fileId = up.uploaded[0]?.file_id
      if (!fileId) throw new Error('Upload failed')

      // 2. Call backend extract_text
      const res = await api.converterProcess({
        file_id: fileId,
        operation: 'extract_text',
      })

      if (res.preview_text) {
        setExtractedText(res.preview_text)
        toast('Text successfully extracted!', 'good')
      } else {
        // Fallback: fetch downloaded text file if preview_text is omitted
        const textRes = await fetch(api.converterDownloadUrl(res.job_id))
        const textContent = await textRes.text()
        setExtractedText(textContent)
        toast('Text successfully extracted!', 'good')
      }
    } catch (err) {
      console.error(err)
      toast(`Extraction failed: ${err.message}`, 'bad')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (!extractedText) return
    navigator.clipboard.writeText(extractedText)
    setCopied(true)
    toast('Copied extracted text to clipboard!', 'good')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (!extractedText) return
    const blob = new Blob([extractedText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${file ? file.name.replace(/\.[^/.]+$/, '') : 'extracted'}_ocr.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const wordCount = extractedText.trim() ? extractedText.trim().split(/\s+/).length : 0
  const charCount = extractedText.length
  const lineCount = extractedText ? extractedText.split('\n').length : 0

  return (
    <div className="fc-tool-workspace">
      <div className="fc-tool-grid">
        {/* Left Panel: Dropzone & File Details */}
        <div className="fc-tool-panel flex flex-col justify-between">
          <div>
            <div className="fc-panel-title mb-1">OCR & Text Extractor</div>
            <p className="fc-panel-desc mb-4">
              Extract clean readable text from images (PNG, JPG), PDF documents, Word (DOCX), and Excel spreadsheets.
            </p>

            <div
              className="fc-dropzone-shell cursor-pointer mb-4"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="fc-dropzone-core py-10">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.docx,.xlsx,.txt,.csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleFileSelect(e.target.files[0])
                      e.target.value = ''
                    }
                  }}
                />
                <Icon name="type" size={28} className="text-violet-400" />
                <span className="text-sm font-semibold text-white">
                  {file ? file.name : 'Upload Image or Document'}
                </span>
                <span className="text-xs text-slate-400">
                  PDF, DOCX, XLSX, PNG, JPG up to 500 MB
                </span>
              </div>
            </div>

            {file && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 text-xs mb-4">
                <span className="truncate max-w-[220px] font-semibold text-white">{file.name}</span>
                <button
                  type="button"
                  className="fc-btn fc-btn-danger-ghost text-xs"
                  onClick={() => {
                    setFile(null)
                    setFilePreview(null)
                    setExtractedText('')
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            {filePreview && (
              <div className="p-2 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center max-h-48 overflow-hidden">
                <img src={filePreview} alt="Preview" className="max-h-44 object-contain rounded" />
              </div>
            )}
          </div>

          <button
            type="button"
            className="fc-btn fc-btn-primary w-full mt-4"
            disabled={loading || !file}
            onClick={() => executeExtraction()}
          >
            <Icon name="convert" size={16} />
            <span>{loading ? 'Extracting Text Content…' : 'Re-extract Text'}</span>
          </button>
        </div>

        {/* Right Panel: Extracted Output */}
        <div className="fc-tool-panel flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="fc-panel-title">Extracted Text</div>
              {extractedText && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary text-xs h-8 py-0"
                    onClick={handleCopy}
                  >
                    <Icon name={copied ? 'check' : 'copy'} size={14} />
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    className="fc-btn fc-btn-primary text-xs h-8 py-0"
                    onClick={handleDownload}
                  >
                    <Icon name="download" size={14} />
                    <span>Download .txt</span>
                  </button>
                </div>
              )}
            </div>

            {/* Metrics Row */}
            <div className="flex items-center gap-4 py-2.5 text-xs text-slate-400 font-mono border-b border-white/5 mb-3">
              <span>{wordCount} words</span>
              <span>·</span>
              <span>{charCount} characters</span>
              <span>·</span>
              <span>{lineCount} lines</span>
            </div>

            {/* Textarea View */}
            <div className="relative">
              {loading && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center rounded-xl z-10">
                  <div className="flex items-center gap-2 text-violet-400 text-sm font-semibold">
                    <span className="fc-local-dot animate-ping" />
                    <span>Extracting readable text…</span>
                  </div>
                </div>
              )}
              <textarea
                readOnly
                rows={14}
                className="fc-textarea font-mono text-xs leading-relaxed w-full bg-black/30"
                placeholder="Extracted document or image text will appear here automatically…"
                value={extractedText}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
