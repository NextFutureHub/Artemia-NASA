import { Navigate, Outlet } from 'react-router-dom'
import { useSession } from './session.tsx'
import { t } from '../i18n/copy.ts'

export function RequireJournal() {
  const session = useSession()
  if (!session.ready) return <p className="p-6 text-muted">{t(session.locale, 'loading')}</p>
  if (!session.profile) return <Navigate to="/login" replace />
  return <Outlet />
}

export function HomeRedirect() {
  const session = useSession()
  if (!session.ready || !session.roleChecked) return <p className="p-6 text-muted">{t(session.locale, 'loading')}</p>
  if (session.role === 'doctor' && session.token) return <Navigate to="/ground/inbox" replace />
  if (session.profile) return <Navigate to="/onboard/today" replace />
  return <Navigate to="/login" replace />
}
