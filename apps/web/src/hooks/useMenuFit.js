import { useLayoutEffect } from 'react'

/* Keep a composer menu inside the window.

   These menus are anchored to the composer and open either upward or downward,
   so how much room they have is a fact about the window, not something the
   stylesheet can know. Two things give, in this order:

   - `.menu-body`, which holds the rows. The menu itself deliberately does not
     scroll: a flyout is an absolutely positioned child of `.menu`, and a
     scrolling parent clips it into the menu it is supposed to open beside.
   - `.menu-flyout`, which is anchored to the menu's own top edge and so can
     hang past the bottom of the window on its own. Its inner `.menu-scroll`
     takes the difference.

   Re-runs on `deps` (list lengths, which panel is open) and on resize. A
   ResizeObserver watches the menu itself, because the one answer deps cannot
   cover is the list that arrives after the menu was measured — the provider
   that answers a beat after the menu opened was taller than the screen with no
   way to scroll it.
*/
export function useMenuFit(ref, deps = []) {
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return undefined

    const fit = () => {
      const floor = window.innerHeight - 12
      const body = menu.querySelector('.menu-body') || menu.querySelector('.model-menu-list')

      if (body) {
        const currentMax = body.style.maxHeight
        body.style.maxHeight = 'none'
        const rect = menu.getBoundingClientRect()
        const over = Math.max(rect.bottom - floor, 12 - rect.top, 0)
        let nextMax = ''
        if (over > 0) {
          const h = body.getBoundingClientRect().height
          nextMax = `${Math.max(140, h - over)}px`
        }
        if (nextMax) {
          body.style.setProperty('max-height', nextMax, 'important')
        } else if (currentMax) {
          body.style.removeProperty('max-height')
        }
      }

      const mRect = menu.getBoundingClientRect()
      if (mRect.bottom > floor) {
        menu.style.setProperty('max-height', `${Math.max(140, floor - mRect.top)}px`, 'important')
      } else if (mRect.top < 12) {
        menu.style.setProperty('max-height', `${Math.max(140, mRect.bottom - 12)}px`, 'important')
      }

      for (const flyout of menu.querySelectorAll('.menu-flyout')) {
        const currentMax = flyout.style.maxHeight
        flyout.style.maxHeight = 'none'
        const top = flyout.getBoundingClientRect().top
        const nextMax = `${Math.max(160, floor - top)}px`
        flyout.style.maxHeight = nextMax !== currentMax ? nextMax : currentMax
      }
    }

    fit()
    window.addEventListener('resize', fit)

    // Refit when the menu's own size changes — rows arriving after the open,
    // a flyout opening, a list swapping for its filtered copy — without every
    // caller having to name each one in deps.
    const observer = new ResizeObserver(fit)
    observer.observe(menu)

    return () => {
      window.removeEventListener('resize', fit)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
