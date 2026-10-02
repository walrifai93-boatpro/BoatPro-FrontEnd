import React from 'react'
import { AlertCircle, CheckCircle2, Download, Receipt, Wrench } from 'lucide-react'
import {
  maintenancePortalApi,
  type MaintenanceInvoice, type MaintenanceTechnician, type MaintenanceWorkOrder,
} from '../../api'
import { errorMessage } from '../../async/errors'
import { BASE_CURRENCY, useCurrency } from '../../currency'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../../i18n/runtime'
import { SnapshotCard, insightTabs, type Kpi } from '../../shared/reports/snapshot'
import { BarList, ColumnChart, TrendChart, formatValue, toDisplayMoney, type TrendRow } from '../../shared/reports/viz'
import { Counter, download, toast, toCSV } from '../../ui'
import { catByKey } from '../maintData'

/**
 * The maintenance "At a glance" panel.
 *
 * Unlike the other consoles there is no report endpoint behind this one: it is
 * worked out here from the shop's own invoices, work orders and technicians, so the
 * period is applied here too, by the date each record was created.
 */

const PERIODS = [
  { key: '3m', label: '3 months', months: 3 },
  { key: '6m', label: '6 months', months: 6 },
  { key: '12m', label: '12 months', months: 12 },
] as const

const DONE = ['completed', 'delivered']
const CLOSED = [...DONE, 'cancelled', 'rejected']
const OWED = ['pending', 'overdue', 'sent']

const startOfWindow = (months: number) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
}

export function MaintReportsSnapshot() {
  const { currency } = useCurrency()
  const [period, setPeriod] = React.useState<string>('12m')
  const months = PERIODS.find(p => p.key === period)!.months

  const [invoices, setInvoices] = React.useState<MaintenanceInvoice[]>([])
  const [orders, setOrders] = React.useState<MaintenanceWorkOrder[]>([])
  const [techs, setTechs] = React.useState<MaintenanceTechnician[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loaded, setLoaded] = React.useState(false)
  const [error, setError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    Promise.all([
      maintenancePortalApi.invoices({ limit: 500 }),
      maintenancePortalApi.workOrders({ limit: 500 }),
      maintenancePortalApi.technicians(),
    ])
      .then(([inv, wo, tech]) => {
        if (!alive) return
        setInvoices(inv.data.items || [])
        setOrders(wo.data.items || [])
        setTechs(tech.data.technicians || [])
      })
      .catch(e => { if (alive) setError(errorMessage(e) || translatePortalText('Could not load report data')) })
      .finally(() => { if (alive) { setLoading(false); setLoaded(true) } })
    return () => { alive = false }
  }, [attempt])

  const since = React.useMemo(() => startOfWindow(months), [months])
  const inWindow = (iso: string) => new Date(iso) >= since

  const windowInvoices = invoices.filter(i => inWindow(i.createdAt))
  const windowOrders = orders.filter(w => inWindow(w.createdAt))
  const billed = windowInvoices.reduce((s, i) => s + i.labor + i.parts, 0)
  const finished = windowOrders.filter(w => DONE.includes(w.status)).length
  const inProgress = orders.filter(w => !CLOSED.includes(w.status)).length
  const owed = invoices.filter(i => OWED.includes(i.status)).reduce((s, i) => s + i.total, 0)

  const kpis: Kpi[] = [
    {
      key: 'billed', label: translatePortalText('Work billed'), icon: Receipt,
      value: <Counter value={billed} currency={BASE_CURRENCY} compact={toDisplayMoney(billed) >= 1_000_000} />,
      caption: translatePortalText('Labour and parts invoiced'),
    },
    {
      key: 'finished', label: translatePortalText('Jobs finished'), icon: CheckCircle2,
      value: <Counter value={finished} />,
      caption: translatePortalText('Opened in this period'),
    },
    {
      key: 'progress', label: translatePortalText('Jobs in progress'), icon: Wrench,
      value: <Counter value={inProgress} />,
      caption: translatePortalText('Right now'),
    },
    {
      key: 'owed', label: translatePortalText('Waiting to be paid'), icon: AlertCircle,
      value: <Counter value={owed} currency={BASE_CURRENCY} compact={toDisplayMoney(owed) >= 1_000_000} />,
      caption: translatePortalText('Invoices not yet paid'),
    },
  ]

  // ── charts ────────────────────────────────────────────
  const monthly = React.useMemo(() => {
    const spans = Array.from({ length: months }, (_, k) => new Date(since.getFullYear(), since.getMonth() + k, 1))
    const multiYear = spans[0].getFullYear() !== spans[spans.length - 1].getFullYear()
    const bucket = (iso: string) => {
      const d = new Date(iso)
      return `${d.getFullYear()}-${d.getMonth()}`
    }
    return spans.map(sp => {
      const key = `${sp.getFullYear()}-${sp.getMonth()}`
      const inv = invoices.filter(i => i.createdAt && bucket(i.createdAt) === key)
      const wo = orders.filter(w => w.createdAt && bucket(w.createdAt) === key)
      return {
        x: formatPortalDate(sp, multiYear ? { month: 'short', year: '2-digit' } : { month: 'short' }),
        xFull: formatPortalDate(sp, { month: 'long', year: 'numeric' }),
        labour: toDisplayMoney(inv.reduce((s, i) => s + i.labor, 0)),
        parts: toDisplayMoney(inv.reduce((s, i) => s + i.parts, 0)),
        // Settlement-currency figures, for the CSV: a download is reconciled, so it
        // must not follow the display switch the charts do.
        labourSar: inv.reduce((s, i) => s + i.labor, 0),
        partsSar: inv.reduce((s, i) => s + i.parts, 0),
        opened: wo.length,
        completed: wo.filter(w => DONE.includes(w.status)).length,
      } as TrendRow
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, orders, since, months, currency])

  const byTechnician = techs
    .map(t => ({
      name: t.name,
      jobs: windowOrders.filter(w => w.technician && (w.technician.id === t.id || (w.technician as any)._id === (t as any)._id) && DONE.includes(w.status)).length,
    }))
    .filter(t => t.jobs > 0)

  const byService = (() => {
    const counts: Record<string, number> = {}
    for (const w of windowOrders) counts[w.category] = (counts[w.category] || 0) + 1
    return Object.entries(counts).map(([key, jobs]) => ({ name: translatePortalText(catByKey(key).name), jobs }))
  })()

  const tabs = insightTabs([
    {
      key: 'revenue',
      label: 'Revenue',
      title: translatePortalText('Work billed by month'),
      sub: translatePortalText('Labour and parts on invoices'),
      empty: monthly.every(m => !m.labour && !m.parts) ? translatePortalText('No invoices in this period yet.') : undefined,
      legend: [
        { label: translatePortalText('Labour'), color: 'c1', shape: 'rect' },
        { label: translatePortalText('Parts'), color: 'c2', shape: 'rect' },
      ],
      table: {
        columns: [translatePortalText('Month'), translatePortalText('Labour'), translatePortalText('Parts')],
        rows: monthly.map(m => [String(m.xFull), formatValue(Number(m.labour), 'money'), formatValue(Number(m.parts), 'money')]),
      },
      render: () => (
        <ColumnChart
          data={monthly}
          stacked
          kind="money"
          xInterval={0}
          series={[
            { key: 'labour', label: translatePortalText('Labour'), color: 'c1' },
            { key: 'parts', label: translatePortalText('Parts'), color: 'c2' },
          ]}
        />
      ),
    },
    {
      key: 'jobs',
      label: 'Jobs',
      title: translatePortalText('Jobs opened and finished'),
      sub: translatePortalText('By the month each job was opened'),
      empty: monthly.every(m => !m.opened) ? translatePortalText('No jobs in this period yet.') : undefined,
      legend: [
        { label: translatePortalText('Opened'), color: 'c2', shape: 'line' },
        { label: translatePortalText('Finished'), color: 'c1', shape: 'line' },
      ],
      table: {
        columns: [translatePortalText('Month'), translatePortalText('Opened'), translatePortalText('Finished')],
        rows: monthly.map(m => [String(m.xFull), formatPortalNumber(Number(m.opened)), formatPortalNumber(Number(m.completed))]),
      },
      render: () => (
        <TrendChart
          data={monthly}
          kind="count"
          series={[
            { key: 'opened', label: translatePortalText('Opened'), color: 'c2' },
            { key: 'completed', label: translatePortalText('Finished'), color: 'c1' },
          ]}
        />
      ),
    },
    {
      key: 'technicians',
      label: 'Technicians',
      title: translatePortalText('Jobs finished by each technician'),
      sub: translatePortalText('Jobs opened in this period'),
      empty: byTechnician.length === 0 ? translatePortalText('No finished jobs assigned to a technician yet.') : undefined,
      table: {
        columns: [translatePortalText('Technician'), translatePortalText('Jobs')],
        rows: byTechnician.map(t => [t.name, formatPortalNumber(t.jobs)]),
      },
      render: () => <BarList kind="count" items={byTechnician.map(t => ({ label: t.name, value: t.jobs }))} />,
    },
    {
      key: 'services',
      label: 'By service',
      title: translatePortalText('What the work was'),
      sub: translatePortalText('Jobs opened in this period, by type of service'),
      empty: byService.length === 0 ? translatePortalText('No work orders in this period yet.') : undefined,
      table: {
        columns: [translatePortalText('Service'), translatePortalText('Jobs')],
        rows: byService.map(s => [s.name, formatPortalNumber(s.jobs)]),
      },
      render: () => <BarList kind="count" items={byService.map(s => ({ label: s.name, value: s.jobs }))} />,
    },
  ])

  const exportCsv = () => {
    download(
      `maintenance-overview-${period}.csv`,
      '\uFEFF' + toCSV(monthly.map(m => ({
        [translatePortalText('Month')]: m.xFull,
        [`${translatePortalText('Labour')} (${BASE_CURRENCY})`]: m.labourSar,
        [`${translatePortalText('Parts')} (${BASE_CURRENCY})`]: m.partsSar,
        [translatePortalText('Jobs opened')]: m.opened,
        [translatePortalText('Jobs finished')]: m.completed,
      }))),
      'text/csv;charset=utf-8',
    )
    toast(translatePortalText('Overview exported'))
  }

  return (
    <SnapshotCard
      tone="violet"
      title={translatePortalText('At a glance')}
      subtitle={translatePortalText('How your workshop is doing, over the period you choose.')}
      periods={PERIODS}
      period={period}
      onPeriod={setPeriod}
      kpis={kpis}
      tabs={tabs}
      loading={loading}
      hasData={loaded && !error}
      error={error}
      onRetry={() => setAttempt(n => n + 1)}
      actions={
        <button
          type="button"
          onClick={exportCsv}
          disabled={loading || !!error}
          title={translatePortalText('Download the monthly figures as a CSV file')}
          className="btn-ghost !px-3 !py-1.5 disabled:opacity-50"
        >
          <Download size={14} /> {translatePortalText('CSV')}
        </button>
      }
    />
  )
}
