import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Users, BadgeCheck, ShieldAlert, Plus, Download, Check, X, Eye, KeyRound, LogIn, Ban, FileCheck2, Trash2 } from 'lucide-react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { money, type KycItem, USER_ROLES, avatar } from '../adminData'
import { listingPhoto } from '../../images'
import { PageWrap, toKycItem } from './_shared'
import { Section, Modal, toast, Stars, Counter, Img, downloadCsv } from '../../ui'
import { AdminHeader, ABadge, AProgress } from '../adminUi'
import { adminPortalApi, authApi, documentsApi, type AdminPortalUser, type AdminUserStats, type AdminWorkerApproval, type ApiVendor, type ApiKycDocument } from '../../api'
import { confirmAndRun } from '../../async'
import { formatPortalDate, formatPortalNumber, formatPortalPercent, translatePortalText } from '../../i18n/runtime'

const roleLabels: Record<string, string> = { customer: 'Customer', boat_owner: 'Boat Owner', boat_provider: 'Boat Provider', marina_provider: 'Marina Provider', fuel_provider: 'Fuel Provider', maintenance_provider: 'Maintenance Provider', admin: 'Admin' }

const vendorCategoryLabels: Record<string, string> = { spare_parts: 'Spare Parts', cleaning: 'Cleaning', rescue: 'Rescue', provisioning: 'Provisioning', media: 'Media', other: 'Other' }
const vendorStatusLabels: Record<string, 'Approved' | 'Pending' | 'Suspended'> = { approved: 'Approved', pending: 'Pending', suspended: 'Suspended' }
const vendorDocsLabels: Record<string, 'Complete' | 'Missing'> = { complete: 'Complete', missing: 'Missing' }

interface UiVendor { id: string; name: string; category: string; icon: string; status: 'Approved' | 'Pending' | 'Suspended'; rating: number; revenue: number; commission: number; branches: number; docs: 'Complete' | 'Missing' }
const mapVendor = (v: ApiVendor): UiVendor => ({
  id: v.id || v._id,
  name: v.name,
  category: translatePortalText(vendorCategoryLabels[v.category] || v.category),
  icon: v.icon || '🧰',
  status: vendorStatusLabels[v.status] || 'Pending',
  rating: v.rating || 0,
  revenue: v.revenueTotal || 0,
  commission: v.commissionPct || 0,
  branches: v.branches || 1,
  docs: vendorDocsLabels[v.docsStatus] || 'Missing',
})

/**
 * One account, as this directory shows it.
 */
const mapUser = (u: AdminPortalUser, stats?: AdminUserStats): any => ({
  id: u.id || u._id,
  name: u.name,
  email: u.email,
  avatar: u.avatar || avatar(1),
  role: translatePortalText(roleLabels[u.role] || u.role),
  roleKey: u.role,
  status: !u.isActive ? 'Blocked' : u.onboarding?.status === 'suspended' ? 'Suspended' : u.onboarding?.status === 'pending' ? 'Pending' : 'Active',
  verified: u.onboarding?.status === 'approved',
  joinedAt: u.createdAt || '',
  joined: u.createdAt ? formatPortalDate(u.createdAt) : '—',
  bookings: stats?.bookings ?? 0,
  spend: stats?.spend ?? 0,
  lastOrderAt: stats?.lastOrderAt ?? null,
  country: u.business?.country || '—',
  tags: u.onboarding?.status === 'pending' ? ['New'] : []
})

// ══════════ USER MANAGEMENT (§2) — platform-wide master account directory ══════════
// Every account across every role — customers, owners, providers, vendors & staff.
export function AdminUsers() { return <UsersPage /> }

function WorkerApprovalQueue() {
  const [items, setItems] = useState<AdminWorkerApproval[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    adminPortalApi.workerApprovals('pending')
      .then(res => setItems(res.data.items))
      .catch(() => toast(translatePortalText('Failed to load worker approvals'), 'warn'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const review = async (worker: AdminWorkerApproval, decision: 'approved' | 'rejected') => {
    setBusyId(worker.id)
    try {
      await confirmAndRun({
        title: decision === 'approved' ? `${translatePortalText('Approve')} ${worker.name}?` : `${translatePortalText('Decline')} ${worker.name}?`,
        body:
          decision === 'approved'
            ? `${worker.name} ${translatePortalText('will be able to sign in and work for')} ${worker.providerName}.`
            : `${worker.name} ${translatePortalText('will be told why, so write something they can act on.')}`,
        confirmLabel: decision === 'approved' ? translatePortalText('Approve') : translatePortalText('Decline'),
        busyLabel: decision === 'approved' ? translatePortalText('Approving…') : translatePortalText('Declining…'),
        danger: decision === 'rejected',
        input:
          decision === 'rejected'
            ? {
                label: translatePortalText('Reason (shown to the worker)'),
                placeholder: translatePortalText('e.g. The licence photo is unreadable — please upload a clearer copy.'),
                required: true,
                multiline: true,
                maxLength: 500,
              }
            : undefined,
        success: `${worker.name} ${decision === 'approved' ? translatePortalText('approved') : translatePortalText('declined')}`,
        run: async reason => {
          await adminPortalApi.reviewWorker(worker.kind, worker.id, decision, reason.trim() || undefined)
          setItems(current => current.filter(item => !(item.id === worker.id && item.kind === worker.kind)))
        },
      })
    } finally {
      setBusyId(null)
    }
  }

  if (!loading && items.length === 0) return null
  return (
    <Section title={translatePortalText('Worker approvals')} sub={translatePortalText('Fuel, maintenance, and marina workers cannot use provider portals until an admin approves them')} className="mb-5">
      {loading ? (
        <div className="py-5 text-center text-sm text-slate-400">{translatePortalText('Loading worker approvals…')}</div>
      ) : (
        <div className="space-y-2">
          {items.map(worker => (
            <div key={`${worker.kind}-${worker.id}`} className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-3 sm:flex-row sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-lg shadow-sm">
                {worker.kind === 'marina' ? '⚓' : worker.kind === 'fuel' ? '⛽' : '🔧'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-deep-900">{worker.name}</p>
                <p className="truncate text-xs text-slate-500">{worker.email || translatePortalText('No email')} · {translatePortalText(worker.role)} · {worker.providerName}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  {worker.kind === 'fuel' ? translatePortalText('Fuel staff') : worker.kind === 'maintenance' ? translatePortalText('Maintenance technician') : translatePortalText('Marina worker')} · {translatePortalText('added')} {formatPortalDate(worker.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button disabled={busyId === worker.id} onClick={() => review(worker, 'approved')} className="btn-admin !py-1.5 !text-xs disabled:opacity-60"><Check size={13} /> {translatePortalText('Approve')}</button>
                <button disabled={busyId === worker.id} onClick={() => review(worker, 'rejected')} className="btn-ghost !py-1.5 !text-xs !text-rose-600 disabled:opacity-60"><X size={13} /> {translatePortalText('Reject')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
} 
function UsersPage() {
  const [sel, setSel] = useState<any | null>(null)
  const [users, setUsers] = useState<any[]>([])
  const [roleCounts, setRoleCounts] = useState<any[]>([])

  useEffect(() => {
    adminPortalApi.users({ limit: 500, withStats: true })
      .then(res => {
        const stats = res.data.stats || {}
        setUsers(res.data.items.map(u => mapUser(u, stats[u.id || u._id])))
        if (res.data.roleCounts) {
          const mappedCounts = Object.entries(res.data.roleCounts).map(([k, v]) => ({
            role: roleLabels[k] || k,
            count: v as number,
            icon: USER_ROLES.find(ur => ur.role === roleLabels[k])?.icon || '🧑‍💻'
          })).sort((a, b) => b.count - a.count)
          setRoleCounts(mappedCounts)
        }
      })
      .catch(err => toast(translatePortalText('Failed to load users'), 'warn'))
  }, [])

  const reload = () =>
    adminPortalApi.users({ limit: 500, withStats: true })
      .then(res => {
        const stats = res.data.stats || {}
        setUsers(res.data.items.map(u => mapUser(u, stats[u.id || u._id])))
      })
      .catch(() => toast(translatePortalText('Failed to reload users'), 'warn'))

  /**
   * Sends the account holder a real password-reset code.
   *
   * The button used to say "Password reset sent to X" and send nothing, so an
   * admin could tell a locked-out provider on the phone that a reset was on its
   * way and be wrong. `forgotPassword` is the same endpoint the login screen
   * uses, and it emails the code to the address on the account — the admin never
   * sees it, which is the property that makes this safe to expose here.
   */
  const resetPassword = async (u: any) =>
    confirmAndRun({
      title: `Send a password reset to ${u.name}?`,
      body: `A reset code goes to ${u.email}. You will not see the code — only they can use it.`,
      confirmLabel: 'Send reset',
      busyLabel: 'Sending…',
      success: `Reset code emailed to ${u.email}`,
      run: async () => { await authApi.forgotPassword(u.email) },
    })

  /** Block or unblock for real, via the `isActive` flag. */
  const toggleBlocked = async (u: any) => {
    const blocking = u.status !== 'Blocked'
    return confirmAndRun({
      title: blocking ? `Block ${u.name}?` : `Unblock ${u.name}?`,
      body: blocking
        ? 'They will not be able to sign in until you unblock them.'
        : 'They will be able to sign in again.',
      confirmLabel: blocking ? 'Block' : 'Unblock',
      busyLabel: blocking ? 'Blocking…' : 'Unblocking…',
      danger: blocking,
      success: blocking ? `${u.name} blocked` : `${u.name} unblocked`,
      run: async () => {
        await adminPortalApi.updateUser(u.id, { isActive: !blocking })
        await reload()
      },
    })
  }

  /** Suspend via onboarding status — what the provider apps actually read. */
  const setSuspended = async (u: any, suspend: boolean) =>
    confirmAndRun({
      title: suspend ? `Suspend ${u.name}?` : `Reinstate ${u.name}?`,
      body: suspend
        ? 'The account stays but is marked suspended. Existing bookings are unaffected.'
        : 'The account returns to normal standing.',
      confirmLabel: suspend ? 'Suspend' : 'Reinstate',
      busyLabel: suspend ? 'Suspending…' : 'Reinstating…',
      danger: suspend,
      success: suspend ? `${u.name} suspended` : `${u.name} reinstated`,
      run: async () => {
        await adminPortalApi.updateUser(u.id, { onboardingStatus: suspend ? 'suspended' : 'approved' })
        setSel(null)
        await reload()
      },
    })

  /**
   * The directory's filters. Role and status were already declared; the two
   * date ranges and the ordering are new — with 500 accounts in one table there
   * was no way to ask "who joined this month" or "who spends the most".
   */
  const userCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (u) => [u.name, u.email, u.id, u.country],
    filters: [
      { key: 'role', label: translatePortalText('Role'), get: (u) => u.role },
      { key: 'status', label: translatePortalText('Status'), get: (u) => translatePortalText(u.status) },
      { key: 'joined', label: translatePortalText('Joined'), kind: 'dateRange', get: (u) => u.joinedAt },
      { key: 'lastOrder', label: translatePortalText('Last order'), kind: 'dateRange', get: (u) => u.lastOrderAt },
      {
        key: 'spend',
        label: translatePortalText('Has spent'),
        options: [
          { value: 'any', label: translatePortalText('Has ordered') },
          { value: 'none', label: translatePortalText('Never ordered') },
          { value: 'over1000', label: translatePortalText('Over 1,000') },
        ],
        get: (u) => String(u.spend),
        match: (u, v) => v === 'none' ? u.spend <= 0 : v === 'over1000' ? u.spend > 1000 : u.spend > 0,
      },
    ],
    sortOptions: [
      { key: 'joined', label: translatePortalText('Joined'), get: (u) => u.joinedAt, defaultDir: 'desc' },
      { key: 'spend', label: translatePortalText('Lifetime spend'), get: (u) => u.spend, defaultDir: 'desc' },
      { key: 'bookings', label: translatePortalText('Bookings'), get: (u) => u.bookings, defaultDir: 'desc' },
      { key: 'name', label: translatePortalText('Name'), get: (u) => u.name, defaultDir: 'asc' },
    ],
    defaultSort: 'joined',
  }), [])
  const tf = useTableFilters(users, userCfg)
  const list = tf.pagedRows
  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText('User Management')}
        sub={translatePortalText('Master account directory — every role across the platform: customers, owners, providers, vendors & staff')}
        icon={<Users className="text-emerald-500" />}
        actions={
          <button
            className="btn-ghost"
            onClick={() => {
              if (tf.filtered.length === 0) { toast(translatePortalText('Nothing to export'), 'warn'); return }
              downloadCsv(`users-${new Date().toISOString().slice(0, 10)}.csv`, [
                ['Name', 'Email', 'Role', 'Status', 'Country', 'Joined', 'Bookings', 'Lifetime spend', 'Last order'],
                ...tf.filtered.map(u => [
                  u.name, u.email, u.role, u.status, u.country, u.joined,
                  u.bookings, u.spend, u.lastOrderAt ? new Date(u.lastOrderAt).toISOString().slice(0, 10) : '',
                ]),
              ])
              toast(translatePortalText(`Exported ${tf.filtered.length} user${tf.filtered.length === 1 ? '' : 's'}`))
            }}
          >
            <Download size={15} /> {translatePortalText('Export')}
          </button>
        } />

      <WorkerApprovalQueue />

      {/* role population strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {roleCounts.slice(0, 5).map((r, i) => (
          <motion.div key={r.role} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card p-3.5 flex items-center gap-3">
            <span className="text-xl">{r.icon}</span>
            <div><p className="font-display text-lg font-extrabold text-deep-900"><Counter value={r.count} /></p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText(r.role)}</p></div>
          </motion.div>
        ))}
      </div>

      <TableToolbar
        state={tf}
        config={userCfg}
        rows={users}
        noun={translatePortalText('users')}
        searchPlaceholder={translatePortalText('Search name, email, ID…')}
      />

      {users.length > 0 && list.length === 0 && <NoFilterMatches noun={translatePortalText('users')} onClear={tf.clear} />}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <div className="min-w-[960px]">
            <div className="grid grid-cols-[1.6fr_1fr_0.9fr_0.9fr_0.9fr_auto] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>{translatePortalText('User')}</span><span>{translatePortalText('Role')}</span><span>{translatePortalText('Status')}</span><span>{translatePortalText('Last order')}</span><span>{translatePortalText('Spend')}</span><span className="text-right">{translatePortalText('Actions')}</span>
            </div>
            {list.map((u, i) => (
              <motion.div key={u.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                className="grid grid-cols-[1.6fr_1fr_0.9fr_0.9fr_0.9fr_auto] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                <div className="flex items-center gap-3 min-w-0">
                  <img src={u.avatar} className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white shadow-soft" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[13px] font-extrabold text-deep-900">{u.name}{u.verified && <BadgeCheck size={13} className="shrink-0 text-emerald-500" />}</p>
                    <p className="truncate text-[11px] text-slate-400">{u.email} · {u.country}</p>
                  </div>
                </div>
                <div className="text-xs font-semibold text-slate-600 truncate">{translatePortalText(u.role)}</div>
                <div className="whitespace-nowrap"><ABadge dot={u.status === 'Active'}>{translatePortalText(u.status)}</ABadge></div>
                <div className="text-xs text-slate-500 whitespace-nowrap">{u.lastOrderAt ? formatPortalDate(u.lastOrderAt) : '—'}</div>
                <div className="text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{u.spend > 0 ? money(u.spend) : '—'}</div>
                <div className="flex justify-end gap-1.5 whitespace-nowrap">
                  <button onClick={() => setSel(u)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200" title={translatePortalText('View')}><Eye size={13} /></button>
                  <button onClick={() => void resetPassword(u)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200" title={translatePortalText('Send password reset')}><KeyRound size={13} /></button>
                  <button onClick={() => void toggleBlocked(u)} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100" title={u.status === 'Blocked' ? translatePortalText('Unblock') : translatePortalText('Block')}><Ban size={13} /></button>
                </div>
              </motion.div>
            ))}
          </div>
          <TablePagination state={tf} noun={translatePortalText('users')} />
        </div>
      </div>

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `👤 ${sel.name}` : ''} wide>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <img src={sel.avatar} className="h-16 w-16 rounded-2xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-display text-lg font-extrabold text-deep-900">{sel.name}{sel.verified && <BadgeCheck size={16} className="text-emerald-500" />}</p>
                <p className="text-xs text-slate-400">{sel.email} · {sel.id} · {translatePortalText('joined')} {sel.joined}</p>
                <div className="mt-1.5 flex gap-1.5">{sel.tags.map((t: string) => <span key={t} className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 !text-[10px]">{translatePortalText(t)}</span>)}</div>
              </div>
              <ABadge dot>{translatePortalText(sel.status)}</ABadge>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [translatePortalText('Bookings'), sel.bookings ? formatPortalNumber(sel.bookings) : '—'],
                [translatePortalText('Lifetime spend'), sel.spend ? money(sel.spend) : '—'],
                [translatePortalText('Joined'), sel.joined],
                [translatePortalText('Last order'), sel.lastOrderAt ? formatPortalDate(sel.lastOrderAt) : '—']
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-sand p-3 text-center"><p className="text-[10px] font-bold uppercase text-slate-400">{l}</p><p className="font-display text-base font-extrabold text-deep-900">{v}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              {sel.status === 'Suspended' ? (
                <button className="btn-admin" onClick={() => void setSuspended(sel, false)}>{translatePortalText('Reinstate')}</button>
              ) : (
                <button className="btn-ghost !text-amber-600" onClick={() => void setSuspended(sel, true)}>{translatePortalText('Suspend')}</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </PageWrap>
  )
}

// ══════════ PROVIDERS & VENDORS (§3, §4) ══════════
export function AdminProviders() { return <ProvidersPage /> }
function ProvidersPage() {
  const [tab, setTab] = useState<'Providers' | 'Vendors'>('Providers')
  const [providers, setProviders] = useState<any[]>([])
  const [vendors, setVendors] = useState<UiVendor[]>([])
  const [addVendor, setAddVendor] = useState(false)
  const [vName, setVName] = useState('')
  const [vCategory, setVCategory] = useState('spare_parts')
  const [vCommission, setVCommission] = useState('15')
  const [vBranches, setVBranches] = useState('1')
  const nav = useNavigate()

  const loadVendors = () => {
    adminPortalApi.vendors({ limit: 200 })
      .then(res => setVendors(res.data.items.map(mapVendor)))
      .catch(() => toast(translatePortalText('Failed to load vendors'), 'warn'))
  }

  /**
   * Named so a decision can refresh the list it just changed.
   *
   * `revenue`, `bookings`, `rating`, `staff`, `plan` and `manager` are no longer
   * invented here. They were the literals `0`, `0`, `0`, `1`, `'Free'` and
   * `'Admin'`, so every provider card claimed no revenue, no bookings, one
   * staff member and a Free plan regardless of the truth — and a provider on a
   * paid package, with money owed to them, looked identical to a dormant one.
   * The real figures live on the vertical consoles and on Packages &
   * Settlements, which read them from the ledger.
   */
  const reloadProviders = () =>
    adminPortalApi.users({ limit: 500 })
      .then(res => {
        const provUsers = res.data.items.filter(u => u.role.endsWith('_provider'))
        setProviders(provUsers.map((u): any => ({
          id: u.id || u._id,
          name: u.business?.businessName || u.name,
          kind: u.role === 'marina_provider' ? 'Marina' : u.role === 'boat_provider' ? 'Boat' : u.role === 'fuel_provider' ? 'Fuel' : 'Maintenance',
          icon: u.role === 'marina_provider' ? '⚓' : u.role === 'boat_provider' ? '⛵' : u.role === 'fuel_provider' ? '⛽' : '🔧',
          owner: u.name,
          email: u.email,
          avatar: u.avatar || avatar(1),
          status: !u.isActive ? 'Blocked' : u.onboarding?.status === 'suspended' ? 'Suspended' : u.onboarding?.status === 'pending' ? 'Pending' : u.onboarding?.status === 'approved' ? 'Live' : 'Pending',
          verified: u.onboarding?.status === 'approved',
          joinedAt: u.createdAt || '',
          joined: u.createdAt ? formatPortalDate(new Date(u.createdAt)) : '—',
          image: listingPhoto(
            u.business?.businessName || u.name,
            u.role === 'marina_provider' ? 'marina' : u.role === 'boat_provider' ? 'boat' : u.role === 'maintenance_provider' ? 'workshop' : 'fuel'
          )
        })))
      })
      .catch(() => toast(translatePortalText('Failed to load providers'), 'warn'))

  useEffect(() => {
    void reloadProviders()
    loadVendors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Approve, decline, suspend or reinstate a provider — for real.
   *
   * Every one of these four buttons used to be a bare toast: "X approved — now
   * live", "X rejected", "X suspended", "X re-activated". No request was made
   * in any case, so an admin could work through the pending queue, be told each
   * business was live, and leave every one of them still waiting. The vendor
   * buttons a few lines below have always called the API, which is what made
   * the difference invisible — the two halves of this page looked identical and
   * only one of them worked.
   */
  const decideProvider = async (
    prov: { id: string; name: string },
    action: 'approve' | 'reject' | 'suspend' | 'reinstate'
  ) => {
    const copy = {
      approve: { title: `Approve ${prov.name}?`, body: 'They can start trading immediately.', label: 'Approve', done: `${prov.name} approved — now live`, danger: false },
      reject: { title: `Decline ${prov.name}?`, body: 'They will not be able to trade. You can approve them later.', label: 'Decline', done: `${prov.name} — application declined`, danger: true },
      suspend: { title: `Suspend ${prov.name}?`, body: 'New business stops. Bookings customers already paid for are unaffected.', label: 'Suspend', done: `${prov.name} suspended`, danger: true },
      reinstate: { title: `Reinstate ${prov.name}?`, body: 'They can trade again.', label: 'Reinstate', done: `${prov.name} reinstated`, danger: false },
    }[action]
    const onboardingStatus =
      action === 'approve' || action === 'reinstate' ? 'approved' : action === 'suspend' ? 'suspended' : 'rejected'

    return confirmAndRun({
      title: copy.title,
      body: copy.body,
      confirmLabel: copy.label,
      busyLabel: 'Saving…',
      danger: copy.danger,
      success: copy.done,
      run: async () => {
        await adminPortalApi.updateUser(prov.id, { onboardingStatus })
        await reloadProviders()
      },
    })
  }

  const setVendorStatus = (v: UiVendor, status: 'approved' | 'suspended') => {
    adminPortalApi.updateVendor(v.id, { status })
      .then(() => { toast(translatePortalText(`${v.name} ${status === 'approved' ? 'approved' : 'rejected'}`), status === 'approved' ? 'success' : 'warn'); loadVendors() })
      .catch(() => toast(translatePortalText('Could not update vendor'), 'warn'))
  }
  const removeVendor = (v: UiVendor) => {
    adminPortalApi.removeVendor(v.id)
      .then(() => { toast(translatePortalText(`${v.name} removed`), 'warn'); setVendors(list => list.filter(x => x.id !== v.id)) })
      .catch(() => toast(translatePortalText('Could not delete vendor'), 'warn'))
  }
  const submitVendor = () => {
    if (!vName.trim()) { toast(translatePortalText('Vendor name is required'), 'warn'); return }
    adminPortalApi.createVendor({ name: vName.trim(), category: vCategory as any, commissionPct: Number(vCommission) || 0, branches: Number(vBranches) || 1 })
      .then(() => { toast(translatePortalText('Vendor added')); setAddVendor(false); setVName(''); setVCommission('15'); setVBranches('1'); loadVendors() })
      .catch(() => toast(translatePortalText('Could not add vendor'), 'warn'))
  }

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText('Providers & Vendors')}
        sub={translatePortalText('Approve, verify, suspend and monitor every business on the platform')}
        icon={<BadgeCheck className="text-emerald-500" />}
        actions={tab === 'Vendors'
          ? <button className="btn-admin" onClick={() => setAddVendor(true)}><Plus size={15} /> {translatePortalText('Add vendor')}</button>
          : (
            <button className="btn-admin" onClick={() => nav('/admin/subscriptions?tab=invites')}><Plus size={15} /> {translatePortalText('Invite provider')}</button>
          )}
      />

      <div className="mb-4 flex gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft w-fit">
        {(['Providers', 'Vendors'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`relative rounded-xl px-4 py-2 text-[13px] font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {tab === t && <motion.span layoutId="prov-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500" />}
            <span className="relative z-10">{translatePortalText(t)}</span>
          </button>
        ))}
      </div>

      {tab === 'Providers' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className={`card card-hover overflow-hidden ${p.status === 'Pending' ? 'ring-2 ring-amber-300' : ''}`}>
              <div className="relative h-28">
                <Img src={p.image} className="h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-deep-950/80 via-deep-950/20 to-transparent" />
                <div className="absolute bottom-2 start-3 flex items-center gap-2 text-white">
                  <span className="text-lg">{p.icon}</span>
                  <div><p className="font-display text-[15px] font-extrabold leading-tight">{p.name}</p><p className="text-[10px] text-white/70">{translatePortalText(p.kind)} {translatePortalText('provider')} · {translatePortalText('since')} {p.joined}</p></div>
                </div>
                <span className="absolute end-2 top-2"><ABadge dot={p.status === 'Live'}>{translatePortalText(p.status)}</ABadge></span>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2.5">
                  <img src={p.avatar} className="h-8 w-8 rounded-full object-cover" />
                  <div className="min-w-0 flex-1"><p className="flex items-center gap-1 truncate text-xs font-extrabold text-deep-900">{p.owner}{p.verified && <BadgeCheck size={12} className="text-emerald-500" />}</p><p className="truncate text-[10px] text-slate-400">{p.email || '—'}</p></div>
                  <ABadge>{translatePortalText(p.kind)}</ABadge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{p.joined}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText('Joined')}</p></div>
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{translatePortalText(p.status)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText('Standing')}</p></div>
                </div>
                <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                  {p.status === 'Pending' ? (<>
                    <button onClick={() => void decideProvider(p, 'approve')} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px]"><Check size={12} /> {translatePortalText('Approve')}</button>
                    <button onClick={() => void decideProvider(p, 'reject')} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px] !text-rose-500"><X size={12} /> {translatePortalText('Reject')}</button>
                  </>) : p.status === 'Suspended' ? (
                    <button onClick={() => void decideProvider(p, 'reinstate')} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px]">{translatePortalText('Activate')}</button>
                  ) : (
                    <button onClick={() => void decideProvider(p, 'suspend')} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px] !text-amber-600">{translatePortalText('Suspend')}</button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[1.6fr_1fr_0.9fr_1fr_0.7fr_160px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText('Vendor')}</span><span>{translatePortalText('Category')}</span><span>{translatePortalText('Status')}</span><span>{translatePortalText('Revenue · comm.')}</span><span>{translatePortalText('Docs')}</span><span className="text-right">{translatePortalText('Actions')}</span>
              </div>
              {vendors.map((v, i) => (
                <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="grid grid-cols-[1.6fr_1fr_0.9fr_1fr_0.7fr_160px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-lg">{v.icon}</span>
                    <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{v.name}</p><p className="truncate text-[11px] text-slate-400">{formatPortalNumber(v.branches)} {translatePortalText('Branches')} · <Stars n={v.rating} size={10} /></p></div>
                  </div>
                  <div className="text-xs font-semibold text-slate-600 truncate">{translatePortalText(v.category)}</div>
                  <div className="whitespace-nowrap"><ABadge dot={v.status === 'Approved'}>{translatePortalText(v.status)}</ABadge></div>
                  <div className="text-xs whitespace-nowrap"><b className="text-deep-900">{v.revenue ? money(v.revenue) : '—'}</b> <span className="text-slate-400">· {formatPortalPercent(v.commission)}</span></div>
                  <div className="whitespace-nowrap"><ABadge>{translatePortalText(v.docs)}</ABadge></div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    {v.status === 'Pending' ? (<>
                      <button onClick={() => setVendorStatus(v, 'approved')} className="btn-admin !py-1.5 !px-2.5 !text-[11px]">{translatePortalText('Approve')}</button>
                      <button onClick={() => setVendorStatus(v, 'suspended')} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-rose-500">{translatePortalText('Reject')}</button>
                    </>) : (<>
                      {v.status === 'Suspended'
                        ? <button onClick={() => setVendorStatus(v, 'approved')} className="btn-admin !py-1.5 !px-2.5 !text-[11px]">{translatePortalText('Reinstate')}</button>
                        : <button onClick={() => setVendorStatus(v, 'suspended')} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-amber-600">{translatePortalText('Suspend')}</button>}
                      <button onClick={() => removeVendor(v)} className="grid h-7 w-7 place-items-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100" title={translatePortalText('Delete')}><Trash2 size={12} /></button>
                    </>)}
                  </div>
                </motion.div>
              ))}
              {vendors.length === 0 && <div className="px-4 py-14 text-center text-sm text-slate-400">{translatePortalText('No vendors yet — add one to get started.')}</div>}
            </div>
          </div>
        </div>
      )}

      <Modal open={addVendor} onClose={() => setAddVendor(false)} title={`🧰 ${translatePortalText('Add vendor')}`}>
        <div className="space-y-4">
          <div><label className="label">{translatePortalText('Vendor name')}</label><input className="input" value={vName} onChange={e => setVName(e.target.value)} placeholder={translatePortalText("e.g. Marine Parts Co.")} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">{translatePortalText('Category')}</label>
              <select className="input" value={vCategory} onChange={e => setVCategory(e.target.value)}>
                {Object.entries(vendorCategoryLabels).map(([k, l]) => <option key={k} value={k}>{translatePortalText(l)}</option>)}
              </select>
            </div>
            <div><label className="label">{translatePortalText('Commission %')}</label><input type="number" className="input" value={vCommission} onChange={e => setVCommission(e.target.value)} /></div>
          </div>
          <div><label className="label">{translatePortalText('Branches')}</label><input type="number" min={1} className="input" value={vBranches} onChange={e => setVBranches(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddVendor(false)} className="btn-ghost">{translatePortalText('Cancel')}</button>
            <button onClick={submitVendor} className="btn-admin">{translatePortalText('Add vendor')}</button>
          </div>
        </div>
      </Modal>
    </PageWrap>
  )
}

// ══════════ KYC & VERIFICATION (§16) — shared building blocks ══════════
// Reused by the global Users panel AND each provider vertical's own KYC page.
export function KycStatCards({ items }: { items: KycItem[] }) {
  const stats: [string, number, string][] = [
    ['Pending review', items.filter(k => k.status === 'Pending').length, '🗂️'],
    ['Approved', items.filter(k => k.status === 'Approved').length, '✅'],
    ['Rejected', items.filter(k => k.status === 'Rejected').length, '❌'],
    ['Expiring', items.filter(k => k.status === 'Expiring').length, '⏳'],
  ]
  return (
    <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map(([l, v, icon], i) => (
        <motion.div key={l} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div><p className="font-display text-2xl font-extrabold text-deep-900"><Counter value={v} /></p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(l)}</p></div>
        </motion.div>
      ))}
    </div>
  )
}

export function KycBoard({ items, emptyLabel, onView, onApprove, onReject, onRemind }: {
  items: KycItem[]; emptyLabel: string
  onView?: (id: string) => void; onApprove?: (id: string) => void; onReject?: (id: string) => void
  onRemind?: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      {items.map((k, i) => (
        <motion.div key={k.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
          className={`card flex flex-wrap items-center gap-4 p-4 ${k.status === 'Rejected' ? 'ring-1 ring-rose-200' : ''}`}>
          <img src={k.avatar} className="h-11 w-11 shrink-0 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-extrabold text-deep-900">{k.who}</p>
            <p className="text-xs text-slate-400">{translatePortalText(k.kind)} · {translatePortalText(k.doc)} · {translatePortalText('submitted')} {k.submitted}</p>
            {k.note && <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 w-fit">⚠️ {k.note}</p>}
          </div>
          <ABadge dot={k.status === 'Pending'}>{translatePortalText(k.status)}</ABadge>
          <div className="flex gap-1.5">
            {onView && <button onClick={() => onView(k.id)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Eye size={12} /> {translatePortalText('View doc')}</button>}
            {k.status === 'Pending' && (<>
              {onApprove && <button onClick={() => onApprove(k.id)} className="btn-admin !py-1.5 !px-2.5 !text-[11px]"><Check size={12} /> {translatePortalText('Approve')}</button>}
              {onReject && <button onClick={() => onReject(k.id)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-rose-500"><X size={12} /> {translatePortalText('Reject')}</button>}
            </>)}
            {k.status === 'Expiring' && onRemind && <button onClick={() => onRemind(k.id)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-amber-600">{translatePortalText('Remind')}</button>}
          </div>
        </motion.div>
      ))}
      {items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">{emptyLabel}</div>}
    </div>
  )
}

// ══════════ KYC & VERIFICATION — Users panel master queue (§16) ══════════
export function AdminKyc() { return <KycPage /> }
function KycPage() {
  const [docs, setDocs] = useState<ApiKycDocument[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    documentsApi.all({ limit: 200 })
      .then(res => setDocs(res.data.items))
      .catch(() => toast(translatePortalText('Could not load KYC documents'), 'warn'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const items = docs.map(toKycItem)
  const viewDoc = (id: string) => {
    const doc = docs.find(d => d._id === id)
    if (doc) window.open(doc.fileUrl, '_blank')
  }
  const approve = (id: string) => {
    documentsApi.verify(id, { status: 'approved' }).then(() => { toast(translatePortalText('Document approved')); load() }).catch(() => toast(translatePortalText('Could not approve document'), 'warn'))
  }
  const reject = (id: string) =>
    confirmAndRun({
      title: translatePortalText('Reject this document?'),
      body: translatePortalText('The holder is told why and can upload a replacement.') || 'The holder is told why and can upload a replacement.',
      input: { label: translatePortalText('Reason for rejection'), placeholder: translatePortalText('Shown to the document holder') || 'Shown to the document holder', required: true, multiline: true, maxLength: 400 },
      confirmLabel: translatePortalText('Reject'),
      busyLabel: translatePortalText('Rejecting...') || 'Rejecting...',
      danger: true,
      run: async (reason) => {
        await documentsApi.verify(id, { status: 'rejected', rejectionReason: reason })
        load()
      },
      success: translatePortalText('Document rejected'),
      error: 'Could not reject the document. Please try again.',
    })

  const expiring = useMemo(() => items.filter(k => k.status === 'Expiring'), [items])

  const remind = (id: string) =>
    void confirmAndRun({
      title: translatePortalText('Ask for a fresh copy?'),
      body: translatePortalText('They are notified and the document slot reopens for a new upload.'),
      confirmLabel: translatePortalText('Send request'),
      busyLabel: translatePortalText('Sending…'),
      input: {
        label: translatePortalText('Message to the holder'),
        initial: translatePortalText('This document is about to expire — please upload a current copy.'),
        required: true,
        multiline: true,
        maxLength: 400,
      },
      success: translatePortalText('Re-upload requested'),
      run: async (message) => {
        await documentsApi.requestReupload(id, message.trim())
        load()
      },
    })

  const remindAllExpiring = () =>
    confirmAndRun({
      title: `${translatePortalText('Ask for a fresh copy?')} (${formatPortalNumber(expiring.length)})`,
      body: `${translatePortalText('One re-upload request per expiring document.') || 'One re-upload request per expiring document.'} ${formatPortalNumber(expiring.length)} ${translatePortalText('will be sent.') || 'will be sent.'}`,
      confirmLabel: translatePortalText('Send all'),
      busyLabel: translatePortalText('Sending…'),
      input: {
        label: translatePortalText('Message'),
        initial: translatePortalText('This document is about to expire — please upload a current copy.'),
        required: true,
        multiline: true,
        maxLength: 400,
      },
      run: async (message) => {
        const text = message.trim()
        let sent = 0
        for (const k of expiring) {
          await documentsApi.requestReupload(k.id, text)
          sent++
        }
        load()
        return sent
      },
      success: (sent) => `${translatePortalText('Re-upload requested')} (${sent})`,
    })

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText('KYC & Verification')}
        sub={translatePortalText('Cross-platform master queue — identity, business, license, insurance & tax documents')}
        icon={<ShieldAlert className="text-emerald-500" />}
        actions={
          <button
            className="btn-ghost"
            disabled={expiring.length === 0}
            onClick={() => void remindAllExpiring()}
          >
            {translatePortalText('Send expiry alerts')}{expiring.length > 0 ? ` (${formatPortalNumber(expiring.length)})` : ''}
          </button>
        }
      />

      {loading ? (
        <div className="card py-14 text-center text-sm text-slate-400">{translatePortalText('Loading documents…')}</div>
      ) : (<>
        <KycStatCards items={items} />
        <KycBoard items={items} emptyLabel={translatePortalText('No documents in the queue.')} onView={viewDoc} onApprove={approve} onReject={reject} onRemind={remind} />
      </>)}

      {/* verification workflow */}
      <Section title={translatePortalText('Verification workflow')} sub={translatePortalText('Registration → KYC → approval → live')} className="mt-5">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {['Registration', 'KYC & Business Verification', 'Admin Approval', 'Provider Goes Live', 'Bookings & Services', 'Payments & Commission', 'Monitoring'].map((s, i, arr) => (
            <React.Fragment key={s}>
              <div className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${i < 3 ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {i < 3 && <Check size={12} />}{translatePortalText(s)}
              </div>
              {i < arr.length - 1 && <span className={`h-0.5 w-4 shrink-0 ${i < 2 ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
            </React.Fragment>
          ))}
        </div>
      </Section>
    </PageWrap>
  )
}
