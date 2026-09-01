import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { AdminPortal } from './pages/AdminPortal'
import { BranchPortal } from './pages/BranchPortal'
import { LoginPage } from './pages/LoginPage'
import { AppStoreProvider, useAppStore } from './store/AppStore'

function SessionReplacementNotice() {
  const { sessionReplacementNotice, dismissSessionReplacementNotice } = useAppStore()
  if (!sessionReplacementNotice) return null
  return (
    <div className="session-replaced-overlay" role="alertdialog" aria-modal="true" aria-labelledby="session-replaced-title">
      <section className="session-replaced-dialog">
        <span className="session-replaced-dialog__icon" aria-hidden="true">!</span>
        <span className="eyebrow eyebrow--orange">SESSION ENDED</span>
        <h2 id="session-replaced-title">ออกจากระบบแล้ว</h2>
        <p>บัญชีนี้มีการเข้าสู่ระบบจากเครื่องอื่นแล้ว<br />จึงไม่สามารถใช้งานเครื่องนี้ต่อได้</p>
        <button className="button button--primary" type="button" onClick={dismissSessionReplacementNotice}>รับทราบ</button>
      </section>
    </div>
  )
}

export default function App() {
  return (
    <AppStoreProvider>
      <BrowserRouter>
        <SessionReplacementNotice />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/branch" element={<BranchPortal />} />
          <Route path="/admin" element={<AdminPortal />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AppStoreProvider>
  )
}
