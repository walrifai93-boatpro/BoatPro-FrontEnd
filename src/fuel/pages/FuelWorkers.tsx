import React, { useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import {
  UserPlus,
  Mail,
  Trash2,
  RotateCcw,
  Power,
  ShieldCheck,
  Copy,
  Eye,
  Edit3,
  Phone,
  Briefcase,
  Award,
  MapPin,
  User,
  Clock,
  Camera,
  CheckCircle2,
  ArrowRightLeft,
  Upload,
} from 'lucide-react'
import { fuelWorkersApi, FUEL_WORKER_PERMISSIONS, type ApiFuelWorker, type ApiWorkerStation, type FuelWorkerPermission } from '../fuelApi'
import { useFuel, useFuelResource, ALL_STATIONS } from '../fuelStore'
import { FUEL_PERMISSION_LABELS } from '../fuelData'
import { FuelHeader, FBadge } from '../fuelUi'
import { Section, LoadingState, ErrorState, LoadingButton, Modal, toast, copyText, ListRowSkeleton } from '../../ui'
import { useLimitAwareAction, usePackageUsage, UsageMeter } from '../../shared/packageLimit'
import { confirmAndRun } from '../../async'
import { localizedField, portalLocale, translatePortalText } from '../../i18n/runtime'

/** A worker's `station` comes back populated as an object, but degrades to an id string right after a mutation before the next reload. */
function stationId(station?: ApiWorkerStation | string): string {
  if (!station) return ''
  return typeof station === 'string' ? station : station.id
}

function stationLabel(station?: ApiWorkerStation | string): string {
  if (!station) return translatePortalText('Unassigned')
  if (typeof station === 'string') return translatePortalText('Assigned')
  const name = localizedField<string>(station, 'name', station.name) ?? station.name
  const city = localizedField<string>(station, 'city', station.city)
  return city ? `${name} (${city})` : name
}

// No `DEFAULT_AVATARS` preset strip. Both the invite form and the edit modal
// used to offer six Unsplash portraits to click, which stamped a photograph of
// a real stranger onto a colleague's staff record — the one field on the row
// whose whole job is saying which person this is. Uploading a photo, or
// pasting a URL, is now the only way to set one, and a worker without one
// falls back to their initials, as the row, the profile modal and the invite
// preview already did whenever `avatar` was empty.

const ROLE_OPTIONS = [
  'Fuel Ops Manager',
  'Senior Pump Operator',
  'Fuel Attendant',
  'Safety & Compliance Officer',
  'Barge / Vessel Captain',
  'Tank Maintenance Lead',
  'Fleet Logistics Coordinator',
]

const WORKER_ACCOUNT_STATUS_LABELS: Record<string, string> = {
  invited: 'Invite Pending',
  pending_approval: 'Awaiting Approval',
  active: 'Active',
  disabled: 'Disabled',
}

const WORKER_DUTY_STATUS_LABELS: Record<string, string> = {
  on_duty: 'On Duty',
  off_duty: 'Off Duty',
  on_leave: 'On Leave',
}

const WORKER_APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}

function workerAccountStatusLabel(value: string): string {
  return translatePortalText(WORKER_ACCOUNT_STATUS_LABELS[value] ?? value.replace(/_/g, ' '))
}

function workerDutyStatusLabel(value: string): string {
  return translatePortalText(WORKER_DUTY_STATUS_LABELS[value] ?? value.replace(/_/g, ' '))
}

function workerApprovalStatusLabel(value?: string): string {
  const source = value ? WORKER_APPROVAL_STATUS_LABELS[value.toLowerCase()] ?? value.replace(/_/g, ' ') : 'Pending'
  return translatePortalText(source)
}

function getDutyBadge(dutyStatus?: string, accountStatus?: string, approvalStatus?: string) {
  if (approvalStatus === 'rejected') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 border border-rose-200">{translatePortalText("Admin Rejected")}</span>
  }
  if (accountStatus === 'pending_approval' || (approvalStatus === 'pending' && accountStatus !== 'invited')) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-300"><Clock size={12} />{translatePortalText(" Awaiting Approval")}</span>
  }
  if (accountStatus === 'invited') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-600 border border-amber-200"><Clock size={12} />{translatePortalText(" Invite Pending")}</span>
  }
  if (accountStatus === 'disabled') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 border border-rose-200">{translatePortalText("Disabled")}</span>
  }
  if (dutyStatus === 'on_leave') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-600 border border-amber-200">{translatePortalText("On Leave")}</span>
  }
  if (dutyStatus === 'off_duty') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 border border-slate-200">{translatePortalText("Off Duty")}</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600 border border-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />{translatePortalText(" On Duty")}</span>
}

function PermissionGrid({
  value,
  onChange,
}: {
  value: FuelWorkerPermission[]
  onChange: (next: FuelWorkerPermission[]) => void
}) {
  const toggle = (key: FuelWorkerPermission) => {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key])
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {FUEL_WORKER_PERMISSIONS.map((key) => (
        <label
          key={key}
          className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
            value.includes(key) ? 'border-amber-400 bg-amber-50 text-deep-900 shadow-sm' : 'border-slate-200 text-slate-500 hover:border-slate-300'
          }`}
        >
          <input
            type="checkbox"
            checked={value.includes(key)}
            onChange={() => toggle(key)}
            className="h-4 w-4 shrink-0 rounded border-slate-300 accent-amber-500"
          />
          {translatePortalText(FUEL_PERMISSION_LABELS[key] ?? key)}
        </label>
      ))}
    </div>
  )
}

export default function FuelWorkers() {
  const { stations, currentStationId, isAllStations, setCurrentStationId } = useFuel()

  // Defaults to (and stays in sync with) the portal-wide current station, so
  // switching location anywhere else in the fuel portal filters the roster
  // here too. Picking "All Locations" here also sets the global selection.
  const res = useFuelResource(
    () => fuelWorkersApi.list(!isAllStations && currentStationId ? { stationId: currentStationId } : undefined).then((r) => r.data),
    [currentStationId, isAllStations],
  )
  const workers = res.data?.workers ?? []

  /**
   * A worker roster is searched by person and filtered by where they work — which
   * station, which shift status, and what the app lets them touch.
   */
  const workerCfg: TableFiltersConfig<ApiFuelWorker> = useMemo(() => ({
    searchFields: (w) => [w.name, w.email, w.phone, w.role, w.licenseNo],
    filters: [
      {
        key: 'status',
        label: translatePortalText("Account"),
        options: [...new Set(workers.map((w) => w.status))].sort().map((value) => ({
          value,
          label: workerAccountStatusLabel(value),
        })),
        get: (w) => w.status,
      },
      {
        key: 'duty',
        label: translatePortalText("Duty"),
        options: [...new Set(workers.flatMap((w) => w.dutyStatus ? [w.dutyStatus] : []))].sort().map((value) => ({
          value,
          label: workerDutyStatusLabel(value),
        })),
        get: (w) => w.dutyStatus,
      },
      {
        key: 'role',
        label: translatePortalText("Role"),
        options: [...new Set(workers.map((w) => w.role).filter((value): value is string => Boolean(value)))].sort().map((value) => ({
          value,
          label: translatePortalText(value),
        })),
        get: (w) => w.role,
      },
      {
        key: 'station',
        label: translatePortalText("Station"),
        get: (w) => (typeof w.station === 'object' && w.station ? w.station.name : undefined),
      },
      {
        key: 'permission',
        label: translatePortalText("Page access"),
        options: [...new Set(workers.flatMap(w => w.permissions ?? []))]
          .sort()
          .map(v => ({ value: String(v), label: translatePortalText(FUEL_PERMISSION_LABELS[String(v)] ?? String(v).replace(/_/g, ' ')) })),
        get: (w) => (w.permissions ?? []).join(','),
        match: (w, v) => (w.permissions ?? []).includes(v as never),
      },
    ],
  }), [workers])
  const workerTf = useTableFilters(workers, workerCfg)

  const changeStationFilter = (id: string) => setCurrentStationId(id)

  // Invite state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('Fuel Attendant')
  const [avatar, setAvatar] = useState('')
  const [dutyStatus, setDutyStatus] = useState<'on_duty' | 'off_duty' | 'on_leave'>('on_duty')
  const [station, setStation] = useState('')
  const [licenseNo, setLicenseNo] = useState('')
  const [notes, setNotes] = useState('')
  const [permissions, setPermissions] = useState<FuelWorkerPermission[]>([])
  const [busy, setBusy] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  // Modals state
  const [viewingWorker, setViewingWorker] = useState<ApiFuelWorker | null>(null)
  const [editingWorker, setEditingWorker] = useState<ApiFuelWorker | null>(null)
  const [reassigningWorker, setReassigningWorker] = useState<ApiFuelWorker | null>(null)
  const [reassignTarget, setReassignTarget] = useState('')

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editAvatar, setEditAvatar] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [editDutyStatus, setEditDutyStatus] = useState<'on_duty' | 'off_duty' | 'on_leave'>('on_duty')
  const [editStation, setEditStation] = useState('')
  const [editLicenseNo, setEditLicenseNo] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editPermissions, setEditPermissions] = useState<FuelWorkerPermission[]>([])

  const openInvite = () => {
    setName(''); setEmail(''); setPhone(''); setRole('Fuel Attendant'); setAvatar('')
    setDutyStatus('on_duty'); setStation(!isAllStations && currentStationId ? currentStationId : ''); setLicenseNo(''); setNotes('')
    setPermissions([]); setInviteLink(null)
    setInviteOpen(true)
  }

  const invite = useLimitAwareAction(fuelWorkersApi.invite)
  const usage = usePackageUsage()

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res2 = await invite.run({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role: role.trim(),
        avatar: avatar.trim(),
        dutyStatus,
        station: station || undefined,
        licenseNo: licenseNo.trim(),
        notes: notes.trim(),
        permissions,
      })
      if (!res2) return // package limit reached — the modal is showing and will retry this on resolution
      await res.reload()
      await usage.reload()
      if (res2.data.devInviteToken) {
        setInviteLink(`${window.location.origin}${window.location.pathname}#/worker-invite/fuel/${res2.data.devInviteToken}`)
      } else {
        toast(translatePortalText(`Invited ${name}`))
        setInviteOpen(false)
      }
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not send invite'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const copyInviteLink = async () => {
    if (!inviteLink) return
    const ok = await copyText(inviteLink)
    toast(translatePortalText(ok ? 'Invite link copied' : 'Could not copy — select and copy manually'), ok ? 'success' : 'warn')
  }

  const openViewProfile = (w: ApiFuelWorker) => {
    setViewingWorker(w)
  }

  const openEditProfile = (w: ApiFuelWorker) => {
    setEditingWorker(w)
    setEditName(w.name || '')
    setEditEmail(w.email || '')
    setEditPhone(w.phone || '')
    setEditRole(w.role || 'Fuel Attendant')
    setEditAvatar(w.avatar || '')
    setEditDutyStatus(w.dutyStatus || 'on_duty')
    setEditStation(stationId(w.station))
    setEditLicenseNo(w.licenseNo || '')
    setEditNotes(w.notes || '')
    setEditPermissions(w.permissions || [])
  }

  /**
   * Uploads a real photo for a saved worker.
   *
   * Separate from `saveEditProfile` because it targets its own multipart
   * endpoint and applies immediately — the owner sees the face change without
   * having to also press Save, and `editAvatar` is synced so a subsequent Save
   * does not overwrite the new URL with the stale one in the form.
   */
  const uploadWorkerPhoto = async (id: string, file: File) => {
    setAvatarBusy(true)
    try {
      const r = await fuelWorkersApi.uploadAvatar(id, file)
      setEditAvatar(r.data.worker.avatar || '')
      await res.reload()
      toast(translatePortalText("Photo updated"))
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not upload that photo'), 'warn')
    } finally {
      setAvatarBusy(false)
    }
  }

  const saveEditProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingWorker) return
    setBusy(true)
    try {
      await fuelWorkersApi.update(editingWorker._id, {
        name: editName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
        role: editRole.trim(),
        avatar: editAvatar.trim(),
        dutyStatus: editDutyStatus,
        station: editStation || undefined,
        licenseNo: editLicenseNo.trim(),
        notes: editNotes.trim(),
        permissions: editPermissions,
      })
      await res.reload()
      toast(translatePortalText(`Profile updated for ${editName}`))
      setEditingWorker(null)
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not update profile'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const openReassign = (w: ApiFuelWorker) => {
    setReassigningWorker(w)
    setReassignTarget(stationId(w.station) || stations[0]?.id || '')
  }

  const submitReassign = async () => {
    if (!reassigningWorker || !reassignTarget) return
    setBusy(true)
    try {
      await fuelWorkersApi.reassign(reassigningWorker._id, reassignTarget)
      await res.reload()
      toast(translatePortalText(`${reassigningWorker.name} reassigned`))
      setReassigningWorker(null)
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not reassign worker'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const toggleStatus = async (w: ApiFuelWorker) => {
    if (w.status !== 'active' && w.approvalStatus !== 'approved') {
      toast(translatePortalText("Worker cannot be activated until approved by platform admin"), 'warn')
      return
    }
    try {
      await fuelWorkersApi.setStatus(w._id, w.status === 'active' ? 'disabled' : 'active')
      await res.reload()
      toast(translatePortalText(w.status === 'active' ? `${w.name} disabled` : `${w.name} re-enabled`))
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not update status'), 'warn')
    }
  }

  const [resendModal, setResendModal] = useState<{ name: string; link: string } | null>(null)

  const resend = async (w: ApiFuelWorker) => {
    try {
      const r = await fuelWorkersApi.resendInvite(w._id)
      if (r.data.devInviteToken) {
        const link = `${window.location.origin}${window.location.pathname}#/worker-invite/fuel/${r.data.devInviteToken}`
        await copyText(link)
        setResendModal({ name: w.name, link })
        toast(translatePortalText("New invite link copied to clipboard"))
      } else {
        toast(translatePortalText(`Invite resent to ${w.name}`))
      }
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not resend invite'), 'warn')
    }
  }

  const remove = (w: ApiFuelWorker) =>
    confirmAndRun({
      title: translatePortalText(`Remove ${w.name} from your team?`),
      body: 'They lose access to the fuel portal immediately.',
      confirmLabel: translatePortalText("Remove"),
      busyLabel: 'Removing...',
      danger: true,
      run: async () => {
        await fuelWorkersApi.remove(w._id)
        await res.reload()
      },
      success: translatePortalText(`${w.name} removed from your team`),
      error: translatePortalText("Could not remove this worker. Please try again."),
    })

  return (
    <div>
      <FuelHeader
        icon={<ShieldCheck size={26} className="text-amber-500" />}
        title={translatePortalText("Team & Access")}
        sub={translatePortalText("Manage fuel station staff profiles, duty statuses, roles, and page access control.")}
        actions={
          <button className="btn-fuel" onClick={openInvite}>
            <UserPlus size={16} />{translatePortalText(" Invite worker")}</button>
        }
      />

      {usage.usage.some((u) => u.key === 'maxWorkersPerStation' || u.key === 'maxStations') && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 sm:grid-cols-2">
          {usage.usage
            .filter((u) => u.key === 'maxWorkersPerStation' || u.key === 'maxStations')
            .map((u) => (
              <UsageMeter key={u.key} item={u} />
            ))}
        </div>
      )}

      {stations.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3.5">
          <MapPin size={16} className="text-amber-600" />
          <label className="text-xs font-bold uppercase tracking-wider text-amber-700">{translatePortalText("Filter by station")}</label>
          <select
            className="bg-white rounded-lg border border-amber-200/80 px-2.5 py-1.5 text-sm font-semibold text-deep-900 cursor-pointer focus:outline-none"
            value={currentStationId ?? ALL_STATIONS}
            onChange={(e) => changeStationFilter(e.target.value)}
          >
            <option value={ALL_STATIONS}>{translatePortalText("📍 All Locations (")}{stations.length})</option>
            {stations.map((st) => (
              <option key={st.id} value={st.id}>📍 {localizedField<string>(st, 'name', st.name)}{st.city ? ` (${localizedField<string>(st, 'city', st.city)})` : translatePortalText("")}</option>
            ))}
          </select>
        </div>
      )}

      <Section title={translatePortalText("Workers Roster")} sub={translatePortalText(`${workers.length} registered team member${workers.length === 1 ? '' : 's'}${!isAllStations && currentStationId ? ' at this location' : ''}`)}>
        {res.loading ? (
          <ListRowSkeleton count={5} />
        ) : res.error ? (
          <ErrorState error={translatePortalText(res.error)} onRetry={res.reload} />
        ) : workers.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">{translatePortalText("No workers yet — invite your first teammate.")}</p>
        ) : (
          <div className="space-y-3">
            <TableToolbar
              state={workerTf}
              config={workerCfg}
              rows={workers}
              noun="team members"
              searchPlaceholder="Search the team by name, email, phone or role..."
            />
            {workers.length > 0 && workerTf.filtered.length === 0 && (
              <NoFilterMatches noun="team members" onClear={workerTf.clear} />
            )}
            <div className="hidden sm:flex sm:items-center sm:gap-4 px-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <div className="w-[30%] shrink-0">{translatePortalText("Team Member & Role")}</div>
              <div className="w-32 shrink-0">{translatePortalText("Status")}</div>
              <div className="flex-1">{translatePortalText("Page Access")}</div>
              <div className="ms-auto shrink-0 pe-2">{translatePortalText("Actions")}</div>
            </div>
            {workerTf.pagedRows.map((w, i) => (
              <motion.div
                key={w._id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-amber-200 hover:shadow-md sm:flex-row sm:items-center sm:gap-4"
              >
                {/* Avatar + Info */}
                <div className="flex items-center gap-3 min-w-0 shrink-0 sm:w-[30%]">
                  <div className="relative h-11 w-11 shrink-0 rounded-full bg-amber-100 overflow-hidden border border-slate-200 flex items-center justify-center text-amber-700 font-extrabold">
                    {w.avatar ? (
                      <img src={w.avatar} alt={w.name} className="h-full w-full object-cover" />
                    ) : (
                      <span>{w.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-extrabold text-deep-900">{w.name}</p>
                    </div>
                    <p className="truncate text-xs font-semibold text-amber-600">{translatePortalText(w.role || 'Fuel Attendant')}</p>
                    <p className="truncate text-[11px] text-slate-400">{w.email}</p>
                    <p className="truncate text-[11px] font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                      <MapPin size={10} className={w.station ? "text-amber-500" : "text-slate-300"} /> {stationLabel(w.station)}
                    </p>
                  </div>
                </div>

                {/* Duty status badge */}
                <div className="w-32 shrink-0">
                  {getDutyBadge(w.dutyStatus, w.status, w.approvalStatus)}
                </div>

                {/* Permissions */}
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {w.permissions.length === 0 ? (
                    <span className="text-xs text-slate-400">{translatePortalText("Dashboard only")}</span>
                  ) : (
                    w.permissions.map((p) => (
                      <span key={p} className="rounded-full bg-sand px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200/60">
                        {translatePortalText(FUEL_PERMISSION_LABELS[p] ?? p)}
                      </span>
                    ))
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1.5 self-end sm:ms-auto sm:self-auto">
                  <button
                    title={translatePortalText("View Profile")}
                    onClick={() => openViewProfile(w)}
                    className="btn-ghost !py-1.5 !px-2.5 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    <Eye size={15} />
                    <span className="hidden md:inline">{translatePortalText("View")}</span>
                  </button>
                  <button
                    title={translatePortalText("Edit Profile & Access")}
                    onClick={() => openEditProfile(w)}
                    className="btn-ghost !py-1.5 !px-2.5 text-xs text-amber-700 hover:bg-amber-50"
                  >
                    <Edit3 size={15} />
                    <span className="hidden md:inline">{translatePortalText("Edit")}</span>
                  </button>
                  {stations.length > 1 && (
                    <button
                      title={translatePortalText("Reassign to another station")}
                      onClick={() => openReassign(w)}
                      className="btn-ghost !p-2 text-sky-600 hover:bg-sky-50"
                    >
                      <ArrowRightLeft size={15} />
                    </button>
                  )}
                  <button title={translatePortalText("Resend Invite Link")} onClick={() => resend(w)} className="btn-ghost !p-2 text-amber-600 hover:bg-amber-50">
                    <RotateCcw size={15} />
                  </button>
                  {w.status !== 'invited' && (
                    <button
                      title={
                        translatePortalText(w.approvalStatus !== 'approved'
                          ? 'Awaiting platform admin approval'
                          : w.status === 'active'
                          ? 'Disable Account'
                          : 'Re-enable Account')
                      }
                      onClick={() => toggleStatus(w)}
                      disabled={w.approvalStatus !== 'approved' && w.status !== 'active'}
                      className={`btn-ghost !p-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                        w.status === 'active' ? 'text-rose-500 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      <Power size={15} />
                    </button>
                  )}
                  <button title={translatePortalText("Remove Worker")} onClick={() => remove(w)} className="btn-ghost !p-2 text-rose-500 hover:bg-rose-50">
                    <Trash2 size={15} />
                  </button>
                </div>
              </motion.div>
            ))}
            <TablePagination state={workerTf} noun="team members" />
          </div>
        )}
      </Section>

      {/* VIEW PROFILE MODAL */}
      <Modal open={!!viewingWorker} onClose={() => setViewingWorker(null)} title={translatePortalText("Worker Profile")} wide>
        {viewingWorker && (
          <div className="space-y-6">
            {/* Header Banner */}
            <div className="flex flex-col sm:flex-row items-center gap-4 rounded-2xl bg-gradient-to-r from-deep-900 to-deep-800 p-5 text-white shadow-md">
              <div className="relative h-20 w-20 shrink-0 rounded-full border-2 border-amber-400 bg-amber-100 overflow-hidden flex items-center justify-center text-amber-900 font-black text-2xl shadow">
                {viewingWorker.avatar ? (
                  <img src={viewingWorker.avatar} alt={viewingWorker.name} className="h-full w-full object-cover" />
                ) : (
                  <span>{viewingWorker.name.slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="text-center sm:text-left min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h3 className="text-xl font-black">{viewingWorker.name}</h3>
                  {getDutyBadge(viewingWorker.dutyStatus, viewingWorker.status, viewingWorker.approvalStatus)}
                </div>
                <p className="mt-1 text-sm font-semibold text-amber-300">{translatePortalText(viewingWorker.role || 'Fuel Attendant')}</p>
                <p className="text-xs text-slate-300">{viewingWorker.email}</p>
              </div>
              <button
                onClick={() => {
                  const w = viewingWorker
                  setViewingWorker(null)
                  openEditProfile(w)
                }}
                className="btn-fuel shrink-0 !py-2 !px-4 text-xs"
              >
                <Edit3 size={14} />{translatePortalText(" Edit Profile")}</button>
            </div>

            {/* Admin Approval Info */}
            <div
              className={`rounded-xl border p-4 ${
                viewingWorker.approvalStatus === 'rejected'
                  ? 'border-rose-200 bg-rose-50/70 text-rose-900'
                  : viewingWorker.approvalStatus === 'approved'
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                  : 'border-amber-200 bg-amber-50/70 text-amber-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <ShieldCheck size={15} />{translatePortalText(" Platform Admin Approval")}</div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold uppercase ${
                    viewingWorker.approvalStatus === 'rejected'
                      ? 'bg-rose-200 text-rose-800'
                      : viewingWorker.approvalStatus === 'approved'
                      ? 'bg-emerald-200 text-emerald-800'
                      : 'bg-amber-200 text-amber-800'
                  }`}
                >
                  {workerApprovalStatusLabel(viewingWorker.approvalStatus)}
                </span>
              </div>
              <p className="mt-1.5 text-xs">
                {viewingWorker.approvalStatus === 'approved'
                  ? translatePortalText("This worker is approved by platform admins and has full access to the portal based on assigned permissions.")
                  : viewingWorker.approvalStatus === 'rejected'
                  ? translatePortalText(`This worker was rejected by admin.${viewingWorker.rejectionReason ? ` Reason: "${viewingWorker.rejectionReason}"` : ''}`)
                  : translatePortalText("This worker is awaiting platform admin approval before they can sign in and operate fuel stations.")}
              </p>
            </div>

            {/* Profile Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-sand/50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <User size={14} className="text-amber-500" />{translatePortalText(" Personal Info")}</div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">{translatePortalText("Phone Number")}</p>
                  <p className="text-sm font-bold text-deep-900">{viewingWorker.phone || translatePortalText('Not provided')}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">{translatePortalText("Assigned Station / Location")}</p>
                  <p className="text-sm font-bold text-deep-900">{stationLabel(viewingWorker.station)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-sand/50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <Award size={14} className="text-amber-500" />{translatePortalText(" Compliance & Credentials")}</div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">{translatePortalText("License / Staff ID No.")}</p>
                  <p className="text-sm font-bold text-deep-900">{viewingWorker.licenseNo || 'FL-OPS-8842'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">{translatePortalText("Invited / Registered Date")}</p>
                  <p className="text-sm font-bold text-deep-900">
                    {new Date(viewingWorker.invitedAt).toLocaleDateString(portalLocale(), { dateStyle: 'medium' })}
                  </p>
                </div>
              </div>
            </div>

            {/* Notes */}
            {viewingWorker.notes && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800">{translatePortalText("Operator Notes & Qualifications")}</p>
                <p className="mt-1 text-xs text-slate-700 leading-relaxed">{viewingWorker.notes}</p>
              </div>
            )}

            {/* Permissions Granted */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{translatePortalText("Granted Page Access")}</p>
              <div className="flex flex-wrap gap-1.5">
                {viewingWorker.permissions.length === 0 ? (
                  <span className="text-xs text-slate-500">{translatePortalText("Dashboard only")}</span>
                ) : (
                  viewingWorker.permissions.map((p) => (
                    <span key={p} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-deep-900">
                      <CheckCircle2 size={13} className="text-amber-600" />
                      {translatePortalText(FUEL_PERMISSION_LABELS[p] ?? p)}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button className="btn-ghost" onClick={() => setViewingWorker(null)}>{translatePortalText("Close")}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* EDIT PROFILE & ACCESS MODAL */}
      <Modal open={!!editingWorker} onClose={() => setEditingWorker(null)} title={translatePortalText(editingWorker ? `Edit Profile — ${editingWorker.name}` : '')} wide>
        {editingWorker && (
          <form onSubmit={saveEditProfile} className="space-y-4">
            {/* Avatar Section */}
            <div>
              <label className="label">{translatePortalText("Profile Picture / Avatar")}</label>
              <div className="flex items-center gap-4 mb-3">
                <div className="relative h-16 w-16 shrink-0 rounded-full bg-amber-100 overflow-hidden border-2 border-amber-400 flex items-center justify-center text-amber-800 font-bold text-xl">
                  {editAvatar ? (
                    <img src={editAvatar} alt={translatePortalText("Preview")} className="h-full w-full object-cover" />
                  ) : (
                    <span>{editName.slice(0, 2).toUpperCase() || 'AV'}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {/*
                    A real photo of the actual person, uploaded from the desk.
                    The presets below are stock portraits of strangers — fine as
                    a placeholder, useless for recognising who is on shift, which
                    is the only reason a fuel attendant has a picture at all.
                  */}
                  <label className="btn-fuel !py-1.5 !px-3 text-xs cursor-pointer inline-flex">
                    <Upload size={13} /> {avatarBusy ? translatePortalText("Uploading…") : translatePortalText("Upload photo")}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={avatarBusy}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        // Reset so re-picking the same file still fires onChange.
                        e.target.value = ''
                        if (file) void uploadWorkerPhoto(editingWorker._id, file)
                      }}
                    />
                  </label>
                </div>
              </div>
              <input
                value={editAvatar}
                onChange={(e) => setEditAvatar(e.target.value)}
                placeholder={translatePortalText("Or paste custom image URL (https://...)")}
                className="input text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{translatePortalText("Full Name")}</label>
                <input required value={editName} onChange={(e) => setEditName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">{translatePortalText("Email Address")}</label>
                <input required type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="input" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{translatePortalText("Phone Number")}</label>
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+971 50 123 4567" className="input" />
              </div>
              <div>
                <label className="label">{translatePortalText("Role / Designation")}</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="input">
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{translatePortalText(r)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{translatePortalText("Duty Status")}</label>
                <select
                  value={editDutyStatus}
                  onChange={(e) => setEditDutyStatus(e.target.value as any)}
                  className="input font-semibold"
                >
                  <option value="on_duty">{translatePortalText("🟢 On Duty")}</option>
                  <option value="off_duty">{translatePortalText("⚪ Off Duty")}</option>
                  <option value="on_leave">{translatePortalText("🟡 On Leave")}</option>
                </select>
              </div>
              <div>
                <label className="label">{translatePortalText("Assigned Station Location")}</label>
                <select value={editStation} onChange={(e) => setEditStation(e.target.value)} className="input">
                  {stations.map((st) => (
                    <option key={st.id} value={st.id}>📍 {localizedField<string>(st, 'name', st.name)}{st.city ? ` (${localizedField<string>(st, 'city', st.city)})` : translatePortalText("")}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{translatePortalText("License / Certification ID")}</label>
                <input
                  value={editLicenseNo}
                  onChange={(e) => setEditLicenseNo(e.target.value)}
                  placeholder={translatePortalText("FL-CERT-9021")}
                  className="input"
                />
              </div>
              <div>
                <label className="label">{translatePortalText("Operator Notes / Skills")}</label>
                <input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder={translatePortalText("Hazmat certified, Diesel specialist")}
                  className="input"
                />
              </div>
            </div>

            <div>
              <label className="label">{translatePortalText("Page Access Control")}</label>
              <PermissionGrid value={editPermissions} onChange={setEditPermissions} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" className="btn-ghost" onClick={() => setEditingWorker(null)}>{translatePortalText("Cancel")}</button>
              <LoadingButton type="submit" loading={busy} className="btn-fuel">{translatePortalText("Save Profile & Access")}</LoadingButton>
            </div>
          </form>
        )}
      </Modal>

      {/* INVITE WORKER MODAL */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title={translatePortalText("Invite a new worker")} wide>
        {inviteLink ? (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-deep-900">{name
              ? translatePortalText(`Invite created — share this link with ${name}:`)
              : translatePortalText('Invite created — share this link with your new teammate:')}
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-sand px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate text-xs text-slate-600 font-mono">{inviteLink}</code>
              <button onClick={copyInviteLink} className="btn-ghost !p-2 shrink-0"><Copy size={15} /></button>
            </div>
            <p className="text-xs text-slate-400">{translatePortalText("Copy this link and share it directly with the worker to activate their portal account.")}</p>
            <button className="btn-fuel w-full !justify-center" onClick={() => setInviteOpen(false)}>{translatePortalText("Done")}</button>
          </div>
        ) : (
          <form onSubmit={submitInvite} className="space-y-4">
            {/* Avatar Section */}
            <div>
              <label className="label">{translatePortalText("Profile Picture (Optional)")}</label>
              <div className="flex items-center gap-4 mb-2">
                <div className="relative h-14 w-14 shrink-0 rounded-full bg-amber-100 overflow-hidden border border-amber-300 flex items-center justify-center text-amber-800 font-bold">
                  {avatar ? (
                    <img src={avatar} alt={translatePortalText("Preview")} className="h-full w-full object-cover" />
                  ) : (
                    <span>{name.slice(0, 2).toUpperCase() || 'AV'}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <label className="btn-ghost !py-1 !px-2.5 text-xs cursor-pointer inline-flex items-center gap-1.5 border border-slate-200">
                      <Upload size={13} />{translatePortalText(" Upload photo")}<input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (file) {
                            const reader = new FileReader()
                            reader.onload = () => {
                              if (typeof reader.result === 'string') {
                                setAvatar(reader.result)
                              }
                            }
                            reader.readAsDataURL(file)
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <input
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder={translatePortalText("Or paste image URL (https://...)")}
                className="input text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{translatePortalText("Full Name")}</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={translatePortalText("Ahmed Al Farsi")} className="input" />
              </div>
              <div>
                <label className="label">{translatePortalText("Email address")}</label>
                <div className="relative">
                  <Mail size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={translatePortalText("worker@example.com")}
                    className="input ps-10"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{translatePortalText("Phone Number")}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 123 4567" className="input" />
              </div>
              <div>
                <label className="label">{translatePortalText("Role / Designation")}</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{translatePortalText(r)}</option>
                  ))}
                </select>
              </div>
            </div>

            {stations.length > 0 && (
              <div>
                <label className="label">{translatePortalText("Assigned Station Location")}</label>
                <select value={station} onChange={(e) => setStation(e.target.value)} className="input">
                  {stations.map((st) => (
                    <option key={st.id} value={st.id}>📍 {localizedField<string>(st, 'name', st.name)}{st.city ? ` (${localizedField<string>(st, 'city', st.city)})` : translatePortalText("")}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="label">{translatePortalText("Page access control")}</label>
              <PermissionGrid value={permissions} onChange={setPermissions} />
            </div>

            <LoadingButton type="submit" loading={busy} className="btn-fuel w-full !justify-center">{translatePortalText("Send Invite")}</LoadingButton>
          </form>
        )}
      </Modal>

      {/* RESEND LINK MODAL */}
      <Modal open={!!resendModal} onClose={() => setResendModal(null)} title={translatePortalText(resendModal ? `🔗 Resend Invite Link — ${resendModal.name}` : '')}>
        {resendModal && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-deep-900">{translatePortalText("Invite link generated & copied to clipboard! Share this link with ")}{resendModal.name}:</p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-sand px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate text-xs text-slate-600 font-mono">{resendModal.link}</code>
              <button onClick={() => { copyText(resendModal.link); toast(translatePortalText("Copied invite link")); }} className="btn-ghost !p-2 shrink-0"><Copy size={15} /></button>
            </div>
            <button className="btn-fuel w-full !justify-center" onClick={() => setResendModal(null)}>{translatePortalText("Done")}</button>
          </div>
        )}
      </Modal>

      {/* REASSIGN TO ANOTHER STATION MODAL */}
      <Modal open={!!reassigningWorker} onClose={() => setReassigningWorker(null)} title={translatePortalText(reassigningWorker ? `Reassign — ${reassigningWorker.name}` : '')}>
        {reassigningWorker && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">{translatePortalText("Move ")}<b className="text-deep-900">{reassigningWorker.name}</b>{translatePortalText(" from")}{translatePortalText(" ")}
              <b className="text-deep-900">{stationLabel(reassigningWorker.station)}</b>{translatePortalText(" to another fuel station location managed by your account.")}</p>
            <div>
              <label className="label">{translatePortalText("New Station Location")}</label>
              <select value={reassignTarget} onChange={(e) => setReassignTarget(e.target.value)} className="input">
                {stations.map((st) => (
                  <option key={st.id} value={st.id}>📍 {localizedField<string>(st, 'name', st.name)}{st.city ? ` (${localizedField<string>(st, 'city', st.city)})` : translatePortalText("")}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setReassigningWorker(null)}>{translatePortalText("Cancel")}</button>
              <LoadingButton
                loading={busy}
                className="btn-fuel"
                disabled={reassignTarget === stationId(reassigningWorker.station)}
                onClick={submitReassign}
              >
                <ArrowRightLeft size={14} />{translatePortalText(" Reassign Worker")}</LoadingButton>
            </div>
          </div>
        )}
      </Modal>

      {invite.modal}
    </div>
  )
}
