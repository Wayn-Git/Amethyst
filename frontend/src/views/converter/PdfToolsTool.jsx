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

export default function PdfToolsTool() {
  const { toast } = useApp()
  const [activeTab, setActiveTab] = useState('merge') // 'merge' | 'split' | 'compress' | 'to-images' | 'from-images' | 'to-word'

  // Multi-file merge queue
  const [mergeFiles, setMergeFiles] = useState([])
  const mergeInputRef = useRef(null)

  // Single file state (for split, compress, to-images, to-word)
  const [singleFile, setSingleFile] = useState(null)
  const singleInputRef = useRef(null)
  const [pageRange, setPageRange] = useState('1-3')
  const [imgFmt, setImgFmt] = useState('png')

  // Images to PDF state
  const [imageFiles, setImageFiles] = useState([])
  const imagesInputRef = useRef(null)

  // Progress & results
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)

  // 1. Handlers for Merge
  const handleAddMergeFiles = (files) => {
    const valid = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )
    if (valid.length === 0) {
      toast('Please upload valid PDF files', 'bad')
      return
    }
    setMergeFiles((prev) => [...prev, ...valid])
    setResult(null)
  }

  const removeMergeFile = (index) => {
    setMergeFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const moveMergeFile = (index, dir) => {
    setMergeFiles((prev) => {
      const arr = [...prev]
      const target = index + dir
      if (target < 0 || target >= arr.length) return arr
      const temp = arr[index]
      arr[index] = arr[target]
      arr[target] = temp
      return arr
    })
  }

  const handleExecuteMerge = async () => {
    if (mergeFiles.length < 2) {
      toast('Please add at least 2 PDF files to merge', 'bad')
      return
    }

    setProcessing(true)
    try {
      const up = await api.converterUpload(mergeFiles)
      const fileIds = up.uploaded.map((u) => u.file_id)

      const res = await api.converterProcess({
        file_ids: fileIds,
        operation: 'pdf_merge',
        options: { output_name: 'merged_document.pdf' },
      })

      setResult(res)
      toast('PDFs merged successfully!', 'good')
    } catch (err) {
      console.error(err)
      toast(`Merge failed: ${err.message}`, 'bad')
    } finally {
      setProcessing(false)
    }
  }

  // 2. Handlers for Single PDF Tools (Split, Compress, To-Images, To-Word)
  const handleSingleSelect = (file) => {
    if (!file || (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) {
      toast('Please select a PDF file', 'bad')
      return
    }
    setSingleFile(file)
    setResult(null)
  }

  const handleExecuteSingle = async () => {
    if (!singleFile) {
      toast('Please select a PDF file', 'bad')
      return
    }

    setProcessing(true)
    try {
      const up = await api.converterUpload([singleFile])
      const fileId = up.uploaded[0]?.file_id
      if (!fileId) throw new Error('Upload failed')

      let op = 'pdf_compress'
      let targetFormat = 'pdf'
      let options = {}

      if (activeTab === 'split') {
        op = 'pdf_extract_pages'
        options = { pages: pageRange || '1' }
      } else if (activeTab === 'compress') {
        op = 'pdf_compress'
      } else if (activeTab === 'to-images') {
        op = 'pdf_to_images'
        options = { format: imgFmt }
      } else if (activeTab === 'to-word') {
        op = 'convert'
        targetFormat = 'docx'
      }

      const res = await api.converterProcess({
        file_id: fileId,
        operation: op,
        target_format: targetFormat,
        options,
      })

      setResult(res)
      toast('Operation completed successfully!', 'good')
    } catch (err) {
      console.error(err)
      toast(`Operation failed: ${err.message}`, 'bad')
    } finally {
      setProcessing(false)
    }
  }

  // 3. Handlers for Images to PDF
  const handleAddImages = (files) => {
    const valid = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (valid.length === 0) {
      toast('Please select valid images (PNG, JPG, etc.)', 'bad')
      return
    }
    setImageFiles((prev) => [...prev, ...valid])
    setResult(null)
  }

  const handleExecuteImagesToPdf = async () => {
    if (imageFiles.length === 0) {
      toast('Please add at least 1 image', 'bad')
      return
    }

    setProcessing(true)
    try {
      const up = await api.converterUpload(imageFiles)
      const fileIds = up.uploaded.map((u) => u.file_id)

      const res = await api.converterProcess({
        file_ids: fileIds,
        operation: 'images_to_pdf',
        options: { output_name: 'combined_images.pdf' },
      })

      setResult(res)
      toast('Images combined into PDF successfully!', 'good')
    } catch (err) {
      console.error(err)
      toast(`Failed: ${err.message}`, 'bad')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="fc-tool-workspace">
      {/* PDF Sub-tool Navigation Tabs */}
      <div className="fc-cat-tabs mb-6">
        {[
          { id: 'merge', label: 'Merge PDFs', icon: 'layers' },
          { id: 'split', label: 'Split & Extract Pages', icon: 'file' },
          { id: 'compress', label: 'Compress PDF', icon: 'arrow-down' },
          { id: 'to-images', label: 'PDF to Images', icon: 'image' },
          { id: 'from-images', label: 'Images to PDF', icon: 'image' },
          { id: 'to-word', label: 'PDF to Word (DOCX)', icon: 'book' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`fc-cat-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTab(tab.id)
              setResult(null)
            }}
          >
            <Icon name={tab.icon} size={15} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 1. Merge PDFs View */}
      {activeTab === 'merge' && (
        <div className="fc-tool-grid">
          <div className="fc-tool-panel">
            <div className="fc-panel-title mb-1">Merge Multiple PDFs</div>
            <p className="fc-panel-desc mb-4">
              Combine multiple PDF documents into a single unified file. Drag or reorder documents below.
            </p>

            <div
              className="fc-dropzone-shell cursor-pointer mb-4"
              onClick={() => mergeInputRef.current?.click()}
            >
              <div className="fc-dropzone-core py-8">
                <input
                  ref={mergeInputRef}
                  type="file"
                  multiple
                  accept=".pdf,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      handleAddMergeFiles(e.target.files)
                      e.target.value = ''
                    }
                  }}
                />
                <Icon name="upload" size={24} className="text-violet-400" />
                <span className="text-sm font-semibold text-white">Click to add PDF documents</span>
                <span className="text-xs text-slate-400">Select 2 or more PDFs</span>
              </div>
            </div>

            {mergeFiles.length > 0 && (
              <div className="flex flex-col gap-2 mb-4 max-h-72 overflow-y-auto pr-1">
                {mergeFiles.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 border border-white/5 text-xs text-slate-200"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-violet-400 w-5">{idx + 1}.</span>
                      <span className="truncate max-w-[200px]" title={f.name}>{f.name}</span>
                      <span className="text-slate-400 font-mono">({formatBytes(f.size)})</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="p-1 hover:text-white disabled:opacity-30"
                        disabled={idx === 0}
                        onClick={() => moveMergeFile(idx, -1)}
                      >
                        <Icon name="arrow-up" size={13} />
                      </button>
                      <button
                        type="button"
                        className="p-1 hover:text-white disabled:opacity-30"
                        disabled={idx === mergeFiles.length - 1}
                        onClick={() => moveMergeFile(idx, 1)}
                      >
                        <Icon name="arrow-down" size={13} />
                      </button>
                      <button
                        type="button"
                        className="p-1 hover:text-rose-400 ml-1"
                        onClick={() => removeMergeFile(idx)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="fc-btn fc-btn-primary w-full"
              disabled={processing || mergeFiles.length < 2}
              onClick={handleExecuteMerge}
            >
              <Icon name="layers" size={16} />
              <span>{processing ? 'Merging Documents…' : `Merge ${mergeFiles.length} PDFs`}</span>
            </button>
          </div>

          <div className="fc-tool-panel flex flex-col justify-between">
            <div>
              <div className="fc-panel-title mb-2">Result & Information</div>
              <div className="text-xs text-slate-400 leading-relaxed space-y-2">
                <p>• Merged files are processed 100% locally with high-fidelity PyMuPDF engine.</p>
                <p>• Bookmarks, text layers, vector curves, and raster graphics are preserved.</p>
                <p>• Output filename is automatically sanitized and ready for instant download.</p>
              </div>
            </div>

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col gap-3"
              >
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <Icon name="check-circle" size={18} />
                  <span>{result.filename}</span>
                </div>
                <div className="text-xs text-slate-300 font-mono">
                  Size: {formatBytes(result.size)} · Processed in {(result.elapsed_ms / 1000).toFixed(2)}s
                </div>
                <a
                  href={api.converterDownloadUrl(result.job_id)}
                  download={result.filename}
                  className="fc-btn fc-btn-success w-full"
                >
                  <Icon name="download" size={15} />
                  <span>Download Merged PDF</span>
                </a>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* 2. Single PDF Tool Views (Split, Compress, To-Images, To-Word) */}
      {['split', 'compress', 'to-images', 'to-word'].includes(activeTab) && (
        <div className="fc-tool-grid">
          <div className="fc-tool-panel">
            <div className="fc-panel-title mb-1">
              {activeTab === 'split' && 'Extract Pages from PDF'}
              {activeTab === 'compress' && 'Compress & Optimize PDF'}
              {activeTab === 'to-images' && 'Convert PDF to Images (ZIP)'}
              {activeTab === 'to-word' && 'Convert PDF to Word DOCX'}
            </div>
            <p className="fc-panel-desc mb-4">
              {activeTab === 'split' && 'Extract specific pages or page ranges into a new standalone PDF.'}
              {activeTab === 'compress' && 'Reduce PDF file size by compressing internal stream objects and fonts.'}
              {activeTab === 'to-images' && 'Render each page into high-resolution JPG or PNG images packed in a ZIP.'}
              {activeTab === 'to-word' && 'Convert PDF document into an editable Microsoft Word (.docx) document.'}
            </p>

            {!singleFile ? (
              <div
                className="fc-dropzone-shell cursor-pointer mb-4"
                onClick={() => singleInputRef.current?.click()}
              >
                <div className="fc-dropzone-core py-10">
                  <input
                    ref={singleInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleSingleSelect(e.target.files[0])
                        e.target.value = ''
                      }
                    }}
                  />
                  <Icon name="file" size={26} className="text-violet-400" />
                  <span className="text-sm font-semibold text-white">Choose a PDF Document</span>
                  <span className="text-xs text-slate-400">PDF up to 500 MB</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <Icon name="file" size={18} className="text-violet-400" />
                    <span className="font-semibold text-white truncate max-w-[200px]">{singleFile.name}</span>
                    <span className="text-slate-400 font-mono">({formatBytes(singleFile.size)})</span>
                  </div>
                  <button
                    type="button"
                    className="fc-btn fc-btn-danger-ghost text-xs"
                    onClick={() => {
                      setSingleFile(null)
                      setResult(null)
                    }}
                  >
                    Change
                  </button>
                </div>

                {activeTab === 'split' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-300">Pages to Extract</label>
                    <input
                      type="text"
                      className="fc-input font-mono"
                      placeholder="e.g. 1, 3-5, 8"
                      value={pageRange}
                      onChange={(e) => setPageRange(e.target.value)}
                    />
                    <span className="text-[11px] text-slate-400">
                      Comma-separated pages and hyphens for ranges (e.g. 1, 3-5).
                    </span>
                  </div>
                )}

                {activeTab === 'to-images' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-300">Image Format</label>
                    <select
                      className="fc-select font-mono uppercase"
                      value={imgFmt}
                      onChange={(e) => setImgFmt(e.target.value)}
                    >
                      <option value="png">PNG (Lossless & Crisp)</option>
                      <option value="jpg">JPG (Smaller file size)</option>
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  className="fc-btn fc-btn-primary w-full mt-2"
                  disabled={processing}
                  onClick={handleExecuteSingle}
                >
                  <Icon name="convert" size={16} />
                  <span>
                    {processing
                      ? 'Processing PDF…'
                      : activeTab === 'split'
                      ? 'Extract Pages'
                      : activeTab === 'compress'
                      ? 'Compress PDF'
                      : activeTab === 'to-images'
                      ? 'Render Pages as Images'
                      : 'Convert to Word'}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="fc-tool-panel flex flex-col justify-between">
            <div>
              <div className="fc-panel-title mb-2">Process Details</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Everything runs directly inside your local environment without any cloud uploads.
              </p>
            </div>

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col gap-3"
              >
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <Icon name="check-circle" size={18} />
                  <span>{result.filename}</span>
                </div>
                <div className="text-xs text-slate-300 font-mono">
                  Output size: {formatBytes(result.size)} · Completed in {(result.elapsed_ms / 1000).toFixed(2)}s
                </div>
                <a
                  href={api.converterDownloadUrl(result.job_id)}
                  download={result.filename}
                  className="fc-btn fc-btn-success w-full"
                >
                  <Icon name="download" size={15} />
                  <span>Download Result</span>
                </a>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* 3. Images to PDF View */}
      {activeTab === 'from-images' && (
        <div className="fc-tool-grid">
          <div className="fc-tool-panel">
            <div className="fc-panel-title mb-1">Combine Images to PDF</div>
            <p className="fc-panel-desc mb-4">
              Select one or more JPG, PNG, or WebP images to generate a multi-page PDF document.
            </p>

            <div
              className="fc-dropzone-shell cursor-pointer mb-4"
              onClick={() => imagesInputRef.current?.click()}
            >
              <div className="fc-dropzone-core py-8">
                <input
                  ref={imagesInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      handleAddImages(e.target.files)
                      e.target.value = ''
                    }
                  }}
                />
                <Icon name="image" size={24} className="text-violet-400" />
                <span className="text-sm font-semibold text-white">Click to add images</span>
                <span className="text-xs text-slate-400">PNG, JPG, WebP images</span>
              </div>
            </div>

            {imageFiles.length > 0 && (
              <div className="flex flex-col gap-2 mb-4 max-h-56 overflow-y-auto pr-1">
                {imageFiles.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="flex items-center justify-between p-2 rounded-lg bg-white/5 text-xs text-slate-200"
                  >
                    <span className="truncate max-w-[220px]">{f.name}</span>
                    <button
                      type="button"
                      className="p-1 hover:text-rose-400"
                      onClick={() => setImageFiles((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="fc-btn fc-btn-primary w-full"
              disabled={processing || imageFiles.length === 0}
              onClick={handleExecuteImagesToPdf}
            >
              <Icon name="convert" size={16} />
              <span>{processing ? 'Generating PDF…' : `Create PDF from ${imageFiles.length} Images`}</span>
            </button>
          </div>

          <div className="fc-tool-panel flex flex-col justify-between">
            <div>
              <div className="fc-panel-title mb-2">Overview</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Images are scaled and converted into pages in the exact sequence added.
              </p>
            </div>

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col gap-3"
              >
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <Icon name="check-circle" size={18} />
                  <span>{result.filename}</span>
                </div>
                <div className="text-xs text-slate-300 font-mono">
                  {formatBytes(result.size)} · Generated in {(result.elapsed_ms / 1000).toFixed(2)}s
                </div>
                <a
                  href={api.converterDownloadUrl(result.job_id)}
                  download={result.filename}
                  className="fc-btn fc-btn-success w-full"
                >
                  <Icon name="download" size={15} />
                  <span>Download PDF Document</span>
                </a>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
