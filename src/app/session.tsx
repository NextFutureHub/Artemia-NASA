import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { db } from '../data/local/db.ts'
import { countPending, readAssignment, readMission, readPreparedProfile, updateProfile } from '../data/local/journal.ts'
import { apiRequest, environmentId } from '../data/remote/client.ts'
import type { AssignmentCache, MissionCache, PreparedProfile } from '../data/local/types.ts'
import type { Locale } from '../i18n/copy.ts'

export type ConnectionState = 'checking' | 'online' | 'offline' | 'auth_required'

type SessionValue = {
  ready: boolean
  locale: Locale
  setLocale: (locale: Locale) => void
  token: string | null
  userId: string | null
  role: 'astronaut' | 'doctor' | null
  roleChecked: boolean
  profile: PreparedProfile | null
  mission: MissionCache | null
  assignment: AssignmentCache | null
  connection: ConnectionState
  pending: number
  multipleProfiles: boolean
  refreshLocal: () => Promise<PreparedProfile | null>
  login: (email: string, password: string) => Promise<
    { kind: 'astronaut' | 'doctor'; userId: string } | { kind: 'denied' | 'network' }
  >
  logout: () => void
  probe: () => Promise<ConnectionState>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [locale, setLocaleState] = useState<Locale>('ru')
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('artemia.token'))
  const [userId, setUserId] = useState<string | null>(() => sessionStorage.getItem('artemia.userId'))
  const [role, setRole] = useState<'astronaut' | 'doctor' | null>(() => readRole())
  const [roleChecked, setRoleChecked] = useState(() => sessionStorage.getItem('artemia.token') === null)
  const [profile, setProfile] = useState<PreparedProfile | null>(null)
  const [mission, setMission] = useState<MissionCache | null>(null)
  const [assignment, setAssignment] = useState<AssignmentCache | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('checking')
  const [pending, setPending] = useState(0)
  const [multipleProfiles, setMultipleProfiles] = useState(false)

  async function refreshLocal(): Promise<PreparedProfile | null> {
    const rows = await db.preparedProfiles.where('environment_id').equals(environmentId).count()
    setMultipleProfiles(rows > 1)
    const next = rows === 1 ? await readPreparedProfile(db, environmentId) : null
    setProfile(next)
    if (next) {
      setLocaleState(next.locale)
      const scope = { ownerId: next.owner_id, environmentId }
      setMission(await readMission(db, scope, next.mission_id))
      setAssignment(await readAssignment(db, scope))
      setPending(await countPending(db, scope))
    } else {
      setMission(null)
      setAssignment(null)
      setPending(0)
    }
    return next
  }

  async function probe(): Promise<ConnectionState> {
    setConnection('checking')
    const health = await apiRequest('/health')
    if (!health.ok) {
      setConnection('offline')
      return 'offline'
    }
    const currentToken = sessionStorage.getItem('artemia.token')
    if (currentToken) {
      const me = await apiRequest('/auth/me', { token: currentToken })
      if (me.status === 401) {
        setConnection('auth_required')
        return 'auth_required'
      }
    }
    setConnection('online')
    return 'online'
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshLocal().finally(() => setReady(true))
    }, 0)
    return () => window.clearTimeout(handle)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    const current = sessionStorage.getItem('artemia.token')
    if (!current) return
    void apiRequest('/auth/me', { token: current }).then((me) => {
      if (me.ok && isRecord(me.body) && (me.body.role === 'doctor' || me.body.role === 'astronaut')) {
        sessionStorage.setItem('artemia.role', me.body.role)
        setRole(me.body.role)
      }
      setRoleChecked(true)
    })
  }, [token])

  useEffect(() => {
    const kick = window.setTimeout(() => void probe(), 0)
    const timer = window.setInterval(() => void probe(), 30_000)
    return () => {
      window.clearTimeout(kick)
      window.clearInterval(timer)
    }
  }, [token])

  function setLocale(next: Locale) {
    setLocaleState(next)
    if (!profile || profile.locale === next) return
    const updated = { ...profile, locale: next }
    setProfile(updated)
    void updateProfile(db, updated)
  }

  async function login(email: string, password: string): Promise<{ kind: 'astronaut' | 'doctor'; userId: string } | { kind: 'denied' | 'network' }> {
    const result = await apiRequest('/auth/login', { method: 'POST', body: { email: email.trim(), password } })
    if (result.status === 0) return { kind: 'network' }
    if (!result.ok || !isRecord(result.body) || typeof result.body.access_token !== 'string') return { kind: 'denied' }
    const nextToken = result.body.access_token
    const me = await apiRequest('/auth/me', { token: nextToken })
    if (!me.ok || !isRecord(me.body) || typeof me.body.id !== 'string' || typeof me.body.role !== 'string') {
      return { kind: 'denied' }
    }
    sessionStorage.setItem('artemia.token', nextToken)
    sessionStorage.setItem('artemia.userId', me.body.id)
    if (me.body.role === 'doctor' || me.body.role === 'astronaut') {
      sessionStorage.setItem('artemia.role', me.body.role)
      setRole(me.body.role)
      setRoleChecked(true)
    }
    setToken(nextToken)
    setUserId(me.body.id)
    if (!profile && (me.body.locale === 'ru' || me.body.locale === 'en')) setLocaleState(me.body.locale)
    if (me.body.role === 'doctor') return { kind: 'doctor', userId: me.body.id }
    if (me.body.role === 'astronaut') return { kind: 'astronaut', userId: me.body.id }
    return { kind: 'denied' }
  }

  function logout() {
    sessionStorage.removeItem('artemia.token')
    sessionStorage.removeItem('artemia.userId')
    sessionStorage.removeItem('artemia.role')
    setToken(null)
    setUserId(null)
    setRole(null)
  }

  const value: SessionValue = {
    ready,
    locale,
    setLocale,
    token,
    userId,
    role,
    roleChecked,
    profile,
    mission,
    assignment,
    connection,
    pending,
    multipleProfiles,
    refreshLocal,
    login,
    logout,
    probe,
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// The provider and the hook share one module so the context stays private to this file.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('session missing')
  return value
}

function readRole(): 'astronaut' | 'doctor' | null {
  const stored = sessionStorage.getItem('artemia.role')
  return stored === 'doctor' || stored === 'astronaut' ? stored : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
