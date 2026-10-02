import React from 'react'
import { AlertCircle, ArrowDownRight, ArrowUpRight, RefreshCw, type LucideIcon } from 'lucide-react'
import { TONE, type Tone } from './reportMeta'
import { ChartFrame, EmptyBlock, Sparkline, type ChartTableData, type LegendItem } from './viz'
import { formatPortalNumber, isPortalArabic, translatePortalText } from '../../i18n/runtime'

/**
 * The building blocks of the "At a glance" panel that opens every Reports Center.
 *
 * Each console fetches its own headline figures (they differ: a marina counts
 * berths, a fuel station counts litres) and hands them to these components as plain
 * data. The look — one row of four numbers, one chart with a few tabs — is shared,
 * so the four consoles read as the same product.
 */

// ─────────────────────────────────────────────────────────────
// Period chips
// ─────────────────────────────────────────────────────────────

/** A row of pill buttons choosing one of a few periods. */
export function PeriodChips<K extends string>({
  options, value, onChange, tone, label,
}: {
  options: readonly { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
  tone: Tone
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
              on
                ? `${TONE[tone].solid} shadow-sm`
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-deep-900 hover:ring-slate-300'
            }`}
          >
            {translatePortalText(o.label)}
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// KPI tile
// ─────────────────────────────────────────────────────────────

export interface Kpi {
  key: string
  /** Sentence case, no trailing colon. */
  label: string
  /** Already formatted — a `<Counter>` for money, a plain string for a rate. */
  value: React.ReactNode
  /** What the figure covers: "in this period", "right now". */
  caption?: string
  /** Percent change against the previous period, when the server knows it. */
  delta?: number
  icon?: LucideIcon
  spark?: number[]
}

export function KpiTile({ tone, kpi, loading }: { tone: Tone; kpi: Kpi; loading?: boolean }) {
  const Icon = kpi.icon
  const up = (kpi.delta ?? 0) >= 0
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold leading-snug text-slate-600">{kpi.label}</p>
        {Icon && (
          <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TONE[tone].soft}`}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        {loading ? (
          <span className="skeleton-shimmer mt-1 block h-7 w-28 rounded-md bg-slate-200" />
        ) : (
          <p className="min-w-0 truncate font-display text-[24px] font-extrabold leading-tight tracking-tight text-deep-900">{kpi.value}</p>
        )}
        {!loading && kpi.spark && <Sparkline data={kpi.spark} />}
      </div>
      <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-x-2 gap-y-1">
        {kpi.caption && <p className="text-xs text-slate-500">{kpi.caption}</p>}
        {!loading && kpi.delta !== undefined && Number.isFinite(kpi.delta) && (
          <span
            title={translatePortalText('Compared with the previous period')}
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
              up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
            }`}
          >
            {up ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
            {formatPortalNumber(Math.abs(kpi.delta), { maximumFractionDigits: 1 })}{isPortalArabic() ? '٪' : '%'}
          </span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Insights (one chart, a few tabs)
// ─────────────────────────────────────────────────────────────

/**
 * Types a list of tabs contextually (so `color: 'good'` stays the literal it must be)
 * and translates each tab's short name in one place, instead of every console
 * repeating a `.map` after its array.
 */
export const insightTabs = (tabs: InsightTab[]): InsightTab[] =>
  tabs.map(t => ({ ...t, label: translatePortalText(t.label) }))

export interface InsightTab {
  key: string
  /** The tab's short name. */
  label: string
  /** The chart's heading — says what is plotted and, when it differs, over what period. */
  title: string
  sub?: string
  legend?: LegendItem[]
  /** The same numbers as a table, for the chart/table switch. */
  table?: ChartTableData
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: string
  render: () => React.ReactNode
}

/**
 * Several charts, one at a time.
 *
 * The overview used to stack every chart it had — four to eight of them — so the
 * page was a wall before it reached a single report. One chart with tabs keeps all
 * of them a click away and leaves the first screen calm.
 */
export function Insights({ tabs, tone }: { tabs: InsightTab[]; tone: Tone }) {
  const uid = React.useId()
  const [active, setActive] = React.useState(tabs[0]?.key)
  const tab = tabs.find(t => t.key === active) ?? tabs[0]
  if (!tab) return null

  const move = (delta: number) => {
    const i = tabs.findIndex(t => t.key === tab.key)
    const next = tabs[(i + delta + tabs.length) % tabs.length]
    setActive(next.key)
    // Roving focus: the arrow keys move the selection, so focus has to follow it.
    requestAnimationFrame(() => document.getElementById(`${uid}-tab-${next.key}`)?.focus())
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const rtl = isPortalArabic()
    if (e.key === 'ArrowRight') { e.preventDefault(); move(rtl ? -1 : 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(rtl ? 1 : -1) }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={translatePortalText('Charts')}
        onKeyDown={onKeyDown}
        className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 sm:w-fit"
      >
        {tabs.map(t => {
          const on = t.key === tab.key
          return (
            <button
              key={t.key}
              id={`${uid}-tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`${uid}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(t.key)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${
                on ? `bg-white shadow-sm ${TONE[tone].text}` : 'text-slate-600 hover:text-deep-900'
              }`}
            >
              {translatePortalText(t.label)}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab.key}`}>
        <ChartFrame key={tab.key} bare title={tab.title} sub={tab.sub} legend={tab.legend} table={tab.empty ? undefined : tab.table}>
          {tab.empty ? <EmptyBlock text={tab.empty} /> : tab.render()}
        </ChartFrame>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Error + the panel itself
// ─────────────────────────────────────────────────────────────

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <AlertCircle size={18} className="shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 font-semibold">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-ghost !py-1.5 !text-xs">
          <RefreshCw size={13} /> {translatePortalText('Try again')}
        </button>
      )}
    </div>
  )
}

/**
 * The "At a glance" panel: a period, four numbers, and a chart with tabs.
 *
 * The period lives *inside* this panel on purpose. Above the report finder it would
 * read as governing the finder too; here it is plainly the period of the figures
 * beside it, and each report has its own period once opened.
 */
export function SnapshotCard({
  tone, title, subtitle, periods, period, onPeriod, kpis, tabs, loading, hasData, error, onRetry, actions,
}: {
  tone: Tone
  title: string
  subtitle?: string
  periods: readonly { key: string; label: string }[]
  period: string
  onPeriod: (key: string) => void
  kpis: Kpi[]
  tabs: InsightTab[]
  /** A request is in flight. */
  loading?: boolean
  /**
   * Whether a first response has arrived. Until it has, the panel shows placeholders
   * rather than zeros and "nothing yet" messages — an empty chart that appears for a
   * moment before the data does is a claim that there is no data.
   */
  hasData: boolean
  error?: string
  onRetry?: () => void
  actions?: React.ReactNode
}) {
  return (
    <section className="card relative overflow-hidden p-4 md:p-5" aria-busy={loading || undefined}>
      {loading && <span className="rv-progress" />}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-deep-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodChips options={periods} value={period} onChange={onPeriod} tone={tone} label={translatePortalText('Period')} />
          {actions}
        </div>
      </header>

      {error ? (
        <ErrorNotice message={error} onRetry={onRetry} />
      ) : !hasData ? (
        <div aria-hidden>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map(k => <KpiTile key={k.key} tone={tone} kpi={k} loading />)}
          </div>
          <div className="mt-5 animate-pulse border-t border-slate-100 pt-5">
            <div className="mb-4 h-9 w-72 max-w-full rounded-xl bg-slate-100" />
            <div className="mb-3 h-4 w-48 rounded bg-slate-100" />
            <div className="h-[220px] rounded-xl bg-slate-50" />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map(k => <KpiTile key={k.key} tone={tone} kpi={k} />)}
          </div>
          <div className={`mt-5 border-t border-slate-100 pt-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <Insights tabs={tabs} tone={tone} />
          </div>
        </>
      )}
    </section>
  )
}
