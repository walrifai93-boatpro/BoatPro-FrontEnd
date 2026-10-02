import React from 'react'
import { BadgePercent, Download, Package, TrendingUp, UserPlus } from 'lucide-react'
import { adminPortalApi } from '../../api'
import { errorMessage } from '../../async/errors'
import { BASE_CURRENCY, useCurrency } from '../../currency'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../../i18n/runtime'
import { SnapshotCard, insightTabs, type Kpi } from '../../shared/reports/snapshot'
import { BarList, ColumnChart, formatValue, toDisplayMoney, type TrendRow } from '../../shared/reports/viz'
import { Counter, downloadCsv, toast } from '../../ui'

/**
 * The admin "At a glance" panel.
 *
 * Figures come from the dashboard endpoint, which takes a trailing window
 * (`24h`…`all`). The KPIs and three of the four charts follow that window; the
 * monthly chart is always the last twelve months, and says so in its heading —
 * because a chart that quietly ignored the period next to it would be the same
 * mistake the period pills used to make when they highlighted and changed nothing.
 */

interface Dashboard {
  totals?: {
    payments?: { gross: number; commission: number; count: number }
    usersThisMonth?: number
  }
  serviceLines?: { key: string; listings: number; bookings: number; revenue: number }[]
  revenueMonths?: { _id: { y: number; m: number }; gross: number; commission: number; count: number }[]
  bookingsByHour?: { h: number; count: number }[]
  topLocations?: { city: string; bookings: number; pct: number }[]
  range?: { key: string; since: string | null }
}

const PERIODS = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '12mo', label: '12 months' },
  { key: 'ytd', label: 'This year' },
  { key: 'all', label: 'All time' },
] as const

const WINDOW_LABEL: Record<string, string> = {
  '24h': 'The last 24 hours',
  '7d': 'The last 7 days',
  '30d': 'The last 30 days',
  '12mo': 'The last 12 months',
  ytd: 'Since 1 January',
  all: 'All time',
}

const SERVICE_NAME: Record<string, string> = {
  boat: 'Boat rentals',
  marina: 'Marina berths',
  fuel: 'Fuel delivery',
  maintenance: 'Maintenance',
}

export function AdminReportsSnapshot() {
  const { currency } = useCurrency()
  const [period, setPeriod] = React.useState<string>('30d')
  const [data, setData] = React.useState<Dashboard | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)

  // `alive` guards the order, not just the unmount: click 24h → 7d → 30d and the
  // slowest response would otherwise land last and write 24-hour figures into a
  // panel labelled 30 days.
  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    adminPortalApi
      .dashboard(period)
      .then(res => { if (alive) setData((res.data as Dashboard) || {}) })
      .catch(e => { if (alive) { setData(null); setError(errorMessage(e) || translatePortalText('Could not load the overview')) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [period, attempt])

  const windowLabel = translatePortalText(WINDOW_LABEL[period] ?? WINDOW_LABEL.all)
  const payments = data?.totals?.payments
  const grossDisplay = toDisplayMoney(payments?.gross ?? 0)
  const commissionDisplay = toDisplayMoney(payments?.commission ?? 0)

  const kpis: Kpi[] = [
    {
      key: 'gross', label: translatePortalText('Gross revenue'), icon: TrendingUp,
      value: <Counter value={payments?.gross ?? 0} currency={BASE_CURRENCY} compact={grossDisplay >= 1_000_000} />,
      caption: translatePortalText('Paid bookings, in this period'),
    },
    {
      key: 'commission', label: translatePortalText('Platform commission'), icon: BadgePercent,
      value: <Counter value={payments?.commission ?? 0} currency={BASE_CURRENCY} compact={commissionDisplay >= 1_000_000} />,
      caption: translatePortalText('In this period'),
    },
    {
      key: 'bookings', label: translatePortalText('Paid bookings'), icon: Package,
      value: <Counter value={payments?.count ?? 0} />,
      caption: translatePortalText('In this period'),
    },
    {
      key: 'signups', label: translatePortalText('New sign-ups'), icon: UserPlus,
      value: <Counter value={data?.totals?.usersThisMonth ?? 0} />,
      caption: translatePortalText('This calendar month'),
    },
  ]

  // ── charts ────────────────────────────────────────────
  const services = React.useMemo(
    () => (data?.serviceLines ?? []).map(s => ({
      name: translatePortalText(SERVICE_NAME[s.key] ?? s.key),
      bookings: s.bookings,
      revenue: toDisplayMoney(s.revenue),
    })),
    // `currency` re-runs the conversion when the portal's display currency flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, currency]
  )

  const months: TrendRow[] = React.useMemo(() => {
    const byKey = new Map((data?.revenueMonths ?? []).map(r => [`${r._id.y}-${r._id.m}`, r]))
    const now = new Date()
    // The endpoint omits months with no revenue, so the last twelve are rebuilt
    // here — a chart with the empty months dropped would draw a steady climb
    // where the truth is a gap.
    const spans = Array.from({ length: 12 }, (_, k) => new Date(now.getFullYear(), now.getMonth() - (11 - k), 1))
    const multiYear = spans[0].getFullYear() !== spans[11].getFullYear()
    return spans.map(d => ({
      x: formatPortalDate(d, multiYear ? { month: 'short', year: '2-digit' } : { month: 'short' }),
      xFull: formatPortalDate(d, { month: 'long', year: 'numeric' }),
      gross: toDisplayMoney(byKey.get(`${d.getFullYear()}-${d.getMonth() + 1}`)?.gross ?? 0),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, currency])

  const hours: TrendRow[] = (data?.bookingsByHour ?? []).map(b => ({
    x: formatPortalNumber(b.h, { minimumIntegerDigits: 2 }),
    xFull: `${formatPortalNumber(b.h, { minimumIntegerDigits: 2 })}:00`,
    count: b.count,
  }))
  const peak = Math.max(0, ...hours.map(h => Number(h.count)))
  const cities = data?.topLocations ?? []

  const noRevenue = services.every(s => s.revenue === 0)
  const tabs = insightTabs([
    {
      key: 'service',
      label: 'By service',
      title: translatePortalText('Revenue by service'),
      sub: windowLabel,
      empty: noRevenue ? translatePortalText('No revenue in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Service'), translatePortalText('Bookings'), translatePortalText('Revenue')],
        rows: services.map(s => [s.name, formatPortalNumber(s.bookings), formatValue(s.revenue, 'money')]),
      },
      render: () => (
        <BarList
          kind="money"
          items={services.map(s => ({ label: s.name, value: s.revenue, note: `${formatPortalNumber(s.bookings)} ${translatePortalText('bookings')}` }))}
        />
      ),
    },
    {
      key: 'monthly',
      label: 'Monthly',
      title: translatePortalText('Revenue by month'),
      sub: translatePortalText('Always the last 12 months, whatever period is chosen'),
      empty: months.every(m => !m.gross) ? translatePortalText('No revenue in the last 12 months.') : undefined,
      table: {
        columns: [translatePortalText('Month'), translatePortalText('Revenue')],
        rows: months.map(m => [String(m.xFull), formatValue(Number(m.gross), 'money')]),
      },
      render: () => (
        <ColumnChart data={months} series={[{ key: 'gross', label: translatePortalText('Gross revenue') }]} kind="money" xInterval={0} />
      ),
    },
    {
      key: 'hours',
      label: 'Peak hours',
      title: translatePortalText('When bookings are paid'),
      sub: `${translatePortalText('Paid bookings by hour of the day')} · ${windowLabel}`,
      empty: peak === 0 ? translatePortalText('No paid bookings in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Hour'), translatePortalText('Bookings')],
        rows: hours.map(h => [String(h.xFull), formatPortalNumber(Number(h.count))]),
      },
      render: () => (
        <ColumnChart
          data={hours}
          series={[{ key: 'count', label: translatePortalText('Paid bookings') }]}
          kind="count"
          highlight={row => Number(row.count) === peak}
          xInterval={2}
        />
      ),
    },
    {
      key: 'cities',
      label: 'Top cities',
      title: translatePortalText('Where bookings happen'),
      sub: `${translatePortalText('Paid bookings by provider city')} · ${windowLabel}`,
      empty: cities.length === 0 ? translatePortalText('No location data in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('City'), translatePortalText('Bookings')],
        rows: cities.map(c => [c.city, formatPortalNumber(c.bookings)]),
      },
      render: () => <BarList kind="count" items={cities.map(c => ({ label: c.city, value: c.bookings }))} />,
    },
  ])

  /**
   * Exports what is on screen — the service lines, the hourly curve and the top
   * cities — under a header naming the window they describe. A figure exported
   * without its period is the kind that ends up in a board pack meaning
   * something other than what it said.
   */
  const exportCsv = () => {
    if (!data || (noRevenue && !cities.length)) {
      toast(translatePortalText('Nothing to export yet'), 'warn')
      return
    }
    const rows: (string | number | null)[][] = [
      ['BoatPro platform analytics'],
      ['Window', windowLabel],
      ['Since', data.range?.since ? new Date(data.range.since).toISOString().slice(0, 10) : 'all time'],
      ['Currency', BASE_CURRENCY],
      [],
      ['Service line', 'Bookings', `Revenue (${BASE_CURRENCY})`],
      ...(data.serviceLines ?? []).map(l => [SERVICE_NAME[l.key] ?? l.key, l.bookings, l.revenue]),
      [],
      ['Hour of day', 'Bookings'],
      ...(data.bookingsByHour ?? []).map(h => [`${String(h.h).padStart(2, '0')}:00`, h.count]),
      [],
      ['City', 'Bookings'],
      ...cities.map(c => [c.city, c.bookings]),
    ]
    downloadCsv(`platform-analytics-${period}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast(translatePortalText('Overview exported'))
  }

  return (
    <SnapshotCard
      tone="emerald"
      title={translatePortalText('At a glance')}
      subtitle={translatePortalText('How the platform is doing, over the period you choose.')}
      periods={PERIODS}
      period={period}
      onPeriod={setPeriod}
      kpis={kpis}
      tabs={tabs}
      loading={loading}
      hasData={!!data}
      error={error}
      onRetry={() => setAttempt(n => n + 1)}
      actions={
        <button
          type="button"
          onClick={exportCsv}
          disabled={!data}
          title={translatePortalText('Download these figures as a CSV file')}
          className="btn-ghost !px-3 !py-1.5 disabled:opacity-50"
        >
          <Download size={14} /> {translatePortalText('CSV')}
        </button>
      }
    />
  )
}
