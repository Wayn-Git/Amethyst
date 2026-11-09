import React, { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils.js'

/**
 * Skiper 87 Scroll Area with Edge Fade Animation
 * Automatically manages top and bottom gradient fades when scrollable.
 */

export function FadeScrollArea({
  children,
  className,
  fadeHeight = 24,
  // Callers that also have to drive the scroll themselves -- follow a stream to
  // the bottom, jump to latest -- get the same node this component measures,
  // rather than a second one to keep in sync with it.
  scrollRef: forwardedRef,
  ...props
}) {
  const scrollRef = useRef(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const checkScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    setCanScrollUp(scrollTop > 4)
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 4)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return

    const handleScroll = () => requestAnimationFrame(checkScroll)
    el.addEventListener('scroll', handleScroll, { passive: true })

    const observer = new ResizeObserver(checkScroll)
    observer.observe(el)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      observer.disconnect()
    }
  }, [])

  // Build dynamic mask image
  const maskStyle = {
    WebkitMaskImage: `linear-gradient(to bottom, 
      ${canScrollUp ? 'transparent 0%' : 'black 0%'}, 
      black ${canScrollUp ? `${fadeHeight}px` : '0px'}, 
      black calc(100% - ${canScrollDown ? `${fadeHeight}px` : '0px'}), 
      ${canScrollDown ? 'transparent 100%' : 'black 100%'})`,
    maskImage: `linear-gradient(to bottom, 
      ${canScrollUp ? 'transparent 0%' : 'black 0%'}, 
      black ${canScrollUp ? `${fadeHeight}px` : '0px'}, 
      black calc(100% - ${canScrollDown ? `${fadeHeight}px` : '0px'}), 
      ${canScrollDown ? 'transparent 100%' : 'black 100%'})`,
  }

  return (
    <div
      ref={(node) => {
        scrollRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      className={cn('skiper87-scroll-area', className)}
      style={maskStyle}
      {...props}
    >
      {children}
    </div>
  )
}
