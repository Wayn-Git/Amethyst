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

   Re-runs on `deps` (list lengths, which panel is open) and on resize.
*/
export function useMenuFit(ref, deps = []) {
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return undefined

    const fit = () => {
      const floor = window.innerHeight - 12
      const body = menu.querySelector('.menu-body')

      if (body) {
        body.style.maxHeight = ''
        const rect = menu.getBoundingClientRect()
        const over = Math.max(rect.bottom - floor, 12 - rect.top, 0)
        if (over > 0) {
          const h = body.getBoundingClientRect().height
          body.style.maxHeight = `${Math.max(140, h - over)}px`
        }
      }

      for (const flyout of menu.querySelectorAll('.menu-flyout')) {
        flyout.style.maxHeight = ''
        const top = flyout.getBoundingClientRect().top
        flyout.style.maxHeight = `${Math.max(160, floor - top)}px`
      }
    }

    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
