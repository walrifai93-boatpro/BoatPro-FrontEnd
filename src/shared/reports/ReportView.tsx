import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowDown, ArrowDownRight, ArrowLeft, ArrowUp, ArrowUpRight, BellRing, CalendarDays, ChevronDown,
  ChevronLeft, ChevronRight, ChevronsUpDown, Download, FileDown, FileSpreadsheet, FileText, Info,
  RefreshCw, Search, ShieldCheck, SlidersHorizontal, X, type LucideIcon,
} from 'lucide-react'
import {
  reportApi, ROW_LINK,
  type ExportFormat, type Granularity, type ReportActionDef, type ReportCatalogEntry,
  type ReportFilterDef, type ReportMetric, type ReportRowLink, type ReportRun, type ReportSeries,
} from '../../api/platform'
import { toast, Spinner } from '../../ui'
import { confirm } from '../../async/confirm'
import { errorMessage } from '../../async/errors'
import {
  formatPortalDate, formatPortalNumber, isPortalArabic, translatePortalTemplate, translatePortalText,
} from '../../i18n/runtime'
import {
  PERIODS, TONE, TOPICS, isoDay, resolvePeriod, type FinderItem, type PeriodKey, type Tone,
} from './reportMeta'
import {
  BarList, ChartFrame, ColumnChart, TrendChart, formatValue, type ChartTableData,
} from './viz'
import {
  formatCell, formatMetric, formatReportSubtitle, isDateWindowSubtitle, isOrderedAxis, seriesToRows,
} from './reportFormat'
import { ErrorNotice, PeriodChips } from './snapshot'

/**
 * One report, opened.
 *
 * The screen is a straight line: *what is this → over what period → the headline
 * numbers → the charts → the rows → download.* The old screen put the period, a
 * "grain", filters, a Run button, an action and three export buttons in one wrapped
 * row of equal-looking controls and left the reader to work out which mattered. Here
 * the period is first and obvious, the things most reports do not need (grouping,
 * filters) appear only when the report has them, and every way to take the data away
 * lives in one Download menu.
 *
 * The report defines its own columns, filters, actions and charts on the server; this
 * component renders whatever it is given, so a report added there needs no change here.
 */

export interface PeriodState {
  key: PeriodKey
  custom: { from: string; to: string }
}

const PAGE_SIZES = [50, 100, 250, 500, 1000]

const GRAIN_LABEL: Record<Granularity, string> = {
  auto: 'Automatic',
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
}

const EXPORTS: { format: ExportFormat; label: string; hint: string; icon: LucideIcon }[] = [
  { format: 'excel', label: 'Excel', hint: 'For spreadsheets', icon: FileSpreadsheet },
  { format: 'csv', label: 'CSV', hint: 'A plain data file', icon: FileText },
  { format: 'pdf', label: 'PDF', hint: 'To print or share', icon: FileDown },
]

export function ReportView({
  entry, item, catalog, basePath, tone, isAdmin, period, onPeriod, initialFilters,
}: {
  entry: ReportCatalogEntry
  item?: FinderItem
  catalog: ReportCatalogEntry[]
  basePath: string
  tone: Tone
  isAdmin: boolean
  period: PeriodState
  onPeriod: (next: PeriodState) => void
  initialFilters?: Record<string, string>
}) {
  const navigate = useNavigate()
  const t = TONE[tone]
  const titleRef = React.useRef<HTMLHeadingElement>(null)

  const [meta, setMeta] = React.useState<{ filters: ReportFilterDef[]; actions: ReportActionDef[]; grains: Granularity[] } | null>(null)
  const [filterValues, setFilterValues] = React.useState<Record<string, string>>(initialFilters ?? {})
  const [showFilters, setShowFilters] = React.useState(() => Object.keys(initialFilters ?? {}).length > 0)
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [grain, setGrain] = React.useState<Granularity>('auto')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(100)

  const [run, setRun] = React.useState<ReportRun | null>(null)
  const [busy, setBusy] = React.useState(true)
  const [error, setError] = React.useState('')
  const [reloadTick, setReloadTick] = React.useState(0)
  // The filters/actions list failing is its own error: the report can still run,
  // but silently losing the Filters button read as "this report has no filters".
  const [metaError, setMetaError] = React.useState<string | null>(null)
  const [metaTick, setMetaTick] = React.useState(0)
  const [downloading, setDownloading] = React.useState<ExportFormat | null>(null)
  const [runningAction, setRunningAction] = React.useState<string | null>(null)

  const range = React.useMemo(() => resolvePeriod(period.key, period.custom), [period])

  // Arriving from another page: land on the heading, at the top, so a keyboard or
  // screen-reader user starts reading the report rather than the page they left.
  React.useEffect(() => {
    window.scrollTo({ top: 0 })
    titleRef.current?.focus({ preventScroll: true })
  }, [entry.key])

  // What filters, actions and groupings this report offers.
  React.useEffect(() => {
    let alive = true
    setMetaError(null)
    reportApi
      .filters(entry.key)
      .then(res => {
        if (!alive) return
        setMeta({ filters: res.data.filters ?? [], actions: res.data.actions ?? [], grains: res.data.granularities ?? [] })
        if (res.data.defaultPageSize) setPageSize(res.data.defaultPageSize)
      })
      .catch(e => {
        if (!alive) return
        setMeta({ filters: [], actions: [], grains: [] })
        setMetaError(errorMessage(e) || translatePortalText('Could not load the filters for this report'))
      })
    return () => { alive = false }
  }, [entry.key, metaTick])

  // Debounced: the server re-runs the whole report, which is not a per-keystroke operation.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(id)
  }, [search])

  const filtersKey = JSON.stringify(filterValues)
  // Anything that changes what the result *is* goes back to page one. Staying on
  // page 4 of a result that now has two pages shows an empty table and reads as broken.
  React.useEffect(() => { setPage(1) }, [range.from, range.to, filtersKey, debouncedSearch, pageSize])

  /**
   * One place builds the query, and both the run and the download use it. That is
   * what keeps a downloaded file the same as the table above it: two builders would
   * drift the first time a filter was added to one of them.
   */
  const queryParams = React.useMemo(() => {
    const params: Record<string, string> = {}
    if (entry.dateRanged) {
      params.from = range.from
      params.to = range.to
    }
    for (const [key, value] of Object.entries(filterValues)) if (value !== '' && value !== undefined) params[key] = value
    if (debouncedSearch) params.search = debouncedSearch
    if (sort) { params.sort = sort.key; params.dir = sort.dir }
    if (grain !== 'auto') params.granularity = grain
    params.page = String(page)
    params.pageSize = String(pageSize)
    return params
    // filtersKey stands in for filterValues so an unchanged object never refires this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.dateRanged, entry.key, range.from, range.to, filtersKey, debouncedSearch, sort, grain, page, pageSize])
  const paramsKey = JSON.stringify(queryParams)

  const exportParams = React.useMemo(() => {
    const { page: _p, pageSize: _s, ...rest } = queryParams
    return rest
  }, [queryParams])

  // Fetch. `alive` guards the *order*, not just the unmount: click through three
  // periods quickly and the slowest answer would otherwise arrive last and write
  // 7-day figures under a heading that says 30 days.
  React.useEffect(() => {
    let alive = true
    setBusy(true)
    reportApi
      .run(entry.key, queryParams)
      .then(res => {
        if (!alive) return
        setRun(res.data)
        setError('')
      })
      .catch(e => {
        if (!alive) return
        // No stale numbers under a period they do not belong to.
        setRun(null)
        setError(errorMessage(e) || translatePortalText('Could not run the report'))
      })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.key, paramsKey, reloadTick])

  const download = async (format: ExportFormat) => {
    setDownloading(format)
    try {
      await reportApi.download(entry.key, { format, ...exportParams })
      toast(translatePortalTemplate('{{format}} download started', { format: EXPORTS.find(e => e.format === format)?.label ?? format }), 'success')
    } catch (e) {
      toast(errorMessage(e) || translatePortalText('Download failed'), 'warn')
    } finally {
      setDownloading(null)
    }
  }

  const runAction = async (action: ReportActionDef) => {
    if (action.confirm) {
      const accepted = await confirm({
        title: translatePortalText('Confirm report action'),
        body: translatePortalText(action.confirm),
        confirmLabel: translatePortalText(action.label),
      })
      if (!accepted) return
    }
    setRunningAction(action.key)
    try {
      const res = await reportApi.action(entry.key, action.key, queryParams)
      toast(translatePortalText(res.data.message), res.data.count ? 'success' : 'warn')
      setReloadTick(n => n + 1)
    } catch (e) {
      toast(errorMessage(e) || translatePortalText('That did not work'), 'warn')
    } finally {
      setRunningAction(null)
    }
  }

  // A row that goes somewhere: guarded on the catalog (already role-filtered by the
  // server), so a link never leads to a report this account cannot run.
  const linkFor = (row: Record<string, unknown>): ReportRowLink | null => {
    const link = row[ROW_LINK] as ReportRowLink | undefined
    if (!link?.report || !catalog.some(r => r.key === link.report)) return null
    return link
  }
  const drillTo = (link: ReportRowLink) => {
    const filters = link.filters ?? {}
    if (link.report === entry.key) {
      setFilterValues(filters)
      setShowFilters(Object.keys(filters).length > 0)
      return
    }
    navigate(`${basePath}/${link.report}`, { state: { filters } })
  }

  const activeFilters = Object.entries(filterValues).filter(([, v]) => v !== '' && v !== undefined)
  const topic = item ? TOPICS.find(x => x.id === item.topic) : undefined
  const family = item?.family
  const title = family ? family.label : entry.label
  const plain = item?.plain
  const fullDescription = entry.description
  const dateWindow = `${formatPortalDate(range.from, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${formatPortalDate(range.to, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}`

  const lineSeries = (run?.series ?? []).some(s => s.kind === 'line')
  const canGroup = lineSeries && (meta?.grains.length ?? 0) > 0
  const charts = (run?.series ?? []).filter(s => s.points.length > 1)
  const hasMoney =
    !!run?.metrics.some(m => m.kind === 'currency') || !!run?.series.some(s => s.valueKind === 'currency')

  const hasFilterOrSearch = activeFilters.length > 0 || debouncedSearch !== ''
  const noRows = !!run && run.rows.length === 0

  return (
    <div>
      {/* ── Where am I ─────────────────────────────────────── */}
      <nav aria-label={translatePortalText('Breadcrumb')} className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
        <Link
          to={basePath}
          className="-ms-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-deep-900"
        >
          <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden />
          {translatePortalText('All reports')}
        </Link>
        {topic && (
          <>
            <span aria-hidden className="text-slate-300">/</span>
            <span className="text-slate-500">{translatePortalText(topic.label)}</span>
          </>
        )}
      </nav>

      {/* ── What is this, and what can I do with it ───────── */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-80">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-2xl font-extrabold tracking-tight text-deep-900 outline-none md:text-[28px]"
          >
            {translatePortalText(title)}
          </h1>
          {plain && plain !== fullDescription && (
            <p className="mt-1.5 text-[15px] font-medium text-slate-700">{translatePortalText(plain)}</p>
          )}
          <p className={`max-w-3xl text-sm text-slate-500 ${plain && plain !== fullDescription ? 'mt-1' : 'mt-1.5'}`}>
            {translatePortalText(fullDescription)}
          </p>
          {run?.subtitle && !isDateWindowSubtitle(run.subtitle) && (
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{formatReportSubtitle(run.subtitle)}</p>
          )}
          {!isAdmin && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
              <ShieldCheck size={12} aria-hidden /> {translatePortalText('Your own data only')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(meta?.actions ?? []).map(action => (
            <button
              key={action.key}
              type="button"
              onClick={() => void runAction(action)}
              disabled={runningAction !== null || !run?.rows.length}
              title={action.description ? translatePortalText(action.description) : undefined}
              className="btn-ghost disabled:opacity-40"
            >
              {runningAction === action.key ? <Spinner size={14} /> : <BellRing size={15} />}
              {translatePortalText(action.label)}
            </button>
          ))}
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
            disabled={!run || !run.matchedRows}
            disabledReason={run ? translatePortalText('Nothing to download for this period') : undefined}
            downloading={downloading}
            onPick={download}
          />
        </div>
      </header>

      {family && (
        <div role="group" aria-label={translatePortalText('Provider type')} className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500">{translatePortalText('Provider type')}</span>
          {family.members.filter(m => catalog.some(c => c.key === m.key)).map(m => {
            const on = m.key === entry.key
            return (
              <Link
                key={m.key}
                to={`${basePath}/${m.key}`}
                aria-current={on ? 'page' : undefined}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  on ? `${t.solid} shadow-sm` : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-deep-900 hover:ring-slate-300'
                }`}
              >
                {translatePortalText(m.label)}
              </Link>
            )
          })}
        </div>
      )}

      {/* ── Over what ─────────────────────────────────────── */}
      <section aria-label={translatePortalText('Report settings')} className="card relative mb-5 p-4">
        {busy && <span className="rv-progress" />}
        {entry.dateRanged ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <PeriodChips
              options={PERIODS}
              value={period.key}
              onChange={key => {
                // Picking Custom starts from the window already on screen, so the
                // dates are a starting point rather than a blank.
                onPeriod({ key, custom: key === 'custom' ? { from: range.from, to: range.to } : period.custom })
              }}
              tone={tone}
              label={translatePortalText('Period')}
            />
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600">
              <CalendarDays size={15} aria-hidden className="text-slate-400" />
              <bdi>{dateWindow}</bdi>
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Info size={16} aria-hidden className="shrink-0 text-slate-400" />
            {translatePortalText('This report shows how things stand right now, so it has no date range.')}
          </p>
        )}

        {entry.dateRanged && period.key === 'custom' && (
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <label className="block text-xs font-semibold text-slate-600">
              {translatePortalText('From')}
              <input
                type="date"
                value={period.custom.from}
                max={period.custom.to}
                onChange={e => e.target.value && onPeriod({ key: 'custom', custom: { ...period.custom, from: e.target.value } })}
                className="input !mt-1 !w-auto !py-2"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              {translatePortalText('To')}
              <input
                type="date"
                value={period.custom.to}
                min={period.custom.from}
                onChange={e => e.target.value && onPeriod({ key: 'custom', custom: { ...period.custom, to: e.target.value } })}
                className="input !mt-1 !w-auto !py-2"
              />
            </label>
          </div>
        )}

        {(canGroup || (meta?.filters.length ?? 0) > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
            {(meta?.filters.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setShowFilters(v => !v)}
                aria-expanded={showFilters}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                  showFilters || activeFilters.length
                    ? `${t.activeSoft} ring-1`
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300'
                }`}
              >
                <SlidersHorizontal size={14} aria-hidden />
                {translatePortalText('Filters')}
                {activeFilters.length > 0 && (
                  <span className="rounded-full bg-white/70 px-1.5 text-[11px] font-bold tabular-nums">{formatPortalNumber(activeFilters.length)}</span>
                )}
              </button>
            )}
            {activeFilters.map(([key, value]) => {
              const def = meta?.filters.find(f => f.key === key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterValues(prev => ({ ...prev, [key]: '' }))}
                  title={translatePortalText('Remove this filter')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 ps-3 pe-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  <span className="text-slate-500">{translatePortalText(def?.label ?? key)}:</span>
                  <bdi>{describeFilterValue(def, value)}</bdi>
                  <X size={12} aria-hidden />
                </button>
              )
            })}
            {activeFilters.length > 1 && (
              <button type="button" onClick={() => setFilterValues({})} className={`text-xs font-semibold ${t.text} hover:underline`}>
                {translatePortalText('Clear all')}
              </button>
            )}
            {canGroup && (
              <label className="ms-auto flex items-center gap-2 text-[13px] font-semibold text-slate-600">
                {translatePortalText('Group by')}
                <select
                  value={grain}
                  onChange={e => setGrain(e.target.value as Granularity)}
                  className="input !w-auto !py-1.5"
                  title={translatePortalText('How finely the chart is bucketed')}
                >
                  {(meta?.grains ?? []).map(g => (
                    <option key={g} value={g}>{translatePortalText(GRAIN_LABEL[g] ?? g)}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {showFilters && (meta?.filters.length ?? 0) > 0 && (
          <div className="mt-3 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {meta!.filters.map(def => (
              <FilterControl
                key={def.key}
                def={def}
                tone={tone}
                value={filterValues[def.key] ?? ''}
                onChange={v => setFilterValues(prev => ({ ...prev, [def.key]: v }))}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── The result ────────────────────────────────────── */}
      {metaError && <div className="mb-5"><ErrorNotice message={metaError} onRetry={() => setMetaTick(n => n + 1)} /></div>}
      {error && <div className="mb-5"><ErrorNotice message={error} onRetry={() => setReloadTick(n => n + 1)} /></div>}

      {!run && !error ? (
        <ReportSkeleton />
      ) : run ? (
        <div className={busy ? 'rv-busy' : 'rv-fresh'} aria-busy={busy || undefined}>
          {run.metrics.length > 0 && (
            <div className={`mb-5 grid grid-cols-2 gap-3 ${metricCols(run.metrics.length)}`}>
              {run.metrics.map(m => <MetricTile key={m.key} metric={m} />)}
            </div>
          )}

          {charts.length > 0 && (
            <div className={`mb-5 grid gap-4 ${charts.length > 1 ? 'lg:grid-cols-2' : ''}`}>
              {charts.map((s, i) => <SeriesChart key={`${s.label}-${i}`} series={s} />)}
            </div>
          )}

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3">
              <h2 className="me-auto font-display text-[15px] font-bold text-deep-900">
                {translatePortalText('Details')}
                <span className="ms-2 text-xs font-semibold text-slate-500">
                  {run.matchedRows !== run.totalRows
                    ? translatePortalTemplate('{{matched}} of {{total}} rows', { matched: formatPortalNumber(run.matchedRows), total: formatPortalNumber(run.totalRows) })
                    : translatePortalTemplate('{{count}} rows', { count: formatPortalNumber(run.matchedRows) })}
                </span>
              </h2>
              <div className="relative w-full sm:w-64">
                <Search size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={translatePortalText('Search in this report')}
                  aria-label={translatePortalText('Search in this report')}
                  className="input !py-2 !ps-9 !pe-8"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label={translatePortalText('Clear search')}
                    className="absolute end-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-deep-900"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </header>

            {noRows ? (
              <EmptyResult
                filtered={hasFilterOrSearch}
                dateRanged={entry.dateRanged}
                onClear={() => { setFilterValues({}); setSearch('') }}
                onWiden={() => {
                  const now = new Date()
                  onPeriod({
                    key: 'custom',
                    custom: { from: isoDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)), to: isoDay(now) },
                  })
                }}
              />
            ) : (
              <ResultTable
                run={run}
                sort={sort}
                onSort={setSort}
                linkFor={linkFor}
                onDrill={drillTo}
                catalog={catalog}
              />
            )}

            {!noRows && (
              <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
                <span>
                  {formatPortalNumber(run.page.from)}–{formatPortalNumber(run.page.to)} {translatePortalText('of')} {formatPortalNumber(run.matchedRows)}
                  {hasMoney && <span className="ms-2 text-slate-500">· {translatePortalText('Amounts are in SAR')}</span>}
                </span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 font-semibold">
                    {translatePortalText('Rows per page')}
                    <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="input !w-auto !py-1 !text-xs">
                      {PAGE_SIZES.map(n => <option key={n} value={n}>{formatPortalNumber(n)}</option>)}
                    </select>
                  </label>
                  {run.page.pages > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={run.page.page <= 1}
                        aria-label={translatePortalText('Previous page')}
                        title={translatePortalText('Previous page')}
                        className="btn-ghost !px-2 !py-1.5 disabled:opacity-30"
                      >
                        <ChevronLeft size={14} className="rtl:rotate-180" />
                      </button>
                      <span className="min-w-[4.5rem] text-center font-bold tabular-nums text-deep-900">
                        {formatPortalNumber(run.page.page)} / {formatPortalNumber(run.page.pages)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage(p => Math.min(run.page.pages, p + 1))}
                        disabled={run.page.page >= run.page.pages}
                        aria-label={translatePortalText('Next page')}
                        title={translatePortalText('Next page')}
                        className="btn-ghost !px-2 !py-1.5 disabled:opacity-30"
                      >
                        <ChevronRight size={14} className="rtl:rotate-180" />
                      </button>
                    </div>
                  )}
                </div>
                {/* Stated rather than implied: a capped export that looks complete is how
                    somebody reconciles against a subset. */}
                {run.truncated && (
                  <span className="w-full font-bold text-orange-600">
                    {translatePortalText('Capped — narrow the period to see everything')}
                  </span>
                )}
              </footer>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────

/** How many columns the metric row uses: a row of four or three, never an orphan of one. */
function metricCols(n: number): string {
  if (n <= 1) return 'md:grid-cols-1'
  if (n === 2) return 'md:grid-cols-2'
  if (n === 3) return 'md:grid-cols-3'
  if (n === 4) return 'md:grid-cols-4'
  return 'md:grid-cols-3'
}

function describeFilterValue(def: ReportFilterDef | undefined, value: string): string {
  if (!def) return value
  if (def.kind === 'boolean') return translatePortalText('Yes')
  if (def.kind === 'select' || def.kind === 'multiselect') {
    return value
      .split(',')
      .filter(Boolean)
      .map(v => translatePortalText(def.options.find(o => o.value === v)?.label ?? v))
      .join(', ')
  }
  return value
}

/** A short explanation that opens on hover *and* on keyboard focus. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="grid h-5 w-5 place-items-center rounded-full text-slate-400 outline-none transition hover:text-slate-600 focus-visible:text-slate-700"
      >
        <Info size={13} aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute start-0 top-full z-20 mt-1 w-56 rounded-lg bg-deep-900 px-3 py-2 text-xs font-medium normal-case leading-snug text-white opacity-0 shadow-lift transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

export function MetricTile({ metric }: { metric: ReportMetric }) {
  const shown = formatMetric(metric.value, metric.kind)
  const up = (metric.delta ?? 0) >= 0
  return (
    <div className="card min-w-0 p-4">
      <p className="flex items-center gap-1 text-[13px] font-semibold leading-snug text-slate-600">
        {translatePortalText(metric.label)}
        {!!metric.hint && <InfoTip text={translatePortalText(metric.hint)} />}
      </p>
      <p className="mt-1.5 truncate font-display text-[24px] font-extrabold leading-tight tracking-tight text-deep-900" title={shown}>
        {shown}
      </p>
      {metric.delta !== undefined && Number.isFinite(metric.delta) && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs">
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold ${
              up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
            }`}
          >
            {up ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
            {formatPortalNumber(Math.abs(metric.delta), { maximumFractionDigits: 1 })}{isPortalArabic() ? '٪' : '%'}
          </span>
          <span className="text-slate-500">{translatePortalText('vs previous period')}</span>
        </p>
      )}
    </div>
  )
}

/** Chooses the honest form for a server series and draws it in a frame with a table twin. */
function SeriesChart({ series }: { series: ReportSeries }) {
  const kind = series.valueKind
  const rows = React.useMemo(() => seriesToRows(series), [series])
  const ordered = series.kind === 'line' || isOrderedAxis(series.points.map(p => p.x))
  const name = translatePortalText(series.label)

  const table: ChartTableData = {
    columns: [translatePortalText(ordered ? 'Period' : 'Category'), translatePortalText('Value')],
    rows: rows.map(r => [String(r.xFull ?? r.x), formatValue(Number(r.y), kind)]),
  }

  return (
    <ChartFrame title={name} table={table}>
      {series.kind === 'line' ? (
        <TrendChart data={rows} series={[{ key: 'y', label: name }]} kind={kind} />
      ) : ordered ? (
        <ColumnChart data={rows} series={[{ key: 'y', label: name }]} kind={kind} xInterval={rows.length > 14 ? 'preserveStartEnd' : 0} />
      ) : (
        <BarList items={rows.map(r => ({ label: String(r.xFull ?? r.x), value: Number(r.y) }))} kind={kind} />
      )}
    </ChartFrame>
  )
}

function ResultTable({
  run, sort, onSort, linkFor, onDrill, catalog,
}: {
  run: ReportRun
  sort: { key: string; dir: 'asc' | 'desc' } | null
  onSort: (s: { key: string; dir: 'asc' | 'desc' }) => void
  linkFor: (row: Record<string, unknown>) => ReportRowLink | null
  onDrill: (link: ReportRowLink) => void
  catalog: ReportCatalogEntry[]
}) {
  const anyLink = run.rows.some(r => linkFor(r))
  const widths = run.columns.map(c => c.width ?? 14)
  const totalUnits = widths.reduce((sum, w) => sum + w, 0) || 1
  /**
   * Fits when it can, scrolls when it cannot: the width is the larger of the card
   * and the sum of per-column minimums. Declared widths are spreadsheet character
   * counts (~8px a character at this size); the 88px floor keeps a narrow numeric
   * column from collapsing under its own header.
   */
  const minWidth = widths.reduce((sum, w) => sum + Math.max(88, w * 8), 0) + (anyLink ? 40 : 0)

  return (
    <div className="rv-table max-h-[70vh] overflow-auto custom-scrollbar">
      <table className="w-full table-fixed text-[13px]" style={{ minWidth: `${minWidth}px` }}>
        <colgroup>
          {run.columns.map((c, i) => (
            <col key={c.key} style={{ width: `${((widths[i] / totalUnits) * 100).toFixed(3)}%` }} />
          ))}
          {anyLink && <col style={{ width: 40 }} />}
        </colgroup>
        <thead>
          <tr className="bg-slate-50">
            {run.columns.map(c => {
              const isSorted = sort?.key === c.key
              const numeric = run.rows.some(r => typeof r[c.key] === 'number')
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-600 ${numeric ? 'text-end' : 'text-start'}`}
                >
                  {/* Sorting is a server round-trip: the row set can be capped, and
                      sorting only the returned page would put the wrong rows on it. */}
                  <button
                    type="button"
                    onClick={() => onSort(isSorted && sort!.dir === 'desc' ? { key: c.key, dir: 'asc' } : { key: c.key, dir: 'desc' })}
                    title={translatePortalText('Sort by this column')}
                    className={`group inline-flex max-w-full items-center gap-1 ${numeric ? 'flex-row-reverse' : ''} ${isSorted ? 'text-deep-900' : 'hover:text-deep-900'}`}
                  >
                    <span className="truncate">{translatePortalText(c.header)}</span>
                    {isSorted
                      ? (sort!.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)
                      : <ChevronsUpDown size={12} aria-hidden className="text-slate-300 group-hover:text-slate-500" />}
                  </button>
                </th>
              )
            })}
            {anyLink && <th scope="col" className="border-b border-slate-200 bg-slate-50"><span className="sr-only">{translatePortalText('Open report')}</span></th>}
          </tr>
        </thead>
        <tbody>
          {run.rows.map((row, i) => {
            const link = linkFor(row)
            const target = link && catalog.find(r => r.key === link.report)
            return (
              <tr
                key={i}
                {...(link
                  ? {
                      role: 'link',
                      tabIndex: 0,
                      title: translatePortalTemplate('Open {{report}}', { report: translatePortalText(target?.label ?? link.report) }),
                      onClick: () => onDrill(link),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrill(link) }
                      },
                    }
                  : {})}
                className={`border-b border-slate-100 last:border-0 ${
                  link
                    ? 'cursor-pointer outline-none hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ocean-400'
                    : 'hover:bg-slate-50/70'
                }`}
              >
                {run.columns.map(c => {
                  const v = row[c.key]
                  const numeric = typeof v === 'number'
                  return (
                    <td
                      key={c.key}
                      title={numeric ? undefined : formatCell(v)}
                      className={`px-4 py-3 ${numeric ? 'text-end tabular-nums font-medium text-deep-900' : 'text-start text-slate-700'}`}
                    >
                      <span className="block truncate">{formatCell(v)}</span>
                    </td>
                  )
                })}
                {anyLink && (
                  <td className="px-2 text-slate-300">
                    {link && <ChevronRight size={16} className="rtl:rotate-180" aria-hidden />}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        {/* The totals come from the server, over the whole matched set. Summing the
            rows this page holds would total one page and look like the total. A
            column the report chose not to total stays blank — a zero there reads as a fact. */}
        {!!run.totals && (
          <tfoot>
            <tr className="bg-slate-50">
              {run.columns.map(c => {
                const v = run.totals![c.key]
                return (
                  <td
                    key={c.key}
                    className={`border-t-2 border-slate-200 bg-slate-50 px-4 py-3 font-bold text-deep-900 ${typeof v === 'number' ? 'text-end tabular-nums' : 'text-start'}`}
                  >
                    {formatCell(v)}
                  </td>
                )
              })}
              {anyLink && <td className="border-t-2 border-slate-200 bg-slate-50" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function EmptyResult({
  filtered, dateRanged, onClear, onWiden,
}: {
  filtered: boolean
  dateRanged: boolean
  onClear: () => void
  onWiden: () => void
}) {
  return (
    <div className="grid place-items-center px-4 py-14 text-center">
      <Search size={24} className="mb-2 text-slate-400" aria-hidden />
      <p className="text-sm font-semibold text-slate-700">
        {filtered
          ? translatePortalText('Nothing matches these filters or that search.')
          : dateRanged
            ? translatePortalText('There is nothing to show for this period.')
            : translatePortalText('There is nothing to show yet.')}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {filtered && (
          <button type="button" onClick={onClear} className="btn-ghost !py-1.5 !text-xs">
            {translatePortalText('Clear filters and search')}
          </button>
        )}
        {!filtered && dateRanged && (
          <button type="button" onClick={onWiden} className="btn-ghost !py-1.5 !text-xs">
            {translatePortalText('Try the last 12 months')}
          </button>
        )}
      </div>
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div aria-busy className="animate-pulse space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="card h-[92px] bg-slate-50" />)}
      </div>
      <div className="card h-[260px] bg-slate-50" />
      <div className="card h-[320px] bg-slate-50" />
    </div>
  )
}

/** A filter control, drawn from the server's declaration of it. */
function FilterControl({
  def, value, onChange, tone,
}: {
  def: ReportFilterDef
  value: string
  onChange: (v: string) => void
  tone: Tone
}) {
  const t = TONE[tone]
  if (def.kind === 'boolean') {
    const on = value === 'true'
    // One toggle named for what it filters: pressed means the filter is on.
    return (
      <div className="flex items-end">
        <button
          type="button"
          aria-pressed={on}
          onClick={() => onChange(on ? '' : 'true')}
          className={`rounded-full px-3.5 py-2 text-[13px] font-semibold transition ${on ? `${t.solid} shadow-sm` : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`}
        >
          {translatePortalText(def.label)}
        </button>
      </div>
    )
  }

  if (def.kind === 'multiselect') {
    // A row of toggle chips rather than a `<select multiple>`, which is close to
    // unusable with a mouse; these lists are short enough for chips.
    const picked = value ? value.split(',').filter(Boolean) : []
    const toggle = (v: string) => onChange(picked.includes(v) ? picked.filter(p => p !== v).join(',') : [...picked, v].join(','))
    return (
      <div className="sm:col-span-2 lg:col-span-1">
        <p className="mb-1.5 text-xs font-semibold text-slate-600">{translatePortalText(def.label)}</p>
        <div className="flex flex-wrap gap-1.5">
          {def.options.map(o => {
            const on = picked.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? `${t.solid} shadow-sm` : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`}
              >
                {translatePortalText(o.label)}
              </button>
            )
          })}
        </div>
        {!!def.hint && <p className="mt-1.5 text-xs text-slate-500">{translatePortalText(def.hint)}</p>}
      </div>
    )
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{translatePortalText(def.label)}</span>
      {def.kind === 'select' ? (
        <select className="input !py-2" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">{translatePortalText('Any')}</option>
          {def.options.map(o => <option key={o.value} value={o.value}>{translatePortalText(o.label)}</option>)}
        </select>
      ) : (
        <input
          className="input !py-2"
          type={def.kind === 'number' ? 'number' : def.kind === 'date' ? 'date' : 'text'}
          value={value}
          placeholder={translatePortalText(def.placeholder ?? '')}
          onChange={e => onChange(e.target.value)}
        />
      )}
      {!!def.hint && <p className="mt-1.5 text-xs text-slate-500">{translatePortalText(def.hint)}</p>}
    </label>
  )
}

/**
 * Every way to take the data away, in one place.
 *
 * Three buttons for three formats sat in the middle of a row of unrelated controls.
 * One "Download" button says what it does; the menu says what each file is *for*.
 */
export function DownloadMenu({
  tone, disabled, disabledReason, downloading, onPick,
}: {
  tone: Tone
  disabled: boolean
  disabledReason?: string
  downloading: ExportFormat | null
  onPick: (format: ExportFormat) => Promise<void> | void
}) {
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)
  const button = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  React.useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || downloading !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? disabledReason : undefined}
        className={`${TONE[tone].button} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {downloading ? <Spinner size={15} /> : <Download size={15} />}
        {translatePortalText(downloading ? 'Preparing…' : 'Download')}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={translatePortalText('Download as')}
          onKeyDown={onMenuKey}
          className="absolute end-0 z-30 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lift"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {translatePortalText('Download this report as')}
          </p>
          {EXPORTS.map(x => (
            <button
              key={x.format}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); void onPick(x.format) }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50"
            >
              <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${TONE[tone].soft}`}><x.icon size={17} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-deep-900">{translatePortalText(x.label)}</span>
                <span className="block text-xs text-slate-500">{translatePortalText(x.hint)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
