import React, { useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import {
  Landmark, Percent, Download, Plus, Check, Trash2, Edit3, RefreshCw,
  Wallet, CreditCard, AlertTriangle, Loader2, BanknoteIcon, Ban, ArrowRightLeft, Copy,
  FileText, ExternalLink, Eye, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { avatar } from '../adminData'
import { PageWrap, ChartTip, BOOKING_TYPE_META } from './_shared'
import { Section, Modal, toast, Counter, TableSkeleton } from '../../ui'
import { AdminHeader, ABadge } from '../adminUi'
import { confirm, confirmAndRun } from '../../async'
import { CollectionsPanel } from './AdminCollections'
import { checkIban, formatIban, normalizeIban } from '../../utils/iban'
import {
  adminPortalApi, adminApi, monetizationApi, packageLimitApi, addOnApi, planInviteApi,
  type SubscriptionPackageData, type CommissionPackageData, type CommissionType,
  type AddOnTypeData, type PlanInviteData,
  type MonetizationProvider, type MonetizationStats, type Settlement, type ModelChangeRequest,
  type LimitKeyDef, type ProviderTypeKey, type PackageLimits, fileUrl,
  type BillingSettingsData, type EffectivePlatformPolicy, TAMARA_SURFACES, TAMARA_SURFACE_LABELS,
} from '../../api'
import { isPortalArabic, translatePortalText, formatPortalNumber, formatPortalPercent, formatPortalDate, localizedField } from '../../i18n/runtime'
import { formatMoney } from '../../live'

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  boat_provider: 'Boat Provider',
  marina_provider: 'Marina Provider',
  fuel_provider: 'Fuel Provider',
  maintenance_provider: 'Maintenance Provider',
}

const PROVIDER_TYPE_ICONS: Record<string, string> = {
  boat_provider: '🛥️',
  marina_provider: '⚓',
  fuel_provider: '⛽',
  maintenance_provider: '🔧',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fmt = (n: number) => formatPortalNumber(n, { maximumFractionDigits: 2 })
const fmtDate = (d?: string | null) => (d ? formatPortalDate(new Date(d)) : '—')
const verticalLabel = (value: unknown) => {
  const key = String(value ?? 'other')
  return translatePortalText(BOOKING_TYPE_META[key]?.label ?? (key === 'other' ? 'Other' : key))
}

function formatExpiryDays(value: number, direction: 'ago' | 'left'): string {
  const days = Math.abs(Math.trunc(value))
  if (!isPortalArabic()) return `${formatPortalNumber(days)}d ${direction}`
  const amount = formatPortalNumber(days)
  const remainder = days % 100
  const count = days === 1 ? 'يوم واحد' : days === 2 ? 'يومان' : remainder >= 3 && remainder <= 10 ? `${amount} أيام` : remainder >= 11 && remainder <= 99 ? `${amount} يومًا` : `${amount} يوم`
  return direction === 'ago' ? `منذ ${count}` : `متبقي ${count}`
}

/** Colour-codes how close a subscription is to lapsing. */
function expiryTone(expiry?: string | null): { label: string; cls: string } {
  if (!expiry) return { label: translatePortalText('No expiry'), cls: 'bg-slate-100 text-slate-500' }
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { label: `${translatePortalText('Expired')} ${formatExpiryDays(days, 'ago')}`, cls: 'bg-rose-50 text-rose-700' }
  if (days <= 7) return { label: formatExpiryDays(days, 'left'), cls: 'bg-amber-50 text-amber-700' }
  return { label: formatExpiryDays(days, 'left'), cls: 'bg-emerald-50 text-emerald-700' }
}

// ══════════ PAYMENTS & PAYOUTS ══════════
// Money actually moving, in each direction, on one screen:
//   Transactions     — customers paying online.
//   Weekly Payouts   — the platform paying providers what those payments earned.
//   Cash Collections — providers paying the platform its commission on cash bookings.
// These were three separate sidebar entries, with payouts filed under the
// packages screen. What a provider is charged is configured on Packages & Pricing.
const PAY_TABS = ['transactions', 'payouts', 'collections'] as const
type PayTab = (typeof PAY_TABS)[number]
const PAY_TAB_LABELS: Record<PayTab, string> = {
  transactions: 'Transactions',
  payouts: 'Weekly Payouts',
  collections: 'Cash Collections',
}

export function AdminPayments() {
  const [params, setParams] = useSearchParams()
  const tab: PayTab = (PAY_TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as PayTab) : 'transactions'
  const setTab = (t: PayTab) => setParams(t === 'transactions' ? {} : { tab: t }, { replace: true })

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText('Payments & Payouts')} sub={translatePortalText('Customer payments in, weekly payouts to providers, and cash commission providers owe the platform')} icon={<Landmark className="text-emerald-500" />}
        actions={
          <button className="btn-ghost" onClick={async () => {
            try { await monetizationApi.downloadReport(); toast(translatePortalText('Financial report downloaded')) }
            catch (e: any) { toast(translatePortalText(e?.message || translatePortalText('Export failed')), 'warn') }
          }}><Download size={15} /> {translatePortalText('Export')}</button>
        } />

      <div className="mb-5 flex flex-wrap gap-1 rounded-2xl bg-sand p-1.5 w-fit">
        {PAY_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`relative rounded-xl px-4 py-2 text-[13px] font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {tab === t && <motion.span layoutId="pay-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500" />}
            <span className="relative z-10">{translatePortalText(PAY_TAB_LABELS[t])}</span>
          </button>
        ))}
      </div>

      {tab === 'transactions' && <TransactionsPanel />}
      {tab === 'payouts' && <PayoutsPanel />}
      {tab === 'collections' && <CollectionsPanel />}
    </PageWrap>
  )
}

function TransactionsPanel() {
  const [live, setLive] = useState<{ gross: number; commission: number; providerNet: number; count: number } | null>(null)
  const [txns, setTxns] = useState<any[]>([])
  const [trend, setTrend] = useState<{ m: string; gross: number; commission: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const year = new Date().getFullYear()
    setLoading(true)
    Promise.all([
      adminPortalApi.payments({ limit: 50 }),
      // Real month-by-month platform economics for the chart, replacing the
      // hardcoded demo series this page used to render.
      monetizationApi.report({ from: `${year}-01-01`, to: `${year}-12-31` }),
    ]).then(([pRes, rRes]) => {
      setLive(pRes.data.totals)
      setTxns((pRes.data.items || []).map((p: any) => ({
        id: `TXN-${String(p._id).slice(-6).toUpperCase()}`,
        avatar: p.customer?.avatar || avatar(1),
        who: p.customer?.name || 'Unknown User',
        time: p.createdAt ? formatPortalDate(new Date(p.createdAt)) : '—',
        // The raw value alongside the formatted one: `time` is a localised
        // string and cannot be filtered or ordered reliably.
        createdAt: p.createdAt || '',
        kind: p.bookingType || 'Payment',
        method: p.method || 'hyperpay',
        desc: `Payment to ${p.provider?.business?.businessName || p.provider?.name || translatePortalText('Platform')}`,
        amount: p.amount,
        status: p.status === 'paid' ? 'Completed' : p.status === 'failed' ? 'Failed' : p.status === 'refunded' ? 'Refunded' : 'Pending',
      })))

      // The report groups by vertical, not month — chart the verticals, which
      // is the breakdown the API actually provides.
      setTrend((rRes.data.byVertical || []).map(v => ({
        m: verticalLabel(v._id), gross: v.gross, commission: v.commission,
      })))
      setError('')
    }).catch((e: any) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  /**
   * The transaction ledger's filters.
   *
   * Search was the only control on every table on this page — no status, no
   * vertical, no date, no ordering. On the platform's money screen that means
   * "which payments failed last week" and "show me the largest charges" were
   * both unanswerable without reading fifty rows.
   */
  const txnCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (t) => [t.id, t.who, t.kind, t.desc, t.method],
    filters: [
      { key: 'status', label: 'Status', get: (t) => t.status },
      { key: 'kind', label: 'Vertical', get: (t) => t.kind },
      { key: 'method', label: 'Method', get: (t) => t.method },
      { key: 'taken', label: 'Taken', kind: 'dateRange', get: (t) => t.createdAt },
      {
        key: 'size',
        label: 'Amount',
        options: [
          { value: 'over5000', label: 'Over 5,000' },
          { value: 'over1000', label: 'Over 1,000' },
          { value: 'under500', label: 'Under 500' },
        ],
        get: (t) => String(t.amount ?? 0),
        match: (t, v) => {
          const a = t.amount ?? 0
          if (v === 'over5000') return a > 5000
          if (v === 'over1000') return a > 1000
          return a < 500
        },
      },
    ],
    sortOptions: [
      { key: 'taken', label: 'Date', get: (t) => t.createdAt, defaultDir: 'desc' },
      { key: 'amount', label: 'Amount', get: (t) => t.amount ?? 0, defaultDir: 'desc' },
      { key: 'who', label: 'Customer', get: (t) => t.who, defaultDir: 'asc' },
    ],
    defaultSort: 'taken',
  }), [])
  const txnTf = useTableFilters(txns, txnCfg)

  const cards: [string, number, string, string][] = [
    [translatePortalText('Gross volume'), live?.gross ?? 0, '', 'text-deep-900'],
    [translatePortalText('Platform commission'), live?.commission ?? 0, '', 'text-emerald-600'],
    // The providers' share of these payments — what they earned, not what has
    // been sent to them. Transfers actually made are on Weekly Payouts.
    [translatePortalText('Provider earnings'), live?.providerNet ?? 0, '', 'text-amber-600'],
    [translatePortalText('Transactions count'), live?.count ?? 0, '', 'text-ocean-600'],
  ]

  return (
    <>
      {error && <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{error}</div>}

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map(([l, v, p, t], i) => (
          <motion.div key={String(l)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{l}</p>
            <p className={`mt-1 font-display text-2xl font-extrabold ${t}`}><Counter value={Number(v)} prefix={String(p)} /></p>
          </motion.div>
        ))}
      </div>

      <Section title={translatePortalText('Revenue vs commission')} sub={translatePortalText('Platform economics by booking vertical (this year)')}>
        {trend.length === 0 && !loading
          ? <div className="py-16 text-center text-sm text-slate-400">{translatePortalText('No settled bookings yet this year.')}</div>
          : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.32} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="pc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} /><stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => formatMoney(v, undefined, { compact: true })} />
                <Tooltip content={<ChartTip />} /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="gross" name={translatePortalText('Gross')} stroke="#10b981" strokeWidth={2.5} fill="url(#pg)" />
                <Area type="monotone" dataKey="commission" name={translatePortalText('Commission')} stroke="#14b8a6" strokeWidth={2.5} fill="url(#pc)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
      </Section>

      <Section title={translatePortalText('Recent transactions')} sub={translatePortalText('Customer payments, newest first')} className="mt-5">
        {/*
          `txnCfg` declared searchable fields and there was no search box
          anywhere on this table — the config was wired to a control that did
          not exist, so nothing could be searched, filtered or ordered.
        */}
        <TableToolbar
          state={txnTf}
          config={txnCfg}
          rows={txns}
          noun={translatePortalText('transactions')}
          searchPlaceholder={translatePortalText('Search transaction, customer or provider…')}
        />
        <div className="overflow-hidden">
          <div className="hidden grid-cols-[1.5fr_1fr_1.4fr_0.9fr_0.8fr_auto] gap-3 border-b border-slate-100 bg-sand px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 rounded-t-xl lg:grid">
            <span>{translatePortalText('Transaction')}</span><span>{translatePortalText('Type')}</span><span>{translatePortalText('Description')}</span><span>{translatePortalText('Amount')}</span><span>{translatePortalText('Status')}</span><span></span>
          </div>
          {loading && <TableSkeleton rows={6} cols={4} />}
          {!loading && txns.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText('No transactions yet.')}</div>}
          {txnTf.pagedRows.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="grid grid-cols-2 items-center gap-3 border-b border-slate-50 px-4 py-3 transition hover:bg-sand lg:grid-cols-[1.5fr_1fr_1.4fr_0.9fr_0.8fr_auto]">
              <div className="col-span-2 flex items-center gap-3 lg:col-span-1">
                <img src={t.avatar} className="h-9 w-9 rounded-full object-cover" />
                <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{t.id}</p><p className="truncate text-[11px] text-slate-400">{t.who} · {t.time}</p></div>
              </div>
              <div className="text-xs font-semibold text-slate-600">{translatePortalText(t.kind)} · {translatePortalText(t.method)}</div>
              <div className="truncate text-xs text-slate-500">{translatePortalText(t.desc)}</div>
              <div className={`text-[13px] font-extrabold ${t.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(Math.abs(t.amount))}</div>
              <div><ABadge dot={t.status === 'Flagged'}>{translatePortalText(t.status)}</ABadge></div>
              <div className="col-span-2 flex justify-end lg:col-span-1">
                <button onClick={() => toast(`${t.id} · ${translatePortalText(t.desc)}`, 'info')} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{translatePortalText('Details')}</button>
              </div>
            </motion.div>
          ))}
          <TablePagination state={txnTf} noun={translatePortalText('transactions')} />
        </div>
      </Section>
    </>
  )
}

// ══════════ PACKAGES & PRICING ══════════
// Everything that decides what a provider pays: the packages, which provider
// is on which, requests to switch, and the platform-wide billing policy. Money
// actually moving — weekly payouts, cash commission owed — is on Payments &
// Payouts instead.
type SubsTab = 'Subscription Packages' | 'Commission Packages' | 'Add-ons' | 'Invite Links' | 'Provider Models' | 'Model Change Requests' | 'Billing Settings'
const SUBS_TABS: SubsTab[] = ['Subscription Packages', 'Commission Packages', 'Add-ons', 'Invite Links', 'Provider Models', 'Model Change Requests', 'Billing Settings']
/** `?tab=` values, so a tab can be linked to. The provider directories open `invites` and `models`. */
const SUBS_TAB_SLUGS: Record<SubsTab, string> = {
  'Subscription Packages': 'subscriptions',
  'Commission Packages': 'commission',
  'Add-ons': 'addons',
  'Invite Links': 'invites',
  'Provider Models': 'models',
  'Model Change Requests': 'requests',
  'Billing Settings': 'billing',
}

export function AdminSubscriptions() { return <SubsPage /> }
function SubsPage() {
  const [params, setParams] = useSearchParams()
  const tab: SubsTab = SUBS_TABS.find(t => SUBS_TAB_SLUGS[t] === params.get('tab')) ?? 'Subscription Packages'
  const setTab = (t: SubsTab) => setParams(t === 'Subscription Packages' ? {} : { tab: SUBS_TAB_SLUGS[t] }, { replace: true })
  /** Pending switch requests, for the tab badge — the queue used to have its own sidebar entry. */
  const [pendingChanges, setPendingChanges] = useState(0)
  const loadPendingChanges = () => {
    monetizationApi.listModelChanges('pending')
      .then(r => setPendingChanges((r.data.requests || []).length))
      .catch(() => {})
  }
  useEffect(loadPendingChanges, [])
  const [providerTypeFilter, setProviderTypeFilter] = useState<string>('boat_provider')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [subPkgs, setSubPkgs] = useState<SubscriptionPackageData[]>([])
  const [subModalOpen, setSubModalOpen] = useState(false)
  const [editingSubPkg, setEditingSubPkg] = useState<SubscriptionPackageData | null>(null)
  const [subForm, setSubForm] = useState({ providerType: 'boat_provider', name: '', price: 5000, duration: '1 Month', durationMonths: 1, isActive: true, isPublic: true })
  const [subLimits, setSubLimits] = useState<Record<string, string>>({})

  const [commPkgs, setCommPkgs] = useState<CommissionPackageData[]>([])
  const [commModalOpen, setCommModalOpen] = useState(false)
  const [editingCommPkg, setEditingCommPkg] = useState<CommissionPackageData | null>(null)
  const [commForm, setCommForm] = useState<{ providerType: string; name: string; commissionType: CommissionType; commissionPercentage: number; fixedAmountSar: number; isActive: boolean; isPublic: boolean }>({ providerType: 'boat_provider', name: '', commissionType: 'percentage', commissionPercentage: 10, fixedAmountSar: 5, isActive: true, isPublic: true })
  const [commLimits, setCommLimits] = useState<Record<string, string>>({})

  // Add-on marketplace (extra capacity a provider buys when they hit a limit)
  const [addOns, setAddOns] = useState<AddOnTypeData[]>([])
  const [addOnModalOpen, setAddOnModalOpen] = useState(false)
  const [editingAddOn, setEditingAddOn] = useState<AddOnTypeData | null>(null)
  const [addOnForm, setAddOnForm] = useState<{ providerType: ProviderTypeKey; resourceKey: string; name: string; incrementAmount: number; pricePerMonth: number; isActive: boolean }>({ providerType: 'boat_provider', resourceKey: '', name: '', incrementAmount: 1, pricePerMonth: 10, isActive: true })

  // ── Fixed-fee invite links ───────────────────────────────────────────────
  // The one deal this screen mints: the platform takes a flat amount out of
  // every transaction — 5, 10, whatever was agreed — and that is the whole
  // arrangement. No percentage, no monthly fee. A provider who registers
  // through the link is put on it automatically and is never shown the
  // subscription/commission pickers, because they have nothing to choose.
  const [invites, setInvites] = useState<PlanInviteData[]>([])
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  type InviteForm = {
    providerType: string
    name: string
    feePerTransaction: number
    maxUses: string
    expiresAt: string
  }
  const emptyInviteForm = (): InviteForm => ({
    providerType: providerTypeFilter,
    name: '',
    feePerTransaction: 5,
    maxUses: '',
    expiresAt: '',
  })
  const [inviteForm, setInviteForm] = useState<InviteForm>(emptyInviteForm())
  const [inviteBusy, setInviteBusy] = useState(false)
  /** The link just minted — held so the admin can copy it before closing. */
  const [newInvite, setNewInvite] = useState<PlanInviteData | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // The fixed resource-key vocabulary per provider type — never hardcoded
  // here, always sourced from the backend's single source of truth.
  const [limitKeys, setLimitKeys] = useState<Record<ProviderTypeKey, LimitKeyDef[]>>({} as any)
  useEffect(() => { packageLimitApi.limitKeys().then((r) => setLimitKeys(r.data.limitKeys)).catch(() => {}) }, [])

  const [billingSettings, setBillingSettings] = useState<BillingSettingsData | null>(null)
  const [effectivePolicy, setEffectivePolicy] = useState<EffectivePlatformPolicy | null>(null)
  const [billingSettingsBusy, setBillingSettingsBusy] = useState(false)
  useEffect(() => {
    if (tab !== 'Billing Settings') return
    packageLimitApi.getBillingSettings().then((r) => { setBillingSettings(r.data.settings); setEffectivePolicy(r.data.effective ?? null) }).catch(() => {})
  }, [tab])
  const saveBillingSettings = async (patch: Partial<BillingSettingsData>) => {
    setBillingSettingsBusy(true)
    try {
      const r = await packageLimitApi.updateBillingSettings(patch)
      setBillingSettings(r.data.settings)
      setEffectivePolicy(r.data.effective ?? null)
      toast(translatePortalText('Billing settings updated'))
    } catch (e: any) {
      toast(translatePortalText(e.message || 'Could not update billing settings'), 'warn')
    } finally {
      setBillingSettingsBusy(false)
    }
  }

  /** Converts the string-keyed limit inputs into the numeric-or-null payload the API expects. Blank = unlimited. */
  const parseLimits = (raw: Record<string, string>): PackageLimits =>
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.trim() === '' ? null : Math.max(0, Math.round(Number(v) || 0))]))

  const [providersOverview, setProvidersOverview] = useState<MonetizationProvider[]>([])
  const [stats, setStats] = useState<MonetizationStats | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [sRes, cRes, oRes] = await Promise.all([
        // activeOnly=false so admin sees deactivated tiers they can re-enable.
        monetizationApi.listSubscriptionPackages(providerTypeFilter, false),
        monetizationApi.listCommissionPackages(providerTypeFilter, false),
        monetizationApi.overview(),
      ])
      setSubPkgs(sRes.data.packages || [])
      setCommPkgs(cRes.data.packages || [])
      setProvidersOverview(oRes.data.providers || [])
      setStats(oRes.data.stats || null)
    } catch (e: any) {
      toast(translatePortalText(e?.message || 'Failed to load monetization data'), 'warn')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [providerTypeFilter])

  const filteredProviders = useMemo(
    () => providersOverview.filter(p => p.providerType === providerTypeFilter),
    [providersOverview, providerTypeFilter]
  )
  /** Which deal each provider is on, and when it runs out. */
  const modelCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (p) => [p.businessName, p.email, p.paymentModel],
    filters: [
      { key: 'model', label: 'Billing model', get: (p) => p.paymentModel },
      { key: 'type', label: 'Provider type', get: (p) => p.providerType?.replace(/_/g, ' ') },
      { key: 'status', label: 'Status', get: (p) => p.status },
      { key: 'expiry', label: 'Subscription ends', kind: 'dateRange', get: (p) => p.subscriptionExpiry },
    ],
    sortOptions: [
      // Soonest expiry first: the renewals about to lapse are the ones to act on.
      { key: 'expiry', label: 'Subscription ends', get: (p) => p.subscriptionExpiry, defaultDir: 'asc' },
      { key: 'name', label: 'Business', get: (p) => p.businessName, defaultDir: 'asc' },
      { key: 'rate', label: 'Commission rate', get: (p) => p.commissionRate ?? 0, defaultDir: 'desc' },
    ],
    defaultSort: 'name',
  }), [])
  const modelTf = useTableFilters(filteredProviders, modelCfg)

  const handleSaveSubPkg = async () => {
    if (!subForm.name.trim()) return toast(translatePortalText('Package name is required'), 'warn')
    try {
      const id = editingSubPkg?._id || editingSubPkg?.id
      const payload = { ...subForm, limits: parseLimits(subLimits) }
      if (id) { await monetizationApi.updateSubscriptionPackage(id, payload as any); toast(translatePortalText('Subscription package updated')) }
      else { await monetizationApi.createSubscriptionPackage(payload as any); toast(translatePortalText('Subscription package created')) }
      setSubModalOpen(false); loadData()
    } catch (e: any) { toast(translatePortalText(e.message || 'Action failed'), 'warn') }
  }

  const handleDeleteSubPkg = (id: string, name: string) =>
    confirmAndRun({
      title: `Delete the “${name}” package?`,
      body: 'Providers already on this package must be moved to another one first.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting…',
      danger: true,
      run: async () => {
        setBusyId(id)
        try { await monetizationApi.deleteSubscriptionPackage(id); loadData() }
        finally { setBusyId(null) }
      },
      success: `“${name}” package deleted successfully`,
      error: 'Failed to delete the package. Please try again.',
    })

  const handleSaveCommPkg = async () => {
    if (!commForm.name.trim()) return toast(translatePortalText('Package name is required'), 'warn')
    try {
      const id = editingCommPkg?._id || editingCommPkg?.id
      const payload = { ...commForm, limits: parseLimits(commLimits) }
      if (id) { await monetizationApi.updateCommissionPackage(id, payload as any); toast(translatePortalText('Commission package updated')) }
      else { await monetizationApi.createCommissionPackage(payload as any); toast(translatePortalText('Commission package created')) }
      setCommModalOpen(false); loadData()
    } catch (e: any) { toast(translatePortalText(e.message || 'Action failed'), 'warn') }
  }

  const handleDeleteCommPkg = (id: string, name: string) =>
    confirmAndRun({
      title: `Delete the “${name}” commission tier?`,
      body: 'Providers already on this tier must be moved to another one first.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting…',
      danger: true,
      run: async () => {
        setBusyId(id)
        try { await monetizationApi.deleteCommissionPackage(id); loadData() }
        finally { setBusyId(null) }
      },
      success: `“${name}” commission tier deleted successfully`,
      error: 'Failed to delete the commission tier. Please try again.',
    })

  const loadAddOns = () => { addOnApi.list({ providerType: providerTypeFilter }).then(r => setAddOns(r.data.addOns || [])).catch(() => {}) }
  useEffect(() => { if (tab === 'Add-ons') loadAddOns() }, [tab, providerTypeFilter])

  const handleSaveAddOn = async () => {
    if (!addOnForm.name.trim() || !addOnForm.resourceKey) return toast(translatePortalText('Name and resource are required'), 'warn')
    try {
      const id = editingAddOn?._id || editingAddOn?.id
      if (id) { await addOnApi.update(id, addOnForm); toast(translatePortalText('Add-on updated')) }
      else { await addOnApi.create(addOnForm); toast(translatePortalText('Add-on created')) }
      setAddOnModalOpen(false); loadAddOns()
    } catch (e: any) { toast(translatePortalText(e.message || 'Action failed'), 'warn') }
  }

  const handleDeleteAddOn = (id: string, name: string) =>
    confirmAndRun({
      title: `Delete the “${name}” add-on?`,
      body: 'Providers who purchased it keep their current capacity until the period ends.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting…',
      danger: true,
      run: async () => {
        setBusyId(id)
        try { await addOnApi.remove(id); loadAddOns() }
        finally { setBusyId(null) }
      },
      success: `“${name}” add-on deleted successfully`,
      error: 'Failed to delete the add-on. Please try again.',
    })

  // Rows arrive with the plan resolved and the shareable URL already built, so
  // this no longer has to fetch every package and match ids client-side (which
  // rendered "—" for any package those listings happened to miss).
  const loadInvites = () => { planInviteApi.list().then(r => setInvites(r.data.invites || [])).catch(() => {}) }
  useEffect(() => {
    if (tab !== 'Invite Links') return
    loadInvites()
  }, [tab])

  /**
   * Mints the fixed-fee plan and its link in one request.
   *
   * The plan is saved hidden (`isPublic: false`) — the link is the only way to
   * reach it — and the backend does both halves together so a failure cannot
   * leave an orphaned package in the catalogue.
   */
  const handleCreateInvite = async () => {
    const f = inviteForm
    if (!f.name.trim()) return toast(translatePortalText('Give the plan a name'), 'warn')
    if (!(f.feePerTransaction > 0)) return toast(translatePortalText('Set the fee the platform takes per transaction'), 'warn')

    setInviteBusy(true)
    try {
      const r = await planInviteApi.createFixedFee({
        providerType: f.providerType,
        name: f.name.trim(),
        feePerTransaction: f.feePerTransaction,
        maxUses: f.maxUses ? Number(f.maxUses) : undefined,
        expiresAt: f.expiresAt || undefined,
      })
      setNewInvite(r.data.invite)
      toast(translatePortalText('Plan created and invite link generated'))
      loadInvites()
      loadData()
    } catch (e: any) { toast(translatePortalText(e.message || 'Could not create the invite'), 'warn') }
    finally { setInviteBusy(false) }
  }

  /**
   * Copies the link the provider opens.
   *
   * `navigator.clipboard` is unavailable on an insecure origin and can be
   * refused outright, and an admin who thinks they copied a link and pastes
   * nothing into an email has been actively misled — so a failure falls back to
   * a prompt they can copy out of by hand.
   */
  const copyInviteLink = async (invite: PlanInviteData) => {
    const url = invite.url || `${window.location.origin}${window.location.pathname}#/plan-invite/${invite.code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedCode(invite.code)
      setTimeout(() => setCopiedCode(c => (c === invite.code ? null : c)), 2000)
      toast(translatePortalText('Invite link copied'))
    } catch {
      // Clipboard access can be refused (insecure context, or the permission
      // denied), so the link still has to be gettable by hand. Shown in a real
      // dialog rather than `window.prompt`, which several browsers now render
      // as an unstyled security warning and some suppress entirely — leaving
      // the operator with no link and no error.
      await confirm({
        title: 'Copy this invite link',
        body: 'Clipboard access was refused, so select the link below and copy it.',
        confirmLabel: 'Done',
        cancelLabel: 'Close',
        input: { label: 'Invite link', initial: url },
      })
    }
  }

  const handleToggleInvite = async (invite: PlanInviteData) => {
    try {
      await planInviteApi.update(invite._id || invite.id!, { isActive: !invite.isActive })
      loadInvites()
    } catch (e: any) { toast(translatePortalText(e.message || 'Could not update the invite'), 'warn') }
  }

  const handleRenewSubscription = async (providerId: string, months = 1) => {
    setBusyId(providerId)
    try { await monetizationApi.renewSubscription(providerId, months); toast(translatePortalText(`Subscription extended by ${formatPortalNumber(months)} month(s)`)); loadData() }
    catch (e: any) { toast(translatePortalText(e.message || 'Failed to renew subscription'), 'warn') }
    finally { setBusyId(null) }
  }

  const handleSuspendExpired = () =>
    confirmAndRun({
      title: translatePortalText('Suspend every lapsed provider?'),
      body: translatePortalText('Providers whose subscription has expired will stop receiving new bookings until they renew.'),
      confirmLabel: translatePortalText('Suspend all'),
      busyLabel: translatePortalText('Suspending…'),
      danger: true,
      run: async () => {
        const res = await monetizationApi.suspendExpired()
        loadData()
        return res.data.suspendedCount
      },
      // The real count, from the server — not an assumption about how many were lapsed.
      success: (count) =>
        count === 0
          ? translatePortalText('No lapsed providers to suspend')
          : `${formatPortalNumber(count)} ${translatePortalText(count === 1 ? 'lapsed provider suspended' : 'lapsed providers suspended')}`,
      error: translatePortalText('Could not suspend the lapsed providers. Please try again.'),
    })

  const [historyFor, setHistoryFor] = useState<{ providerId: string; businessName: string } | null>(null)
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const openHistory = async (providerId: string, businessName: string) => {
    setHistoryFor({ providerId, businessName })
    setHistoryLoading(true)
    try {
      const r = await packageLimitApi.history(providerId)
      setHistoryItems(r.data.items || [])
    } catch (e: any) {
      toast(translatePortalText(e.message || 'Could not load package history'), 'warn')
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText('Packages & Pricing')} sub={translatePortalText('What providers pay: subscription, commission & fixed-fee packages, who is on which, and requests to switch')} icon={<Percent className="text-emerald-500" />}
        actions={<button className="btn-ghost" onClick={() => { loadData(); loadPendingChanges() }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {translatePortalText('Refresh')}</button>} />

      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
          {([
            [translatePortalText('Providers'), stats.totalProviders, 'text-deep-900'],
            [translatePortalText('On subscription'), stats.subscriptionCount, 'text-ocean-600'],
            // Fixed-fee providers are counted inside `commissionCount` on the
            // server, so this is deliberately a breakdown of that number, not
            // a fourth disjoint bucket.
            [translatePortalText('On commission'), Math.max(0, stats.commissionCount - (stats.fixedFeeCount ?? 0)), 'text-teal-600'],
            [translatePortalText('On fixed fee'), stats.fixedFeeCount ?? 0, 'text-amber-600'],
            [translatePortalText('Expired'), stats.expiredSubscriptionCount, 'text-rose-600'],
            [translatePortalText('Wallets held'), stats.totalWalletBalance, 'text-amber-600'],
          ] as [string, number, string][]).map(([l, v, t]) => (
            <div key={l} className="card p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{l}</p>
              <p className={`mt-0.5 font-display text-xl font-extrabold ${t}`}>{fmt(v)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-sand p-1.5 w-fit">
        {SUBS_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`relative rounded-xl px-4 py-2 text-[13px] font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {tab === t && <motion.span layoutId="subs-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500" />}
            <span className="relative z-10 flex items-center gap-1.5">
              {translatePortalText(t)}
              {t === 'Model Change Requests' && pendingChanges > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[9px] font-extrabold text-[#041410]">{formatPortalNumber(pendingChanges)}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* The provider-type filter only applies to the package and model tabs. */}
      {tab !== 'Model Change Requests' && tab !== 'Billing Settings' && (
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider me-2">{translatePortalText('Provider Type:')}</span>
          {Object.entries(PROVIDER_TYPE_LABELS).map(([k, label]) => (
            <button key={k} onClick={() => setProviderTypeFilter(k)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-extrabold transition ${providerTypeFilter === k ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-400' : 'bg-sand text-slate-600 hover:bg-slate-200'}`}>
              <span>{PROVIDER_TYPE_ICONS[k]}</span> {translatePortalText(label)}
            </button>
          ))}
        </div>
      )}

      {/* ── SUBSCRIPTION PACKAGES ── */}
      {tab === 'Subscription Packages' && (<>
        <div className="mb-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText(PROVIDER_TYPE_LABELS[providerTypeFilter])} {translatePortalText('Subscription Packages')}</h3>
            <p className="text-xs text-slate-400">{translatePortalText("Provider pays this fee to the platform. Customer payments accrue 100% to the provider's wallet — no commission is taken.")}</p>
          </div>
          <button onClick={() => { setEditingSubPkg(null); setSubForm({ providerType: providerTypeFilter, name: '', price: 5000, duration: '1 Month', durationMonths: 1, isActive: true, isPublic: true }); setSubLimits({}); setSubModalOpen(true) }} className="btn-admin !text-xs">
            <Plus size={14} /> {translatePortalText('Add Package')}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subPkgs.length === 0 && !loading && <div className="card col-span-full py-14 text-center text-sm text-slate-400">{translatePortalText('No packages for this provider type yet.')}</div>}
          {subPkgs.map((pkg, i) => (
            <motion.div key={pkg._id || pkg.id || i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`card p-5 relative overflow-hidden ${pkg.isActive === false ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700">{PROVIDER_TYPE_ICONS[pkg.providerType]} {translatePortalText(PROVIDER_TYPE_LABELS[pkg.providerType])}</span>
                <div className="flex gap-1">
                  <button onClick={() => {
                    setEditingSubPkg(pkg)
                    setSubForm({ providerType: pkg.providerType || providerTypeFilter, name: pkg.name, price: pkg.price, duration: pkg.duration || '1 Month', durationMonths: pkg.durationMonths || 1, isActive: pkg.isActive !== false, isPublic: pkg.isPublic !== false })
                    setSubLimits(Object.fromEntries(Object.entries(pkg.limits || {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])))
                    setSubModalOpen(true)
                  }} className="p-1 text-slate-400 hover:text-deep-900"><Edit3 size={14} /></button>
                  <button disabled={busyId === (pkg._id || pkg.id)} onClick={() => handleDeleteSubPkg(pkg._id || pkg.id!, pkg.name)} className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-40"><Trash2 size={14} /></button>
                </div>
              </div>
              <p className="mt-3 font-display text-xl font-extrabold text-deep-900">{pkg.name} {pkg.isActive === false && <span className="chip !text-[10px] bg-slate-100 text-slate-500">{translatePortalText('inactive')}</span>} {pkg.isPublic === false && <span className="chip !text-[10px] bg-violet-100 text-violet-600">{translatePortalText('hidden')}</span>}</p>
              <p className="mt-1 font-display text-3xl font-extrabold text-emerald-600">{fmt(pkg.price)}<span className="text-xs font-semibold text-slate-400"> / {translatePortalText(pkg.duration || 'month')}</span></p>
              <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 space-y-1">
                <p className="flex items-center gap-1.5"><Check size={12} className="text-emerald-500" /> {translatePortalText('100% of every booking accrues to the wallet')}</p>
                <p className="flex items-center gap-1.5"><Check size={12} className="text-emerald-500" /> {translatePortalText('0% platform commission per booking')}</p>
                <p className="flex items-center gap-1.5"><Check size={12} className="text-emerald-500" /> {translatePortalText('Bookings lock automatically on expiry')}</p>
              </div>
              {pkg.limits && Object.keys(pkg.limits).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                  {(limitKeys[pkg.providerType] || []).map((def) => pkg.limits?.[def.key] !== undefined ? (
                    <span key={def.key} className="chip !text-[10px] bg-ocean-50 text-ocean-700">
                      {translatePortalText(def.label)}: {pkg.limits?.[def.key] === null ? '∞' : pkg.limits?.[def.key]}
                    </span>
                  ) : null)}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </>)}

      {/* ── COMMISSION PACKAGES ── */}
      {tab === 'Commission Packages' && (<>
        <div className="mb-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText(PROVIDER_TYPE_LABELS[providerTypeFilter])} {translatePortalText('Commission Packages')}</h3>
            <p className="text-xs text-slate-400">{translatePortalText('Customer pays the platform via HyperPay; commission is withheld and the net is paid out weekly by bank transfer.')}</p>
          </div>
          <button onClick={() => { setEditingCommPkg(null); setCommForm({ providerType: providerTypeFilter, name: '', commissionType: 'percentage', commissionPercentage: 10, fixedAmountSar: 5, isActive: true, isPublic: true }); setCommLimits({}); setCommModalOpen(true) }} className="btn-admin !text-xs">
            <Plus size={14} /> {translatePortalText('Add Commission Tier')}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {commPkgs.length === 0 && !loading && <div className="card col-span-full py-14 text-center text-sm text-slate-400">{translatePortalText('No commission tiers for this provider type yet.')}</div>}
          {commPkgs.map((pkg, i) => (
            <motion.div key={pkg._id || pkg.id || i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`card p-5 relative overflow-hidden ${pkg.isActive === false ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-extrabold text-teal-700">{PROVIDER_TYPE_ICONS[pkg.providerType]} {translatePortalText(PROVIDER_TYPE_LABELS[pkg.providerType])}</span>
                <div className="flex gap-1">
                  <button onClick={() => {
                    setEditingCommPkg(pkg)
                    setCommForm({ providerType: pkg.providerType || providerTypeFilter, name: pkg.name, commissionType: pkg.commissionType || 'percentage', commissionPercentage: pkg.commissionPercentage ?? 10, fixedAmountSar: pkg.fixedAmountSar ?? 5, isActive: pkg.isActive !== false, isPublic: pkg.isPublic !== false })
                    setCommLimits(Object.fromEntries(Object.entries(pkg.limits || {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])))
                    setCommModalOpen(true)
                  }} className="p-1 text-slate-400 hover:text-deep-900"><Edit3 size={14} /></button>
                  <button disabled={busyId === (pkg._id || pkg.id)} onClick={() => handleDeleteCommPkg(pkg._id || pkg.id!, pkg.name)} className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-40"><Trash2 size={14} /></button>
                </div>
              </div>
              <p className="mt-3 font-display text-xl font-extrabold text-deep-900">{pkg.name} {pkg.isActive === false && <span className="chip !text-[10px] bg-slate-100 text-slate-500">{translatePortalText('inactive')}</span>} {pkg.isPublic === false && <span className="chip !text-[10px] bg-violet-100 text-violet-600">{translatePortalText('hidden')}</span>}</p>
              <p className="mt-1 font-display text-3xl font-extrabold text-deep-900">
                {pkg.commissionType === 'fixed' ? fmt(pkg.fixedAmountSar || 0) : formatPortalPercent(pkg.commissionPercentage)}
                <span className="text-xs font-semibold text-slate-400"> {pkg.commissionType === 'fixed' ? 'flat per transaction' : 'platform cut'}</span>
              </p>
              <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 space-y-1">
                <p className="flex items-center gap-1.5"><Check size={12} className="text-emerald-500" /> {translatePortalText('Platform holds the customer payment')}</p>
                <p className="flex items-center gap-1.5"><Check size={12} className="text-emerald-500" /> {translatePortalText('Net accrues to the provider wallet')}</p>
                <p className="flex items-center gap-1.5"><Check size={12} className="text-emerald-500" /> {translatePortalText('Weekly bank-transfer payout after manual approval')}</p>
                {pkg.commissionType === 'fixed' && (
                  <p className="flex items-center gap-1.5"><Check size={12} className="text-emerald-500" /> {translatePortalText('No commission percentage — never more than the booking itself')}</p>
                )}
              </div>
              {pkg.limits && Object.keys(pkg.limits).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                  {(limitKeys[pkg.providerType] || []).map((def) => pkg.limits?.[def.key] !== undefined ? (
                    <span key={def.key} className="chip !text-[10px] bg-teal-50 text-teal-700">
                      {translatePortalText(def.label)}: {pkg.limits?.[def.key] === null ? '∞' : pkg.limits?.[def.key]}
                    </span>
                  ) : null)}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </>)}

      {/* ── ADD-ONS ── */}
      {tab === 'Add-ons' && (<>
        <div className="mb-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText(PROVIDER_TYPE_LABELS[providerTypeFilter])} {translatePortalText('Add-ons')}</h3>
            <p className="text-xs text-slate-400">{translatePortalText("How a provider raises one package limit without switching plans — e.g. \"+1 Worker\" for 3 SAR/mo. Price is always set here, never hardcoded.")}</p>
          </div>
          <button onClick={() => { setEditingAddOn(null); setAddOnForm({ providerType: providerTypeFilter as ProviderTypeKey, resourceKey: (limitKeys[providerTypeFilter as ProviderTypeKey] || [])[0]?.key || '', name: '', incrementAmount: 1, pricePerMonth: 10, isActive: true }); setAddOnModalOpen(true) }} className="btn-admin !text-xs">
            <Plus size={14} /> {translatePortalText('Add Add-on')}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {addOns.length === 0 && <div className="card col-span-full py-14 text-center text-sm text-slate-400">{translatePortalText('No add-ons for this provider type yet.')}</div>}
          {addOns.map((a, i) => (
            <motion.div key={a._id || a.id || i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`card p-5 relative overflow-hidden ${a.isActive === false ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-ocean-50 px-2.5 py-1 text-[11px] font-extrabold text-ocean-700">{(limitKeys[a.providerType] || []).find(d => d.key === a.resourceKey)?.label || a.resourceKey}</span>
                <div className="flex gap-1">
                  <button onClick={() => { setEditingAddOn(a); setAddOnForm({ providerType: a.providerType, resourceKey: a.resourceKey, name: a.name, incrementAmount: a.incrementAmount, pricePerMonth: a.pricePerMonth, isActive: a.isActive !== false }); setAddOnModalOpen(true) }} className="p-1 text-slate-400 hover:text-deep-900"><Edit3 size={14} /></button>
                  <button disabled={busyId === (a._id || a.id)} onClick={() => handleDeleteAddOn(a._id || a.id!, a.name)} className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-40"><Trash2 size={14} /></button>
                </div>
              </div>
              <p className="mt-3 font-display text-lg font-extrabold text-deep-900">{a.name} {a.isActive === false && <span className="chip !text-[10px] bg-slate-100 text-slate-500">{translatePortalText('inactive')}</span>}</p>
              <p className="mt-1 text-sm text-slate-500">+{formatPortalNumber(a.incrementAmount)} {translatePortalText(" per purchase")}</p>
              <p className="mt-1 font-display text-2xl font-extrabold text-emerald-600">{fmt(a.pricePerMonth)}<span className="text-xs font-semibold text-slate-400"> {translatePortalText(" / month")}</span></p>
            </motion.div>
          ))}
        </div>
      </>)}

      {/* ── INVITE LINKS ── */}
      {tab === 'Invite Links' && (<>
        <div className="mb-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText('Fixed-fee Invite Links')}</h3>
            <p className="max-w-2xl text-xs text-slate-400">
              {translatePortalText("\n              A private link onto a flat per-transaction plan — the platform keeps a fixed amount (5, 10, …) out of\n              every transaction, with no commission percentage and no subscription. Send it to a provider and they\n              register straight onto that plan without picking one.\n            ")}</p>
          </div>
          <button onClick={() => { setInviteForm(emptyInviteForm()); setInviteModalOpen(true) }} className="btn-admin !text-xs">
            <Plus size={14} /> {translatePortalText('Generate Invite Link')}
          </button>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[1.2fr_1.7fr_1fr_1fr_0.9fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText('Code')}</span><span>{translatePortalText('Plan')}</span><span>{translatePortalText('Uses')}</span><span>{translatePortalText('Expires')}</span><span>{translatePortalText('Status')}</span><span className="text-right">{translatePortalText('Actions')}</span>
              </div>
              {invites.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText('No invite links yet.')}</div>}
              {invites.map((inv, i) => {
                const expired = inv.expiresAt ? new Date(inv.expiresAt) < new Date() : false
                const exhausted = inv.maxUses != null && inv.usedCount >= inv.maxUses
                return (
                  <motion.div key={inv._id || inv.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-[1.2fr_1.7fr_1fr_1fr_0.9fr_auto] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                    <div><code className="rounded-lg bg-sand px-2 py-1 text-xs font-extrabold text-deep-900">{inv.code}</code></div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-600">{inv.plan?.name || '— package deleted —'}</p>
                      {/* The terms, in the plan's own vocabulary: a fixed-fee
                          link must never read as a percentage. */}
                      <p className="truncate text-[11px] text-slate-400">{inv.plan?.label || 'This link no longer resolves to a plan'}</p>
                    </div>
                    <div className="text-xs text-slate-500 whitespace-nowrap">{formatPortalNumber(inv.usedCount)}{inv.maxUses != null ? ` / ${formatPortalNumber(inv.maxUses)}` : ` (${translatePortalText('unlimited')})`}</div>
                    <div className="text-xs text-slate-500 whitespace-nowrap">{inv.expiresAt ? fmtDate(inv.expiresAt) : 'Never'}</div>
                    <div className="whitespace-nowrap">
                      {!inv.isActive ? <span className="chip !text-[11px] bg-slate-100 text-slate-500">{translatePortalText('disabled')}</span>
                        : expired ? <span className="chip !text-[11px] bg-rose-50 text-rose-700">{translatePortalText('expired')}</span>
                        : exhausted ? <span className="chip !text-[11px] bg-rose-50 text-rose-700">{translatePortalText('used up')}</span>
                        : <span className="chip !text-[11px] bg-emerald-50 text-emerald-700">{translatePortalText('active')}</span>}
                    </div>
                    <div className="flex justify-end gap-1.5 whitespace-nowrap">
                      <button onClick={() => copyInviteLink(inv)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">
                        {copiedCode === inv.code ? <><Check size={12} /> {translatePortalText('Copied')}</> : <><Copy size={12} /> {translatePortalText('Copy link')}</>}
                      </button>
                      <button onClick={() => handleToggleInvite(inv)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{inv.isActive ? translatePortalText('Disable') : translatePortalText('Re-enable')}</button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>
      </>)}

      {/* ── PROVIDER MODELS ── */}
      {tab === 'Provider Models' && (<>
        <div className="mb-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText(PROVIDER_TYPE_LABELS[providerTypeFilter])} {translatePortalText('Payment Models')}</h3>
            <p className="text-xs text-slate-400">{translatePortalText('Each provider runs on exactly one model. Subscription expiry blocks new bookings until renewed.')}</p>
          </div>
          <button onClick={handleSuspendExpired} className="btn-ghost !text-xs !text-rose-600"><Ban size={14} /> {translatePortalText('Suspend all expired')}</button>
        </div>

        <TableToolbar
          state={modelTf}
          config={modelCfg}
          rows={filteredProviders}
          noun={translatePortalText('providers')}
          searchPlaceholder="Search business, email or model…"
        />

        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[2fr_1.1fr_1.3fr_1.2fr_1fr_1fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText('Provider')}</span><span>{translatePortalText('Model')}</span><span>{translatePortalText('Package')}</span><span>{translatePortalText('Expiry')}</span><span>{translatePortalText('Wallet')}</span><span>{translatePortalText('Payout')}</span><span className="text-right">{translatePortalText('Actions')}</span>
              </div>
              {loading && <TableSkeleton rows={6} cols={4} />}
              {!loading && filteredProviders.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No ")}{translatePortalText(PROVIDER_TYPE_LABELS[providerTypeFilter])} {translatePortalText(" accounts yet.")}</div>}
              {modelTf.pagedRows.map((p, i) => {
                const exp = expiryTone(p.subscriptionExpiry)
                const isSub = p.paymentModel === 'subscription'
                const isFixedFee = p.planKind === 'fixed_fee' || p.commissionType === 'fixed'
                const planModel = isSub ? 'subscription' : isFixedFee ? 'fixed fee' : 'commission'
                const planChip = isSub
                  ? 'bg-ocean-50 text-ocean-700'
                  : isFixedFee ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-700'
                return (
                  <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-[2fr_1.1fr_1.3fr_1.2fr_1fr_1fr_auto] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-extrabold text-deep-900">{p.businessName}</p>
                      <p className="truncate text-[11px] text-slate-400">{p.email}</p>
                    </div>
                    {/* Three models, not two — a flat per-transaction fee is
                        its own deal and gets its own chip. */}
                    <div><span className={`chip !text-[11px] font-extrabold ${planChip}`}>{translatePortalText(planModel)}</span></div>
                    <div className="truncate text-xs font-bold text-slate-600">
                      {isSub
                        ? (p.subscriptionPackage?.name || '—')
                        : isFixedFee
                          ? (p.commissionPackage?.name || translatePortalText(`SAR ${p.commissionFixedAmount ?? 0}/txn`))
                          : (p.commissionPackage?.name || (p.commissionRate != null ? formatPortalPercent(p.commissionRate) : '—'))}
                    </div>
                    <div className="whitespace-nowrap">{isSub ? <span className={`chip !text-[11px] font-extrabold ${exp.cls}`}>{exp.label}</span> : <span className="text-xs text-slate-400">{translatePortalText('n/a')}</span>}</div>
                    <div className="text-[13px] font-extrabold text-amber-600 whitespace-nowrap">{fmt(p.walletBalance)}</div>
                    <div className="whitespace-nowrap">
                      <span className={`chip !text-[10px] font-extrabold uppercase ${p.walletBalance > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.walletBalance > 0 ? translatePortalText('Awaiting payout') : translatePortalText('None due')}
                      </span>
                    </div>
                    <div className="flex justify-end gap-1.5 whitespace-nowrap">
                      {isSub && (
                        <button disabled={busyId === p.id} onClick={() => handleRenewSubscription(p.id, 1)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40">
                          {busyId === p.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} {translatePortalText('Renew 1m')}
                        </button>
                      )}
                      <button onClick={() => toast(translatePortalText(`${p.businessName}: ${translatePortalText(p.status)}${p.subscriptionExpiry ? ` · expires ${fmtDate(p.subscriptionExpiry)}` : ''}`), 'info')} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{translatePortalText('Details')}</button>
                      <button onClick={() => openHistory(p.id, p.businessName)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{translatePortalText('History')}</button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
          <TablePagination state={modelTf} noun={translatePortalText('providers')} />
        </div>
      </>)}

      {/* ── MODEL CHANGE REQUESTS ── */}
      {/* An approval changes which model a provider is on, so the Provider
          Models figures reload with it. */}
      {tab === 'Model Change Requests' && (
        <ModelChangesPanel onReviewed={() => { loadPendingChanges(); loadData() }} />
      )}

      {/* ── BILLING SETTINGS ── */}
      {tab === 'Billing Settings' && (
        <div className="max-w-xl space-y-4">
          <div>
            <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText("Platform Billing Policy")}</h3>
            <p className="text-xs text-slate-400">{translatePortalText("Applies platform-wide, across all four provider types.")}</p>
          </div>
          {!billingSettings ? (
            <p className="text-sm text-slate-400">{translatePortalText("Loading…")}</p>
          ) : (
            <>
              <div className="card p-4">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-bold text-deep-900">{translatePortalText("Allow immediate subscription ↔ commission switching")}</span>
                    <span className="block text-xs text-slate-400">{translatePortalText("When off, an approved switch takes effect at the end of the current billing period instead of immediately.")}</span>
                  </span>
                  <input
                    type="checkbox"
                    disabled={billingSettingsBusy}
                    checked={billingSettings.allowImmediateModelSwitch}
                    onChange={(e) => saveBillingSettings({ allowImmediateModelSwitch: e.target.checked })}
                  />
                </label>
              </div>
              <div className="card p-4">
                <label className="label">{translatePortalText("Default model when a subscription is cancelled at period end")}</label>
                <select
                  className="input font-bold"
                  disabled={billingSettingsBusy}
                  value={billingSettings.defaultModelOnCancel}
                  onChange={(e) => saveBillingSettings({ defaultModelOnCancel: e.target.value as 'commission' | 'none' })}
                >
                  <option value="commission">{translatePortalText("Switch to commission model")}</option>
                  <option value="none">{translatePortalText("Deactivate (no default model)")}</option>
                </select>
              </div>

              {/* Where Tamara is offered. Per-surface rather than one global
                  switch because the payer differs by vertical: a trip is a
                  consumer buying from a provider, while a berth or a workshop
                  invoice is one business paying another. Whether instalment
                  credit belongs on each is a commercial call, so it is made
                  here rather than assumed in code. */}
              <div className="card p-4">
                <label className="label">{translatePortalText("Tamara — buy now, pay later")}</label>
                <p className="mb-3 text-xs text-slate-400">
                  {translatePortalText("\n                  Choose where customers and providers are offered Tamara alongside card payment. Turning a\n                  surface off stops new instalment checkouts opening on it immediately; plans already running\n                  are unaffected and still settle and refund normally.\n                ")}</p>
                <div className="space-y-2">
                  {TAMARA_SURFACES.map((surface) => {
                    const on = billingSettings.tamaraSurfaces?.includes(surface) ?? false
                    return (
                      <label key={surface} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                        <span>
                          <span className="block text-sm font-bold text-deep-900">{translatePortalText(TAMARA_SURFACE_LABELS[surface].title)}</span>
                          <span className="block text-xs text-slate-400">{translatePortalText(TAMARA_SURFACE_LABELS[surface].who)}</span>
                        </span>
                        <input
                          type="checkbox"
                          disabled={billingSettingsBusy}
                          checked={on}
                          onChange={(e) => {
                            /* The whole set is sent, not a single toggle, so
                               two admins on this screen at once cannot
                               interleave into a combination neither chose. */
                            const current = billingSettings.tamaraSurfaces ?? []
                            const next = e.target.checked
                              ? [...current, surface]
                              : current.filter((x) => x !== surface)
                            saveBillingSettings({ tamaraSurfaces: next })
                          }}
                        />
                      </label>
                    )
                  })}
                </div>
                <p className="mt-3 text-xs text-slate-400">
                  {translatePortalText("\n                  Tamara still decides per payer: anyone it will not underwrite simply sees card payment, whatever\n                  is switched on here. Nothing shows anywhere unless the server has Tamara credentials configured.\n                ")}</p>
              </div>

              <FeeAndCommissionCard
                settings={billingSettings}
                effective={effectivePolicy}
                busy={billingSettingsBusy}
                onSave={saveBillingSettings}
              />
            </>
          )}
        </div>
      )}

      {/* Package/Billing History Modal */}
      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title={historyFor ? `Package History — ${historyFor.businessName}` : ''} wide>
        {historyLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">{translatePortalText("Loading…")}</p>
        ) : historyItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">{translatePortalText("No package changes recorded yet.")}</p>
        ) : (
          <div className="space-y-2">
            {historyItems.map((h) => (
              <div key={h._id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3 text-sm">
                <div>
                  <p className="font-bold text-deep-900">{translatePortalText(h.changeType.replace(/_/g, ' '))}</p>
                  <p className="text-xs text-slate-400">
                    {h.fromPackageName || h.fromBillingModel || '—'} → {h.toPackageName || h.toBillingModel || '—'}
                    {h.amountCharged ? ` · ${fmt(h.amountCharged)} ${h.currency || ''}` : ''}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p className={`chip !text-[10px] ${h.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : h.status === 'scheduled' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{translatePortalText(h.status)}</p>
                  <p className="mt-1">{fmtDate(h.effectiveAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Subscription Package Modal */}
      <Modal open={subModalOpen} onClose={() => setSubModalOpen(false)} title={editingSubPkg ? `${translatePortalText('Edit')} ${editingSubPkg.name}` : `Create Subscription Package`}>
        <div className="space-y-4">
          <div>
            <label className="label">{translatePortalText("Target Provider Role / Type")}</label>
            <select className="input font-bold" value={subForm.providerType} onChange={e => setSubForm({ ...subForm, providerType: e.target.value })}>
              {Object.entries(PROVIDER_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{PROVIDER_TYPE_ICONS[k]} {label}</option>
              ))}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Package Name")}</label><input className="input" value={subForm.name} onChange={e => setSubForm({ ...subForm, name: e.target.value })} placeholder={translatePortalText("e.g. Basic, Premium, Standard, Enterprise")} /></div>
          <div><label className="label">{translatePortalText("Price")}</label><input type="number" className="input" value={subForm.price} onChange={e => setSubForm({ ...subForm, price: Number(e.target.value) })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">{translatePortalText("Duration Label")}</label><input className="input" value={subForm.duration} onChange={e => setSubForm({ ...subForm, duration: e.target.value })} placeholder={translatePortalText("1 Month")} /></div>
            <div><label className="label">{translatePortalText("Duration (months)")}</label><input type="number" min={1} max={60} className="input" value={subForm.durationMonths} onChange={e => setSubForm({ ...subForm, durationMonths: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={subForm.isActive} onChange={e => setSubForm({ ...subForm, isActive: e.target.checked })} /> {translatePortalText(" Active (visible to new providers)\n          ")}</label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={subForm.isPublic} onChange={e => setSubForm({ ...subForm, isPublic: e.target.checked })} /> {translatePortalText(" Public (shown in the normal pricing list)\n          ")}</label>
          {!subForm.isPublic && (
            <p className="rounded-xl bg-violet-50 px-3 py-2 text-[11px] font-semibold text-violet-700">
              {translatePortalText("\n              Hidden — only reachable via an Invite Link. Create one from the \"Invite Links\" tab once this package is saved.\n            ")}</p>
          )}

          <div className="border-t border-slate-100 pt-3">
            <label className="label">{translatePortalText("Resource Limits")}</label>
            <p className="mb-2 text-[11px] text-slate-400">{translatePortalText("Leave a field blank for unlimited. Never hardcoded — set per package.")}</p>
            <div className="grid grid-cols-2 gap-3">
              {(limitKeys[subForm.providerType as ProviderTypeKey] || []).map((def) => (
                <div key={def.key}>
                  <label className="label !mb-1 !text-[11px]">{translatePortalText(def.label)}</label>
                  <input
                    type="number" min={0} className="input" placeholder={translatePortalText("Unlimited")}
                    value={subLimits[def.key] ?? ''}
                    onChange={(e) => setSubLimits({ ...subLimits, [def.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setSubModalOpen(false)} className="btn-ghost">{translatePortalText("Cancel")}</button>
            <button onClick={handleSaveSubPkg} className="btn-admin">{translatePortalText("Save Package")}</button>
          </div>
        </div>
      </Modal>

      {/* Commission Package Modal */}
      <Modal open={commModalOpen} onClose={() => setCommModalOpen(false)} title={editingCommPkg ? `Edit ${editingCommPkg.name}` : `Create Commission Package`}>
        <div className="space-y-4">
          <div>
            <label className="label">{translatePortalText("Target Provider Role / Type")}</label>
            <select className="input font-bold" value={commForm.providerType} onChange={e => setCommForm({ ...commForm, providerType: e.target.value })}>
              {Object.entries(PROVIDER_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{PROVIDER_TYPE_ICONS[k]} {label}</option>
              ))}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Package Name")}</label><input className="input" value={commForm.name} onChange={e => setCommForm({ ...commForm, name: e.target.value })} placeholder={translatePortalText("e.g. 5%, 10%, 15%, Special Partner Plan")} /></div>
          <div>
            <label className="label">{translatePortalText("Commission Type")}</label>
            <select className="input font-bold" value={commForm.commissionType} onChange={e => setCommForm({ ...commForm, commissionType: e.target.value as CommissionType })}>
              <option value="percentage">{translatePortalText("Percentage — % of each booking")}</option>
              <option value="fixed">{translatePortalText("Fixed — flat amount per booking, regardless of size")}</option>
            </select>
          </div>
          {commForm.commissionType === 'fixed' ? (
            <div><label className="label">{translatePortalText("Fixed Amount (SAR per completed booking)")}</label><input type="number" min={0} className="input" value={commForm.fixedAmountSar} onChange={e => setCommForm({ ...commForm, fixedAmountSar: Number(e.target.value) })} /></div>
          ) : (
            <div><label className="label">{translatePortalText("Commission Percentage (%)")}</label><input type="number" min={0} max={100} className="input" value={commForm.commissionPercentage} onChange={e => setCommForm({ ...commForm, commissionPercentage: Number(e.target.value) })} /></div>
          )}
          {editingCommPkg && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
              {translatePortalText("\n              Changing this re-prices every provider currently on this tier.\n            ")}</p>
          )}
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={commForm.isActive} onChange={e => setCommForm({ ...commForm, isActive: e.target.checked })} /> {translatePortalText(" Active (visible to new providers)\n          ")}</label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={commForm.isPublic} onChange={e => setCommForm({ ...commForm, isPublic: e.target.checked })} /> {translatePortalText(" Public (shown in the normal pricing list)\n          ")}</label>
          {!commForm.isPublic && (
            <p className="rounded-xl bg-violet-50 px-3 py-2 text-[11px] font-semibold text-violet-700">
              {translatePortalText("\n              Hidden — only reachable via an Invite Link. Create one from the \"Invite Links\" tab once this package is saved.\n            ")}</p>
          )}

          <div className="border-t border-slate-100 pt-3">
            <label className="label">{translatePortalText("Resource Limits")}</label>
            <p className="mb-2 text-[11px] text-slate-400">{translatePortalText("Leave a field blank for unlimited. Never hardcoded — set per package.")}</p>
            <div className="grid grid-cols-2 gap-3">
              {(limitKeys[commForm.providerType as ProviderTypeKey] || []).map((def) => (
                <div key={def.key}>
                  <label className="label !mb-1 !text-[11px]">{translatePortalText(def.label)}</label>
                  <input
                    type="number" min={0} className="input" placeholder={translatePortalText("Unlimited")}
                    value={commLimits[def.key] ?? ''}
                    onChange={(e) => setCommLimits({ ...commLimits, [def.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setCommModalOpen(false)} className="btn-ghost">{translatePortalText("Cancel")}</button>
            <button onClick={handleSaveCommPkg} className="btn-admin">{translatePortalText("Save Commission Tier")}</button>
          </div>
        </div>
      </Modal>

      {/* Add-on Modal */}
      <Modal open={addOnModalOpen} onClose={() => setAddOnModalOpen(false)} title={editingAddOn ? `Edit ${editingAddOn.name}` : 'Create Add-on'}>
        <div className="space-y-4">
          <div>
            <label className="label">{translatePortalText("Target Provider Role / Type")}</label>
            <select className="input font-bold" value={addOnForm.providerType} onChange={e => setAddOnForm({ ...addOnForm, providerType: e.target.value as ProviderTypeKey, resourceKey: (limitKeys[e.target.value as ProviderTypeKey] || [])[0]?.key || '' })}>
              {Object.entries(PROVIDER_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{PROVIDER_TYPE_ICONS[k]} {label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{translatePortalText("Resource this raises")}</label>
            <select className="input font-bold" value={addOnForm.resourceKey} onChange={e => setAddOnForm({ ...addOnForm, resourceKey: e.target.value })}>
              {(limitKeys[addOnForm.providerType as ProviderTypeKey] || []).map(def => (
                <option key={def.key} value={def.key}>{translatePortalText(def.label)}</option>
              ))}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Add-on Name")}</label><input className="input" value={addOnForm.name} onChange={e => setAddOnForm({ ...addOnForm, name: e.target.value })} placeholder={translatePortalText("e.g. Extra Worker, +10 Boats")} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">{translatePortalText("Increment Amount")}</label><input type="number" min={1} className="input" value={addOnForm.incrementAmount} onChange={e => setAddOnForm({ ...addOnForm, incrementAmount: Number(e.target.value) })} /></div>
            <div><label className="label">{translatePortalText("Price / month (SAR)")}</label><input type="number" min={0} className="input" value={addOnForm.pricePerMonth} onChange={e => setAddOnForm({ ...addOnForm, pricePerMonth: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={addOnForm.isActive} onChange={e => setAddOnForm({ ...addOnForm, isActive: e.target.checked })} /> {translatePortalText(" Active (purchasable by providers)\n          ")}</label>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setAddOnModalOpen(false)} className="btn-ghost">{translatePortalText("Cancel")}</button>
            <button onClick={handleSaveAddOn} className="btn-admin">{translatePortalText("Save Add-on")}</button>
          </div>
        </div>
      </Modal>

      {/* Invite Link Modal */}
      <Modal
        open={inviteModalOpen}
        onClose={() => { setInviteModalOpen(false); setNewInvite(null) }}
        title={newInvite ? 'Invite Link Ready' : 'Generate Invite Link'}
      >
        {newInvite ? (
          /* The link is the deliverable, so it gets its own step rather than
             being buried in a toast the admin has already dismissed. */
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-100">
              <p className="text-[13px] font-extrabold text-emerald-800">{newInvite.plan?.name}</p>
              <p className="mt-0.5 text-xs font-semibold text-emerald-700">{newInvite.plan?.label}</p>
            </div>
            <div>
              <label className="label">{translatePortalText("Send this link to the provider")}</label>
              <div className="flex gap-2">
                <input readOnly className="input font-semibold" value={newInvite.url || ''} onFocus={e => e.currentTarget.select()} />
                <button onClick={() => copyInviteLink(newInvite)} className="btn-admin !px-3 whitespace-nowrap">
                  {copiedCode === newInvite.code ? <><Check size={14} /> {translatePortalText(" Copied")}</> : <><Copy size={14} /> {translatePortalText(" Copy")}</>}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {translatePortalText("\n                They open it, create their account, and finish registration already on this plan — no subscription\n                or commission plan to choose. Code ")}<code className="rounded bg-sand px-1.5 py-0.5 font-extrabold text-deep-900">{newInvite.code}</code> {translatePortalText(" also\n                works if they are typing it in by hand.\n              ")}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setNewInvite(null); setInviteForm(emptyInviteForm()) }} className="btn-ghost">{translatePortalText("Generate another")}</button>
              <button onClick={() => { setInviteModalOpen(false); setNewInvite(null) }} className="btn-admin">{translatePortalText("Done")}</button>
            </div>
          </div>
        ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-sand px-3 py-3 ring-1 ring-slate-100">
            <p className="text-[11px] font-semibold leading-relaxed text-slate-500">
              {translatePortalText("\n              A fixed-fee plan: the platform keeps a flat amount out of every transaction — no commission\n              percentage and no monthly subscription. It is saved hidden, so only this link reaches it.\n            ")}</p>
          </div>

          <div>
            <label className="label">{translatePortalText("Target Provider Role / Type")}</label>
            <select className="input font-bold" value={inviteForm.providerType} onChange={e => setInviteForm({ ...inviteForm, providerType: e.target.value })}>
              {Object.entries(PROVIDER_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{PROVIDER_TYPE_ICONS[k]} {label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{translatePortalText("Plan Name")}</label>
            <input className="input" value={inviteForm.name} onChange={e => setInviteForm({ ...inviteForm, name: e.target.value })}
              placeholder={translatePortalText("e.g. Partner — 5 per transaction")} />
            <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("Shown to the provider on the link, and on their billing screens.")}</p>
          </div>

          <div>
            <label className="label">{translatePortalText("Platform fee per transaction (SAR)")}</label>
            <div className="mb-2 flex gap-2">
              {[5, 10].map(amount => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setInviteForm({ ...inviteForm, feePerTransaction: amount })}
                  className={`chip !text-xs !font-extrabold transition ${inviteForm.feePerTransaction === amount ? 'bg-deep-900 text-white' : 'bg-sand text-slate-600 hover:bg-slate-100'}`}
                >
                  {translatePortalText("\n                  SAR ")}{formatPortalNumber(amount)}
                </button>
              ))}
            </div>
            <input type="number" min={0} step="0.01" className="input" value={inviteForm.feePerTransaction}
              onChange={e => setInviteForm({ ...inviteForm, feePerTransaction: Number(e.target.value) })} />
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText("\n              Deducted from every completed booking whatever it is worth — e.g. 5 or 10 per transaction. Never more\n              than the booking itself, so a small booking can't go net-negative for the provider.\n            ")}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">{translatePortalText("Max Uses (blank = unlimited)")}</label><input type="number" min={1} className="input" value={inviteForm.maxUses} onChange={e => setInviteForm({ ...inviteForm, maxUses: e.target.value })} /></div>
            <div><label className="label">{translatePortalText("Expires (blank = never)")}</label><input type="date" className="input" value={inviteForm.expiresAt} onChange={e => setInviteForm({ ...inviteForm, expiresAt: e.target.value })} /></div>
          </div>
          <p className="text-[11px] text-slate-400">
            {translatePortalText("\n            Resource limits stay unlimited on this plan. Set them later from the Commission Packages tab, where the\n            hidden plan is listed.\n          ")}</p>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setInviteModalOpen(false)} className="btn-ghost">{translatePortalText("Cancel")}</button>
            <button onClick={handleCreateInvite} disabled={inviteBusy} className="btn-admin">
              {inviteBusy ? 'Generating…' : 'Create Plan & Generate Link'}
            </button>
          </div>
        </div>
        )}
      </Modal>

    </PageWrap>
  )
}

// ══════════ WEEKLY PAYOUTS ══════════
/**
 * What the platform owes providers for online bookings, sent weekly by bank
 * transfer.
 *
 * A tab on Payments & Payouts, beside the transaction ledger and cash
 * collections. It used to be a tab on the packages screen, which is where rates
 * are configured — not where an admin goes to send money.
 */
function PayoutsPanel() {
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  /**
   * The week being settled, as its Monday.
   *
   * Defaults to the week just gone rather than the current one: this week is
   * still accruing, so its figures would move under the admin between opening
   * the screen and approving anything.
   */
  /** Local calendar day as `YYYY-MM-DD`. Never via UTC, which shifts the day. */
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const [weekStart, setWeekStart] = useState(() => {
    /*
      The last closed week, computed from today.

      This returned the literal '2026-08-17' — "the active pending settlement
      week" at the time it was written — so the settlements screen opened on
      that same week in August no matter what date it was read on. Once those
      payouts were sent it would open on an empty week forever, and an admin
      would have to know to go looking for the current one.

      Monday-to-Sunday, matching `payout.service`. The week just gone rather
      than the current one: the current week is still accruing, so its figures
      would move under the admin between opening the screen and approving
      anything. `loadData` corrects this from the server's own answer anyway —
      this is only where the screen starts.
    */
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7)
    return ymd(d)
  })
  const [periodLabel, setPeriodLabel] = useState('')
  const [periodClosed, setPeriodClosed] = useState(true)
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [receiptView, setReceiptView] = useState<Settlement | null>(null)
  /** Weeks other than this one that still owe money, newest first. */
  const [allPeriods, setAllPeriods] = useState<
    { periodStart: string; periodEnd: string; providers: number; payable: number; gross: number; statuses: string[] }[]
  >([])

  const loadData = async () => {
    setLoading(true)
    try {
      const [setRes, pRes] = await Promise.all([
        monetizationApi.settlements(weekStart),
        monetizationApi.settlementPeriods(),
      ])
      setSettlements(setRes.data.settlements || [])
      setPeriodLabel(setRes.data.periodLabel || '')
      setPeriodClosed(setRes.data.periodClosed !== false)
      setAllPeriods(pRes.data.periods || [])
    } catch (e: any) {
      toast(translatePortalText(e?.message || 'Failed to load settlements'), 'warn')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [weekStart])

  /**
   * The weekly settlement run.
   *
   * This is the table an admin works through to send the week's transfers, and
   * it offered a search box and nothing else — no way to see only the ones
   * still pending, only the ones whose bank details are ready to pay, or to put
   * the largest transfers first. Sorted by what is owed, descending, because
   * that is the order the money goes out in.
   */
  /**
   * The week pills: every outstanding week, plus whichever week is on screen.
   *
   * Including the current selection matters — without it, settling a week makes
   * its own pill vanish from under the admin while they are still reading it.
   */
  const weekPills = useMemo(() => {
    const byStart = new Map(allPeriods.map(wk => [wk.periodStart, wk]))
    if (!byStart.has(weekStart)) {
      byStart.set(weekStart, { periodStart: weekStart, periodEnd: '', providers: 0, payable: 0, gross: 0, statuses: [] })
    }
    const short = (iso: string) =>
      iso ? formatPortalDate(new Date(`${iso}T00:00:00`), { month: 'short', day: 'numeric' }) : ''
    return [...byStart.values()]
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))
      .slice(0, 6)
      .map(wk => ({
        ...wk,
        label: wk.periodEnd ? `${short(wk.periodStart)} – ${short(wk.periodEnd)}` : short(wk.periodStart),
      }))
  }, [allPeriods, weekStart])

  /** Outstanding weeks that are not the one already on screen. */
  const outstandingPeriods = useMemo(
    () => allPeriods.filter(wk => wk.periodStart !== weekStart && wk.payable > 0),
    [allPeriods, weekStart]
  )

  const setCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (s) => [s.businessName, s.providerName, s.providerType],
    filters: [
      { key: 'status', label: 'Payout status', get: (s) => s.status },
      { key: 'type', label: 'Provider type', get: (s) => s.providerType?.replace(/_/g, ' ') },
      { key: 'model', label: 'Billing model', get: (s) => s.billingModel },
      {
        key: 'bank',
        label: 'Bank details',
        options: [
          { value: 'ready', label: 'Ready to pay' },
          { value: 'missing', label: 'Missing bank details' },
        ],
        get: (s) => (s.bankReady ? 'ready' : 'missing'),
      },
      {
        key: 'refundfee',
        label: 'Refund fees',
        options: [
          { value: 'any', label: 'Has a refund-fee deduction' },
          { value: 'none', label: 'No deduction' },
        ],
        get: (s) => ((s.refundFeeDeduction ?? 0) > 0 ? 'any' : 'none'),
      },
    ],
    sortOptions: [
      // `payableAmount` is what the transfer will actually be; `netAmount` is
      // what was earned before a refund's card fee came off it.
      { key: 'payable', label: 'Net payable', get: (s) => s.payableAmount ?? s.netAmount ?? 0, defaultDir: 'desc' },
      { key: 'gross', label: 'Gross', get: (s) => s.grossAmount ?? 0, defaultDir: 'desc' },
      { key: 'commission', label: 'Commission', get: (s) => s.commissionAmount ?? 0, defaultDir: 'desc' },
      { key: 'name', label: 'Business', get: (s) => s.businessName, defaultDir: 'asc' },
    ],
    defaultSort: 'payable',
    syncUrl: false,
    defaultPageSize: 25,
  }), [])
  const setTf = useTableFilters(settlements, setCfg)

  useEffect(() => {
    setTf.setPage(1)
  }, [weekStart])

  const handleApprovePayout = async (payoutId: string) => {
    setBusyId(payoutId)
    try { await monetizationApi.approvePayout(payoutId); toast(translatePortalText('Payout approved — ready to send')); loadData() }
    catch (e: any) { toast(translatePortalText(e.message || 'Failed to approve payout'), 'warn') }
    finally { setBusyId(null) }
  }

  const handleMarkPayoutPaid = (s: Settlement) => {
    if (!s.payoutId) return
    const payoutId = s.payoutId
    // HyperPay has no payout API, so the admin sends the money by bank transfer
    // themselves and records the reference here for the audit trail. The
    // reference is required: an unreferenced settlement is not auditable, and
    // `window.prompt` had no way to enforce that (nor to stop the JS thread
    // freezing while the dialog was open).
    /**
     * `payableAmount`, not `netAmount` — that is what the bank transfer is
     * worth once this week's refund processing fees come off. Telling the admin
     * to send the gross would over-pay the provider by the fees the platform
     * has already recovered from their wallet.
     */
    const toSend = s.payableAmount ?? s.netAmount
    const deduction = s.refundFeeDeduction ?? 0

    return confirmAndRun({
      title: 'Mark this payout as paid?',
      body:
        `Confirm you have sent ${fmt(toSend)} to ${s.businessName} by bank transfer. This settles their wallet.` +
        (deduction > 0
          ? ` (${fmt(s.netAmount)} earned, less ${fmt(deduction)} of card-processing fees on refunded bookings.)`
          : ''),
      input: {
        label: 'Payment reference',
        placeholder: 'Transaction id or bank note',
        required: true,
        maxLength: 120,
      },
      /**
       * The bank's receipt, required.
       *
       * There is no gateway disbursement API, so this document is the only
       * evidence the money left — and the provider is shown it in their app.
       * The server refuses without one; asking here means the admin is told by
       * the form rather than by a rejected request.
       */
      file: {
        label: 'Bank transfer receipt',
        accept: 'image/*,application/pdf',
        required: true,
        maxBytes: 15 * 1024 * 1024,
        hint: 'A screenshot or PDF from the bank. The provider can see this.',
      },
      confirmLabel: 'Mark paid',
      busyLabel: 'Settling...',
      run: async (reference, proof) => {
        if (!proof) return
        setBusyId(payoutId)
        try {
          if (s.status === 'pending' || s.status === 'rejected') {
            await monetizationApi.approvePayout(payoutId)
          }
          await monetizationApi.markPayoutPaid(payoutId, reference, proof)
          loadData()
        } finally { setBusyId(null) }
      },
      success: `Payout to ${s.businessName} marked paid and wallet settled`,
      error: 'Could not mark this payout paid. Please try again.',
    })
  }

  /**
   * A transfer that could not be sent — a bounced IBAN, a compliance hold, a
   * period finance has decided to withhold.
   *
   * The reason is required because it is the only thing that tells the provider
   * (who is notified) and the next admin what happened. The money stays in the
   * provider's wallet and rolls into the retry: rejecting is recording a failed
   * transfer, not cancelling what they earned.
   */
  const handleRejectPayout = (s: Settlement) => {
    if (!s.payoutId) return
    const payoutId = s.payoutId
    return confirmAndRun({
      title: 'Put this payout on hold?',
      body: `${s.businessName} keeps the ${fmt(s.netAmount)} they have earned — this only records that the transfer did not go through. They will be notified with the reason below.`,
      input: {
        label: 'Reason',
        placeholder: 'e.g. bank returned the transfer — name did not match the IBAN',
        required: true,
        maxLength: 500,
      },
      confirmLabel: 'Put on hold',
      busyLabel: 'Recording…',
      danger: true,
      run: async (reason) => {
        setBusyId(payoutId)
        try {
          await monetizationApi.rejectPayout(payoutId, reason)
          loadData()
        } finally { setBusyId(null) }
      },
      success: `Payout to ${s.businessName} put on hold`,
      error: 'Could not put this payout on hold. Please try again.',
    })
  }

  /**
   * Sets the account a provider is paid into, on their behalf.
   *
   * Here because a provider with no bank details cannot be approved at all, and
   * boat providers have no registration flow that collects an IBAN — so without
   * this the only fix is a database edit. The provider's own screen writes the
   * same field; this is the admin's unblock, not the primary path.
   */
  const handleSetBank = (s: Settlement) =>
    confirmAndRun({
      title: `Set the payout account for ${s.businessName}`,
      body: 'Enter the IBAN this provider is paid into. Ask them to confirm it first — a wrong IBAN sends the money to somebody else, and the account holder name must match it or the bank will return the transfer.',
      input: {
        label: 'IBAN',
        placeholder: 'SA00 0000 0000 0000 0000 0000',
        required: true,
        maxLength: 42,
        // Grouped and upper-cased as it is typed, so a transposed pair is
        // visible rather than buried in 24 unbroken characters.
        transform: (v) => formatIban(v),
        /**
         * The checksum is enforced before the dialog will close. This is the
         * one screen where the IBAN belongs to somebody the person typing it
         * has never met, and the money is gone once the wire goes out — so it
         * is also the screen where a check-digit test is worth the most.
         */
        validate: (v) => checkIban(v).error ?? null,
      },
      confirmLabel: 'Save account',
      busyLabel: 'Saving…',
      run: async (iban) => {
        setBusyId(s.providerId)
        try {
          await monetizationApi.setPayoutBank({
            providerId: s.providerId,
            // The registered business name is what the receiving bank matches
            // the IBAN against, so it is the right default rather than the
            // contact's personal name.
            accountHolderName: s.businessName,
            iban: normalizeIban(iban),
          })
          loadData()
        } finally { setBusyId(null) }
      },
      success: `Payout account saved for ${s.businessName}`,
      error: 'Could not save the payout account. Check the IBAN and try again.',
    })

  const settlementTotals = useMemo(() => settlements.reduce(
    (a, s) => ({ gross: a.gross + s.grossAmount, commission: a.commission + s.commissionAmount, net: a.net + s.netAmount }),
    { gross: 0, commission: 0, net: 0 }
  ), [settlements])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText('Weekly Payouts')}</h3>
          <p className="text-xs text-slate-400">{translatePortalText("Approving then marking a payout paid records that you sent the net by bank transfer and clears the provider's wallet.")}</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label !mb-1">{translatePortalText('Week starting (Monday)')}</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const [y, m, d] = weekStart.split('-').map(Number)
                  const prev = new Date(y, m - 1, d)
                  prev.setDate(prev.getDate() - 7)
                  setWeekStart(ymd(prev))
                }}
                className="btn-ghost !p-2 !text-xs border border-slate-200 rounded-lg"
                title={translatePortalText('Previous week')}
              >
                <ChevronLeft size={15} />
              </button>
              <input
                type="date"
                className="input !py-1.5 !text-xs font-bold"
                value={weekStart}
                max={ymd(new Date())}
                onChange={e => {
                  const raw = e.target.value
                  if (!raw) return
                  const [y, m, d] = raw.split('-').map(Number)
                  const picked = new Date(y, m - 1, d)
                  picked.setDate(picked.getDate() - ((picked.getDay() + 6) % 7))
                  setWeekStart(ymd(picked))
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const [y, m, d] = weekStart.split('-').map(Number)
                  const next = new Date(y, m - 1, d)
                  next.setDate(next.getDate() + 7)
                  if (ymd(next) <= ymd(new Date())) setWeekStart(ymd(next))
                }}
                className="btn-ghost !p-2 !text-xs border border-slate-200 rounded-lg disabled:opacity-30"
                disabled={weekStart >= ymd(new Date())}
                title={translatePortalText('Next week')}
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {periodLabel || 'Mon → Sun'}
              {!periodClosed && ' · still in progress'}
            </p>
          </div>
          <button type="button" onClick={loadData} className="btn-ghost mb-5 !py-1.5 !px-3 !text-[11px]">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {translatePortalText('Refresh')}
          </button>
        </div>
      </div>

      {/* Quick Week Select Pills */}
      <div className="flex flex-wrap items-center gap-2 mb-4 bg-slate-50 border border-slate-200/70 p-2.5 rounded-xl">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider me-1">{translatePortalText('Select Week:')}</span>
        {weekPills.length === 0 && (
          <span className="text-[11px] text-slate-400">{translatePortalText('No weeks are carrying unpaid payouts.')}</span>
        )}
        {weekPills.map(w => (
          <button
            key={w.periodStart}
            type="button"
            onClick={() => setWeekStart(w.periodStart)}
            className={`text-xs px-3 py-1.5 rounded-lg font-bold border transition flex items-center gap-1.5 ${
              weekStart === w.periodStart
                ? 'bg-deep-900 text-white border-deep-900 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span>{translatePortalText('Week of')} {w.label}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.2 rounded ${
              weekStart === w.periodStart ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
            }`}>
              {w.payable > 0
                ? `${w.providers} ${translatePortalText('providers')} · ${fmt(w.payable)}`
                : translatePortalText('Settled')}
            </span>
          </button>
        ))}
      </div>

      <div className="card mb-4 !border-ocean-200 !bg-ocean-50 p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-bold text-ocean-800">
          <AlertTriangle size={15} /> {translatePortalText('Payouts are sent by bank transfer, not automatically')}
        </p>
        <p className="mt-1 text-xs text-ocean-700">
          {translatePortalText("\n            HyperPay has no marketplace payout API. Send the net amount to the provider's bank account\n            yourself, then mark it paid here with a reference — that clears their wallet balance.\n          ")}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {([
          [translatePortalText('Gross earnings'), settlementTotals.gross, 'text-deep-900'],
          [translatePortalText('Platform commission'), settlementTotals.commission, 'text-emerald-600'],
          [translatePortalText('Net payable'), settlementTotals.net, 'text-amber-600'],
        ] as [string, number, string][]).map(([l, v, t]) => (
          <div key={l} className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{l}</p>
            <p className={`mt-0.5 font-display text-xl font-extrabold ${t}`}>{fmt(v)}</p>
          </div>
        ))}
      </div>

      {settlementTotals.net === 0 && !loading && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 border border-amber-200/80 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-amber-900 font-medium">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <span>
              {translatePortalText("\n                No payouts due for ")}<strong>{periodLabel || weekStart}</strong>.
              {outstandingPeriods.length > 0
                ? ` ${formatPortalNumber(outstandingPeriods.length)} ${translatePortalText(outstandingPeriods.length === 1 ? 'other week still carries unpaid money:' : 'other weeks still carry unpaid money:')}`
                : ` ${translatePortalText('No other week has money outstanding either.')}`}
            </span>
          </div>
          {outstandingPeriods.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {outstandingPeriods.slice(0, 4).map((wk, i) => (
                <button
                  key={wk.periodStart}
                  type="button"
                  onClick={() => setWeekStart(wk.periodStart)}
                  title={translatePortalText(`${formatPortalNumber(wk.providers)} provider${wk.providers === 1 ? '' : 's'} · ${fmt(wk.payable)} payable`)}
                  className={
                    i === 0
                      ? 'btn-primary !py-1.5 !px-3 !text-xs font-bold whitespace-nowrap shadow-sm'
                      : 'btn-ghost !py-1.5 !px-3 !text-xs font-bold border border-amber-300 bg-white hover:bg-amber-100 whitespace-nowrap text-amber-900'
                  }
                >
                  {formatPortalDate(new Date(`${wk.periodStart}T00:00:00`), { month: 'short', day: 'numeric' })}
                  {' · '}
                  {fmt(wk.payable)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <TableToolbar
        state={setTf}
        config={setCfg}
        rows={settlements}
        noun={translatePortalText('providers')}
        searchPlaceholder={translatePortalText('Search business or provider…')}
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[1020px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-sand text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3.5">{translatePortalText('Provider')}</th>
                <th className="px-4 py-3.5 text-right">{translatePortalText('Gross')}</th>
                <th className="px-4 py-3.5 text-right">{translatePortalText('Commission')}</th>
                <th className="px-4 py-3.5 text-right">{translatePortalText('Net payable')}</th>
                <th className="px-4 py-3.5 text-right">{translatePortalText('Wallet')}</th>
                <th className="px-4 py-3.5 text-center">{translatePortalText('Status')}</th>
                <th className="px-5 py-3.5 text-right">{translatePortalText('Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && (
                <tr>
                  <td colSpan={7} className="p-4">
                    <TableSkeleton rows={6} cols={7} />
                  </td>
                </tr>
              )}
              {!loading && settlements.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-sm text-slate-400">
                    {translatePortalText("\n                      No providers earned anything to settle for ")}{periodLabel || 'this week'}.
                  </td>
                </tr>
              )}
              {setTf.pagedRows.map((s) => (
                <tr key={s.providerId} className="transition hover:bg-sand/70">
                  <td className="px-5 py-4 min-w-[240px]">
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{s.businessName}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {translatePortalText(PROVIDER_TYPE_LABELS[s.providerType]) || s.providerType}
                      {' · '}
                      {s.planKind === 'fixed_fee'
                        ? `SAR ${formatPortalNumber(s.feePerTransaction ?? 0)} ${translatePortalText('per transaction')}`
                        : s.billingModel === 'subscription' ? translatePortalText('Subscription') : `${formatPortalPercent(s.commissionPercentage)} ${translatePortalText('commission')}`}
                      {s.transactionCount > 0 && ` · ${formatPortalNumber(s.transactionCount)} ${translatePortalText(s.transactionCount === 1 ? 'booking' : 'bookings')}`}
                    </p>
                    {!s.bankReady && s.netAmount > 0 && s.status !== 'paid' && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-amber-600">
                        <AlertTriangle size={11} /> {translatePortalText('No payout account on file')}
                      </p>
                    )}
                    {s.commissionOwed > 0 && (
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {translatePortalText("\n                          Owes ")}{fmt(s.commissionOwed)} {translatePortalText(" cash commission (not deducted)\n                        ")}</p>
                    )}
                    {s.payoutReference && (
                      <p className="mt-1 truncate text-[11px] text-slate-400">{translatePortalText("Ref: ")}{s.payoutReference}</p>
                    )}
                    {s.failureReason && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-rose-600">
                        <AlertTriangle size={11} /> {s.failureReason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right text-[13px] font-extrabold text-deep-900 whitespace-nowrap">
                    {fmt(s.grossAmount)}
                  </td>
                  <td className="px-4 py-4 text-right text-[13px] font-extrabold text-emerald-600 whitespace-nowrap">
                    {fmt(s.commissionAmount)}
                  </td>
                  <td className="px-4 py-4 text-right text-[13px] font-extrabold text-amber-600 whitespace-nowrap">
                    {fmt(s.netAmount)}
                  </td>
                  <td className="px-4 py-4 text-right text-xs font-bold text-slate-500 whitespace-nowrap">
                    {fmt(s.walletBalance)}
                  </td>
                  <td className="px-4 py-4 text-center whitespace-nowrap">
                    <ABadge>{s.status === 'none' ? translatePortalText('Nothing due') : translatePortalText(s.status)}</ABadge>
                  </td>
                  <td className="px-5 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {!s.bankReady && s.netAmount > 0 && s.status !== 'paid' && (
                        <button disabled={busyId === s.providerId} onClick={() => handleSetBank(s)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40">
                          {busyId === s.providerId ? <Loader2 size={11} className="animate-spin" /> : <Landmark size={11} />} {translatePortalText('Set bank')}
                        </button>
                      )}
                      {s.payoutId && (s.status === 'pending' || s.status === 'rejected') && (
                        <button
                          disabled={busyId === s.payoutId || !s.bankReady}
                          title={s.bankReady ? undefined : translatePortalText('This provider has no payout account on file')}
                          onClick={() => handleApprovePayout(s.payoutId!)}
                          className="btn-ghost !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40"
                        >
                          {busyId === s.payoutId ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} {s.status === 'rejected' ? translatePortalText('Retry') : translatePortalText('Approve')}
                        </button>
                      )}
                      {s.payoutId && (s.status === 'approved' || s.status === 'pending') && (
                        <button
                          disabled={busyId === s.payoutId || !s.bankReady}
                          title={translatePortalText(s.bankReady ? 'Upload bank transfer receipt and mark paid' : 'This provider has no payout account on file')}
                          onClick={() => handleMarkPayoutPaid(s)}
                          className="btn-admin !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40 flex items-center gap-1.5"
                        >
                          {busyId === s.payoutId ? <Loader2 size={11} className="animate-spin" /> : <BanknoteIcon size={11} />} {translatePortalText('Mark paid & Upload receipt')}
                        </button>
                      )}
                      {s.payoutId && (s.status === 'pending' || s.status === 'approved') && (
                        <button
                          disabled={busyId === s.payoutId}
                          onClick={() => handleRejectPayout(s)}
                          className="btn-ghost !py-1.5 !px-2.5 !text-[11px] text-rose-600 disabled:opacity-40"
                        >
                          {busyId === s.payoutId ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />} {translatePortalText('Hold')}
                        </button>
                      )}
                      {s.status === 'paid' && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-emerald-600">{translatePortalText('Paid')} {fmtDate(s.paidAt)}</span>
                          {s.transferProof?.url && (
                            <button
                              type="button"
                              onClick={() => setReceiptView(s)}
                              className="btn-ghost !py-1 !px-2 !text-[11px] text-ocean-600 hover:text-ocean-700 flex items-center gap-1 font-bold border border-ocean-200 rounded-lg hover:bg-ocean-50"
                              title={translatePortalText("View uploaded bank transfer receipt")}
                            >
                              <Eye size={12} /> {translatePortalText('View receipt')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination state={setTf} noun={translatePortalText('settlements')} />
      </div>

      {/* Bank Transfer Receipt Preview Modal */}
      {receiptView && (
        <Modal
          open={!!receiptView}
          onClose={() => setReceiptView(null)}
          title={translatePortalText(`Bank Transfer Receipt — ${receiptView.businessName}`)}
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-sand p-3.5 text-xs space-y-1.5 border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{translatePortalText("Settlement Week:")}</span>
                <span className="font-bold text-deep-900">{receiptView.periodStart} → {receiptView.periodEnd}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{translatePortalText("Net Amount Transferred:")}</span>
                <span className="font-extrabold text-amber-600 font-display text-sm">{receiptView.currency || 'SAR'} {fmt(receiptView.payableAmount ?? receiptView.netAmount)}</span>
              </div>
              {receiptView.payoutReference && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">{translatePortalText("Bank Wire Reference:")}</span>
                  <span className="font-mono font-bold text-deep-900 bg-white px-2 py-0.5 rounded border border-slate-200">{receiptView.payoutReference}</span>
                </div>
              )}
              {receiptView.paidAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{translatePortalText("Paid On:")}</span>
                  <span className="font-bold text-slate-700">{fmtDate(receiptView.paidAt)}</span>
                </div>
              )}
            </div>

            {receiptView.transferProof?.url && (
              <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-900/5 p-3 text-center">
                {receiptView.transferProof.mimeType?.includes('pdf') || receiptView.transferProof.url.toLowerCase().endsWith('.pdf') ? (
                  <div className="py-8 space-y-3">
                    <FileText size={48} className="mx-auto text-ocean-600" />
                    <p className="text-xs font-bold text-slate-700">{receiptView.transferProof.originalName || 'Bank Transfer Receipt (PDF)'}</p>
                    <a
                      href={fileUrl(receiptView.transferProof.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-admin inline-flex items-center gap-1.5 text-xs !py-2 !px-4 shadow-sm"
                    >
                      <ExternalLink size={13} /> {translatePortalText(" Open Receipt Document\n                    ")}</a>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <img
                      src={fileUrl(receiptView.transferProof.url)}
                      alt={translatePortalText("Bank Transfer Proof")}
                      className="max-h-[460px] w-auto mx-auto rounded-lg shadow-sm object-contain border border-slate-100 bg-white"
                    />
                    <div className="pt-1">
                      <a
                        href={fileUrl(receiptView.transferProof.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost inline-flex items-center gap-1 text-xs text-ocean-600 font-bold"
                      >
                        <ExternalLink size={12} /> {translatePortalText(" Open full size in new tab\n                      ")}</a>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end pt-1">
              <button type="button" onClick={() => setReceiptView(null)} className="btn-ghost text-xs">{translatePortalText("Close")}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

// ══════════ PAYMENT MODEL CHANGE REQUESTS ══════════
// A provider's billing model can only change with Super Admin approval, so
// this queue is the sole path for switching an account between models. A tab
// on Packages & Pricing, next to Provider Models, which it changes.
function ModelChangesPanel({ onReviewed }: { onReviewed?: () => void }) {
  const [requests, setRequests] = useState<ModelChangeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('pending')

  const load = async () => {
    setLoading(true)
    try {
      const res = await monetizationApi.listModelChanges(statusFilter || undefined)
      setRequests(res.data.requests || [])
      setError('')
    } catch (e: any) { setError(e?.message || 'Failed to load requests') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [statusFilter])

  // Approve and decline are the same call with different copy. Decline asks for
  // a reason in the dialog itself, because the provider is shown it -- a blocking
  // `prompt()` with no validation was the wrong instrument.
  const review = (id: string, approve: boolean) =>
    confirmAndRun({
      title: approve ? 'Approve this billing-model change?' : 'Decline this request?',
      body: approve
        ? 'It takes effect immediately, and the provider will be billed on the new model from now on.'
        : 'The provider stays on their current model and will see your reason.',
      input: approve
        ? undefined
        : { label: 'Reason (optional)', placeholder: 'Shown to the provider', multiline: true, maxLength: 400 },
      confirmLabel: approve ? 'Approve' : 'Decline',
      busyLabel: approve ? 'Approving...' : 'Declining...',
      danger: !approve,
      run: async (reason) => {
        setBusyId(id)
        try {
          await monetizationApi.reviewModelChange(id, approve, reason || undefined)
          load()
          onReviewed?.()
        } finally { setBusyId(null) }
      },
      success: approve ? 'Payment model updated' : 'Request declined',
      error: approve
        ? 'Could not approve the change. Please try again.'
        : 'Could not decline the request. Please try again.',
    })

  return (
    <>
      <div className="mb-4">
        <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText('Model Change Requests')}</h3>
        <p className="text-xs text-slate-400">{translatePortalText('Providers cannot switch between subscription and commission without approval')}</p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['pending', 'approved', 'rejected', ''].map(s => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-extrabold capitalize transition ${statusFilter === s ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-400' : 'bg-sand text-slate-600 hover:bg-slate-200'}`}>
            {translatePortalText(s || 'all')}
          </button>
        ))}
        <button className="btn-ghost ms-auto !py-1.5 !px-3 !text-[11px]" onClick={load}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {translatePortalText('Refresh')}</button>
      </div>

      {error && <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{error}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[2fr_1.4fr_1.6fr_1fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>{translatePortalText('Provider')}</span><span>{translatePortalText('Change')}</span><span>{translatePortalText('Reason')}</span><span>{translatePortalText('Status')}</span><span className="text-right">{translatePortalText('Actions')}</span>
            </div>
            {loading && <TableSkeleton rows={5} cols={4} />}
            {!loading && requests.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No ")}{statusFilter || ''} {translatePortalText(" change requests.")}</div>}
            {requests.map((r, i) => {
              const prov = typeof r.providerId === 'object' ? r.providerId : null
              return (
                <motion.div key={r._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[2fr_1.4fr_1.6fr_1fr_auto] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{prov?.business?.businessName || prov?.name || 'Provider'}</p>
                    <p className="truncate text-[11px] text-slate-400">{prov?.email} · {fmtDate(r.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap">
                    <span className="chip !text-[11px] bg-slate-100 text-slate-600">{r.fromModel || '—'}</span>
                    <ArrowRightLeft size={12} className="text-slate-400" />
                    <span className="chip !text-[11px] bg-emerald-50 text-emerald-700">{r.toModel}</span>
                  </div>
                  <div className="truncate text-xs text-slate-500">{r.reason || r.rejectionReason || '—'}</div>
                  <div className="whitespace-nowrap"><ABadge>{translatePortalText(r.status)}</ABadge></div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    {r.status === 'pending' ? (
                      <>
                        <button disabled={busyId === r._id} onClick={() => review(r._id, false)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-rose-600 disabled:opacity-40">{translatePortalText('Decline')}</button>
                        <button disabled={busyId === r._id} onClick={() => review(r._id, true)} className="btn-admin !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40">
                          {busyId === r._id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} {translatePortalText('Approve')}
                        </button>
                      </>
                    ) : <span className="text-[11px] text-slate-400">{translatePortalText("Reviewed ")}{fmtDate(r.reviewedAt)}</span>}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

// ══════════ FINANCIAL REPORTS ══════════
export function AdminFinancialReports() {
  const yearStart = `${new Date().getFullYear()}-01-01`
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [report, setReport] = useState<Awaited<ReturnType<typeof monetizationApi.report>>['data'] | null>(null)

  const providerRows = report?.byProvider ?? []

  /**
   * Searching by name has to keep working for the rows whose provider account was
   * deleted, so the id is searchable too — it is the only handle those rows have.
   */
  const provCfg: TableFiltersConfig<(typeof providerRows)[number]> = useMemo(() => ({
    searchFields: (r) => [
      r.provider?.business?.businessName,
      r.provider?.name,
      r.provider?.email,
      r._id,
      (r.models ?? []).join(' '),
    ],
    filters: [
      {
        key: 'model',
        label: 'Billing model',
        options: [...new Set(providerRows.flatMap(r => r.models ?? []))]
          .sort()
          .map(v => ({ value: v, label: v })),
        get: (r) => (r.models ?? []).join(','),
        match: (r, v) => (r.models ?? []).includes(v),
      },
      { key: 'type', label: 'Provider type', get: (r) => r.provider?.role?.replace(/_/g, ' ') },
      {
        key: 'exists',
        label: 'Account',
        options: [
          { value: 'live', label: 'Still active' },
          { value: 'deleted', label: 'Deleted since' },
        ],
        get: (r) => (r.providerExists === false ? 'deleted' : 'live'),
      },
      {
        key: 'earning',
        label: 'Commission',
        options: [
          { value: 'yes', label: 'Earned commission' },
          { value: 'no', label: 'No commission' },
        ],
        get: (r) => ((r.commission ?? 0) > 0 ? 'yes' : 'no'),
      },
    ],
    // Biggest contributors first — this table answers "where does the
    // platform's revenue come from", and that is an ordered question.
    sortOptions: [
      { key: 'gross', label: 'Gross', get: (r) => r.gross ?? 0, defaultDir: 'desc' },
      { key: 'commission', label: 'Commission', get: (r) => r.commission ?? 0, defaultDir: 'desc' },
      { key: 'count', label: 'Bookings', get: (r) => r.count ?? 0, defaultDir: 'desc' },
      { key: 'name', label: 'Business', get: (r) => r.provider?.business?.businessName || r.provider?.name || '', defaultDir: 'asc' },
    ],
    defaultSort: 'gross',
  }), [providerRows])
  const provTf = useTableFilters(providerRows, provCfg)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await monetizationApi.report({ from, to })
      setReport(res.data)
      setError('')
    } catch (e: any) { setError(e?.message || 'Failed to load report') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const t = report?.totals
  const cards: [string, number, string][] = [
    [translatePortalText('Gross booking volume'), t?.grossVolume ?? 0, 'text-deep-900'],
    [translatePortalText('Commission revenue'), t?.platformCommission ?? 0, 'text-emerald-600'],
    [translatePortalText('Subscription revenue'), t?.subscriptionRevenue ?? 0, 'text-ocean-600'],
    [translatePortalText('Total platform revenue'), t?.platformRevenue ?? 0, 'text-teal-600'],
    [translatePortalText('Paid out to providers'), t?.payoutsPaid ?? 0, 'text-amber-600'],
    [translatePortalText('Bookings settled'), t?.bookings ?? 0, 'text-slate-600'],
  ]

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText('Financial Reports')} sub={translatePortalText('Platform revenue across commission and subscription, by period')} icon={<Wallet className="text-emerald-500" />}
        actions={
          <button className="btn-admin !text-xs" onClick={async () => {
            try { await monetizationApi.downloadReport({ from, to }); toast(translatePortalText('Excel report downloaded')) }
            catch (e: any) { toast(translatePortalText(e?.message || translatePortalText('Export failed')), 'warn') }
          }}><Download size={14} /> {translatePortalText('Export Excel')}</button>
        } />

      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <div><label className="label !mb-1">{translatePortalText('From')}</label><input type="date" className="input !py-1.5 !text-xs" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label !mb-1">{translatePortalText('To')}</label><input type="date" className="input !py-1.5 !text-xs" value={to} onChange={e => setTo(e.target.value)} /></div>
        <button className="btn-admin !text-xs" onClick={load}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {translatePortalText('Run report')}</button>
        {report && <span className="ms-auto text-xs font-bold text-slate-400">{translatePortalText("Currency: ")}{report.currency}</span>}
      </div>

      {error && <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{error}</div>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(([l, v, cls]) => (
          <div key={l} className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{l}</p>
            <p className={`mt-0.5 font-display text-xl font-extrabold ${cls}`}>{fmt(v)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={translatePortalText('By booking vertical')} sub={translatePortalText('Where the volume comes from')}>
          <div className="space-y-2">
            {(report?.byVertical || []).length === 0 && <p className="py-8 text-center text-xs text-slate-400">{translatePortalText("No settled bookings in this period.")}</p>}
            {(report?.byVertical || []).map(v => (
              <div key={String(v._id)} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 text-xs">
                <span className="w-24 font-extrabold capitalize text-deep-900">{verticalLabel(v._id)}</span>
                <span className="text-slate-400">{formatPortalNumber(v.count)} {translatePortalText('bookings')}</span>
                <span className="ms-auto font-extrabold text-deep-900">{fmt(v.gross)}</span>
                <span className="w-24 text-right font-extrabold text-emerald-600">{fmt(v.commission)}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={translatePortalText('By payment model')} sub={translatePortalText('Commission vs subscription mix')}>
          <div className="space-y-2">
            {(report?.byModel || []).length === 0 && <p className="py-8 text-center text-xs text-slate-400">{translatePortalText("Nothing to show yet.")}</p>}
            {(report?.byModel || []).map(m => (
              <div key={String(m._id)} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 text-xs">
                <span className="w-28 font-extrabold capitalize text-deep-900">{translatePortalText(String(m._id))}</span>
                <span className="text-slate-400">{formatPortalNumber(m.count)} {translatePortalText('bookings')}</span>
                <span className="ms-auto font-extrabold text-deep-900">{fmt(m.gross)}</span>
                <span className="w-24 text-right font-extrabold text-emerald-600">{fmt(m.commission)}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title={translatePortalText('Top providers by commission')} sub={translatePortalText('Highest platform earners in this period')} className="mt-5">
        {providerRows.length > 0 && (
          <TableToolbar
            state={provTf}
            config={provCfg}
            rows={providerRows}
            noun={translatePortalText('providers')}
            searchPlaceholder={translatePortalText('Search providers by business, name or email...')}
          />
        )}
        <div className="overflow-hidden">
          <div className="hidden grid-cols-[2fr_1fr_0.8fr_1fr_1fr_1fr] gap-4 border-b border-slate-100 bg-sand px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 lg:grid">
            <span>{translatePortalText('Provider')}</span><span>{translatePortalText('Model')}</span><span>{translatePortalText('Bookings')}</span><span>{translatePortalText('Gross')}</span><span>{translatePortalText('Commission')}</span><span>{translatePortalText('Net')}</span>
          </div>
          {providerRows.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText('No provider revenue in this period.')}</div>}
          {providerRows.length > 0 && provTf.filtered.length === 0 && (
            <NoFilterMatches noun="providers" onClear={provTf.clear} />
          )}
          {provTf.filtered.map((r, i) => (
            <motion.div key={r._id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
              className="grid grid-cols-2 items-center gap-4 border-b border-slate-50 px-4 py-3 transition hover:bg-sand last:border-b-0 lg:grid-cols-[2fr_1fr_0.8fr_1fr_1fr_1fr]">
              {/* A provider deleted since the transaction says so outright. A blank
                  cell reads as a broken report; "deleted" reads as an orphaned row,
                  which is what it is, and the money on it still counts. */}
              <div className="col-span-2 min-w-0 lg:col-span-1">
                {r.provider?.business?.businessName || r.provider?.name ? (
                  <>
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{r.provider?.business?.businessName || r.provider?.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{r.provider?.email}</p>
                  </>
                ) : (
                  <>
                    <p className="truncate text-[13px] font-extrabold italic text-slate-400">
                      {r.providerExists === false ? translatePortalText('Deleted provider') : translatePortalText('Unnamed provider')}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">#{String(r._id).slice(-6)}</p>
                  </>
                )}
              </div>
              {/* The model charged on these transactions, not the account's model
                  today — a provider who switched plans did not change history. */}
              <div><span className="chip !text-[11px] bg-slate-100 text-slate-600">{(r.models || []).filter(Boolean).join(', ') || r.provider?.onboarding?.billingModel || '—'}</span></div>
              <div className="text-xs font-bold text-slate-500">{formatPortalNumber(r.count)}</div>
              <div className="text-[13px] font-extrabold text-deep-900">{fmt(r.gross)}</div>
              <div className="text-[13px] font-extrabold text-emerald-600">{fmt(r.commission)}</div>
              <div className="text-[13px] font-extrabold text-amber-600">{fmt(r.net)}</div>
            </motion.div>
          ))}
        </div>
      </Section>
    </PageWrap>
  )
}

/**
 * The card processing fee and the default commission.
 *
 * Numbers, so edited as a draft and saved once, rather than saved per keystroke
 * like the switches above. A blank field clears the admin value and the
 * server's fallback applies again, which the placeholder names.
 */
function FeeAndCommissionCard({
  settings,
  effective,
  busy,
  onSave,
}: {
  settings: BillingSettingsData
  effective: EffectivePlatformPolicy | null
  busy: boolean
  onSave: (patch: Partial<BillingSettingsData>) => Promise<void>
}) {
  const asText = (v: number | null | undefined) => (typeof v === 'number' ? String(v) : '')
  const [pct, setPct] = useState(asText(settings.processingFeePct))
  const [fixed, setFixed] = useState(asText(settings.processingFeeFixedSar))
  const [bearer, setBearer] = useState<'' | 'platform' | 'provider'>(settings.processingFeeBearer ?? '')
  const [commission, setCommission] = useState(asText(settings.defaultCommissionPct))

  useEffect(() => {
    setPct(asText(settings.processingFeePct))
    setFixed(asText(settings.processingFeeFixedSar))
    setBearer(settings.processingFeeBearer ?? '')
    setCommission(asText(settings.defaultCommissionPct))
  }, [settings.processingFeePct, settings.processingFeeFixedSar, settings.processingFeeBearer, settings.defaultCommissionPct])

  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const invalid =
    [num(pct), num(fixed), num(commission)].some((v) => v !== null && !Number.isFinite(v)) ||
    (num(pct) ?? 0) < 0 || (num(pct) ?? 0) > 20 ||
    (num(fixed) ?? 0) < 0 || (num(fixed) ?? 0) > 50 ||
    (num(commission) ?? 0) < 0 || (num(commission) ?? 0) > 100

  const dirty =
    num(pct) !== (settings.processingFeePct ?? null) ||
    num(fixed) !== (settings.processingFeeFixedSar ?? null) ||
    (bearer || null) !== (settings.processingFeeBearer ?? null) ||
    num(commission) !== (settings.defaultCommissionPct ?? null)

  const save = async () => {
    const ok = await confirm({
      title: 'Change the fee and default commission?',
      body:
        'The fee applies to online bookings that settle from now on, and the default commission to providers ' +
        'assigned it from now on (signups and plan switches without a package). Bookings already settled and ' +
        'providers already on a rate are not repriced. Other servers pick the change up within a minute.',
      confirmLabel: 'Save',
    })
    if (!ok) return
    await onSave({
      processingFeePct: num(pct),
      processingFeeFixedSar: num(fixed),
      processingFeeBearer: bearer || null,
      defaultCommissionPct: num(commission),
    })
  }

  const fallback = (v: number | undefined, unit: string) =>
    typeof v === 'number' ? `${formatPortalNumber(v)}${unit} (${translatePortalText('server default')})` : translatePortalText('server default')

  return (
    <div className="card p-4">
      <label className="label">{translatePortalText("Card processing fee")}</label>
      <p className="mb-3 text-xs text-slate-400">
        {translatePortalText("\n        What the payment gateway charges on an online payment, from your merchant agreement, and who pays it.\n        Cash bookings never carry it. Leave a box blank to use the server's configured value.\n      ")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-500">{translatePortalText("Percentage (%)")}</span>
          <input className="input" inputMode="decimal" value={pct} disabled={busy} onChange={(e) => setPct(e.target.value)}
            placeholder={settings.processingFeePct == null ? fallback(effective?.processingFeePct, '%') : ''} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-500">{translatePortalText("Fixed per payment (SAR)")}</span>
          <input className="input" inputMode="decimal" value={fixed} disabled={busy} onChange={(e) => setFixed(e.target.value)}
            placeholder={settings.processingFeeFixedSar == null ? fallback(effective?.processingFeeFixedSar, '') : ''} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-500">{translatePortalText("Paid by")}</span>
          <select className="input font-bold" value={bearer} disabled={busy} onChange={(e) => setBearer(e.target.value as '' | 'platform' | 'provider')}>
            <option value="">{translatePortalText("Server default")}{effective && settings.processingFeeBearer == null ? ` (${translatePortalText(effective.processingFeeBearer)})` : ''}</option>
            <option value="platform">{translatePortalText("Platform (out of its commission)")}</option>
            <option value="provider">{translatePortalText("Provider (out of their payout)")}</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {translatePortalText("\n        When the platform pays, the fee comes out of its commission, never below zero; anything beyond that\n        falls to the provider and is shown on their statement.\n      ")}</p>

      <label className="label mt-5">{translatePortalText("Default commission")}</label>
      <p className="mb-2 text-xs text-slate-400">
        {translatePortalText("\n        The rate a provider gets on the commission model without a package: at signup, on a plan switch, and when a\n        cancelled subscription falls back to commission. Providers already on a rate keep it.\n      ")}</p>
      <div className="flex items-center gap-2">
        <input className="input max-w-[140px]" inputMode="decimal" value={commission} disabled={busy} onChange={(e) => setCommission(e.target.value)}
          placeholder={settings.defaultCommissionPct == null ? fallback(effective?.defaultCommissionPct, '%') : ''} />
        <span className="text-sm font-bold text-slate-500">%</span>
      </div>

      {invalid && (
        <p className="mt-3 text-xs font-semibold text-rose-600">
          {translatePortalText("\n          Fee must be 0–20% and SAR 0–50; commission 0–100%.\n        ")}</p>
      )}
      <div className="mt-4 flex justify-end">
        <button className="btn-primary disabled:opacity-50" disabled={busy || !dirty || invalid} onClick={save}>
          {translatePortalText("\n          Save fee & commission\n        ")}</button>
      </div>
    </div>
  )
}
