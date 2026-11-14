import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { HomeRedirect, RequireJournal } from './guards.tsx'
import { SessionProvider } from './session.tsx'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { CheckinPage } from '../features/checkin/CheckinPage.tsx'
import { CheckinViewPage } from '../features/checkin/CheckinViewPage.tsx'
import { EvidencePage, GroundHoldPage, NotFoundPage, ReportsPage } from '../features/evidence/EvidencePage.tsx'
import { HistoryPage } from '../features/history/HistoryPage.tsx'
import { MeasurementsPage } from '../features/measurements/MeasurementsPage.tsx'
import { PreparePage } from '../features/prepare/PreparePage.tsx'
import { ProfilePage } from '../features/profile/ProfilePage.tsx'
import { OnboardShell } from '../features/shell/OnboardShell.tsx'
import { ConnectionPage } from '../features/sync/ConnectionPage.tsx'
import { TodayPage } from '../features/today/TodayPage.tsx'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/prepare" element={<PreparePage />} />
          <Route path="/ground/inbox" element={<GroundHoldPage />} />
          <Route path="/evidence" element={<EvidencePage />} />
          <Route element={<RequireJournal />}>
            <Route element={<OnboardShell />}>
              <Route path="/onboard/today" element={<TodayPage />} />
              <Route path="/onboard/checkin/new" element={<CheckinPage />} />
              <Route path="/onboard/checkin/:id" element={<CheckinViewPage />} />
              <Route path="/onboard/measurements" element={<MeasurementsPage />} />
              <Route path="/onboard/history" element={<HistoryPage />} />
              <Route path="/onboard/reports" element={<ReportsPage />} />
              <Route path="/onboard/profile" element={<ProfilePage />} />
              <Route path="/onboard/sync" element={<ConnectionPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
