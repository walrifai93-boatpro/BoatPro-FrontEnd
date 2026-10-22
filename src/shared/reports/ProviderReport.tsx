import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Anchor, Fuel, RefreshCw, Search, Ship, UserSearch, Wrench, X, type LucideIcon } from 'lucide-react'
import { reportApi, type ExportFormat, type ReportRun } from '../../api/platform'
import { fileUrl } from '../../api'
import { errorMessage } from '../../async/errors'
import { toast } from '../../ui'
import { formatPortalNumber, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'
import { TONE, isoDay, matchesQuery, resolvePeriod, type PeriodKey, type Tone } from './reportMeta'
import { ErrorNotice, PeriodChips } from './snapshot'
import { DownloadMenu, MetricTile } from './ReportView'
import { formatCell } from './reportFormat'

/**
 * The Provider report: pick one provider, see everything about them.
 *
 * The server's `provider-profile` report does the work — one row per fact, filed
 * under a section — and this screen is the shape that report deserves. The generic
 * report screen would have put the provider picker behind a "Filters" button and
 * drawn the sections as one long table; here the picker is the first thing on the
 * page, and each section is its own card. The Download menu exports the very rows
 * on screen, so the spreadsheet reads in the same order as the page.
 *
 * The provider travels in the address (`?provider=…`), so the provider directory
 * can link straight to one and a report can be bookmarked or shared.
 */

const KEY = 'provider-profile'

type ProviderPeriod = 'all' | Exclude<PeriodKey, 'custom' | '7d'>

const PERIOD_OPTIONS: readonly { key: ProviderPeriod; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'ytd', label: 'This year' },
  { key: '90d', label: '3 months' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
]

/** Before the platform took its first booking, so "all time" really is. */
const ALL_TIME_FROM = '2020-01-01'

const KINDS: readonly { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'boat_provider', label: 'Boats', icon: Ship },
  { key: 'marina_provider', label: 'Marinas', icon: Anchor },
  { key: 'fuel_provider', label: 'Fuel', icon: Fuel },
  { key: 'maintenance_provider', label: 'Maintenance', icon: Wrench },
]
const KIND_OF = new Map(KINDS.map(k => [k.key, k]))

/** How many matches the picker lists before asking for a narrower search. */
const PICKER_LIMIT = 60

interface Option { value: string; label: string; group?: string; image?: string }

interface Row { section: string; item: string; value: string | number; detail: string; _list?: boolean }

export function ProviderReport({ tone }: { tone: Tone }) {
  const t = TONE[tone]
  const [params, setParams] = useSearchParams()
  const providerId = params.get('provider') ?? ''

  const [options, setOptions] = React.useState<Option[] | null>(null)
  const [optionsError, setOptionsError] = React.useState('')
  const [optionsAttempt, setOptionsAttempt] = React.useState(0)
  const [picking, setPicking] = React.useState(!providerId)
  const [period, setPeriod] = React.useState<ProviderPeriod>('all')

  const [run, setRun] = React.useState<ReportRun | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [reloadTick, setReloadTick] = React.useState(0)
  const [downloading, setDownloading] = React.useState<ExportFormat | null>(null)

  React.useEffect(() => {
    let alive = true
    setOptionsError('')
    reportApi
      .filters(KEY)
      .then(res => {
        if (!alive) return
        setOptions(res.data.filters.find(f => f.key === 'providerId')?.options ?? [])
      })
      .catch(e => { if (alive) setOptionsError(errorMessage(e) || translatePortalText('Could not load the provider list')) })
    return () => { alive = false }
  }, [optionsAttempt])

  const range = React.useMemo(
    () => (period === 'all' ? { from: ALL_TIME_FROM, to: isoDay(new Date()) } : resolvePeriod(period)),
    [period]
  )
  const query = React.useMemo(
    () => ({ providerId, from: range.from, to: range.to }),
    [providerId, range.from, range.to]
  )

  React.useEffect(() => {
    if (!providerId) { setRun(null); return }
    let alive = true
    setBusy(true)
    reportApi
      // Every row on one page: a provider's report is read top to bottom, not paged.
      .run(KEY, { ...query, pageSize: '1000' })
      .then(res => { if (alive) { setRun(res.data); setError('') } })
      .catch(e => {
        if (!alive) return
        setRun(null)
        setError(errorMessage(e) || translatePortalText('Could not run the report'))
      })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [query, providerId, reloadTick])

  const choose = (id: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('provider', id)
      return next
    }, { replace: false })
    setPicking(false)
  }

  const download = async (format: ExportFormat) => {
    setDownloading(format)
    try {
      await reportApi.download(KEY, { format, ...query })
      toast(translatePortalText('Download started'), 'success')
    } catch (e) {
      toast(errorMessage(e) || translatePortalText('Download failed'), 'warn')
    } finally {
      setDownloading(null)
    }
  }

  const selected = options?.find(o => o.value === providerId)
  const sections = React.useMemo(() => groupSections((run?.rows ?? []) as unknown as Row[]), [run])

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-deep-900 md:text-[28px]">
            {translatePortalText('Provider report')}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[15px] font-medium text-slate-700">
            {translatePortalText('Pick any provider and see everything about them — listings, bookings, money and documents.')}
          </p>
        </div>
        {providerId && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadTick(n => n + 1)}
              disabled={busy}
              title={translatePortalText('Refresh')}
              aria-label={translatePortalText('Refresh')}
              className="btn-ghost !px-2.5 disabled:opacity-60"
            >
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
            </button>
            <DownloadMenu
              tone={tone}
              disabled={!run || !run.rows.length}
              disabledReason={translatePortalText(run ? 'Nothing to download for this provider' : 'Pick a provider first')}
              downloading={downloading}
              onPick={download}
            />
          </div>
        )}
      </header>

      {/* ── Who, and over what ─────────────────────────────── */}
      <section aria-label={translatePortalText('Report settings')} className="card relative mb-5 p-4">
        {busy && <span className="rv-progress" />}
        {optionsError ? (
          // With no retry the picker was gone until a full page reload.
          <ErrorNotice message={optionsError} onRetry={() => setOptionsAttempt(n => n + 1)} />
        ) : picking || !providerId ? (
          <ProviderPicker
            options={options}
            tone={tone}
            onPick={choose}
            onCancel={providerId ? () => setPicking(false) : undefined}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ChosenProvider option={selected} image={run?.image} fallbackName={run?.title?.replace(/^Provider report — /, '')} tone={tone} />
            <button type="button" onClick={() => setPicking(true)} className="btn-ghost !py-2">
              <UserSearch size={15} aria-hidden /> {translatePortalText('Change provider')}
            </button>
          </div>
        )}

        {providerId && !picking && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-slate-100 pt-3">
            <PeriodChips<ProviderPeriod>
              options={PERIOD_OPTIONS}
              value={period}
              onChange={setPeriod}
              tone={tone}
              label={translatePortalText('Period')}
            />
            <p className="text-xs text-slate-500">
              {translatePortalText('Bookings and money use this period. Listings, documents and reviews are as of today.')}
            </p>
          </div>
        )}
      </section>

      {/* ── The report ─────────────────────────────────────── */}
      {!providerId ? (
        <div className="card grid place-items-center px-4 py-14 text-center">
          <span aria-hidden className={`mb-3 grid h-12 w-12 place-items-center rounded-2xl ${t.soft}`}>
            <UserSearch size={22} />
          </span>
          <p className="font-display text-lg font-bold text-deep-900">{translatePortalText('Choose a provider to begin')}</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            {translatePortalText('You will see their profile, boats, marinas, stations or shops, bookings, money, documents and reviews — and can download it all as Excel, CSV or PDF.')}
          </p>
        </div>
      ) : error ? (
        <ErrorNotice message={error} onRetry={() => setReloadTick(n => n + 1)} />
      ) : !run ? (
        <div aria-busy className="animate-pulse space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map(i => <div key={i} className="card h-24 bg-slate-50" />)}
          </div>
          <div className="card h-64 bg-slate-50" />
        </div>
      ) : !run.rows.length ? (
        <div className="card px-4 py-12 text-center text-sm text-slate-500">
          {translatePortalText(run.subtitle || 'Nothing to show for this provider.')}
        </div>
      ) : (
        <div className={busy ? 'rv-busy' : 'rv-fresh'} aria-busy={busy || undefined}>
          {run.metrics.length > 0 && (
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {run.metrics.map(m => <MetricTile key={m.key} metric={m} />)}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {sections.filter(s => !s.list).map(s => <FactCard key={s.name} section={s} />)}
          </div>
          <div className="mt-4 space-y-4">
            {sections.filter(s => s.list).map(s => <ListCard key={s.name} section={s} />)}
          </div>

          <p className="mt-4 text-xs text-slate-500">{translatePortalText('Amounts are in SAR')}</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Picking a provider
// ─────────────────────────────────────────────────────────────

function ProviderPicker({
  options, tone, onPick, onCancel,
}: {
  options: Option[] | null
  tone: Tone
  onPick: (id: string) => void
  onCancel?: () => void
}) {
  const t = TONE[tone]
  const [kind, setKind] = React.useState<string>('all')
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { inputRef.current?.focus() }, [])

  const counts = React.useMemo(() => {
    const c = new Map<string, number>()
    for (const o of options ?? []) c.set(o.group ?? '', (c.get(o.group ?? '') ?? 0) + 1)
    return c
  }, [options])

  const matches = React.useMemo(
    () => (options ?? []).filter(o => (kind === 'all' || o.group === kind) && matchesQuery(o.label, query)),
    [options, kind, query]
  )
  const shown = matches.slice(0, PICKER_LIMIT)

  const chip = (key: string, label: string, count: number) => {
    const on = kind === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => setKind(key)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
          on ? `${t.solid} shadow-sm` : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-deep-900 hover:ring-slate-300'
        }`}
      >
        {translatePortalText(label)}
        <span className={`text-[11px] tabular-nums ${on ? 'text-white/80' : 'text-slate-400'}`}>{formatPortalNumber(count)}</span>
      </button>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[15px] font-bold text-deep-900">{translatePortalText('Which provider?')}</h2>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`text-xs font-semibold ${t.text} hover:underline`}>
            {translatePortalText('Cancel')}
          </button>
        )}
      </div>

      <div role="group" aria-label={translatePortalText('Provider type')} className="mb-3 flex flex-wrap gap-1.5">
        {chip('all', 'All', options?.length ?? 0)}
        {KINDS.map(k => chip(k.key, k.label, counts.get(k.key) ?? 0))}
      </div>

      <div className="relative mb-2">
        <Search size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && shown.length === 1) onPick(shown[0].value) }}
          placeholder={translatePortalText('Search by business name')}
          aria-label={translatePortalText('Search by business name')}
          className="input !py-2.5 !ps-9 !pe-8"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={translatePortalText('Clear search')}
            className="absolute end-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-deep-900"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {!options ? (
        <div aria-busy className="h-40 animate-pulse rounded-xl bg-slate-50" />
      ) : shown.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          {translatePortalText('No provider matches that search.')}
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {shown.map(o => {
            const k = KIND_OF.get(o.group ?? '')
            return (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => onPick(o.value)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-start transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                >
                  <ProviderLogo src={o.image} kind={o.group} tone={tone} size="small" />
                  <bdi className="min-w-0 flex-1 truncate text-sm font-semibold text-deep-900">{o.label}</bdi>
                  {k && <span className="shrink-0 text-xs font-medium text-slate-500">{translatePortalText(k.label)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {matches.length > shown.length && (
        <p className="mt-2 text-xs text-slate-500">
          {translatePortalTemplate('Showing {{shown}} of {{total}} — type to narrow the list.', {
            shown: formatPortalNumber(shown.length),
            total: formatPortalNumber(matches.length),
          })}
        </p>
      )}
    </div>
  )
}

/**
 * The provider's logo, or their type's icon when they have not uploaded one (or it
 * fails to load). Contained rather than cropped: a logo cut to a square loses its
 * wordmark, and these are logos first.
 */
function ProviderLogo({ src, kind, tone, size }: { src?: string | null; kind?: string; tone: Tone; size: 'small' | 'large' }) {
  const [broken, setBroken] = React.useState(false)
  React.useEffect(() => { setBroken(false) }, [src])
  const url = src && !broken ? fileUrl(src) : undefined
  const box = size === 'large' ? 'h-14 w-14 rounded-2xl' : 'h-8 w-8 rounded-lg'
  if (url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className={`${box} shrink-0 bg-white object-contain p-0.5 ring-1 ring-slate-200`}
      />
    )
  }
  const Icon = KIND_OF.get(kind ?? '')?.icon ?? UserSearch
  return (
    <span aria-hidden className={`grid ${box} shrink-0 place-items-center ${TONE[tone].soft}`}>
      <Icon size={size === 'large' ? 24 : 15} />
    </span>
  )
}

function ChosenProvider({ option, image, fallbackName, tone }: { option?: Option; image?: string | null; fallbackName?: string; tone: Tone }) {
  const k = KIND_OF.get(option?.group ?? '')
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProviderLogo src={image ?? option?.image} kind={option?.group} tone={tone} size="large" />
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-bold text-deep-900"><bdi>{option?.label ?? fallbackName ?? '…'}</bdi></p>
        {k && <p className="text-xs font-semibold text-slate-500">{translatePortalText(k.label)}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────

interface Section { name: string; list: boolean; rows: Row[] }

/** Rows arrive in order and filed by section; this keeps both. */
function groupSections(rows: Row[]): Section[] {
  const out: Section[] = []
  for (const row of rows) {
    const last = out[out.length - 1]
    if (last && last.name === row.section) last.rows.push(row)
    else out.push({ name: row.section, list: !!row._list, rows: [row] })
  }
  return out
}

function FactCard({ section }: { section: Section }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-slate-100 px-4 py-3 font-display text-[15px] font-bold text-deep-900">
        {translatePortalText(section.name)}
      </h2>
      <dl className="divide-y divide-slate-100">
        {section.rows.map((r, i) => (
          <div key={`${r.item}-${i}`} className="flex items-start justify-between gap-4 px-4 py-2.5">
            <dt className="min-w-0 text-sm text-slate-600">
              {translatePortalText(r.item)}
              {r.detail && <span className="mt-0.5 block text-xs text-slate-400"><bdi>{r.detail}</bdi></span>}
            </dt>
            <dd className="shrink-0 text-end text-sm font-bold tabular-nums text-deep-900">
              <bdi>{typeof r.value === 'number' ? formatPortalNumber(r.value) : translatePortalText(formatCell(r.value))}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function ListCard({ section }: { section: Section }) {
  const hasDetail = section.rows.some(r => r.detail)
  /*
    The server caps each list and closes it with an "…and N more" row. Counting
    only the rows sent put "20" beside a list of fifty; the closing row carries the
    rest, so the heading adds it back and shows the real size.
  */
  const shown = section.rows.filter(r => !r.item.startsWith('…')).length
  const more = Number(section.rows.find(r => r.item.startsWith('…'))?.item.match(/(\d+)\s+more/)?.[1] ?? 0)
  return (
    <section className="card overflow-hidden">
      <header className="flex items-baseline gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="font-display text-[15px] font-bold text-deep-900">{translatePortalText(section.name)}</h2>
        <span className="text-xs font-semibold text-slate-500">{formatPortalNumber(shown + more)}</span>
      </header>
      {/* Fixed columns, so the status sits in the same place in every list on the
          page. On a phone the details move under the name instead of a third column. */}
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className={hasDetail ? 'w-[64%] sm:w-[34%]' : 'w-[60%]'} />
          <col className={hasDetail ? 'w-[36%] sm:w-[18%]' : 'w-[40%]'} />
          {hasDetail && <col className="hidden sm:table-column" />}
        </colgroup>
        <tbody className="divide-y divide-slate-100">
          {section.rows.map((r, i) => (
            <tr key={`${r.item}-${i}`}>
              <td className="px-4 py-2.5 align-top font-semibold text-deep-900">
                <bdi className="break-words">{r.item}</bdi>
                {r.detail && <span className="mt-0.5 block text-xs font-normal text-slate-500 sm:hidden"><bdi>{r.detail}</bdi></span>}
              </td>
              <td className="px-4 py-2.5 align-top">
                {r.value !== '' && <StatusPill value={String(r.value)} />}
              </td>
              {hasDetail && <td className="hidden px-4 py-2.5 align-top text-slate-500 sm:table-cell"><bdi>{r.detail}</bdi></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Status words get a colour; prices and anything else stay plain. */
function StatusPill({ value }: { value: string }) {
  const v = value.toLowerCase()
  const cls =
    /^(approved|live|active|on duty|captain)$/.test(v) ? 'bg-emerald-50 text-emerald-700'
      : /^(pending|draft|invited|needs review|off duty|on leave)$/.test(v) ? 'bg-amber-50 text-amber-700'
      : /^(rejected|inactive|expired|suspended|blocked|disabled)$/.test(v) ? 'bg-rose-50 text-rose-700'
      : null
  if (!cls) return <span className="whitespace-nowrap font-semibold tabular-nums text-slate-700"><bdi>{value}</bdi></span>
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{translatePortalText(value)}</span>
}
