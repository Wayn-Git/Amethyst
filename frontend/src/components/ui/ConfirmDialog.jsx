import { useEffect, useState } from 'react'
import { ConfirmationModal } from '../application/modals'
import { onConfirmState, confirm, resolveConfirm } from './confirmStore.js'

/** `const confirm = useConfirm(); if (await confirm({ title, description })) …` */
export function useConfirm() {
  return confirm
}

/**
 * UntitledUI Confirmation Dialog Host
 * Mounted in App.jsx root to present confirmation dialogs across all views.
 */
export default function ConfirmDialogHost() {
  const [item, setItem] = useState(null)

  useEffect(() => onConfirmState(setItem), [])

  if (!item) return null

  const {
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'default',
  } = item

  return (
    <ConfirmationModal
      isOpen={Boolean(item)}
      onClose={() => resolveConfirm(false)}
      onConfirm={() => resolveConfirm(true)}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      tone={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'default'}
    />
  )
}
