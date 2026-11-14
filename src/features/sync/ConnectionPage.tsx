import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { AppDialog, Banner, Button } from '../../components/ui.tsx'
import { db } from '../../data/local/db.ts'
import { listOutbox, requestRetry } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { formatZoned } from '../../domain/clock.ts'
import { outboxEntityLabel, outboxStateLabel } from '../../domain/labels.ts'
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
        <ul className="mt-4 flex flex-col gap-3">
          {visible.map((row) => (
            <li key={row.operation_id} className="rounded-xl border border-line p-3">
              <p>{outboxEntityLabel(locale, row.entity_type)}</p>
              <p className="mt-1 text-sm">{outboxStateLabel(locale, row.state)}</p>
              <dl className="mt-2 grid gap-1 text-sm text-muted sm:grid-cols-2">
                <div>
                  <dt>{t(locale, 'created')}</dt>
                  <dd className="numeric">
                    {profile ? formatZoned(new Date(row.created_at), profile.timezone, locale === 'ru' ? 'ru' : 'en') : row.created_at}
                  </dd>
                </div>
                <div>
                  <dt>{t(locale, 'attempts')}</dt>
                  <dd className="numeric">{row.attempts}</dd>
                </div>
                <div>
                  <dt>{t(locale, 'nextTry')}</dt>
                  <dd className="numeric">
                    {profile
                      ? formatZoned(new Date(row.next_attempt_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')
                      : row.next_attempt_at}
                  </dd>
                </div>
                {row.last_error_code ? (
                  <div>
                    <dt>{t(locale, 'lastError')}</dt>
                    <dd>{row.last_error_code}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {row.state === 'retry_wait' || row.state === 'blocked_auth' ? (
                  <Button variant="quiet" onClick={() => void synchronize(row.operation_id)}>
                    {t(locale, 'retry')}
                  </Button>
                ) : null}
                {row.last_error_code ? (
                  <Button variant="quiet" onClick={() => setReason(row.last_error_code)}>
                    {t(locale, 'showReason')}
                  </Button>
                ) : null}
              </div>
              {row.state === 'conflict' ? <p className="mt-2 text-sm">{t(locale, 'conflictKept')}</p> : null}
            </li>
          ))}
        </ul>
      </section>
      {session.connection === 'offline' ? <Banner tone="attention">{t(locale, 'serverDown')}</Banner> : null}
      <AppDialog open={reason !== null} title={t(locale, 'showReason')} description={reason ?? ''} onOpenChange={(open) => { if (!open) setReason(null) }}>
        <Button variant="quiet" onClick={() => setReason(null)}>{t(locale, 'back')}</Button>
      </AppDialog>
    </div>
  )
}

