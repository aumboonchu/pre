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
import { api, ApiError } from '../lib/api'
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
  ReservationErrorCode,
  ReservationInput,
  ReservationResult,
  Session,
} from '../types'

const STATE_KEY = 'jib-pre-interest-state-v1'
const SESSION_KEY = 'jib-pre-interest-session-v1'
const REMOTE_MODE = import.meta.env.VITE_API_MODE === 'remote'
let fallbackQueue: Promise<void> = Promise.resolve()

const loadState = (): AppState => {
  if (REMOTE_MODE) return createSeedState()
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
  // In remote mode the HTTP-only cookie is the source of truth. Reusing the
  // previous tab's session before the matching server state has loaded can
  // create a /login <-> /branch redirect loop and leave React on a blank page.
  if (REMOTE_MODE) return null
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session
  } catch {
    return null
  }
}

interface AppStoreValue {
  state: AppState
  session: Session
  loginBranch: (identifier: string, password: string) => Promise<boolean>
  loginAdmin: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  reserve: (input: ReservationInput) => Promise<ReservationResult>
  cancel: (reservationId: string, reason: string) => Promise<void>
  uploadReceipt: (reservationId: string, receipt: Receipt) => Promise<void>
  approve: (reservationId: string) => Promise<void>
  reject: (reservationId: string) => Promise<void>
  changePassword: (current: string, next: string) => Promise<boolean>
  resetBranchPassword: (branchId: string) => Promise<void>
  upsertProduct: (product: Product) => Promise<void>
  importProducts: (products: Product[]) => Promise<void>
  deleteProducts: (productIds?: string[]) => Promise<number>
  upsertBranch: (branch: BranchUser) => Promise<void>
  importBranches: (branches: BranchUser[]) => Promise<void>
  deleteBranches: (branchIds?: string[]) => Promise<number>
  setBookingOpen: (open: boolean) => Promise<void>
  resetDemo: () => Promise<void>
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState)
  const [session, setSession] = useState<Session>(loadSession)
  const [ready, setReady] = useState(!REMOTE_MODE)
  const stateRef = useRef(state)

  const commit = useCallback((next: AppState) => {
    stateRef.current = next
    setState(next)
    if (!REMOTE_MODE) localStorage.setItem(STATE_KEY, JSON.stringify(next))
  }, [])

  const updateSession = useCallback((next: Session) => {
    setSession(next)
    try {
      if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
      else sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // The secure cookie still owns the remote session if browser storage is unavailable.
    }
  }, [])

  const refreshRemote = useCallback(async (): Promise<AppState> => {
    const next = await api.state()
    commit(next)
    return next
  }, [commit])

  const atomic = useCallback(
    async <T,>(mutation: (latest: AppState) => { state: AppState; value: T }): Promise<T> => {
      const execute = async () => {
        const latest = loadState()
        const result = mutation(latest)
        commit(result.state)
        return result.value
      }

      if ('locks' in navigator) return navigator.locks.request('jib-pre-interest-stock', execute)

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
    if (REMOTE_MODE) {
      let active = true
      void (async () => {
        try {
          const remoteSession = await api.session()
          if (!active) return
          await refreshRemote()
          if (active) updateSession(remoteSession)
        } catch (error) {
          if (active) {
            if (!(error instanceof ApiError) || error.status !== 401) {
              console.error('Unable to restore the remote session', error)
            }
            updateSession(null)
          }
        } finally {
          if (active) setReady(true)
        }
      })()
      return () => {
        active = false
      }
    }

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
  }, [commit, refreshRemote, updateSession])

  useEffect(() => {
    if (!REMOTE_MODE || !session) return
    const interval = window.setInterval(() => {
      void refreshRemote().catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) updateSession(null)
      })
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [refreshRemote, session, updateSession])

  const remoteLogin = useCallback(
    async (identifier: string, password: string, role: 'branch' | 'admin'): Promise<boolean> => {
      try {
        const nextSession = await api.login(identifier, password, role)
        await refreshRemote()
        updateSession(nextSession)
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return false
        throw error
      }
    },
    [refreshRemote, updateSession],
  )

  const loginBranch = useCallback(
    async (identifier: string, password: string) => {
      if (REMOTE_MODE) return remoteLogin(identifier, password, 'branch')
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
    [remoteLogin, updateSession],
  )

  const loginAdmin = useCallback(
    async (username: string, password: string) => {
      if (REMOTE_MODE) return remoteLogin(username, password, 'admin')
      const valid =
        stateRef.current.admin.username === username.trim() &&
        stateRef.current.admin.password === password
      if (valid) updateSession({ role: 'admin' })
      return valid
    },
    [remoteLogin, updateSession],
  )

  const logout = useCallback(async () => {
    if (REMOTE_MODE) {
      try {
        await api.logout()
      } finally {
        updateSession(null)
        commit(createSeedState())
      }
      return
    }
    updateSession(null)
  }, [commit, updateSession])

  const reserve = useCallback(
    async (input: ReservationInput): Promise<ReservationResult> => {
      if (!REMOTE_MODE) {
        return atomic((latest) => {
          const result = reserveOne(latest, input)
          return { state: result.state, value: result }
        })
      }
      try {
        const created = await api.reserve(input)
        if (input.receipt) await api.uploadReceipt(created.reservationId, input.receipt)
        const next = await refreshRemote()
        const reservation = next.reservations.find((item) => item.id === created.reservationId)
        if (!reservation) throw new Error('ไม่พบรายการที่เพิ่งสร้าง')
        return { ok: true, state: next, reservation, replayed: created.replayed }
      } catch (error) {
        if (error instanceof ApiError) {
          const knownCodes: ReservationErrorCode[] = ['SOLD_OUT', 'BOOKING_CLOSED', 'PRODUCT_NOT_FOUND', 'DUPLICATE']
          if (knownCodes.includes(error.code as ReservationErrorCode)) {
            await refreshRemote().catch(() => undefined)
            return {
              ok: false,
              state: stateRef.current,
              code: error.code as ReservationErrorCode,
              message: error.message,
            }
          }
        }
        throw error
      }
    },
    [atomic, refreshRemote],
  )

  const cancel = useCallback(
    async (reservationId: string, reason: string) => {
      if (REMOTE_MODE) {
        await api.cancel(reservationId, reason)
        await refreshRemote()
        return
      }
      await atomic((latest) => ({ state: cancelReservation(latest, reservationId, reason), value: undefined }))
    },
    [atomic, refreshRemote],
  )

  const uploadReceipt = useCallback(
    async (reservationId: string, receipt: Receipt) => {
      if (REMOTE_MODE) {
        await api.uploadReceipt(reservationId, receipt)
        await refreshRemote()
        return
      }
      await atomic((latest) => ({ state: attachReceipt(latest, reservationId, receipt), value: undefined }))
    },
    [atomic, refreshRemote],
  )

  const approve = useCallback(
    async (reservationId: string) => {
      if (REMOTE_MODE) {
        await api.setReservationStatus(reservationId, 'Confirmed')
        await refreshRemote()
        return
      }
      await atomic((latest) => ({ state: confirmReservation(latest, reservationId), value: undefined }))
    },
    [atomic, refreshRemote],
  )

  const reject = useCallback(
    async (reservationId: string) => {
      if (REMOTE_MODE) {
        await api.setReservationStatus(reservationId, 'Cancel')
        await refreshRemote()
        return
      }
      await atomic((latest) => ({ state: cancelReservation(latest, reservationId, 'Admin ไม่อนุมัติ'), value: undefined }))
    },
    [atomic, refreshRemote],
  )

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (REMOTE_MODE) {
        try {
          await api.changePassword(current, next)
          return true
        } catch (error) {
          if (error instanceof ApiError && error.code === 'INVALID_PASSWORD') return false
          throw error
        }
      }

      if (session?.role === 'admin') {
        if (stateRef.current.admin.password !== current) return false
        commit({ ...stateRef.current, admin: { ...stateRef.current.admin, password: next } })
        return true
      }

      if (session?.role !== 'branch') return false
      const branch = stateRef.current.branches.find((item) => item.id === session.branchId)
      if (!branch || branch.password !== current) return false
      commit({ ...stateRef.current, branches: stateRef.current.branches.map((item) => item.id === branch.id ? { ...item, password: next } : item) })
      return true
    },
    [commit, session],
  )

  const resetBranchPassword = useCallback(
    async (branchId: string) => {
      if (REMOTE_MODE) {
        await api.resetBranchPassword(branchId)
        await refreshRemote()
        return
      }
      commit({
        ...stateRef.current,
        branches: stateRef.current.branches.map((branch) => branch.id === branchId ? { ...branch, password: '1234' } : branch),
      })
    },
    [commit, refreshRemote],
  )

  const upsertProduct = useCallback(
    async (product: Product) => {
      if (REMOTE_MODE) {
        await api.upsertProduct(product)
        await refreshRemote()
        return
      }
      const existing = stateRef.current.products.find((item) => item.id === product.id)
      const activeReservations = stateRef.current.reservations.filter(
        (reservation) => reservation.productId === product.id && reservation.status !== 'Cancel',
      ).length
      const safeTotal = Math.max(product.totalStock, activeReservations)
      const normalized = { ...product, totalStock: safeTotal, remainingStock: Math.max(0, safeTotal - activeReservations) }
      commit({
        ...stateRef.current,
        products: existing
          ? stateRef.current.products.map((item) => item.id === product.id ? normalized : item)
          : [normalized, ...stateRef.current.products],
      })
    },
    [commit, refreshRemote],
  )

  const importProducts = useCallback(
    async (products: Product[]) => {
      if (REMOTE_MODE) {
        await api.importProducts(products)
        await refreshRemote()
        return
      }
      const imported = products.map((product) => {
        const existing = stateRef.current.products.find((item) => item.id === product.id)
        return existing ? { ...product, totalStock: existing.totalStock, remainingStock: existing.remainingStock } : product
      })
      commit({ ...stateRef.current, products: imported })
    },
    [commit, refreshRemote],
  )

  const deleteProducts = useCallback(
    async (productIds?: string[]) => {
      if (REMOTE_MODE) {
        const count = await api.deleteProducts(productIds)
        await refreshRemote()
        return count
      }
      const ids = new Set(productIds ?? stateRef.current.products.map((product) => product.id))
      const inUse = stateRef.current.reservations.find((reservation) => ids.has(reservation.productId))
      if (inUse) throw new Error(`ลบไม่ได้ เนื่องจาก ${inUse.productId} มีประวัติการจอง`)
      const nextProducts = stateRef.current.products.filter((product) => !ids.has(product.id))
      const count = stateRef.current.products.length - nextProducts.length
      commit({ ...stateRef.current, products: nextProducts })
      return count
    },
    [commit, refreshRemote],
  )

  const upsertBranch = useCallback(
    async (branch: BranchUser) => {
      if (REMOTE_MODE) {
        await api.upsertBranch(branch)
        await refreshRemote()
        return
      }
      const exists = stateRef.current.branches.some((item) => item.id === branch.id)
      commit({
        ...stateRef.current,
        branches: exists
          ? stateRef.current.branches.map((item) => item.id === branch.id ? branch : item)
          : [branch, ...stateRef.current.branches],
      })
    },
    [commit, refreshRemote],
  )

  const importBranches = useCallback(
    async (branches: BranchUser[]) => {
      if (REMOTE_MODE) {
        await api.importBranches(branches)
        await refreshRemote()
        return
      }
      const imported = branches.map((branch) => {
        const existing = stateRef.current.branches.find((item) => item.id === branch.id)
        return existing ? { ...branch, password: existing.password, active: existing.active } : branch
      })
      commit({ ...stateRef.current, branches: imported })
    },
    [commit, refreshRemote],
  )

  const deleteBranches = useCallback(
    async (branchIds?: string[]) => {
      if (REMOTE_MODE) {
        const count = await api.deleteBranches(branchIds)
        await refreshRemote()
        return count
      }
      const ids = new Set(branchIds ?? stateRef.current.branches.map((branch) => branch.id))
      const inUse = stateRef.current.reservations.find((reservation) => ids.has(reservation.branchId))
      if (inUse) throw new Error(`ลบไม่ได้ เนื่องจาก JIB-${inUse.branchId} มีประวัติการจอง`)
      const nextBranches = stateRef.current.branches.filter((branch) => !ids.has(branch.id))
      const count = stateRef.current.branches.length - nextBranches.length
      commit({ ...stateRef.current, branches: nextBranches })
      return count
    },
    [commit, refreshRemote],
  )

  const setBookingOpen = useCallback(
    async (open: boolean) => {
      if (REMOTE_MODE) {
        await api.setBookingOpen(open)
        await refreshRemote()
        return
      }
      commit({ ...stateRef.current, settings: { ...stateRef.current.settings, bookingOpen: open } })
    },
    [commit, refreshRemote],
  )

  const resetDemo = useCallback(async () => {
    if (REMOTE_MODE) {
      await logout()
      return
    }
    commit(createSeedState())
    updateSession(null)
  }, [commit, logout, updateSession])

  const value = useMemo<AppStoreValue>(
    () => ({
      state, session, loginBranch, loginAdmin, logout, reserve, cancel, uploadReceipt,
      approve, reject, changePassword, resetBranchPassword, upsertProduct,
      importProducts, deleteProducts, upsertBranch, importBranches, deleteBranches, setBookingOpen, resetDemo,
    }),
    [
      state, session, loginBranch, loginAdmin, logout, reserve, cancel, uploadReceipt,
      approve, reject, changePassword, resetBranchPassword, upsertProduct,
      importProducts, deleteProducts, upsertBranch, importBranches, deleteBranches, setBookingOpen, resetDemo,
    ],
  )

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <span className="app-loading__mark">JIB</span>
        <strong>กำลังโหลดระบบ...</strong>
      </div>
    )
  }

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore() {
  const context = useContext(AppStoreContext)
  if (!context) throw new Error('useAppStore must be used inside AppStoreProvider')
  return context
}
