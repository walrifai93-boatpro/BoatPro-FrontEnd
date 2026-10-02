import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BarChart3, RefreshCw, FileSpreadsheet, FileText, FileDown, SlidersHorizontal, X, ArrowUp, ArrowDown, Search, ChevronRight, BellRing, ChevronLeft, ChevronsLeft, ChevronsRight, Info, ShieldCheck } from 'lucide-react'
import {
  reportApi,
  ROW_LINK,
  type ExportFormat,
  type ReportCatalogEntry,
  type ReportActionDef,
  type ReportFilterDef,
  type ReportRowLink,
  type ReportRun,
  type Granularity,
  type ReportPortal,
} from '../api/platform'
import { toast, Spinner } from '../ui'
import { confirm } from '../async/confirm'
import { useAuth } from '../auth'
import { formatPortalDate, formatPortalNumber, isPortalArabic, translatePortalTemplate, translatePortalText } from '../i18n/runtime'


/**
 * The report workbench.
 *
 * One screen renders every report the platform has, because each report returns
 * its own columns alongside its rows. Adding a report on the backend makes it
 * appear here — in the right group, with the right filters, exportable — without a
 * client change.
 *
 * That is not just less code. It is what guarantees the numbers agree: the table,
 * the metric cards and the downloaded spreadsheet all come from one `run()` on the
 * server, so there is no second query to drift.
 */

/**
 * Sub-group headings inside each group.
 *
 * The `platform` label depends on who is reading it, and getting that wrong caused
 * real alarm: in a provider console it said **"All providers"**, which reads as
 * "this report contains every provider's data". It does not — every runner scopes
 * itself to the session, so a marina operator opening Revenue sees only their own
 * marina — but a heading that claims otherwise is worse than no heading, because
 * the reader has no way to check and will believe the label over the numbers.
 *
 * So the same vertical is titled by what it means to the person looking at it: the
 * admin console spans providers and says so; a provider console does not, and says
 * that instead.
 */
const VERTICAL_LABEL_ADMIN: Record<string, string> = {
  platform: 'All providers',
  // Distinct from "All providers": these are reports about running the
  // marketplace, which no provider console shows at all.
  admin: 'Platform admin',
  boat: 'Boats & trips',
  marina: 'Marina & berths',
  fuel: 'Fuel',
  maintenance: 'Maintenance',
}

const VERTICAL_LABEL_PROVIDER: Record<string, string> = {
  platform: 'Your business',
  admin: 'Platform admin',
  boat: 'Boats & trips',
  marina: 'Marina & berths',
  fuel: 'Fuel',
  maintenance: 'Maintenance',
}

const VERTICAL_ORDER = ['platform', 'admin', 'boat', 'marina', 'fuel', 'maintenance']

const GROUP_LABEL: Record<string, string> = {
  executive: 'Executive',
  finance: 'Finance',
  operations: 'Operations',
  compliance: 'Compliance',
  customers: 'Customers',
}

const FORMAT_META: { format: ExportFormat; label: string; icon: React.ReactNode }[] = [
  { format: 'csv', label: 'CSV', icon: <FileText size={12} /> },
  { format: 'excel', label: 'Excel', icon: <FileSpreadsheet size={12} /> },
  { format: 'pdf', label: 'PDF', icon: <FileDown size={12} /> },
]

/**
 * `2026-08-19` — what a date input wants, in the operator's own day.
 *
 * Was `toISOString().slice(0, 10)`, which converts to UTC first: at +3 that is
 * the previous day for the first three hours, so a report run early in the
 * morning covered a window shifted a day back from the one on screen.
 */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const GRAIN_LABEL: Record<Granularity, string> = {
  auto: 'Auto',
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
}

/**
 * Rows per page.
 *
 * Offered rather than fixed because the right answer depends on the task: 50 to
 * read, 500 to scan for one row before giving up and searching. The cap matches
 * the server's, so an option here can never be refused.
 */
const PAGE_SIZES = [50, 100, 250, 500, 1000]

/**
 * Renders a metric the way its `kind` asks for.
 *
 * The server sends the kind rather than a pre-formatted string so the client can
 * localise and so a currency stays a number for the chart.
 */
function formatMetric(value: number | string, kind?: string): string {
  if (typeof value === 'string') {
    // A report's text kind can still carry an app-owned unit phrase (for
    // example the maintenance report's "12 days" metric). Keep arbitrary
    // provider text intact, but localise the known numeric day form.
    if (kind === 'text' && /^\s*[\d٠-٩۰-۹,٬]+\s+days?$/i.test(value)) {
      return translatePortalText(value)
    }
    return value
  }
  if (kind === 'percent') return `${formatPortalNumber(value, { maximumFractionDigits: 2 })}${isPortalArabic() ? '٪' : '%'}`
  if (kind === 'duration') return `${formatPortalNumber(value, { maximumFractionDigits: 2 })} ${translatePortalText('h')}`
  if (kind === 'currency') return formatPortalNumber(value, { maximumFractionDigits: 2 })
  return formatPortalNumber(value)
}

/**
 * The margin report subtitle is a server-owned sentence with a changing date
 * window. Format the dates for the active portal language, then pass the whole
 * range into its named translation template so Arabic keeps a natural word
 * order and the inserted dates stay isolated from RTL text.
 */
function formatReportSubtitle(input: string): string {
  const match = input.match(/^(.+?)\s*[·•]\s*cost of sales estimated at this window[’']s average purchase cost$/i)
  if (!match) return translatePortalText(input)

  const range = match[1].match(/^(\d{4}-\d{2}-\d{2})\s*(?:→|–|—|-)\s*(\d{4}-\d{2}-\d{2})$/)
  const dateRange = range
    ? `${formatPortalDate(range[1], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })} → ${formatPortalDate(range[2], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
    : match[1]

  return translatePortalTemplate(
    '{{dateRange}} · cost of sales estimated at this window’s average purchase cost',
    { dateRange },
  )
}

/** Numbers right-aligned, text left — a table of figures is unreadable otherwise. */
const isNumeric = (v: unknown) => typeof v === 'number'

/**
 * Report rows are assembled from real records, so names and notes must stay in
 * the language their author used. Known labels/statuses can still be translated,
 * and sortable ISO date buckets need locale-aware formatting in Arabic mode.
 */
function formatReportCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (isNumeric(value)) return formatPortalNumber(value)
  if (typeof value !== 'string') return translatePortalText(String(value))

  const month = value.match(/^(\d{4})-(\d{2})$/)
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 15))
    return formatPortalDate(date, { year: 'numeric', month: 'short' })
  }

  const dateTime = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/)
  if (dateTime) {
    const date = new Date(Date.UTC(
      Number(dateTime[1]), Number(dateTime[2]) - 1, Number(dateTime[3]),
      Number(dateTime[4] ?? 12), Number(dateTime[5] ?? 0)
    ))
    return formatPortalDate(date, dateTime[4]
      ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  }

  const week = value.match(/^(\d{4})-W(\d{2})$/i)
  if (week && isPortalArabic()) {
    return `${formatPortalNumber(Number(week[1]))} · الأسبوع ${formatPortalNumber(Number(week[2]))}`
  }

  return translatePortalText(value)
}


/**
 * One filter control, rendered from the server's declaration.
 *
 * Multiselect is a row of toggle chips rather than a `<select multiple>`: the
 * native control is close to unusable with a mouse, and these lists are short
 * enough that chips fit. The value crosses the wire comma-separated, which is what
 * `filterValue.list` on the server expects.
 */
function FilterControl({
  def,
  value,
  onChange,
}: {
  def: ReportFilterDef
  value: string
  onChange: (v: string) => void
}) {
  if (def.kind === 'boolean') {
    const on = value === 'true'
    return (
      <button
        type="button"
        onClick={() => onChange(on ? '' : 'true')}
        className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
          on ? 'bg-deep-900 text-white ring-deep-900' : 'bg-white text-slate-500 ring-slate-200'
        }`}
      >
        {translatePortalText(def.label)}
      </button>
    )
  }

  if (def.kind === 'multiselect') {
    const picked = value ? value.split(',').filter(Boolean) : []
    const toggle = (v: string) =>
      onChange(picked.includes(v) ? picked.filter(p => p !== v).join(',') : [...picked, v].join(','))
    return (
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(def.label)}</p>
        <div className="flex flex-wrap gap-1">
          {def.options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 transition ${
                picked.includes(o.value)
                  ? 'bg-ocean-500 text-white ring-ocean-500'
                  : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300'
              }`}
            >
              {translatePortalText(o.label)}
            </button>
          ))}
        </div>
        {!!def.hint && <p className="mt-1 text-[10px] text-slate-400">{translatePortalText(def.hint)}</p>}
      </div>
    )
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {translatePortalText(def.label)}
      </span>
      {def.kind === 'select' ? (
        <select className="input !py-1.5 !text-[12px]" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">{translatePortalText("Any")}</option>
          {def.options.map(o => (
            <option key={o.value} value={o.value}>{translatePortalText(o.label)}</option>
          ))}
        </select>
      ) : (
        <input
          className="input !py-1.5 !text-[12px]"
          type={def.kind === 'number' ? 'number' : def.kind === 'date' ? 'date' : 'text'}
          value={value}
          placeholder={translatePortalText(def.placeholder ?? '')}
          onChange={e => onChange(e.target.value)}
        />
      )}
      {!!def.hint && <p className="mt-1 text-[10px] text-slate-400">{translatePortalText(def.hint)}</p>}
    </label>
  )
}

export function ReportWorkbench({
  accentClass = 'btn-primary',
  /**
   * Base path this workbench lives at, e.g. `/admin/reports`.
   *
   * Supplying it puts the open report in the URL — `/admin/reports/fuel-sales` —
   * which is what makes a report linkable: pasteable into a message, bookmarkable,
   * survivable across a refresh, and reachable by the browser's back button. Left
   * out, the component behaves exactly as before and owns its selection in state.
   */
  basePath,
  /**
   * Which console this workbench is embedded in.
   *
   * Narrows the index to reports relevant to that console, which a role cannot do:
   * an admin is permitted to run everything, so without this the marina portal
   * offered them fleet utilisation and fuel sales beside berth revenue. Platform
   * reports still appear everywhere. Omitted, the whole role-permitted set is
   * shown — the previous behaviour.
   */
  portal,
}: {
  accentClass?: string
  basePath?: string
  portal?: ReportPortal
}) {
  const { user } = useAuth()
  /**
   * Whether this reader sees the platform or only themselves.
   *
   * Taken from the role rather than the portal: an admin standing in the marina
   * console is still looking at the whole platform's rows, so labelling their
   * headings "Your business" would be the same mistake in the other direction.
   */
  const isAdmin = user?.role === 'admin'
  const verticalLabels = isAdmin ? VERTICAL_LABEL_ADMIN : VERTICAL_LABEL_PROVIDER

  const navigate = useNavigate()
  const { reportKey: routeKey } = useParams<{ reportKey?: string }>()
  const [search0] = useSearchParams()
  const [catalog, setCatalog] = useState<ReportCatalogEntry[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [run, setRun] = useState<ReportRun | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [loadingRun, setLoadingRun] = useState(false)
  const [downloading, setDownloading] = useState<ExportFormat | null>(null)

  // Default to the last 30 days, matching the server's own default so the first
  // render and the first explicit query return the same thing.
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo] = useState(iso(new Date()))

  const [filterDefs, setFilterDefs] = useState<ReportFilterDef[]>([])
  const [actionDefs, setActionDefs] = useState<ReportActionDef[]>([])
  const [grains, setGrains] = useState<Granularity[]>([])
  /**
   * The grain, seeded from the URL.
   *
   * A shortcut that opens "Revenue — monthly" has to be able to say which grain it
   * meant, and the report key alone cannot. Read once at mount rather than watched,
   * because after that the picker owns it — re-reading would fight the user every
   * time they changed it while the query string still said something else.
   */
  const [grain, setGrain] = useState<Granularity>(() => {
    const asked = search0.get('granularity')
    return asked === 'day' || asked === 'week' || asked === 'month' ? asked : 'auto'
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)

  /**
   * Filters a drill-through asked to arrive with, held until the report actually
   * changes.
   *
   * A ref rather than state because the effect that switches report resets the
   * filters, and setting both would race: whichever landed second would win.
   * Stashing them here lets that one effect stay the only writer.
   */
  const arrivingFilters = React.useRef<Record<string, string> | null>(null)

  /** False until the report-change effect has run once — see the grain reset below. */
  const grainSeeded = React.useRef(false)

  /**
   * Opens a report, and records it in the URL when this workbench is routed.
   *
   * `replace: false` so each report is its own history entry — the back button
   * returning to the previous report is what a reader expects once the report has
   * an address of its own.
   */
  const selectReport = React.useCallback(
    (key: string) => {
      setActiveKey(key)
      if (basePath) navigate(`${basePath}/${key}`)
    },
    [basePath, navigate]
  )

  /**
   * Back and forward move between reports.
   *
   * Without this the URL would change while the screen did not, which is worse
   * than having no URL at all — the address bar would be lying about what is on
   * screen.
   */
  useEffect(() => {
    if (!basePath || !routeKey) return
    setActiveKey(prev => (prev === routeKey ? prev : routeKey))
  }, [routeKey, basePath])

  /**
   * Debounced so typing does not fire a request per keystroke — the server
   * re-runs the whole report, which is not a per-character operation.
   */
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(id)
  }, [search])

  /**
   * Filters, search and sort are all reset when the report changes.
   *
   * They are per-report by nature — a vessel filter means nothing on a subscription
   * report — and carrying them across would silently narrow the new report by a
   * control the user can no longer see.
   */
  useEffect(() => {
    if (!activeKey) return
    // A drill-through is the one case where arriving with filters set is right:
    // they are what makes the destination show the row that was clicked rather
    // than the whole report. Consumed once, so a later switch still starts clean.
    setFilterValues(arrivingFilters.current ?? {})
    arrivingFilters.current = null
    setSort(null)
    setSearch('')
    setDebouncedSearch('')
    setFilterDefs([])
    setActionDefs([])
    setGrains([])
    /**
     * Reset to auto on every report change *except* the first.
     *
     * The URL's grain applies to the report the URL names, so resetting it on the
     * initial mount would immediately undo the shortcut that navigated here.
     */
    if (grainSeeded.current) setGrain('auto')
    grainSeeded.current = true
    // Page 1 on every report change. Staying on page 6 of a report that has two
    // shows an empty table and reads as "this report is broken".
    setPage(1)
    reportApi
      .filters(activeKey)
      .then(res => {
        setFilterDefs(res.data.filters)
        setActionDefs(res.data.actions ?? [])
        setGrains(res.data.granularities ?? [])
        if (res.data.defaultPageSize) setPageSize(res.data.defaultPageSize)
      })
      .catch(() => {
        setFilterDefs([])
        setActionDefs([])
        setGrains([])
      })
  }, [activeKey])

  /**
   * Anything that changes what the result *is* returns to page 1.
   *
   * Without this, narrowing a filter while on page 4 leaves the pager pointing past
   * the end of a now-shorter result — an empty table with no visible cause. The
   * grain is excluded: it only redraws the chart, so paging back would be a
   * pointless jump.
   */
  useEffect(() => {
    setPage(1)
  }, [from, to, filterValues, debouncedSearch, pageSize])

  useEffect(() => {
    reportApi
      .catalog(portal)
      .then(res => {
        setCatalog(res.data.reports)
        /**
         * A key in the URL wins, provided the catalog actually contains it —
         * a stale or hand-typed link must not leave the screen blank, so an
         * unknown key falls back to the first report this caller may see.
         */
        const fromUrl = routeKey && res.data.reports.some(r => r.key === routeKey) ? routeKey : null
        setActiveKey(fromUrl ?? res.data.reports[0]?.key ?? null)
      })
      .catch(e => toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the report catalog'), 'warn'))
      .finally(() => setLoadingCatalog(false))
    // Re-fetched if the console changes, since the portal decides what is in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal])

  const active = useMemo(() => catalog.find(r => r.key === activeKey) ?? null, [catalog, activeKey])

  /**
   * One place builds the query, and both the run and the export use it.
   *
   * That is what keeps a download matching the screen: if the two assembled their
   * own parameters, any filter added to one and forgotten in the other would
   * produce a spreadsheet quietly different from the table above it.
   */
  const queryParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (active?.dateRanged) {
      params.from = from
      params.to = to
    }
    for (const [key, value] of Object.entries(filterValues)) {
      if (value !== '' && value !== undefined) params[key] = value
    }
    if (debouncedSearch) params.search = debouncedSearch
    if (sort) {
      params.sort = sort.key
      params.dir = sort.dir
    }
    if (grain !== 'auto') params.granularity = grain
    params.page = String(page)
    params.pageSize = String(pageSize)
    return params
  }, [active?.dateRanged, from, to, filterValues, debouncedSearch, sort, grain, page, pageSize])

  /**
   * The export takes everything except the page.
   *
   * A download should be the whole result, not the hundred rows on screen — the
   * server ignores paging on the export route, and sending it anyway would only
   * make the request look like it meant something.
   */
  const exportParams = useMemo(() => {
    const { page: _p, pageSize: _s, ...rest } = queryParams
    return rest
  }, [queryParams])

  const load = React.useCallback(async () => {
    if (!activeKey) return
    setLoadingRun(true)
    try {
      const res = await reportApi.run(activeKey, queryParams)
      setRun(res.data)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not run the report'), 'warn')
      setRun(null)
    } finally {
      setLoadingRun(false)
    }
  }, [activeKey, queryParams])

  useEffect(() => { void load() }, [load])

  const download = async (format: ExportFormat) => {
    if (!activeKey) return
    setDownloading(format)
    try {
      await reportApi.download(activeKey, { format, ...exportParams })
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Export failed'), 'warn')
    } finally {
      setDownloading(null)
    }
  }

  /**
   * Follows a row's drill-through.
   *
   * Guarded on the catalog, which is already role-filtered by the server: a report
   * this account cannot run is not offered as a destination, so a link never leads
   * to a 404. The same guard is what decides whether a row looks clickable at all.
   */
  const linkFor = React.useCallback(
    (row: Record<string, unknown>): ReportRowLink | null => {
      const link = row[ROW_LINK] as ReportRowLink | undefined
      if (!link?.report || !catalog.some(r => r.key === link.report)) return null
      return link
    },
    [catalog]
  )

  const drillTo = React.useCallback(
    (link: ReportRowLink) => {
      const filters = link.filters ?? {}
      if (link.report === activeKey) {
        // Already here — the effect below will not fire, so apply them directly.
        setFilterValues(filters)
        return
      }
      arrivingFilters.current = filters
      selectReport(link.report)
      setShowFilters(Object.keys(filters).length > 0)
    },
    [activeKey]
  )

  /**
   * Fires a declared action against the rows currently on screen.
   *
   * Sends the same `queryParams` the run and the export use, so the set acted on
   * is the set shown. The report is re-run afterwards because an action that
   * changes what it acted on — a status, a reminder timestamp — would otherwise
   * leave a stale table behind it.
   */
  const runAction = async (action: ReportActionDef) => {
    if (!activeKey) return
    if (action.confirm) {
      const accepted = await confirm({
        title: 'Confirm report action',
        body: action.confirm,
        confirmLabel: action.label,
      })
      if (!accepted) return
    }

    setRunningAction(action.key)
    try {
      const res = await reportApi.action(activeKey, action.key, queryParams)
      toast(translatePortalText(res.data.message), res.data.count ? 'success' : 'warn')
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : `${action.label} failed`), 'warn')
    } finally {
      setRunningAction(null)
    }
  }

  /** Non-empty filters, for the badge and the "clear" affordance. */
  const activeFilterCount = useMemo(
    () => Object.values(filterValues).filter(v => v !== '' && v !== undefined).length,
    [filterValues]
  )

  /**
   * Group, then vertical inside it.
   *
   * The server already returns the catalog in this order, so the maps preserve it
   * and nothing here re-sorts — which is what keeps a report family in the sequence
   * its author wrote rather than alphabetised apart.
   *
   * A vertical heading is drawn only when there is more than one to distinguish
   * *within that group*. In the fuel console the finance group is "All providers"
   * plus "Fuel", so both headings earn their place; in the compliance group there is
   * often only one, and a lone heading over every row is noise rather than
   * structure.
   */
  const grouped = useMemo(() => {
    const byGroup = new Map<string, Map<string, ReportCatalogEntry[]>>()
    for (const r of catalog) {
      const verticals = byGroup.get(r.group) ?? new Map<string, ReportCatalogEntry[]>()
      const list = verticals.get(r.vertical) ?? []
      list.push(r)
      verticals.set(r.vertical, list)
      byGroup.set(r.group, verticals)
    }
    return [...byGroup.entries()].map(([group, verticals]) => ({
      group,
      showVerticalLabels: verticals.size > 1,
      verticals: [...verticals.entries()]
        .sort(([a], [b]) => VERTICAL_ORDER.indexOf(a) - VERTICAL_ORDER.indexOf(b))
        .map(([vertical, reports]) => ({ vertical, reports })),
    }))
  }, [catalog])

  if (loadingCatalog) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      {/* ── Catalog ─────────────────────────────────────── */}
      <div className="card max-h-[720px] overflow-y-auto p-2">
        {grouped.map(({ group, showVerticalLabels, verticals }) => (
          <div key={group} className="mb-3">
            {/* The group heading, sticky so it stays visible while a long group
                scrolls — with five groups and forty-odd reports, scrolling into the
                middle of the list otherwise loses which group you are in. */}
            <p className="sticky top-0 z-10 bg-white px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-deep-900">
              {translatePortalText(GROUP_LABEL[group] ?? group)}
            </p>
            {verticals.map(({ vertical, reports }) => (
              <div key={vertical}>
                {showVerticalLabels && (
                  <p className="mt-1.5 flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <span className="h-px flex-1 bg-slate-100" />
                    {translatePortalText(verticalLabels[vertical] ?? vertical)}
                    <span className="h-px flex-[3] bg-slate-100" />
                  </p>
                )}
                {reports.map(r => (
                  <button
                    key={r.key}
                    onClick={() => selectReport(r.key)}
                    title={translatePortalText(r.description)}
                    className={`block w-full rounded-lg px-2.5 py-2 text-start text-[12px] transition ${
                      r.key === activeKey
                        ? 'bg-deep-900 font-bold text-white'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {translatePortalText(r.label)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── The report ──────────────────────────────────── */}
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-end gap-2">
          {/*
            The basis is what makes this row wrap instead of crush. `flex-1` with
            `min-w-0` and no basis let the title shrink toward zero while the date
            inputs and buttons — which do not shrink — held their width, so a long
            report name came out as one word per line in a column an inch wide.
            With a basis, the title keeps its width and the controls drop to the
            next line once there is no longer room for both.
          */}
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="font-display text-lg font-extrabold text-deep-900">
              {translatePortalText(run?.title ?? active?.label ?? 'Report')}
            </h2>
            <p className="text-xs text-slate-400">{formatReportSubtitle(run?.subtitle ?? active?.description ?? '')}</p>
            {/*
              Stated rather than implied.

              A provider reading a report called "Revenue" has no way to tell
              whether it covers the platform or just them, and the answer matters
              enough that they should not have to infer it from the numbers. The
              server scopes every runner to the session; this says so.
            */}
            {!isAdmin && (
              <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                <ShieldCheck size={10} /> {translatePortalText("Your own data only\r\n              ")}</p>
            )}
          </div>

          {/* Hidden for reports with no time axis — a date picker that changes
              nothing is worse than none. */}
          {active?.dateRanged && (
            <>
              <label className="text-[11px] font-bold text-slate-400">
                {translatePortalText("From\r\n                ")}<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                  className="input !mt-0.5 !py-1.5 !text-[12px]" />
              </label>
              <label className="text-[11px] font-bold text-slate-400">
                {translatePortalText("To\r\n                ")}<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
                  className="input !mt-0.5 !py-1.5 !text-[12px]" />
              </label>
            </>
          )}

          {/* Only for reports with a time axis — the server sends an empty list
              for the rest, so a stock report draws no grain control. */}
          {grains.length > 0 && (
            <label className="text-[11px] font-bold text-slate-400">
              {translatePortalText("Grain\r\n              ")}<select
                value={grain}
                onChange={e => setGrain(e.target.value as Granularity)}
                className="input !mt-0.5 !py-1.5 !text-[12px]"
                title={translatePortalText("How finely the chart is bucketed")}
              >
                {grains.map(g => (
                  <option key={g} value={g}>{translatePortalText(GRAIN_LABEL[g] ?? g)}</option>
                ))}
              </select>
            </label>
          )}

          {filterDefs.length > 0 && (
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`!py-1.5 !px-3 !text-[11px] ${activeFilterCount ? 'btn-admin' : 'btn-ghost'}`}
            >
              <SlidersHorizontal size={12} /> {translatePortalText("Filters\r\n              ")}{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </button>
          )}

          <button onClick={() => void load()} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
            <RefreshCw size={12} /> {translatePortalText("Run\r\n          ")}</button>

          {/* Whatever this report says it can do. Disabled on an empty table:
              an action whose target set is nothing has nothing to act on. */}
          {actionDefs.map(action => (
            <button
              key={action.key}
              onClick={() => void runAction(action)}
              disabled={runningAction !== null || !run?.rows.length}
              title={translatePortalText(action.description)}
              className={`${accentClass} !py-1.5 !px-3 !text-[11px] disabled:opacity-40`}
            >
              {runningAction === action.key ? <Spinner size={12} /> : <BellRing size={12} />}
              {translatePortalText(action.label)}
            </button>
          ))}

          {FORMAT_META.map(f => (
            <button
              key={f.format}
              onClick={() => void download(f.format)}
              // Gated on the matched set, not the page: the export is never paged,
              // so a reader sitting on an empty last page still has a full result to
              // download and the button must not refuse it.
              disabled={!!downloading || !run?.matchedRows}
              title={run?.matchedRows ? translatePortalText(`Download as ${f.label}`) : translatePortalText("Nothing to export")}
              className={`${accentClass} !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40`}
            >
              {downloading === f.format ? <Spinner /> : f.icon} {translatePortalText(f.label)}
            </button>
          ))}
        </div>

        {/* Search sits outside the filter panel because it is used constantly and
            behaves differently: it finds rows within the result rather than
            redefining what the result is. The metric cards deliberately ignore it. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={translatePortalText("Find in results…")}
              className="input !py-1.5 !ps-8 !text-[12px]"
            />
          </div>
          {/* Only when the *search* narrowed the set — the pager below reports the
              page window, and repeating it here said the same thing twice while
              hiding the one fact it did not cover. */}
          {!!run && run.matchedRows !== run.totalRows && (
            <span className="text-[11px] text-slate-400">
              {formatPortalNumber(run.matchedRows)} {translatePortalText("of ")}{formatPortalNumber(run.totalRows)} {translatePortalText("rows match\r\n            ")}</span>
          )}
          {activeFilterCount > 0 && (
            <button onClick={() => setFilterValues({})} className="btn-ghost !py-1 !px-2 !text-[10px]">
              <X size={10} /> {translatePortalText("Clear filters\r\n            ")}</button>
          )}
        </div>

        {showFilters && filterDefs.length > 0 && (
          <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {filterDefs.map(def => (
              <FilterControl
                key={def.key}
                def={def}
                value={filterValues[def.key] ?? ''}
                onChange={v => setFilterValues(prev => ({ ...prev, [def.key]: v }))}
              />
            ))}
          </div>
        )}

        {/* Metric cards, straight from the server — most cannot be summed from the
            rows (a rate, an average, a count of excluded things). */}
        {!!run?.metrics.length && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {run.metrics.map((m, i) => (
              <motion.div key={m.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }} className="card p-3"
                // The hint is the definition of the figure — which rows were
                // counted, what the denominator was. Worth surfacing on hover
                // rather than leaving somebody to guess at an average.
                title={translatePortalText(m.hint ?? '')}>
                <p className="font-display text-xl font-extrabold text-deep-900">
                  {formatMetric(m.value, m.kind)}
                </p>
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {translatePortalText(m.label)}
                  {!!m.hint && <Info size={9} className="shrink-0 text-slate-300" />}
                </p>
                {m.delta !== undefined && (
                  <p className={`text-[10px] font-bold ${m.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {m.delta >= 0 ? '▲' : '▼'} {formatPortalNumber(Math.abs(m.delta), { maximumFractionDigits: 1 })}{translatePortalText("% vs previous\r\n                  ")}</p>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* A chart per series, drawn from the same response as the table. */}
        {!!run?.series.length && run.series.some(s => s.points.length > 1) && (
          <div className="card mb-4 space-y-4 p-4">
            {run.series.filter(s => s.points.length > 1).map((s, si) => {
              const max = Math.max(...s.points.map(p => p.y), 1)

              /*
                A trend is drawn as a line, a breakdown as bars.

                The server says which, because it is the only side that knows
                whether the x axis is ordered: bars across forty days of revenue
                read as forty unrelated categories, and a line through five
                service lines implies a progression between things that have no
                order at all. Drawing both as bars was legible only by accident.
              */
              if (s.kind === 'line') {
                const W = 1000
                const H = 120
                // A single point cannot make a line, and dividing by `length - 1`
                // would be a divide-by-zero — guarded by the filter above, but the
                // max keeps it true if that filter ever changes.
                const step = W / Math.max(1, s.points.length - 1)
                const y = (v: number) => H - (v / max) * (H - 8) - 4
                const line = s.points.map((p, i) => `${i * step},${y(p.y)}`).join(' ')
                return (
                  <div key={si}>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      {translatePortalText(s.label)}
                    </p>
                    <svg
                      viewBox={`0 0 ${W} ${H}`}
                      preserveAspectRatio="none"
                      className="h-[120px] w-full"
                      role="img"
                      aria-label={translatePortalText(s.label)}
                    >
                      <defs>
                        <linearGradient id={`rw-fill-${si}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <g className="text-ocean-500">
                        {/* Closed back down to the baseline so the area fills. */}
                        <polygon
                          points={`0,${H} ${line} ${(s.points.length - 1) * step},${H}`}
                          fill={`url(#rw-fill-${si})`}
                        />
                        <polyline
                          points={line}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          // Scaled by `preserveAspectRatio="none"`, which would
                          // otherwise stretch the stroke horizontally too.
                          vectorEffect="non-scaling-stroke"
                          strokeLinejoin="round"
                        />
                      </g>
                    </svg>
                    <div className="flex justify-between text-[9px] text-slate-400">
                      {/* First, middle and last only: one label per bucket is
                          unreadable past a fortnight. */}
                      <span>{translatePortalText(s.points[0]?.x ?? '')}</span>
                      <span>{translatePortalText(s.points[Math.floor(s.points.length / 2)]?.x ?? '')}</span>
                      <span>{translatePortalText(s.points[s.points.length - 1]?.x ?? '')}</span>
                    </div>
                  </div>
                )
              }

              return (
                // Keyed by position, not by label: a series axis is routinely not
                // unique — three vessels can share a name, and two marinas do — and
                // duplicate keys make React reuse the wrong bar between renders.
                <div key={si}>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(s.label)}</p>
                  <div className="flex items-stretch gap-1.5" style={{ height: 120 }}>
                    {s.points.slice(0, 40).map((p, pi) => (
                      <div key={pi} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={translatePortalText(`${p.x}: ${formatPortalNumber(p.y)}`)}>
                        {/* The bar is sized as a percentage, so it needs a parent whose
                            height is definite rather than derived from its content. With
                            `items-end` on the row this column was auto-height, the
                            percentage resolved to auto, and every bar drew as nothing
                            while the label beneath it still appeared. */}
                        <div className="flex min-h-0 w-full flex-1 items-end">
                          <div className="w-full rounded-t bg-ocean-500/80"
                            style={{ height: `${Math.max(2, (p.y / max) * 100)}%` }} />
                        </div>
                        <span className="w-full truncate text-center text-[9px] text-slate-400">{translatePortalText(p.x)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── The table ─────────────────────────────────── */}
        <div className="card overflow-hidden">
          {loadingRun ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : !run || !run.rows.length ? (
            <div className="py-16 text-center text-sm text-slate-400">
              <BarChart3 size={22} className="mx-auto mb-2 text-slate-300" />
              {translatePortalText(activeFilterCount > 0 || debouncedSearch
                ? 'Nothing matches these filters.'
                : 'Nothing in this period.')}
              {(activeFilterCount > 0 || debouncedSearch) && (
                <div className="mt-3">
                  <button
                    onClick={() => {
                      setFilterValues({})
                      setSearch('')
                    }}
                    className="btn-ghost !py-1.5 !px-3 !text-[11px]"
                  >
                    {translatePortalText("Clear filters and search\r\n                  ")}</button>
                </div>
              )}
            </div>
          ) : (
            <>
              {/*
                Fits when it can, scrolls when it cannot.

                Two failure modes, and the table has to dodge both. Forcing
                `columns x 144px` and scrolling whatever overflowed pushed half a
                ten-column report off-canvas with nothing on screen saying the
                hidden columns existed. Forcing everything into 100% instead
                crushed those same ten columns to a few characters each and left
                no way to reach the rest — the original comment here warned about
                exactly that, and going fixed-width reintroduced it.

                So the width is `max(container, sum of per-column minimums)`:
                `width:100%` wins whenever the minimums fit, and the table stays
                inside the card with no scrollbar. Once the minimums exceed the
                card, `minWidth` wins, the table grows past it and the wrapper
                scrolls — each column keeping a readable width instead of being
                squeezed to nothing.

                The proportions and the minimums both come from each column's
                declared `width`, the same number that sizes the exported
                spreadsheet, so a business name gets several times the room of a
                guest count either way. Anything that still does not fit truncates
                with an ellipsis and carries the full value in a `title`.
              */}
              <div className="overflow-x-auto custom-scrollbar">
                {(() => {
                  const widths = run.columns.map(c => c.width ?? 14)
                  const totalUnits = widths.reduce((sum, w) => sum + w, 0) || 1
                  /**
                   * Declared widths are spreadsheet character counts. ~7px a
                   * character is about right for this 12px type, and the 72px
                   * floor keeps a narrow numeric column ("Guests") from
                   * collapsing under its own header.
                   */
                  const minWidth = widths.reduce((sum, w) => sum + Math.max(72, w * 7), 0)
                  return (
                    <table className="w-full table-fixed text-[12px]" style={{ minWidth: `${minWidth}px` }}>
                      <colgroup>
                        {run.columns.map((c, i) => (
                          <col key={c.key} style={{ width: `${((widths[i] / totalUnits) * 100).toFixed(3)}%` }} />
                        ))}
                      </colgroup>
                  <thead>
                    <tr className="border-b border-slate-100 bg-sand/60">
                      {run.columns.map(c => {
                        const isSorted = sort?.key === c.key
                        return (
                          <th key={c.key} className="px-3 py-2 text-start font-bold text-slate-500 whitespace-nowrap">
                            {/*
                              Sorting is a server round-trip, not a client-side
                              reorder: the row set can be capped, and sorting only
                              the returned page would put the wrong rows on it.
                            */}
                            <button
                              type="button"
                              onClick={() =>
                                setSort(
                                  isSorted && sort!.dir === 'desc'
                                    ? { key: c.key, dir: 'asc' }
                                    : { key: c.key, dir: 'desc' }
                                )
                              }
                              className={`inline-flex items-center gap-1 hover:text-deep-900 ${
                                isSorted ? 'text-deep-900' : ''
                              }`}
                            >
                              {translatePortalText(c.header)}
                              {isSorted &&
                                (sort!.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                            </button>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {run.rows.map((row, i) => {
                      const link = linkFor(row)
                      const target = link && catalog.find(r => r.key === link.report)
                      return (
                        <tr
                          key={i}
                          // A row that goes somewhere behaves like a link: clickable,
                          // reachable by keyboard, and it says where it leads on hover
                          // rather than leaving the reader to discover it.
                          {...(link
                            ? {
                                role: 'link',
                                tabIndex: 0,
                              title: translatePortalText(`Open the ${target?.label ?? link.report} report`),
                                onClick: () => drillTo(link),
                                onKeyDown: (e: React.KeyboardEvent) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    drillTo(link)
                                  }
                                },
                              }
                            : {})}
                          className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${
                            link
                              ? 'cursor-pointer outline-none hover:bg-ocean-50/70 focus-visible:bg-ocean-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ocean-400'
                              : ''
                          }`}
                        >
                          {run.columns.map((c, ci) => {
                            const v = row[c.key]
                            return (
                              <td key={c.key}
                                // The full value stays reachable on hover, so
                                // truncating never loses anything.
                                title={isNumeric(v) ? undefined : formatReportCell(v)}
                                className={`px-3 py-2 ${isNumeric(v) ? 'text-end tabular-nums text-deep-900' : 'text-slate-600'}`}>
                                <span className="flex items-center gap-1 overflow-hidden">
                                  <span className="truncate">
                                    {formatReportCell(v)}
                                  </span>
                                  {/* One chevron per row, on the last cell, so the
                                      affordance is visible without a column of its own. */}
                                  {link && ci === run.columns.length - 1 && (
                                    <ChevronRight size={12} className="shrink-0 text-slate-300" />
                                  )}
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>

                  {/*
                    The totals row, straight from the server.

                    Sticky at the bottom of the scroll container so it stays visible
                    while the rows scroll under it — a footer total you have to
                    scroll to find is a footer total nobody reads. Cells are keyed
                    by column, and a column the report chose not to total is simply
                    blank rather than a zero, because a zero there reads as a fact.
                  */}
                  {!!run.totals && (
                    <tfoot className="sticky bottom-0">
                      <tr className="border-t-2 border-slate-200 bg-sand">
                        {run.columns.map(c => {
                          const v = run.totals![c.key]
                          return (
                            <td
                              key={c.key}
                              className={`px-3 py-2 font-bold text-deep-900 ${
                                typeof v === 'number' ? 'text-end tabular-nums' : ''
                              }`}
                            >
                              {formatReportCell(v)}
                            </td>
                          )
                        })}
                      </tr>
                    </tfoot>
                  )}
                    </table>
                  )
                })()}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                <span className="text-[11px] text-slate-400">
                  {/* "1–100 of 3,412" rather than a bare count: on a paged table a
                      count alone reads as the whole result. */}
                  {formatPortalNumber(run.page.from)}–{formatPortalNumber(run.page.to)} {translatePortalText("of")}{' '}
                  {formatPortalNumber(run.matchedRows)} {translatePortalText("row")}{run.matchedRows === 1 ? '' : 's'}
                </span>

                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {translatePortalText("Per page\r\n                    ")}<select
                      value={pageSize}
                      onChange={e => setPageSize(Number(e.target.value))}
                      className="input !ms-1.5 !inline-block !w-auto !py-1 !text-[11px]"
                    >
                      {PAGE_SIZES.map(n => (
                        <option key={n} value={n}>{formatPortalNumber(n)}</option>
                      ))}
                    </select>
                  </label>

                  {/* The pager is hidden on a single page rather than disabled: a
                      row of dead arrows implies there is somewhere to go. */}
                  {run.page.pages > 1 && (
                    <>
                      <button
                        onClick={() => setPage(1)}
                        disabled={run.page.page <= 1}
                        title={translatePortalText("First page")}
                        className="btn-ghost !px-1.5 !py-1 disabled:opacity-30"
                      >
                        <ChevronsLeft size={13} />
                      </button>
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={run.page.page <= 1}
                        title={translatePortalText("Previous page")}
                        className="btn-ghost !px-1.5 !py-1 disabled:opacity-30"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <span className="px-1 text-[11px] font-bold text-deep-900">
                        {run.page.page} / {run.page.pages}
                      </span>
                      <button
                        onClick={() => setPage(p => Math.min(run.page.pages, p + 1))}
                        disabled={run.page.page >= run.page.pages}
                        title={translatePortalText("Next page")}
                        className="btn-ghost !px-1.5 !py-1 disabled:opacity-30"
                      >
                        <ChevronRight size={13} />
                      </button>
                      <button
                        onClick={() => setPage(run.page.pages)}
                        disabled={run.page.page >= run.page.pages}
                        title={translatePortalText("Last page")}
                        className="btn-ghost !px-1.5 !py-1 disabled:opacity-30"
                      >
                        <ChevronsRight size={13} />
                      </button>
                    </>
                  )}
                </div>

                {/* Truncation is stated rather than implied — a capped export that
                    looks complete is how somebody reconciles against a subset. */}
                {run.truncated && (
                  <span className="text-[11px] font-bold text-orange-600">
                    {translatePortalText("Capped — narrow the date range for the full set\r\n                  ")}</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ReportWorkbench
