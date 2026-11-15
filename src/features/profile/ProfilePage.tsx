import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { PageIntro, ProfileGroup } from '../../components/FormChrome.tsx'
import { Banner, Button, Field } from '../../components/ui.tsx'
import { db } from '../../data/local/db.ts'
import { clearOwner, latestConsent, queueConsentDecision, queueProfilePreferences, updateProfile } from '../../data/local/journal.ts'
import { consentApplyState } from '../../domain/reportSnapshot.ts'
import { environmentId } from '../../data/remote/client.ts'
import { formatZoned } from '../../domain/clock.ts'
import type { UnitSystem } from '../../domain/unitSystem.ts'
import { t } from '../../i18n/copy.ts'
import type { PreparedProfile } from '../../data/local/types.ts'

type PreparedSex = PreparedProfile['sex_context']

export function ProfilePage() {
  const session = useSession()
  const navigate = useNavigate()
  const locale = session.locale
  const profile = session.profile
  const [reminder, setReminder] = useState(profile?.reminder_enabled ?? false)
  const [reminderTime, setReminderTime] = useState(profile?.reminder_time ?? '08:00')
  const [personal, setPersonal] = useState(profile?.reproductive_enabled ?? false)
  const [exchange, setExchange] = useState(profile?.general_exchange ?? false)
  const [sensitive, setSensitive] = useState(profile?.sensitive_sharing ?? 'device_only')
  const [units, setUnits] = useState<UnitSystem>(profile?.unit_system ?? session.unitSystem)
  const [ageRaw, setAgeRaw] = useState(profile?.age == null ? '' : String(profile.age))
  const [sexContext, setSexContext] = useState<PreparedSex>(profile?.sex_context ?? null)
  const [message, setMessage] = useState('')
  const [phrase, setPhrase] = useState('')
  const [consentNote, setConsentNote] = useState('')

  if (!profile || !session.mission) return null
  const current = profile
  const mission = session.mission

  async function save() {
    const ageTrimmed = ageRaw.trim()
    const age = ageTrimmed === '' ? null : Number(ageTrimmed)
    if (age !== null && (!Number.isInteger(age) || age < 18 || age > 100)) {
      setMessage(t(locale, 'ageInvalid'))
      return
    }
    const next = {
      ...current,
      locale,
      reminder_enabled: reminder,
      reminder_time: reminder ? reminderTime : null,
      reproductive_enabled: personal,
      general_exchange: exchange,
      sensitive_sharing: sensitive,
      unit_system: units,
      age,
      sex_context: sexContext,
    }
    await updateProfile(db, next)
    await session.setUnitSystem(units)
    await queueProfilePreferences(db, { ownerId: current.owner_id, environmentId }, crypto.randomUUID())
    await session.refreshLocal()
    setMessage(t(locale, 'settingsSaved'))
  }

  return (
    <div className="flex flex-col gap-5">
      <PageIntro title={t(locale, 'profile')} />

      <ProfileGroup title={t(locale, 'basic')}>
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-sm text-muted">{t(locale, 'callsign')}</dt>
            <dd>{current.callsign}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t(locale, 'name')}</dt>
            <dd>{current.display_name}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t(locale, 'mission')}</dt>
            <dd>{mission.name}</dd>
            <dd className="numeric text-sm text-muted">
              {formatZoned(new Date(mission.start_at), 'UTC', locale === 'ru' ? 'ru' : 'en')} — {formatZoned(new Date(mission.end_at), 'UTC', locale === 'ru' ? 'ru' : 'en')}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t(locale, 'physician')}</dt>
            <dd>{session.assignment?.doctor_callsign ?? t(locale, 'noPhysician')}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted">{t(locale, 'readOnly')}</p>
      </ProfileGroup>

      <ProfileGroup title={t(locale, 'healthSection')} lead={t(locale, 'healthSectionLead')}>
        <Field id="profile-age" label={t(locale, 'profileAge')}>
          <input
            id="profile-age"
            inputMode="numeric"
            value={ageRaw}
            onChange={(event) => setAgeRaw(event.target.value)}
            className="min-h-11 rounded-xl border border-line bg-canvas px-3"
            placeholder={t(locale, 'optional')}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend>{t(locale, 'profileSexContext')}</legend>
          {(
            [
              [null, t(locale, 'optional')],
              ['female', t(locale, 'sexFemale')],
              ['male', t(locale, 'sexMale')],
              ['intersex', t(locale, 'sexIntersex')],
              ['unspecified', t(locale, 'sexUnspecified')],
            ] as const
          ).map(([value, text]) => (
            <label key={String(value)} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="sex-context" checked={sexContext === value} onChange={() => setSexContext(value)} />
              {text}
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={personal} onChange={(event) => setPersonal(event.target.checked)} />
          {t(locale, 'personalToggle')}
        </label>
        <p className="text-sm text-muted">{t(locale, 'personalHint')}</p>
      </ProfileGroup>

      <ProfileGroup title={t(locale, 'settingsSection')} lead={t(locale, 'settingsSectionLead')}>
        <p className="text-sm">
          <span className="text-muted">{t(locale, 'language')}: </span>
          {locale.toUpperCase()}
        </p>
        <p className="text-sm">
          <span className="text-muted">IANA: </span>
          <span className="numeric">{current.timezone}</span>
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend>{t(locale, 'unitsSetting')}</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="unit-system" checked={units === 'metric'} onChange={() => setUnits('metric')} />
            {t(locale, 'unitsEu')}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="unit-system" checked={units === 'us'} onChange={() => setUnits('us')} />
            {t(locale, 'unitsUs')}
          </label>
          <p className="text-sm text-muted">{t(locale, 'unitsHint')}</p>
        </fieldset>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={reminder} onChange={(event) => setReminder(event.target.checked)} />
          {t(locale, 'reminder')}
        </label>
        <input
          type="time"
          value={reminderTime}
          disabled={!reminder}
          onChange={(event) => setReminderTime(event.target.value)}
          className="min-h-11 rounded-xl border border-line bg-canvas px-3 disabled:opacity-50"
        />
        <p className="text-sm text-muted">{t(locale, 'reminderHint')}</p>
      </ProfileGroup>

      <ProfileGroup title={t(locale, 'privacy')} lead={t(locale, 'privacyLead')}>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" checked={sensitive === 'device_only'} onChange={() => setSensitive('device_only')} />
          {t(locale, 'deviceOnly')}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" checked={sensitive === 'assigned_doctor'} onChange={() => setSensitive('assigned_doctor')} />
          {t(locale, 'assignedDoctor')}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={exchange} onChange={(event) => setExchange(event.target.checked)} />
          {t(locale, 'exchange')}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()}>{t(locale, 'saveSettings')}</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (!session.assignment?.assignment_id) return
              void latestConsent(db, { ownerId: current.owner_id, environmentId }, 'personal_sharing').then(async (previous) => {
                const result = await queueConsentDecision(db, { ownerId: current.owner_id, environmentId }, {
                  consentId: crypto.randomUUID(),
                  operationId: crypto.randomUUID(),
                  missionId: current.mission_id,
                  consentScope: 'personal_sharing',
                  decision: 'revoked',
                  assignmentId: session.assignment?.assignment_id ?? null,
                  supersedesId: previous?.id ?? null,
                  recordedAt: new Date().toISOString(),
                })
                setConsentNote(t(locale, consentApplyState(result.applyState === 'applied') === 'applied' ? 'consentApplied' : 'consentWaiting'))
              })
            }}
          >
            {t(locale, 'revokePersonal')}
          </Button>
        </div>
        {consentNote ? <Banner tone="attention">{consentNote}</Banner> : null}
        {message ? <Banner tone="neutral">{message}</Banner> : null}
      </ProfileGroup>

      <ProfileGroup title={t(locale, 'deviceSection')}>
        <p className="numeric text-sm">{current.device_id}</p>
        {session.pending > 0 ? <Banner tone="attention">{t(locale, 'clearBlocked', { count: session.pending })}</Banner> : null}
        <Field id="clear-phrase" label={t(locale, 'clearPhrase')}>
          <input id="clear-phrase" value={phrase} onChange={(event) => setPhrase(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
        </Field>
        <Button
          variant="danger"
          disabled={session.pending > 0 || phrase !== 'ОЧИСТИТЬ'}
          onClick={() => {
            void clearOwner(db, { ownerId: current.owner_id, environmentId }).then(async (result) => {
              if (!result.ok) return
              session.logout()
              await session.refreshLocal()
              navigate('/login')
            })
          }}
        >
          {t(locale, 'clearAction')}
        </Button>
      </ProfileGroup>
    </div>
  )
}
