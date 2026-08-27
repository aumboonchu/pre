import type { ReactNode } from 'react'
import type { ReservationStatus } from '../types'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand-mark">JIB</span>
      <span className="brand-name">PRE-INTEREST</span>
    </div>
  )
}

export function StatusBadge({ status }: { status: ReservationStatus }) {
  const className =
    status === 'Confirmed'
      ? 'status status--confirmed'
      : status === 'Cancel'
        ? 'status status--cancel'
        : 'status status--waiting'
  return <span className={className}>{status}</span>
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <span className="eyebrow">JIB PRE-INTEREST</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">◎</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

export function Toast({ message, tone = 'success' }: { message: string; tone?: 'success' | 'error' }) {
  return (
    <div className={`toast toast--${tone}`} role="status">
      <span>{tone === 'success' ? '✓' : '!'}</span>
      {message}
    </div>
  )
}
