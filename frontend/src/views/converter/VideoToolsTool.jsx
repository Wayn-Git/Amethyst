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

  // Options
  const [targetVideoFmt, setTargetVideoFmt] = useState('mp4')
  const [gifFps, setGifFps] = useState(15)
  const [audioFmt, setAudioFmt] = useState('mp3')
  const [targetAudioFmt, setTargetAudioFmt] = useState('wav')

  // Status
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return
    const isVideo = selectedFile.type.startsWith('video/') || ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv'].some((e) => selectedFile.name.toLowerCase().endsWith(e))
    const isAudio = selectedFile.type.startsWith('audio/') || ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].some((e) => selectedFile.name.toLowerCase().endsWith(e))

    if (!isVideo && !isAudio) {
      toast('Please select a valid video or audio file', 'bad')
      return
    }

    setFile(selectedFile)
    setResult(null)

    if (isVideo) {
      setFilePreview(URL.createObjectURL(selectedFile))
    } else {
      setFilePreview(null)
    }
  }

  const handleProcess = async () => {
    if (!file) {
      toast('Please upload a file first', 'bad')
      return
    }

    setProcessing(true)
    try {
      const up = await api.converterUpload([file])
      const fileId = up.uploaded[0]?.file_id
      if (!fileId) throw new Error('Upload failed')

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
              <div className="fc-dropzone-core py-10">
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
                <Icon name={activeTab === 'audio-converter' ? 'speaker' : 'video'} size={28} className="text-violet-400" />
                <span className="text-sm font-semibold text-white">
                  {activeTab === 'audio-converter' ? 'Choose Audio File' : 'Choose Video or Audio File'}
                </span>
                <span className="text-xs text-slate-400">
                  {activeTab === 'audio-converter' ? 'MP3, WAV, AAC, FLAC, OGG' : 'MP4, WebM, MKV, MOV, AVI up to 500 MB'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 text-xs">
                <div className="flex items-center gap-2 truncate">
                  <Icon name={file.type.startsWith('audio/') ? 'speaker' : 'video'} size={18} className="text-violet-400" />
                  <span className="font-semibold text-white truncate max-w-[200px]">{file.name}</span>
                  <span className="text-slate-400 font-mono">({formatBytes(file.size)})</span>
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
                  <label className="text-xs font-semibold text-slate-300">Target Video Format</label>
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
                  <label className="text-xs font-semibold text-slate-300">Frame Rate (FPS)</label>
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
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-300">Audio Format</label>
                  <select
                    className="fc-select font-mono uppercase"
                    value={audioFmt}
                    onChange={(e) => setAudioFmt(e.target.value)}
                  >
                    <option value="mp3">MP3 (320 kbps)</option>
                    <option value="aac">AAC (Apple / High quality)</option>
                    <option value="wav">WAV (Lossless 16-bit PCM)</option>
                  </select>
                </div>
              )}

              {activeTab === 'audio-converter' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-300">Convert Audio To</label>
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
                disabled={processing}
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
            ) : (
              <div className="p-8 rounded-xl bg-black/30 border border-white/5 flex flex-col items-center justify-center text-center text-slate-400 gap-2">
                <Icon name={activeTab === 'audio-converter' ? 'speaker' : 'video'} size={36} className="text-violet-400 opacity-60" />
                <span className="text-xs">Upload media to see live preview</span>
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
              <div className="text-xs text-slate-300 font-mono">
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
