import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { AdminPortal } from './pages/AdminPortal'
import { BranchPortal } from './pages/BranchPortal'
import { LoginPage } from './pages/LoginPage'
import { AppStoreProvider } from './store/AppStore'

export default function App() {
  return (
    <AppStoreProvider>
      <BrowserRouter>
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
