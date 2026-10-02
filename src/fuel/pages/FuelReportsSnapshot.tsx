import React from 'react'
import { Download, Droplets, Percent, Receipt, TrendingUp } from 'lucide-react'
import { fuelApi } from '../fuelApi'
import { useFuel, useFuelResource } from '../fuelStore'
import { BASE_CURRENCY, useCurrency } from '../../currency'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../../i18n/runtime'
import { SnapshotCard, insightTabs, type Kpi } from '../../shared/reports/snapshot'
import { BarList, ColumnChart, formatValue, toDisplayMoney, type TrendRow } from '../../shared/reports/viz'
import { Counter, download, toast, toCSV } from '../../ui'

/**
 * The fuel "At a glance" panel.
 *
 * Sales, what was sold, and how deliveries went. The vehicle-utilisation and crew
 * widgets the old page carried are fleet and staff management, not reporting; they
 * are still on the pages that manage vehicles and crew.
 */

/** Period → the ISO `from` the backend is asked for (the end is always now). */
const WINDOW: Record<string, () => Date> = {
  today: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d },
  week: () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d },
  month: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  quarter: () => new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1),
  year: () => new Date(new Date().getFullYear(), 0, 1),
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
] as const

export function FuelReportsSnapshot() {
  const { station, fuelByKey, currentStationId, isAllStations } = useFuel()
  const { currency } = useCurrency()
  const [period, setPeriod] = React.useState<string>('month')
  const scopedStationId = isAllStations ? undefined : currentStationId ?? undefined

  const res = useFuelResource(
    () => fuelApi.reports({ from: WINDOW[period]().toISOString(), stationId: scopedStationId, all: isAllStations }).then(r => r.data),
    [period, currentStationId, isAllStations],
  )
  const d = res.data

  const revenue = d?.totals.revenue ?? 0
  const fills = d?.totals.fills ?? 0
  const avgFill = fills > 0 ? Math.round((revenue / fills) * 100) / 100 : 0
  const monthlyRevenue = (d?.byMonth ?? []).map(m => m.revenue)
  const monthlyVolume = (d?.byMonth ?? []).map(m => m.quantity)

  const kpis: Kpi[] = [
    {
      key: 'revenue', label: translatePortalText('Fuel revenue'), icon: TrendingUp,
      value: <Counter value={revenue} currency={BASE_CURRENCY} compact={toDisplayMoney(revenue) >= 1_000_000} />,
      caption: translatePortalText('Sold in this period'),
      spark: monthlyRevenue.length > 1 ? monthlyRevenue : undefined,
    },
    {
      key: 'volume', label: translatePortalText('Fuel dispensed'), icon: Droplets,
      value: <Counter value={d?.totals.quantity ?? 0} />,
      caption: translatePortalText('Volume across all products'),
      spark: monthlyVolume.length > 1 ? monthlyVolume : undefined,
    },
    {
      key: 'ontime', label: translatePortalText('Delivered on time'), icon: Percent,
      value: <Counter value={d?.totals.onTimeRate ?? 0} suffix="%" />,
      caption: `${formatPortalNumber(d?.totals.deliveries ?? 0)} ${translatePortalText('deliveries')}`,
    },
    {
      key: 'avgfill', label: translatePortalText('Average sale'), icon: Receipt,
      value: <Counter value={avgFill} currency={BASE_CURRENCY} decimals={2} />,
      caption: `${formatPortalNumber(fills)} ${translatePortalText('fills')}`,
    },
  ]

  // ── charts ────────────────────────────────────────────
  const sales: TrendRow[] = React.useMemo(
    () => (d?.byMonth ?? []).map(m => {
      const [y, mo] = m.month.split('-').map(Number)
      const at = new Date(y, (mo || 1) - 1, 1)
      return {
        x: formatPortalDate(at, { month: 'short' }),
        xFull: formatPortalDate(at, { month: 'long', year: 'numeric' }),
        revenue: toDisplayMoney(m.revenue),
        quantity: m.quantity,
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, currency]
  )

  const products = React.useMemo(
    () => (d?.byProduct ?? []).map(p => {
      const product = fuelByKey(p.productKey)
      return { name: product.name, unit: product.unit, quantity: p.quantity, revenue: toDisplayMoney(p.revenue), fills: p.fills }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, fuelByKey, currency]
  )

  const deliveries: TrendRow[] = (d?.deliveryPerformance ?? []).map(x => {
    const at = new Date(`${x.d}T12:00:00`)
    return {
      x: formatPortalDate(at, { month: 'short', day: 'numeric' }),
      xFull: formatPortalDate(at, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      onTime: x.onTime,
      late: x.late,
    }
  })

  const customers = d?.topCustomers ?? []
  const range = d
    ? `${formatPortalDate(d.range.from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${formatPortalDate(d.range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : undefined

  const tabs = insightTabs([
    {
      key: 'sales',
      label: 'Sales',
      title: translatePortalText('Fuel revenue by month'),
      sub: range,
      empty: sales.every(s => !s.revenue) ? translatePortalText('Nothing dispensed in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Month'), translatePortalText('Volume'), translatePortalText('Revenue')],
        rows: sales.map(s => [String(s.xFull), formatPortalNumber(Number(s.quantity)), formatValue(Number(s.revenue), 'money')]),
      },
      render: () => (
        <ColumnChart data={sales} series={[{ key: 'revenue', label: translatePortalText('Revenue') }]} kind="money" xInterval={0} />
      ),
    },
    {
      key: 'products',
      label: 'By fuel',
      title: translatePortalText('What was sold'),
      sub: translatePortalText('Volume sold by product'),
      empty: products.length === 0 ? translatePortalText('No volume in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Product'), translatePortalText('Volume'), translatePortalText('Revenue')],
        rows: products.map(p => [p.name, `${formatPortalNumber(p.quantity)} ${p.unit}`, formatValue(p.revenue, 'money')]),
      },
      render: () => (
        <BarList
          kind="count"
          items={products.map(p => ({ label: p.name, value: p.quantity, note: `${p.unit} · ${formatValue(p.revenue, 'money', { compact: true })}` }))}
        />
      ),
    },
    {
      key: 'deliveries',
      label: 'Deliveries',
      title: translatePortalText('Delivery timing'),
      sub: translatePortalText('Deliveries completed on time and late, by day'),
      empty: deliveries.length === 0 ? translatePortalText('No deliveries completed in this period yet.') : undefined,
      legend: [
        { label: translatePortalText('On time'), color: 'good', shape: 'rect' },
        { label: translatePortalText('Late'), color: 'bad', shape: 'rect' },
      ],
      table: {
        columns: [translatePortalText('Day'), translatePortalText('On time'), translatePortalText('Late')],
        rows: deliveries.map(x => [String(x.xFull), formatPortalNumber(Number(x.onTime)), formatPortalNumber(Number(x.late))]),
      },
      render: () => (
        <ColumnChart
          data={deliveries}
          stacked
          kind="count"
          series={[
            { key: 'onTime', label: translatePortalText('On time'), color: 'good' },
            { key: 'late', label: translatePortalText('Late'), color: 'bad' },
          ]}
        />
      ),
    },
    {
      key: 'customers',
      label: 'Top customers',
      title: translatePortalText('Your biggest customers'),
      sub: translatePortalText('By amount spent'),
      empty: customers.length === 0 ? translatePortalText('No sales in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Customer'), translatePortalText('Fills'), translatePortalText('Spend')],
        rows: customers.map(c => [c.name, formatPortalNumber(c.fills), formatValue(toDisplayMoney(c.spend), 'money')]),
      },
      render: () => (
        <BarList
          kind="money"
          items={customers.map(c => ({ label: c.name, value: toDisplayMoney(c.spend), note: `${formatPortalNumber(c.fills)} ${translatePortalText('fills')}` }))}
        />
      ),
    },
  ])

  const exportCsv = () => {
    if (!d) return
    const section = (title: string, rows: Record<string, unknown>[]) =>
      rows.length ? [`-- ${translatePortalText(title)} --`, toCSV(rows), ''] : []
    const lines: string[] = [
      `${station?.name ?? translatePortalText('Fuel station')} ${translatePortalText('analytics report')} — ${translatePortalText(PERIODS.find(p => p.key === period)?.label ?? '')}`,
      `${translatePortalText('Range')},${formatPortalDate(d.range.from)},${formatPortalDate(d.range.to)}`,
      '',
      `${translatePortalText('KPI')},${translatePortalText('Value')}`,
      `${translatePortalText('Revenue')},${d.totals.revenue}`,
      `${translatePortalText('Volume')},${d.totals.quantity}`,
      `${translatePortalText('Fills')},${d.totals.fills}`,
      `${translatePortalText('Deliveries')},${d.totals.deliveries}`,
      `${translatePortalText('On-time rate')},${d.totals.onTimeRate}%`,
      '',
      ...section('Revenue by product', d.byProduct.map(p => ({ [translatePortalText('Product')]: translatePortalText(fuelByKey(p.productKey).name), [translatePortalText('Quantity')]: p.quantity, [translatePortalText('Revenue')]: p.revenue, [translatePortalText('Fills')]: p.fills }))),
      ...section('Monthly', d.byMonth.map(m => ({ [translatePortalText('Month')]: m.month, [translatePortalText('Quantity')]: m.quantity, [translatePortalText('Revenue')]: m.revenue }))),
      ...section('Delivery performance', d.deliveryPerformance.map(x => ({ [translatePortalText('Date')]: x.d, [translatePortalText('On time')]: x.onTime, [translatePortalText('Late')]: x.late }))),
      ...section('Top customers', d.topCustomers.map(c => ({ [translatePortalText('Name')]: c.name, [translatePortalText('Spend')]: c.spend, [translatePortalText('Quantity')]: c.quantity, [translatePortalText('Fills')]: c.fills }))),
    ]
    download(`${(station?.name ?? 'fuel-station').toLowerCase().replace(/\s+/g, '-')}-analytics-report.csv`, '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8')
    toast(translatePortalText('Overview exported'))
  }

  return (
    <SnapshotCard
      tone="amber"
      title={translatePortalText('At a glance')}
      subtitle={translatePortalText('How your station is doing, over the period you choose.')}
      periods={PERIODS}
      period={period}
      onPeriod={setPeriod}
      kpis={kpis}
      tabs={tabs}
      loading={res.loading}
      hasData={!!d}
      error={res.error ? translatePortalText(res.error) : undefined}
      onRetry={() => void res.reload()}
      actions={
        <button
          type="button"
          onClick={exportCsv}
          disabled={!d}
          title={translatePortalText('Download these figures as a CSV file')}
          className="btn-ghost !px-3 !py-1.5 disabled:opacity-50"
        >
          <Download size={14} /> {translatePortalText('CSV')}
        </button>
      }
    />
  )
}
