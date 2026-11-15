import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { PageIntro } from '../../components/FormChrome.tsx'
import { Banner, Button, Card, Field } from '../../components/ui.tsx'
import { buildCareOrderResponse } from '../../domain/careOrder.ts'
import { careKindLabel, careStatusLabel } from '../../domain/labels.ts'
import { formatZoned } from '../../domain/clock.ts'
import { commitCareOrderResponse, listCareOrders } from '../../data/local/careOrders.ts'
import { db } from '../../data/local/db.ts'
import { environmentId } from '../../data/remote/client.ts'
import { t } from '../../i18n/copy.ts'
import type { LocalCareOrder } from '../../data/local/types.ts'

export function OrdersPage() {
  const session = useSession()
  const locale = session.locale
  const profile = session.profile
  const [rows, setRows] = useState<LocalCareOrder[]>([])
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [note, setNote] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    void listCareOrders(db, { ownerId: profile.owner_id, environmentId }).then(setRows)
  }, [profile?.owner_id, session.pending])

  if (!profile) return null
  const active = rows.filter((row) => row.status === 'active' || row.ack_required)
  const history = rows.filter((row) => row.status !== 'active' || row.last_decision)
  const visible = tab === 'active' ? active : history

  async function respond(order: LocalCareOrder, decision: 'done' | 'skipped' | 'acknowledged' | 'unable') {
    if (busy || !profile) return
    const ownerId = profile.owner_id
    setBusy(order.id)
    const now = new Date().toISOString()
    const built = buildCareOrderResponse({
      id: crypto.randomUUID(),
      orderId: order.id,
      missionId: order.mission_id,
      decision,
      note: decision === 'acknowledged' ? null : note[order.id]?.trim() || null,
      linkNote: null,
      recordedAt: now,
      createdAtDevice: now,
    })
    if (!built.payload) {
      setMessage(t(locale, 'errors'))
      setBusy(null)
      return
    }
    const operationId = crypto.randomUUID()
    const result = await commitCareOrderResponse(db, { ownerId, environmentId }, order, built.payload, operationId)
    if (result.status === 'committed') {
      setMessage(t(locale, 'careResponseSaved'))
      setRows(await listCareOrders(db, { ownerId, environmentId }))
      await session.refreshLocal()
    }
    setBusy(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageIntro title={t(locale, 'careOrders')} subtitle={t(locale, 'careOrdersSubtitle')} />
      <Banner tone="neutral">{t(locale, 'careNoUrgency')}</Banner>
      <div className="flex gap-2" role="tablist" aria-label={t(locale, 'careOrders')}>
        <Button variant={tab === 'active' ? 'primary' : 'quiet'} onClick={() => setTab('active')}>
          {t(locale, 'careActive')}
        </Button>
        <Button variant={tab === 'history' ? 'primary' : 'quiet'} onClick={() => setTab('history')}>
          {t(locale, 'careHistory')}
        </Button>
      </div>
      {message ? <Banner tone="neutral">{message}</Banner> : null}
      {visible.length === 0 ? <p className="text-muted">{tab === 'active' ? t(locale, 'careEmpty') : t(locale, 'careHistoryEmpty')}</p> : null}
      {visible.map((order) => {
        const stale = order.due_at ? Date.now() - new Date(order.due_at).getTime() > 0 && order.status === 'active' : false
        const personal = order.kind === 'symptom_monitor'
        const expanded = openId === order.id || !personal
        const title = personal && !expanded ? t(locale, 'personalTask') : order.title
        return (
          <Card key={order.id} title={title}>
            <p className="text-sm text-muted">
              {careKindLabel(locale, order.kind)} · {careStatusLabel(locale, order.status)}
            </p>
            {stale ? <p className="mt-2 text-sm text-muted">{t(locale, 'overdueOrg')}</p> : null}
            {personal && !expanded ? (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-sm text-muted">{t(locale, 'personalTaskHint')}</p>
                <Button variant="secondary" onClick={() => setOpenId(order.id)}>
                  {t(locale, 'careOpenTask')}
                </Button>
              </div>
            ) : (
              <>
            {order.goal ? (
              <p className="mt-2 text-sm">
                {t(locale, 'careGoal')}: {order.goal}
              </p>
            ) : null}
            <p className="mt-2">{order.instructions}</p>
            {order.schedule_text ? (
              <p className="mt-2 text-sm">
                {t(locale, 'careSchedule')}: {order.schedule_text}
              </p>
            ) : null}
            {order.start_at ? (
              <p className="numeric mt-1 text-sm text-muted">
                {t(locale, 'careStart')}: {formatZoned(new Date(order.start_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}
              </p>
            ) : null}
            {order.review_at ? (
              <p className="numeric mt-1 text-sm text-muted">
                {t(locale, 'careReview')}: {formatZoned(new Date(order.review_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}
              </p>
            ) : null}
            {order.due_at ? (
              <p className="numeric mt-1 text-sm text-muted">
                {t(locale, 'careDue')}: {formatZoned(new Date(order.due_at), profile.timezone, locale === 'ru' ? 'ru' : 'en')}
              </p>
            ) : null}
                {order.ack_required ? <Banner tone="attention">{t(locale, 'careAckNeeded')}</Banner> : null}
                {order.cancelled_reason ? (
                  <p className="mt-2 text-sm">
                    {t(locale, 'careCancel')}: {order.cancelled_reason}
                  </p>
                ) : null}
                {order.revise_reason ? (
                  <p className="mt-2 text-sm">
                    {t(locale, 'careRevise')}: {order.revise_reason}
                  </p>
                ) : null}
                {order.last_decision ? (
                  <p className="mt-2 text-sm text-muted">
                    {order.last_decision}
                    {order.last_note ? ` · ${order.last_note}` : ''}
                  </p>
                ) : null}
                {tab === 'active' && order.status === 'active' ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Field id={`note-${order.id}`} label={t(locale, 'careNote')}>
                      <textarea
                        id={`note-${order.id}`}
                        maxLength={1000}
                        className="min-h-20 rounded-xl border border-line bg-canvas px-3 py-2"
                        value={note[order.id] ?? ''}
                        onChange={(event) => setNote((current) => ({ ...current, [order.id]: event.target.value }))}
                      />
                    </Field>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy === order.id} onClick={() => void respond(order, 'done')}>
                    {t(locale, 'careMarkDone')}
                  </Button>
                  <Button variant="secondary" disabled={busy === order.id} onClick={() => void respond(order, 'skipped')}>
                    {t(locale, 'careMarkSkip')}
                  </Button>
                  <Button variant="quiet" disabled={busy === order.id} onClick={() => void respond(order, 'unable')}>
                    {t(locale, 'careMarkUnable')}
                  </Button>
                </div>
                <p className="text-sm text-muted">{t(locale, 'careUnableHint')}</p>
                  </div>
                ) : null}
                {order.ack_required ? (
                  <Button className="mt-3" disabled={busy === order.id} onClick={() => void respond(order, 'acknowledged')}>
                    {t(locale, 'careAcknowledge')}
                  </Button>
                ) : null}
                {order.kind === 'measurement' ? (
                  <Link className="mt-3 inline-flex min-h-11 items-center text-accent" to="/onboard/measurements">
                    {t(locale, 'measure')}
                  </Link>
                ) : null}
                {order.kind === 'workout' ? (
                  <Link className="mt-3 inline-flex min-h-11 items-center text-accent" to={`/onboard/activity?task=${order.id}`}>
                    {t(locale, 'activityOpenFromTask')}
                  </Link>
                ) : null}
              </>
            )}
          </Card>
        )
      })}
    </div>
  )
}
