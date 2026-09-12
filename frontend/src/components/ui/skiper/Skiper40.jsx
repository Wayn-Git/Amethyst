import React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils.js'

/**
 * Skiper 40 Animated Link & Nav Item — React
 * Provides smooth hover animations (underline, fill reveal, and spring motion).
 */

export function Link000({ children, href, className, onClick, ...props }) {
  const Comp = href ? 'a' : 'button'
  return (
    <Comp
      href={href}
      onClick={onClick}
      className={cn('skiper40-link skiper40-link-000', className)}
      {...props}
    >
      {children}
    </Comp>
  )
}

export function Link004({ children, href, className, onClick, ...props }) {
  const Comp = href ? 'a' : 'button'
  return (
    <Comp
      href={href}
      onClick={onClick}
      className={cn('skiper40-link skiper40-link-004', className)}
      {...props}
    >
      {children}
    </Comp>
  )
}

export function SkiperNavItem({
  children,
  active,
  onClick,
  className,
  title,
  ...props
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={title}
      /* The purple pill said "you are here" to anyone looking at it and to
         nobody using a screen reader; `aria-current` is the half of that
         statement the markup was missing. */
      aria-current={active ? 'page' : undefined}
      className={cn('skiper-nav-item', active && 'is-active', className)}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      {...props}
    >
      {active && (
        <motion.span
          layoutId="skiper-nav-active-pill"
          className="skiper-nav-active-bg"
          initial={false}
          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
        />
      )}
      <span className="skiper-nav-content">{children}</span>
    </motion.button>
  )
}
