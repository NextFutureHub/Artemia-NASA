import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { db } from '../../data/local/db.ts'
import { environmentId } from '../../data/remote/client.ts'
import { t } from '../../i18n/copy.ts'
import type { SourceCache } from '../../data/local/types.ts'

export function EvidencePage() {
  const session = useSession()
  const locale = session.locale
  const [sources, setSources] = useState<SourceCache[]>([])
  const online = session.connection === 'online'

  useEffect(() => {
    if (!session.profile) return
    void db.sourceCache.where('[owner_id+environment_id]').equals([session.profile.owner_id, environmentId]).toArray().then(setSources)
  }, [session.profile?.owner_id])

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-3xl">{t(locale, 'sources')}</h1>
      {sources.length === 0 ? <p className="text-muted">{t(locale, 'checkReferences')}</p> : null}
      {sources.map((source) => (
        <article key={source.source_id} className="rounded-xl border border-line bg-surface p-4">
          <h2>{source.title}</h2>
          <p className="text-sm text-muted">{source.organization} · {source.source_kind}</p>
          <p className="mt-2">{t(locale, 'localExcerpt')}: {source.local_summary}</p>
          <p className="mt-2 text-sm">{t(locale, 'limitation')}: {source.limitations}</p>
          {online ? (
            <a className="mt-3 inline-flex min-h-11 items-center gap-2" href={source.url} target="_blank" rel="noreferrer">
              {t(locale, 'openSource')} ↗
            </a>
          ) : (
            <p className="mt-3 text-sm text-attention">{t(locale, 'sourceOffline')}</p>
          )}
        </article>
      ))}
      <Link className="inline-flex min-h-11 items-center" to={session.profile ? '/onboard/today' : '/login'}>
        {t(locale, 'home')}
      </Link>
    </main>
  )
}

export function NotFoundPage() {
  const { locale } = useSession()
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <h1 className="text-3xl">{t(locale, 'notFound')}</h1>
      <Link className="inline-flex min-h-11 items-center" to="/">{t(locale, 'home')}</Link>
    </main>
  )
}
