import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { AppDialog, Banner, Button } from '../../components/ui.tsx'
import { db } from '../../data/local/db.ts'
import { listOutbox, requestRetry } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { formatZoned } from '../../domain/clock.ts'
import { browserDelivery } from '../../services/delivery.ts'
import { t } from '../../i18n/copy.ts'
import type { OutboxItem } from '../../data/local/types.ts'

export function ConnectionPage() {
  const session = useSession()
  const locale = session.locale
  const profile = session.profile
  const [rows, setRows] = useState<OutboxItem[]>([])
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [hideAccepted, setHideAccepted] = useState(true)
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mismatch = Boolean(profile && session.userId && session.userId !== profile.owner_id)

  useEffect(() => {
    if (!profile) return
    void listOutbox(db, { ownerId: profile.owner_id, environmentId }).then(setRows)
  }, [profile?.owner_id, session.pending])

  async function synchronize(operationId?: string) {
    if (!profile || busy) return
    setBusy(true)
    if (operationId) await requestRetry(db, { ownerId: profile.owner_id, environmentId }, operationId)
    await browserDelivery(db, { ownerId: profile.owner_id, environmentId }, session.userId, session.token, true)
    await session.refreshLocal()
    setRows(await listOutbox(db, { ownerId: profile.owner_id, environmentId }))
    setCheckedAt(new Date().toISOString())
    setBusy(false)
  }

  const visible = rows.filter((row) => (hideAccepted ? row.state !== 'accepted' : true))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">{t(locale, 'sync')}</h1>
      <section className="rounded-xl border border-line p-4">
        <h2>{t(locale, 'checkLink')}</h2>
        <p>{session.connection === 'online' ? t(locale, 'serverUp') : session.connection === 'auth_required' ? t(locale, 'authRequired') : session.connection === 'checking' ? t(locale, 'checking') : t(locale, 'serverDown')}</p>
        {checkedAt && profile ? <p className="numeric text-sm text-muted">{formatZoned(new Date(checkedAt), profile.timezone, locale === 'ru' ? 'ru' : 'en')}</p> : null}
        <Button className="mt-3" onClick={() => void session.probe().then(() => setCheckedAt(new Date().toISOString()))}>
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
        <p>{visible.length === 0 ? t(locale, 'queueEmpty') : t(locale, 'queueCount', { count: visible.length })}</p>
        <p className="text-sm text-muted">{t(locale, 'syncLater')}</p>
        <p className="text-sm text-muted">{t(locale, 'noMarkDelivered')}</p>
        {mismatch ? <p>{t(locale, 'ownerMismatch')}</p> : null}
        <label className="mt-3 flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={hideAccepted} onChange={(event) => setHideAccepted(event.target.checked)} />
          {t(locale, 'hideAccepted')}
        </label>
        <Button className="mt-3" disabled={busy || !profile || mismatch} onClick={() => void synchronize()}>
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
                <th>{t(locale, 'nextTry')}</th>
                <th>{t(locale, 'lastError')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.operation_id} className="border-t border-line">
                  <td className="py-2">{row.entity_type === 'checkin_bundle' || row.entity_type === 'measurement' ? row.entity_type : t(locale, 'protectedPart')}</td>
                  <td className="numeric">{row.created_at}</td>
                  <td>{row.state}</td>
                  <td className="numeric">{row.attempts}</td>
                  <td className="numeric">{row.next_attempt_at}</td>
                  <td>{row.last_error_code ?? ''}</td>
                  <td>
                    {row.state === 'retry_wait' || row.state === 'blocked_auth' ? (
                      <Button variant="quiet" onClick={() => void synchronize(row.operation_id)}>{t(locale, 'retry')}</Button>
                    ) : null}
                    {row.last_error_code ? <Button variant="quiet" onClick={() => setReason(row.last_error_code)}>{t(locale, 'showReason')}</Button> : null}
                    {row.state === 'conflict' ? <p>{t(locale, 'conflictKept')}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {session.connection === 'offline' ? <Banner tone="attention">{t(locale, 'serverDown')}</Banner> : null}
      <AppDialog open={reason !== null} title={t(locale, 'showReason')} description={reason ?? ''} onOpenChange={(open) => { if (!open) setReason(null) }}>
        <Button variant="quiet" onClick={() => setReason(null)}>{t(locale, 'back')}</Button>
      </AppDialog>
    </div>
  )
}

