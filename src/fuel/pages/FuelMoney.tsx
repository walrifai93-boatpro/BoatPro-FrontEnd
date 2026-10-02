import React, { useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { ReportsCenter } from '../../shared/reports/ReportsCenter'
import { FuelReportsSnapshot } from './FuelReportsSnapshot'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Download, Send, TrendingUp, TicketPercent, Building2, CreditCard, Landmark, ShieldCheck } from 'lucide-react'
import { money, shortDate, toCreditAccount, toInvoice, type FuelInvoice } from '../fuelData'
import { fuelApi, type ApiFuelCoupon } from '../fuelApi'
import { useFuel, useFuelResource } from '../fuelStore'
import { Section, Modal, StatCard, Progress, LoadingState, ErrorState, EmptyState, LoadingButton, toast, download, toCSV } from '../../ui'
import { FuelHeader, FBadge, Metric } from '../fuelUi'
import { portalLocale, translatePortalText } from '../../i18n/runtime'
import { StationApprovalNotice, isStationUnapproved } from '../components/StationApprovalNotice'
import { currencySign } from '../../currency'
import { BankDetailsFields } from '../../components/BankDetailsFields'
import { VendorWeeklyPayouts } from '../../components/VendorWeeklyPayouts'
import {
  EMPTY_BANK_DETAILS,
  bankPayload,
  validateBankDetails,
  type BankDetailsErrors,
  type BankDetailsValue,
} from '../../utils/iban'

// ═════════════════════════════════════════════════════════════
// Pricing Management
// ═════════════════════════════════════════════════════════════
export function FuelPricing() {
  const location = useLocation()
  const { refresh, currency, currentStationId, currentStation, isAllStations } = useFuel()
  const res = useFuelResource(
    () => fuelApi.pricing(isAllStations ? undefined : currentStationId ?? undefined, isAllStations).then(r => r.data),
    [currentStationId, isAllStations],
  )

  const isUnapproved = !isAllStations && isStationUnapproved(currentStation)

  const [prices, setPrices] = useState<Record<string, number>>({})
  const [couponOpen, setCouponOpen] = useState(false)
  const [newCoupon, setNewCoupon] = useState({ code: '', desc: '', discount: '', expires: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const handleFocus = (e: any) => {
      const id = e.detail?.id || location.hash.replace(/^#/, '')
      if (id === 'products' || id === 'pricing' || id === 'fuel_prices') {
        const el = document.getElementById('products') || document.getElementById('section-pricing')
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('ring-4', 'ring-amber-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
          setTimeout(() => el.classList.remove('ring-4', 'ring-amber-500', 'ring-offset-2'), 2500)
        }
      }
    }
    handleFocus({})
    window.addEventListener('boatpro-focus-field', handleFocus)
    return () => window.removeEventListener('boatpro-focus-field', handleFocus)
  }, [location.hash])

  // Seed the editable price fields once the catalogue arrives, and whenever it
  // changes underneath us (another operator publishing a new list).
  useEffect(() => {
    if (!res.data) return
    setPrices(Object.fromEntries(res.data.products.map(p => [p.key, p.price])))
  }, [res.data])

  const products = res.data?.products ?? []
  const coupons = res.data?.coupons ?? []

  const dirty = useMemo(
    () => products.filter(p => prices[p.key] !== undefined && prices[p.key] !== p.price),
    [products, prices],
  )

  const publish = async () => {
    if (isUnapproved) {
      toast(translatePortalText(`Cannot publish prices for station "${currentStation?.name}" while awaiting admin approval`), 'warn')
      return
    }
    if (!dirty.length) { toast(translatePortalText("No price changes to publish"), 'info'); return }
    setBusy(true)
    try {
      await Promise.all(dirty.map(p => fuelApi.updateProduct(p._id, { price: prices[p.key] })))
      await res.reload()
      void refresh()
      window.dispatchEvent(new CustomEvent('boatpro-station-updated'))
      toast(translatePortalText(`Price list published — ${dirty.length} product${dirty.length === 1 ? '' : 's'} updated`))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not publish the price list'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const createCoupon = async () => {
    const code = newCoupon.code.trim().toUpperCase()
    // The discount field is free text ("10% off diesel") — take the percentage.
    const pct = parseFloat(newCoupon.discount.replace(/[^\d.]/g, ''))
    if (!code || !(pct > 0)) { toast(translatePortalText("Enter a code and a percentage discount"), 'warn'); return }
    setBusy(true)
    try {
      await fuelApi.createCoupon({
        code,
        description: newCoupon.desc.trim() || 'Promo code',
        discountPct: Math.min(100, pct),
        expiresAt: newCoupon.expires || undefined,
      })
      setNewCoupon({ code: '', desc: '', discount: '', expires: '' })
      setCouponOpen(false)
      await res.reload()
      toast(translatePortalText(`Coupon created — ${code}`))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not create the coupon'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  if (res.loading && !res.data) return <LoadingState label={translatePortalText("Loading pricing…")} rows={4} />
  if (res.error) return <ErrorState error={translatePortalText(res.error)} onRetry={() => void res.reload()} />

  /**
   * The station's own currency, for the price *entry* fields below.
   *
   * Deliberately not the display currency and deliberately not converted: the
   * operator is typing the price they sell at, and that number is stored as
   * given. Only the sign mapping is shared now, instead of being re-derived
   * with an inline `currency === 'USD' ? '$' : currency`.
   */
  const symbol = currencySign(currency)

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Pricing Management")} sub={translatePortalText("Fuel prices, dynamic rules, discounts, memberships, taxes & coupons")}
        icon={<span className="text-2xl">💲</span>}
        actions={<LoadingButton loading={busy} disabled={isUnapproved} className="btn-fuel" onClick={publish}>{translatePortalText("Publish price list")}{dirty.length > 0 ? ` (${dirty.length})` : ""}</LoadingButton>} />

      <StationApprovalNotice />

      {/* editable prices */}
      <Section title={translatePortalText("Fuel price management")} sub={translatePortalText("Live prices shown to customers — edit and publish")}>
        {products.length === 0 ? <EmptyState icon="💲" text={translatePortalText("No products in your catalogue yet")} /> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {products.slice(0, 6).map((f, i) => {
              const changed = prices[f.key] !== undefined && prices[f.key] !== f.price
              return (
                <motion.div key={f.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="card p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xl">{f.icon}</span>
                    {changed && <span className="flex items-center gap-1 text-[10px] font-extrabold text-emerald-600"><TrendingUp size={11} />{translatePortalText(" unpublished")}</span>}
                  </div>
                  <p className="mt-1.5 text-[12px] font-extrabold text-deep-900">{f.name}</p>
                  <div className="mt-2 flex items-center gap-1">
                    <span className="text-sm font-bold text-slate-400">{symbol}</span>
                    <input type="number" step="0.05" value={prices[f.key] ?? f.price}
                      onChange={e => setPrices(p => ({ ...p, [f.key]: +e.target.value }))}
                      className="input !px-2 !py-1.5 font-display !text-base font-extrabold" />
                    <span className="text-[10px] font-bold text-slate-400">/{f.unit}</span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </Section>

      {/* coupons */}
      <Section title={translatePortalText("Coupons & promotions")} sub={translatePortalText("Discount codes redeemable at checkout")}
        actions={<button className="btn-fuel !py-1.5 !px-3 text-xs" onClick={() => setCouponOpen(true)}><TicketPercent size={13} />{translatePortalText(" New coupon")}</button>}>
        {coupons.length === 0 ? <EmptyState icon="🎟️" text={translatePortalText("No promo codes yet")} /> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {coupons.map((c: ApiFuelCoupon, i) => {
              const max = c.usageLimit ?? 0
              const live = c.isActive && (!c.expiresAt || new Date(c.expiresAt) > new Date())
              return (
                <motion.div key={c._id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06 }}
                  className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-4 ${live ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                  <span className="absolute -start-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white border-2 border-dashed border-amber-300" />
                  <span className="absolute -end-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white border-2 border-dashed border-amber-300" />
                  <p className="font-display text-lg font-extrabold tracking-widest text-deep-900">{c.code}</p>
                  <p className="text-xs font-bold text-amber-600">{c.discountPct}{translatePortalText("% off")}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{c.description ?? translatePortalText('Promo code')}{translatePortalText(" · expires ")}{shortDate(c.expiresAt)}</p>
                  <div className="mt-2.5"><Progress pct={max ? Math.round(c.usedCount / max * 100) : 0} tone="bg-gradient-to-r from-amber-500 to-orange-400" /></div>
                  <p className="mt-1 text-[10px] font-bold text-slate-400">{c.usedCount} / {max || '∞'}{translatePortalText(" redeemed")}</p>
                </motion.div>
              )
            })}
          </div>
        )}
      </Section>

      <Modal open={couponOpen} onClose={() => setCouponOpen(false)} title={translatePortalText("🎟️ New coupon")}>
        <div className="space-y-3">
          <div><label className="label">{translatePortalText("Code")}</label>
            <input className="input" placeholder={translatePortalText("e.g. SUNSET26")} value={newCoupon.code}
              onChange={e => setNewCoupon(c => ({ ...c, code: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Description")}</label>
            <input className="input" placeholder={translatePortalText("e.g. Sunset season promo")} value={newCoupon.desc}
              onChange={e => setNewCoupon(c => ({ ...c, desc: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Discount")}</label>
            <input className="input" placeholder={translatePortalText("e.g. 10% off diesel")} value={newCoupon.discount}
              onChange={e => setNewCoupon(c => ({ ...c, discount: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Expires")}</label>
            <input type="date" className="input" value={newCoupon.expires}
              onChange={e => setNewCoupon(c => ({ ...c, expires: e.target.value }))} /></div>
          <button className="btn-fuel w-full !justify-center" disabled={busy} onClick={createCoupon}>{translatePortalText("Create coupon")}</button>
        </div>
      </Modal>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Billing & Payments
// ═════════════════════════════════════════════════════════════
export function FuelBilling() {
  const location = useLocation()
  const { station, refresh } = useFuel()
  const res = useFuelResource(() => fuelApi.billing({ limit: 100 }).then(r => r.data), [])

  const [sel, setSel] = useState<FuelInvoice | null>(null)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [newInvoice, setNewInvoice] = useState({ customer: '', items: '', amount: '', due: '' })
  const [busy, setBusy] = useState(false)

  // Bank payout state & form
  const [bankOpen, setBankOpen] = useState(false)
  const [bankForm, setBankForm] = useState<BankDetailsValue>(EMPTY_BANK_DETAILS)
  const [bankErrors, setBankErrors] = useState<BankDetailsErrors>({})

  useEffect(() => {
    if (station?.bank) {
      setBankForm({
        bankName: station.bank.bankName || '',
        accountHolderName: station.bank.accountHolderName || '',
        iban: station.bank.iban || '',
        accountNumber: station.bank.accountNumber || '',
        swiftCode: station.bank.swiftCode || '',
      })
    }
  }, [station?.bank])

  // Handle focus field events for #payout, #bank, #bank_details
  useEffect(() => {
    const handleFocus = (e: any) => {
      const id = e.detail?.id || location.hash.replace(/^#/, '')
      if (id === 'payout' || id === 'bank' || id === 'bank_details' || id === 'section-bank') {
        setBankOpen(true)
        const el = document.getElementById('section-bank') || document.getElementById('payout')
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('ring-4', 'ring-amber-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
          setTimeout(() => el.classList.remove('ring-4', 'ring-amber-500', 'ring-offset-2'), 2500)
        }
      }
    }
    const hash = location.hash.replace(/^#/, '')
    if (hash === 'payout' || hash === 'bank' || hash === 'bank_details') {
      setBankOpen(true)
    }
    window.addEventListener('boatpro-focus-field', handleFocus)
    return () => window.removeEventListener('boatpro-focus-field', handleFocus)
  }, [location.hash])

  const saveBankDetails = async () => {
    // The checksum, the holder name and the "somewhere to send it" rule, all
    // through the shared check — this modal used to test only the last of them.
    const bankIssues = validateBankDetails(bankForm, { require: true })
    setBankErrors(bankIssues)
    if (Object.keys(bankIssues).length) return

    setBusy(true)
    try {
      await fuelApi.saveStation(
        {
          bank: bankPayload(bankForm),
        },
        station?.id ? { stationId: station.id } : undefined,
      )
      setBankOpen(false)
      toast(translatePortalText("Bank payout account saved successfully"), 'success')
      window.dispatchEvent(new CustomEvent('boatpro-station-updated'))
      void refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save bank details'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const invoices = useMemo(() => (res.data?.items ?? []).map(toInvoice), [res.data])

  const invCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (inv) => [inv.number, inv.customer, inv.items],
    filters: [
      { key: 'status', label: translatePortalText("Status"), get: (inv) => inv.status },
      { key: 'customer', label: translatePortalText("Customer"), get: (inv) => inv.customer },
      {
        key: 'size',
        label: translatePortalText("Amount"),
        options: [
          { value: 'high', label: translatePortalText("1,000 and over") },
          { value: 'mid', label: translatePortalText("250-999") },
          { value: 'low', label: translatePortalText("Under 250") },
        ],
        get: (inv) => String(inv.amount ?? 0),
        match: (inv, v) => {
          const a = Number(inv.amount ?? 0)
          if (v === 'high') return a >= 1000
          if (v === 'mid') return a >= 250 && a < 1000
          return a < 250
        },
      },
    ],
  }), [])
  const invTf = useTableFilters(invoices, invCfg)
  const creditAccounts = useMemo(() => (res.data?.creditAccounts ?? []).map(toCreditAccount), [res.data])
  const totals = res.data?.totals

  const outstanding = totals?.outstanding ?? 0
  const collected = totals?.month ?? 0
  const refunded = invoices.filter(i => i.status === 'Refunded').reduce((s, i) => s + i.amount, 0)

  const after = async (msg: string, tone: 'success' | 'warn' = 'success') => {
    setSel(null)
    await res.reload()
    void refresh()
    toast(translatePortalText(msg), tone)
  }

  const downloadFinancialReport = () => {
    const csv = toCSV(invoices.map(i => ({
      Invoice: i.number, Customer: i.customer, Date: i.date, Due: i.due, Items: i.items, Amount: i.amount, Status: i.status,
    })), ['Invoice', 'Customer', 'Date', 'Due', 'Items', 'Amount', 'Status'])
    download(`${(station?.name ?? 'fuel-station').toLowerCase().replace(/\s+/g, '-')}-financial-report.csv`, csv, 'text/csv;charset=utf-8')
    toast(translatePortalText("Financial report downloaded"))
  }

  const createInvoice = async () => {
    const customer = newInvoice.customer.trim()
    const amount = parseFloat(newInvoice.amount)
    if (!customer || !(amount > 0)) { toast(translatePortalText("Enter a customer and a valid amount"), 'warn'); return }
    setBusy(true)
    try {
      const description = newInvoice.items.trim() || 'Fuel & services'
      const { data } = await fuelApi.createInvoice({
        customerName: customer,
        items: [{ description, quantity: 1, unitPrice: amount, total: amount }],
        // The picker gives a date; the server wants days of terms or an explicit due date.
        termsDays: newInvoice.due ? Math.max(0, Math.ceil((new Date(newInvoice.due).getTime() - Date.now()) / 86400000)) : 7,
      })
      setNewInvoice({ customer: '', items: '', amount: '', due: '' })
      setInvoiceOpen(false)
      await after(`Invoice ${data.invoice.invoiceNumber} created`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not create the invoice'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const collect = async (i: FuelInvoice, method = 'card') => {
    setBusy(true)
    try {
      await fuelApi.payInvoice(i.id, method)
      await after(`Payment collected for ${i.number}`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not record the payment'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const issueRefund = async (i: FuelInvoice) => {
    setBusy(true)
    try {
      await fuelApi.refundInvoice(i.id)
      await after('Refund initiated', 'warn')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not issue the refund'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const downloadReceipt = (i: FuelInvoice) => {
    if (i.pdfUrl) { window.open(i.pdfUrl, '_blank'); return }
    const content = [
      `${translatePortalText('Invoice')} ${i.number}`,
      translatePortalText(`Customer: ${i.customer}`),
      translatePortalText(`Items: ${i.items}`),
      translatePortalText(`Amount: ${money(i.amount)}`),
      translatePortalText(`Method: ${i.method}`),
      translatePortalText(`Issued: ${i.date}`),
      translatePortalText(`Due: ${i.due}`),
      translatePortalText(`Status: ${i.status}`),
    ].join('\n')
    download(`${i.number}.txt`, content)
    toast(translatePortalText("Receipt downloaded"))
  }

  if (res.loading && !res.data) return <LoadingState label={translatePortalText("Loading billing…")} rows={5} />
  if (res.error) return <ErrorState error={translatePortalText(res.error)} onRetry={() => void res.reload()} />

  // Settled fuel payments this month, split by how the customer paid.
  const methodMix = (() => {
    const paid = invoices.filter(i => i.status === 'Paid')
    const buckets = new Map<string, number>()
    for (const i of paid) buckets.set(i.method || 'Other', (buckets.get(i.method || 'Other') ?? 0) + i.amount)
    const total = [...buckets.values()].reduce((s, v) => s + v, 0)
    return [...buckets.entries()]
      .map(([m, v]) => ({ m, pct: total ? Math.round((v / total) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct)
  })()

  const hasBankDetails = Boolean(station?.bank?.iban || station?.bank?.accountNumber)

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Billing & Payments")} sub={translatePortalText("Invoices, collections, wallets, credit accounts, refunds & outstanding balances")}
        icon={<span className="text-2xl">🧾</span>}
        actions={<>
          <button className="btn-ghost" onClick={downloadFinancialReport}><Download size={15} />{translatePortalText(" Financial report")}</button>
          <button className="btn-fuel" onClick={() => setInvoiceOpen(true)}>{translatePortalText("+ New invoice")}</button>
        </>} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard i={0} label={translatePortalText("Collected this month")} value={collected} currency="SAR" icon={<span>💵</span>} tone="green" to="/fuel/reports" />
        <StatCard i={1} label={translatePortalText("Outstanding")} value={outstanding} currency="SAR" icon={<span>⏳</span>} tone="amber" to="/fuel/billing" />
        <StatCard i={2} label={translatePortalText("Credit exposure")} value={totals?.creditExposure ?? 0} currency="SAR" icon={<span>📒</span>} tone="violet" to="/fuel/billing" />
        <StatCard i={3} label={translatePortalText("Refunds issued")} value={refunded} currency="SAR" icon={<span>↩️</span>} tone="rose" to="/fuel/billing" />
      </div>

      {/* ── Bank Payout & Direct Settlement Section ── */}
      <div id="section-bank" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-500">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20">
              <Landmark className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-bold text-slate-900">{translatePortalText("Bank Payout & Direct Settlement")}</h3>
                {hasBankDetails ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-600/20">
                    <ShieldCheck className="h-3.5 w-3.5" />{translatePortalText(" Payout Active")}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 ring-1 ring-amber-600/20">{translatePortalText("Action Required")}</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {hasBankDetails
                  ? translatePortalText(`Direct earnings disbursed to ${station?.bank?.bankName || translatePortalText('bank')} (${station?.bank?.iban || station?.bank?.accountNumber})`)
                  : translatePortalText("Add a verified Saudi IBAN or local bank account for bunkering earnings disbursement.")}
              </p>
            </div>
          </div>
          <button
            id="payout"
            onClick={() => setBankOpen(true)}
            className="btn-fuel !py-2 !px-4 text-xs font-bold shadow-xs hover:shadow-md"
          >
            <CreditCard className="h-4 w-4 me-1.5 inline" />
            {hasBankDetails ? translatePortalText("Edit Bank Details") : translatePortalText("Set Bank Account")}
          </button>
        </div>

        {hasBankDetails && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 pt-3 text-xs">
            <div className="rounded-xl bg-slate-50 p-2.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">{translatePortalText("Beneficiary Name")}</span>
              <span className="font-semibold text-slate-800">{station?.bank?.accountHolderName || '—'}</span>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">{translatePortalText("IBAN / Account")}</span>
              <span className="font-mono font-bold text-slate-800">{station?.bank?.iban || station?.bank?.accountNumber || '—'}</span>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">{translatePortalText("Bank / SWIFT")}</span>
              <span className="font-semibold text-slate-800">{station?.bank?.bankName || translatePortalText('Not provided')} {station?.bank?.swiftCode ? `(${station?.bank?.swiftCode})` : translatePortalText("")}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* invoices */}
        <Section title={translatePortalText("Invoices")} sub={translatePortalText("Fuel sales, deliveries & retail")} className="lg:col-span-2">
          <TableToolbar state={invTf} config={invCfg} rows={invoices} noun="invoices"
            searchPlaceholder="Search invoices by number, customer or item..." />
          {invoices.length === 0 ? <EmptyState icon="🧾" text={translatePortalText("No invoices raised yet")} /> : invTf.filtered.length === 0 ? (
            <NoFilterMatches noun="invoices" onClear={invTf.clear} />
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[760px]">
                <thead><tr className="border-b border-slate-100">
                  <th className="th">{translatePortalText("Invoice")}</th><th className="th">{translatePortalText("Customer")}</th><th className="th">{translatePortalText("Items")}</th><th className="th">{translatePortalText("Amount")}</th><th className="th">{translatePortalText("Status")}</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {invTf.pagedRows.map((inv, i) => (
                    <motion.tr key={inv.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
                      className="border-b border-slate-50 transition hover:bg-amber-50/40 cursor-pointer" onClick={() => setSel(inv)}>
                      <td className="td"><p className="font-extrabold">{inv.number}</p><p className="text-[11px] text-slate-400">{inv.date}{translatePortalText(" · due ")}{inv.due}</p></td>
                      <td className="td"><span className="flex items-center gap-2"><img src={inv.avatar} className="h-7 w-7 rounded-full object-cover" />{inv.customer}</span></td>
                      <td className="td max-w-[220px] truncate text-slate-500 text-xs">{inv.items}</td>
                      <td className="td font-extrabold">{money(inv.amount)}</td>
                      <td className="td"><FBadge dot={inv.status === 'Overdue'}>{inv.status}</FBadge></td>
                      <td className="td text-right">
                        {inv.status === 'Pending' && <button className="btn-fuel !py-1 !px-2.5 text-[11px]" disabled={busy} onClick={e => { e.stopPropagation(); void collect(inv, 'card') }}><Send size={11} />{translatePortalText(" Collect")}</button>}
                        {inv.status === 'Overdue' && <button className="btn-ghost !py-1 !px-2.5 text-[11px] !text-rose-500" onClick={e => { e.stopPropagation(); toast(translatePortalText(`Reminder sent for ${inv.number}`), 'warn') }}>{translatePortalText("Remind")}</button>}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TablePagination state={invTf} noun="invoices" />
        </Section>

        {/* payment mix + credit accounts */}
        <div className="space-y-5">
          <Section title={translatePortalText("Payment methods")} sub={translatePortalText("Mix this month")}>
            <div className="space-y-2.5">
              {methodMix.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("Nothing settled yet.")}</p>}
              {methodMix.map((p, i) => (
                <motion.div key={p.m} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <div className="mb-1 flex justify-between text-xs"><span className="font-bold text-deep-800">{p.m}</span><b>{p.pct}%</b></div>
                  <Progress pct={p.pct} tone="bg-gradient-to-r from-amber-500 to-orange-400" />
                </motion.div>
              ))}
            </div>
          </Section>

          <Section title={translatePortalText("Credit accounts")} sub={translatePortalText("Commercial fleet customers")}>
            <div className="space-y-2.5">
              {creditAccounts.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("No trade accounts yet.")}</p>}
              {creditAccounts.map((c, i) => (
                <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                  className="rounded-xl border border-slate-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-extrabold text-deep-900">{c.company}</p>
                    <FBadge dot={c.status !== 'Good standing'}>{c.status}</FBadge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1"><Progress pct={c.limit ? Math.round(c.balance / c.limit * 100) : 0} tone={c.limit && c.balance / c.limit > 0.8 ? "bg-gradient-to-r from-rose-500 to-rose-400" : "bg-gradient-to-r from-amber-500 to-orange-400"} /></div>
                    <span className="text-[11px] font-bold text-slate-400">{money(c.balance)} / {money(c.limit)}</span>
                  </div>
                  <p className="mt-1 text-[10px] font-semibold text-slate-400">{translatePortalText("Terms ")}{translatePortalText(c.terms)}</p>
                </motion.div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      {/* Weekly Payouts & Transfer Receipts */}
      <VendorWeeklyPayouts title={translatePortalText("Fuel Station Weekly Payouts & Transfer Receipts")} accent="amber" />

      {/* bank details modal */}
      <Modal open={bankOpen} onClose={() => setBankOpen(false)} title={translatePortalText("🏦 Bank Payout & Settlement Account")}>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{translatePortalText("Provide the direct corporate bank details for weekly manual bank transfer of fuel bunkering revenue.")}</p>
          <BankDetailsFields
            value={bankForm}
            onChange={setBankForm}
            errors={bankErrors}
            showAccountNumber
          />
          <div className="flex gap-2 pt-2">
            <button className="btn-ghost flex-1" onClick={() => setBankOpen(false)}>{translatePortalText("Cancel")}</button>
            <button className="btn-fuel flex-1 !justify-center" disabled={busy} onClick={saveBankDetails}>
              {busy ? translatePortalText("Saving...") : translatePortalText("Save Bank Account")}
            </button>
          </div>
        </div>
      </Modal>

      {/* invoice modal */}
      <Modal open={!!sel} onClose={() => setSel(null)} title={translatePortalText(`🧾 ${sel?.number}`)}>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-2xl bg-sand p-4">
              <img src={sel.avatar} className="h-12 w-12 rounded-full object-cover" />
              <div className="flex-1">
                <p className="font-display font-extrabold text-deep-900">{sel.customer}</p>
                <p className="text-xs text-slate-400">{sel.items}</p>
              </div>
              <FBadge>{sel.status}</FBadge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric icon="💵" label={translatePortalText("Amount")} value={money(sel.amount)} />
              <Metric icon="💳" label={translatePortalText("Method")} value={translatePortalText(sel.method)} />
              <Metric icon="🗓️" label={translatePortalText("Issued")} value={sel.date} />
              <Metric icon="⏰" label={translatePortalText("Due")} value={sel.due} />
            </div>
            <div className="flex gap-2">
              <button className="btn-fuel flex-1 !justify-center" onClick={() => downloadReceipt(sel)}>{translatePortalText("Download PDF")}</button>
              {(sel.status === 'Pending' || sel.status === 'Overdue') &&
                <button className="btn-ghost" disabled={busy} onClick={() => void collect(sel, 'cash')}>{translatePortalText("Mark paid")}</button>}
              {sel.status === 'Paid' &&
                <button className="btn-ghost !text-rose-500" disabled={busy} onClick={() => void issueRefund(sel)}>{translatePortalText("Issue refund")}</button>}
            </div>
          </div>
        )}
      </Modal>

      {/* new invoice modal */}
      <Modal open={invoiceOpen} onClose={() => setInvoiceOpen(false)} title={translatePortalText("🧾 New invoice")}>
        <div className="space-y-3">
          <div><label className="label">{translatePortalText("Customer name")}</label>
            <input className="input" placeholder={translatePortalText("e.g. Marcus Webb")} value={newInvoice.customer}
              onChange={e => setNewInvoice(v => ({ ...v, customer: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Items")}</label>
            <input className="input" placeholder={translatePortalText("e.g. 380 gal Marine Diesel · Dockside")} value={newInvoice.items}
              onChange={e => setNewInvoice(v => ({ ...v, items: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Amount")}</label>
            <input type="number" step="0.01" className="input" placeholder="0.00" value={newInvoice.amount}
              onChange={e => setNewInvoice(v => ({ ...v, amount: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Due date")}</label>
            <input type="date" className="input" value={newInvoice.due}
              onChange={e => setNewInvoice(v => ({ ...v, due: e.target.value }))} /></div>
          <button className="btn-fuel w-full !justify-center" disabled={busy} onClick={createInvoice}>{translatePortalText("Create invoice")}</button>
        </div>
      </Modal>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Reports & Analytics
// ═════════════════════════════════════════════════════════════

/**
 * The fuel station's Reports & Analytics: an overview, and every report it can run.
 *
 * This page used to stack six charts, a leaderboard and a crew summary above a report
 * library with its own toolbar. The library now *is* the page, with a short "at a
 * glance" panel above it; vehicle load and crew rosters live on the pages that manage
 * vehicles and crew. See `ReportsCenter`.
 */
export function FuelReports() {
  return (
    <ReportsCenter
      portal="fuel"
      basePath="/fuel/reports"
      tone="amber"
      header={
        <FuelHeader
          title={translatePortalText("Reports & Analytics")}
          sub={translatePortalText("How your station is doing at a glance, and every report you can open or download.")}
          icon={<span className="text-2xl">📊</span>}
        />
      }
      snapshot={<FuelReportsSnapshot />}
    />
  )
}
