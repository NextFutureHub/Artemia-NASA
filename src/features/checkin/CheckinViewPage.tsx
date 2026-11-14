import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { Button } from '../../components/ui.tsx'
import { formatZoned } from '../../domain/clock.ts'
import { db } from '../../data/local/db.ts'
import { readCheckin, readRevisions } from '../../data/local/journal.ts'
import { environmentId } from '../../data/remote/client.ts'
import { label, overallLabels, t } from '../../i18n/copy.ts'
import type { LocalCheckin, LocalRevision } from '../../data/local/types.ts'

export function CheckinViewPage() {
  const { id } = useParams()
  const session = useSession()
  const navigate = useNavigate()
  const locale = session.locale
  const [checkin, setCheckin] = useState<LocalCheckin | null>(null)
  const [revisions, setRevisions] = useState<LocalRevision[]>([])
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!session.profile || !id) return
    const scope = { ownerId: session.profile.owner_id, environmentId }
    void readCheckin(db, scope, id).then((row) => {
      if (!row) setMissing(true)
      setCheckin(row)
    })
    void readRevisions(db, scope, id).then(setRevisions)
  }, [session.profile?.owner_id, id])

  if (!session.profile) return null
  if (missing || !checkin) return <p>{t(locale, 'unavailable')}</p>
  const latest = revisions[revisions.length - 1]
  return (
    <article className="flex flex-col gap-3">
      <h1 className="text-3xl">{t(locale, 'openRecord')}</h1>
      <p className="numeric">
        {formatZoned(new Date(checkin.recorded_at), checkin.timezone, locale === 'ru' ? 'ru' : 'en')} · {t(locale, 'versions')} {latest?.revision_no ?? 1}
      </p>
      <p>{latest ? label(locale, overallLabels[latest.general_payload.overall_state]) : null}</p>
      <p>{checkin.delivery === 'queued' ? t(locale, 'waitingSend') : checkin.delivery === 'on_server' ? t(locale, 'sourceServer') : t(locale, 'storedLocally')}</p>
      <p className="text-sm text-muted">{t(locale, 'notServerReceipt')}</p>
      <Button onClick={() => navigate(`/onboard/checkin/new?revise=${checkin.id}&fresh=1`)}>{t(locale, 'correct')}</Button>
    </article>
  )
}
