import React, { useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ShieldCheck, History, Ship, Plus, Download, FileCheck2, Award, Check } from 'lucide-react'
import { catByKey, money, MAINT_CATEGORIES } from '../maintData'
import { PageWrap, ChartTip } from './_shared'
import { Section, Modal, Counter, printDoc, download, toCSV, EmptyState } from '../../ui'
import { maintToast, MaintHeader, MBadge, HealthRing, MaintViewToggle } from '../maintUi'
import { useLimitAwareAction } from '../../shared/packageLimit'
import {
  maintenancePortalApi, type MaintenanceInspection, type MaintenanceWarranty,
  type MaintenanceServiceHistoryEntry, type BoatHealth, type ApiFleetAccount,
} from '../../api'
import { formatPortalDate, formatPortalNumber, formatPortalPercent, localizedField, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

type QCState = 'Pending' | 'Approved' | 'Rework'

/** "Jan 2026" — matches the compact coverage-window display the warranty
 * register used before it was backend-driven. */
const monthYear = (iso?: string) => formatPortalDate(iso, { month: 'short', year: 'numeric' })
const fullDate = (iso?: string) => formatPortalDate(iso, { month: 'short', day: 'numeric', year: 'numeric' })
const fleetContract = (account: ApiFleetAccount) => localizedField<string>(account, 'contract') ?? account.contract
const serviceHistoryParts = (entry: MaintenanceServiceHistoryEntry) =>
  (localizedField<string[]>(entry, 'partsUsed') as string[] | undefined) ?? entry.partsUsed ?? []
const fleetNextService = (account: ApiFleetAccount) => account.nextServiceAt
  ? formatPortalDate(account.nextServiceAt, { month: 'short', day: 'numeric' })
  : translatePortalText(account.nextService || 'None scheduled')

const WARRANTY_STATUS_LABEL: Record<MaintenanceWarranty['status'], string> = { active: 'Active', expiring: 'Expiring', expired: 'Expired', claimed: 'Claim open' }
const WARRANTY_KIND_LABEL: Record<MaintenanceWarranty['kind'], string> = { parts: 'Parts', service: 'Service' }

// The backend MAINTENANCE_CATEGORIES enum, with labels and icons — see
// MAINT_CATEGORIES in maintData.ts. Kept there rather than hand-listed per page:
// three separate copies of this list had drifted, each missing a different
// handful of categories the field can actually hold.
const MAINTENANCE_CATEGORY_KEYS = MAINT_CATEGORIES.map(c => c.key)
const categoryLabel = (key: string) => translatePortalText(catByKey(key).name)
const catIcon = (key: string) => catByKey(key)

// ══════════ QUALITY & WARRANTY (§17, §18) ══════════
export function MaintQuality() { return <QualityPage /> }
function QualityPage() {
  const [warranties, setWarranties] = useState<MaintenanceWarranty[]>([])
  const [inspections, setInspections] = useState<MaintenanceInspection[]>([])

  const inspCfg: TableFiltersConfig<MaintenanceInspection> = useMemo(() => ({
    searchFields: (ins) => [ins.boatName, ins.type, ins.technician?.name],
    filters: [
      { key: 'type', label: 'Inspection type', get: (ins) => ins.type },
      { key: 'status', label: 'Status', get: (ins) => ins.status },
      { key: 'boat', label: 'Boat', get: (ins) => ins.boatName },
      { key: 'tech', label: 'Technician', get: (ins) => ins.technician?.name },
    ],
  }), [])
  const inspTf = useTableFilters(inspections, inspCfg)

  /**
   * Warranties are filtered by what is about to lapse, for the same reason the
   * compliance table is: the register is consulted to catch expiries, not to
   * confirm that cover exists.
   */
  const warCfg: TableFiltersConfig<MaintenanceWarranty> = useMemo(() => ({
    searchFields: (w) => [w.boatName, w.item, w.vendor],
    filters: [
      { key: 'kind', label: 'Type', get: (w) => w.kind },
      { key: 'status', label: 'Status', get: (w) => w.status },
      { key: 'vendor', label: 'Vendor', get: (w) => w.vendor },
      {
        key: 'expiry',
        label: 'Coverage',
        options: [
          { value: 'lapsed', label: 'Already lapsed' },
          { value: 'soon', label: 'Lapses within 90 days' },
          { value: 'ok', label: 'More than 90 days left' },
        ],
        get: (w) => String(w.expiryDate ?? ''),
        match: (w, v) => {
          if (!w.expiryDate) return false
          const days = Math.ceil((new Date(w.expiryDate).getTime() - Date.now()) / 86400000)
          if (v === 'lapsed') return days < 0
          if (v === 'soon') return days >= 0 && days <= 90
          return days > 90
        },
      },
    ],
  }), [])
  const warTf = useTableFilters(warranties, warCfg)
  const [qc, setQc] = useState<Record<string, QCState>>({})
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimBusy, setClaimBusy] = useState(false)
  const [certFor, setCertFor] = useState<MaintenanceInspection | null>(null)

  const loadWarranties = () => {
    maintenancePortalApi.warranties()
      .then(res => setWarranties(res.data.warranties || []))
      .catch(() => maintToast('Could not load warranties', 'warn'))
  }

  useEffect(() => {
    maintenancePortalApi.inspections({ limit: 100 })
      .then(res => setInspections(res.data.items || []))
      .catch(err => maintToast('Could not load inspections', 'warn'))
    loadWarranties()
  }, [])

  const reworks = Object.values(qc).filter(v => v === 'Rework').length
  const certified = Object.values(qc).filter(v => v === 'Approved').length

  const setState = (id: string, state: QCState, boat: string) => {
    setQc(m => ({ ...m, [id]: state }))
    maintToast(state === 'Approved' ? `${boat} passed QC — certified` : `Rework requested for ${boat}`, state === 'Approved' ? 'success' : 'warn')
  }
  const issueCert = (ins: MaintenanceInspection) => {
    printDoc(`${translatePortalText("Service Certificate")} — ${ins.boatName}`, `
      <h1>${translatePortalText("Service Quality Certificate")}</h1><p class="sub">${translatePortalText("Certified on")} ${formatPortalDate(new Date())}</p>
      <div class="row"><span>${translatePortalText("Vessel")}</span><span>${ins.boatName}</span></div>
      <div class="row"><span>${translatePortalText("Inspection")}</span><span>${localizedField(ins, 'type') ?? translatePortalText(ins.type)}</span></div>
      <div class="row"><span>${translatePortalText("Technician")}</span><span>${ins.technician?.name || translatePortalText('Unassigned')}</span></div>
      <div class="row"><span>${translatePortalText("Quality score")}</span><span>${formatPortalNumber(ins.score || 0)} / ${formatPortalNumber(100)}</span></div>
      <div class="row tot"><span>${translatePortalText("Result")}</span><span>${translatePortalText("PASSED — CERTIFIED")}</span></div>
      <p style="margin-top:30px">${translatePortalText("Authorised signature")}: ____________________</p>`)
    setCertFor(null)
  }
  const addClaim = async (body: { boatName: string; item: string; kind: MaintenanceWarranty['kind']; vendor?: string }) => {
    setClaimBusy(true)
    try {
      await maintenancePortalApi.createWarranty({ ...body, status: 'claimed' })
      loadWarranties()
      setClaimOpen(false)
      maintToast(`Warranty claim opened for ${body.boatName}`)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not open claim', 'warn')
    } finally {
      setClaimBusy(false)
    }
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Quality & Warranty")} sub="Final inspections, supervisor review, quality scores, certification & warranty claims" icon={<ShieldCheck className="text-violet-500" />}
        actions={<button className="btn-maint" onClick={() => setClaimOpen(true)}><Plus size={15} /> {translatePortalText("New warranty claim")}</button>} />

      {/* quality control */}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Quality control queue")} sub={translatePortalText("Awaiting final inspection & supervisor sign-off")} className="lg:col-span-2">
          <div className="space-y-3">
            <TableToolbar state={inspTf} config={inspCfg} rows={inspections} noun="inspections"
              searchPlaceholder="Search inspections by boat, type or technician..." />
            {inspections.length > 0 && inspTf.filtered.length === 0 && (
              <NoFilterMatches noun="inspections" onClear={inspTf.clear} />
            )}
            {inspTf.pagedRows.map((ins, i) => {
              const state = qc[ins.id] ?? (ins.status === 'completed' ? 'Pending' : 'Approved') // if not completed, we'll pretend it's pending for UI purposes
              const icon = ins.type.toLowerCase().includes('engine') ? '⚙️' : ins.type.toLowerCase().includes('electrical') ? '⚡' : '📋'
              return (
                <motion.div key={ins.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-sand/60 p-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-lg">{icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{ins.boatName} · {localizedField(ins, 'type') ?? translatePortalText(ins.type)}</p>
                    <p className="text-[11px] text-slate-400">{ins.workOrder?.code || translatePortalText("No WO")} · {ins.technician?.name || translatePortalText("Unassigned")}</p>
                  </div>
                  {ins.status !== 'scheduled' && <div className="text-center"><p className="font-display text-lg font-extrabold text-deep-900">{formatPortalNumber(ins.score || 0)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Score")}</p></div>}
                  {state === 'Pending' ? (
                    <div className="flex gap-1.5">
                      <button onClick={() => setState(ins.id, 'Approved', ins.boatName)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{translatePortalText("Approve")}</button>
                      <button onClick={() => setState(ins.id, 'Rework', ins.boatName)} className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-100">{translatePortalText("Rework")}</button>
                    </div>
                  ) : state === 'Approved' ? (
                    <div className="flex items-center gap-2">
                      <span className="chip bg-emerald-50 text-emerald-700"><Check size={12} /> {translatePortalText("Certified")}</span>
                      <button onClick={() => setCertFor(ins)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Award size={12} /> {translatePortalText("Cert")}</button>
                    </div>
                  ) : (
                    <span className="chip bg-amber-50 text-amber-700">{translatePortalText("Rework requested")}</span>
                  )}
                </motion.div>
              )
            })}
            <TablePagination state={inspTf} noun="inspections" />
          </div>
        </Section>
        <Section title={translatePortalText("Quality metrics")} sub={translatePortalText("This month")}>
          <div className="flex flex-col items-center gap-3 py-2">
            <HealthRing score={94} size={110} label="QC pass" />
            <div className="grid w-full grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-xl bg-sand py-2"><p className="font-display text-lg font-extrabold text-deep-900">{reworks}</p><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Reworks")}</p></div>
              <div className="rounded-xl bg-sand py-2"><p className="font-display text-lg font-extrabold text-emerald-600">{certified}</p><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Certified")}</p></div>
            </div>
            <button onClick={() => setCertFor(inspections.find(i => i.status !== 'scheduled') ?? inspections[0])} className="btn-maint w-full !justify-center !text-xs"><Award size={14} /> {translatePortalText("Issue certificate")}</button>
          </div>
        </Section>
      </div>

      {/* warranties */}
      <Section title={translatePortalText("Warranty register")} sub={translatePortalText("Parts & service warranties, claims and expiry tracking")}
        actions={<button onClick={() => download('warranty-register.csv', toCSV(warranties.map(w => ({ [translatePortalText('Boat')]: w.boatName, [translatePortalText('Item')]: localizedField(w, 'item') ?? w.item, [translatePortalText('Type')]: translatePortalText(WARRANTY_KIND_LABEL[w.kind]), [translatePortalText('Vendor')]: w.vendor || '', [translatePortalText('Start')]: monthYear(w.startDate), [translatePortalText('Expiry')]: monthYear(w.expiryDate), [translatePortalText('Status')]: translatePortalText(WARRANTY_STATUS_LABEL[w.status]) }))), 'text/csv;charset=utf-8')} className="btn-ghost !py-1.5 !px-3 text-xs"><Download size={13} /> {translatePortalText("Export")}</button>}>
        <TableToolbar state={warTf} config={warCfg} rows={warranties} noun="warranties"
          searchPlaceholder="Search warranties by boat, item or vendor..." />
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[800px]">
            <thead><tr className="border-b border-slate-100">{['Boat', 'Item', 'Type', 'Vendor', 'Coverage', 'Status'].map(h => <th key={h} className="th">{translatePortalText(h)}</th>)}</tr></thead>
            <tbody>
              {warranties.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>{translatePortalText("No warranties on record yet.")}</td></tr>}
              {warranties.length > 0 && warTf.filtered.length === 0 && (
                <tr><td colSpan={6}><NoFilterMatches noun="warranties" onClear={warTf.clear} /></td></tr>
              )}
              {warTf.pagedRows.map((w, i) => (
                <motion.tr key={w.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }} className="border-b border-slate-50 hover:bg-sand">
                  <td className="td font-extrabold">{w.boatName}</td>
                  <td className="td">{localizedField(w, 'item') ?? w.item}</td>
                  <td className="td"><span className={`chip ${w.kind === 'parts' ? 'bg-indigo-50 text-indigo-700' : 'bg-violet-50 text-violet-700'}`}>{translatePortalText(WARRANTY_KIND_LABEL[w.kind])}</span></td>
                  <td className="td text-slate-500">{w.vendor || '—'}</td>
                  <td className="td text-slate-500">{monthYear(w.startDate)} → {monthYear(w.expiryDate)}</td>
                  <td className="td"><MBadge dot={w.status === 'claimed' || w.status === 'expiring'}>{WARRANTY_STATUS_LABEL[w.status]}</MBadge></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination state={warTf} noun="warranties" />
      </Section>

      <WarrantyClaimModal open={claimOpen} onClose={() => setClaimOpen(false)} onSave={addClaim} busy={claimBusy} />

      <Modal open={!!certFor} onClose={() => setCertFor(null)} title={translatePortalText("🏅 Issue service certificate")}>
        {certFor && (
          <div className="space-y-3">
            <div className="rounded-2xl border-2 border-violet-200 bg-violet-50 p-5 text-center">
              <Award size={32} className="mx-auto text-violet-500" />
              <p className="mt-2 font-display text-lg font-extrabold text-deep-900">{certFor.boatName}</p>
              <p className="text-xs text-slate-500">{localizedField(certFor, 'type') ?? translatePortalText(certFor.type)} {translatePortalText("· score")} {formatPortalNumber(certFor.score || 0)}/100</p>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-emerald-600">{translatePortalText("Passed — ready to certify")}</p>
            </div>
            <button onClick={() => issueCert(certFor)} className="btn-maint w-full !justify-center"><FileCheck2 size={14} /> {translatePortalText("Print certificate")}</button>
          </div>
        )}
      </Modal>
    </PageWrap>
  )
}

function WarrantyClaimModal({ open, onClose, onSave, busy }: { open: boolean; onClose: () => void; onSave: (b: { boatName: string; item: string; kind: MaintenanceWarranty['kind']; vendor?: string }) => void; busy: boolean }) {
  const blank = { boatName: '', item: '', kind: 'parts' as MaintenanceWarranty['kind'], vendor: '' }
  const [f, setF] = useState(blank)
  React.useEffect(() => { if (open) setF(blank) }, [open])
  const set = (k: keyof typeof f) => (v: any) => setF(s => ({ ...s, [k]: v }))
  const submit = () => {
    if (!f.boatName.trim() || !f.item.trim()) { maintToast('Fill boat and item', 'warn'); return }
    onSave({ boatName: f.boatName, item: f.item, kind: f.kind, vendor: f.vendor || undefined })
  }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🛡️ New warranty claim")}>
      <div className="space-y-3">
        <div><label className="label">{translatePortalText("Boat")}</label><input className="input" value={f.boatName} onChange={e => set('boatName')(e.target.value)} placeholder={translatePortalText("Boat name")} /></div>
        <div><label className="label">{translatePortalText("Item / work covered")}</label><input className="input" value={f.item} onChange={e => set('item')(e.target.value)} placeholder={translatePortalText("e.g. Raw water pump")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{translatePortalText("Type")}</label><select className="input" value={f.kind} onChange={e => set('kind')(e.target.value)}>{(['parts', 'service'] as const).map(k => <option key={k} value={k}>{translatePortalText(WARRANTY_KIND_LABEL[k])}</option>)}</select></div>
          <div><label className="label">{translatePortalText("Vendor")}</label><input className="input" value={f.vendor} onChange={e => set('vendor')(e.target.value)} placeholder={translatePortalText("Vendor / manufacturer")} /></div>
        </div>
        <button disabled={busy} onClick={submit} className="btn-maint w-full !justify-center disabled:opacity-70">{busy ? translatePortalText("Opening claim…") : translatePortalText("Open claim")}</button>
      </div>
    </Modal>
  )
}

// ══════════ HISTORY & HEALTH (§19, §20) ══════════
export function MaintHistory() { return <HistoryPage /> }
function HistoryPage() {
  const [historyEntries, setHistoryEntries] = useState<MaintenanceServiceHistoryEntry[]>([])
  const [entry, setEntry] = useState<MaintenanceServiceHistoryEntry | null>(null)
  const [selectedBoat, setSelectedBoat] = useState('')
  const [health, setHealth] = useState<BoatHealth | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [logBusy, setLogBusy] = useState(false)

  const loadHistory = () => {
    maintenancePortalApi.history({ limit: 50 })
      .then(res => {
        const items = res.data.items || []
        setHistoryEntries(items)
        setSelectedBoat(prev => prev || items[0]?.boatName || '')
      })
      .catch(() => maintToast('Could not load service history', 'warn'))
  }
  useEffect(() => { loadHistory() }, [])

  useEffect(() => {
    if (!selectedBoat) { setHealth(null); return }
    maintenancePortalApi.boatHealth(selectedBoat)
      .then(res => setHealth(res.data))
      .catch(() => setHealth(null))
  }, [selectedBoat])

  const boatNames = [...new Set(historyEntries.map(h => h.boatName))]

  const downloadReport = () => printDoc(translatePortalText('Service History Report'), `
    <h1>${translatePortalText('Service History Report')}</h1><p class="sub">${selectedBoat || translatePortalText('Fleet')} · ${translatePortalText('overall health')} ${formatPortalNumber(health?.overall ?? 0)}/${formatPortalNumber(100)} · ${translatePortalText('generated')} ${fullDate(new Date().toISOString())}</p>
    <table><thead><tr><th>${translatePortalText('Date')}</th><th>${translatePortalText('Boat')}</th><th>${translatePortalText('Work')}</th><th>${translatePortalText('Technician')}</th><th>${translatePortalText('Parts')}</th><th>${translatePortalText('Cost')}</th></tr></thead><tbody>
    ${historyEntries.map(h => `<tr><td>${fullDate(h.performedAt)}</td><td>${h.boatName}</td><td>${localizedField(h, 'title') ?? h.title}</td><td>${h.technician?.name || '—'}</td><td>${serviceHistoryParts(h).join(', ') || '—'}</td><td>${money(h.cost)}</td></tr>`).join('')}
    </tbody></table>
    <div class="row tot"><span>${translatePortalText('Total spend')}</span><span>${money(historyEntries.reduce((s, h) => s + h.cost, 0))}</span></div>`)

  const logService = async (body: { boatName: string; title: string; category: string; cost: number; partsUsed: string[] }) => {
    setLogBusy(true)
    try {
      await maintenancePortalApi.createHistoryEntry(body)
      loadHistory()
      setLogOpen(false)
      maintToast(`Logged service for ${body.boatName}`)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not log service', 'warn')
    } finally {
      setLogBusy(false)
    }
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("History & Boat Health")} sub="Complete service history, previous repairs, costs and boat health records" icon={<History className="text-violet-500" />}
        actions={<>
          <button className="btn-ghost" onClick={downloadReport}><Download size={15} /> {translatePortalText("Download report")}</button>
          <button className="btn-maint" onClick={() => setLogOpen(true)}><Plus size={15} /> {translatePortalText("Log service")}</button>
        </>} />

      {/* boat health record — derived from completed inspections + service history, see computeBoatHealth() on the backend */}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Boat health record")} sub={selectedBoat || translatePortalText("No service history logged yet")} className="lg:col-span-2"
          actions={boatNames.length > 1 ? (
            <select className="input !w-auto !py-1.5 text-xs" value={selectedBoat} onChange={e => setSelectedBoat(e.target.value)}>
              {boatNames.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : undefined}>
          {health ? (
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex flex-col items-center">
                <HealthRing score={health.overall} size={128} label="Overall" thickness={11} />
                <p className="mt-2 text-xs font-bold text-slate-400">{translatePortalText("Maintenance score")}</p>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
                {health.systems.length === 0 && <p className="col-span-full text-xs text-slate-400">{translatePortalText("No completed inspections yet for")} {selectedBoat}.</p>}
                {health.systems.map((s, i) => {
                  const color = s.score >= 80 ? 'text-emerald-600' : s.score >= 60 ? 'text-amber-600' : 'text-rose-600'
                  return (
                    <motion.div key={s.name} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                      className="rounded-2xl border border-slate-100 p-3 text-center">
                      <p className={`font-display text-xl font-extrabold ${color}`}>{formatPortalNumber(s.score)}</p>
                      <p className="text-[11px] font-bold text-deep-900">{localizedField<string>(s, 'name') ?? s.name}</p>
                      <p className="text-[10px] text-slate-400 line-clamp-1">{localizedField<string>(s, 'note') ?? (s.note || '—')}</p>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-slate-400">{translatePortalText("Log a service or completed inspection for a boat to see its health record.")}</p>
          )}
        </Section>
        <Section title={translatePortalText("Health trend")} sub={translatePortalText("Monthly average, from completed inspections")}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={health?.trend || []} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="score" name={translatePortalText("Health")} stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3, fill: '#8b5cf6' }} />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* service history timeline */}
      <Section title={translatePortalText("Service history")} sub={translatePortalText("All completed work across the yard")}>
        <div className="relative space-y-3 ps-6">
          <div className="absolute start-2 top-1 bottom-1 w-0.5 bg-gradient-to-b from-violet-400 to-indigo-300" />
          {historyEntries.length === 0 && <p className="text-xs text-slate-400">{translatePortalText("No service history logged yet.")}</p>}
          {historyEntries.map((h, i) => {
            const c = catIcon(h.category)
            return (
              <motion.div key={h.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative">
                <span className="absolute -start-[18px] top-3 h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: c.color }} />
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-sand/60 p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl text-base" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-extrabold text-deep-900">{h.boatName} · {localizedField(h, 'title') ?? h.title}</p><p className="text-[11px] text-slate-400">{fullDate(h.performedAt)} · {h.technician?.name || translatePortalText("Unassigned")} {translatePortalText("· parts:")} {serviceHistoryParts(h).join(', ') || '—'}</p></div>
                  <b className="text-sm text-violet-600">{money(h.cost)}</b>
                  <button onClick={() => setEntry(h)} className="btn-ghost !py-1 !px-2.5 !text-[11px]">{translatePortalText("View")}</button>
                </div>
              </motion.div>
            )
          })}
        </div>
      </Section>

      <Modal open={!!entry} onClose={() => setEntry(null)} title={entry ? `${catIcon(entry.category).icon} ${entry.boatName}` : ''}>
        {entry && (
          <div className="space-y-3">
            <p className="font-display text-lg font-extrabold text-deep-900">{localizedField(entry, 'title') ?? entry.title}</p>
            <div className="space-y-1">
              {[['Date', fullDate(entry.performedAt)], ['Boat', entry.boatName], ['Technician', entry.technician?.name || '—'], ['Category', categoryLabel(entry.category)], ['Parts used', serviceHistoryParts(entry).join(', ') || '—']].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-50 py-1.5 text-sm"><span className="text-slate-400">{translatePortalText(k)}</span><span className="font-semibold text-deep-800">{v}</span></div>
              ))}
              <div className="flex justify-between pt-2 text-sm"><span className="font-bold text-deep-900">{translatePortalText("Total cost")}</span><b className="text-violet-600">{money(entry.cost)}</b></div>
            </div>
            <button onClick={() => printDoc(translatePortalText("Service Record"), `<h1>${localizedField(entry, 'title') ?? entry.title}</h1><p class="sub">${entry.boatName}</p><div class="row"><span>${translatePortalText('Date')}</span><span>${fullDate(entry.performedAt)}</span></div><div class="row"><span>${translatePortalText('Technician')}</span><span>${entry.technician?.name || '—'}</span></div><div class="row"><span>${translatePortalText('Parts')}</span><span>${serviceHistoryParts(entry).join(', ') || '—'}</span></div><div class="row tot"><span>${translatePortalText('Cost')}</span><span>${money(entry.cost)}</span></div>`)} className="btn-maint w-full !justify-center"><Download size={14} /> {translatePortalText("Print record")}</button>
          </div>
        )}
      </Modal>

      <LogServiceModal open={logOpen} onClose={() => setLogOpen(false)} onSave={logService} busy={logBusy} />
    </PageWrap>
  )
}

function LogServiceModal({ open, onClose, onSave, busy }: { open: boolean; onClose: () => void; onSave: (b: { boatName: string; title: string; category: string; cost: number; partsUsed: string[] }) => void; busy: boolean }) {
  const blank = { boatName: '', title: '', category: 'engine', cost: '', parts: '' }
  const [f, setF] = useState(blank)
  React.useEffect(() => { if (open) setF(blank) }, [open])
  const set = (k: keyof typeof f) => (v: any) => setF(s => ({ ...s, [k]: v }))
  const submit = () => {
    if (!f.boatName.trim() || !f.title.trim()) { maintToast('Fill boat and work performed', 'warn'); return }
    onSave({ boatName: f.boatName, title: f.title, category: f.category, cost: parseFloat(f.cost) || 0, partsUsed: f.parts.split(',').map(s => s.trim()).filter(Boolean) })
  }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🧾 Log completed service")}>
      <div className="space-y-3">
        <div><label className="label">{translatePortalText("Boat")}</label><input className="input" value={f.boatName} onChange={e => set('boatName')(e.target.value)} placeholder={translatePortalText("Boat name")} /></div>
        <div><label className="label">{translatePortalText("Work performed")}</label><input className="input" value={f.title} onChange={e => set('title')(e.target.value)} placeholder={translatePortalText("e.g. Annual engine service")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{translatePortalText("Category")}</label>
            <select className="input" value={f.category} onChange={e => set('category')(e.target.value)}>
              {MAINTENANCE_CATEGORY_KEYS.map(k => <option key={k} value={k}>{categoryLabel(k)}</option>)}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Cost")}</label><input className="input" type="number" min={0} step="0.01" value={f.cost} onChange={e => set('cost')(e.target.value)} placeholder={translatePortalText("0.00")} /></div>
        </div>
        <div><label className="label">{translatePortalText("Parts used (comma separated)")}</label><input className="input" value={f.parts} onChange={e => set('parts')(e.target.value)} placeholder={translatePortalText("e.g. Oil filter, impeller")} /></div>
        <button disabled={busy} onClick={submit} className="btn-maint w-full !justify-center disabled:opacity-70">{busy ? translatePortalText("Saving…") : translatePortalText("Log service")}</button>
      </div>
    </Modal>
  )
}

// ══════════ FLEET MAINTENANCE (§29) ══════════
const BULK_SERVICE_CATEGORY: Record<string, string> = { 'Preventive service': 'other', 'Annual inspection': 'inspection', 'Haul-out & antifoul': 'hull', 'Engine 250h service': 'engine', 'Safety recertification': 'safety' }
export function MaintFleet() { return <FleetPage /> }
function FleetPage() {
  const [view, setView] = useState<'card' | 'table'>('table')
  const [accounts, setAccounts] = useState<ApiFleetAccount[]>([])
  const [detail, setDetail] = useState<ApiFleetAccount | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulk, setBulk] = useState({ accountId: '', service: 'Preventive service', date: '' })
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ company: '', boatNames: '', contract: 'Preventive quarterly', status: 'Good standing' as ApiFleetAccount['status'] })

  const load = () => {
    maintenancePortalApi.fleetAccounts().then(res => {
      setAccounts(res.data.fleetAccounts)
      setBulk(b => b.accountId ? b : { ...b, accountId: res.data.fleetAccounts[0]?.id || '' })
    }).catch(() => maintToast('Could not load fleet accounts', 'warn'))
  }
  useEffect(load, [])

  const totalBoats = accounts.reduce((s, f) => s + f.boats, 0)
  const totalSpend = accounts.reduce((s, f) => s + f.spendYTD, 0)
  const avgHealth = accounts.length ? Math.round(accounts.reduce((s, f) => s + f.health, 0) / accounts.length) : 0

  const createAccount = () => {
    if (!form.company.trim()) { maintToast('Company name is required', 'warn'); return }
    maintenancePortalApi.createFleetAccount({ company: form.company.trim(), boatNames: form.boatNames.split(',').map(s => s.trim()).filter(Boolean), contract: form.contract, status: form.status })
      .then(() => { maintToast(`${form.company} added as a fleet account`); setCreating(false); setForm({ company: '', boatNames: '', contract: 'Preventive quarterly', status: 'Good standing' }); load() })
      .catch(e => maintToast(e instanceof Error ? e.message : 'Could not create fleet account', 'warn'))
  }

  /**
   * Boats already scheduled in the current bulk run.
   *
   * A fleet job is N work orders against a plan that caps active jobs, so the
   * run can be refused part-way through. The add-on modal retries the action it
   * refused, and without this the retry would re-post every boat and duplicate
   * the ones that already succeeded — so a resumed run picks up where it
   * stopped instead of starting over.
   */
  const bulkDone = React.useRef<Set<string>>(new Set())

  const scheduleFleet = useLimitAwareAction(
    async (acct: { company: string; boatNames: string[] }, service: string, date: string) => {
      // Sequential, not Promise.all: the cap has to refuse a specific boat so
      // the rest of the fleet is not half-written before anyone notices.
      for (const boatName of acct.boatNames) {
        if (bulkDone.current.has(boatName)) continue
        await maintenancePortalApi.createWorkOrder({
          boatName, customerName: acct.company, category: BULK_SERVICE_CATEGORY[service] || 'other', title: service, scheduledFor: date,
        })
        bulkDone.current.add(boatName)
      }
      return true as const
    }
  )

  const runBulk = () => {
    const acct = accounts.find(a => a.id === bulk.accountId)
    if (!acct) { maintToast('Choose a fleet account', 'warn'); return }
    if (!bulk.date) { maintToast('Choose a target date', 'warn'); return }
    if (acct.boatNames.length === 0) { maintToast(`${acct.company} has no boats on file yet`, 'warn'); return }
    bulkDone.current = new Set()
    scheduleFleet.run(acct, bulk.service, bulk.date)
      .then((ok) => {
        // Undefined means it was refused and the add-on modal is now up; the
        // run resumes from `bulkDone` if the operator resolves it.
        if (!ok) return
        maintToast(`${translatePortalText(bulk.service)} scheduled for ${acct.company} (${acct.boats} boats)`); setBulkOpen(false); load()
      })
      .catch(() => maintToast('Could not schedule for the whole fleet', 'warn'))
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Fleet Maintenance")} sub="Commercial customers — multi-boat management, contracts & fleet health" icon={<Ship className="text-violet-500" />}
        actions={<>
          <MaintViewToggle view={view} onChange={setView} />
          <button className="btn-ghost" onClick={() => setCreating(true)}><Plus size={15} /> {translatePortalText("New account")}</button>
          <button className="btn-maint" onClick={() => setBulkOpen(true)}><Plus size={15} /> {translatePortalText("Bulk schedule")}</button>
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[{ l: 'Fleet accounts', v: accounts.length, i: '🏢' }, { l: 'Boats managed', v: totalBoats, i: '🚤' }, { l: 'Spend YTD', v: totalSpend, i: '💰', p: 'SAR' }, { l: 'Avg fleet health', v: avgHealth, i: '❤️', s: '%' }].map((k, i) => (
          <motion.div key={k.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 flex items-center gap-3">
            <span className="text-2xl">{k.i}</span>
            <div><p className="font-display text-xl font-extrabold text-deep-900">{k.s === '%' ? formatPortalPercent(k.v) : <Counter value={k.v} currency={k.p} compact />}</p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(k.l)}</p></div>
          </motion.div>
        ))}
      </div>

      {accounts.length === 0 ? <EmptyState icon="🏢" text={translatePortalText("No fleet accounts yet — add a commercial customer to get started.")} /> : view === 'card' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((f, i) => (
            <motion.div key={f.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card card-hover p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 text-xl text-white shadow-glow">🏢</span>
                <div className="min-w-0 flex-1"><p className="truncate font-display text-[15px] font-extrabold text-deep-900"><bdi dir="auto">{f.company}</bdi></p><p className="text-[11px] text-slate-400">{formatPortalNumber(f.boats)} {translatePortalText("boats ·")} <bdi dir="auto">{fleetContract(f)}</bdi></p></div>
                <MBadge dot={f.status !== 'Good standing'}>{translatePortalText(f.status)}</MBadge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-sand py-2.5"><p className="font-display text-lg font-extrabold text-deep-900">{formatPortalNumber(f.boats)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Boats")}</p></div>
                <div className="rounded-xl bg-sand py-2.5"><p className="font-display text-lg font-extrabold text-deep-900">{money(f.spendYTD)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Spend YTD")}</p></div>
                <div className="rounded-xl bg-sand py-2.5"><HealthRing score={f.health} size={44} /></div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px]">
                <span className="text-slate-400">{translatePortalText("Next service")} <b className="text-deep-900"><bdi dir="auto">{fleetNextService(f)}</bdi></b></span>
                <button onClick={() => setDetail(f)} className="btn-ghost !py-1 !px-2.5 !text-[11px]">{translatePortalText("Fleet dashboard")}</button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1020px]">
              <div className="grid grid-cols-[1.6fr_0.6fr_1fr_1fr_1fr_1fr_1fr_150px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Company")}</span><span>{translatePortalText("Boats")}</span><span>{translatePortalText("Contract type")}</span><span>{translatePortalText("Status")}</span><span>{translatePortalText("Spend YTD")}</span><span>{translatePortalText("Fleet health")}</span><span>{translatePortalText("Next service")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {accounts.map((f, i) => {
                const healthColor = f.health >= 80 ? 'text-emerald-600' : f.health >= 60 ? 'text-amber-600' : 'text-rose-600'
                return (
                  <motion.div key={f.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-[1.6fr_0.6fr_1fr_1fr_1fr_1fr_1fr_150px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 text-base text-white shadow-glow">🏢</span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{f.company}</bdi></p>
                        <p className="truncate text-[11px] text-slate-400"><bdi dir="auto">{f.boatNames.slice(0, 2).join(', ')}</bdi>{f.boatNames.length > 2 ? ` ${translatePortalTemplate('+{{count}} more', { count: f.boatNames.length - 2 })}` : ''}</p>
                      </div>
                    </div>
                    <div className="text-[13px] font-bold text-deep-900 whitespace-nowrap">{formatPortalNumber(f.boats)}</div>
                    <div className="truncate text-[13px] text-slate-500"><bdi dir="auto">{fleetContract(f)}</bdi></div>
                    <div className="whitespace-nowrap"><MBadge dot={f.status !== 'Good standing'}>{translatePortalText(f.status)}</MBadge></div>
                    <div className="text-[13px] font-bold text-deep-900 whitespace-nowrap">{money(f.spendYTD)}</div>
                    <div className="flex items-center gap-2 whitespace-nowrap"><HealthRing score={f.health} size={36} /><span className={`text-[11px] font-bold ${healthColor}`}>{formatPortalPercent(f.health)}</span></div>
                    <div className="truncate text-[11px] text-slate-400"><bdi dir="auto">{fleetNextService(f)}</bdi></div>
                    <div className="flex justify-end whitespace-nowrap">
                      <button onClick={() => setDetail(f)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{translatePortalText("Fleet dashboard")}</button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `🏢 ${detail.company}` : ''} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div><p className="text-xs text-slate-400">{fleetContract(detail)}</p><p className="font-display text-lg font-extrabold text-deep-900">{detail.company}</p></div>
              <MBadge dot={detail.status !== 'Good standing'}>{translatePortalText(detail.status)}</MBadge>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ l: 'Boats', v: formatPortalNumber(detail.boats) }, { l: 'Spend YTD', v: money(detail.spendYTD) }, { l: 'Fleet health', v: formatPortalPercent(detail.health) }, { l: 'Next service', v: fleetNextService(detail) }].map(x => (
                <div key={x.l} className="rounded-xl bg-sand p-3 text-center"><p className="font-display text-lg font-extrabold text-deep-900">{x.v}</p><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(x.l)}</p></div>
              ))}
            </div>
            <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-100 p-4"><HealthRing score={detail.health} size={100} label="Fleet health" /></div>
            <p className="text-xs text-slate-400">{translatePortalText("Boats:")} {detail.boatNames.join(', ') || translatePortalText("None on file yet")}</p>
            <div className="flex gap-2">
              <button onClick={() => { setBulk(b => ({ ...b, accountId: detail.id })); setDetail(null); setBulkOpen(true) }} className="btn-maint flex-1 !justify-center">{translatePortalText("Schedule fleet service")}</button>
              <button onClick={() => printDoc(`${translatePortalText('Fleet Report')} — ${detail.company}`, `<h1>${detail.company}</h1><p class="sub">${fleetContract(detail)}</p><div class="row"><span>${translatePortalText('Boats')}</span><span>${formatPortalNumber(detail.boats)}</span></div><div class="row"><span>${translatePortalText('Fleet health')}</span><span>${formatPortalPercent(detail.health)}</span></div><div class="row"><span>${translatePortalText('Next service')}</span><span>${fleetNextService(detail)}</span></div><div class="row tot"><span>${translatePortalText('Spend YTD')}</span><span>${money(detail.spendYTD)}</span></div>`)} className="btn-ghost"><Download size={14} /> {translatePortalText("Report")}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title={translatePortalText("🏢 New fleet account")}>
        <div className="space-y-3">
          <div><label className="label">{translatePortalText("Company")}</label><input className="input" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder={translatePortalText("e.g. Island Charters LLC")} /></div>
          <div><label className="label">{translatePortalText("Boats (comma-separated names)")}</label><input className="input" value={form.boatNames} onChange={e => setForm(f => ({ ...f, boatNames: e.target.value }))} placeholder={translatePortalText("e.g. Nordlys, Sentinel 7, Velocity")} /></div>
          <div><label className="label">{translatePortalText("Contract type")}</label><select className="input" value={form.contract} onChange={e => setForm(f => ({ ...f, contract: e.target.value }))}>{['Full-service annual', 'Preventive quarterly', 'On-demand + haul-out', 'Priority emergency'].map(s => <option key={s} value={s}>{translatePortalText(s)}</option>)}</select></div>
          <div><label className="label">{translatePortalText("Status")}</label><select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ApiFleetAccount['status'] }))}>{(['Good standing', 'Watch', 'On hold'] as const).map(s => <option key={s} value={s}>{translatePortalText(s)}</option>)}</select></div>
          <button onClick={createAccount} className="btn-maint w-full !justify-center">{translatePortalText("Add fleet account")}</button>
        </div>
      </Modal>

      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={translatePortalText("🚤 Bulk fleet schedule")}>
        <div className="space-y-3">
          <div><label className="label">{translatePortalText("Fleet account")}</label><select className="input" value={bulk.accountId} onChange={e => setBulk(b => ({ ...b, accountId: e.target.value }))}>{accounts.map(a => <option key={a.id} value={a.id}>{a.company} ({a.boats} {translatePortalText("boats)")}</option>)}</select></div>
          <div><label className="label">{translatePortalText("Service type")}</label><select className="input" value={bulk.service} onChange={e => setBulk(b => ({ ...b, service: e.target.value }))}>{Object.keys(BULK_SERVICE_CATEGORY).map(s => <option key={s} value={s}>{translatePortalText(s)}</option>)}</select></div>
          <div><label className="label">{translatePortalText("Target date")}</label><input type="date" className="input" value={bulk.date} onChange={e => setBulk(b => ({ ...b, date: e.target.value }))} /></div>
          <button onClick={runBulk} className="btn-maint w-full !justify-center">{translatePortalText("Schedule for fleet")}</button>
        </div>
      </Modal>
      {scheduleFleet.modal}
    </PageWrap>
  )
}
