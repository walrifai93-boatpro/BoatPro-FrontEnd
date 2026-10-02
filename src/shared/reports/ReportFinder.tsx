import React from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Boxes, Building2, CalendarCheck, Search, ShieldCheck, Users, Wallet, X, type LucideIcon,
} from 'lucide-react'
import {
  TONE, TOPICS, matchesQuery, startHereItems, topicCounts, type FinderItem, type Tone, type TopicId,
} from './reportMeta'
import type { ReportPortal } from '../../api/platform'
import { formatPortalNumber, isPortalArabic, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

const TOPIC_ICON: Record<TopicId, LucideIcon> = {
  money: Wallet,
  activity: CalendarCheck,
  customers: Users,
  team: Boxes,
  compliance: ShieldCheck,
  platform: Building2,
}

/** Which slice of the catalog the cards show. `start` is the short curated list. */
type View = 'start' | 'all' | TopicId

/**
 * "Find a report".
 *
 * The catalog has up to forty-eight reports, and the old index showed all of them at
 * once as a scrolling list of names. This shows a handful, chosen (`Start here`), and
 * puts everything else one step away in three ways that suit three kinds of reader:
 * a topic chip for someone browsing, the search box for someone who knows the word,
 * and "All" for someone who wants to see the lot.
 *
 * Each card is a real link, so it can be opened in a new tab, bookmarked, or pasted
 * to a colleague.
 */
export function ReportFinder({
  items, portal, tone, basePath,
}: {
  items: FinderItem[]
  portal: ReportPortal
  tone: Tone
  basePath: string
}) {
  const [view, setView] = React.useState<View>('start')
  const [query, setQuery] = React.useState('')
  const searchId = React.useId()

  const arabic = isPortalArabic()
  const t = TONE[tone]

  // The text a search runs over: what the reader sees (translated), plus the
  // server's own wording and the topic name, so "vat" finds "VAT summary" and
  // "money" finds everything filed under Money.
  const haystack = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) {
      const topic = TOPICS.find(x => x.id === item.topic)
      map.set(
        item.key,
        [
          translatePortalText(item.label), item.label,
          translatePortalText(item.plain), item.plain,
          item.entry.description,
          topic ? `${translatePortalText(topic.label)} ${topic.label}` : '',
          item.family?.members.map(m => translatePortalText(m.label)).join(' ') ?? '',
          item.key.replace(/-/g, ' '),
        ].join(' ')
      )
    }
    return map
    // Language changes reload the portal, but keying on it keeps this honest.
  }, [items, arabic])

  const start = React.useMemo(() => startHereItems(items, portal), [items, portal])
  const counts = React.useMemo(() => topicCounts(items), [items])

  const searching = query.trim().length > 0
  const shown: FinderItem[] = searching
    ? items.filter(i => matchesQuery(haystack.get(i.key) ?? '', query))
    : view === 'start' ? start
    : view === 'all' ? items
    : items.filter(i => i.topic === view)

  // "All" and a topic are shown under their topic headings; "Start here" and search
  // results are one flat, ordered set.
  const grouped = !searching && view === 'all'

  const chips: { id: View; label: string; count?: number }[] = [
    { id: 'start', label: 'Start here' },
    ...counts.map(c => ({ id: c.topic.id as View, label: c.topic.chip, count: c.count })),
    { id: 'all', label: 'All', count: items.length },
  ]
  // A console with only one or two topics gains nothing from a row of chips.
  const showChips = counts.length > 1 && items.length > start.length

  return (
    <section aria-labelledby={`${searchId}-h`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id={`${searchId}-h`} className="font-display text-lg font-bold text-deep-900">{translatePortalText('Find a report')}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {translatePortalText('Open a report to see the numbers. You can download it from inside.')}
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search size={16} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id={searchId}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={translatePortalText('Search reports — try “payouts”')}
            aria-label={translatePortalText('Search reports')}
            className="input !py-2.5 !ps-9 !pe-9 !text-sm"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={translatePortalText('Clear search')}
              className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-deep-900"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {showChips && !searching && (
        <div role="group" aria-label={translatePortalText('Report topics')} className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {chips.map(c => {
            const on = c.id === view
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setView(c.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  on ? `${t.solid} shadow-sm` : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-deep-900 hover:ring-slate-300'
                }`}
              >
                {translatePortalText(c.label)}
                {c.count !== undefined && (
                  <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${on ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {formatPortalNumber(c.count)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {searching && shown.length > 0 && (
        <p className="mb-3 text-sm text-slate-500" aria-live="polite">
          {translatePortalTemplate('Results for “{{query}}”', { query: query.trim() })}
          <span className="ms-1.5 font-semibold text-slate-600">· {formatPortalNumber(shown.length)}</span>
        </p>
      )}

      {shown.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
          <Search size={22} className="mb-2 text-slate-400" aria-hidden />
          <p className="text-sm font-semibold text-slate-700">
            {searching
              ? translatePortalTemplate('No reports match “{{query}}”', { query: query.trim() })
              : translatePortalText('No reports available yet')}
          </p>
          {searching && (
            <>
              <p className="mt-0.5 text-xs text-slate-500">{translatePortalText('Try a shorter word, like “fuel” or “fees”.')}</p>
              <button type="button" onClick={() => setQuery('')} className="btn-ghost mt-3 !py-1.5 !text-xs">
                {translatePortalText('Clear search')}
              </button>
            </>
          )}
        </div>
      ) : grouped ? (
        <div className="space-y-6">
          {TOPICS.map(topic => {
            const inTopic = shown.filter(i => i.topic === topic.id)
            if (!inTopic.length) return null
            return (
              <div key={topic.id}>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">
                  {React.createElement(TOPIC_ICON[topic.id], { size: 15, 'aria-hidden': true })}
                  {translatePortalText(topic.label)}
                  <span className="text-slate-400">{formatPortalNumber(inTopic.length)}</span>
                </h3>
                <Cards items={inTopic} tone={tone} basePath={basePath} />
              </div>
            )
          })}
        </div>
      ) : (
        <Cards items={shown} tone={tone} basePath={basePath} />
      )}

      {!searching && view === 'start' && showChips && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setView('all')}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold ${t.text} hover:underline`}
          >
            {translatePortalTemplate('Show all {{count}} reports', { count: formatPortalNumber(items.length) })}
            <ArrowRight size={14} className="rtl:rotate-180" aria-hidden />
          </button>
        </div>
      )}
    </section>
  )
}

function Cards({ items, tone, basePath }: { items: FinderItem[]; tone: Tone; basePath: string }) {
  const t = TONE[tone]
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(item => {
        const Icon = TOPIC_ICON[item.topic]
        return (
          <li key={item.key} className="min-w-0">
            <Link
              to={`${basePath}/${item.key}`}
              className={`group flex h-full items-start gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:shadow-lift ${t.hoverBorder}`}
            >
              <span aria-hidden className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${t.soft}`}>
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold leading-snug text-deep-900">{translatePortalText(item.label)}</span>
                <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-slate-600">{translatePortalText(item.plain)}</span>
              </span>
              <ArrowRight
                size={16}
                aria-hidden
                className={`mt-0.5 shrink-0 text-slate-300 transition duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5 ${t.groupHoverText}`}
              />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
