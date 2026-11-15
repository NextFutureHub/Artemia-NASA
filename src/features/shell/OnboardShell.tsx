import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { formatUtcClock, missionDay } from '../../domain/clock.ts'
import { db } from '../../data/local/db.ts'
import { clearOwner } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { browserDelivery } from '../../services/delivery.ts'
import { t } from '../../i18n/copy.ts'
import { useSession } from '../../app/session.tsx'
import { AppDialog, Button } from '../../components/ui.tsx'

export function OnboardShell() {
  const session = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const locale = session.locale
  const day = session.mission ? missionDay(new Date(session.mission.start_at), now) : null
  const dayText =
    day?.phase === 'in_mission'
      ? t(locale, 'missionDay', { day: day.day })
      : day?.phase === 'before'
        ? t(locale, 'beforeStart', { days: day.days })
        : ''
  const connectionText = {
    checking: t(locale, 'checking'),
    online: t(locale, 'serverUp'),
    offline: t(locale, 'serverDown'),
    auth_required: t(locale, 'authRequired'),
  }[session.connection]

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const profile = session.profile
    if (!profile || !session.token || session.userId !== profile.owner_id) return
    let stop = false
    const run = () => {
      if (stop) return
      void browserDelivery(db, { ownerId: profile.owner_id, environmentId }, session.userId, session.token, false).finally(() => {
        void session.refreshLocal()
      })
    }
    const kick = window.setTimeout(run, 0)
    const timer = window.setInterval(run, 15_000)
    window.addEventListener('focus', run)
    return () => {
      stop = true
      window.clearTimeout(kick)
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
    }
  }, [session.profile?.owner_id, session.token, session.userId])

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className={`${open ? 'flex' : 'hidden'} min-h-screen flex-col border-r border-line bg-surface p-4 md:flex`}>
        <p className="text-xl tracking-tight">{t(locale, 'appName')}</p>
        <nav id="board-menu" className="mt-6 flex flex-1 flex-col gap-1" aria-label={t(locale, 'menu')}>
          <ShellLink to="/onboard/today" label={t(locale, 'today')} onNavigate={() => setOpen(false)} />
          <ShellLink to="/onboard/measurements" label={t(locale, 'measurements')} onNavigate={() => setOpen(false)} />
          <ShellLink to="/onboard/activity" label={t(locale, 'activityNav')} onNavigate={() => setOpen(false)} />
          <ShellLink to="/onboard/orders" label={t(locale, 'careOrders')} onNavigate={() => setOpen(false)} />
          <ShellLink to="/onboard/history" label={t(locale, 'history')} onNavigate={() => setOpen(false)} />
          <ShellLink to="/onboard/reports" label={t(locale, 'reports')} onNavigate={() => setOpen(false)} />
        </nav>
        <div className="flex flex-col gap-1">
          <ShellLink to="/evidence" label={t(locale, 'sources')} onNavigate={() => setOpen(false)} />
          <ShellLink to="/onboard/profile" label={t(locale, 'profile')} onNavigate={() => setOpen(false)} />
          <button type="button" className="min-h-11 rounded-xl px-3 text-left" onClick={() => setSignOutOpen(true)}>
            {t(locale, 'logout')}
          </button>
          <div className="mt-3 flex gap-2">
            <LocaleButton locale="ru" current={locale} onChange={session.setLocale} />
            <LocaleButton locale="en" current={locale} onChange={session.setLocale} />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-16 items-center gap-3 border-b border-line px-4">
          <Button variant="quiet" className="md:hidden" aria-expanded={open} aria-controls="board-menu" onClick={() => setOpen((value) => !value)}>
            {t(locale, 'menu')}
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate">{session.mission?.name}</p>
            <p className="numeric text-sm text-muted">
              {dayText ? `${dayText} · ` : ''}
              {formatUtcClock(now)}
              {session.profile?.callsign ? ` · ${session.profile.callsign}` : ''}
            </p>
          </div>
          <button type="button" className="min-h-11 shrink-0 text-left text-sm" onClick={() => navigate('/onboard/sync')}>
            <StatusMark state={session.connection} /> {connectionText}
            <span className="mt-0.5 block numeric text-muted">{t(locale, 'queueCount', { count: session.pending })}</span>
          </button>
        </header>
        {environmentId === 'demo' ? (
          <p className="border-b border-line px-4 py-2 text-sm text-attention">{t(locale, 'demo')}</p>
        ) : null}
        <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
          <Outlet />
        </main>
        <AppDialog
          open={signOutOpen}
          onOpenChange={setSignOutOpen}
          title={t(locale, 'logout')}
          description={t(locale, 'signOutBody')}
        >
          <Button
            variant="primary"
            onClick={() => {
              session.logout()
              setSignOutOpen(false)
              navigate('/login')
            }}
          >
            {t(locale, 'signOutKeep')}
          </Button>
          <Button
            variant="danger"
            disabled={session.pending > 0 || !session.profile}
            onClick={() => {
              if (!session.profile) return
              void clearOwner(db, { ownerId: session.profile.owner_id, environmentId }).then(async (result) => {
                if (!result.ok) return
                session.logout()
                await session.refreshLocal()
                setSignOutOpen(false)
                navigate('/login')
              })
            }}
          >
            {t(locale, 'signOutClear')}
          </Button>
          <Button variant="quiet" onClick={() => setSignOutOpen(false)}>
            {t(locale, 'cancel')}
          </Button>
        </AppDialog>
        {session.pending > 0 && signOutOpen ? (
          <p className="sr-only">{t(locale, 'clearBlocked', { count: session.pending })}</p>
        ) : null}
      </div>
    </div>
  )
}

function ShellLink({ to, label, onNavigate }: { to: string; label: string; onNavigate: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) => `flex min-h-11 items-center rounded-xl px-3 ${isActive ? 'bg-canvas text-accent' : ''}`}
    >
      {label}
    </NavLink>
  )
}

function LocaleButton({
  locale,
  current,
  onChange,
}: {
  locale: 'ru' | 'en'
  current: 'ru' | 'en'
  onChange: (locale: 'ru' | 'en') => void
}) {
  return (
    <button
      type="button"
      aria-pressed={current === locale}
      className={`min-h-11 flex-1 rounded-xl border ${current === locale ? 'border-accent' : 'border-line'}`}
      onClick={() => onChange(locale)}
    >
      {locale.toUpperCase()}
    </button>
  )
}

function StatusMark({ state }: { state: 'checking' | 'online' | 'offline' | 'auth_required' }) {
  const symbol = state === 'online' ? '●' : state === 'offline' ? '○' : state === 'auth_required' ? '!' : '…'
  return (
    <span aria-hidden="true" className={state === 'offline' || state === 'auth_required' ? 'text-attention' : 'text-accent'}>
      {symbol}
    </span>
  )
}
