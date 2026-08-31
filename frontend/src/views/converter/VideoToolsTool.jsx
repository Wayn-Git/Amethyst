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

export default function VideoToolsTool() {
  const { toast } = useApp()
  const fileInputRef = useRef(null)

  const [activeTab, setActiveTab] = useState('convert-video') // 'convert-video' | 'to-gif' | 'extract-audio' | 'compress-video' | 'audio-converter'
  const [file, setFile] = useState(null)
  const [filePreview, setFilePreview] = useState(null)
  const [thumbnailUrl, setThumbnailUrl] = useState(null)
  const [uploadedFileId, setUploadedFileId] = useState(null)
  const [hasAudio, setHasAudio] = useState(true)

  // Options
  const [targetVideoFmt, setTargetVideoFmt] = useState('mp4')
  const [gifFps, setGifFps] = useState(15)
  const [audioFmt, setAudioFmt] = useState('mp3')
  const [targetAudioFmt, setTargetAudioFmt] = useState('wav')
  const [compressLevel, setCompressLevel] = useState('balanced')

  // Status
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileSelect = async (selectedFile) => {
    if (!selectedFile) return
    const ext = selectedFile.name.split('.').pop()?.toLowerCase() || ''
    const isVideo = selectedFile.type.startsWith('video/') || ['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv'].includes(ext)
    const isAudio = selectedFile.type.startsWith('audio/') || ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(ext)

    if (!isVideo && !isAudio) {
      toast('Please select a valid video or audio file', 'bad')
      return
    }

    setFile(selectedFile)
    setResult(null)
    setUploadedFileId(null)
    setThumbnailUrl(null)
    setHasAudio(true)

    // Browsers natively only decode MP4, WebM, and Ogg
    const isBrowserPlayable = isVideo && ['mp4', 'webm', 'ogg'].includes(ext)
    if (isBrowserPlayable) {
      setFilePreview(URL.createObjectURL(selectedFile))
    } else {
      setFilePreview(null)
    }

    // Proactively upload to inspect streams and generate frame thumbnail for AVI/MKV
    try {
      const up = await api.converterUpload([selectedFile])
      const meta = up.uploaded?.[0]
      if (meta?.file_id) {
        setUploadedFileId(meta.file_id)
        if (meta.has_audio !== undefined) {
          setHasAudio(meta.has_audio)
        }
        if (meta.has_thumbnail) {
          setThumbnailUrl(api.converterThumbnailUrl(meta.file_id))
        }
      }
    } catch (e) {
      console.warn('Media inspection upload failed', e)
    }
  }

  const handleProcess = async () => {
    if (!file) {
      toast('Please upload a file first', 'bad')
      return
    }

    if (activeTab === 'extract-audio' && !hasAudio) {
      toast(`Video "${file.name}" has no audio track to extract`, 'bad')
      return
    }

    setProcessing(true)
    try {
      let fileId = uploadedFileId
      if (!fileId) {
        const up = await api.converterUpload([file])
        fileId = up.uploaded[0]?.file_id
        if (!fileId) throw new Error('Upload failed')
        setUploadedFileId(fileId)
      }

      let op = 'convert'
      let targetFmt = targetVideoFmt
      let options = {}

      if (activeTab === 'convert-video') {
        op = 'convert'
        targetFmt = targetVideoFmt
      } else if (activeTab === 'to-gif') {
        op = 'video_to_gif'
        targetFmt = 'gif'
        options = { fps: gifFps }
      } else if (activeTab === 'extract-audio') {
        op = 'video_to_audio'
        targetFmt = audioFmt
        options = { format: audioFmt }
      } else if (activeTab === 'compress-video') {
        op = 'video_compress'
        targetFmt = 'mp4'
        const crfMap = { light: 23, balanced: 28, high: 32 }
        options = { crf: crfMap[compressLevel] || 28 }
      } else if (activeTab === 'audio-converter') {
        op = 'convert'
        targetFmt = targetAudioFmt
      }

      const res = await api.converterProcess({
        file_id: fileId,
        operation: op,
        target_format: targetFmt,
        options,
      })

      setResult(res)
      toast('Media processed successfully!', 'good')
    } catch (err) {
      console.error(err)
      toast(`Processing failed: ${err.message}`, 'bad')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="fc-tool-workspace">
      {/* Sub-tool navigation tabs */}
      <div className="fc-cat-tabs mb-6">
        {[
          { id: 'convert-video', label: 'Convert Video', icon: 'video' },
          { id: 'to-gif', label: 'Video to Animated GIF', icon: 'image' },
          { id: 'extract-audio', label: 'Extract Audio', icon: 'music' },
          { id: 'compress-video', label: 'Compress Video', icon: 'arrow-down' },
          { id: 'audio-converter', label: 'Audio Converter', icon: 'speaker' },
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

      <div className="fc-tool-grid">
        {/* Left Panel: Upload & Controls */}
        <div className="fc-tool-panel">
          <div className="fc-panel-title mb-1">
            {activeTab === 'convert-video' && 'Video Converter'}
            {activeTab === 'to-gif' && 'Make Animated GIF from Video'}
            {activeTab === 'extract-audio' && 'Extract High Quality Audio'}
            {activeTab === 'compress-video' && 'Video Compressor'}
            {activeTab === 'audio-converter' && 'Audio Converter'}
          </div>
          <p className="fc-panel-desc mb-4">
            {activeTab === 'convert-video' && 'Convert between MP4, WebM, MKV, MOV, and AVI with hardware-accelerated FFmpeg.'}
            {activeTab === 'to-gif' && 'Generate high-fidelity animated GIFs with 2-pass palette optimization.'}
            {activeTab === 'extract-audio' && 'Strip the video track and export high-bitrate MP3, WAV, or AAC audio.'}
            {activeTab === 'compress-video' && 'Reduce video file size using smart Constant Rate Factor (CRF) compression.'}
            {activeTab === 'audio-converter' && 'Convert between MP3, WAV, AAC, FLAC, and OGG formats.'}
          </p>

          {!file ? (
            <div
              className="fc-dropzone-shell cursor-pointer mb-4"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="fc-dropzone-core py-8 flex flex-col items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={activeTab === 'audio-converter' ? 'audio/*' : 'video/*,audio/*'}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleFileSelect(e.target.files[0])
                      e.target.value = ''
                    }
                  }}
                />
                <div className="fc-drop-featured-icon">
                  <Icon name={activeTab === 'audio-converter' ? 'speaker' : 'video'} size={24} />
                </div>
                <div className="flex flex-col items-center text-center gap-1">
                  <span className="text-sm font-semibold text-[var(--fc-text)]">
                    {activeTab === 'audio-converter' ? 'Choose or drop audio file' : 'Choose or drop media file'}
                  </span>
                  <span className="text-xs text-[var(--fc-text-faint)]">
                    {activeTab === 'audio-converter' ? 'MP3, WAV, AAC, FLAC, OGG' : 'MP4, WebM, MKV, MOV, AVI up to 500 MB'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--fc-surface-2)] border border-[var(--fc-border)] text-xs">
                <div className="flex items-center gap-2 truncate">
                  <Icon name={file.type.startsWith('audio/') ? 'speaker' : 'video'} size={18} className="text-[var(--fc-accent)]" />
                  <span className="font-semibold text-[var(--fc-text)] truncate max-w-[200px]">{file.name}</span>
                  <span className="text-[var(--fc-text-dim)] font-mono">({formatBytes(file.size)})</span>
                </div>
                <button
                  type="button"
                  className="fc-btn fc-btn-danger-ghost text-xs"
                  onClick={() => {
                    setFile(null)
                    setFilePreview(null)
                    setResult(null)
                  }}
                >
                  Change
                </button>
              </div>

              {/* Form Options */}
              {activeTab === 'convert-video' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--fc-text)]">Target Video Format</label>
                  <select
                    className="fc-select font-mono uppercase"
                    value={targetVideoFmt}
                    onChange={(e) => setTargetVideoFmt(e.target.value)}
                  >
                    <option value="mp4">MP4 (H.264 / AAC - Universal)</option>
                    <option value="webm">WebM (VP9 / Opus - Web friendly)</option>
                    <option value="mkv">MKV (Matroska)</option>
                    <option value="mov">MOV (QuickTime)</option>
                    <option value="avi">AVI</option>
                  </select>
                </div>
              )}

              {activeTab === 'to-gif' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--fc-text)]">Frame Rate (FPS)</label>
                  <select
                    className="fc-select font-mono"
                    value={gifFps}
                    onChange={(e) => setGifFps(Number(e.target.value))}
                  >
                    <option value="10">10 FPS (Compact file size)</option>
                    <option value="15">15 FPS (Standard balance)</option>
                    <option value="24">24 FPS (Cinematic smooth motion)</option>
                  </select>
                </div>
              )}

              {activeTab === 'extract-audio' && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[var(--fc-text)]">Audio Format</label>
                    <select
                      className="fc-select font-mono uppercase"
                      value={audioFmt}
                      onChange={(e) => setAudioFmt(e.target.value)}
                    >
                      <option value="mp3">MP3 (320 kbps)</option>
                      <option value="aac">AAC (Apple / High quality)</option>
                      <option value="wav">WAV (Lossless 16-bit PCM)</option>
                      <option value="flac">FLAC (Lossless)</option>
                      <option value="ogg">OGG (Vorbis)</option>
                    </select>
                  </div>
                  {!hasAudio && (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
                      <Icon name="alert-triangle" size={14} className="shrink-0" />
                      <span>This video file contains no audio track to extract.</span>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'compress-video' && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[var(--fc-text)]">Compression Preset</label>
                    <select
                      className="fc-select font-mono"
                      value={compressLevel}
                      onChange={(e) => setCompressLevel(e.target.value)}
                    >
                      <option value="balanced">Balanced (CRF 28 - Recommended)</option>
                      <option value="high">High Compression (CRF 32 - Smallest File)</option>
                      <option value="light">Light Compression (CRF 23 - Highest Quality)</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-[var(--fc-text-faint)] leading-normal">
                    Re-encodes with H.264 CRF constant rate factor for maximum space savings.
                  </p>
                </div>
              )}

              {activeTab === 'audio-converter' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--fc-text)]">Convert Audio To</label>
                  <select
                    className="fc-select font-mono uppercase"
                    value={targetAudioFmt}
                    onChange={(e) => setTargetAudioFmt(e.target.value)}
                  >
                    <option value="mp3">MP3</option>
                    <option value="wav">WAV (Lossless)</option>
                    <option value="aac">AAC</option>
                    <option value="ogg">OGG (Vorbis)</option>
                    <option value="flac">FLAC (Lossless)</option>
                  </select>
                </div>
              )}

              <button
                type="button"
                className="fc-btn fc-btn-primary w-full mt-2"
                disabled={processing || (activeTab === 'extract-audio' && !hasAudio)}
                onClick={handleProcess}
              >
                <Icon name="convert" size={16} />
                <span>{processing ? 'Processing with FFmpeg…' : 'Start Processing'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Panel: Preview & Download */}
        <div className="fc-tool-panel flex flex-col justify-between">
          <div>
            <div className="fc-panel-title mb-3">Media Preview</div>
            {filePreview ? (
              <video
                controls
                src={filePreview}
                className="w-full max-h-56 rounded-xl bg-black object-contain shadow-md"
              />
            ) : thumbnailUrl ? (
              <div className="relative rounded-xl overflow-hidden bg-[var(--fc-surface-2)] border border-[var(--fc-border)] flex flex-col items-center">
                <img
                  src={thumbnailUrl}
                  alt="Video Frame Preview"
                  className="w-full max-h-56 object-contain"
                />
                <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1 bg-black/75 backdrop-blur-xs rounded text-[11px] text-white flex items-center justify-between">
                  <span>Frame preview</span>
                  <span className="font-mono uppercase text-[10px] text-[var(--fc-accent)] font-semibold">.{file?.name.split('.').pop()}</span>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-[var(--fc-surface-2)] border border-[var(--fc-border)] flex flex-col items-center justify-center text-center text-[var(--fc-text-dim)] gap-2">
                <Icon name={activeTab === 'audio-converter' ? 'speaker' : 'video'} size={36} className="text-[var(--fc-accent)] opacity-60" />
                <span className="text-xs">Upload media to see live preview</span>
              </div>
            )}

            {file && !filePreview && file.name.toLowerCase().endsWith('.avi') && (
              <div className="mt-2.5 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[11px]">
                AVI container cannot be played directly by browser player. Frame preview extracted above. Convert to MP4 to play in browser.
              </div>
            )}
          </div>

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col gap-3"
            >
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                <Icon name="check-circle" size={18} />
                <span className="truncate">{result.filename}</span>
              </div>
              <div className="text-xs text-[var(--fc-text)] font-mono">
                Size: {formatBytes(result.size)} · Completed in {(result.elapsed_ms / 1000).toFixed(2)}s
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
    </div>
  )
}
