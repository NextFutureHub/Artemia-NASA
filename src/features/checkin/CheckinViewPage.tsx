import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { PageIntro, ReviewLine } from '../../components/FormChrome.tsx'
import { Button } from '../../components/ui.tsx'
import { formatZoned } from '../../domain/clock.ts'
import { db } from '../../data/local/db.ts'
import { readCheckin, readPersonalRevision, readReceiptForEntity, readRevisions } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { displayComment } from '../../domain/explanations.ts'
import { label, overallLabels, t } from '../../i18n/copy.ts'
import type { LocalCheckin, LocalPersonalRevision, LocalRevision } from '../../data/local/types.ts'

export function CheckinViewPage() {
  const { id } = useParams()
  const session = useSession()
  const navigate = useNavigate()
  const locale = session.locale
  const [checkin, setCheckin] = useState<LocalCheckin | null>(null)
  const [revisions, setRevisions] = useState<LocalRevision[]>([])
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [personal, setPersonal] = useState<LocalPersonalRevision | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!session.profile || !id) return
    const scope = { ownerId: session.profile.owner_id, environmentId }
    void readCheckin(db, scope, id).then((row) => {
      if (!row) setMissing(true)
      setCheckin(row)
    })
    void readRevisions(db, scope, id).then((rows) => {
      setRevisions(rows)
      const latestId = rows.at(-1)?.id
      if (!latestId) return
      void readPersonalRevision(db, scope, latestId).then(setPersonal)
    })
    void readReceiptForEntity(db, scope, id).then((row) => setReceiptId(row?.server_receipt_id ?? null))
  }, [session.profile?.owner_id, session.pending, id])

  if (!session.profile) return null
  if (missing || !checkin) return <p>{t(locale, 'unavailable')}</p>
  const latest = revisions[revisions.length - 1]
  const delivery = receiptId
    ? t(locale, 'receivedByServer')
    : checkin.delivery === 'queued'
      ? t(locale, 'waitingSend')
      : checkin.delivery === 'on_server'
        ? t(locale, 'sourceServer')
        : t(locale, 'storedLocally')
  return (
    <article className="flex flex-col gap-4">
      <PageIntro
        title={t(locale, 'openRecord')}
        meta={`${formatZoned(new Date(checkin.recorded_at), checkin.timezone, locale === 'ru' ? 'ru' : 'en')} · ${t(locale, 'versions')} ${latest?.revision_no ?? 1}`}
      />
      <div>
        <ReviewLine
          label={t(locale, 'recordType')}
          value={checkin.type === 'change' ? t(locale, 'change') : t(locale, 'daily')}
        />
        <ReviewLine
          label={t(locale, 'overall')}
          value={latest ? label(locale, overallLabels[latest.general_payload.overall_state]) : t(locale, 'answerNone')}
        />
        <ReviewLine label={t(locale, 'linkState')} value={delivery} />
        <ReviewLine
          label={t(locale, 'personalDelivery')}
          value={personal ? (personal.sharing === 'device_only' ? t(locale, 'deviceOnly') : t(locale, 'assignedDoctor')) : t(locale, 'personalOff')}
        />
      </div>
      {latest?.general_payload.comment ? <p>{displayComment(latest.general_payload.comment)}</p> : null}
      {receiptId ? null : <p className="text-sm text-muted">{t(locale, 'notServerReceipt')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate(`/onboard/checkin/new?revise=${checkin.id}&fresh=1`)}>{t(locale, 'correct')}</Button>
        <Button variant="secondary" onClick={() => navigate(`/onboard/reports/new?checkin=${checkin.id}`)}>{t(locale, 'prepareReport')}</Button>
        <Button variant="quiet" onClick={() => navigate('/onboard/today')}>{t(locale, 'backToday')}</Button>
      </div>
    </article>
  )
}
