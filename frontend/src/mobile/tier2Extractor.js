/**
 * Tier 2 Video Extraction (Hidden WebView / DOM Inspection)
 * Attempted only when video_url is null on a video reel (e.g. licensed audio gating).
 * 
 * Strict rule:
 * Treat blob: URLs as a failure unless bytes can actually be downloaded.
 * Never mark as working until measured on-device.
 */
export async function attemptTier2Extraction(shortcode, { timeoutMs = 8000 } = {}) {
  const startTime = Date.now()
  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`

  return new Promise((resolve) => {
    let resolved = false
    let timer = null
    let iframe = null
    const cleanup = () => {
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
      }
      if (timer) clearTimeout(timer)
    }

    const finish = (result) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve({
        ...result,
        latencyMs: Date.now() - startTime,
      })
    }

    timer = setTimeout(() => {
      finish({
        success: false,
        videoUrl: null,
        isBlob: false,
        bytesObtained: false,
        method: 'timeout',
        error: `Tier 2 WebView extraction timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    // Only run DOM iframe if window and document exist
    if (typeof document === 'undefined') {
      finish({
        success: false,
        videoUrl: null,
        isBlob: false,
        bytesObtained: false,
        method: 'node_env',
        error: 'DOM environment unavailable for WebView extraction',
      })
      return
    }

    iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.left = '-9999px'
    iframe.style.top = '-9999px'
    iframe.style.width = '320px'
    iframe.style.height = '480px'
    iframe.style.opacity = '0'
    iframe.style.pointerEvents = 'none'

    iframe.onload = async () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document
        if (!doc) {
          finish({
            success: false,
            videoUrl: null,
            isBlob: false,
            bytesObtained: false,
            method: 'cross_origin_blocked',
            error: 'Cross-origin security policy blocked access to iframe document',
          })
          return
        }

        // Poll DOM for video element
        let attempts = 0
        const maxPolls = 15
        const pollInterval = setInterval(async () => {
          attempts += 1
          const videoEl = doc.querySelector('video')
          const videoSrc = videoEl?.src || videoEl?.querySelector('source')?.src

          if (videoSrc) {
            clearInterval(pollInterval)
            const isBlob = videoSrc.startsWith('blob:')
            
            if (isBlob) {
              // Try fetching blob bytes
              let bytesObtained = false
              try {
                const blobRes = await fetch(videoSrc)
                const blob = await blobRes.blob()
                bytesObtained = blob.size > 0
              } catch {
                bytesObtained = false
              }

              if (bytesObtained) {
                finish({
                  success: true,
                  videoUrl: videoSrc,
                  isBlob: true,
                  bytesObtained: true,
                  method: 'dom_video_blob',
                  error: null,
                })
              } else {
                finish({
                  success: false,
                  videoUrl: videoSrc,
                  isBlob: true,
                  bytesObtained: false,
                  method: 'dom_video_blob_unreachable',
                  error: 'Video source is a blob: URL whose bytes cannot be extracted from outside the frame context',
                })
              }
            } else if (videoSrc.startsWith('http')) {
              finish({
                success: true,
                videoUrl: videoSrc,
                isBlob: false,
                bytesObtained: true,
                method: 'dom_video_http',
                error: null,
              })
            }
            return
          }

          if (attempts >= maxPolls) {
            clearInterval(pollInterval)
            finish({
              success: false,
              videoUrl: null,
              isBlob: false,
              bytesObtained: false,
              method: 'dom_no_video_element',
              error: 'No video element mounted in embed DOM within time limit',
            })
          }
        }, 300)
      } catch (err) {
        finish({
          success: false,
          videoUrl: null,
          isBlob: false,
          bytesObtained: false,
          method: 'dom_exception',
          error: err.message,
        })
      }
    }

    iframe.onerror = (err) => {
      finish({
        success: false,
        videoUrl: null,
        isBlob: false,
        bytesObtained: false,
        method: 'iframe_error',
        error: `Iframe load failed: ${err.message || 'Network error'}`,
      })
    }

    iframe.src = embedUrl
    document.body.appendChild(iframe)
  })
}
