import React from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, SearchX } from 'lucide-react'
import { reportApi, type ReportCatalogEntry, type ReportPortal } from '../../api/platform'
import { errorMessage } from '../../async/errors'
import { useAuth } from '../../auth'
import { translatePortalText } from '../../i18n/runtime'
import { ReportFinder } from './ReportFinder'
import { ReportView, type PeriodState } from './ReportView'
import { ErrorNotice } from './snapshot'
import { DEFAULT_PERIOD, buildFinderItems, finderItemsFor, resolvePeriod, type Tone } from './reportMeta'
import './reports.css'

/**
 * A report that is not one of the server's, shown in the same shell.
 *
 * The admin console has one — the Excel revenue workbook — that predates the report
 * registry and has its own screen and its own download. Registering it here gives it
 * a card in the finder and the same "← All reports" way back, instead of leaving it
 * as a separate tab beside the reports it is a sibling of.
 */
export type CustomReport =
  | { entry: ReportCatalogEntry; render: () => React.ReactNode }
  /**
   * A server report with a screen of its own. Listed through the server's own
   * catalog entry, so it appears only once the server offers it — a console ahead
   * of its backend shows no card rather than a card that opens onto an error.
   */
  | { serverKey: string; render: () => React.ReactNode }

const customKey = (c: CustomReport) => ('entry' in c ? c.entry.key : c.serverKey)

/**
 * The Reports Center: what every console's "Reports & Analytics" page is.
 *
 * Two screens on one route family. With no report key it is the *overview* — the
 * console's own headline figures (`snapshot`) above a finder for the report catalog.
 * With a key (`{basePath}/:reportKey`) it is that report, opened.
 *
 * The four consoles differ in what their overview counts, so each supplies its own
 * `header` and `snapshot`; the finder, the report screen, the period and the
 * downloads are the same code everywhere, which is what makes them behave the same
 * everywhere.
 */
export function ReportsCenter({
  portal, basePath, tone, header, snapshot, custom = [],
}: {
  portal: ReportPortal
  /** Where this center is mounted, e.g. `/admin/reports`. A report lives at `${basePath}/${key}`. */
  basePath: string
  tone: Tone
  header: React.ReactNode
  snapshot: React.ReactNode
  custom?: CustomReport[]
}) {
  const { reportKey } = useParams<{ reportKey?: string }>()
  const location = useLocation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [catalog, setCatalog] = React.useState<ReportCatalogEntry[] | null>(null)
  const [loadError, setLoadError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)

  // Held here rather than in the report so it survives moving between reports — a
  // reader comparing Revenue with Payouts for the same month should not have to set
  // the month twice.
  const [period, setPeriod] = React.useState<PeriodState>(() => ({
    key: DEFAULT_PERIOD,
    // The dates "Custom" opens with: the default window, which the reader then edits.
    custom: resolvePeriod('custom'),
  }))

  React.useEffect(() => {
    let alive = true
    setLoadError('')
    reportApi
      .catalog(portal)
      .then(res => { if (alive) setCatalog(res.data.reports) })
      .catch(e => {
        if (!alive) return
        setCatalog(null)
        setLoadError(errorMessage(e) || translatePortalText('Could not load the report list'))
      })
    return () => { alive = false }
  }, [portal, attempt])

  const all = React.useMemo(
    () => (catalog ? [...catalog, ...custom.flatMap(c => ('entry' in c ? [c.entry] : []))] : null),
    // `custom` is rebuilt by the caller on each render; its keys are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, custom.map(customKey).join(',')]
  )
  const items = React.useMemo(() => (all ? buildFinderItems(all) : []), [all])
  // The finder leaves out what this console hides; a hidden report still opens from
  // a link or a drill-through, which is why `items` keeps it.
  const finderItems = React.useMemo(() => finderItemsFor(items, portal), [items, portal])

  // ── A report ────────────────────────────────────────────
  if (reportKey) {
    const customReport = custom.find(c => customKey(c) === reportKey)
    const entry = all?.find(e => e.key === reportKey)
    const item = items.find(i => i.key === reportKey || i.family?.members.some(m => m.key === reportKey))

    return (
      <div className="rv" data-tone={tone}>
        {loadError ? (
          <ErrorNotice message={loadError} onRetry={() => setAttempt(n => n + 1)} />
        ) : !all ? (
          <div aria-busy className="animate-pulse space-y-4">
            <div className="h-5 w-40 rounded bg-slate-200" />
            <div className="h-9 w-72 rounded bg-slate-200" />
            <div className="card h-24 bg-slate-50" />
            <div className="card h-72 bg-slate-50" />
          </div>
        ) : !entry ? (
          <NotAvailable basePath={basePath} />
        ) : customReport ? (
          <div>
            <BackToReports basePath={basePath} />
            {customReport.render()}
          </div>
        ) : (
          <ReportView
            key={entry.key}
            entry={entry}
            item={item}
            catalog={all}
            basePath={basePath}
            tone={tone}
            isAdmin={isAdmin}
            period={period}
            onPeriod={setPeriod}
            initialFilters={(location.state as { filters?: Record<string, string> } | null)?.filters}
          />
        )}
      </div>
    )
  }

  // ── The overview ────────────────────────────────────────
  return (
    <div className="rv" data-tone={tone}>
      {/* Each console's header carries its own bottom margin, so the spacing
          between sections starts below it. */}
      {header}
      <div className="space-y-8">
        {snapshot}
        {loadError ? (
          <ErrorNotice message={loadError} onRetry={() => setAttempt(n => n + 1)} />
        ) : !all ? (
          <FinderSkeleton />
        ) : (
          <ReportFinder items={finderItems} portal={portal} tone={tone} basePath={basePath} />
        )}
      </div>
    </div>
  )
}

function BackToReports({ basePath }: { basePath: string }) {
  return (
    <nav aria-label={translatePortalText('Breadcrumb')} className="mb-3">
      <Link
        to={basePath}
        className="-ms-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-deep-900"
      >
        <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden />
        {translatePortalText('All reports')}
      </Link>
    </nav>
  )
}

/** A link or bookmark to a report this account cannot run — said plainly, not silently swapped for another. */
function NotAvailable({ basePath }: { basePath: string }) {
  return (
    <div>
      <BackToReports basePath={basePath} />
      <div className="card grid place-items-center px-4 py-16 text-center">
        <SearchX size={26} className="mb-2 text-slate-400" aria-hidden />
        <h1 className="font-display text-lg font-bold text-deep-900">{translatePortalText('That report is not available')}</h1>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          {translatePortalText('It may have been renamed, or your account may not have access to it. Pick one from the list instead.')}
        </p>
        <Link to={basePath} className="btn-ghost mt-4 !py-2">{translatePortalText('See all reports')}</Link>
      </div>
    </div>
  )
}

function FinderSkeleton() {
  return (
    <div aria-busy className="animate-pulse">
      <div className="mb-4 h-7 w-44 rounded bg-slate-200" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-[88px] rounded-2xl border border-slate-200 bg-slate-50" />)}
      </div>
    </div>
  )
}
