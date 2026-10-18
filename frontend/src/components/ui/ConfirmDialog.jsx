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
    subject,
    description = item.description || item.message || item.text,
    confirmLabel = item.confirmLabel || item.confirmText || 'Confirm',
    cancelLabel = item.cancelLabel || item.cancelText || 'Cancel',
    tone = (item.danger || item.destructive || item.tone === 'danger')
      ? 'danger'
      : item.tone === 'warning'
      ? 'warning'
      : item.tone === 'success'
      ? 'success'
      : 'default',
  } = item

  return (
    <ConfirmationModal
      isOpen={Boolean(item)}
      onClose={() => resolveConfirm(false)}
      onConfirm={() => resolveConfirm(true)}
      title={title}
      subject={subject}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      tone={tone}
    />
  )
}
