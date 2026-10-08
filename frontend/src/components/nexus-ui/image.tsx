"use client"

import * as React from "react"
import { createContext, useContext, useState, useMemo, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  Maximize2,
  Copy,
  Download,
  Check,
  Sparkles,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
} from "lucide-react"
import { cn } from "cn"

interface ImageContextType {
  resolvedSrc: string | null
  alt: string
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  hasError: boolean
  setHasError: (err: boolean) => void
}

const ImageContext = createContext<ImageContextType | null>(null)

export function useImageContext() {
  const ctx = useContext(ImageContext)
  if (!ctx) {
    throw new Error("Image primitives must be used within an <Image> component")
  }
  return ctx
}

export interface ImageProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string
  base64?: string
  uint8Array?: Uint8Array | number[]
  mediaType?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean
  alt?: string
  children?: React.ReactNode
}

export function Image({
  src,
  base64,
  uint8Array,
  mediaType = "image/png",
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  modal = true,
  alt = "",
  className,
  children,
  ...props
}: ImageProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const setIsOpen = (val: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(val)
    }
    onOpenChange?.(val)
  }

  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  // Resolve binary / base64 / standard source
  const resolvedSrc = useMemo(() => {
    if (base64) {
      if (base64.startsWith("data:")) return base64
      return `data:${mediaType};base64,${base64}`
    }
    if (uint8Array) {
      try {
        const u8 = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array)
        const blob = new Blob([u8], { type: mediaType })
        return URL.createObjectURL(blob)
      } catch {
        return null
      }
    }
    if (src) {
      return src
    }
    return null
  }, [src, base64, uint8Array, mediaType])

  // Clean up object URLs if created
  useEffect(() => {
    return () => {
      if (resolvedSrc && resolvedSrc.startsWith("blob:")) {
        URL.revokeObjectURL(resolvedSrc)
      }
    }
  }, [resolvedSrc])

  useEffect(() => {
    setIsLoading(true)
    setHasError(false)
  }, [resolvedSrc])

  const contextValue = useMemo(
    () => ({
      resolvedSrc,
      alt,
      isOpen,
      setIsOpen,
      isLoading,
      setIsLoading,
      hasError,
      setHasError,
    }),
    [resolvedSrc, alt, isOpen, isLoading, hasError]
  )

  return (
    <ImageContext.Provider value={contextValue}>
      <div
        data-slot="nexus-image-root"
        className={cn("group/image relative block w-full max-w-full overflow-hidden rounded-[var(--radius-cards,6px)]", className)}
        {...props}
      >
        {children ?? <ImagePreview />}
      </div>
    </ImageContext.Provider>
  )
}

export function ImageLoader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="image-loader"
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center bg-white/[0.04] backdrop-blur-xs overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full animate-[shimmer_1.8s_infinite]" />
      <div className="flex flex-col items-center gap-2 text-white/30">
        <Sparkles className="size-5 animate-pulse text-purple-400/60" />
      </div>
    </div>
  )
}

export interface ImagePreviewProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string
  alt?: string
}

export function ImagePreview({
  src,
  alt: propAlt,
  className,
  onLoad,
  onError,
  ...props
}: ImagePreviewProps) {
  const { resolvedSrc, alt: contextAlt, setIsOpen, isLoading, setIsLoading, hasError, setHasError } = useImageContext()
  const displaySrc = src ?? resolvedSrc
  const displayAlt = propAlt ?? contextAlt

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoading(false)
    onLoad?.(e)
  }

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoading(false)
    setHasError(true)
    onError?.(e)
  }

  if (!displaySrc || hasError) {
    return (
      <div
        className={cn(
          "relative flex aspect-video w-full min-h-[160px] items-center justify-center rounded-[var(--radius-cards,6px)] border border-white/[0.08] bg-white/[0.03] text-white/40",
          className
        )}
      >
        <ImageLoader />
      </div>
    )
  }

  return (
    <div
      className={cn("relative overflow-hidden cursor-zoom-in w-full h-full", className)}
      onClick={() => setIsOpen(true)}
    >
      {isLoading && <ImageLoader />}
      <img
        src={displaySrc}
        alt={displayAlt}
        loading="lazy"
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "w-full h-full object-cover rounded-[var(--radius-cards,6px)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/image:scale-[1.015]",
          isLoading ? "opacity-0 scale-98" : "opacity-100 scale-100"
        )}
        {...props}
      />
    </div>
  )
}

export function ImageLightbox({ children }: { children: React.ReactNode }) {
  const { isOpen } = useImageContext()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      const orig = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = orig
      }
    }
  }, [isOpen])

  if (!mounted || typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div data-slot="image-lightbox-portal" className="fixed inset-0 z-[99999] flex items-center justify-center">
          {children}
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function ImageLightboxOverlay({
  className,
  onClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { setIsOpen } = useImageContext()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      data-slot="image-lightbox-overlay"
      onClick={(e) => {
        onClick?.(e)
        setIsOpen(false)
      }}
      className={cn(
        "fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity cursor-pointer",
        className
      )}
      {...props}
    />
  )
}

export function ImageLightboxPreview({
  src,
  alt: propAlt,
  className,
  children,
  onInteractOutside,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  src?: string
  alt?: string
  onInteractOutside?: (event: unknown) => void
}) {
  const { resolvedSrc, alt: contextAlt, setIsOpen } = useImageContext()
  const displaySrc = src ?? resolvedSrc
  const displayAlt = propAlt ?? contextAlt

  const [scale, setScale] = useState(1.0)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Zoom helpers
  const handleZoomIn = () => setScale((s) => Math.min(4.0, Number((s + 0.25).toFixed(2))))
  const handleZoomOut = () =>
    setScale((s) => {
      const next = Math.max(0.25, Number((s - 0.25).toFixed(2)))
      if (next <= 1.0) setPosition({ x: 0, y: 0 })
      return next
    })
  const handleReset = () => {
    setScale(1.0)
    setPosition({ x: 0, y: 0 })
  }

  const handleDoubleClick = () => {
    if (scale === 1.0) {
      setScale(2.0)
    } else {
      handleReset()
    }
  }

  // Wheel zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.15 : 0.15
      setScale((s) => {
        const next = Math.max(0.25, Math.min(4.0, Number((s + delta).toFixed(2))))
        if (next <= 1.0) setPosition({ x: 0, y: 0 })
        return next
      })
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false)
      } else if (e.key === "+" || e.key === "=") {
        handleZoomIn()
      } else if (e.key === "-" || e.key === "_") {
        handleZoomOut()
      } else if (e.key === "0") {
        handleReset()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [setIsOpen])

  // Pan & drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    try {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    } catch {}
  }

  // Copy handler
  const handleCopy = async () => {
    if (!displaySrc) return
    try {
      if (typeof ClipboardItem !== "undefined") {
        const resp = await fetch(displaySrc)
        const blob = await resp.blob()
        if (blob.type.startsWith("image/")) {
          let pngBlob = blob
          if (blob.type !== "image/png") {
            const img = new window.Image()
            img.crossOrigin = "anonymous"
            img.src = displaySrc
            await new Promise((res, rej) => {
              img.onload = res
              img.onerror = rej
            })
            const canvas = document.createElement("canvas")
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext("2d")
            if (ctx) {
              ctx.drawImage(img, 0, 0)
              pngBlob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"))
            }
          }
          await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })])
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
          return
        }
      }
    } catch {}

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(displaySrc)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  // Download handler
  const handleDownload = async () => {
    if (!displaySrc) return
    try {
      const resp = await fetch(displaySrc)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const ext = blob.type.split("/")[1] || "png"
      const safeName = (displayAlt || "image").toLowerCase().replace(/[^a-z0-9_-]/g, "_")
      a.download = `${safeName}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      const a = document.createElement("a")
      a.href = displaySrc
      a.download = displayAlt || "image"
      a.target = "_blank"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  // Separate ImageLightboxClose from custom captions for clean positioning
  let closeButton: React.ReactNode = null
  const otherChildren: React.ReactNode[] = []
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && ((child.type as any) === ImageLightboxClose || (child.type as any)?.displayName === "ImageLightboxClose")) {
      closeButton = child
    } else {
      otherChildren.push(child)
    }
  })

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      data-slot="image-lightbox-preview"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "fixed inset-0 z-20 flex flex-col items-center justify-center overflow-hidden pointer-events-none select-none",
        className
      )}
      {...props}
    >
      {/* Top Floating Glass Toolbar */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-1.5 sm:gap-2 px-3.5 py-1.5 rounded-full bg-[#0e131f]/90 dark:bg-[#121622]/90 backdrop-blur-2xl border border-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.55)] text-white">
        {displayAlt && (
          <span
            className="text-[12px] font-medium text-white/80 max-w-[140px] sm:max-w-[220px] truncate pl-1"
            title={displayAlt}
          >
            {displayAlt}
          </span>
        )}
        {dimensions && (
          <span className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/60">
            {dimensions.width}×{dimensions.height}
          </span>
        )}

        <div className="h-3.5 w-px bg-white/15 mx-0.5" />

        {/* Zoom Controls */}
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={scale <= 0.25}
          title="Zoom out (-)"
          className="size-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 cursor-pointer active:scale-95"
        >
          <ZoomOut className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={handleReset}
          title="Reset zoom (0)"
          className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium text-white/85 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          type="button"
          onClick={handleZoomIn}
          disabled={scale >= 4.0}
          title="Zoom in (+)"
          className="size-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 cursor-pointer active:scale-95"
        >
          <ZoomIn className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={handleReset}
          title="Fit to view (0)"
          className="size-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95"
        >
          <RotateCcw className="size-3.5" />
        </button>

        <div className="h-3.5 w-px bg-white/15 mx-0.5" />

        {/* Quick Action Buttons */}
        <button
          type="button"
          onClick={handleCopy}
          title="Copy image / link"
          className="size-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95"
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-400" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={handleDownload}
          title="Download original image"
          className="size-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95"
        >
          <Download className="size-3.5" />
        </button>

        {displaySrc && (
          <a
            href={displaySrc}
            target="_blank"
            rel="noreferrer noopener"
            title="Open original in new tab"
            className="size-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}

        <button
          type="button"
          onClick={() => setIsOpen(false)}
          title="Close (Esc)"
          className="size-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95 ml-0.5"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Interactive Main Canvas */}
      <div
        ref={containerRef}
        className={cn(
          "relative w-screen h-screen flex items-center justify-center p-4 sm:p-12 pointer-events-auto",
          scale > 1.0 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {displaySrc && (
          <img
            src={displaySrc}
            alt={displayAlt}
            draggable={false}
            onLoad={(e) => {
              const target = e.currentTarget
              setDimensions({ width: target.naturalWidth, height: target.naturalHeight })
            }}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDragging ? "none" : "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            className="max-w-[90vw] max-h-[82vh] object-contain select-none rounded-[var(--radius-lg,10px)] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.65)] bg-black/40"
          />
        )}
      </div>

      {closeButton}

      {/* Children / Bottom Caption support */}
      {otherChildren.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
          {otherChildren}
        </div>
      )}
    </motion.div>
  )
}

export function ImageLightboxClose({
  asChild = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { setIsOpen } = useImageContext()

  return (
    <button
      type="button"
      data-slot="image-lightbox-close"
      onClick={() => setIsOpen(false)}
      aria-label="Close image preview"
      title="Close (Esc)"
      className={cn(
        "fixed top-5 right-5 z-40 flex size-9 items-center justify-center rounded-full bg-neutral-900/80 text-white/80 hover:text-white hover:bg-neutral-800 backdrop-blur-xl border border-white/15 shadow-xl transition-all cursor-pointer active:scale-95",
        className
      )}
      {...props}
    >
      <X className="size-4" />
    </button>
  )
}

export function ImageActions({
  align = "block-end",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  align?: "inline-start" | "inline-end" | "block-start" | "block-end"
}) {
  const alignClass = {
    "block-end": "bottom-2.5 right-2.5",
    "block-start": "top-2.5 right-2.5",
    "inline-start": "bottom-2.5 left-2.5",
    "inline-end": "bottom-2.5 right-2.5",
  }[align]

  return (
    <div
      data-slot="image-actions"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "absolute z-10 opacity-0 group-hover/image:opacity-100 transition-opacity duration-200",
        alignClass,
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function ImageActionGroup({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="image-action-group"
      className={cn(
        "flex items-center gap-1 p-1 rounded-lg bg-black/70 backdrop-blur-md border border-white/15 shadow-lg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface ImageActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  tooltip?: string | { content?: string; side?: "top" | "right" | "bottom" | "left"; shortcut?: string }
}

export function ImageAction({
  asChild = false,
  tooltip,
  className,
  children,
  onClick,
  ...props
}: ImageActionProps) {
  const ctx = useContext(ImageContext)
  const tooltipContent = typeof tooltip === "string" ? tooltip : tooltip?.content

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (onClick) {
      onClick(e)
    } else if (ctx && (tooltipContent?.toLowerCase().includes("enlarge") || tooltipContent?.toLowerCase().includes("zoom"))) {
      ctx.setIsOpen(true)
    }
  }

  return (
    <button
      type="button"
      data-slot="image-action"
      title={tooltipContent}
      onClick={handleClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-white/75 hover:text-white hover:bg-white/15 transition-colors focus:outline-none cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
