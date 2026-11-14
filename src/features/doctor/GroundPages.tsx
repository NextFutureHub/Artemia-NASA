import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, Outlet, useParams, useSearchParams } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import { apiRequest } from '../../data/remote/client.ts'
import { CARE_ORDER_KINDS } from '../../domain/enums.ts'
import { careKindLabel, careStatusLabel } from '../../domain/labels.ts'
import { nextMemorySlice, type MemorySlice, type SliceLoad } from '../../domain/reportSnapshot.ts'
import { t } from '../../i18n/copy.ts'

type InboxItem = {
  report_id: string
  mission_id: string
  subject_id: string
  callsign: string
  display_name: string
  title: string
  range_start: string
  range_end: string
  requested_review: boolean
  received_at: string
  doctor_work: string
}

type InboxData = {
  counts: { new_reports: number; review_requested: number; replied: number }
  items: InboxItem[]
}

type ReportCard = {
  id: string
  mission_id: string
  subject_id: string
  callsign: string
  display_name: string
  title: string
  general_snapshot: { summary?: string; revision_ids?: string[]; prepared_at?: string }
  general_hash: string
  integrity: string
  received_at: string
  doctor_work: string
  events: Array<{ event_type: string; server_at: string }>
  messages: Array<{ id: string; message_type: string; text: string; created_at: string }>
}

export function GroundShell() {
  const session = useSession()
  if (!session.ready || !session.roleChecked) return <p className="p-6">{t(session.locale, 'loading')}</p>
  if (!session.token || session.role !== 'doctor') return <Navigate to="/login" replace />
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-line px-4">
        <div>
          <p className="text-sm text-attention">{t(session.locale, 'demo')}</p>
          <p>{t(session.locale, 'groundTitle')}</p>
        </div>
        <button type="button" className="min-h-11" onClick={() => { session.logout(); window.location.assign('/login') }}>
          {t(session.locale, 'logout')}
        </button>
      </header>
      <div className="mx-auto max-w-5xl p-4">
        <p className="mb-4 text-sm text-muted">{t(session.locale, 'groundBody')}</p>
        <Outlet />
      </div>
    </div>
  )
}

export function InboxPage() {
  const session = useSession()
  const locale = session.locale
  const [slice, setSlice] = useState<MemorySlice<InboxData> | null>(null)
  const sliceRef = useRef<MemorySlice<InboxData> | null>(null)
  const [mode, setMode] = useState<'live' | 'stale' | 'denied' | 'offline_empty'>('offline_empty')
  const [patient, setPatient] = useState('')
  const [work, setWork] = useState<'all' | 'not_opened' | 'opened' | 'replied'>('all')
  const [reviewOnly, setReviewOnly] = useState(false)

  async function reload() {
    if (!session.token) return
    const response = await apiRequest('/ground/inbox', { token: session.token })
    const loaded: SliceLoad<InboxData> = response.status === 0 || response.status >= 500
      ? { kind: 'offline' }
      : response.status === 401 || response.status === 403
        ? { kind: 'denied' }
        : isInbox(response.body)
          ? { kind: 'data', data: response.body }
          : { kind: 'offline' }
    const next = nextMemorySlice(sliceRef.current, loaded, new Date().toISOString())
    sliceRef.current = next.slice
    setSlice(next.slice)
    setMode(next.mode)
  }

  useEffect(() => {
    const kick = window.setTimeout(() => void reload(), 0)
    const timer = window.setInterval(() => void reload(), 60_000)
    window.addEventListener('focus', reload)
    return () => {
      window.clearTimeout(kick)
      window.clearInterval(timer)
      window.removeEventListener('focus', reload)
    }
  }, [session.token])

  const items = (slice?.data.items ?? []).filter((item) => {
    const name = `${item.callsign} ${item.display_name}`.toLowerCase()
    if (patient.trim() && !name.includes(patient.trim().toLowerCase())) return false
    if (work !== 'all' && item.doctor_work !== work) return false
    if (reviewOnly && !item.requested_review) return false
    return true
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">{t(locale, 'groundReports')}</h1>
        <Button type="button" variant="secondary" onClick={() => void reload()}>{t(locale, 'refresh')}</Button>
      </div>
      {mode === 'stale' && slice ? <Banner tone="attention">{t(locale, 'staleSlice', { time: clockLabel(slice.capturedAt, locale) })}</Banner> : null}
      {mode === 'offline_empty' ? <Banner tone="attention">{t(locale, 'offlineEmpty')}</Banner> : null}
      {mode === 'denied' ? <Banner tone="danger">{t(locale, 'accessDenied')}</Banner> : null}
      {mode === 'live' && slice ? <p className="text-sm text-muted">{t(locale, 'updatedAt')} {clockLabel(slice.capturedAt, locale)}</p> : null}
      {slice ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <p>{t(locale, 'newReports')}: {slice.data.counts.new_reports}</p>
          <p>{t(locale, 'reviewCount')}: {slice.data.counts.review_requested}</p>
          <p>{t(locale, 'repliesSent')}: {slice.data.counts.replied}</p>
        </div>
      ) : null}
      <p className="text-sm text-muted">{t(locale, 'noTriage')}</p>
      <div className="flex flex-wrap gap-2">
        <Field id="patient" label={t(locale, 'patientFilter')}>
          <input id="patient" value={patient} onChange={(event) => setPatient(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
        </Field>
        <select className="min-h-11 rounded-xl border border-line bg-canvas px-3" value={work} onChange={(event) => setWork(event.target.value as typeof work)}>
          <option value="all">{t(locale, 'filterAll')}</option>
          <option value="not_opened">{t(locale, 'notOpened')}</option>
          <option value="opened">{t(locale, 'opened')}</option>
          <option value="replied">{t(locale, 'replied')}</option>
        </select>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />
          {t(locale, 'withReview')}
        </label>
      </div>
      {items.length === 0 && mode === 'live' ? <p className="text-muted">{t(locale, 'noReports')}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.report_id}>
              <Link className="block rounded-xl border border-line bg-surface p-4" to={`/ground/reports/${item.report_id}?mission=${item.mission_id}`}>
                <p>{item.callsign}</p>
                <p>{item.title}</p>
                <p className="text-sm text-muted">{item.range_start} — {item.range_end}</p>
                <p className="text-sm">{item.requested_review ? t(locale, 'reviewCount') : t(locale, 'planned')} · {item.doctor_work} · {item.received_at}</p>
              </Link>
            </li>
          ))}
        </ul>
        {items[0] ? (
          <aside className="rounded-xl border border-line p-4">
            <p>{items[0].callsign}</p>
            <p className="text-sm text-muted">{items[0].display_name}</p>
            <Link className="mt-3 inline-flex min-h-11 items-center" to={`/ground/crew/${items[0].subject_id}?mission=${items[0].mission_id}`}>{t(locale, 'openPatient')}</Link>
          </aside>
        ) : null}
      </div>
    </section>
  )
}

export function GroundReportPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const session = useSession()
  const locale = session.locale
  const missionId = params.get('mission') ?? ''
  const [slice, setSlice] = useState<MemorySlice<ReportCard> | null>(null)
  const sliceRef = useRef<MemorySlice<ReportCard> | null>(null)
  const [mode, setMode] = useState<'live' | 'stale' | 'denied' | 'offline_empty'>('offline_empty')
  const [replyType, setReplyType] = useState('clarifying_question')
  const [text, setText] = useState('')
  const [sensitive, setSensitive] = useState(false)
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)

  async function reload(markOpen: boolean) {
    if (!session.token || !id || !missionId) return
    const response = await apiRequest(`/missions/${missionId}/reports/${id}`, { token: session.token })
    const loaded: SliceLoad<ReportCard> = response.status === 0 || response.status >= 500
      ? { kind: 'offline' }
      : response.status === 401 || response.status === 403
        ? { kind: 'denied' }
        : isReport(response.body)
          ? { kind: 'data', data: response.body }
          : { kind: 'offline' }
    const next = nextMemorySlice(sliceRef.current, loaded, new Date().toISOString())
    sliceRef.current = next.slice
    setSlice(next.slice)
    setMode(next.mode)
    if (markOpen && loaded.kind === 'data' && loaded.data.doctor_work === 'not_opened') {
      await apiRequest(`/missions/${missionId}/reports/${id}/opened`, { method: 'POST', token: session.token, body: {} })
      const again = await apiRequest(`/missions/${missionId}/reports/${id}`, { token: session.token })
      if (isReport(again.body)) {
        const refreshed = nextMemorySlice(sliceRef.current, { kind: 'data', data: again.body }, new Date().toISOString())
        sliceRef.current = refreshed.slice
        setSlice(refreshed.slice)
        setMode(refreshed.mode)
      }
    }
  }

  useEffect(() => {
    const kick = window.setTimeout(() => void reload(true), 0)
    const timer = window.setInterval(() => void reload(false), 60_000)
    return () => {
      window.clearTimeout(kick)
      window.clearInterval(timer)
    }
  }, [session.token, id, missionId])

  const offline = mode === 'stale' || mode === 'offline_empty'
  async function send() {
    if (!session.token || !id || !missionId || sending || offline || text.trim().length === 0) return
    setSending(true)
    const response = await apiRequest(`/missions/${missionId}/reports/${id}/messages`, {
      method: 'POST',
      token: session.token,
      body: { id: crypto.randomUUID(), message_type: replyType, text: text.trim(), sensitive, supersedes_id: null },
    })
    setSending(false)
    if (response.ok) {
      setText('')
      setNotice(t(locale, 'replySaved'))
      await reload(false)
      return
    }
    setNotice(response.status === 0 ? t(locale, 'replyOffline') : t(locale, 'accessDenied'))
  }

  const card = slice?.data
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <article className="flex flex-col gap-3">
        {mode === 'stale' && slice ? <Banner tone="attention">{t(locale, 'staleSlice', { time: clockLabel(slice.capturedAt, locale) })}</Banner> : null}
        {mode === 'denied' ? <Banner tone="danger">{t(locale, 'accessDenied')}</Banner> : null}
        {mode === 'offline_empty' ? <Banner tone="attention">{t(locale, 'offlineEmpty')}</Banner> : null}
        {card ? (
          <>
            <h1 className="text-3xl">{card.title}</h1>
            <p>{card.callsign} · {card.display_name}</p>
            <p className="text-sm">{card.integrity === 'match' ? t(locale, 'integrityMatch') : t(locale, 'integrityMismatch')}</p>
            <p className="numeric text-sm text-muted">{card.general_hash}</p>
            <p>{card.received_at} · {card.doctor_work}</p>
            <p>{card.general_snapshot.summary}</p>
            <ul>
              {(card.events ?? []).map((event) => (
                <li key={`${event.event_type}-${event.server_at}`}>{event.event_type} · {event.server_at}</li>
              ))}
            </ul>
            <Link to={`/ground/crew/${card.subject_id}?mission=${card.mission_id}`}>{t(locale, 'crewCard')}</Link>
          </>
        ) : null}
      </article>
      <form className="flex flex-col gap-3 rounded-xl border border-line p-4" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <h2>{t(locale, 'replyTitle')}</h2>
        <p>{card?.callsign}</p>
        {offline ? <Banner tone="attention">{t(locale, 'replyOffline')}</Banner> : null}
        <label className="flex flex-col gap-2">
          <span>{t(locale, 'replyType')}</span>
          <select className="min-h-11 rounded-xl border border-line bg-canvas px-3" value={replyType} onChange={(event) => setReplyType(event.target.value)}>
            <option value="acknowledgement">{t(locale, 'acknowledgement')}</option>
            <option value="clarifying_question">{t(locale, 'clarifying')}</option>
            <option value="comment">{t(locale, 'commentType')}</option>
          </select>
        </label>
        <Field id="reply-text" label={t(locale, 'reportMessage')}>
          <textarea id="reply-text" required minLength={1} maxLength={3000} value={text} onChange={(event) => setText(event.target.value)} className="min-h-32 rounded-xl border border-line bg-canvas px-3 py-2" />
        </Field>
        <button type="button" className="min-h-11 text-left text-sm" onClick={() => setText(t(locale, 'demoReplyText'))}>{t(locale, 'demoReply')}</button>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={sensitive} onChange={(event) => setSensitive(event.target.checked)} />
          {t(locale, 'sensitiveMark')}
        </label>
        {notice ? <p>{notice}</p> : null}
        <Button type="submit" disabled={offline || sending || text.trim().length === 0}>{t(locale, 'sendReply')}</Button>
      </form>
    </section>
  )
}

type CareOrderItem = {
  id: string
  kind: string
  title: string
  instructions: string
  schedule_text: string
  due_at: string | null
  status: string
  revision_no: number
  cancelled_reason: string | null
  revise_reason: string | null
  ack_required: boolean
  updated_at: string
  events: Array<{ event_type: string; detail: string | null; server_at: string }>
  responses: Array<{ id: string; decision: string; note: string | null; recorded_at: string }>
}

export function CrewPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const session = useSession()
  const locale = session.locale
  const missionId = params.get('mission') ?? ''
  const [slice, setSlice] = useState<MemorySlice<Record<string, unknown>> | null>(null)
  const [mode, setMode] = useState<'live' | 'stale' | 'denied' | 'offline_empty'>('offline_empty')
  const [tab, setTab] = useState<'overview' | 'orders'>('overview')
  const [orders, setOrders] = useState<CareOrderItem[]>([])
  const [ordersError, setOrdersError] = useState<'denied' | 'offline' | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<(typeof CARE_ORDER_KINDS)[number]>('measurement')
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [scheduleText, setScheduleText] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  async function reloadOrders() {
    if (!session.token || !id || !missionId) return
    const response = await apiRequest(`/ground/crew/${id}/orders?mission_id=${missionId}`, { token: session.token })
    if (response.status === 401 || response.status === 403) {
      setOrdersError('denied')
      setOrders([])
      return
    }
    if (response.status !== 200 || !isRecord(response.body) || !Array.isArray(response.body.items)) {
      setOrdersError('offline')
      return
    }
    setOrdersError(null)
    setOrders(response.body.items.filter(isCareOrderItem))
  }

  useEffect(() => {
    if (!session.token || !id || !missionId) return
    void apiRequest(`/ground/crew/${id}?mission_id=${missionId}`, { token: session.token }).then((response) => {
      const loaded: SliceLoad<Record<string, unknown>> = response.status === 0 || response.status >= 500
        ? { kind: 'offline' }
        : response.status === 401 || response.status === 403
          ? { kind: 'denied' }
          : isRecord(response.body)
            ? { kind: 'data', data: response.body }
            : { kind: 'offline' }
      const next = nextMemorySlice(null, loaded, new Date().toISOString())
      setSlice(next.slice)
      setMode(next.mode)
    })
    void reloadOrders()
  }, [session.token, id, missionId])

  async function createOrder(event: FormEvent) {
    event.preventDefault()
    if (!session.token || !id || !missionId || busy) return
    setBusy(true)
    const response = await apiRequest(`/ground/crew/${id}/orders?mission_id=${missionId}`, {
      method: 'POST',
      token: session.token,
      body: {
        kind,
        title: title.trim(),
        instructions: instructions.trim(),
        schedule_text: scheduleText.trim(),
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      },
    })
    setBusy(false)
    if (response.status === 200) {
      setNotice(t(locale, 'careSaved'))
      setTitle('')
      setInstructions('')
      setScheduleText('')
      setDueAt('')
      await reloadOrders()
      return
    }
    setNotice(t(locale, 'errors'))
  }

  async function reviseOrder(orderId: string) {
    if (!session.token || busy || reason.trim().length === 0) return
    setBusy(true)
    const response = await apiRequest(`/ground/orders/${orderId}/revise`, {
      method: 'POST',
      token: session.token,
      body: {
        reason: reason.trim(),
        title: title.trim() || undefined,
        instructions: instructions.trim() || undefined,
        schedule_text: scheduleText.trim(),
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      },
    })
    setBusy(false)
    if (response.status === 200) {
      setNotice(t(locale, 'careSaved'))
      setEditId(null)
      setReason('')
      await reloadOrders()
      return
    }
    setNotice(t(locale, 'errors'))
  }

  async function cancelOrder(orderId: string) {
    if (!session.token || busy || reason.trim().length === 0) return
    setBusy(true)
    const response = await apiRequest(`/ground/orders/${orderId}/cancel`, {
      method: 'POST',
      token: session.token,
      body: { reason: reason.trim() },
    })
    setBusy(false)
    if (response.status === 200) {
      setNotice(t(locale, 'careSaved'))
      setEditId(null)
      setReason('')
      await reloadOrders()
      return
    }
    setNotice(t(locale, 'errors'))
  }

  const card = slice?.data
  const active = orders.filter((row) => row.status === 'active')
  const history = orders.filter((row) => row.status !== 'active')

  return (
    <section className="flex flex-col gap-3">
      {mode === 'stale' && slice ? <Banner tone="attention">{t(locale, 'staleSlice', { time: clockLabel(slice.capturedAt, locale) })}</Banner> : null}
      {mode === 'denied' ? <Banner tone="danger">{t(locale, 'accessDenied')}</Banner> : null}
      <h1 className="text-3xl">{typeof card?.callsign === 'string' ? card.callsign : t(locale, 'crewCard')}</h1>
      <p>{typeof card?.display_name === 'string' ? card.display_name : ''}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant={tab === 'overview' ? 'primary' : 'quiet'} onClick={() => setTab('overview')}>
          {t(locale, 'crewCard')}
        </Button>
        <Button variant={tab === 'orders' ? 'primary' : 'quiet'} onClick={() => setTab('orders')}>
          {t(locale, 'careOrders')}
        </Button>
      </div>
      {tab === 'overview' ? (
        <>
          <p className="text-sm text-muted">{t(locale, 'unsentUnknown')}</p>
          {isRecord(card?.last_delivered) ? (
            <p>{String(card.last_delivered.local_date)} · {String(card.last_delivered.overall_state ?? '')}</p>
          ) : null}
          <Link to="/ground/inbox">{t(locale, 'groundReports')}</Link>
        </>
      ) : (
        <>
          <Banner tone="neutral">{t(locale, 'careOrdersSubtitle')}</Banner>
          <Banner tone="neutral">{t(locale, 'careNoUrgency')}</Banner>
          {ordersError === 'denied' ? <Banner tone="danger">{t(locale, 'accessDenied')}</Banner> : null}
          {ordersError === 'offline' ? <Banner tone="attention">{t(locale, 'serverDown')}</Banner> : null}
          {notice ? <Banner tone="neutral">{notice}</Banner> : null}
          <form className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" onSubmit={(event) => void createOrder(event)}>
            <h2 className="text-xl">{t(locale, 'careCreate')}</h2>
            <Field id="care-kind" label={t(locale, 'careKind')}>
              <select id="care-kind" className="min-h-11 rounded-xl border border-line bg-canvas px-3" value={kind} onChange={(event) => setKind(event.target.value as (typeof CARE_ORDER_KINDS)[number])}>
                {CARE_ORDER_KINDS.map((item) => (
                  <option key={item} value={item}>
                    {careKindLabel(locale, item)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="care-title" label={t(locale, 'careTitle')}>
              <input id="care-title" className="min-h-11 rounded-xl border border-line bg-canvas px-3" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} required />
            </Field>
            <Field id="care-instructions" label={t(locale, 'careInstructions')}>
              <textarea id="care-instructions" className="min-h-24 rounded-xl border border-line bg-canvas px-3 py-2" maxLength={3000} value={instructions} onChange={(event) => setInstructions(event.target.value)} required />
            </Field>
            <Field id="care-schedule" label={t(locale, 'careSchedule')}>
              <input id="care-schedule" className="min-h-11 rounded-xl border border-line bg-canvas px-3" maxLength={500} value={scheduleText} onChange={(event) => setScheduleText(event.target.value)} />
            </Field>
            <Field id="care-due" label={t(locale, 'careDue')}>
              <input id="care-due" type="datetime-local" className="min-h-11 rounded-xl border border-line bg-canvas px-3" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || title.trim().length === 0 || instructions.trim().length === 0}>
              {t(locale, 'careCreate')}
            </Button>
          </form>
          <h2 className="text-xl">{t(locale, 'careActive')}</h2>
          {active.length === 0 ? <p>{t(locale, 'careEmpty')}</p> : null}
          {active.map((order) => (
            <article key={order.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-lg">{order.title}</p>
              <p className="text-sm text-muted">
                {careKindLabel(locale, order.kind)} · {careStatusLabel(locale, order.status)} · rev {order.revision_no}
              </p>
              <p className="mt-2">{order.instructions}</p>
              {order.schedule_text ? <p className="mt-2 text-sm">{t(locale, 'careSchedule')}: {order.schedule_text}</p> : null}
              {order.due_at ? <p className="numeric mt-1 text-sm text-muted">{t(locale, 'careDue')}: {clockLabel(order.due_at, locale)}</p> : null}
              <CareExecution locale={locale} order={order} />
              {editId === order.id ? (
                <div className="mt-3 flex flex-col gap-2">
                  <Field id={`reason-${order.id}`} label={t(locale, 'careReason')}>
                    <textarea id={`reason-${order.id}`} className="min-h-20 rounded-xl border border-line bg-canvas px-3 py-2" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy || reason.trim().length === 0} onClick={() => void reviseOrder(order.id)}>
                      {t(locale, 'careRevise')}
                    </Button>
                    <Button variant="danger" disabled={busy || reason.trim().length === 0} onClick={() => void cancelOrder(order.id)}>
                      {t(locale, 'careCancel')}
                    </Button>
                    <Button variant="quiet" onClick={() => { setEditId(null); setReason('') }}>
                      {t(locale, 'cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="mt-3"
                  variant="secondary"
                  onClick={() => {
                    setEditId(order.id)
                    setTitle(order.title)
                    setInstructions(order.instructions)
                    setScheduleText(order.schedule_text)
                    setDueAt(order.due_at ? order.due_at.slice(0, 16) : '')
                    setReason('')
                  }}
                >
                  {t(locale, 'careRevise')} / {t(locale, 'careCancel')}
                </Button>
              )}
            </article>
          ))}
          <h2 className="text-xl">{t(locale, 'careHistory')}</h2>
          {history.length === 0 ? <p>{t(locale, 'careHistoryEmpty')}</p> : null}
          {history.map((order) => (
            <article key={order.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-lg">{order.title}</p>
              <p className="text-sm text-muted">
                {careKindLabel(locale, order.kind)} · {careStatusLabel(locale, order.status)}
              </p>
              {order.cancelled_reason ? <p className="mt-2 text-sm">{t(locale, 'careCancel')}: {order.cancelled_reason}</p> : null}
              <CareExecution locale={locale} order={order} />
            </article>
          ))}
        </>
      )}
    </section>
  )
}

function CareExecution({ locale, order }: { locale: 'ru' | 'en'; order: CareOrderItem }) {
  if (order.responses.length === 0 && order.events.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{t(locale, 'careExecution')}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {order.responses.map((row) => (
          <li key={row.id}>
            {row.decision}
            {row.note ? ` · ${row.note}` : ''} · {clockLabel(row.recorded_at, locale)}
          </li>
        ))}
        {order.events
          .filter((event) => event.event_type !== 'created')
          .map((event, index) => (
            <li key={`${event.event_type}-${index}`}>
              {event.event_type}
              {event.detail ? ` · ${event.detail}` : ''} · {clockLabel(event.server_at, locale)}
            </li>
          ))}
      </ul>
    </div>
  )
}

function isCareOrderItem(value: unknown): value is CareOrderItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.title === 'string' &&
    typeof value.instructions === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.events) &&
    Array.isArray(value.responses)
  )
}

function clockLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInbox(value: unknown): value is InboxData {
  if (!isRecord(value) || !isRecord(value.counts) || !Array.isArray(value.items)) return false
  return typeof value.counts.new_reports === 'number'
}

function isReport(value: unknown): value is ReportCard {
  return isRecord(value) && typeof value.id === 'string' && isRecord(value.general_snapshot) && Array.isArray(value.events)
}
