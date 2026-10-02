import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { formatPortalNumber, isPortalArabic, localizedEnum, portalLocale, translatePortalText } from '../../i18n/runtime'
import { confirmAndRun } from '../../async'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users,
  UserPlus,
  Ship,
  Mail,
  Phone,
  Shield,
  Clock,
  Award,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  Edit2,
  Eye,
  QrCode,
  ListFilter,
  Anchor,
  Sparkles,
} from 'lucide-react'
import {
  boatCrewApi,
  boatApi,
  fileUrl,
  type ApiBoatCrew,
  type CreateBoatCrewPayload,
  type UpdateBoatCrewPayload,
  type BoatCrewPermission,
  type BoatCrewStatus,
  type ApiBoat,
} from '../../api'
import { PageHeader, Modal, toast, SearchInput, ViewToggle, ListRowSkeleton } from '../../ui'
import { fmtDate, humanize } from '../../live'

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { key: 'sunday', label: 'Sun', short: 'S' },
  { key: 'monday', label: 'Mon', short: 'M' },
  { key: 'tuesday', label: 'Tue', short: 'T' },
  { key: 'wednesday', label: 'Wed', short: 'W' },
  { key: 'thursday', label: 'Thu', short: 'T' },
  { key: 'friday', label: 'Fri', short: 'F' },
  { key: 'saturday', label: 'Sat', short: 'S' },
]

const ROLE_SUGGESTIONS = [
  'Captain',
  'First Mate',
  'Chief Deckhand',
  'Deckhand',
  'Marine Engineer',
  'Safety Officer',
  'Hospitality Lead',
]

const CERTIFICATION_PRESETS = [
  'STCW-95',
  'Master 200GT',
  'Marine First Aid',
  'VHF Marine Radio',
  'Firefighting (Basic)',
  'Seaman Book',
]

const PERMISSION_CONFIG: Record<
  BoatCrewPermission,
  { label: string; desc: string; icon: typeof QrCode; color: string }
> = {
  scan: {
    label: 'Boarding Scanner',
    desc: 'Scan guest boarding QR passes at the gangway',
    icon: QrCode,
    color: 'text-ocean-600 bg-ocean-50 border-ocean-200',
  },
  manifest: {
    label: 'Passenger Manifest',
    desc: 'View attendee lists and mark passenger no-shows',
    icon: ListFilter,
    color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
  },
  trip_lifecycle: {
    label: 'Voyage Lifecycle',
    desc: 'Mark departures sailed, active, and completed',
    icon: Anchor,
    color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  },
}

function calculateShiftDuration(start?: string, end?: string): { text: string; isOvernight: boolean } | null {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return null

  let startMinutes = sh * 60 + sm
  let endMinutes = eh * 60 + em
  let isOvernight = false

  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60
    isOvernight = true
  } else if (endMinutes === startMinutes) {
    return { text: '0 hrs', isOvernight: false }
  }

  const diff = endMinutes - startMinutes
  const hrs = Math.floor(diff / 60)
  const mins = diff % 60

  const durationText = isPortalArabic()
    ? [
        ...(hrs > 0 ? [`${formatPortalNumber(hrs)} ${hrs === 1 ? 'ساعة' : hrs === 2 ? 'ساعتان' : 'ساعات'}`] : []),
        ...(mins > 0 ? [`${formatPortalNumber(mins)} دقيقة`] : []),
      ].join(' و') || '٠ ساعة'
    : `${hrs} hr${hrs !== 1 ? 's' : ''}${mins > 0 ? ` ${mins} min` : ''}`

  return {
    text: durationText,
    isOvernight,
  }
}

function formatTime12h(time?: string): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return time
  const date = new Date(2000, 0, 1, h, m)
  return new Intl.DateTimeFormat(portalLocale(), { hour: 'numeric', minute: '2-digit' }).format(date)
}

function shortDayLabel(key: string, fallback: string): string {
  if (!isPortalArabic()) return fallback
  const initials: Record<string, string> = {
    sunday: 'أ', monday: 'ا', tuesday: 'ث', wednesday: 'أ', thursday: 'خ', friday: 'ج', saturday: 'س',
  }
  return initials[key] ?? fallback
}

const avatarFor = (name?: string, avatar?: string) =>
  fileUrl(avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(name ?? 'Crew')}&background=0284c7&color=ffffff&bold=true`

// ── Main Page Component ──────────────────────────────────────────────────────

export default function BoatCrew() {
  const [crewList, setCrewList] = useState<ApiBoatCrew[]>([])
  const [boats, setBoats] = useState<ApiBoat[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | BoatCrewStatus>('all')
  const [boatFilter, setBoatFilter] = useState<string>('all')
  const [view, setView] = useState<'card' | 'table'>('card')

  // Modals & Drawers
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [editModalCrew, setEditModalCrew] = useState<ApiBoatCrew | null>(null)
  const [detailsCrew, setDetailsCrew] = useState<ApiBoatCrew | null>(null)
  const [inviteLinkToken, setInviteLinkToken] = useState<{ token: string; name: string } | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [crewRes, boatsRes] = await Promise.all([
        boatCrewApi.list(),
        boatApi.mine(),
      ])
      setCrewList(crewRes.data.crew || [])
      setBoats(boatsRes.data.items || [])
    } catch (err: any) {
      toast(err.message || 'Failed to load crew members', 'warn')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Filtered Crew
  const filteredCrew = useMemo(() => {
    return crewList.filter((c) => {
      const matchQuery =
        !search.trim() ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.email.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone && c.phone.includes(search)) ||
        (c.roleTitle && c.roleTitle.toLowerCase().includes(search.toLowerCase())) ||
        (c.licenseNo && c.licenseNo.toLowerCase().includes(search.toLowerCase()))

      const matchStatus = statusFilter === 'all' || c.status === statusFilter

      const matchBoat =
        boatFilter === 'all' ||
        c.boats.some((b) => (typeof b === 'object' ? (b._id || b.id) === boatFilter : b === boatFilter))

      return matchQuery && matchStatus && matchBoat
    })
  }, [crewList, search, statusFilter, boatFilter])

  // Actions
  const handleToggleStatus = async (crew: ApiBoatCrew) => {
    if (crew.status === 'invited') {
      toast('This invite is still pending. You can resend or withdraw it.', 'info')
      return
    }
    const nextStatus: BoatCrewStatus = crew.status === 'active' ? 'disabled' : 'active'
    try {
      await boatCrewApi.setStatus(crew._id, nextStatus)
      toast(`Crew member ${crew.name} ${nextStatus === 'active' ? 'activated' : 'disabled'}`)
      void loadData()
    } catch (err: any) {
      toast(err.message || 'Failed to update crew status', 'warn')
    }
  }

  const handleResendInvite = async (crew: ApiBoatCrew) => {
    try {
      const res = await boatCrewApi.resendInvite(crew._id)
      if (res.data.devInviteToken) {
        setInviteLinkToken({ token: res.data.devInviteToken, name: crew.name })
      }
      toast(`Invite resent to ${crew.email}`)
      void loadData()
    } catch (err: any) {
      toast(err.message || 'Failed to resend invite', 'warn')
    }
  }

  /**
   * Withdrawing a crew invite, confirmed in a real dialog.
   *
   * `window.confirm` blocks the JS thread, so nothing repainted between the
   * click and the request finishing — no spinner, and the toast could not
   * appear until the browser handed control back. It is also unstyleable, and
   * on mobile Safari reads as a browser-level security warning rather than part
   * of the app. `confirmAndRun` keeps the dialog open across the request and
   * reports the outcome itself.
   */
  const handleRemoveCrew = (crew: ApiBoatCrew) =>
    confirmAndRun({
      title: `Withdraw invite for ${crew.name}?`,
      body: 'They will not be able to join with this invite. You can invite them again later.',
      confirmLabel: 'Withdraw',
      busyLabel: 'Withdrawing…',
      danger: true,
      success: `Invite for ${crew.name} withdrawn`,
      error: 'Could not withdraw the invite. Please try again.',
      run: async () => {
        await boatCrewApi.remove(crew._id)
        void loadData()
      },
    })

  const copyInviteUrl = (token: string) => {
    const url = `${window.location.origin}${window.location.pathname}#/worker-invite/crew/${token}`
    navigator.clipboard.writeText(url)
    setCopiedLink(true)
    toast('Invite link copied to clipboard!')
    setTimeout(() => setCopiedLink(false), 3000)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={translatePortalText("Vessel Crew & Staff")}
        icon={<Users className="text-ocean-500" />}
        sub={`${crewList.length} crew on record · manage personnel, duty shifts, certifications, and onboard permissions`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle view={view} onChange={setView} />
            <button
              id="invite-crew-btn"
              onClick={() => setInviteModalOpen(true)}
              className="btn-primary flex items-center gap-2 shadow-glow"
            >
              <UserPlus size={16} />
              <span>{translatePortalText("Add Crew Member")}</span>
            </button>
          </div>
        }
      />

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card !p-4 border-s-4 border-s-ocean-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Total Roster")}</p>
          <p className="mt-1 font-display text-2xl font-black text-deep-900">{formatPortalNumber(crewList.length)}</p>
        </div>
        <div className="card !p-4 border-s-4 border-s-emerald-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Active Crew")}</p>
          <p className="mt-1 font-display text-2xl font-black text-emerald-600">
            {formatPortalNumber(crewList.filter((c) => c.status === 'active').length)}
          </p>
        </div>
        <div className="card !p-4 border-s-4 border-s-amber-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Pending Invites")}</p>
          <p className="mt-1 font-display text-2xl font-black text-amber-600">
            {formatPortalNumber(crewList.filter((c) => c.status === 'invited').length)}
          </p>
        </div>
        <div className="card !p-4 border-s-4 border-s-indigo-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Assigned Hulls")}</p>
          <p className="mt-1 font-display text-2xl font-black text-indigo-600">
            {formatPortalNumber(new Set(crewList.flatMap((c) => c.boats.map((b) => (typeof b === 'object' ? (b._id || b.id) : b)))).size)}
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 max-w-md">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={translatePortalText("Search by name, email, rank, licence...")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter tabs */}
          <div className="flex rounded-xl bg-sand p-1 text-xs font-semibold">
            {(['all', 'active', 'invited', 'disabled'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 transition capitalize ${
                  statusFilter === s
                    ? 'bg-white font-bold text-ocean-700 shadow-sm'
                    : 'text-slate-500 hover:text-deep-900'
                }`}
              >
                {translatePortalText(s)}
              </button>
            ))}
          </div>

          {/* Boat filter dropdown */}
          {boats.length > 0 && (
            <select
              value={boatFilter}
              onChange={(e) => setBoatFilter(e.target.value)}
              className="select text-xs !py-1.5"
            >
              <option value="all">{translatePortalText("All Vessels (")}{formatPortalNumber(boats.length)})</option>
              {boats.map((b) => (
                <option key={b.id || b._id} value={b.id || b._id}>
                  ⛵ {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Development Token Drawer */}
      <AnimatePresence>
        {inviteLinkToken && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-2xl border border-ocean-200 bg-gradient-to-r from-ocean-50 to-sky-50 p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-ocean-600" />
                  <span className="font-display font-bold text-ocean-900">
                    {translatePortalText("Invite Ready for")} {inviteLinkToken.name}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ocean-700">
                  {translatePortalText("Share this invitation link directly with the crew member to let them set their password.")}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyInviteUrl(inviteLinkToken.token)}
                  className="btn-primary !py-1.5 !px-3.5 flex items-center gap-1.5 text-xs"
                >
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedLink ? 'Copied Link' : 'Copy Invite Link'}</span>
                </button>
                <button
                  onClick={() => setInviteLinkToken(null)}
                  className="btn-ghost !p-1.5 text-slate-400 hover:text-slate-600"
                >
                  <XCircle size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Skeleton & Content */}
      {loading ? (
        <div className="space-y-3">
          <ListRowSkeleton count={5} />
        </div>
      ) : filteredCrew.length === 0 ? (
        <div className="card py-16 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-ocean-50 text-ocean-500">
            <Users size={28} />
          </div>
          <h3 className="font-display text-lg font-bold text-deep-900">
            {search || statusFilter !== 'all' || boatFilter !== 'all'
              ? translatePortalText('No crew members match your filter')
              : translatePortalText('No crew members added yet')}
          </h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
            {search || statusFilter !== 'all' || boatFilter !== 'all'
              ? translatePortalText('Try adjusting your search criteria or clear active filters to view all records.')
              : translatePortalText('Add your captains, deckhands, and marine staff to grant them passenger boarding scan access and assign them to your fleet.')}
          </p>
          <div className="mt-5">
            <button onClick={() => setInviteModalOpen(true)} className="btn-primary text-xs">
              <UserPlus size={14} />
              <span>{translatePortalText("Add First Crew Member")}</span>
            </button>
          </div>
        </div>
      ) : view === 'card' ? (
        /* Card Grid View */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredCrew.map((c, i) => {
            const shiftInfo = calculateShiftDuration(c.shiftStartTime, c.shiftEndTime)
            return (
              <motion.div
                key={c._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
                className="card card-hover flex flex-col justify-between overflow-hidden p-5"
              >
                <div>
                  {/* Top Bar: Avatar + Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={avatarFor(c.name, c.avatar)}
                        alt={c.name}
                        className="h-12 w-12 rounded-2xl object-cover ring-2 ring-ocean-100"
                      />
                      <div>
                        <h4 className="font-display text-base font-extrabold text-deep-900 leading-tight">
                          {c.name}
                        </h4>
                        <p className="text-xs font-semibold text-ocean-600">
                          {c.roleTitle || localizedEnum(humanize(c.position))}
                        </p>
                      </div>
                    </div>
                    <div>
                      {c.status === 'active' && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                          {translatePortalText("Active")}</span>
                      )}
                      {c.status === 'invited' && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                          {translatePortalText("Invite Sent")}</span>
                      )}
                      {c.status === 'disabled' && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                          {translatePortalText("Disabled")}</span>
                      )}
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="mt-4 space-y-1.5 text-xs text-slate-500">
                    <p className="flex items-center gap-2 truncate">
                      <Mail size={13} className="text-slate-400 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </p>
                    {c.phone && (
                      <p className="flex items-center gap-2">
                        <Phone size={13} className="text-slate-400 shrink-0" />
                        <span>{c.phone}</span>
                      </p>
                    )}
                  </div>

                  {/* Shift Time Badge */}
                  {c.shiftStartTime && c.shiftEndTime && (
                    <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-sand/80 px-2.5 py-1.5 text-[11px] text-deep-800">
                      <Clock size={12} className="text-ocean-600 shrink-0" />
                      <span className="font-bold">
                        {formatTime12h(c.shiftStartTime)} – {formatTime12h(c.shiftEndTime)}
                      </span>
                      {shiftInfo && (
                        <span className="ms-auto text-[10px] font-semibold text-slate-400">
                          {shiftInfo.text}
                          {shiftInfo.isOvernight && ' 🌙'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Working Days */}
                  {c.workingDays && c.workingDays.length > 0 && (
                    <div className="mt-2 flex items-center gap-1">
                      {DAYS_OF_WEEK.map((d) => {
                        const active = c.workingDays?.includes(d.key)
                        return (
                          <span
                            key={d.key}
                            title={translatePortalText(d.label)}
                            className={`grid h-5 w-5 place-items-center rounded text-[9px] font-bold ${
                              active ? 'bg-ocean-500 text-white' : 'bg-sand text-slate-300'
                            }`}
                          >
                            {shortDayLabel(d.key, d.short)}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* Assigned Vessels */}
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      {translatePortalText("Assigned Vessels (")}{formatPortalNumber(c.boats.length)})
                    </p>
                    {c.boats.length === 0 ? (
                      <span className="text-xs text-slate-400 italic">{translatePortalText("No vessel assigned")}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.boats.map((b) => (
                          <span
                            key={typeof b === 'object' ? (b._id || b.id) : b}
                            className="inline-flex items-center gap-1 rounded-lg bg-sand px-2 py-0.5 text-[11px] font-semibold text-deep-900"
                          >
                            <Ship size={10} className="text-ocean-500" />
                            {typeof b === 'object' ? b.name : b}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Permissions Chips */}
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-1">
                      {c.permissions.map((p) => {
                        const cfg = PERMISSION_CONFIG[p]
                        if (!cfg) return null
                        return (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 rounded-full bg-ocean-50 px-2 py-0.5 text-[10px] font-bold text-ocean-700"
                          >
                            <cfg.icon size={10} />
                            {translatePortalText(cfg.label)}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-1 text-xs">
                  <button
                    onClick={() => setDetailsCrew(c)}
                    className="btn-ghost !py-1 !px-2 text-slate-500 hover:text-ocean-600"
                    title={translatePortalText("View Profile & Compliance")}
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    onClick={() => setEditModalCrew(c)}
                    className="btn-ghost !py-1 !px-2 text-slate-500 hover:text-ocean-600"
                    title={translatePortalText("Edit Crew & Schedule")}
                  >
                    <Edit2 size={13} />
                  </button>
                  {c.status === 'invited' ? (
                    <>
                      <button
                        onClick={() => handleResendInvite(c)}
                        className="btn-ghost !py-1 !px-2 text-amber-600 hover:bg-amber-50"
                        title={translatePortalText("Resend Invite Email")}
                      >
                        <RotateCcw size={13} />
                      </button>
                      <button
                        onClick={() => handleRemoveCrew(c)}
                        className="btn-ghost !py-1 !px-2 text-rose-500 hover:bg-rose-50"
                        title={translatePortalText("Withdraw Invite")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleToggleStatus(c)}
                      className={`btn-ghost !py-1 !px-2.5 font-bold ${
                        c.status === 'active'
                          ? 'text-slate-500 hover:text-rose-600'
                          : 'text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      {c.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      ) : (
        /* Table View */
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr className="border-b border-slate-100 bg-sand/50">
                  <th className="th">{translatePortalText("Crew Member")}</th>
                  <th className="th">{translatePortalText("Role & Schedule")}</th>
                  <th className="th">{translatePortalText("Assigned Boats")}</th>
                  <th className="th">{translatePortalText("Permissions")}</th>
                  <th className="th">{translatePortalText("Licence / Expiry")}</th>
                  <th className="th">{translatePortalText("Status")}</th>
                  <th className="th text-right">{translatePortalText("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCrew.map((c, i) => (
                  <motion.tr
                    key={c._id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    className="border-b border-slate-50 transition hover:bg-sand/60"
                  >
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <img
                          src={avatarFor(c.name, c.avatar)}
                          alt={c.name}
                          className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-ocean-100"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-bold text-deep-900">{c.name}</p>
                          <p className="truncate text-[11px] text-slate-400">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      <p className="font-semibold text-deep-900 text-xs">{c.roleTitle || translatePortalText('Crew')}</p>
                      {c.shiftStartTime && c.shiftEndTime ? (
                        <p className="text-[11px] text-ocean-700 font-medium">
                          {formatTime12h(c.shiftStartTime)} – {formatTime12h(c.shiftEndTime)}
                        </p>
                      ) : (
                        <span className="text-[11px] text-slate-400">{translatePortalText("Flexible")}</span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {c.boats.length === 0 ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          c.boats.map((b) => (
                            <span
                              key={typeof b === 'object' ? (b._id || b.id) : b}
                              className="rounded bg-sand px-1.5 py-0.5 text-[10px] font-semibold text-deep-900"
                            >
                              ⛵ {typeof b === 'object' ? b.name : b}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {c.permissions.map((p) => (
                          <span
                            key={p}
                            className="rounded-full bg-ocean-50 px-2 py-0.5 text-[10px] font-bold text-ocean-700"
                          >
                            {translatePortalText(PERMISSION_CONFIG[p]?.label ?? localizedEnum(p))}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="td text-xs">
                      {c.licenseNo ? (
                        <div>
                          <span className="font-mono font-bold text-deep-900">{c.licenseNo}</span>
                          {c.licenseExpiry && (
                            <p className="text-[10px] text-slate-400">
                              {translatePortalText("Exp:")} {fmtDate(c.licenseExpiry)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td">
                      {c.status === 'active' && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                          {translatePortalText("Active")}</span>
                      )}
                      {c.status === 'invited' && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                          {translatePortalText("Invited")}</span>
                      )}
                      {c.status === 'disabled' && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                          {translatePortalText("Disabled")}</span>
                      )}
                    </td>
                    <td className="td text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetailsCrew(c)}
                          className="btn-ghost !py-1 !px-2 text-slate-500 hover:text-ocean-600"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => setEditModalCrew(c)}
                          className="btn-ghost !py-1 !px-2 text-slate-500 hover:text-ocean-600"
                        >
                          <Edit2 size={13} />
                        </button>
                        {c.status === 'invited' && (
                          <button
                            onClick={() => handleResendInvite(c)}
                            className="btn-ghost !py-1 !px-2 text-amber-600"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Invite Crew Modal ═══ */}
      <Modal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title={translatePortalText("Add Crew Member & Send Invite")}
        wide
      >
        <CrewForm
          boats={boats}
          onSubmit={async (payload) => {
            const res = await boatCrewApi.invite(payload as CreateBoatCrewPayload)
            toast(`Crew member ${payload.name} invited successfully!`)
            if (res.data.devInviteToken) {
              setInviteLinkToken({ token: res.data.devInviteToken, name: payload.name })
            }
            setInviteModalOpen(false)
            void loadData()
          }}
          onCancel={() => setInviteModalOpen(false)}
        />
      </Modal>

      {/* ═══ Edit Crew Modal ═══ */}
      <Modal
        open={!!editModalCrew}
        onClose={() => setEditModalCrew(null)}
        title={`${translatePortalText('Edit')} ${editModalCrew?.name ?? translatePortalText('Crew')}`}
        wide
      >
        {editModalCrew && (
          <CrewForm
            initialData={editModalCrew}
            boats={boats}
            onSubmit={async (payload) => {
              await boatCrewApi.update(editModalCrew._id, payload as UpdateBoatCrewPayload)
              toast(`Crew details for ${payload.name || editModalCrew.name} updated!`)
              setEditModalCrew(null)
              void loadData()
            }}
            onCancel={() => setEditModalCrew(null)}
          />
        )}
      </Modal>

      {/* ═══ View Details & Compliance Modal ═══ */}
      <Modal
        open={!!detailsCrew}
        onClose={() => setDetailsCrew(null)}
        title={detailsCrew ? `⛵ ${detailsCrew.name} — ${translatePortalText('Profile & Compliance')}` : ''}
      >
        {detailsCrew && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-2xl bg-sand/60 p-4">
              <img
                src={avatarFor(detailsCrew.name, detailsCrew.avatar)}
                alt=""
                className="h-16 w-16 rounded-2xl object-cover ring-2 ring-ocean-200"
              />
              <div>
                <h3 className="font-display text-lg font-extrabold text-deep-900">
                  {detailsCrew.name}
                </h3>
                <p className="text-xs font-semibold text-ocean-600">
                  {detailsCrew.roleTitle || translatePortalText('Crew Member')}
                </p>
                <p className="mt-1 text-xs text-slate-400">{detailsCrew.email}</p>
                {detailsCrew.phone && <p className="text-xs text-slate-400">{detailsCrew.phone}</p>}
              </div>
            </div>

            {/* Shift Details */}
            <div className="rounded-2xl border border-slate-100 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-ocean-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {translatePortalText("Working Hours & Duty Shift")}</h4>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-sand p-2.5">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">{translatePortalText("Shift Schedule")}</p>
                  <p className="font-bold text-deep-900">
                    {detailsCrew.shiftStartTime && detailsCrew.shiftEndTime
                      ? `${formatTime12h(detailsCrew.shiftStartTime)} – ${formatTime12h(detailsCrew.shiftEndTime)}`
                      : translatePortalText('Flexible / On-Call')}
                  </p>
                </div>
                <div className="rounded-xl bg-sand p-2.5">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">{translatePortalText("Active Days")}</p>
                  <p className="font-bold text-deep-900">
                    {detailsCrew.workingDays && detailsCrew.workingDays.length > 0
                      ? detailsCrew.workingDays.map((d) => translatePortalText(localizedEnum(d))).join(', ')
                      : translatePortalText('All Week')}
                  </p>
                </div>
              </div>
            </div>

            {/* Compliance & Licence */}
            <div className="rounded-2xl border border-slate-100 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Shield size={15} className="text-ocean-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {translatePortalText("Licence & Qualifications")}</h4>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-sand p-2.5">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">{translatePortalText("Licence No.")}</p>
                  <p className="font-mono font-bold text-deep-900">
                    {detailsCrew.licenseNo || translatePortalText('Not specified')}
                  </p>
                </div>
                <div className="rounded-xl bg-sand p-2.5">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">{translatePortalText("Expiry Date")}</p>
                  <p className="font-bold text-deep-900">
                    {detailsCrew.licenseExpiry ? fmtDate(detailsCrew.licenseExpiry) : translatePortalText('None')}
                  </p>
                </div>
              </div>

              {detailsCrew.certifications && detailsCrew.certifications.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">
                    {translatePortalText("Certifications")}</p>
                  <div className="flex flex-wrap gap-1">
                    {detailsCrew.certifications.map((c) => (
                      <span
                        key={c}
                        className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700"
                      >
                        ✓ {translatePortalText(c)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Assigned Fleet */}
            <div className="rounded-2xl border border-slate-100 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Ship size={15} className="text-ocean-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {translatePortalText("Assigned Fleet")}</h4>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {detailsCrew.boats.length === 0 ? (
                  <p className="text-xs text-slate-400">{translatePortalText("No vessels assigned.")}</p>
                ) : (
                  detailsCrew.boats.map((b) => (
                    <span
                      key={typeof b === 'object' ? (b._id || b.id) : b}
                      className="rounded-xl bg-ocean-50 px-3 py-1 text-xs font-bold text-ocean-700"
                    >
                      ⛵ {typeof b === 'object' ? b.name : b}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Notes */}
            {detailsCrew.notes && (
              <div className="rounded-xl bg-sand/60 p-3 text-xs text-slate-600">
                <p className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">{translatePortalText("Notes")}</p>
                <p>{detailsCrew.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Strict Form Component with Real-Time Field Validations ───────────────────

interface CrewFormProps {
  initialData?: ApiBoatCrew
  boats: ApiBoat[]
  onSubmit: (data: CreateBoatCrewPayload | UpdateBoatCrewPayload) => Promise<void>
  onCancel: () => void
}

function CrewForm({ initialData, boats, onSubmit, onCancel }: CrewFormProps) {
  // Form values
  const [name, setName] = useState(initialData?.name ?? '')
  const [email, setEmail] = useState(initialData?.email ?? '')
  const [phone, setPhone] = useState(initialData?.phone ?? '')
  const [roleTitle, setRoleTitle] = useState(initialData?.roleTitle ?? 'Captain')
  const [shiftStartTime, setShiftStartTime] = useState(initialData?.shiftStartTime ?? '08:00')
  const [shiftEndTime, setShiftEndTime] = useState(initialData?.shiftEndTime ?? '17:00')
  const [workingDays, setWorkingDays] = useState<string[]>(
    initialData?.workingDays ?? ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']
  )
  const [licenseNo, setLicenseNo] = useState(initialData?.licenseNo ?? '')
  const [licenseExpiry, setLicenseExpiry] = useState(
    initialData?.licenseExpiry ? initialData.licenseExpiry.slice(0, 10) : ''
  )
  const [certifications, setCertifications] = useState<string[]>(initialData?.certifications ?? [])
  const [customCert, setCustomCert] = useState('')
  const [selectedBoats, setSelectedBoats] = useState<string[]>(
    initialData?.boats.map((b) => (typeof b === 'object' ? (b._id || b.id) : b)) ?? []
  )
  const [permissions, setPermissions] = useState<BoatCrewPermission[]>(
    initialData?.permissions ?? ['scan', 'manifest']
  )
  const [notes, setNotes] = useState(initialData?.notes ?? '')

  // Touched states for blur validation
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)

  // ── Real-Time Validation Rules ─────────────────────────────────────────────
  const errors = useMemo(() => {
    const errs: Record<string, string> = {}

    // Name Validation
    const trimmedName = name.trim()
    if (!trimmedName) {
      errs.name = 'Full name is required'
    } else if (trimmedName.length < 2) {
      errs.name = 'Name must be at least 2 characters'
    } else if (trimmedName.length > 100) {
      errs.name = 'Name cannot exceed 100 characters'
    }

    // Email Validation (Only editable on create)
    if (!initialData) {
      const trimmedEmail = email.trim()
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!trimmedEmail) {
        errs.email = 'Email address is required'
      } else if (!emailRegex.test(trimmedEmail)) {
        errs.email = 'Please enter a valid email address (e.g. name@domain.com)'
      }
    }

    // Phone Validation (Optional, but if given must match reasonable phone regex)
    if (phone.trim()) {
      const phoneRegex = /^(\+?[0-9\s\-().]{7,20})$/
      if (!phoneRegex.test(phone.trim())) {
        errs.phone = 'Enter a valid phone number with 7-20 digits (e.g. +966 50 123 4567)'
      }
    }

    // Time & Shift Validation
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
    if (shiftStartTime && !timeRegex.test(shiftStartTime)) {
      errs.shiftStartTime = 'Start time must be in HH:mm format (e.g. 08:00)'
    }
    if (shiftEndTime && !timeRegex.test(shiftEndTime)) {
      errs.shiftEndTime = 'End time must be in HH:mm format (e.g. 17:00)'
    }
    if (shiftStartTime && shiftEndTime && shiftStartTime === shiftEndTime) {
      errs.shiftEndTime = 'Shift start time and end time cannot be identical'
    }

    // Licence Expiry Validation
    if (licenseExpiry) {
      const expDate = new Date(licenseExpiry)
      if (isNaN(expDate.getTime())) {
        errs.licenseExpiry = 'Invalid date format'
      }
    }

    // Notes Max Length
    if (notes.length > 500) {
      errs.notes = 'Notes cannot exceed 500 characters'
    }

    return errs
  }, [name, email, phone, shiftStartTime, shiftEndTime, licenseExpiry, notes, initialData])

  const isValid = Object.keys(errors).length === 0

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  // Quick preset handlers
  const handleToggleDay = (dayKey: string) => {
    setWorkingDays((prev) =>
      prev.includes(dayKey) ? prev.filter((d) => d !== dayKey) : [...prev, dayKey]
    )
  }

  const handleSetDayPreset = (preset: 'weekdays' | 'all' | 'weekends' | 'clear') => {
    if (preset === 'weekdays') setWorkingDays(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'])
    else if (preset === 'all') setWorkingDays(DAYS_OF_WEEK.map((d) => d.key))
    else if (preset === 'weekends') setWorkingDays(['friday', 'saturday'])
    else if (preset === 'clear') setWorkingDays([])
  }

  const handleToggleBoat = (boatId: string) => {
    setSelectedBoats((prev) =>
      prev.includes(boatId) ? prev.filter((b) => b !== boatId) : [...prev, boatId]
    )
  }

  const handleTogglePermission = (perm: BoatCrewPermission) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    )
  }

  const handleToggleCertification = (cert: string) => {
    setCertifications((prev) =>
      prev.includes(cert) ? prev.filter((c) => c !== cert) : [...prev, cert]
    )
  }

  const handleAddCustomCert = () => {
    const trimmed = customCert.trim()
    if (trimmed && !certifications.includes(trimmed)) {
      setCertifications((prev) => [...prev, trimmed])
      setCustomCert('')
    }
  }

  const shiftDuration = calculateShiftDuration(shiftStartTime, shiftEndTime)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Mark all as touched
    setTouched({
      name: true,
      email: true,
      phone: true,
      shiftStartTime: true,
      shiftEndTime: true,
      licenseExpiry: true,
      notes: true,
    })

    if (!isValid) {
      toast('Please correct the errors in the form before submitting', 'warn')
      return
    }

    setSubmitting(true)
    try {
      const payload: CreateBoatCrewPayload | UpdateBoatCrewPayload = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        roleTitle: roleTitle.trim() || undefined,
        shiftStartTime: shiftStartTime || undefined,
        shiftEndTime: shiftEndTime || undefined,
        workingDays: workingDays.length > 0 ? workingDays : undefined,
        licenseNo: licenseNo.trim() || undefined,
        licenseExpiry: licenseExpiry || undefined,
        certifications,
        notes: notes.trim() || undefined,
        boats: selectedBoats,
        permissions,
        ...(!initialData ? { email: email.trim().toLowerCase() } : {}),
      }

      await onSubmit(payload)
    } catch (err: any) {
      toast(err.message || 'Failed to save crew member', 'warn')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Section 1: Basic Identity ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} className="text-ocean-600" />
          <h4 className="font-display text-sm font-extrabold text-deep-900">
            {translatePortalText("Personal & Contact Information")}</h4>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Full Name */}
          <div>
            <label className="label">
              {translatePortalText("Full Name")} <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              className={`input ${touched.name && errors.name ? '!border-rose-400 bg-rose-50/20' : ''}`}
              placeholder={translatePortalText("e.g. Captain Tariq Al-Mansoor")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => handleBlur('name')}
            />
            {touched.name && errors.name && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                <AlertTriangle size={12} /> {translatePortalText(errors.name)}
              </p>
            )}
          </div>

          {/* Email Address */}
          <div>
            <label className="label">
              {translatePortalText("Email Address")} {!initialData && <span className="text-rose-500">*</span>}
            </label>
            <input
              type="email"
              disabled={!!initialData}
              className={`input ${
                initialData ? 'bg-slate-100 cursor-not-allowed text-slate-500' : ''
              } ${touched.email && errors.email ? '!border-rose-400 bg-rose-50/20' : ''}`}
              placeholder={translatePortalText("e.g. tariq@marina.com")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => handleBlur('email')}
            />
            {touched.email && errors.email && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                <AlertTriangle size={12} /> {translatePortalText(errors.email)}
              </p>
            )}
            {initialData && (
              <p className="mt-1 text-[10px] text-slate-400">
                {translatePortalText("Email cannot be changed after invite is created.")}</p>
            )}
          </div>

          {/* Phone Number */}
          <div>
            <label className="label">{translatePortalText("Phone / WhatsApp")}</label>
            <input
              type="tel"
              className={`input ${touched.phone && errors.phone ? '!border-rose-400 bg-rose-50/20' : ''}`}
              placeholder={translatePortalText('e.g. +966 50 123 4567')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => handleBlur('phone')}
            />
            {touched.phone && errors.phone && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                <AlertTriangle size={12} /> {translatePortalText(errors.phone)}
              </p>
            )}
          </div>

          {/* Role / Rank Title */}
          <div>
            <label className="label">{translatePortalText("Role Title / Position")}</label>
            <input
              type="text"
              className="input"
              placeholder={translatePortalText("e.g. Master Captain")}
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
            />
            {/* Quick Suggestions */}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {ROLE_SUGGESTIONS.slice(0, 5).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleTitle(r)}
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${
                    roleTitle === r
                      ? 'bg-ocean-500 text-white'
                      : 'bg-sand text-slate-500 hover:bg-ocean-50 hover:text-ocean-700'
                  }`}
                >
                  {translatePortalText(r)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Shift Schedule & Working Hours (TIME VALIDATION) ── */}
      <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-ocean-600" />
            <h4 className="font-display text-sm font-extrabold text-deep-900">
              {translatePortalText("Shift Schedule & Duty Times")}</h4>
          </div>
          {shiftDuration && (
            <span className="rounded-full bg-ocean-100 px-2.5 py-0.5 text-[11px] font-bold text-ocean-800">
              {translatePortalText("⏱️ Duration:")} {shiftDuration.text}
              {shiftDuration.isOvernight && ` (${translatePortalText('Overnight shift')})`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Shift Start Time */}
          <div>
            <label className="label">{translatePortalText("Shift Start Time (HH:mm)")}</label>
            <input
              type="time"
              className={`input ${
                touched.shiftStartTime && errors.shiftStartTime ? '!border-rose-400 bg-rose-50/20' : ''
              }`}
              value={shiftStartTime}
              onChange={(e) => setShiftStartTime(e.target.value)}
              onBlur={() => handleBlur('shiftStartTime')}
            />
            {touched.shiftStartTime && errors.shiftStartTime && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                <AlertTriangle size={12} /> {translatePortalText(errors.shiftStartTime)}
              </p>
            )}
          </div>

          {/* Shift End Time */}
          <div>
            <label className="label">{translatePortalText("Shift End Time (HH:mm)")}</label>
            <input
              type="time"
              className={`input ${
                touched.shiftEndTime && errors.shiftEndTime ? '!border-rose-400 bg-rose-50/20' : ''
              }`}
              value={shiftEndTime}
              onChange={(e) => setShiftEndTime(e.target.value)}
              onBlur={() => handleBlur('shiftEndTime')}
            />
            {touched.shiftEndTime && errors.shiftEndTime && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                <AlertTriangle size={12} /> {translatePortalText(errors.shiftEndTime)}
              </p>
            )}
          </div>
        </div>

        {/* Working Days Selector */}
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <label className="label !mb-0">{translatePortalText("Working Days Roster")}</label>
            <div className="flex items-center gap-1 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => handleSetDayPreset('weekdays')}
                className="rounded px-2 py-0.5 bg-sand text-slate-600 hover:text-ocean-700"
              >
                {translatePortalText("Sun-Thu")}</button>
              <button
                type="button"
                onClick={() => handleSetDayPreset('all')}
                className="rounded px-2 py-0.5 bg-sand text-slate-600 hover:text-ocean-700"
              >
                {translatePortalText("All 7 Days")}</button>
              <button
                type="button"
                onClick={() => handleSetDayPreset('weekends')}
                className="rounded px-2 py-0.5 bg-sand text-slate-600 hover:text-ocean-700"
              >
                {translatePortalText("Fri-Sat")}</button>
              <button
                type="button"
                onClick={() => handleSetDayPreset('clear')}
                className="rounded px-2 py-0.5 bg-sand text-slate-400 hover:text-rose-600"
              >
                {translatePortalText("Clear")}</button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {DAYS_OF_WEEK.map((d) => {
              const active = workingDays.includes(d.key)
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => handleToggleDay(d.key)}
                  className={`rounded-xl py-2 text-center text-xs font-bold transition ${
                    active
                      ? 'bg-ocean-600 text-white shadow-sm ring-2 ring-ocean-200'
                      : 'bg-white text-slate-500 border border-slate-200 hover:border-ocean-300'
                  }`}
                >
                  <span className="block text-[10px] opacity-75">{shortDayLabel(d.key, d.short)}</span>
                  <span>{translatePortalText(d.label)}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Section 3: Vessel Assignment ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Ship size={16} className="text-ocean-600" />
          <h4 className="font-display text-sm font-extrabold text-deep-900">
            {translatePortalText("Assigned Vessels (")}{formatPortalNumber(selectedBoats.length)}  {translatePortalText("selected)")}</h4>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          {translatePortalText("Select which vessels this crew member is authorized to scan tickets and manage departures on.")}</p>

        {boats.length === 0 ? (
          <p className="rounded-xl bg-sand p-3 text-xs text-slate-500">
            {translatePortalText("No vessels registered in your fleet yet. You can assign vessels later.")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {boats.map((b) => {
              const boatId = b.id || b._id || ''
              const isSelected = selectedBoats.includes(boatId)
              return (
                <button
                  key={boatId}
                  type="button"
                  onClick={() => handleToggleBoat(boatId)}
                  className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                    isSelected
                      ? 'border-ocean-500 bg-ocean-50/50 text-ocean-900 ring-2 ring-ocean-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div
                    className={`grid h-5 w-5 place-items-center rounded-md ${
                      isSelected ? 'bg-ocean-600 text-white' : 'bg-slate-100 text-transparent'
                    }`}
                  >
                    <Check size={12} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold leading-tight">{b.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {b.capacity ? `${formatPortalNumber(b.capacity)} ${translatePortalText('pax')}` : translatePortalText('Vessel')}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Section 4: Onboard Permissions ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="text-ocean-600" />
          <h4 className="font-display text-sm font-extrabold text-deep-900">
            {translatePortalText("Operational Permissions")}</h4>
        </div>
        <div className="space-y-2">
          {(Object.keys(PERMISSION_CONFIG) as BoatCrewPermission[]).map((perm) => {
            const cfg = PERMISSION_CONFIG[perm]
            const active = permissions.includes(perm)
            return (
              <div
                key={perm}
                onClick={() => handleTogglePermission(perm)}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                  active
                    ? 'border-ocean-300 bg-ocean-50/40 ring-1 ring-ocean-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50/50'
                }`}
              >
                <div
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ${
                    active ? 'bg-ocean-600 text-white' : 'bg-slate-100 text-transparent'
                  }`}
                >
                  <Check size={12} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <cfg.icon size={14} className="text-ocean-600" />
                    <span className="text-xs font-bold text-deep-900">{translatePortalText(cfg.label)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText(cfg.desc)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 5: Licence & Qualifications ── */}
      <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Award size={16} className="text-ocean-600" />
          <h4 className="font-display text-sm font-extrabold text-deep-900">
            {translatePortalText("Licence & Maritime Certifications")}</h4>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Licence Number */}
          <div>
            <label className="label">{translatePortalText("Maritime Licence / CoC Number")}</label>
            <input
              type="text"
              className="input font-mono"
              placeholder={translatePortalText("e.g. SA-MAR-2024-8891")}
              value={licenseNo}
              onChange={(e) => setLicenseNo(e.target.value)}
            />
          </div>

          {/* Licence Expiry Date */}
          <div>
            <label className="label">{translatePortalText("Licence Expiry Date")}</label>
            <input
              type="date"
              className={`input ${
                touched.licenseExpiry && errors.licenseExpiry ? '!border-rose-400 bg-rose-50/20' : ''
              }`}
              value={licenseExpiry}
              onChange={(e) => setLicenseExpiry(e.target.value)}
              onBlur={() => handleBlur('licenseExpiry')}
            />
            {touched.licenseExpiry && errors.licenseExpiry && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                <AlertTriangle size={12} /> {translatePortalText(errors.licenseExpiry)}
              </p>
            )}
          </div>
        </div>

        {/* Certifications Tag Picker */}
        <div>
          <label className="label">{translatePortalText("Maritime Certifications")}</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {CERTIFICATION_PRESETS.map((cert) => {
              const active = certifications.includes(cert)
              return (
                <button
                  key={cert}
                  type="button"
                  onClick={() => handleToggleCertification(cert)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  {active ? '✓ ' : '+ '}
                  {translatePortalText(cert)}
                </button>
              )
            })}
          </div>

          {/* Add custom cert */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="input !py-1 text-xs flex-1"
              placeholder={translatePortalText("Add other certification...")}
              value={customCert}
              onChange={(e) => setCustomCert(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddCustomCert()
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddCustomCert}
              className="btn-ghost !py-1 text-xs font-bold text-ocean-700"
            >
              {translatePortalText("Add")}</button>
          </div>

          {certifications.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {certifications.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => handleToggleCertification(c)}
                    className="text-emerald-500 hover:text-rose-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 6: Notes ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="label !mb-0">{translatePortalText("Internal Notes & Remarks")}</label>
          <span
            className={`text-[10px] font-bold ${
              notes.length > 500 ? 'text-rose-500' : 'text-slate-400'
            }`}
          >
            {formatPortalNumber(notes.length)}{translatePortalText("/500 chars")}</span>
        </div>
        <textarea
          className={`input min-h-[70px] ${
            touched.notes && errors.notes ? '!border-rose-400 bg-rose-50/20' : ''
          }`}
          placeholder={translatePortalText("Emergency contacts, dietary restrictions, uniform size, or special instructions...")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => handleBlur('notes')}
        />
        {touched.notes && errors.notes && (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-500">
            <AlertTriangle size={12} /> {translatePortalText(errors.notes)}
          </p>
        )}
      </div>

      {/* Form Submission Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="btn-ghost text-xs"
        >
          {translatePortalText("Cancel")}</button>
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary !px-6 text-xs flex items-center gap-2"
        >
          {submitting ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <UserPlus size={14} />
          )}
          <span>{initialData ? 'Save Changes' : 'Send Crew Invitation'}</span>
        </button>
      </div>
    </form>
  )
}
