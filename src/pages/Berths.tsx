import React, { useMemo, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Anchor, Plus, Pencil, Trash2, Droplets, Zap, Wifi, Camera, AlertTriangle } from 'lucide-react'
import { PageHeader, Badge, Modal, toast, SearchInput, ViewToggle, AsyncBlock, EmptyState } from '../ui'
import { TablePagination, useTableFilters, type TableFiltersConfig } from '../shared/TableFilters'
import { confirmAndRun } from '../async'
import { useAsync, useMarina, berthLabel, fmtDate, formatMoney, humanize } from '../live'
import { useOps } from '../opsStore'
import { marinaApi, portalApi, type ApiBerthMapEntry, type SlotCategory, type SlotStatus, type DockPlan } from '../api'
import { useLimitAwareAction, usePackageUsage, UsageMeter } from '../shared/packageLimit'
import BerthModal from '../components/BerthModal'
import DockModal from '../components/DockModal'
import { canonicalField, formatPortalNumber, translatePortalText } from '../i18n/runtime'


// The five berth states, in the operator's language.
const STATUSES: { value: SlotStatus; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'booked', label: 'Occupied' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'blocked', label: 'Blocked' },
]
const CATEGORIES: SlotCategory[] = ['standard', 'premium', 'superyacht', 'catamaran', 'day_dock']
const POWER = ['16A', '32A', '63A', '3-phase 125A']

/** "A-01" — how the crew writes a berth. */
const code = (b: ApiBerthMapEntry) => `${b.pontoon}-${String(b.number).padStart(2, '0')}`

export default function Berths() {
  const location = useLocation()
  const { currency } = useMarina()
  const { reloadOverview } = useOps()
  const state = useAsync(() => portalApi.berthMap().then(r => r.data), [])
  // Loaded here rather than only inside the Dock Plans tab, because the
  // "berths aren't bookable yet" warning has to be visible on the Berths tab —
  // that's where an operator lands after creating their inventory.
  const plansState = useAsync(() => marinaApi.dockPlans.mine().then(r => r.data), [])
  const planCount = (plansState.data?.plans ?? []).filter(p => p.isActive).length

  const [q, setQ] = useState('')
  const [dock, setDock] = useState('All')
  const [status, setStatus] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [managingDocks, setManagingDocks] = useState(false)
  const [addingDock, setAddingDock] = useState(false)
  const [edit, setEdit] = useState<ApiBerthMapEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const [view, setView] = useState<'card' | 'table'>('table')
  const [tab, setTab] = useState<'berths' | 'plans'>('berths')
  const [busy, setBusy] = useState(false)
  const createSlot = useLimitAwareAction(marinaApi.createSlot)
  const usage = usePackageUsage()

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash === 'docks' || hash === 'add-dock') {
      setAddingDock(true)
    } else if (hash === 'add-berth' || hash === 'berths' || hash === 'pricing') {
      setAdding(true)
    } else if (hash === 'plans' || hash === 'dock-plans' || hash === 'dock_plans' || hash === 'add-plan') {
      setTab('plans')
    }
  }, [location.hash])

  const berths = state.data?.berths ?? []
  const pontoons = state.data?.pontoons ?? []
  const docks = useMemo(() => {
    const list = new Set<string>()
    pontoons.forEach(p => { if (p.code) list.add(p.code) })
    berths.forEach(b => { if (b.pontoon) list.add(b.pontoon) })
    return Array.from(list).filter(Boolean).sort()
  }, [berths, pontoons])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return berths.filter(b =>
      (dock === 'All' || b.pontoon === dock) && (status === 'All' || b.status === status) &&
      (categoryFilter === 'All' || b.category === categoryFilter) &&
      (code(b).toLowerCase().includes(term) || b.category.toLowerCase().includes(term) || (b.reservation?.boatName ?? '').toLowerCase().includes(term))
    )
  }, [berths, q, dock, status, categoryFilter])

  const berthCfg: TableFiltersConfig<ApiBerthMapEntry> = useMemo(() => ({
    searchFields: (b) => [code(b), b.category, b.pontoon, b.reservation?.boatName, b.workOrder?.title],
  }), [])
  const berthTf = useTableFilters(rows, berthCfg)

  const refresh = async () => { await state.reload(); await reloadOverview() }

  const openEdit = (b: ApiBerthMapEntry) => {
    setEdit(b)
    setAdding(false)
  }

  const openAdd = () => {
    setEdit(null)
    setAdding(true)
  }

  const setBerthStatus = async (b: ApiBerthMapEntry, next: SlotStatus) => {
    try {
      await marinaApi.setSlotStatus(b.id, next)
      toast(`${code(b)} → ${translatePortalText(STATUSES.find(s => s.value === next)?.label ?? next)}`)
      await refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not change the berth status'), 'warn')
    }
  }

  // The whole §14 flow in one call: confirm → the dialog's own button spins
  // through the delete *and* the refetch → success/failure toast. The refresh is
  // inside `run` on purpose, so "Deleting…" persists until the list actually
  // reflects the deletion rather than ending on a stale grid.
  const remove = (b: ApiBerthMapEntry) =>
    confirmAndRun({
      title: `Delete berth ${code(b)}?`,
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting…',
      danger: true,
      run: async () => {
        await marinaApi.deleteSlot(b.id)
        setSelected(s => { const n = new Set(s); n.delete(b.id); return n })
        await refresh()
      },
      success: translatePortalText(`Berth ${code(b)} deleted successfully`),
      error: translatePortalText('Could not delete the berth. Please try again.'),
    })

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const toggleSelectAll = () => {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map(r => r.id)))
    }
  }

  const bulkDelete = () => {
    const ids = Array.from(selected)
    return confirmAndRun({
      title: `Delete ${formatPortalNumber(ids.length)} ${ids.length === 1 ? 'berth' : 'berths'}?`,
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      busyLabel: `Deleting ${formatPortalNumber(ids.length)}…`,
      danger: true,
      run: async () => {
        setBusy(true)
        try {
          // `allSettled`, not `all`: with `all` a single failure rejects the whole
          // batch and the operator is told nothing was deleted when most of it
          // was. §25 wants the real tally.
          const results = await Promise.allSettled(ids.map(id => marinaApi.deleteSlot(id)))
          const failed = results.filter(r => r.status === 'rejected').length
          setSelected(new Set())
          await refresh()
          return { total: ids.length, failed }
        } finally {
          setBusy(false)
        }
      },
      success: ({ total, failed }) =>
        failed === 0
          ? translatePortalText(`${total} ${total === 1 ? 'berth' : 'berths'} deleted successfully`)
          : translatePortalText(`${total - failed} of ${total} deleted · ${failed} failed`),
      error: translatePortalText('Could not delete the selected berths. Please try again.'),
    })
  }

  const removeDock = (dockCode: string) => {
    const pontoon = pontoons.find(p => p.code === dockCode)
    const berthsInDock = berths.filter(b => b.pontoon === dockCode)
    const count = berthsInDock.length

    return confirmAndRun({
      title: `Delete Dock ${dockCode}?`,
      // The berth count belongs in the body, where the operator can weigh it,
      // rather than buried in a one-line native alert.
      body:
        count > 0
          ? `This will also delete all ${count} ${count === 1 ? 'berth' : 'berths'} inside it. This cannot be undone.`
          : 'This cannot be undone.',
      confirmLabel: 'Delete dock',
      busyLabel: 'Deleting…',
      danger: true,
      run: async () => {
        setBusy(true)
        try {
          if (pontoon) {
            await marinaApi.deletePontoon(pontoon.id ?? (pontoon as any)._id)
          } else {
            await Promise.all(berthsInDock.map(b => marinaApi.deleteSlot(b.id)))
          }
          if (dock === dockCode) setDock('All')
          await refresh()
        } finally {
          setBusy(false)
        }
      },
      success: translatePortalText(`Dock ${dockCode} deleted successfully`),
      error: translatePortalText('Could not delete the dock. Please try again.'),
    })
  }

  const F = (label: string, node: React.ReactNode) => <div><label className="label">{label}</label>{node}</div>

  return (
    <div>
      <PageHeader title={translatePortalText("Berth Management")} icon={<Anchor className="text-ocean-500" />}
        sub={`${formatPortalNumber(berths.length)} slips across ${formatPortalNumber(docks.length)} dock${docks.length === 1 ? '' : 's'} · pricing, specs, connections & availability`}
        actions={<>
          <ViewToggle view={view} onChange={setView} />
          <button className="btn-secondary flex items-center gap-1.5" onClick={() => setAddingDock(true)}><Anchor size={15} /> {translatePortalText("Add dock")}</button>
          <button className="btn-secondary" onClick={() => setManagingDocks(true)}>{translatePortalText("Manage docks")}</button>
          <button className="btn-primary" onClick={openAdd}><Plus size={16} /> {translatePortalText("Add berth")}</button>
        </>} />

      <div className="mb-4 flex gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft w-fit">
        {(['berths', 'plans'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-[13px] font-bold transition ${tab === t ? 'bg-deep-900 text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {translatePortalText(t === 'berths' ? 'Berths' : 'Dock Plans')}
            {/* Berths alone are not bookable — a boater also has to pick a
                rental duration, and those live under Dock Plans. Flag the gap
                here so it isn't discovered by a customer hitting a dead end. */}
            {t === 'plans' && planCount === 0 && berths.length > 0 && (
              <span className="ms-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
            )}
          </button>
        ))}
      </div>

      {tab === 'berths' && planCount === 0 && berths.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-[13px] leading-relaxed text-amber-800">
            <b>{translatePortalText("Your berths cannot be booked yet.")}</b> {translatePortalText("Boat owners choose a rental duration\n            (for example “Monthly — 30 days”) before they can pay, and you have not published\n            any.")}{' '}
            <button onClick={() => setTab('plans')} className="font-bold underline underline-offset-2">
              {translatePortalText("Add a dock plan\n            ")}</button>{' '}
            {translatePortalText("to open your marina for reservations. Plans carry no price of their own — the cost is\n            always this berth’s monthly rate ÷ 30 × the plan’s days.\n          ")}</div>
        </div>
      )}

      {tab === 'plans' ? <DockPlansPanel onChanged={plansState.reload} /> : <>

        {usage.usage.some((u) => u.key === 'maxBerths') && (
          <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-4">
            {usage.usage.filter((u) => u.key === 'maxBerths').map((u) => <UsageMeter key={u.key} item={u} />)}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search berth or category…")} />
          {['All', ...docks].map(d => (
            <button key={d} onClick={() => setDock(d)} className={`chip transition ${dock === d ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>{d === 'All' ? translatePortalText('All docks') : `${translatePortalText('Dock ')}${d}`}</button>
          ))}
          {dock !== 'All' && (
            <button
              onClick={() => removeDock(dock)}
              disabled={busy}
              className="chip bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100 font-semibold flex items-center gap-1 transition"
              title={translatePortalText(`Delete Dock ${dock} and all its berths`)}
            >
              <Trash2 size={13} /> {translatePortalText("Delete Dock ")}{dock}
            </button>
          )}
          <select value={status} onChange={e => setStatus(e.target.value)} className="input !w-auto !py-2 text-xs font-semibold">
            <option value="All">{translatePortalText("All statuses")}</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{translatePortalText(s.label)}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input !w-auto !py-2 text-xs font-semibold">
            <option value="All">{translatePortalText("All categories")}</option>{CATEGORIES.map(c => <option key={c} value={c}>{translatePortalText(humanize(c))}</option>)}
          </select>
          <span className="ms-auto text-xs font-semibold text-slate-400">{formatPortalNumber(rows.length)} {translatePortalText("shown")}</span>
        </div>

        {selected.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-4 flex items-center gap-4 rounded-xl bg-deep-900 px-4 py-3 text-white shadow-lg">
            <span className="text-sm font-bold">{selected.size} {translatePortalText("selected")}</span>
            <div className="h-4 w-px bg-white/20" />
            <button className="text-sm font-semibold text-rose-400 hover:text-rose-300 flex items-center gap-1.5" onClick={bulkDelete} disabled={busy}>
              <Trash2 size={16} /> {busy ? translatePortalText('Deleting...') : translatePortalText('Delete selected')}
            </button>
            <button className="ms-auto text-xs font-semibold text-slate-400 hover:text-white" onClick={() => setSelected(new Set())}>{translatePortalText("Cancel")}</button>
          </motion.div>
        )}

        <AsyncBlock state={state} loadingLabel={translatePortalText('Loading berth inventory…')}
          empty={d => d.berths.length === 0 ? { icon: '🅿️', text: translatePortalText('No berths yet — use “Add berth” to lay out your first dock.') } : null}>
          {() => rows.length === 0 ? (
            <div className="card"><EmptyState icon="🔍" text={translatePortalText('No berths match those filters')} /></div>
          ) : view === 'card' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {berthTf.pagedRows.map((b, i) => {
                const boat = b.reservation
                return (
                  <motion.div key={b.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
                    className="card card-hover group relative overflow-hidden p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <input type="checkbox" className="mt-1 rounded border-slate-300 text-ocean-500 focus:ring-ocean-500 cursor-pointer"
                          checked={selected.has(b.id)}
                          onChange={() => toggleSelect(b.id)} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-display text-lg font-extrabold text-deep-900">{code(b)}</h3>
                            {b.images && b.images.length > 0 && (
                              <span className="flex items-center gap-0.5 rounded-full bg-ocean-50 px-1.5 py-0.5 text-[10px] font-bold text-ocean-600 ring-1 ring-ocean-200" title={translatePortalText(`${b.images.length} photo(s)`)}>
                                <Camera size={10} /> {formatPortalNumber(b.images.length)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">{translatePortalText(humanize(b.category))} {translatePortalText("· Dock ")}{b.pontoon}</p>
                        </div>
                      </div>
                      <Badge dot={b.status === 'booked'}>{translatePortalText(STATUSES.find(s => s.value === b.status)?.label ?? b.status)}</Badge>
                    </div>
                    {boat && <p className="mt-2 truncate rounded-xl bg-ocean-50 px-3 py-1.5 text-xs font-bold text-ocean-700">⛵ {boat.boatName} {translatePortalText("docked")}</p>}
                    {!boat && b.workOrder && <p className="mt-2 truncate rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">🔧 {b.workOrder.title}</p>}
                    <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                      {[['LOA', b.maxLength], ['Beam', b.maxWidth], ['Draft', b.maxDepth]].map(([l, v]) => (
                        <div key={l as string} className="rounded-lg bg-sand py-1.5"><p className="font-extrabold text-deep-900">{v != null ? `${v} m` : '—'}</p><p className="text-slate-400">{l}</p></div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-slate-400">
                      <span title={translatePortalText("Water")} className={b.hasWater ? 'text-ocean-500' : 'opacity-25'}><Droplets size={15} /></span>
                      <span title={`${translatePortalText('Power')} ${b.powerSupply ?? translatePortalText('not set')}`} className="text-amber-500 flex items-center gap-0.5 text-[10px] font-bold"><Zap size={15} />{b.powerSupply ?? '—'}</span>
                      <span title={translatePortalText("Wi-Fi")} className={b.hasWifi ? 'text-emerald-500' : 'opacity-25'}><Wifi size={15} /></span>
                      <span className="ms-auto text-right">
                        {b.monthlyPrice != null && b.monthlyPrice > 0 ? (<>
                          <b className="font-display text-base font-extrabold text-deep-900">{formatMoney(b.monthlyPrice, currency)}</b>
                          <span className="text-[10px]">{translatePortalText("/mo")}</span>
                        </>) : (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200"
                            title={translatePortalText("Boaters cannot book this berth until you set a monthly rate.")}>
                            <AlertTriangle size={10} /> {translatePortalText("No rate set\n                          ")}</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                      <select value={b.status} onChange={e => setBerthStatus(b, e.target.value as SlotStatus)}
                        className="input !w-auto flex-1 !py-1.5 text-xs font-semibold">
                        {STATUSES.map(s => <option key={s.value} value={s.value}>{translatePortalText(s.label)}</option>)}
                      </select>
                      <button className="btn-ghost !p-2" title={translatePortalText("Edit")} onClick={() => openEdit(b)}><Pencil size={14} /></button>
                      <button className="btn-ghost !p-2 hover:!bg-rose-50 hover:!border-rose-200 hover:text-rose-500" title={translatePortalText("Delete")} onClick={() => remove(b)}><Trash2 size={14} /></button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
            <TablePagination state={berthTf} noun={translatePortalText('berths')} />
          </div>
        ) : (
            <div className="card overflow-hidden !p-0">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[960px]">
                  <thead><tr className="border-b border-slate-100 bg-sand/50">
                    <th className="th w-10">
                      <input type="checkbox" className="rounded border-slate-300 text-ocean-500 focus:ring-ocean-500 cursor-pointer"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={toggleSelectAll} />
                    </th>
                    <th className="th">{translatePortalText("Berth")}</th><th className="th">{translatePortalText("Boat docked")}</th><th className="th">{translatePortalText("Specs (LOA/beam/draft)")}</th><th className="th">{translatePortalText("Connections")}</th><th className="th text-right">{translatePortalText("Monthly rate")}</th><th className="th">{translatePortalText("Status")}</th><th className="th text-right">{translatePortalText("Actions")}</th>
                  </tr></thead>
                  <tbody>
                    {berthTf.pagedRows.map((b, i) => {
                      const boat = b.reservation
                      return (
                        <motion.tr key={b.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
                          className={`border-b transition ${selected.has(b.id) ? 'bg-ocean-50/50 border-ocean-100' : 'border-slate-50 hover:bg-sand/60'}`}>
                          <td className="td">
                            <input type="checkbox" className="rounded border-slate-300 text-ocean-500 focus:ring-ocean-500 cursor-pointer"
                              checked={selected.has(b.id)}
                              onChange={() => toggleSelect(b.id)} />
                          </td>
                          <td className="td">
                            <div className="flex items-center gap-1.5">
                              <p className="font-display font-extrabold text-deep-900">{code(b)}</p>
                              {b.images && b.images.length > 0 && (
                                <span className="flex items-center gap-0.5 rounded-full bg-ocean-50 px-1.5 py-0.5 text-[10px] font-bold text-ocean-600 ring-1 ring-ocean-200" title={translatePortalText(`${b.images.length} photo(s)`)}>
                                  <Camera size={10} /> {formatPortalNumber(b.images.length)}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400">{translatePortalText(humanize(b.category))} {translatePortalText("· Dock ")}{b.pontoon}</p>
                          </td>
                          <td className="td text-xs text-slate-500">
                            {boat ? <>⛵ {boat.boatName}<p className="text-[11px] text-slate-400">{translatePortalText("until ")}{fmtDate(boat.endDate)}</p></> : b.workOrder ? <span className="text-amber-600">🔧 {b.workOrder.title}</span> : '—'}
                          </td>
                          <td className="td whitespace-nowrap text-xs text-slate-500">
                            {[b.maxLength, b.maxWidth, b.maxDepth].map(v => (v != null ? `${v}m` : '—')).join(' / ')}
                          </td>
                          <td className="td">
                            <span className="flex items-center gap-2 text-slate-400">
                              <span title={translatePortalText("Water")} className={b.hasWater ? 'text-ocean-500' : 'opacity-25'}><Droplets size={15} /></span>
                          <span title={`${translatePortalText('Power')} ${b.powerSupply ?? translatePortalText('not set')}`} className="flex items-center gap-0.5 text-[10px] font-bold text-amber-500"><Zap size={15} />{b.powerSupply ?? '—'}</span>
                              <span title={translatePortalText("Wi-Fi")} className={b.hasWifi ? 'text-emerald-500' : 'opacity-25'}><Wifi size={15} /></span>
                            </span>
                          </td>
                          <td className="td text-right">
                            {b.monthlyPrice != null && b.monthlyPrice > 0 ? (
                              <b className="font-display font-extrabold text-deep-900">{formatMoney(b.monthlyPrice, currency)}</b>
                            ) : (
                              // An unpriced berth is silently unbookable — boaters
                              // get "no rate set" at the payment step — so say so here.
                              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200"
                                title={translatePortalText("Boaters cannot book this berth until you set a monthly rate.")}>
                                <AlertTriangle size={11} /> {translatePortalText("No rate set\n                              ")}</span>
                            )}
                          </td>
                          <td className="td">
                            <select value={b.status} onChange={e => setBerthStatus(b, e.target.value as SlotStatus)}
                              className="input !w-auto !py-1.5 text-xs font-semibold">
                              {STATUSES.map(s => <option key={s.value} value={s.value}>{translatePortalText(s.label)}</option>)}
                            </select>
                          </td>
                          <td className="td">
                            <div className="flex justify-end gap-1.5">
                              <button className="btn-ghost !p-2" title={translatePortalText("Edit")} onClick={() => openEdit(b)}><Pencil size={14} /></button>
                              <button className="btn-ghost !p-2 hover:!bg-rose-50 hover:!border-rose-200 hover:text-rose-500" title={translatePortalText("Delete")} onClick={() => remove(b)}><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination state={berthTf} noun={translatePortalText('berths')} />
            </div>
          )}
        </AsyncBlock>

        <BerthModal
          open={!!edit || adding}
          onClose={() => { setEdit(null); setAdding(false) }}
          berth={edit}
          pontoons={pontoons}
          docks={docks}
          onSaved={refresh}
        />

        <Modal open={managingDocks} onClose={() => setManagingDocks(false)} title={translatePortalText("⚓ Manage Docks")}>
          <div className="space-y-4">
            <button
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 shadow-sm"
              onClick={() => { setManagingDocks(false); setAddingDock(true) }}
            >
              <Plus size={16} /> {translatePortalText("Add New Dock / Pontoon\n            ")}</button>

            <p className="text-xs text-slate-500">
              {translatePortalText("Deleting a dock will permanently delete the dock and all berths assigned to it.\n            ")}</p>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white max-h-[50vh] overflow-y-auto">
              {docks.length === 0 ? (
                <p className="p-4 text-center text-xs text-slate-400">{translatePortalText("No docks available.")}</p>
              ) : (
                docks.map(d => {
                  const count = berths.filter(b => b.pontoon === d).length
                  return (
                    <div key={d} className="flex items-center justify-between p-3.5">
                      <div>
                        <h4 className="font-bold text-deep-900 text-sm">{translatePortalText("Dock ")}{d}</h4>
                        <p className="text-xs text-slate-400">{translatePortalText(`${count} berth${count === 1 ? '' : 's'}`)}</p>
                      </div>
                      <button
                        className="btn-ghost text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:border-rose-200 flex items-center gap-1.5 px-3 py-1.5"
                        onClick={() => removeDock(d)}
                        disabled={busy}
                      >
                        <Trash2 size={14} /> {translatePortalText("Delete dock\n                      ")}</button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button className="btn-ghost" onClick={() => setManagingDocks(false)}>{translatePortalText("Close")}</button>
          </div>
        </Modal>

        <DockModal
          open={addingDock}
          onClose={() => setAddingDock(false)}
          pontoons={pontoons}
          docks={docks}
          onSaved={refresh}
        />

        {createSlot.modal}
      </>}
    </div>
  )
}

/**
 * The plans a boat owner picks from in their own app. No price is ever typed
 * in here — it's always the berth's own monthly rate ÷ 30 × days, computed at
 * booking time, so a plan can never disagree with the dock's real tariff.
 */
function DockPlansPanel({ onChanged }: { onChanged?: () => void }) {
  const location = useLocation()
  const state = useAsync(() => marinaApi.dockPlans.mine().then(r => r.data), [])
  // Keep the parent's "no plans yet" warning in step with edits made here.
  const reload = async () => { await state.reload(); onChanged?.() }
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DockPlan | null>(null)
  const [form, setForm] = useState<{ name: string; days: number; isActive: boolean }>({ name: '', days: 30, isActive: true })

  const openCreate = () => { setEditing(null); setForm({ name: '', days: 30, isActive: true }); setModalOpen(true) }
  const openEdit = (p: DockPlan) => { setEditing(p); setForm({ name: canonicalField<string>(p, 'name') ?? p.name, days: p.days, isActive: p.isActive }); setModalOpen(true) }

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash === 'dock-plans' || hash === 'dock_plans' || hash === 'add-plan') {
      openCreate()
    }
  }, [location.hash])

  const save = async () => {
    if (!form.name.trim() || !form.days || form.days < 1) { toast(translatePortalText('Give the plan a name and a duration in days'), 'warn'); return }
    try {
      if (editing) await marinaApi.dockPlans.update(editing.id, form)
      else await marinaApi.dockPlans.create(form)
      await reload()
      setModalOpen(false)
      toast(translatePortalText(editing ? 'Plan updated' : 'Plan created'))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save the plan'), 'warn')
    }
  }

  const remove = (p: DockPlan) =>
    confirmAndRun({
      title: `Delete plan “${p.name}”?`,
      body: 'Boat owners will no longer see it when booking a berth.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting…',
      danger: true,
      run: async () => {
        await marinaApi.dockPlans.delete(p.id)
        await reload()
      },
      success: translatePortalText(`Plan “${p.name}” deleted successfully`),
      error: translatePortalText('Could not delete the plan. Please try again.'),
    })

  const toggleActive = async (p: DockPlan) => {
    try {
      await marinaApi.dockPlans.update(p.id, { isActive: !p.isActive })
      await reload()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the plan'), 'warn')
    }
  }

  return (
    <div id="dock-plans" className="transition-all duration-500">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="max-w-xl text-sm text-slate-500">
          {translatePortalText("Boat owners pick one of these plans in their own app. Price is never entered here — it's always the berth's monthly rate ÷ 30 × days, so it can never drift from the dock's real tariff.\n        ")}</p>
        <button id="add-plan" className="btn-primary shrink-0" onClick={openCreate}><Plus size={16} /> {translatePortalText("Add plan")}</button>
      </div>
      <AsyncBlock state={state} loadingLabel={translatePortalText('Loading dock plans…')}
        empty={d => d.plans.length === 0 ? { icon: '📋', text: translatePortalText('No plans yet — add one so boat owners have something to pick.') } : null}>
        {(d) => (
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[650px]">
                <thead><tr className="border-b border-slate-100 bg-sand/50">
                  <th className="th">{translatePortalText("Plan")}</th><th className="th">{translatePortalText("Duration")}</th><th className="th">{translatePortalText("Visibility")}</th><th className="th text-right">{translatePortalText("Actions")}</th>
                </tr></thead>
                <tbody>
                  {d.plans.map(p => (
                    <tr key={p.id} className="border-b border-slate-50">
                      <td className="td font-semibold text-deep-900">{p.name}</td>
                      <td className="td text-slate-500">{translatePortalText(`${p.days} ${p.days === 1 ? 'day' : 'days'}`)}{p.days % 30 === 0 ? ` (${translatePortalText(`${p.days / 30} ${p.days / 30 === 1 ? 'month' : 'months'}`)})` : ''}</td>
                      <td className="td">
                        <button onClick={() => toggleActive(p)} className={`chip ${p.isActive ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-400 ring-1 ring-slate-200'}`}>
                          {translatePortalText(p.isActive ? 'Visible to boat owners' : 'Hidden')}
                        </button>
                      </td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-1.5">
                          <button className="btn-ghost !p-2" title={translatePortalText("Edit")} onClick={() => openEdit(p)}><Pencil size={14} /></button>
                          <button className="btn-ghost !p-2 hover:!bg-rose-50 hover:!border-rose-200 hover:text-rose-500" title={translatePortalText("Delete")} onClick={() => remove(p)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </AsyncBlock>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? translatePortalText(`✏️ Edit ${editing.name}`) : translatePortalText("➕ Add dock plan")}>
        <div className="grid gap-4">
          <div><label className="label">{translatePortalText("Plan name")}</label><input id="plan_name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={translatePortalText("e.g. Monthly, 20-Day Flex")} /></div>
          <div><label className="label">{translatePortalText("Duration (days)")}</label><input type="number" min={1} className="input" value={form.days} onChange={e => setForm(f => ({ ...f, days: Math.max(1, Number(e.target.value)) }))} /></div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-500"><input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} /> {translatePortalText("Visible to boat owners")}</label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setModalOpen(false)}>{translatePortalText("Cancel")}</button>
          <button className="btn-primary" onClick={save}>{translatePortalText(editing ? 'Save changes' : 'Create plan')}</button>
        </div>
      </Modal>
    </div>
  )
}
