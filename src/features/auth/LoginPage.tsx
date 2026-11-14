import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { Button, Field } from '../../components/ui.tsx'
import { postLoginPath } from '../../domain/acceptanceRoutes.ts'
import { t } from '../../i18n/copy.ts'

export function LoginPage() {
  const session = useSession()
  const navigate = useNavigate()
  const locale = session.locale
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [forgot, setForgot] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const result = await session.login(email, password)
    setBusy(false)
    if (result.kind === 'doctor') {
      navigate(postLoginPath('doctor', false))
      return
    }
    if (result.kind === 'astronaut') {
      const profile = await session.refreshLocal()
      navigate(postLoginPath('astronaut', Boolean(profile && profile.owner_id === result.userId)))
      return
    }
    setError(result.kind === 'network' ? t(locale, 'signInNetwork') : t(locale, 'signInFailed'))
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col justify-center gap-4 p-8">
        <p className="text-sm text-attention">{t(locale, 'demo')}</p>
        <h1 className="text-3xl">{t(locale, 'appName')}</h1>
        <p className="max-w-md text-lg">{t(locale, 'loginLead')}</p>
        <ul className="flex flex-col gap-2 text-muted">
          <li>{t(locale, 'loginPoint1')}</li>
          <li>{t(locale, 'loginPoint2')}</li>
          <li>{t(locale, 'loginPoint3')}</li>
        </ul>
      </section>
      <section className="flex items-center justify-center p-6">
        <form className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-surface p-5" onSubmit={(event) => void onSubmit(event)}>
          <Field id="email" label={t(locale, 'email')} error={error || undefined}>
            <input
              id="email"
              type="email"
              required
              maxLength={254}
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-11 rounded-xl border border-line bg-canvas px-3"
            />
          </Field>
          <Field id="password" label={t(locale, 'password')}>
            <input
              id="password"
              type={show ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="min-h-11 rounded-xl border border-line bg-canvas px-3"
            />
          </Field>
          <button type="button" className="min-h-11 text-left text-sm text-muted" onClick={() => setShow((value) => !value)}>
            {show ? t(locale, 'hidePassword') : t(locale, 'showPassword')}
          </button>
          <Button type="submit" disabled={busy}>
            {t(locale, 'signIn')}
          </Button>
          <button type="button" className="min-h-11 text-left text-sm" onClick={() => setForgot((value) => !value)}>
            {t(locale, 'forgot')}
          </button>
          {forgot ? <p className="text-sm text-muted">{t(locale, 'forgotBody')}</p> : null}
          <div className="flex gap-2">
            <span className="text-sm text-muted">{t(locale, 'language')}</span>
            <button type="button" className="min-h-11 px-3" onClick={() => session.setLocale('ru')}>
              RU
            </button>
            <button type="button" className="min-h-11 px-3" onClick={() => session.setLocale('en')}>
              EN
            </button>
          </div>
          {session.profile ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/onboard/today')}
            >
              {t(locale, 'openPrepared')}
            </Button>
          ) : null}
        </form>
      </section>
    </div>
  )
}
