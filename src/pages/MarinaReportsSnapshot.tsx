import React from 'react'
import { Anchor, Download, Percent, TrendingUp, Wallet } from 'lucide-react'
import { portalApi } from '../api'
import { useCurrency } from '../currency'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'
import { humanize, localIso, todayIso, useAsync, useMarina } from '../live'
import { SnapshotCard, insightTabs, type Kpi } from '../shared/reports/snapshot'
import { BarList, ColumnChart, formatValue, toDisplayMoney, type TrendRow } from '../shared/reports/viz'
import { Counter, download, toast, toCSV } from '../ui'

/**
 * The marina "At a glance" panel.
 *
 * The marina's report endpoint answers in whole months, so the periods here are
 * "this month" and the last 3, 6 and 12 — not the day-based windows the admin has.
 * The old page stacked ten widgets under these figures (staff on duty, metered
 * utilities, loyalty tiers…); those belong to the pages that manage them and are
 * still there. What stays is what a *report* is about: money, occupancy, who pays.
 */

const PERIODS = [
  { key: '1m', label: 'This month', months: 1 },
  { key: '3m', label: '3 months', months: 3 },
  { key: '6m', label: '6 months', months: 6 },
  { key: '12m', label: '12 months', months: 12 },
] as const

export function MarinaReportsSnapshot() {
  const { currency: marinaCurrency } = useMarina()
  const { currency: displayCurrency } = useCurrency()
  const [period, setPeriod] = React.useState<string>('3m')
  const months = PERIODS.find(p => p.key === period)!.months

  const from = React.useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - (months - 1))
    d.setDate(1)
    /*
      `localIso`, not `toISOString`. `setDate(1)` puts the cursor on local midnight
      of the 1st, and converting to UTC at +3 walks it back three hours — into the
      last day of the *previous* month, so the window would quietly start a day early.
    */
    return localIso(d)
  }, [months])

  const state = useAsync(() => portalApi.reports({ from, to: todayIso() }).then(r => r.data), [from])
  const berths = useAsync(() => portalApi.berthMap().then(r => r.data), [])
  const d = state.data
  const cur = d?.currency ?? marinaCurrency

  const gross = (d?.revenueByStream ?? []).reduce((s, r) => s + r.gross, 0)
  const net = (d?.revenueByStream ?? []).reduce((s, r) => s + r.net, 0)
  const commission = (d?.revenueByStream ?? []).reduce((s, r) => s + r.commission, 0)
  const compact = (v: number) => toDisplayMoney(v, cur) >= 1_000_000

  const kpis: Kpi[] = [
    {
      key: 'gross', label: translatePortalText('Gross revenue'), icon: Wallet,
      value: <Counter value={gross} currency={cur} compact={compact(gross)} />,
      caption: translatePortalText('Everything guests paid'),
    },
    {
      key: 'net', label: translatePortalText('Net to you'), icon: TrendingUp,
      value: <Counter value={net} currency={cur} compact={compact(net)} />,
      caption: translatePortalText('After platform fees'),
    },
    {
      key: 'commission', label: translatePortalText('Platform fees'), icon: Percent,
      value: <Counter value={commission} currency={cur} compact={compact(commission)} />,
      caption: translatePortalText('Commission charged'),
    },
    {
      key: 'berths', label: translatePortalText('Berths listed'), icon: Anchor,
      value: <Counter value={d?.berthCount ?? 0} />,
      caption: translatePortalText('In your inventory'),
    },
  ]

  // ── charts ────────────────────────────────────────────
  const monthRows: TrendRow[] = React.useMemo(() => {
    const byMonth = new Map((d?.revenueByMonth ?? []).map(m => [m.month, m]))
    const now = new Date()
    const spans = Array.from({ length: months }, (_, k) => new Date(now.getFullYear(), now.getMonth() - (months - 1 - k), 1))
    const multiYear = spans[0].getFullYear() !== spans[spans.length - 1].getFullYear()
    return spans.map(sp => {
      const key = `${sp.getFullYear()}-${String(sp.getMonth() + 1).padStart(2, '0')}`
      return {
        x: formatPortalDate(sp, multiYear ? { month: 'short', year: '2-digit' } : { month: 'short' }),
        xFull: formatPortalDate(sp, { month: 'long', year: 'numeric' }),
        gross: toDisplayMoney(byMonth.get(key)?.gross ?? 0, cur),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, months, displayCurrency])

  const streams = (d?.revenueByStream ?? [])
    .map(r => ({
      name: translatePortalText(humanize(r.stream === 'dock' ? 'berthing' : r.stream)),
      gross: toDisplayMoney(r.gross, cur),
      count: r.count,
    }))
    .filter(r => r.gross > 0)

  const occupancy: TrendRow[] = (d?.occupancyByDay ?? []).map(o => ({
    x: formatPortalDate(new Date(`${o.date}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    xFull: formatPortalDate(new Date(`${o.date}T12:00:00Z`), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    occupied: o.occupied,
  }))

  const guests = d?.topCustomers ?? []

  /** Share of each berth class held by a paid or reserved booking. */
  const classes = React.useMemo(() => {
    const rows = new Map<string, { total: number; taken: number }>()
    for (const b of berths.data?.berths ?? []) {
      const row = rows.get(b.category) ?? { total: 0, taken: 0 }
      row.total += 1
      if (b.status === 'booked' || b.status === 'reserved') row.taken += 1
      rows.set(b.category, row)
    }
    return [...rows.entries()].map(([name, v]) => ({
      name: translatePortalText(humanize(name)),
      pct: v.total ? Math.round((v.taken / v.total) * 100) : 0,
      total: v.total,
    }))
  }, [berths.data])

  const dateNote = d
    ? `${formatPortalDate(new Date(`${d.range.from}T12:00:00Z`), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} – ${formatPortalDate(new Date(`${d.range.to}T12:00:00Z`), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
    : undefined

  const tabs = insightTabs([
    {
      key: 'months',
      label: 'By month',
      title: translatePortalText('Revenue by month'),
      sub: dateNote,
      empty: monthRows.every(m => !m.gross) ? translatePortalText('No settled payments in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Month'), translatePortalText('Revenue')],
        rows: monthRows.map(m => [String(m.xFull), formatValue(Number(m.gross), 'money')]),
      },
      render: () => (
        <ColumnChart data={monthRows} series={[{ key: 'gross', label: translatePortalText('Gross revenue') }]} kind="money" xInterval={0} />
      ),
    },
    {
      key: 'streams',
      label: 'By stream',
      title: translatePortalText('Where the money comes from'),
      sub: dateNote,
      empty: streams.length === 0 ? translatePortalText('Nothing settled in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Stream'), translatePortalText('Payments'), translatePortalText('Revenue')],
        rows: streams.map(s => [s.name, formatPortalNumber(s.count), formatValue(s.gross, 'money')]),
      },
      render: () => (
        <BarList kind="money" items={streams.map(s => ({ label: s.name, value: s.gross, note: `${formatPortalNumber(s.count)} ${translatePortalText('payments')}` }))} />
      ),
    },
    {
      key: 'occupancy',
      label: 'Occupancy',
      title: translatePortalText('Occupancy, last 7 days'),
      sub: translatePortalText('Share of berths held by a paid reservation each day'),
      empty: occupancy.length === 0 ? translatePortalText('No occupancy data yet.') : undefined,
      table: {
        columns: [translatePortalText('Day'), translatePortalText('Occupied')],
        rows: occupancy.map(o => [String(o.xFull), formatValue(Number(o.occupied), 'percent')]),
      },
      render: () => (
        <ColumnChart data={occupancy} series={[{ key: 'occupied', label: translatePortalText('Occupied') }]} kind="percent" xInterval={0} />
      ),
    },
    {
      key: 'customers',
      label: 'Top customers',
      title: translatePortalText('Your best customers'),
      sub: translatePortalText('By lifetime berth spend'),
      empty: guests.length === 0 ? translatePortalText('No customer history yet.') : undefined,
      table: {
        columns: [translatePortalText('Customer'), translatePortalText('Stays'), translatePortalText('Spend')],
        rows: guests.map(g => [g.name, formatPortalNumber(g.stays), formatValue(toDisplayMoney(g.spend, cur), 'money')]),
      },
      render: () => (
        <BarList
          kind="money"
          items={guests.map(g => ({ label: g.name, value: toDisplayMoney(g.spend, cur), note: `${formatPortalNumber(g.stays)} ${translatePortalText('stays')}` }))}
        />
      ),
    },
    {
      key: 'classes',
      label: 'Berth types',
      title: translatePortalText('Which berths are earning'),
      sub: translatePortalText('Share of each berth type currently booked or reserved'),
      empty: classes.length === 0 ? translatePortalText('No berths set up yet.') : undefined,
      table: {
        columns: [translatePortalText('Berth type'), translatePortalText('Berths'), translatePortalText('In use')],
        rows: classes.map(c => [c.name, formatPortalNumber(c.total), formatValue(c.pct, 'percent')]),
      },
      render: () => (
        <BarList
          kind="percent"
          showShare={false}
          items={classes.map(c => ({ label: c.name, value: c.pct, note: `${formatPortalNumber(c.total)} ${translatePortalText('berths')}` }))}
        />
      ),
    },
  ])

  const exportCsv = () => {
    if (!d) return
    // The BOM lets Excel read Arabic names as UTF-8 instead of as mojibake.
    download(`marina-report-${todayIso()}.csv`, '\uFEFF' + toCSV(d.revenueByMonth.map(m => ({
      [translatePortalText('Month')]: m.month,
      [`${translatePortalText('Gross')} (${d.currency})`]: m.gross,
      [`${translatePortalText('Net')} (${d.currency})`]: m.net,
      [translatePortalText('Payments')]: m.count,
    }))), 'text/csv;charset=utf-8')
    toast(translatePortalText('Overview exported'))
  }

  return (
    <SnapshotCard
      tone="ocean"
      title={translatePortalText('At a glance')}
      subtitle={translatePortalText('How your marina is doing, over the period you choose.')}
      periods={PERIODS}
      period={period}
      onPeriod={setPeriod}
      kpis={kpis}
      tabs={tabs}
      loading={state.loading || state.refreshing}
      hasData={!!d}
      error={state.error ?? undefined}
      onRetry={() => void state.reload()}
      actions={
        <button
          type="button"
          onClick={exportCsv}
          disabled={!d}
          title={translatePortalText('Download the monthly figures as a CSV file')}
          className="btn-ghost !px-3 !py-1.5 disabled:opacity-50"
        >
          <Download size={14} /> {translatePortalText('CSV')}
        </button>
      }
    />
  )
}
