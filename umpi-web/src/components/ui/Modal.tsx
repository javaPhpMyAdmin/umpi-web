import { useEffect, useRef } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
}

export default function Modal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  danger = false,
  loading = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const handleClose = () => {
    if (!loading) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className="backdrop:bg-black/40 bg-transparent rounded-2xl p-0 max-w-[360px] w-full shadow-2xl"
    >
      <div className="bg-surface rounded-2xl p-6 flex flex-col gap-4">
        {/* Icon */}
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${danger ? 'bg-error-container text-error' : 'bg-primary-container text-white'}`}>
          <span className="material-symbols-outlined text-[24px] material-symbols-filled">
            {danger ? 'delete' : 'help'}
          </span>
        </div>

        {/* Text */}
        <div className="text-center">
          <h3 className="font-header-md text-header-md text-on-surface mb-2">{title}</h3>
          <p className="font-body-base text-body-base text-text-secondary">{message}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-2">
          <button
            onClick={handleClose}
            disabled={loading}
            className="flex-1 h-[44px] rounded-[14px] border border-border-light text-on-surface font-label-bold text-label-bold hover:bg-surface-container-low transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 h-[44px] rounded-[14px] font-label-bold text-label-bold text-white transition-colors disabled:opacity-50 ${
              danger
                ? 'bg-error hover:bg-error-dark'
                : 'bg-primary-container hover:bg-primary-dark'
            }`}
          >
            {loading ? (
              <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </dialog>
  )
}
