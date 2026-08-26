/* oxlint-disable react/only-export-components */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createSeedState } from '../data/seed'
import {
  attachReceipt,
  cancelReservation,
  confirmReservation,
  expireMissingReceipts,
  reserveOne,
} from '../lib/reservationEngine'
import type {
  AppState,
  BranchUser,
  Product,
  Receipt,
  ReservationInput,
  ReservationResult,
  Session,
} from '../types'

const STATE_KEY = 'jib-pre-interest-state-v1'
const SESSION_KEY = 'jib-pre-interest-session-v1'
let fallbackQueue: Promise<void> = Promise.resolve()

const loadState = (): AppState => {
  try {
    const stored = localStorage.getItem(STATE_KEY)
    if (!stored) return createSeedState()
    const parsed = JSON.parse(stored) as AppState
    if (parsed.schemaVersion !== 1) return createSeedState()
    return expireMissingReceipts(parsed)
  } catch {
    return createSeedState()
  }
}

const loadSession = (): Session => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session
  } catch {
    return null
  }
}

interface AppStoreValue {
  state: AppState
  session: Session
  loginBranch: (identifier: string, password: string) => boolean
  loginAdmin: (username: string, password: string) => boolean
  logout: () => void
  reserve: (input: ReservationInput) => Promise<ReservationResult>
  cancel: (reservationId: string, reason: string) => Promise<void>
  uploadReceipt: (reservationId: string, receipt: Receipt) => Promise<void>
  approve: (reservationId: string) => Promise<void>
  reject: (reservationId: string) => Promise<void>
  changeBranchPassword: (branchId: string, current: string, next: string) => boolean
  resetBranchPassword: (branchId: string) => void
  upsertProduct: (product: Product) => void
  importProducts: (products: Product[]) => void
  upsertBranch: (branch: BranchUser) => void
  importBranches: (branches: BranchUser[]) => void
  setBookingOpen: (open: boolean) => void
  resetDemo: () => void
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState)
  const [session, setSession] = useState<Session>(loadSession)
  const stateRef = useRef(state)

  const commit = useCallback((next: AppState) => {
    stateRef.current = next
    setState(next)
    localStorage.setItem(STATE_KEY, JSON.stringify(next))
  }, [])

  const atomic = useCallback(
    async <T,>(mutation: (latest: AppState) => { state: AppState; value: T }): Promise<T> => {
      const execute = async () => {
        const latest = loadState()
        const result = mutation(latest)
        commit(result.state)
        return result.value
      }

      if ('locks' in navigator) {
        return navigator.locks.request('jib-pre-interest-stock', execute)
      }

      let resolveValue: (value: T) => void
      let rejectValue: (reason?: unknown) => void
      const value = new Promise<T>((resolve, reject) => {
        resolveValue = resolve
        rejectValue = reject
      })
      fallbackQueue = fallbackQueue.then(async () => {
        try {
          resolveValue(await execute())
        } catch (error) {
          rejectValue(error)
        }
      })
      return value
    },
    [commit],
  )

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STATE_KEY && event.newValue) {
        const next = expireMissingReceipts(JSON.parse(event.newValue) as AppState)
        stateRef.current = next
        setState(next)
      }
    }
    window.addEventListener('storage', sync)
    const interval = window.setInterval(() => {
      const next = expireMissingReceipts(stateRef.current)
      if (next !== stateRef.current) commit(next)
    }, 60_000)
    return () => {
      window.removeEventListener('storage', sync)
      window.clearInterval(interval)
    }
  }, [commit])

  const updateSession = useCallback((next: Session) => {
    setSession(next)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
  }, [])

  const loginBranch = useCallback(
    (identifier: string, password: string) => {
      const normalized = identifier.trim().toLowerCase()
      const branch = stateRef.current.branches.find(
        (item) =>
          item.active &&
          [item.id, item.code, item.username].some(
            (candidate) => candidate.toLowerCase() === normalized,
          ) &&
          item.password === password,
      )
      if (!branch) return false
      updateSession({ role: 'branch', branchId: branch.id })
      return true
    },
    [updateSession],
  )

  const loginAdmin = useCallback(
    (username: string, password: string) => {
      const valid =
        stateRef.current.admin.username === username.trim() &&
        stateRef.current.admin.password === password
      if (valid) updateSession({ role: 'admin' })
      return valid
    },
    [updateSession],
  )

  const reserve = useCallback(
    (input: ReservationInput) =>
      atomic((latest) => {
        const result = reserveOne(latest, input)
        return { state: result.state, value: result }
      }),
    [atomic],
  )

  const cancel = useCallback(
    async (reservationId: string, reason: string) => {
      await atomic((latest) => ({
        state: cancelReservation(latest, reservationId, reason),
        value: undefined,
      }))
    },
    [atomic],
  )

  const uploadReceipt = useCallback(
    async (reservationId: string, receipt: Receipt) => {
      await atomic((latest) => ({
        state: attachReceipt(latest, reservationId, receipt),
        value: undefined,
      }))
    },
    [atomic],
  )

  const approve = useCallback(
    async (reservationId: string) => {
      await atomic((latest) => ({
        state: confirmReservation(latest, reservationId),
        value: undefined,
      }))
    },
    [atomic],
  )

  const reject = useCallback(
    async (reservationId: string) => {
      await atomic((latest) => ({
        state: cancelReservation(latest, reservationId, 'Admin ไม่อนุมัติ'),
        value: undefined,
      }))
    },
    [atomic],
  )

  const changeBranchPassword = useCallback(
    (branchId: string, current: string, next: string) => {
      const branch = stateRef.current.branches.find((item) => item.id === branchId)
      if (!branch || branch.password !== current) return false
      commit({
        ...stateRef.current,
        branches: stateRef.current.branches.map((item) =>
          item.id === branchId ? { ...item, password: next } : item,
        ),
      })
      return true
    },
    [commit],
  )

  const resetBranchPassword = useCallback(
    (branchId: string) => {
      commit({
        ...stateRef.current,
        branches: stateRef.current.branches.map((branch) =>
          branch.id === branchId ? { ...branch, password: '1234' } : branch,
        ),
      })
    },
    [commit],
  )

  const upsertProduct = useCallback(
    (product: Product) => {
      const existing = stateRef.current.products.find((item) => item.id === product.id)
      const activeReservations = stateRef.current.reservations.filter(
        (reservation) => reservation.productId === product.id && reservation.status !== 'Cancel',
      ).length
      const safeTotal = Math.max(product.totalStock, activeReservations)
      const normalized = {
        ...product,
        totalStock: safeTotal,
        remainingStock: Math.max(0, safeTotal - activeReservations),
      }
      commit({
        ...stateRef.current,
        products: existing
          ? stateRef.current.products.map((item) =>
              item.id === product.id ? normalized : item,
            )
          : [normalized, ...stateRef.current.products],
      })
    },
    [commit],
  )

  const importProducts = useCallback(
    (products: Product[]) => {
      const imported = products.map((product) => {
        const existing = stateRef.current.products.find((item) => item.id === product.id)
        return existing
          ? { ...product, totalStock: existing.totalStock, remainingStock: existing.remainingStock }
          : product
      })
      commit({ ...stateRef.current, products: imported })
    },
    [commit],
  )

  const upsertBranch = useCallback(
    (branch: BranchUser) => {
      const exists = stateRef.current.branches.some((item) => item.id === branch.id)
      commit({
        ...stateRef.current,
        branches: exists
          ? stateRef.current.branches.map((item) => (item.id === branch.id ? branch : item))
          : [branch, ...stateRef.current.branches],
      })
    },
    [commit],
  )

  const importBranches = useCallback(
    (branches: BranchUser[]) => {
      const imported = branches.map((branch) => {
        const existing = stateRef.current.branches.find((item) => item.id === branch.id)
        return existing ? { ...branch, password: existing.password, active: existing.active } : branch
      })
      commit({ ...stateRef.current, branches: imported })
    },
    [commit],
  )

  const setBookingOpen = useCallback(
    (open: boolean) => {
      commit({
        ...stateRef.current,
        settings: { ...stateRef.current.settings, bookingOpen: open },
      })
    },
    [commit],
  )

  const resetDemo = useCallback(() => {
    commit(createSeedState())
    updateSession(null)
  }, [commit, updateSession])

  const value = useMemo<AppStoreValue>(
    () => ({
      state,
      session,
      loginBranch,
      loginAdmin,
      logout: () => updateSession(null),
      reserve,
      cancel,
      uploadReceipt,
      approve,
      reject,
      changeBranchPassword,
      resetBranchPassword,
      upsertProduct,
      importProducts,
      upsertBranch,
      importBranches,
      setBookingOpen,
      resetDemo,
    }),
    [
      state,
      session,
      loginBranch,
      loginAdmin,
      updateSession,
      reserve,
      cancel,
      uploadReceipt,
      approve,
      reject,
      changeBranchPassword,
      resetBranchPassword,
      upsertProduct,
      importProducts,
      upsertBranch,
      importBranches,
      setBookingOpen,
      resetDemo,
    ],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore() {
  const context = useContext(AppStoreContext)
  if (!context) throw new Error('useAppStore must be used inside AppStoreProvider')
  return context
}
