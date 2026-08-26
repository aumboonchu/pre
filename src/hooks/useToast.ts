import { useCallback, useEffect, useState } from 'react'

export interface ToastState {
  message: string
  tone: 'success' | 'error'
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'success') => {
    setToast({ message, tone })
  }, [])

  return { toast, showToast }
}
