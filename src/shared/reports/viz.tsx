import React from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, BarChart, Bar, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip,
} from 'recharts'
import { BarChart3, Table2 } from 'lucide-react'
import { BASE_CURRENCY, activeCurrency, convert, currencySign } from '../../currency'
import { formatPortalCurrency, formatPortalNumber, isPortalArabic, translatePortalText } from '../../i18n/runtime'

/**
 * Chart primitives for the Reports Center.
 *
 * Every chart here follows the same few rules, so a chart on the overview and a
 * chart inside a report read as one family:
 *
 *  - The form follows the data's job. A single number is a tile, not a chart. A
 *    breakdown of unordered categories is a sorted list of bars, in one colour — not
 *    a pie, and not a rainbow. A trend over time is a line. Two measures on
 *    different scales are two charts, never two y-axes.
 *  - Thin marks (bars capped at 24px, 2px lines), hairline solid gridlines, a 2px
 *    gap in the surface colour between touching marks.
 *  - Colour comes from `--rv-*` (reports.css), which is validated per console and per
 *    theme. Text never wears a series colour: identity is a swatch beside the label.
 *  - Every chart can be read as a table (`ChartFrame`), because a hover tooltip is
 *    never the only way to reach a value.
 */

/**
 * `currency` is the settlement currency, pinned — what a report shows, because a
 * report is reconciled against a bank statement. `money` is an amount *already
 * converted* into whatever the portal's SAR⇄USD switch says, for the overview, which
 * follows that switch like every other headline figure in the portal.
 */
export type ValueKind = 'currency' | 'money' | 'percent' | 'count' | 'duration'

/** A settlement-currency amount as the portal is currently displaying money. */
export const toDisplayMoney = (amount: number, from: string = BASE_CURRENCY): number =>
  convert(amount, from, activeCurrency())

const COLOR = { c1: 'var(--rv-c1)', c2: 'var(--rv-c2)', good: 'var(--rv-good)', bad: 'var(--rv-bad)' } as const
export type SeriesColor = keyof typeof COLOR

// ─────────────────────────────────────────────────────────────
// Number formatting
// ─────────────────────────────────────────────────────────────

/**
 * A value as a reader should see it.
 *
 * Money is pinned to the settlement currency and labelled — a report is what
 * somebody reconciles against a bank statement, so it must not silently follow the
 * portal's SAR⇄USD display switch, and a bare number in a money column is how a
 * figure gets read in the wrong currency.
 */
export function formatValue(v: number, kind?: ValueKind, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(v)) return '—'
  switch (kind) {
    case 'currency':
    case 'money': {
      const code = kind === 'money' ? activeCurrency() : BASE_CURRENCY
      if (opts?.compact && Math.abs(v) >= 1_000_000) {
        const n = formatPortalNumber(v, { notation: 'compact', maximumFractionDigits: 1 })
        return isPortalArabic() ? `${n} ${currencySign(code)}` : `${currencySign(code)} ${n}`
      }
      return formatPortalCurrency(v, code)
    }
    case 'percent':
      return `${formatPortalNumber(v, { maximumFractionDigits: 2 })}${isPortalArabic() ? '٪' : '%'}`
    case 'duration':
      return `${formatPortalNumber(v, { maximumFractionDigits: 2 })} ${translatePortalText('h')}`
    default:
      return formatPortalNumber(v, { maximumFractionDigits: 2 })
  }
}

/** Axis tick: short, no currency sign (the chart's title carries the unit). */
export function formatTick(v: number, kind?: ValueKind): string {
  if (kind === 'percent') return `${formatPortalNumber(v, { maximumFractionDigits: 0 })}${isPortalArabic() ? '٪' : '%'}`
  return formatPortalNumber(v, { notation: 'compact', maximumFractionDigits: 1 })
}

// ─────────────────────────────────────────────────────────────
// Frame, legend, table twin, empty state
// ─────────────────────────────────────────────────────────────

export interface ChartTableData {
  columns: string[]
  rows: (string | number)[][]
}

export interface LegendItem {
  label: string
  color: SeriesColor
  shape?: 'line' | 'rect'
}

function Swatch({ color, shape = 'rect' }: { color: SeriesColor; shape?: 'line' | 'rect' }) {
  return shape === 'line'
    ? <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: COLOR[color] }} />
    : <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: COLOR[color] }} />
}

/** Shown for two or more series; a single series needs no key — the title names it. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map(item => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <Swatch color={item.color} shape={item.shape} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** The chart's accessible twin: the same numbers, as a table. */
export function ChartTable({ data }: { data: ChartTableData }) {
  return (
    <div className="max-h-[280px] overflow-auto rounded-xl border border-slate-100 custom-scrollbar">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50">
            {data.columns.map((c, i) => (
              <th key={i} scope="col" className={`sticky top-0 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 ${i === 0 ? 'text-start' : 'text-end'}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className="border-t border-slate-100">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 ${ci === 0 ? 'text-start font-semibold text-deep-800' : 'text-end tabular-nums text-deep-900'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EmptyBlock({ text, hint, height = 200 }: { text: string; hint?: string; height?: number }) {
  return (
    <div className="grid place-items-center rounded-xl bg-slate-50 px-4 text-center" style={{ minHeight: height }}>
      <div>
        <BarChart3 size={22} className="mx-auto mb-2 text-slate-400" />
        <p className="text-sm font-semibold text-slate-600">{text}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  )
}

/**
 * The card a chart lives in: a title, an optional legend, and a switch between the
 * chart and its table. `bare` drops the card so a frame can sit inside another one.
 */
export function ChartFrame({
  title, sub, legend, table, children, className = '', bare = false, actions,
}: {
  title: string
  sub?: string
  legend?: LegendItem[]
  table?: ChartTableData
  children: React.ReactNode
  className?: string
  bare?: boolean
  actions?: React.ReactNode
}) {
  const [view, setView] = React.useState<'chart' | 'table'>('chart')
  return (
    <section className={`${bare ? '' : 'card p-4 md:p-5'} ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold leading-snug text-deep-900">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {table && <ViewSwitch view={view} onChange={setView} />}
        </div>
      </header>
      {legend && legend.length > 1 && <Legend items={legend} />}
      {view === 'table' && table ? <ChartTable data={table} /> : children}
    </section>
  )
}

export function ViewSwitch({ view, onChange }: { view: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void }) {
  const opts = [
    { key: 'chart' as const, icon: BarChart3, label: translatePortalText('Show as chart') },
    { key: 'table' as const, icon: Table2, label: translatePortalText('Show as table') },
  ]
  return (
    <div role="group" className="flex rounded-lg bg-slate-100 p-0.5" aria-label={translatePortalText('Chart or table')}>
      {opts.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={view === o.key}
          title={o.label}
          aria-label={o.label}
          className={`grid h-7 w-7 place-items-center rounded-md transition ${
            view === o.key ? 'bg-white text-deep-900 shadow-sm' : 'text-slate-500 hover:text-deep-900'
          }`}
        >
          <o.icon size={14} />
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────

/**
 * Values lead, names follow; each row is keyed by a short stroke of its series
 * colour. React escapes the text, so a series name from the server is safe here.
 */
export function VizTooltip({
  active, payload, label, kind,
}: {
  active?: boolean
  payload?: any[]
  label?: string
  kind?: ValueKind
}) {
  if (!active || !payload?.length) return null
  const head = payload[0]?.payload?.xFull ?? label
  return (
    <div className="min-w-[8rem] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lift">
      {head !== undefined && head !== '' && <p className="mb-1 font-bold text-deep-900">{head}</p>}
      {payload.map((p, i) => (
        <p key={`${p.dataKey ?? p.name}-${i}`} className="flex items-center gap-2 py-0.5">
          <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: p.color || p.fill || p.stroke }} />
          <b className="tabular-nums text-deep-900">{typeof p.value === 'number' ? formatValue(p.value, kind) : p.value}</b>
          <span className="text-slate-500">{p.name}</span>
        </p>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Trend (line / area)
// ─────────────────────────────────────────────────────────────

export interface TrendSeries {
  key: string
  label: string
  color?: SeriesColor
}

/** One row per x. `xFull` (optional) is what the tooltip says instead of the short axis label. */
export type TrendRow = { x: string; xFull?: string } & Record<string, number | string | undefined>

/**
 * A change over time.
 *
 * One series gets the soft area wash; two or more are plain lines (overlapping
 * washes turn to mud) with a legend. The last point carries a marker so the eye
 * lands on "where it is now", and the whole plot is a crosshair that snaps to the
 * nearest x — a reader aims at a date, not at a two-pixel line.
 */
export function TrendChart({
  data, series, kind, height = 220,
}: {
  data: TrendRow[]
  series: TrendSeries[]
  kind?: ValueKind
  height?: number
}) {
  const gid = React.useId().replace(/[^a-zA-Z0-9]/g, '')
  const last = data.length - 1
  const single = series.length === 1
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 14, left: 0, bottom: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id={`rv-fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR[series[0]?.color ?? 'c1']} stopOpacity={0.18} />
              <stop offset="100%" stopColor={COLOR[series[0]?.color ?? 'c1']} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--rv-grid)" />
          <XAxis
            dataKey="x"
            tickLine={false}
            axisLine={{ stroke: 'var(--rv-axis)' }}
            tickMargin={8}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={46}
            domain={kind === 'percent' ? [0, 100] : [0, 'auto']}
            allowDecimals={kind !== 'count'}
            tickFormatter={(v: number) => formatTick(v, kind)}
          />
          <Tooltip
            content={<VizTooltip kind={kind} />}
            cursor={{ stroke: 'var(--rv-axis)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {single && (
            <Area
              type="monotone"
              dataKey={series[0].key}
              stroke="none"
              fill={`url(#rv-fill-${gid})`}
              isAnimationActive={false}
              activeDot={false}
              legendType="none"
              tooltipType="none"
            />
          )}
          {series.map(s => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={COLOR[s.color ?? 'c1']}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              isAnimationActive={false}
              dot={(p: any) =>
                p.index === last
                  ? <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={4.5} fill={COLOR[s.color ?? 'c1']} stroke="var(--rv-surface)" strokeWidth={2} />
                  : <g key={`d${p.index}`} />
              }
              activeDot={{ r: 5, stroke: 'var(--rv-surface)', strokeWidth: 2, fill: COLOR[s.color ?? 'c1'] }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Columns (ordered buckets: months, hours, weekdays)
// ─────────────────────────────────────────────────────────────

export interface ColumnSeries {
  key: string
  label: string
  color?: SeriesColor
}

/**
 * Bars over an *ordered* axis. For unordered categories use `BarList` — sorted, and
 * far easier to read than columns whose order means nothing.
 *
 * `highlight` is the emphasis form: when one column is the point (the busiest hour),
 * it wears the accent and the rest recede, instead of every column shouting.
 */
export function ColumnChart({
  data, series, kind, height = 220, stacked = false, highlight, xInterval = 'preserveStartEnd',
}: {
  data: TrendRow[]
  series: ColumnSeries[]
  kind?: ValueKind
  height?: number
  stacked?: boolean
  highlight?: (row: TrendRow, index: number) => boolean
  xInterval?: number | 'preserveStartEnd'
}) {
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 14, left: 0, bottom: 0 }} barCategoryGap="24%" accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--rv-grid)" />
          <XAxis
            dataKey="x"
            tickLine={false}
            axisLine={{ stroke: 'var(--rv-axis)' }}
            tickMargin={8}
            interval={xInterval}
            minTickGap={12}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={46}
            domain={kind === 'percent' ? [0, 100] : [0, 'auto']}
            allowDecimals={kind !== 'count'}
            tickFormatter={(v: number) => formatTick(v, kind)}
          />
          <Tooltip
            content={<VizTooltip kind={kind} />}
            cursor={{ fill: 'var(--rv-grid)', fillOpacity: 0.6 }}
            isAnimationActive={false}
          />
          {series.map((s, si) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={COLOR[s.color ?? (si === 0 ? 'c1' : 'c2')]}
              stackId={stacked ? 'stack' : undefined}
              maxBarSize={24}
              // A 4px rounded data-end, square where it meets the baseline. In a
              // stack only the top segment is rounded, or the joins go soft.
              radius={!stacked || si === series.length - 1 ? [4, 4, 0, 0] : 0}
              // The 2px surface-coloured edge is the gap between stacked segments.
              stroke={stacked ? 'var(--rv-surface)' : undefined}
              strokeWidth={stacked ? 2 : 0}
              isAnimationActive={false}
            >
              {highlight && !stacked
                ? data.map((row, i) => <Cell key={i} fillOpacity={highlight(row, i) ? 1 : 0.38} />)
                : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Bar list (unordered categories)
// ─────────────────────────────────────────────────────────────

export interface BarItem {
  label: string
  value: number
  /** Small text under the label — "3 stays", "12 bookings". */
  note?: string
}

/**
 * A breakdown of categories: sorted high to low, one colour, the value at the end of
 * every row.
 *
 * One colour on purpose. The bar's length already says how much; colouring each bar
 * by its value would spend the only other channel re-saying it, and colouring them
 * by category would imply an identity the rows do not have. Past `limit` rows the
 * tail folds into a single "more" row instead of growing the card without bound —
 * the table view still has every row.
 */
export function BarList({
  items, kind, limit = 8, showShare = true,
}: {
  items: BarItem[]
  kind?: ValueKind
  limit?: number
  showShare?: boolean
}) {
  const positive = items.filter(i => Number.isFinite(i.value))
  const sorted = [...positive].sort((a, b) => b.value - a.value)
  const shown = sorted.slice(0, limit)
  const rest = sorted.slice(limit)
  const total = sorted.reduce((s, i) => s + Math.max(0, i.value), 0)
  const max = Math.max(1, ...shown.map(i => i.value), rest.reduce((s, i) => s + i.value, 0))
  const rows: (BarItem & { other?: boolean })[] = [...shown]
  if (rest.length) {
    rows.push({
      label: `${formatPortalNumber(rest.length)} ${translatePortalText('more')}`,
      value: rest.reduce((s, i) => s + i.value, 0),
      other: true,
    })
  }
  return (
    <ul className="space-y-1">
      {rows.map((row, i) => {
        const pct = Math.max(0, Math.min(100, (row.value / max) * 100))
        const share = total > 0 ? (row.value / total) * 100 : 0
        return (
          <li key={`${row.label}-${i}`} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto]">
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-deep-800" title={row.label}>{row.label}</span>
              {row.note && <span className="block truncate text-[11px] text-slate-500">{row.note}</span>}
            </span>
            <span className="h-3 rounded-e-[4px] bg-[color:var(--rv-track)]" aria-hidden>
              <span
                className="block h-full rounded-e-[4px]"
                style={{ width: `${row.value > 0 ? Math.max(pct, 1.5) : 0}%`, background: row.other ? 'var(--rv-axis)' : 'var(--rv-c1)' }}
              />
            </span>
            <span className="min-w-[4.5rem] text-end">
              <b className="text-[13px] font-bold tabular-nums text-deep-900">{formatValue(row.value, kind, { compact: true })}</b>
              {showShare && total > 0 && (
                <span className="ms-1.5 text-[11px] tabular-nums text-slate-500">{formatPortalNumber(share, { maximumFractionDigits: 0 })}{isPortalArabic() ? '٪' : '%'}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────
// Sparkline
// ─────────────────────────────────────────────────────────────

/** A line with no axes: direction at a glance, current point marked. */
export function Sparkline({ data, width = 84, height = 30 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null
  const pad = 4
  const min = Math.min(...data)
  const span = Math.max(...data) - min || 1
  const pts = data.map((v, i) => [
    pad + (i / (data.length - 1)) * (width - pad * 2),
    height - pad - ((v - min) / span) * (height - pad * 2),
  ])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`
  const end = pts[pts.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0 overflow-visible">
      <path d={area} fill="var(--rv-c1)" fillOpacity={0.1} />
      <path d={line} fill="none" stroke="var(--rv-c1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={end[0]} cy={end[1]} r={3.5} fill="var(--rv-c1)" stroke="var(--rv-surface)" strokeWidth={2} />
    </svg>
  )
}
