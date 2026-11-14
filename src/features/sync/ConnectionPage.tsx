import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { Banner, Button } from '../../components/ui.tsx'
import { db } from '../../data/local/db.ts'
import { listOutbox } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { formatZoned } from '../../domain/clock.ts'
import { t } from '../../i18n/copy.ts'
import type { OutboxItem } from '../../data/local/types.ts'

export function ConnectionPage() {
  const session = useSession()
  const locale = session.locale
  const [rows, setRows] = useState<OutboxItem[]>([])
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  useEffect(() => {
    if (!session.profile) return
    void listOutbox(db, { ownerId: session.profile.owner_id, environmentId }).then(setRows)
  }, [session.profile?.owner_id, session.pending])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">{t(locale, 'sync')}</h1>
      <section className="rounded-xl border border-line p-4">
        <h2>{t(locale, 'serverUp').replace(t(locale, 'serverUp'), t(locale, 'checkLink'))}</h2>
        <p>{session.connection === 'online' ? t(locale, 'serverUp') : session.connection === 'auth_required' ? t(locale, 'authRequired') : session.connection === 'checking' ? t(locale, 'checking') : t(locale, 'serverDown')}</p>
        {checkedAt && session.profile ? <p className="numeric text-sm text-muted">{formatZoned(new Date(checkedAt), session.profile.timezone, locale === 'ru' ? 'ru' : 'en')}</p> : null}
        <Button
          className="mt-3"
          onClick={() => {
            void session.probe().then(() => setCheckedAt(new Date().toISOString()))
          }}
        >
          {t(locale, 'checkLink')}
        </Button>
      </section>
      <section className="rounded-xl border border-line p-4">
        <h2>{t(locale, 'authCard')}</h2>
        <p>{session.token ? t(locale, 'authOpen') : t(locale, 'authClosed')}</p>
        {!session.token ? <Link className="inline-flex min-h-11 items-center" to="/login">{t(locale, 'signIn')}</Link> : null}
      </section>
      <section className="rounded-xl border border-line p-4">
        <h2>{t(locale, 'queueCard')}</h2>
        <p>{rows.length === 0 ? t(locale, 'queueEmpty') : t(locale, 'queueCount', { count: rows.length })}</p>
        <p className="text-sm text-muted">{t(locale, 'syncLater')}</p>
        <p className="text-sm text-muted">{t(locale, 'noMarkDelivered')}</p>
        <Button className="mt-3" disabled>
          {t(locale, 'syncNow')}
        </Button>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>{t(locale, 'recordType')}</th>
                <th>{t(locale, 'created')}</th>
                <th>{t(locale, 'state')}</th>
                <th>{t(locale, 'attempts')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.operation_id} className="border-t border-line">
                  <td className="py-2">{row.entity_type === 'checkin_bundle' || row.entity_type === 'measurement' ? row.entity_type : t(locale, 'protectedPart')}</td>
                  <td className="numeric">{row.created_at}</td>
                  <td>{row.state}</td>
                  <td className="numeric">{row.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {session.connection === 'offline' ? <Banner tone="attention">{t(locale, 'serverDown')}</Banner> : null}
    </div>
  )
}
