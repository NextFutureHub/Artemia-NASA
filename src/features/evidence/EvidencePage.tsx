import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../app/session.tsx'
import { db } from '../../data/local/db.ts'
import { environmentId } from '../../data/remote/client.ts'
import { EVIDENCE_CATALOG, visibleEvidence, type EvidenceCard, type EvidenceKind } from '../../domain/evidenceCatalog.ts'
import { t } from '../../i18n/copy.ts'
import type { SourceCache } from '../../data/local/types.ts'

export function EvidencePage() {
  const session = useSession()
  const locale = session.locale
  const [cached, setCached] = useState<SourceCache[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<EvidenceKind | 'all'>('all')
  const online = session.connection === 'online'

  useEffect(() => {
    if (!session.profile) return
    void db.sourceCache.where('[owner_id+environment_id]').equals([session.profile.owner_id, environmentId]).toArray().then(setCached)
  }, [session.profile?.owner_id])

  const cards = visibleEvidence(query, kind, mergeCatalog(cached))
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-3xl">{t(locale, 'sources')}</h1>
      <p className="text-sm text-muted">{t(locale, 'sourceDoesNotProve')}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t(locale, 'evidenceSearch')}
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 rounded-xl border border-line bg-canvas px-3" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t(locale, 'evidenceAll')}
        <select value={kind} onChange={(event) => setKind(event.target.value as EvidenceKind | 'all')} className="min-h-11 rounded-xl border border-line bg-canvas px-3">
          <option value="all">{t(locale, 'evidenceAll')}</option>
          <option value="research_context">{t(locale, 'kindResearch')}</option>
          <option value="agency_requirement">{t(locale, 'kindAgency')}</option>
          <option value="technical_documentation">{t(locale, 'kindTechnical')}</option>
          <option value="prototype_rule">{t(locale, 'kindPrototype')}</option>
        </select>
      </label>
      {cards.length === 0 ? <p>{t(locale, 'historyEmpty')}</p> : null}
      {cards.map((source) => (
        <article key={source.id} className="rounded-xl border border-line bg-surface p-4">
          <h2>{source.title}</h2>
          <p className="text-sm text-muted">{source.organization} · {kindLabel(locale, source.kind)}</p>
          <p className="numeric text-sm text-muted">{t(locale, 'evidenceChecked', { date: source.accessedAt })}</p>
          <p className="mt-2">{t(locale, 'localExcerpt')}: {source.summary}</p>
          <p className="mt-2 text-sm">{t(locale, 'limitation')}: {source.limitations}</p>
          {source.url === '' ? null : online ? (
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

function mergeCatalog(cached: SourceCache[]): EvidenceCard[] {
  return EVIDENCE_CATALOG.map((card) => {
    const stored = cached.find((item) => item.source_id === card.id)
    if (!stored) return card
    return {
      ...card,
      title: stored.title,
      organization: stored.organization,
      url: stored.url,
      summary: stored.local_summary,
      limitations: stored.limitations,
    }
  })
}

function kindLabel(locale: 'ru' | 'en', kind: EvidenceKind): string {
  if (kind === 'agency_requirement') return t(locale, 'kindAgency')
  if (kind === 'technical_documentation') return t(locale, 'kindTechnical')
  if (kind === 'prototype_rule') return t(locale, 'kindPrototype')
  return t(locale, 'kindResearch')
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
