import type { ReportSeries } from '../../api/platform'
import {
  formatPortalClock, formatPortalDate, formatPortalNumber, isPortalArabic,
  translatePortalTemplate, translatePortalText,
} from '../../i18n/runtime'
import { formatValue, type TrendRow, type ValueKind } from './viz'

/**
 * How a report's values are written on screen.
 *
 * Report rows are assembled from real records, so names and notes stay in the
 * language their author used; only the *known* fixed labels, statuses and date
 * buckets are localised. Sortable ISO buckets (`2026-08`, `2026-08-19`,
 * `2026-W34`) come across the wire in a form that sorts, and are turned into
 * something a person reads only here, at the last moment.
 */

/** A metric card's value, the way its `kind` asks for it. */
export function formatMetric(value: number | string, kind?: string): string {
  if (typeof value === 'string') {
    // A text metric can still carry an app-owned unit phrase ("12 days"); keep
    // arbitrary provider text intact but localise the known numeric day form.
    if (kind === 'text' && /^\s*[\d٠-٩۰-۹,٬]+\s+days?$/i.test(value)) return translatePortalText(value)
    return value
  }
  if (kind === 'currency') return formatValue(value, 'currency', { compact: true })
  if (kind === 'percent') return formatValue(value, 'percent')
  if (kind === 'duration') return formatValue(value, 'duration')
  return formatPortalNumber(value)
}

const MONTH = /^(\d{4})-(\d{2})$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/
const WEEK = /^(\d{4})-W(\d{2})$/i
const HOUR = /^\d{1,2}:\d{2}$/

/** A table cell. Numbers are grouped, known date buckets localised, everything else translated if it is a known phrase. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return formatPortalNumber(value)
  if (typeof value !== 'string') return translatePortalText(String(value))

  const month = value.match(MONTH)
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 15))
    return formatPortalDate(date, { year: 'numeric', month: 'short', timeZone: 'UTC' })
  }

  const day = value.match(DAY)
  if (day) {
    const date = new Date(Date.UTC(
      Number(day[1]), Number(day[2]) - 1, Number(day[3]),
      Number(day[4] ?? 12), Number(day[5] ?? 0)
    ))
    return formatPortalDate(date, day[4]
      ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  }

  const week = value.match(WEEK)
  if (week && isPortalArabic()) {
    return `${formatPortalNumber(Number(week[1]), { useGrouping: false })} · الأسبوع ${formatPortalNumber(Number(week[2]))}`
  }

  return translatePortalText(value)
}

/**
 * The fuel-margin report's subtitle is a server sentence with a changing date
 * window. Format the dates for the active language, then pass the whole range into
 * its named template so Arabic keeps a natural word order.
 */
export function formatReportSubtitle(input: string): string {
  const match = input.match(/^(.+?)\s*[·•]\s*cost of sales estimated at this window[’']s average purchase cost$/i)
  if (!match) return translatePortalText(input)

  const range = match[1].match(/^(\d{4}-\d{2}-\d{2})\s*(?:→|–|—|-)\s*(\d{4}-\d{2}-\d{2})$/)
  const dateRange = range
    ? `${formatPortalDate(range[1], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })} → ${formatPortalDate(range[2], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
    : match[1]

  return translatePortalTemplate(
    '{{dateRange}} · cost of sales estimated at this window’s average purchase cost',
    { dateRange }
  )
}

/** Whether a subtitle is only the date window — which the period controls already show. */
export const isDateWindowSubtitle = (s?: string) =>
  !!s && /^\d{4}-\d{2}-\d{2}\s*(?:→|–|—|-)\s*\d{4}-\d{2}-\d{2}$/.test(s.trim())

// ─────────────────────────────────────────────────────────────
// Chart axes
// ─────────────────────────────────────────────────────────────

/** True when x is a position in an order that means something — dates, weeks, hours, numbers. */
export function isOrderedAxis(labels: string[]): boolean {
  if (labels.length < 2) return false
  return labels.every(l => MONTH.test(l) || DAY.test(l) || WEEK.test(l) || HOUR.test(l) || /^-?\d+(\.\d+)?$/.test(l.trim()))
}

/** One x label: short for the axis, full for the tooltip. */
function bucketLabel(x: string, sameYear: boolean): { x: string; xFull: string } {
  const month = x.match(MONTH)
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 15))
    return {
      x: formatPortalDate(date, sameYear ? { month: 'short', timeZone: 'UTC' } : { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      xFull: formatPortalDate(date, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    }
  }
  const day = x.match(DAY)
  if (day) {
    const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12))
    return {
      x: formatPortalDate(date, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      xFull: formatPortalDate(date, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    }
  }
  const week = x.match(WEEK)
  if (week) {
    const label = translatePortalTemplate('Week {{n}}', { n: formatPortalNumber(Number(week[2])) })
    return { x: label, xFull: `${label} · ${formatPortalNumber(Number(week[1]), { useGrouping: false })}` }
  }
  if (HOUR.test(x)) {
    const clock = formatPortalClock(x)
    return { x: clock, xFull: clock }
  }
  const text = translatePortalText(x)
  return { x: text, xFull: text }
}

/** A server series as rows a chart can draw, with x labels made readable. */
export function seriesToRows(series: ReportSeries): TrendRow[] {
  const years = new Set(series.points.map(p => p.x.match(MONTH)?.[1]).filter(Boolean))
  const sameYear = years.size <= 1
  return series.points.map(p => {
    const { x, xFull } = bucketLabel(p.x, sameYear)
    return { x, xFull, y: p.y }
  })
}

/** The series' unit, defaulting to a plain count. */
export const seriesKind = (s: ReportSeries): ValueKind | undefined => s.valueKind
