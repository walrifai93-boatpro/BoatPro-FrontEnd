import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { ReportsCenter } from '../../shared/reports/ReportsCenter'
import { MaintReportsSnapshot } from './MaintReportsSnapshot'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Receipt, BarChart3, Plus, Download, Send, RotateCcw, Landmark, CreditCard, Building2, CheckCircle2, AlertCircle, Save, Edit3, ShieldCheck } from 'lucide-react'
import { money, avatar } from '../maintData'
import type { MaintInvoice } from '../maintData'
import { PageWrap } from './_shared'
import { Section, Modal, Counter, download, toCSV } from '../../ui'
import { maintToast, MaintHeader, MBadge, MaintViewToggle } from '../maintUi'
import { BankDetailsFields } from '../../components/BankDetailsFields'
import { VendorWeeklyPayouts } from '../../components/VendorWeeklyPayouts'
import {
  EMPTY_BANK_DETAILS,
  bankPayload,
  validateBankDetails,
  type BankDetailsErrors,
  type BankDetailsValue,
} from '../../utils/iban'
import { maintenancePortalApi, maintenanceShopApi, type ApiMaintenanceShop, type MaintenanceInvoice, type MaintenanceWorkOrder } from '../../api'
import { formatPortalDate, formatPortalPercent, localizedField, translatePortalText } from '../../i18n/runtime'

/** Map backend invoice to the UI MaintInvoice shape. */
const statusMap = (s: string): MaintInvoice['status'] => {
  const m: Record<string, MaintInvoice['status']> = { paid: 'Paid', pending: 'Pending', overdue: 'Overdue', draft: 'Pending', sent: 'Pending', refunded: 'Refunded' }
  return m[s] || 'Pending'
}
const toInvView = (inv: MaintenanceInvoice): MaintInvoice => ({
  id: inv.code || inv.id,
  woId: '—',
  customer: inv.customerName || inv.customer?.name || 'Customer',
  avatar: inv.customer?.avatar || avatar(Math.abs((inv.customerName || '').charCodeAt(0) % 70)),
  boat: inv.boatName || '—',
  date: inv.createdAt ? formatPortalDate(inv.createdAt) : '—',
  due: inv.dueDate ? formatPortalDate(inv.dueDate) : '—',
  labor: inv.labor,
  parts: inv.parts,
  subtotal: inv.subtotal ?? inv.labor + inv.parts - inv.discount,
  vatRate: inv.vatRate,
  tax: inv.tax,
  discount: inv.discount,
  total: inv.total,
  status: statusMap(inv.status),
  method: 'Card on file',
})

// ══════════ BILLING & PAYMENTS (§27) ══════════
export function MaintBilling() { return <BillingPage /> }
function BillingPage() {
  const location = useLocation()
  const [tab, setTab] = useState<'All' | 'Pending' | 'Paid' | 'Overdue'>('All')
  const [view, setView] = useState<'card' | 'table'>('table')
  const [invoices, setInvoices] = useState<MaintInvoice[]>([])
  const [invoiceRecords, setInvoiceRecords] = useState<MaintenanceInvoice[]>([])
  const [newOpen, setNewOpen] = useState(false)
  const [form, setForm] = useState({ customer: '', boat: '', labor: 0, parts: 0, workOrderId: '' })
  const [remindTarget, setRemindTarget] = useState<MaintInvoice | null>(null)
  const [collectTarget, setCollectTarget] = useState<MaintInvoice | null>(null)
  // Billable jobs to invoice against — picking one pre-fills labour/parts from
  // the actual job so the invoice can't silently disagree with the work done.
  const [billableOrders, setBillableOrders] = useState<MaintenanceWorkOrder[]>([])

  /**
   * The platform VAT rate, or null until it has loaded.
   *
   * Null rather than a hardcoded 15 so the panel shows "—" instead of asserting
   * a rate the server has not confirmed — the previous version of this panel was
   * wrong precisely because it stated a rate from memory.
   */
  const [vatRatePct, setVatRatePct] = useState<number | null>(null)

  const [shop, setShop] = useState<ApiMaintenanceShop | null>(null)
  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [bankSaving, setBankSaving] = useState(false)
  const [bankForm, setBankForm] = useState<BankDetailsValue>(EMPTY_BANK_DETAILS)
  const [bankErrors, setBankErrors] = useState<BankDetailsErrors>({})

  useEffect(() => {
    void (async () => {
      try {
        const res = await maintenancePortalApi.settings()
        if (typeof res.data.vatRatePct === 'number') setVatRatePct(res.data.vatRatePct)
      } catch {
        // Leaves the panel showing "—": better than naming a rate we could not confirm.
      }
    })()
  }, [])

  const loadShop = useCallback(async () => {
    try {
      const res = await maintenanceShopApi.mine()
      const s = res.data.shop
      setShop(s)
      if (s?.bank) {
        setBankForm({
          bankName: s.bank.bankName || '',
          accountHolderName: s.bank.accountHolderName || '',
          iban: s.bank.iban || '',
          accountNumber: s.bank.accountNumber || '',
          swiftCode: s.bank.swiftCode || '',
        })
      }
    } catch {}
  }, [])

  useEffect(() => { void loadShop() }, [loadShop])

  const focusTarget = useCallback((id: string) => {
    if (id === 'payout' || id === 'bank' || id === 'bank_details' || id === 'section-bank') {
      const el = document.getElementById('section-bank') || document.getElementById('payout')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
      }
      setBankModalOpen(true)
    }
  }, [])

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash) {
      const timer = setTimeout(() => focusTarget(hash), 250)
      return () => clearTimeout(timer)
    }
  }, [location.hash, focusTarget])

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.id) focusTarget(e.detail.id)
    }
    window.addEventListener('boatpro-focus-field', handler)
    return () => window.removeEventListener('boatpro-focus-field', handler)
  }, [focusTarget])

  const saveBank = async () => {
    // The checksum and the holder name too, not just "something was entered".
    const bankIssues = validateBankDetails(bankForm, { require: true })
    setBankErrors(bankIssues)
    if (Object.keys(bankIssues).length) return

    setBankSaving(true)
    try {
      await maintenanceShopApi.update({
        bank: bankPayload(bankForm),
      })
      await loadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      setBankModalOpen(false)
      maintToast('Bank payout details saved successfully', 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save bank details', 'warn')
    } finally {
      setBankSaving(false)
    }
  }

  const loadInvoices = async () => {
    try {
      const res = await maintenancePortalApi.invoices({ limit: 100 })
      const items = res.data.items || []
      setInvoiceRecords(items)
      setInvoices(items.map(toInvView))
    } catch (err) {
      maintToast(err instanceof Error ? err.message : 'Could not load invoices', 'warn')
    }
  }
  useEffect(() => { void loadInvoices() }, [])
  useEffect(() => {
    maintenancePortalApi.workOrders({ limit: 100 })
      .then(res => setBillableOrders((res.data.items || []).filter(o => ['completed', 'delivered', 'quality_check'].includes(o.status))))
      .catch(() => setBillableOrders([]))
  }, [])

  const pickWorkOrder = (workOrderId: string) => {
    const wo = billableOrders.find(o => o.id === workOrderId)
    if (!wo) { setForm(f => ({ ...f, workOrderId: '' })); return }
    setForm(f => ({
      ...f,
      workOrderId,
      boat: wo.boatName || f.boat,
      customer: wo.customerName || f.customer,
      labor: wo.laborCost ?? 0,
      parts: wo.partsCost ?? 0,
    }))
  }

  const byTab = invoices.filter(i => tab === 'All' || i.status === tab)

  /**
   * Nested inside the status tab, so choosing Overdue and then typing a customer
   * name searches the overdue invoices rather than jumping back to all of them.
   */
  const filterCfg: TableFiltersConfig<MaintInvoice> = useMemo(() => ({
    searchFields: (inv) => [inv.id, inv.customer, inv.boat],
    filters: [
      { key: 'status', label: 'Status', get: (inv) => inv.status },
      { key: 'boat', label: 'Boat', get: (inv) => inv.boat },
      {
        key: 'size',
        label: 'Invoice value',
        options: [
          { value: 'high', label: '1,000 and over' },
          { value: 'mid', label: '250-999' },
          { value: 'low', label: 'Under 250' },
        ],
        get: (inv) => String(inv.total ?? 0),
        match: (inv, v) => {
          const t = Number(inv.total ?? 0)
          if (v === 'high') return t >= 1000
          if (v === 'mid') return t >= 250 && t < 1000
          return t < 250
        },
      },
      {
        key: 'discount',
        label: 'Discount',
        options: [
          { value: 'yes', label: 'Discounted' },
          { value: 'no', label: 'Full price' },
        ],
        get: (inv) => ((inv.discount ?? 0) > 0 ? 'yes' : 'no'),
      },
    ],
  }), [])
  const tf = useTableFilters(byTab, filterCfg)
  const list = tf.pagedRows
  const outstanding = invoices.filter(i => i.status === 'Pending' || i.status === 'Overdue').reduce((s, i) => s + i.total, 0)
  const collected = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + i.total, 0)
  const avgJobValue = invoices.length ? Math.round(invoices.reduce((s, i) => s + i.total, 0) / invoices.length) : 0

  const setStatus = async (id: string, status: 'Paid' | 'Refunded') => {
    const record = invoiceRecords.find(r => r.code === id || r.id === id)
    if (!record) return
    try {
      // The API's status enum has no 'refunded' — a reversed invoice is voided.
      await maintenancePortalApi.updateInvoice(record.id || (record as any)._id, { status: status === 'Refunded' ? 'void' : 'paid' })
      await loadInvoices()
      maintToast(`Invoice ${id} marked as ${status}`)
    } catch (err) {
      maintToast(err instanceof Error ? err.message : 'Could not update invoice', 'warn')
    }
  }
  const downloadInvoice = (inv: MaintInvoice) => {
    const csv = toCSV([{ [translatePortalText('Invoice')]: inv.id, [translatePortalText('Customer')]: inv.customer, [translatePortalText('Boat')]: inv.boat, [translatePortalText('Date')]: inv.date, [translatePortalText('Due')]: inv.due, [translatePortalText('Labor')]: inv.labor, [translatePortalText('Parts')]: inv.parts, [translatePortalText('Discount')]: inv.discount, [translatePortalText('Subtotal')]: inv.subtotal ?? '', [translatePortalText('VAT %')]: inv.vatRate ?? '', [translatePortalText('VAT')]: inv.tax, [translatePortalText('Total')]: inv.total, [translatePortalText('Status')]: translatePortalText(inv.status) }])
    download(`${inv.id}.csv`, csv, 'text/csv;charset=utf-8')
  }
  const createInvoice = async () => {
    if (!form.customer.trim() || !form.boat.trim()) return
    /**
     * No `tax` is sent. It used to be computed here as 7% of labour + parts —
     * a rate belonging to no jurisdiction this platform operates in — and the
     * server stored whatever arrived, so the browser effectively set the tax on
     * its own invoice. VAT is now derived server-side from the platform rate.
     */
    try {
      // 'draft' — the API only accepts draft|sent on create ('pending' was rejected).
      await maintenancePortalApi.createInvoice({ customerName: form.customer, boatName: form.boat, labor: form.labor, parts: form.parts, discount: 0, status: 'draft', ...(form.workOrderId ? { workOrderId: form.workOrderId } : {}) })
      await loadInvoices()
      setForm({ customer: '', boat: '', labor: 0, parts: 0, workOrderId: '' })
      setNewOpen(false)
      maintToast('Invoice created')
    } catch (err) {
      maintToast(err instanceof Error ? err.message : 'Could not create invoice', 'warn')
    }
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Billing & Payments")} sub="Labor + parts invoicing, tax, discounts, payments & refunds" icon={<Receipt className="text-violet-500" />}
        actions={<>
          <MaintViewToggle view={view} onChange={setView} />
          <button className="btn-maint" onClick={() => setNewOpen(true)}><Plus size={15} /> {translatePortalText("New invoice")}</button>
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[{ l: 'Collected · month', v: collected, p: 'SAR', t: 'text-emerald-600' }, { l: 'Outstanding', v: outstanding, p: 'SAR', t: 'text-amber-600' }, { l: 'Invoices', v: invoices.length, t: 'text-deep-900' }, { l: 'Avg job value', v: avgJobValue, p: 'SAR', t: 'text-violet-600' }].map((k, i) => (
          <motion.div key={k.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(k.l)}</p>
            <p className={`mt-1 font-display text-2xl font-extrabold ${k.t}`}><Counter value={k.v} currency={k.p} /></p>
          </motion.div>
        ))}
      </div>

      <div className="mb-4 flex gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft w-fit">
        {(['All', 'Pending', 'Paid', 'Overdue'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`relative rounded-xl px-4 py-2 text-[13px] font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {tab === t && <motion.span layoutId="bill-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500" />}
            <span className="relative z-10">{translatePortalText(t)}</span>
          </button>
        ))}
      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={byTab}
        noun="invoices"
        searchPlaceholder="Search invoices by number, customer or boat..."
      />

      {byTab.length > 0 && list.length === 0 && <NoFilterMatches noun="invoices" onClear={tf.clear} />}

      {view === 'card' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((inv, i) => (
            <motion.div key={inv.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card card-hover p-4">
              <div className="flex items-center gap-3">
                <img src={inv.avatar} className="h-11 w-11 rounded-full object-cover ring-2 ring-white shadow-soft" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] font-extrabold text-deep-900">{inv.id}</p>
                  <p className="truncate text-xs text-slate-400">{inv.customer}</p>
                </div>
                <MBadge dot={inv.status === 'Overdue'}>{inv.status}</MBadge>
              </div>
              <div className="mt-3 rounded-xl bg-sand p-3 text-xs text-slate-500">
                <p className="font-semibold text-deep-800">{inv.boat}</p>
                <p className="mt-0.5 text-[11px]">{translatePortalText("Issued")} {inv.date} {translatePortalText("· due")} {inv.due}</p>
                {/* VAT is named here because `total` includes it — without the
                  * line, "750 labor + 0 parts" sat next to a total of 862.50
                  * and the arithmetic on screen simply did not add up. */}
                <p className="mt-1.5 text-[11px]">{money(inv.labor)} {translatePortalText("labor +")} {money(inv.parts)} {translatePortalText("parts")}{inv.discount > 0 && <span className="text-emerald-600"> −{money(inv.discount)}</span>}{inv.tax > 0 && <span> + {money(inv.tax)} {translatePortalText("VAT")}{inv.vatRate ? ` (${formatPortalPercent(inv.vatRate)})` : ''}</span>}</p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="font-display text-lg font-extrabold text-deep-900">{money(inv.total)}</span>
                <div className="flex gap-1.5">
                  {inv.status === 'Pending' && <button onClick={() => setCollectTarget(inv)} className="btn-maint !py-1.5 !px-2.5 !text-[11px]">{translatePortalText("Collect")}</button>}
                  {inv.status === 'Overdue' && <button onClick={() => setRemindTarget(inv)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Send size={12} /> {translatePortalText("Remind")}</button>}
                  {inv.status === 'Paid' && <button onClick={() => setStatus(inv.id, 'Refunded')} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><RotateCcw size={12} /> {translatePortalText("Refund")}</button>}
                  <button onClick={() => downloadInvoice(inv)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200"><Download size={13} /></button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[1.5fr_1.2fr_1.2fr_1fr_0.9fr_160px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Invoice")}</span><span>{translatePortalText("Boat · dates")}</span><span>{translatePortalText("Breakdown")}</span><span>{translatePortalText("Total")}</span><span>{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {list.map((inv, i) => (
                <motion.div key={inv.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[1.5fr_1.2fr_1.2fr_1fr_0.9fr_160px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={inv.avatar} className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white shadow-soft" />
                    <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{inv.id}</p><p className="truncate text-[11px] text-slate-400">{inv.customer}</p></div>
                  </div>
                  <div className="text-xs text-slate-500 min-w-0"><p className="font-semibold text-deep-800 truncate">{inv.boat}</p><p className="text-[11px] whitespace-nowrap">{inv.date} {translatePortalText("· due")} {inv.due}</p></div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">{money(inv.labor)} + {money(inv.parts)}{inv.discount > 0 && <span className="text-emerald-600"> −{money(inv.discount)}</span>}{inv.tax > 0 && <span> + {money(inv.tax)} {translatePortalText("VAT")}</span>}</div>
                  <div className="font-display text-[15px] font-extrabold text-deep-900 whitespace-nowrap">{money(inv.total)}</div>
                  <div className="whitespace-nowrap"><MBadge dot={inv.status === 'Overdue'}>{inv.status}</MBadge></div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    {inv.status === 'Pending' && <button onClick={() => setStatus(inv.id, 'Paid')} className="btn-maint !py-1.5 !px-2.5 !text-[11px]">{translatePortalText("Collect")}</button>}
                    {inv.status === 'Overdue' && <button onClick={() => setRemindTarget(inv)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Send size={12} /> {translatePortalText("Remind")}</button>}
                    {inv.status === 'Paid' && <button onClick={() => setStatus(inv.id, 'Refunded')} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><RotateCcw size={12} /> {translatePortalText("Refund")}</button>}
                    <button onClick={() => downloadInvoice(inv)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200"><Download size={13} /></button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
          <TablePagination state={tf} noun="invoices" />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title={translatePortalText("Payment methods")} sub={translatePortalText("How customers settle")}>
          <div className="space-y-2.5">
            {[{ icon: '💳', m: 'Card on file', pct: 42 }, { icon: '🏦', m: 'Credit account', pct: 33 }, { icon: '👛', m: 'BoatPro wallet', pct: 15 }, { icon: '💵', m: 'Wire / cash', pct: 10 }].map(p => (
              <div key={p.m} className="flex items-center gap-3">
                <span className="w-36 text-xs font-semibold text-deep-800">{p.icon} {translatePortalText(p.m)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><motion.div initial={{ width: 0 }} animate={{ width: `${p.pct}%` }} transition={{ duration: 1 }} className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400" /></div>
                <span className="w-10 text-right text-xs font-bold text-slate-400">{formatPortalPercent(p.pct)}</span>
              </div>
            ))}
          </div>
        </Section>
        {/*
          * The real rate, read from the platform settings.
          *
          * This panel used to list invented rules — a 7% "marine service tax",
          * a 6% parts tax, an "Emergency callout +$150" quoted in dollars on a
          * riyal platform — none of which any code applied. A workshop reading
          * it was told its invoices carried 7% tax while they carried 15% VAT.
          */}
        <Section title={translatePortalText("Tax")} sub={translatePortalText("Applied at invoicing, set by the platform")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl bg-sand px-3 py-2.5 text-xs">
              <span className="font-semibold text-deep-800">{translatePortalText("VAT on labor & parts")}</span>
              <b className="text-violet-600">{vatRatePct === null ? '—' : formatPortalPercent(vatRatePct)}</b>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {translatePortalText("Charged on the invoice subtotal after any discount. Set by the platform administrator.")}
          </p>
        </Section>
      </div>

      {/* ── Bank Payout & Direct Settlement Section ── */}
      <div id="section-bank" className="mt-5 transition-all duration-500 rounded-2xl">
        <Section
          title={translatePortalText("Bank Payout & Direct Settlement")}
          sub={translatePortalText("Account details for automatic direct bank disbursement of work order earnings and customer card payments")}
          actions={
            <button
              id="payout"
              className="btn-maint !py-1.5 !px-3 text-xs"
              onClick={() => setBankModalOpen(true)}
            >
              <Edit3 size={13} /> {shop?.bank?.iban ? 'Edit Bank Details' : 'Configure Bank Details'}
            </button>
          }
        >
          <div id="bank_details" className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Landmark className="text-violet-600 h-4 w-4" />
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{translatePortalText("Financial Institution")}</span>
              </div>
              <p className="text-sm font-bold text-deep-900 dark:text-white">
                {shop?.bank?.bankName || translatePortalText("Not Set")}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {shop?.bank?.swiftCode ? <><span>{translatePortalText("SWIFT code")}:</span> <bdi dir="ltr">{shop.bank.swiftCode}</bdi></> : translatePortalText("Local Saudi Bank Settlement")}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="text-violet-600 h-4 w-4" />
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{translatePortalText("Beneficiary / Account Name")}</span>
              </div>
              <p className="text-sm font-bold text-deep-900 dark:text-white truncate">
                {shop?.bank?.accountHolderName || translatePortalText("Not Set")}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {shop?.bank?.accountNumber ? <><span>{translatePortalText("Account number")}:</span> <bdi dir="ltr">{shop.bank.accountNumber}</bdi></> : translatePortalText("Official Corporate Entity")}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="text-violet-600 h-4 w-4" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{translatePortalText("IBAN Number")}</span>
                </div>
                {shop?.bank?.iban ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
                    <ShieldCheck size={11} /> {translatePortalText("Verified")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 dark:bg-rose-950 px-2 py-0.5 rounded-full">
                    <AlertCircle size={11} /> {translatePortalText("Missing")}
                  </span>
                )}
              </div>
              <p className="font-mono text-xs font-bold text-deep-900 dark:text-white tracking-wide">
                {shop?.bank?.iban || '—'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Weekly manual bank transfer payout")}</p>
            </div>
          </div>
        </Section>
      </div>

      {/* ── Workshop Weekly Payouts & Receipts ── */}
      <VendorWeeklyPayouts title={translatePortalText("Workshop Weekly Payouts & Transfer Receipts")} accent="violet" />

      <Modal open={bankModalOpen} onClose={() => setBankModalOpen(false)} title={translatePortalText("🏦 Bank Payout & Settlement Account")}>
        <div className="space-y-4 text-sm">
          <div className="rounded-xl bg-violet-50 dark:bg-violet-950/40 p-3.5 border border-violet-100 dark:border-violet-900/50 text-xs text-violet-800 dark:text-violet-200">
            <p className="font-bold mb-0.5">{translatePortalText("Weekly Work Order Earnings Settlement")}</p>
            <p className="text-[11px] text-violet-700/80 dark:text-violet-300/80">
              {translatePortalText("Disbursements from customer card payments, mobile emergency callouts, and completed work orders are wired weekly to this IBAN account.")}
            </p>
          </div>

          {/* `id="bank"` stays on the wrapper: `focusTarget` scrolls to it from
              the readiness checklist's deep links. */}
          <div id="bank">
            <BankDetailsFields
              value={bankForm}
              onChange={setBankForm}
              errors={bankErrors}
              showAccountNumber
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost text-xs" onClick={() => setBankModalOpen(false)}>
              {translatePortalText("Cancel")}
            </button>
            <button
              disabled={bankSaving || (!bankForm.iban.trim() && !bankForm.accountNumber.trim())}
              onClick={saveBank}
              className="btn-maint text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save size={14} /> {bankSaving ? translatePortalText("Saving…") : translatePortalText("Save Payout Details")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={translatePortalText("🧾 New invoice")}>
        <div className="space-y-3">
          <div>
            <label className="label">{translatePortalText("Bill a work order (optional)")}</label>
            <select className="input" value={form.workOrderId} onChange={e => pickWorkOrder(e.target.value)}>
              <option value="">{translatePortalText("Manual invoice — enter amounts below")}</option>
              {billableOrders.map(o => (
                <option key={o.id} value={o.id}>{o.code} · {o.boatName} — {localizedField(o, 'title') ?? o.title}</option>
              ))}
            </select>
            {form.workOrderId && <p className="mt-1 text-xs text-slate-400">{translatePortalText("Labour and parts pulled from the job — adjust below if needed.")}</p>}
          </div>
          <div><label className="label">{translatePortalText("Customer")}</label><input className="input" value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))} placeholder={translatePortalText("Customer name")} /></div>
          <div><label className="label">{translatePortalText("Boat")}</label><input className="input" value={form.boat} onChange={e => setForm(f => ({ ...f, boat: e.target.value }))} placeholder={translatePortalText("Boat name")} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">{translatePortalText("Labor ($)")}</label><input type="number" min={0} className="input" value={form.labor} onChange={e => setForm(f => ({ ...f, labor: Math.max(0, Number(e.target.value)) }))} /></div>
            <div><label className="label">{translatePortalText("Parts ($)")}</label><input type="number" min={0} className="input" value={form.parts} onChange={e => setForm(f => ({ ...f, parts: Math.max(0, Number(e.target.value)) }))} /></div>
          </div>
          <p className="text-xs text-slate-400">{translatePortalText("Tax (7%) and total are calculated automatically.")}</p>
          <button onClick={createInvoice} className="btn-maint w-full !justify-center">{translatePortalText("Create invoice")}</button>
        </div>
      </Modal>

      <Modal open={!!remindTarget} onClose={() => setRemindTarget(null)} title={translatePortalText("✉️ Send payment reminder")}>
        {remindTarget && (
          <div className="space-y-3">
            <div className="rounded-xl bg-sand p-3 text-sm text-slate-600">
              {translatePortalText("To:")} <b className="text-deep-900">{remindTarget.customer}</b><br />
              {translatePortalText("Subject: Payment reminder — invoice")} {remindTarget.id}<br /><br />
              {translatePortalText("Your invoice")} {remindTarget.id} {translatePortalText("for")} {remindTarget.boat} ({money(remindTarget.total)}{translatePortalText(") was due")} {remindTarget.due}{translatePortalText(". Please settle at your earliest convenience.")}
            </div>
            <button onClick={() => { maintToast(`Reminder sent to ${remindTarget.customer}`, 'info'); setRemindTarget(null) }} className="btn-maint w-full !justify-center"><Send size={14} /> {translatePortalText("Send reminder")}</button>
          </div>
        )}
      </Modal>

      <CollectPaymentModal
        open={!!collectTarget}
        invoice={collectTarget}
        onClose={() => setCollectTarget(null)}
        onPaid={loadInvoices}
      />
    </PageWrap>
  )
}

/**
 * Cash settles immediately through the same paid-invoice path the shop already
 * uses. The QR/link opens a real HyperPay COPYandPAY checkout hosted by the
 * backend (see hostedCheckout.controller.ts) — once the customer pays, the
 * backend verifies it with HyperPay and marks the invoice paid automatically,
 * no confirmation needed from the shop.
 */
function CollectPaymentModal({ open, invoice, onClose, onPaid }: { open: boolean; invoice: MaintInvoice | null; onClose: () => void; onPaid: () => void }) {
  const [mode, setMode] = useState<'choose' | 'qr'>('choose')
  const [qr, setQr] = useState<{ qrDataUrl: string; payUrl: string; reference: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (open) { setMode('choose'); setQr(null) } }, [open])

  const markPaid = async (method: string, note: string) => {
    if (!invoice) return
    try {
      await maintenancePortalApi.updateInvoice(invoice.id, { status: 'paid', method })
      maintToast(`${invoice.id} marked paid — ${note}`)
      onPaid(); onClose()
    } catch (err) {
      maintToast(err instanceof Error ? err.message : 'Could not mark invoice paid', 'warn')
    }
  }

  const generateQr = async () => {
    if (!invoice) return
    setLoading(true)
    try {
      const res = await maintenancePortalApi.generatePaymentQr(invoice.id)
      setQr(res.data)
      setMode('qr')
    } catch (err) {
      maintToast(err instanceof Error ? err.message : 'Could not generate payment QR', 'warn')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={invoice ? `💳 ${translatePortalText('Collect payment')} — ${invoice.id}` : ''}>
      {invoice && mode === 'choose' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">{translatePortalText("Total due:")} <b className="text-deep-900">{money(invoice.total)}</b></p>
          <button onClick={() => void markPaid('cash', 'cash')} className="btn-maint w-full !justify-center">{translatePortalText("💵 Cash received")}</button>
          <button onClick={() => void generateQr()} disabled={loading} className="btn-ghost w-full !justify-center disabled:opacity-50">
            {loading ? translatePortalText("Generating…") : translatePortalText("📱 Generate payment QR / link")}
          </button>
        </div>
      )}
      {invoice && mode === 'qr' && qr && (
        <div className="space-y-3 text-center">
          <img src={qr.qrDataUrl} alt={translatePortalText("Payment QR")} className="mx-auto h-48 w-48 rounded-xl border border-slate-100" />
          <p className="text-xs text-slate-400">
            {translatePortalText("Reference")} {qr.reference} {translatePortalText("— have the customer scan this QR or open the link below to pay by card/mada.\r\n            The invoice is marked paid automatically once HyperPay confirms the charge.")}
          </p>
          <a href={qr.payUrl} target="_blank" rel="noreferrer" className="btn-ghost w-full !justify-center break-all !text-[11px]">
            {qr.payUrl}
          </a>
          <button onClick={() => void markPaid('bank_transfer', 'collected another way')} className="btn-maint w-full !justify-center">{translatePortalText("Mark as paid manually")}</button>
          <button onClick={() => setMode('choose')} className="btn-ghost w-full !justify-center">{translatePortalText("Back")}</button>
        </div>
      )}
    </Modal>
  )
}

// ══════════ REPORTS (§23, §28) ══════════

/**
 * The workshop's Reports & Analytics: an overview, and every report it can run.
 *
 * This page used to draw four charts from the shop's own invoices and work orders and
 * offer seven "reports" that were just a table in a pop-up with a CSV button — none of
 * which matched the real report library rendered underneath them. The library is the
 * page now, with a short "at a glance" panel (the same four charts, one at a time)
 * above it. There is no customer-satisfaction report: maintenance is not a reviewable
 * target in the data model, so it was dropped rather than shown with invented stars.
 * See `ReportsCenter`.
 */
export function MaintReports() {
  return (
    <ReportsCenter
      portal="maintenance"
      basePath="/maint/reports"
      tone="violet"
      header={
        <MaintHeader
          title={translatePortalText("Reports & Analytics")}
          sub={translatePortalText("How your workshop is doing at a glance, and every report you can open or download.")}
          icon={<BarChart3 className="text-violet-500" />}
        />
      }
      snapshot={<MaintReportsSnapshot />}
    />
  )
}
