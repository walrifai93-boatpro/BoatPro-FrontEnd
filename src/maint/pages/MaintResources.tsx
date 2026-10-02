import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Users, Package, Plus, Phone, ScanLine, Boxes, Wrench as WrenchIcon, Search, CheckCircle2, ShieldCheck, Copy, RotateCcw, Pencil, Trash2, Upload, X } from 'lucide-react'
import { catByKey, catChipLabel, money, MAINT_PERMISSION_LABELS, ALL_MARINE_SPECIALTIES, DEFAULT_TECHNICIAN_ROLES, MAINT_CATEGORIES, MAINT_CATEGORY_KEYS } from '../maintData'
import type { Technician, Part } from '../maintData'
import { PageWrap } from './_shared'
import { Section, Modal, Stars, Counter, download, toCSV, copyText } from '../../ui'
import { maintToast, MaintHeader, MBadge, JobProgress, MaintViewToggle, useCall, CallModal } from '../maintUi'
import {
  maintenancePortalApi, maintenanceShopApi, MAINTENANCE_WORKER_PERMISSIONS,
  type MaintenanceTechnician, type MaintenancePart, type MaintenanceWorkerPermission,
  type MaintenanceTool, type MaintenanceSupplier, type MaintenanceServiceCatalogItem,
} from '../../api'
import { avatar } from '../../format'
import { useAuth } from '../../auth'
import { useLimitAwareAction, usePackageUsage, UsageMeter } from '../../shared/packageLimit'
import { RolesPanel } from '../components/RolesPanel'
import { formatPortalDate, formatPortalNumber, formatPortalPercent, isPortalArabic, localizedField, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

const TOOL_KIND_LABEL: Record<MaintenanceTool['kind'], string> = { tool: 'Tool', equipment: 'Equipment' }
const TOOL_STATUS_LABEL: Record<MaintenanceTool['status'], string> = { available: 'Available', in_use: 'In use', calibration_due: 'Calibration due', lost: 'Lost' }
const fmtDate = (iso?: string) => formatPortalDate(iso, { month: 'short', year: 'numeric' })

// The Services tab's category picker. Driven off MAINT_CATEGORIES so it offers
// every value the API accepts — its own hand-kept list had gone stale and left
// HVAC, survey, antifouling and propeller work unlistable in the catalogue.
const SERVICE_CATEGORY_KEYS = MAINT_CATEGORIES.map(c => c.key)
const serviceCategoryLabel = (key: string) => translatePortalText(catByKey(key).name)

/** Map backend technician to the UI Technician shape used by the existing cards/table. */
const toTechView = (t: MaintenanceTechnician): Technician => {
  let displayStatus: 'On duty' | 'Off duty' | 'On leave' | 'Pending Approval' | 'Rejected' | 'Invited' = 'Pending Approval'
  if (t.approvalStatus === 'rejected') {
    displayStatus = 'Rejected'
  } else if (t.approvalStatus === 'pending' || t.accountStatus === 'pending_approval') {
    displayStatus = 'Pending Approval'
  } else if (t.accountStatus === 'invited') {
    displayStatus = 'Invited'
  } else {
    displayStatus = t.status === 'on_duty' ? 'On duty' : t.status === 'off_duty' ? 'Off duty' : 'On leave'
  }
  const certifications = localizedField<string[]>(t, 'certifications') as string[] | undefined

  return {
    id: t.id || (t as any)._id,
    name: t.name,
    avatar: t.avatar || avatar(Math.abs(t.name.charCodeAt(0) % 70)),
    role: String(localizedField(t, 'role') ?? t.role),
    skills: t.skills || [],
    status: displayStatus,
    approvalStatus: t.approvalStatus,
    rejectionReason: localizedField(t, 'rejectionReason') as string | undefined,
    rating: (t as any).rating || 0,
    jobsToday: (t as any).jobsToday ?? 0,
    utilization: (t as any).utilization ?? 0,
    certs: (certifications || []).filter(Boolean).join(' · ') || '—',
    shift: '—',
    phone: t.phone || '',
    hoursWeek: (t as any).hoursWeek ?? 0,
    overtime: (t as any).overtime ?? 0,
    pos: { x: 50, y: 50 },
    mobile: t.mobile,
  }
}

/** Map backend part to the UI Part shape. */
const toPartView = (p: MaintenancePart): Part => ({
  id: p.id || (p as any)._id,
  name: String(localizedField(p, 'name') ?? p.name),
  sku: p.sku,
  cat: p.category || 'engine',
  stock: p.stock,
  min: p.minimumStock,
  price: p.unitCost,
  supplier: p.supplier || '—',
  location: p.location || '—',
  barcode: '',
})

const toolDisplayName = (tool: MaintenanceTool) => String(localizedField(tool, 'name') ?? tool.name)
const supplierCategories = (supplier: MaintenanceSupplier) =>
  (localizedField<string[]>(supplier, 'partsCategories') as string[] | undefined) ?? supplier.partsCategories

const DEFAULT_ROLES = DEFAULT_TECHNICIAN_ROLES
const DEFAULT_RATE = '85'

/** Role → the skill it implies. Keys must be MAINT_CATEGORIES keys: they are
 * submitted verbatim, and the API rejects anything outside its enum. */
const ROLE_SKILL_MAP: Record<string, string> = {
  'Inboard Engines': 'engine',
  'Outboard Engines': 'engine',
  'Marine Electronics & Radar': 'navigation',
  'Hull & Gelcoat Refit': 'hull',
  'Electrical & Lithium Systems': 'electrical',
  'Rigging & Sail Maintenance': 'rigging',
  'Hydraulics & Steering Systems': 'steering',
  'Marine HVAC & Climate Control': 'hvac',
  'Underwater Antifouling & Zincs': 'antifouling',
  'Propeller & Drive Alignment': 'propeller',
  'Plumbing, Heads & Watermakers': 'plumbing',
  'Diagnostic Survey & Inspection': 'survey',
  'Marine Mechanic': 'engine',
  'Safety Inspector': 'survey',
  'Lead Technician': 'engine',
}

/** "Marine Mechanic 100/hr · Lead Technician 150/hr" — falls back to the legacy
 * flat rate for technicians created before per-role rates existed. */
function rateSummary(t?: MaintenanceTechnician): string {
  if (!t) return ''
  const hourlyUnit = translatePortalText('/hr')
  const formatRate = (rate: number) => `${isPortalArabic() ? formatPortalNumber(rate, { maximumFractionDigits: 2 }) : rate}${hourlyUnit}`
  if (t.roles?.length) return t.roles.map(r => `${translatePortalText(String(localizedField(r, 'role') ?? r.role))} ${formatRate(r.hourlyRate)}`).join(' · ')
  return t.hourlyRate ? formatRate(t.hourlyRate) : ''
}

// ══════════ TECHNICIANS & LABOR (§9, §13) ══════════
export function MaintTechnicians() { return <TechniciansPage /> }
function TechniciansPage() {
  const location = useLocation()
  const { maintAccess } = useAuth()
  const [techs, setTechs] = useState<Technician[]>([])

  const techCfg: TableFiltersConfig<Technician> = useMemo(() => ({
    // Skills are joined so one search term can hit any of them.
    searchFields: (t) => [t.name, t.role, t.phone, t.certs, (t.skills ?? []).join(' ')],
    filters: [
      { key: 'status', label: 'Duty status', get: (t) => t.status },
      { key: 'role', label: 'Role', get: (t) => t.role },
      {
        key: 'skill',
        label: 'Skill',
        options: [...new Set(techs.flatMap(t => t.skills ?? []))].sort().map(v => ({ value: v, label: catByKey(v).name })),
        get: (t) => (t.skills ?? []).join(','),
        match: (t, v) => (t.skills ?? []).includes(v),
      },
      {
        key: 'load',
        label: 'Utilisation',
        options: [
          { value: 'over', label: translatePortalText('Over 80%') },
          { value: 'normal', label: translatePortalText('40-80%') },
          { value: 'idle', label: translatePortalText('Under 40%') },
        ],
        get: (t) => String(t.utilization ?? 0),
        match: (t, v) => {
          const u = Number(t.utilization ?? 0)
          if (v === 'over') return u > 80
          if (v === 'normal') return u >= 40 && u <= 80
          return u < 40
        },
      },
    ],
  }), [techs])
  const techTf = useTableFilters(techs, techCfg)
  const visibleTechs = techTf.pagedRows

  const [rawTechs, setRawTechs] = useState<MaintenanceTechnician[]>([])

  const loadTechs = () => {
    maintenancePortalApi.technicians()
      .then(res => {
        const raw = res.data.technicians || []
        setRawTechs(raw)
        // An empty roster renders an empty state. Falling back to sample staff
        // showed eight people who do not work here.
        setTechs(raw.map(toTechView))
      })
      .catch(() => setTechs([]))
  }

  useEffect(() => {
    loadTechs()
    maintenanceShopApi.mine().then(res => {
      const cats = res.data?.shop?.serviceCategories
      if (Array.isArray(cats) && cats.length) {
        setAvailableRoles(prev => [...new Set([...cats, ...prev])])
      }
    }).catch(() => {})
  }, [])

  // ── Team & access (owner/admin only) ──────────────────────
  const [accessFor, setAccessFor] = useState<MaintenanceTechnician | null>(null)
  const [accessPerms, setAccessPerms] = useState<MaintenanceWorkerPermission[]>([])
  const [accessBusy, setAccessBusy] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const openAccess = (t: MaintenanceTechnician) => {
    setAccessFor(t)
    setAccessPerms(t.permissions || [])
    setInviteLink(null)
  }
  const closeAccess = () => setAccessFor(null)

  const togglePerm = (key: MaintenanceWorkerPermission) => {
    setAccessPerms(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  const buildInviteLink = (token: string) =>
    `${window.location.origin}${window.location.pathname}#/worker-invite/maint/${token}`

  const invite = async () => {
    if (!accessFor) return
    setAccessBusy(true)
    try {
      const res = await maintenancePortalApi.inviteTechnician(accessFor.id, accessPerms)
      loadTechs()
      if (res.data.devInviteToken) setInviteLink(buildInviteLink(res.data.devInviteToken))
      else { maintToast(`Invited ${accessFor.name}`); closeAccess() }
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not send invite', 'warn')
    } finally {
      setAccessBusy(false)
    }
  }

  const saveAccess = async () => {
    if (!accessFor) return
    setAccessBusy(true)
    try {
      await maintenancePortalApi.updateTechnicianAccess(accessFor.id, accessPerms)
      loadTechs()
      maintToast('Access updated')
      closeAccess()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not update access', 'warn')
    } finally {
      setAccessBusy(false)
    }
  }

  const [resendModal, setResendModal] = useState<{ name: string; link: string } | null>(null)

  const resendInvite = async (t: MaintenanceTechnician) => {
    try {
      const res = await maintenancePortalApi.resendTechnicianInvite(t.id)
      if (res.data.devInviteToken) {
        const link = buildInviteLink(res.data.devInviteToken)
        await copyText(link)
        setResendModal({ name: t.name, link })
        maintToast('New invite link copied to clipboard')
      } else {
        maintToast(`Invite resent to ${t.name}`)
      }
      loadTechs()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not resend invite', 'warn')
    }
  }

  const toggleAccountStatus = async (t: MaintenanceTechnician) => {
    try {
      await maintenancePortalApi.setTechnicianAccountStatus(t.id, t.accountStatus === 'active' ? 'disabled' : 'active')
      loadTechs()
      maintToast(t.accountStatus === 'active' ? `${t.name}'s access disabled` : `${t.name}'s access re-enabled`)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not update access', 'warn')
    }
  }

  const copyInviteLink = async () => {
    if (!inviteLink) return
    const ok = await copyText(inviteLink)
    maintToast(ok ? 'Invite link copied' : 'Could not copy — select and copy manually', ok ? 'success' : 'warn')
  }

  const accountBadge = (worker: MaintenanceTechnician) =>
    worker.approvalStatus === 'pending' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">{translatePortalText("⏳ Awaiting verification")}</span>
    : worker.approvalStatus === 'rejected' ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">{translatePortalText("✕ Rejected by admin")}</span>
    : worker.accountStatus === 'active' ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">{translatePortalText("Portal access")}</span>
    : worker.accountStatus === 'invited' ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200">{translatePortalText("Invite pending")}</span>
    : worker.accountStatus === 'pending_approval' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">{translatePortalText("Awaiting approval")}</span>
    : worker.accountStatus === 'disabled' ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">{translatePortalText("Access disabled")}</span>
    : null

  const approvedTechs = rawTechs.filter(t => t.approvalStatus === 'approved' || !t.approvalStatus)
  const pendingTechs = rawTechs.filter(t => t.approvalStatus === 'pending')
  const rejectedTechs = rawTechs.filter(t => t.approvalStatus === 'rejected')
  const onDuty = approvedTechs.filter(t => t.status === 'on_duty')
  const totalHours = techs.reduce((s, t) => s + t.hoursWeek, 0)
  const overtime = techs.reduce((s, t) => s + t.overtime, 0)
  const [view, setView] = useState<'card' | 'table'>('table')
  const { call, target, close } = useCall()
  const [assigned, setAssigned] = useState<null | any>(null)
  const [addTechOpen, setAddTechOpen] = useState(false)
  const [techBusy, setTechBusy] = useState(false)
  const createTechnician = useLimitAwareAction(maintenancePortalApi.createTechnician)
  const usage = usePackageUsage()
  /** Set when the modal is editing an existing technician rather than creating one. */
  const [editingTech, setEditingTech] = useState<MaintenanceTechnician | null>(null)
  const [techAvatarBusy, setTechAvatarBusy] = useState(false)

  const changeDutyStatus = async (tech: MaintenanceTechnician, newStatus: 'on_duty' | 'off_duty' | 'on_leave') => {
    if (tech.approvalStatus === 'pending') {
      maintToast('Technician is awaiting platform admin verification and cannot be placed on duty yet.', 'warn')
      return
    }
    if (tech.approvalStatus === 'rejected') {
      maintToast('Technician was rejected by admin. Please update qualifications or contact support.', 'warn')
      return
    }
    try {
      await maintenancePortalApi.updateTechnician(tech.id, { status: newStatus })
      maintToast(`${tech.name} shift updated to ${newStatus.replace('_', ' ')}`, 'success')
      loadTechs()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not change duty status', 'warn')
    }
  }

  /**
   * Uploads a real photo for a saved technician.
   *
   * Applies immediately rather than waiting for Save: it is its own multipart
   * endpoint, and `editingTech` is updated in place so the preview above swaps
   * to the new face without closing the dialog.
   */
  const uploadTechPhoto = async (id: string, file: File) => {
    setTechAvatarBusy(true)
    try {
      const r = await maintenancePortalApi.uploadTechnicianAvatar(id, file)
      setEditingTech(prev => (prev && prev.id === id ? { ...prev, avatar: r.data.technician.avatar } : prev))
      loadTechs()
      maintToast('Photo updated')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not upload that photo', 'warn')
    } finally {
      setTechAvatarBusy(false)
    }
  }
  const [techForm, setTechForm] = useState({
    name: '',
    phone: '',
    email: '',
    certs: '',
    mobile: false,
  })

  const [newTechPhotoFile, setNewTechPhotoFile] = useState<File | null>(null)
  const [newTechPhotoPreview, setNewTechPhotoPreview] = useState<string | null>(null)

  const [availableRoles, setAvailableRoles] = useState<string[]>(DEFAULT_ROLES)
  // Rate per selected role — the same role can bill differently per technician.
  const [roleRates, setRoleRates] = useState<Record<string, string>>({ 'Marine Mechanic': '85' })
  const [showAddRoleInput, setShowAddRoleInput] = useState(false)
  const [customRoleText, setCustomRoleText] = useState('')
  const selectedRoles = Object.keys(roleRates)

  const toggleRole = (r: string) => {
    setRoleRates(prev => {
      if (r in prev) { const next = { ...prev }; delete next[r]; return next }
      return { ...prev, [r]: DEFAULT_RATE }
    })
    // No skills to keep in step any more — the trades follow from the roles,
    // server-side, from each role's own definition.
  }
  const setRoleRate = (r: string, rate: string) => setRoleRates(prev => ({ ...prev, [r]: rate }))

  const handleAddNewRole = () => {
    const trimmed = customRoleText.trim()
    if (!trimmed) return
    if (!availableRoles.includes(trimmed)) setAvailableRoles(prev => [...prev, trimmed])
    setRoleRates(prev => (trimmed in prev ? prev : { ...prev, [trimmed]: DEFAULT_RATE }))
    setCustomRoleText('')
    setShowAddRoleInput(false)
    maintToast(`Added role "${trimmed}"`)
  }

  /**
   * What this technician is known for, in the workshop's own words.
   *
   * This replaces a "Skills & Service Categories" picker that had stopped doing
   * anything: skills are derived from the roles a technician holds, so the API
   * ignored whatever the picker sent while the form still demanded a selection.
   *
   * Tags are a different axis and are genuinely the workshop's to set — the
   * engine brand someone specialises in, a certification, a language. None of
   * those is expressible as a category, and a boater searching for them finds
   * this workshop by them.
   */
  const [tagDraft, setTagDraft] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase()
    if (tag.length < 2) return
    setTagDraft(prev => (prev.includes(tag) ? prev : [...prev, tag]))
    setTagInput('')
  }
  const removeTag = (tag: string) => setTagDraft(prev => prev.filter(t => t !== tag))

  /** The trades the picked roles add up to — shown, not chosen. */
  const derivedTrades = useMemo(() => {
    const keys = new Set<string>()
    for (const role of selectedRoles) {
      const mapped = ROLE_SKILL_MAP[role]
      if (mapped) keys.add(mapped)
    }
    return [...keys]
  }, [selectedRoles])

  const openAddTech = () => {
    setEditingTech(null)
    setNewTechPhotoFile(null)
    setNewTechPhotoPreview(null)
    setTechForm({ name: '', phone: '', email: '', certs: '', mobile: false })
    setTagDraft([])
    setTagInput('')
    const initialRole = availableRoles[0] || 'Inboard Engines'
    setRoleRates({ [initialRole]: DEFAULT_RATE })
    setAddTechOpen(true)
  }

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash === 'add-tech' || hash === 'technicians' || hash === 'staff') {
      const timer = setTimeout(() => openAddTech(), 250)
      return () => clearTimeout(timer)
    }
  }, [location.hash, availableRoles])

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.id === 'add-tech' || e.detail?.id === 'technicians' || e.detail?.id === 'staff') {
        openAddTech()
      }
    }
    window.addEventListener('boatpro-focus-field', handler)
    return () => window.removeEventListener('boatpro-focus-field', handler)
  }, [availableRoles])

  const openEditTech = (t: MaintenanceTechnician) => {
    setEditingTech(t)
    setNewTechPhotoFile(null)
    setNewTechPhotoPreview(null)
    setTechForm({
      name: t.name,
      phone: t.phone ?? '',
      email: t.email ?? '',
      certs: (t.certifications ?? []).join(', '),
      mobile: !!t.mobile,
    })
    setTagDraft(t.tags ?? [])
    setTagInput('')
    // Fall back to the legacy flat rate for technicians created before per-role rates.
    const existing = t.roles?.length
      ? Object.fromEntries(t.roles.map(r => [r.role, String(r.hourlyRate)]))
      : Object.fromEntries((t.role ? t.role.split(' · ') : []).map(r => [r.trim(), String(t.hourlyRate ?? DEFAULT_RATE)]))
    const initialRole = availableRoles[0] || 'Inboard Engines'
    setRoleRates(Object.keys(existing).length ? existing : { [initialRole]: DEFAULT_RATE })
    setAvailableRoles(prev => [...new Set([...prev, ...Object.keys(existing)])])
    setAddTechOpen(true)
  }

  const submitAddTech = async () => {
    if (!techForm.name.trim()) { maintToast('Technician name is required', 'warn'); return }
    if (selectedRoles.length === 0) { maintToast('Pick at least one role', 'warn'); return }
    const roles = selectedRoles.map(role => ({ role, hourlyRate: parseFloat(roleRates[role]) || 0 }))
    const payload = {
      name: techForm.name.trim(),
      roles,
      phone: techForm.phone.trim() || undefined,
      email: techForm.email.trim() || undefined,
      tags: tagDraft,
      certifications: techForm.certs.split(',').map(s => s.trim()).filter(Boolean),
      mobile: techForm.mobile,
    }
    setTechBusy(true)
    try {
      if (editingTech) {
        await maintenancePortalApi.updateTechnician(editingTech.id, payload)
        maintToast(`${techForm.name} updated`)
      } else {
        const created = await createTechnician.run({ ...payload, status: 'on_duty' })
        if (!created) return // package limit reached — the modal is showing and will retry this on resolution
        const createdId = (created as any)?.data?.technician?.id || (created as any)?.data?.technician?._id
        if (createdId && newTechPhotoFile) {
          try {
            await maintenancePortalApi.uploadTechnicianAvatar(createdId, newTechPhotoFile)
          } catch (err) {
            console.warn('Failed to upload photo for newly created tech:', err)
          }
        }
        await usage.reload()
        maintToast(`Technician ${techForm.name} added — awaiting admin approval`, 'info')
      }
      loadTechs()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      setAddTechOpen(false)
      setEditingTech(null)
      setNewTechPhotoFile(null)
      setNewTechPhotoPreview(null)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save technician', 'warn')
    } finally {
      setTechBusy(false)
    }
  }

  const autoAssign = () => {
    if (onDuty.length === 0) {
      maintToast('No approved on-duty technicians available for auto-assignment. Technicians must be approved by admin and on-duty.', 'warn')
      return
    }
    const approvedOnDuty = techs.filter(t => t.status === 'On duty')
    const picks = [...approvedOnDuty].sort((a, b) => a.utilization - b.utilization).slice(0, 4)
    const pickIds = new Set(picks.map(p => p.id))
    setTechs(ts => ts.map(t => pickIds.has(t.id) ? { ...t, jobsToday: t.jobsToday + 1, utilization: Math.min(100, t.utilization + 6) } : t))
    setAssigned(picks)
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Technicians & Labor")} sub="Skills, availability, assignment, hours, overtime & productivity" icon={<Users className="text-violet-500" />}
        actions={<>
          <MaintViewToggle view={view} onChange={setView} />
          <button className="btn-ghost" onClick={autoAssign}><WrenchIcon size={15} /> {translatePortalText("Auto-assign")}</button>
          <button className="btn-maint" onClick={openAddTech}><Plus size={15} /> {translatePortalText("Add technician")}</button>
        </>} />

      {usage.usage.some((u) => u.key === 'maxWorkers') && (
        <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-4">
          {usage.usage.filter((u) => u.key === 'maxWorkers').map((u) => <UsageMeter key={u.key} item={u} />)}
        </div>
      )}

      {/* Trades first: one has to exist before a technician can hold it, and a
          technician's skills are derived from the ones they hold. Reloading the
          roster on change keeps the skill chips below in step. */}
      <div className="mb-5">
        <RolesPanel onChanged={loadTechs} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { l: 'On duty', v: onDuty.length, s: translatePortalTemplate('{{count}} of {{total}} approved', { count: onDuty.length, total: approvedTechs.length }) },
          { l: 'Awaiting Admin', v: pendingTechs.length, s: translatePortalText(pendingTechs.length === 1 ? 'technician' : 'technicians') },
          { l: 'Labor hours · wk', v: totalHours, s: translatePortalText('logged') },
          { l: 'Avg utilization', v: Math.round(techs.reduce((s, t) => s + t.utilization, 0) / (techs.length || 1)), s: '%' }
        ].map((k, i) => (
          <motion.div key={k.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(k.l)}</p>
            <p className="mt-1 font-display text-2xl font-extrabold text-deep-900"><Counter value={k.v} /> <span className="text-xs font-semibold text-slate-400">{k.s === '%' && isPortalArabic() ? '٪' : k.s}</span></p>
          </motion.div>
        ))}
      </div>

      {pendingTechs.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 font-black shrink-0 text-base">⏳</span>
            <div>
              <p className="font-extrabold text-sm text-deep-900 dark:text-white">
                {translatePortalTemplate(
                  pendingTechs.length === 1
                    ? '{{count}} technician awaiting BoatPro Admin verification'
                    : '{{count}} technicians awaiting BoatPro Admin verification',
                  { count: pendingTechs.length },
                )}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {translatePortalText("Technicians cannot be placed on duty or assigned to active work orders until reviewed and approved by platform administration.")}
              </p>
            </div>
          </div>
          <span className="rounded-xl bg-amber-500/20 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            {translatePortalText("Awaiting Review")}
          </span>
        </div>
      )}

      <TableToolbar
        state={techTf}
        config={techCfg}
        rows={techs}
        noun="technicians"
        searchPlaceholder="Search technicians by name, role, skill or phone..."
      />

      {techs.length > 0 && visibleTechs.length === 0 && (
        <NoFilterMatches noun="technicians" onClear={techTf.clear} />
      )}

      <div className="grid gap-5 lg:grid-cols-1">
        <div>
          {view === 'card' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleTechs.map((t, i) => {
                const rawTech = rawTechs.find(r => r.id === t.id)
                const isApproved = !rawTech?.approvalStatus || rawTech.approvalStatus === 'approved'
                return (
                  <motion.div key={t.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card card-hover p-4">
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <img src={t.avatar} className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow-soft" />
                        {t.status === 'On duty' && <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-400" />}
                        {t.status === 'Pending Approval' && <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-amber-400" />}
                        {t.status === 'Rejected' && <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-rose-500" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-[15px] font-extrabold text-deep-900"><bdi dir="auto">{t.name}</bdi></p>
                        {rateSummary(rawTech) ? (
                          <p className="truncate text-[11px] font-semibold text-violet-600">{rateSummary(rawTech)}</p>
                        ) : (
                          <p className="truncate text-[11px] text-slate-400">{t.role ? translatePortalText(t.role) : translatePortalText("General maintenance")}</p>
                        )}
                        <div className="mt-0.5">
                          {t.rating > 0 ? (
                            <div className="flex items-center gap-1">
                              <Stars n={Math.round(t.rating)} size={11} />
                              <span className="text-[10px] font-bold text-amber-500">{formatPortalNumber(t.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400">{translatePortalText("No ratings yet")}</span>
                          )}
                        </div>
                      </div>
                      <MBadge>{t.status}</MBadge>
                    </div>

                    {rawTech?.approvalStatus === 'rejected' && rawTech.rejectionReason && (
                      <div className="mt-2.5 rounded-xl bg-rose-50/90 border border-rose-200 p-2.5 text-[11px] text-rose-700">
                        <p className="font-bold text-rose-800">{translatePortalText("Rejection note from Admin:")}</p>
                        <p className="mt-0.5">{localizedField(rawTech, 'rejectionReason') ?? rawTech.rejectionReason}</p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {t.skills.length > 0 ? (
                        t.skills.map(s => <span key={s} className="rounded-full bg-sand px-2 py-0.5 text-[10px] font-bold text-slate-500">{catByKey(s).icon} {translatePortalText(catChipLabel(s))}</span>)
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{translatePortalText("⚠ No skills set")}</span>
                      )}
                      {t.mobile && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{translatePortalText("📍 Mobile")}</span>}
                      {maintAccess?.isOwner && rawTech && accountBadge(rawTech)}
                    </div>

                    {/* Duty Shift Switcher for Approved Techs */}
                    {isApproved && rawTech && (
                      <div className="mt-2.5 flex items-center justify-between gap-1 border-t border-slate-100/80 pt-2 text-[11px]">
                        <span className="font-semibold text-slate-400">{translatePortalText("Shift:")}</span>
                        <div className="flex gap-1">
                          {(['on_duty', 'off_duty', 'on_leave'] as const).map(st => (
                            <button
                              key={st}
                              onClick={() => changeDutyStatus(rawTech, st)}
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold transition ${
                                rawTech.status === st
                                  ? st === 'on_duty'
                                    ? 'bg-emerald-500 text-white'
                                    : st === 'off_duty'
                                    ? 'bg-slate-500 text-white'
                                    : 'bg-amber-500 text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {st === 'on_duty' ? translatePortalText("On duty") : st === 'off_duty' ? translatePortalText("Off") : translatePortalText("Leave")}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-sand py-1.5"><p className="font-display text-sm font-extrabold text-deep-900">{formatPortalNumber(t.jobsToday)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Jobs")}</p></div>
                      <div className="rounded-lg bg-sand py-1.5"><p className="font-display text-sm font-extrabold text-deep-900">{formatPortalNumber(t.hoursWeek)}{translatePortalText("h")}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Week")}</p></div>
                      <div className="rounded-lg bg-sand py-1.5"><p className="font-display text-sm font-extrabold text-deep-900">{formatPortalNumber(t.overtime)}{translatePortalText("h")}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("OT")}</p></div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2"><JobProgress pct={t.utilization} /><span className="text-[10px] font-bold text-slate-400">{formatPortalPercent(t.utilization)}</span></div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-400">
                      <span className="truncate">{t.certs}</span>
                      <div className="flex shrink-0 gap-1.5">
                        {maintAccess?.isOwner && rawTech && (
                          <button title={translatePortalText("Edit technician & rates")} onClick={() => openEditTech(rawTech)} className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><Pencil size={13} /></button>
                        )}
                        {maintAccess?.isOwner && rawTech && (
                          <button title={translatePortalText("Team & access")} onClick={() => openAccess(rawTech)} className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><ShieldCheck size={13} /></button>
                        )}
                        {maintAccess?.isOwner && rawTech && (
                          <button title={translatePortalText("Resend Invite Link")} onClick={() => resendInvite(rawTech)} className="grid h-7 w-7 place-items-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100"><RotateCcw size={13} /></button>
                        )}
                        <button onClick={() => call({ name: t.name, avatar: t.avatar, role: t.role, phone: t.phone })} className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><Phone size={13} /></button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <div className="min-w-[1370px]">
                  <div className="grid grid-cols-[280px_200px_200px_90px_130px_130px_140px_200px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span>{translatePortalText("Technician")}</span><span>{translatePortalText("Role & Rate")}</span><span>{translatePortalText("Skills")}</span><span>{translatePortalText("Rating")}</span><span>{translatePortalText("Jobs / Hrs / OT")}</span><span>{translatePortalText("Utilization")}</span><span>{translatePortalText("Certs")}</span><span className="text-right">{translatePortalText("Actions")}</span>
                  </div>
                  {visibleTechs.map((t, i) => {
                    const rawTech = rawTechs.find(r => r.id === t.id)
                    const isApproved = !rawTech?.approvalStatus || rawTech.approvalStatus === 'approved'
                    return (
                      <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                        className="grid grid-cols-[280px_200px_200px_90px_130px_130px_140px_200px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                        <div className="flex items-center gap-3 min-w-0 pe-2">
                          <div className="relative shrink-0">
                            <img src={t.avatar} className="h-9 w-9 rounded-full object-cover ring-2 ring-white shadow-soft" />
                            {t.status === 'On duty' && <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />}
                            {t.status === 'Pending Approval' && <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber-400" />}
                            {t.status === 'Rejected' && <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white bg-rose-500" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{t.name}</bdi></p>
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              <MBadge>{t.status}</MBadge>
                              {maintAccess?.isOwner && rawTech && accountBadge(rawTech)}
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 pe-2">
                          {rateSummary(rawTech) ? (
                            <p className="truncate text-xs font-semibold text-violet-600">{rateSummary(rawTech)}</p>
                          ) : (
                            <p className="truncate text-xs text-slate-500">{t.role ? translatePortalText(t.role) : '—'}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 min-w-0">
                          {t.skills.length > 0 ? (
                            t.skills.map(s => <span key={s} className="shrink-0 rounded-full bg-sand px-2 py-0.5 text-[10px] font-bold text-slate-500">{catByKey(s).icon} {translatePortalText(catChipLabel(s))}</span>)
                          ) : (
                            <span className="text-xs font-bold text-amber-600">{translatePortalText("⚠ none")}</span>
                          )}
                        </div>
                        <div className="whitespace-nowrap">
                          {t.rating > 0 ? (
                            <div className="flex items-center gap-1">
                              <Stars n={Math.round(t.rating)} size={11} />
                              <span className="text-xs font-bold text-amber-500">{formatPortalNumber(t.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-slate-600 whitespace-nowrap">{formatPortalNumber(t.jobsToday)} / {formatPortalNumber(t.hoursWeek)}{isPortalArabic() ? ' س / ' : ' h / '}{formatPortalNumber(t.overtime)}{isPortalArabic() ? ' س' : ' h'}</div>
                        <div className="flex items-center gap-2 min-w-0"><JobProgress pct={t.utilization} /><span className="text-[10px] font-bold text-slate-400 shrink-0">{formatPortalPercent(t.utilization)}</span></div>
                        <div className="truncate text-xs text-slate-400">{t.certs}</div>
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          {isApproved && rawTech && (
                            <select
                              value={rawTech.status}
                              onChange={e => changeDutyStatus(rawTech, e.target.value as any)}
                              className="text-[10px] font-bold rounded-lg border border-slate-200 bg-white py-1 px-1.5 text-slate-700 cursor-pointer"
                            >
                              <option value="on_duty">{translatePortalText("On duty")}</option>
                              <option value="off_duty">{translatePortalText("Off duty")}</option>
                              <option value="on_leave">{translatePortalText("On leave")}</option>
                            </select>
                          )}
                          {maintAccess?.isOwner && rawTech && (
                            <button title={translatePortalText("Edit technician & rates")} onClick={() => openEditTech(rawTech)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><Pencil size={13} /></button>
                          )}
                          {maintAccess?.isOwner && rawTech && (
                            <button title={translatePortalText("Team & access")} onClick={() => openAccess(rawTech)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><ShieldCheck size={13} /></button>
                          )}
                          {maintAccess?.isOwner && rawTech && (
                            <button title={translatePortalText("Resend Invite Link")} onClick={() => resendInvite(rawTech)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100"><RotateCcw size={13} /></button>
                          )}
                          <button onClick={() => call({ name: t.name, avatar: t.avatar, role: t.role, phone: t.phone })} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><Phone size={13} /></button>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          <TablePagination state={techTf} noun="technicians" />
        </div>
      </div>

      <CallModal target={target} onClose={close} />

      <Modal open={!!resendModal} onClose={() => setResendModal(null)} title={resendModal ? `🔗 ${translatePortalText('Resend Invite Link')} — ${resendModal.name}` : ''}>
        {resendModal && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-deep-900">{translatePortalText("Invite link generated & copied to clipboard! Share this link with")} {resendModal.name}:</p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-sand px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate text-xs text-slate-600 font-mono">{resendModal.link}</code>
              <button onClick={() => { copyText(resendModal.link); maintToast('Copied invite link'); }} className="btn-ghost !p-2 shrink-0"><Copy size={15} /></button>
            </div>
            <button className="btn-maint w-full !justify-center" onClick={() => setResendModal(null)}>{translatePortalText("Done")}</button>
          </div>
        )}
      </Modal>

      <Modal open={!!accessFor} onClose={closeAccess} title={accessFor ? `🛡️ ${translatePortalText('Team & access')} — ${accessFor.name}` : ''} wide>
        {accessFor && (
          <div className="space-y-4">
            {inviteLink ? (
              <>
                <p className="text-sm font-semibold text-deep-900">{translatePortalText("Invite created — share this link with")} {accessFor.name}:</p>
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-sand px-3 py-2.5">
                  <code className="min-w-0 flex-1 truncate text-xs text-slate-600">{inviteLink}</code>
                  <button onClick={copyInviteLink} className="btn-ghost !p-2 shrink-0"><Copy size={15} /></button>
                </div>
                <p className="text-xs text-slate-400">{translatePortalText("No email provider is wired up yet, so the link isn't sent automatically — copy and send it yourself.")}</p>
                <button className="btn-maint w-full !justify-center" onClick={closeAccess}>{translatePortalText("Done")}</button>
              </>
            ) : !accessFor.email ? (
              <p className="text-sm text-slate-500">{translatePortalText("Add an email address for this technician before inviting them to the portal.")}</p>
            ) : accessFor.accountStatus === 'none' ? (
              <>
                <p className="text-sm text-slate-500">{translatePortalText("Grant page access, then invite")} {accessFor.name} {translatePortalText("to log in and manage their own jobs.")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {MAINTENANCE_WORKER_PERMISSIONS.map(key => (
                    <label key={key} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${accessPerms.includes(key) ? 'border-violet-300 bg-violet-50 text-deep-900' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      <input type="checkbox" checked={accessPerms.includes(key)} onChange={() => togglePerm(key)} className="h-4 w-4 shrink-0 rounded border-slate-300 accent-violet-500" />
                      {translatePortalText(MAINT_PERMISSION_LABELS[key] ?? key)}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400">{translatePortalText("They'll always be able to see and update their own assigned jobs — granting \"Work Orders\" additionally unlocks the full board (all jobs, reassign, edit costs).")}</p>
                <button className="btn-maint w-full !justify-center disabled:opacity-70" disabled={accessBusy} onClick={invite}>{accessBusy ? translatePortalText("Sending invite…") : translatePortalText("Send invite")}</button>
              </>
            ) : accessFor.accountStatus === 'invited' ? (
              <>
                <p className="text-sm text-slate-500">{translatePortalText("Invite sent — waiting for")} {accessFor.name} {translatePortalText("to set a password.")}</p>
                {accessFor.approvalStatus === 'pending' && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-700">{translatePortalText("Admin approval is also pending. The worker cannot enter the portal until both steps are complete.")}</p>}
                <button className="btn-ghost w-full !justify-center" onClick={() => resendInvite(accessFor)}>{translatePortalText("Resend invite")}</button>
              </>
            ) : accessFor.accountStatus === 'pending_approval' ? (
              <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-700">{translatePortalText("This worker accepted the invite and is waiting for an admin decision. Provider users cannot enable access themselves.")}</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {MAINTENANCE_WORKER_PERMISSIONS.map(key => (
                    <label key={key} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${accessPerms.includes(key) ? 'border-violet-300 bg-violet-50 text-deep-900' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      <input type="checkbox" checked={accessPerms.includes(key)} onChange={() => togglePerm(key)} className="h-4 w-4 shrink-0 rounded border-slate-300 accent-violet-500" />
                      {translatePortalText(MAINT_PERMISSION_LABELS[key] ?? key)}
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="btn-maint flex-1 !justify-center disabled:opacity-70" disabled={accessBusy} onClick={saveAccess}>{accessBusy ? translatePortalText("Saving…") : translatePortalText("Save access")}</button>
                  <button className={`btn-ghost flex-1 !justify-center ${accessFor.accountStatus === 'active' ? 'text-rose-500' : 'text-emerald-600'}`} onClick={() => toggleAccountStatus(accessFor)}>
                    {accessFor.accountStatus === 'active' ? translatePortalText("Disable access") : translatePortalText("Re-enable access")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!assigned} onClose={() => setAssigned(null)} title={translatePortalText("🤖 Auto-assignment complete")}>
        {assigned && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{formatPortalNumber(assigned.length)} {translatePortalText("job")}{assigned.length === 1 ? '' : translatePortalText("s")} {translatePortalText("matched to the least-loaded on-duty technicians.")}</p>
            <div className="space-y-2">
              {assigned.map(t => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
                  <img src={t.avatar} className="h-10 w-10 rounded-full object-cover" />
                      <div className="min-w-0 flex-1"><p className="text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{t.name}</bdi></p><p className="text-[11px] text-slate-400"><bdi dir="auto">{localizedField(t, 'role') ?? translatePortalText(t.role)}</bdi></p></div>
                  <CheckCircle2 size={18} className="text-emerald-500" />
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={addTechOpen} onClose={() => { setAddTechOpen(false); setEditingTech(null) }} title={editingTech ? `✏️ Edit ${editingTech.name}` : translatePortalText("➕ Add new technician")}>
        <div className="space-y-4">
          {/* Photo Section for both new and existing technician */}
          <div className="flex items-center gap-4 rounded-xl border border-slate-100 bg-sand/40 p-3.5">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-violet-100 ring-2 ring-white shadow-soft flex items-center justify-center">
              {editingTech?.avatar ? (
                <img src={editingTech.avatar} alt={editingTech.name} className="h-full w-full object-cover" />
              ) : newTechPhotoPreview ? (
                <img src={newTechPhotoPreview} alt={translatePortalText("Preview")} className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center font-bold text-violet-700">
                  {techForm.name ? techForm.name.slice(0, 2).toUpperCase() : '👨‍🔧'}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label className="btn-maint !py-1.5 !px-3 text-xs cursor-pointer inline-flex items-center gap-1.5">
                <Upload size={13} /> {techAvatarBusy ? translatePortalText("Uploading…") : (editingTech?.avatar || newTechPhotoPreview) ? translatePortalText("Change photo") : translatePortalText("Upload photo")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={techAvatarBusy}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    if (editingTech) {
                      void uploadTechPhoto(editingTech.id, file)
                    } else {
                      setNewTechPhotoFile(file)
                      setNewTechPhotoPreview(URL.createObjectURL(file))
                      maintToast('Photo selected — will be saved with technician profile', 'info')
                    }
                  }}
                />
              </label>
              <p className="mt-1 text-[11px] text-slate-400">
                {translatePortalText("Shown on work orders and customer service tracking.")}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">{translatePortalText("Full Name *")}</label>
            <input
              type="text"
              className="input w-full"
              placeholder={translatePortalText("e.g. Tariq Al-Mansoor")}
              value={techForm.name}
              onChange={e => setTechForm({ ...techForm, name: e.target.value })}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold uppercase text-slate-400">
                {translatePortalText("Technician Roles (Select multiple) *")}
              </label>
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 px-2 py-0.5 rounded-lg transition"
                onClick={() => setShowAddRoleInput(!showAddRoleInput)}
              >
                <Plus size={13} /> {translatePortalText("Add new role")}
              </button>
            </div>

            {showAddRoleInput && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-2.5 flex items-center gap-2 rounded-xl bg-violet-50/80 p-2 border border-violet-200"
              >
                <input
                  type="text"
                  className="input flex-1 py-1 text-xs bg-white"
                  placeholder={translatePortalText("Enter role title (e.g. Hydraulics Specialist)...")}
                  value={customRoleText}
                  onChange={e => setCustomRoleText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNewRole(); } }}
                />
                <button
                  type="button"
                  className="btn-maint py-1 px-3 text-xs"
                  onClick={handleAddNewRole}
                >
                  {translatePortalText("Add")}
                </button>
                <button
                  type="button"
                  className="btn-ghost py-1 px-2 text-xs"
                  onClick={() => setShowAddRoleInput(false)}
                >
                  {translatePortalText("Cancel")}
                </button>
              </motion.div>
            )}

            <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50/50 p-2.5">
              {availableRoles.map(r => {
                const active = selectedRoles.includes(r)
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRole(r)}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                      active
                        ? 'bg-violet-600 text-white shadow-sm ring-2 ring-violet-400/40'
                        : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span>{translatePortalText(r)}</span>
                    {active && <span className="text-[10px] font-extrabold opacity-90">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* One rate per role — labour on a job is billed at the rate of the
              role the technician is booked at, so each needs its own figure. */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">{translatePortalText("Hourly rate per role (SAR)")}</label>
            {selectedRoles.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                {translatePortalText("Pick at least one role above to set its rate.")}
              </p>
            ) : (
              <div className="space-y-1.5">
                {selectedRoles.map(r => (
                  <div key={r} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-deep-900">{translatePortalText(r)}</span>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      className="input !w-28 !py-1.5"
                      placeholder={DEFAULT_RATE}
                      value={roleRates[r] ?? ''}
                      onChange={e => setRoleRate(r, e.target.value)}
                    />
                    <span className="text-[11px] font-semibold text-slate-400">{translatePortalText("/hr")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Trades — shown, not chosen: they follow from the roles above. */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">{translatePortalText("Trades covered")}</label>
            {derivedTrades.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50/50 p-2.5">
                {derivedTrades.map(key => {
                  const cat = catByKey(key)
                  return (
                    <span key={key} className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-slate-600 border border-slate-200">
                      <span>{cat.icon}</span>
                      <span>{translatePortalText(cat.name)}</span>
                    </span>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 p-3 text-[11px] text-slate-400">
                {translatePortalText("These follow from the roles you pick above — each trade you define carries its own category.")}
              </p>
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText("Set on the trade itself, not here, so a technician's trades and their roles can never disagree.")}
            </p>
          </div>

          {/* Tags — the workshop's own words for what this person is known for. */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-bold uppercase text-slate-400">{translatePortalText("Known for")}</label>
              <span className="text-[11px] font-semibold text-violet-600">{formatPortalNumber(tagDraft.length)} {translatePortalText("tag")}{tagDraft.length === 1 ? '' : translatePortalText("s")}</span>
            </div>
            <p className="mb-2 text-[11px] text-slate-400">
              {translatePortalText("What a boat owner might search for to find this person — an engine brand, a certification, a\r\n              language. Press Enter after each.")}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/50 p-2.5">
              {tagDraft.map(tag => (
                <span key={tag} className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-bold text-white">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="opacity-80 hover:opacity-100" title={`${translatePortalText("Remove")} ${tag}`}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                className="min-w-[9rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-slate-400"
                placeholder={translatePortalText(tagDraft.length === 0 ? 'yamaha, volvo penta, warranty work…' : 'Add another…')}
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
                  // Backspace on an empty box removes the last tag, which is how
                  // every other tag input behaves.
                  else if (e.key === 'Backspace' && !tagInput && tagDraft.length) removeTag(tagDraft[tagDraft.length - 1])
                }}
                onBlur={() => addTag(tagInput)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">{translatePortalText("Phone")}</label>
            <input
              type="text"
              className="input w-full"
              placeholder={translatePortalText("+966 50 123 4567")}
              value={techForm.phone}
              onChange={e => setTechForm({ ...techForm, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">{translatePortalText("Email")}</label>
            <input
              type="email"
              className="input w-full"
              placeholder={translatePortalText("tech@marina.com")}
              value={techForm.email}
              onChange={e => setTechForm({ ...techForm, email: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">{translatePortalText("Certifications")}</label>
            <input
              type="text"
              className="input w-full"
              placeholder={translatePortalText("ABYC Certified, Yamaha Master Tech")}
              value={techForm.certs}
              onChange={e => setTechForm({ ...techForm, certs: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="mobileTech"
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              checked={techForm.mobile}
              onChange={e => setTechForm({ ...techForm, mobile: e.target.checked })}
            />
            <label htmlFor="mobileTech" className="text-xs font-semibold text-deep-900 cursor-pointer">
              {translatePortalText("📍 Mobile dispatch technician (available for dockside calls)")}
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button className="btn-ghost" onClick={() => { setAddTechOpen(false); setEditingTech(null) }}>{translatePortalText("Cancel")}</button>
            <button className="btn-maint" disabled={techBusy} onClick={submitAddTech}>
              {techBusy ? translatePortalText("Saving...") : editingTech ? translatePortalText("Save changes") : translatePortalText("Add Technician")}
            </button>
          </div>
        </div>
      </Modal>

      {createTechnician.modal}
    </PageWrap>
  )
}

// ══════════ PARTS & INVENTORY (§11, §12) ══════════
export function MaintParts({ defaultTab }: { defaultTab?: 'Parts' | 'Tools' | 'Suppliers' | 'Services' } = {}) {
  return <PartsPage defaultTab={defaultTab} />
}
interface PO { id: string; partName: string; qty: number; supplier: string; status: 'Ordered' | 'Received' }
function PartsPage({ defaultTab }: { defaultTab?: 'Parts' | 'Tools' | 'Suppliers' | 'Services' }) {
  const location = useLocation()
  const [tab, setTab] = useState<'Parts' | 'Tools' | 'Suppliers' | 'Services'>(() => defaultTab || (location.pathname.includes('/services') ? 'Services' : 'Parts'))
  const [scan, setScan] = useState(false)
  const [scanQuery, setScanQuery] = useState('')
  const [scanResult, setScanResult] = useState<Part | null | 'none'>(null)
  const [view, setView] = useState<'card' | 'table'>('table')
  const [parts, setParts] = useState<Part[]>([])

  const partCfg: TableFiltersConfig<Part> = useMemo(() => ({
    searchFields: (p) => [p.name, p.sku, p.supplier, p.location, p.barcode],
    filters: [
      { key: 'cat', label: 'Category', get: (p) => p.cat },
      { key: 'supplier', label: 'Supplier', get: (p) => p.supplier },
      { key: 'location', label: 'Location', get: (p) => p.location },
      {
        key: 'stock',
        label: 'Stock level',
        options: [
          { value: 'out', label: 'Out of stock' },
          { value: 'low', label: 'At or below minimum' },
          { value: 'ok', label: 'In stock' },
        ],
        // The reason anyone opens this table is usually "what do I need to reorder".
        get: (p) => (p.stock <= 0 ? 'out' : p.stock <= p.min ? 'low' : 'ok'),
      },
    ],
  }), [])
  const partTf = useTableFilters(parts, partCfg)
  const visibleParts = partTf.pagedRows

  const [addPartOpen, setAddPartOpen] = useState(false)
  const [partBusy, setPartBusy] = useState(false)
  const [partForm, setPartForm] = useState({
    name: '',
    sku: '',
    cat: 'engine',
    stock: '15',
    min: '5',
    price: '45.00',
    supplier: 'Parker Hannifin Marine',
    location: 'Shelf A-04',
  })

  const loadParts = () => {
    maintenancePortalApi.parts()
      .then(res => setParts((res.data.parts || []).map(toPartView)))
      .catch(err => maintToast(err instanceof Error ? err.message : 'Could not load parts', 'warn'))
  }

  const [tools, setTools] = useState<MaintenanceTool[]>([])
  const [addToolOpen, setAddToolOpen] = useState(false)
  const [toolBusy, setToolBusy] = useState(false)
  const loadTools = () => {
    maintenancePortalApi.tools()
      .then(res => setTools(res.data.tools || []))
      .catch(() => maintToast('Could not load tools & equipment', 'warn'))
  }
  const submitAddTool = async (body: { name: string; kind: MaintenanceTool['kind'] }) => {
    setToolBusy(true)
    try {
      await maintenancePortalApi.createTool(body)
      loadTools()
      setAddToolOpen(false)
      maintToast(`${body.name} added`)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not add tool', 'warn')
    } finally {
      setToolBusy(false)
    }
  }
  /**
   * Moves a tool between statuses, and puts it back if the server refuses.
   *
   * The previous version applied the change locally and then swallowed any
   * failure outright — `catch { /* local state already updated *\/ }` — as
   * though the optimistic write were a reason not to care. It is the reason to
   * care: the row went on showing the new status while the database kept the
   * old one, with no toast and nothing to undo. A tool shown as available that
   * is actually out of service sends a technician to a job without the
   * equipment for it, and the screen agrees with them the whole way.
   *
   * So the previous status is captured first and restored on failure, and the
   * refusal is reported.
   */
  const setToolStatus = async (t: MaintenanceTool, status: MaintenanceTool['status']) => {
    const previous = t.status
    setTools(ts => ts.map(x => (x.id === t.id ? { ...x, status } : x)))
    try {
      await maintenancePortalApi.updateTool(t.id, { status })
    } catch (e) {
      setTools(ts => ts.map(x => (x.id === t.id ? { ...x, status: previous } : x)))
      maintToast(e instanceof Error ? e.message : `${translatePortalText("Could not update")} ${toolDisplayName(t)}`, 'warn')
    }
  }
  const removeTool = async (t: MaintenanceTool) => {
    try { await maintenancePortalApi.deleteTool(t.id); setTools(ts => ts.filter(x => x.id !== t.id)); maintToast(`${toolDisplayName(t)} ${translatePortalText("removed")}`) }
    catch (e) { maintToast(e instanceof Error ? e.message : 'Could not remove tool', 'warn') }
  }

  const [suppliers, setSuppliers] = useState<MaintenanceSupplier[]>([])
  const [addSupplierOpen, setAddSupplierOpen] = useState(false)
  const [supplierBusy, setSupplierBusy] = useState(false)
  const loadSuppliers = () => {
    maintenancePortalApi.suppliers()
      .then(res => setSuppliers(res.data.suppliers || []))
      .catch(() => maintToast('Could not load suppliers', 'warn'))
  }
  const submitAddSupplier = async (body: { name: string; contactName?: string; phone?: string; partsCategories: string[]; leadTimeDays: number }) => {
    setSupplierBusy(true)
    try {
      await maintenancePortalApi.createSupplier(body)
      loadSuppliers()
      setAddSupplierOpen(false)
      maintToast(`${body.name} added`)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not add supplier', 'warn')
    } finally {
      setSupplierBusy(false)
    }
  }
  const removeSupplier = async (s: MaintenanceSupplier) => {
    try { await maintenancePortalApi.deleteSupplier(s.id); setSuppliers(ss => ss.filter(x => x.id !== s.id)); maintToast(`${s.name} removed`) }
    catch (e) { maintToast(e instanceof Error ? e.message : 'Could not remove supplier', 'warn') }
  }

  // Service catalogue — the shop's own advertised service menu (name/category/
  // price), distinct from a customer's request or an assigned work order.
  const [services, setServices] = useState<MaintenanceServiceCatalogItem[]>([])
  const [addServiceOpen, setAddServiceOpen] = useState(false)
  const [serviceBusy, setServiceBusy] = useState(false)
  const loadServices = () => {
    maintenancePortalApi.serviceCatalogue()
      .then(res => setServices(res.data.items || []))
      .catch(() => maintToast('Could not load the service catalogue', 'warn'))
  }
  const submitAddService = async (body: { name: string; category: string; priceFrom: number; turnaroundLabel?: string }) => {
    setServiceBusy(true)
    try {
      await maintenancePortalApi.createServiceCatalogueItem(body)
      loadServices()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      setAddServiceOpen(false)
      maintToast(`${body.name} added to your service menu`, 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not add service', 'warn')
    } finally {
      setServiceBusy(false)
    }
  }
  const toggleServiceStatus = async (svc: MaintenanceServiceCatalogItem) => {
    const status = svc.status === 'active' ? 'paused' : 'active'
    setServices(ss => ss.map(x => x.id === svc.id ? { ...x, status } : x))
    try {
      await maintenancePortalApi.updateServiceCatalogueItem(svc.id, { status })
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
    } catch { /* local state already updated */ }
  }
  const removeService = async (svc: MaintenanceServiceCatalogItem) => {
    try {
      await maintenancePortalApi.deleteServiceCatalogueItem(svc.id)
      setServices(ss => ss.filter(x => x.id !== svc.id))
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      maintToast(`${svc.name} removed`)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not remove service', 'warn')
    }
  }

  const focusTarget = useCallback((id: string) => {
    if (id === 'catalog' || id === 'services' || id === 'pricing' || id === 'add-service') {
      setTab('Services')
      setAddServiceOpen(true)
    }
  }, [])

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash === 'catalog' || hash === 'services' || hash === 'pricing') {
      setTab('Services')
      const timer = setTimeout(() => setAddServiceOpen(true), 250)
      return () => clearTimeout(timer)
    }
    if (defaultTab) {
      setTab(defaultTab)
    }
  }, [location.hash, defaultTab])

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.id === 'catalog' || e.detail?.id === 'services' || e.detail?.id === 'pricing') {
        focusTarget(e.detail.id)
      }
    }
    window.addEventListener('boatpro-focus-field', handler)
    return () => window.removeEventListener('boatpro-focus-field', handler)
  }, [focusTarget])

  useEffect(() => { loadParts(); loadTools(); loadSuppliers(); loadServices() }, [])

  const openAddPart = (initialSku?: string) => {
    setPartForm(s => ({ ...s, sku: initialSku || s.sku || '' }))
    setAddPartOpen(true)
  }

  const submitAddPart = async () => {
    if (!partForm.name.trim() || !partForm.sku.trim()) {
      maintToast('Part name and SKU/Barcode are required', 'warn')
      return
    }
    setPartBusy(true)
    try {
      await maintenancePortalApi.createPart({
        name: partForm.name.trim(),
        sku: partForm.sku.trim().toUpperCase(),
        category: partForm.cat,
        stock: parseInt(partForm.stock, 10) || 0,
        minimumStock: parseInt(partForm.min, 10) || 0,
        unitCost: parseFloat(partForm.price) || 0,
        supplier: partForm.supplier.trim() || undefined,
        location: partForm.location.trim() || undefined,
      })
      maintToast(`Part ${partForm.name} added to inventory`)
      setAddPartOpen(false)
      setPartForm({ name: '', sku: '', cat: 'engine', stock: '15', min: '5', price: '45.00', supplier: 'Parker Hannifin Marine', location: 'Shelf A-04' })
      loadParts()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not add part', 'warn')
    } finally {
      setPartBusy(false)
    }
  }

  const adjustStock = async (partId: string, delta: number) => {
    const part = parts.find(p => p.id === partId)
    if (!part) return
    const newStock = Math.max(0, part.stock + delta)
    setParts(ps => ps.map(p => p.id === partId ? { ...p, stock: newStock } : p))
    try {
      await maintenancePortalApi.updatePart(partId, { stock: newStock })
      maintToast(`Stock updated: ${part.name} is now ${newStock}`, 'info')
    } catch {
      // state already updated locally for smoothness
    }
  }

  const [poOpen, setPoOpen] = useState(false)
  const [poPart, setPoPart] = useState(parts[0]?.id ?? '')
  const [poQty, setPoQty] = useState(10)
  const [pos, setPOs] = useState<PO[]>([])
  const [poSeq, setPoSeq] = useState(221)
  const low = parts.filter(p => p.stock <= p.min)

  const doScan = () => {
    const q = scanQuery.trim().toLowerCase()
    if (!q) return
    const found = parts.find(p => p.barcode.replace(/\s/g, '').includes(q.replace(/\s/g, '')) || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    setScanResult(found ?? 'none')
  }
  const reserve = (id: string) => setParts(ps => ps.map(p => p.id === id ? { ...p, stock: Math.max(0, p.stock - 1) } : p))
  const placePO = (part: Part, qty: number) => {
    const id = `PO-${poSeq}`; setPoSeq(s => s + 1)
    setPOs(ps => [{ id, partName: part.name, qty, supplier: part.supplier, status: 'Ordered' }, ...ps])
  }
  const reorder = (p: Part) => placePO(p, Math.max(p.min * 2 - p.stock, p.min))
  const receivePO = (id: string) => {
    setPOs(ps => ps.map(po => po.id === id ? { ...po, status: 'Received' } : po))
    const po = pos.find(p => p.id === id)
    if (po) setParts(ps => ps.map(p => p.name === po.partName ? { ...p, stock: p.stock + po.qty } : p))
  }
  const submitPO = () => {
    const part = parts.find(p => p.id === poPart)
    if (!part) return
    placePO(part, poQty)
    setPoOpen(false)
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Parts & Inventory")} sub="Spare parts catalog, stock levels, tools, equipment & suppliers" icon={<Package className="text-violet-500" />}
        actions={<>
          <MaintViewToggle view={view} onChange={setView} />
          <button className="btn-ghost" onClick={() => { setScan(true); setScanQuery(''); setScanResult(null) }}><ScanLine size={15} /> {translatePortalText("Scan barcode")}</button>
          <button className="btn-ghost" onClick={() => openAddPart()}><Plus size={15} /> {translatePortalText("Add part")}</button>
          <button className="btn-maint" onClick={() => setPoOpen(true)}><Plus size={15} /> {translatePortalText("Purchase order")}</button>
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[{ l: 'Parts in catalog', v: parts.length, i: '📦' }, { l: 'Low / out of stock', v: low.length, i: '⚠️' }, { l: 'Tools & equipment', v: tools.length, i: '🛠️' }, { l: 'Suppliers', v: suppliers.length, i: '🏭' }].map((k, i) => (
          <motion.div key={k.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 flex items-center gap-3">
            <span className="text-2xl">{k.i}</span>
            <div><p className="font-display text-2xl font-extrabold text-deep-900"><Counter value={k.v} /></p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(k.l)}</p></div>
          </motion.div>
        ))}
      </div>

      <div className="mb-4 flex gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft w-fit">
        {(['Parts', 'Tools', 'Suppliers', 'Services'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`relative rounded-xl px-4 py-2 text-[13px] font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {tab === t && <motion.span layoutId="parts-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500" />}
            <span className="relative z-10">{translatePortalText(t)}</span>
          </button>
        ))}
      </div>

      {tab === 'Parts' && parts.length > 0 && (
        <TableToolbar state={partTf} config={partCfg} rows={parts} noun="parts"
          searchPlaceholder="Search parts by name, SKU, supplier or location..." />
      )}
      {tab === 'Parts' && parts.length > 0 && visibleParts.length === 0 && (
        <NoFilterMatches noun="parts" onClear={partTf.clear} />
      )}
      {tab === 'Parts' && (view === 'table' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1050px]">
              <div className="grid grid-cols-[280px_180px_130px_130px_170px_160px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Part")}</span><span>{translatePortalText("SKU · Location")}</span><span>{translatePortalText("Stock")}</span><span>{translatePortalText("Price")}</span><span>{translatePortalText("Supplier")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {visibleParts.map((p, i) => {
                const c = catByKey(p.cat); const lo = p.stock <= p.min
                return (
                  <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-[280px_180px_130px_130px_170px_160px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                      <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{p.name}</p><p className="font-mono text-[10px] text-slate-400">{p.barcode}</p></div>
                    </div>
                    <div className="text-xs text-slate-500 min-w-0"><p className="font-mono font-semibold">{p.sku}</p><p className="text-[11px] text-slate-400">📍 {p.location}</p></div>
                    <div className="whitespace-nowrap"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-extrabold ${lo ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>{formatPortalNumber(p.stock)}</span><span className="ms-1 text-[10px] text-slate-400">/ {formatPortalNumber(p.min)}</span></div>
                    <div className="text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{money(p.price)}</div>
                    <div className="truncate text-xs text-slate-500">{p.supplier}</div>
                    <div className="flex justify-end gap-1.5 whitespace-nowrap">
                      <button onClick={() => reserve(p.id)} className="btn-ghost !py-1 !px-2 !text-[11px]">{translatePortalText("Reserve")}</button>
                      {lo && <button onClick={() => reorder(p)} className="btn-maint !py-1 !px-2 !text-[11px]">{translatePortalText("Reorder")}</button>}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleParts.map((p, i) => {
            const c = catByKey(p.cat); const lo = p.stock <= p.min
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card card-hover p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{p.name}</p>
                    <p className="font-mono text-[10px] text-slate-400">{p.barcode}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-extrabold ${lo ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>{formatPortalNumber(p.stock)}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("SKU")}</p><p className="font-mono font-semibold text-deep-800">{p.sku}</p></div>
                  <div><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Location")}</p><p className="font-semibold text-deep-800">📍 {p.location}</p></div>
                  <div><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Stock / Min")}</p><p className="font-semibold text-deep-800">{formatPortalNumber(p.stock)} / {formatPortalNumber(p.min)}</p></div>
                  <div><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Price")}</p><p className="font-semibold text-deep-800">{money(p.price)}</p></div>
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <span className="truncate text-[11px] text-slate-400">{p.supplier}</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => reserve(p.id)} className="btn-ghost !py-1 !px-2 !text-[11px]">{translatePortalText("Reserve")}</button>
                    {lo && <button onClick={() => reorder(p)} className="btn-maint !py-1 !px-2 !text-[11px]">{translatePortalText("Reorder")}</button>}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      ))}
      {tab === 'Parts' && <TablePagination state={partTf} noun="parts" />}

      {tab === 'Tools' && (
        <>
          <div className="mb-3 flex justify-end"><button className="btn-maint" onClick={() => setAddToolOpen(true)}><Plus size={15} /> {translatePortalText("Add tool")}</button></div>
          {tools.length === 0 && <p className="py-6 text-center text-xs text-slate-400">{translatePortalText("No tools or equipment on record yet.")}</p>}
          {view === 'card' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t, i) => (
                <motion.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-lg">{t.kind === 'equipment' ? '🔬' : '🔧'}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{toolDisplayName(t)}</bdi></p><p className="text-[11px] text-slate-400">{translatePortalText(TOOL_KIND_LABEL[t.kind])}{t.lastCalibratedAt ? ` · ${translatePortalText("calibrated")} ${fmtDate(t.lastCalibratedAt)}` : ''}</p></div>
                    <button title={translatePortalText("Remove")} onClick={() => removeTool(t)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <select className="input !w-auto !py-1 !text-[11px]" value={t.status} onChange={e => setToolStatus(t, e.target.value as MaintenanceTool['status'])}>
                      {(['available', 'in_use', 'calibration_due', 'lost'] as const).map(s => <option key={s} value={s}>{translatePortalText(TOOL_STATUS_LABEL[s])}</option>)}
                    </select>
                    {t.assignee?.name && <span className="text-[11px] text-slate-400">{translatePortalText("Assigned to")} <bdi dir="auto">{t.assignee.name}</bdi></span>}
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <div className="min-w-[950px]">
                  <div className="grid grid-cols-[240px_140px_160px_150px_160px_60px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span>{translatePortalText("Tool")}</span><span>{translatePortalText("Kind")}</span><span>{translatePortalText("Last calibration")}</span><span>{translatePortalText("Status")}</span><span>{translatePortalText("Assignee")}</span><span></span>
                  </div>
                  {tools.map((t, i) => (
                    <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[240px_140px_160px_150px_160px_60px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-base">{t.kind === 'equipment' ? '🔬' : '🔧'}</span>
                        <p className="truncate text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{toolDisplayName(t)}</bdi></p>
                      </div>
                      <div className="text-xs text-slate-500 whitespace-nowrap">{translatePortalText(TOOL_KIND_LABEL[t.kind])}</div>
                      <div className="text-xs text-slate-500 whitespace-nowrap">{t.lastCalibratedAt ? fmtDate(t.lastCalibratedAt) : '—'}</div>
                      <div>
                        <select className="input !w-auto !py-1 !text-[11px]" value={t.status} onChange={e => setToolStatus(t, e.target.value as MaintenanceTool['status'])}>
                          {(['available', 'in_use', 'calibration_due', 'lost'] as const).map(s => <option key={s} value={s}>{translatePortalText(TOOL_STATUS_LABEL[s])}</option>)}
                        </select>
                      </div>
                      <div className="truncate text-xs text-slate-400">{t.assignee?.name ? <>{translatePortalText("Assigned to")} <bdi dir="auto">{t.assignee.name}</bdi></> : '—'}</div>
                      <div className="flex justify-end"><button title={translatePortalText("Remove")} onClick={() => removeTool(t)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button></div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'Suppliers' && (
        <>
          <div className="mb-3 flex justify-end"><button className="btn-maint" onClick={() => setAddSupplierOpen(true)}><Plus size={15} /> {translatePortalText("Add supplier")}</button></div>
          {suppliers.length === 0 && <p className="py-6 text-center text-xs text-slate-400">{translatePortalText("No suppliers on record yet.")}</p>}
          {view === 'card' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((s, i) => (
                <motion.div key={s.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card card-hover p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-lg">🏭</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-extrabold text-deep-900">{s.name}</p><p className="text-[11px] text-slate-400">{s.contactName || '—'} · {s.phone || '—'}</p></div>
                    <button title={translatePortalText("Remove")} onClick={() => removeSupplier(s)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-xs">
                    <span className="text-slate-500">{supplierCategories(s).join(', ') || '—'}</span><Stars n={s.rating} size={11} />
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    <span>{translatePortalText("Lead")} {s.leadTimeDays}{translatePortalText("d")}</span><span>{translatePortalText("Last order")} {fmtDate(s.lastOrderAt)}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <div className="min-w-[1050px]">
                  <div className="grid grid-cols-[240px_180px_200px_110px_110px_130px_50px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span>{translatePortalText("Supplier")}</span><span>{translatePortalText("Contact")}</span><span>{translatePortalText("Parts supplied")}</span><span>{translatePortalText("Rating")}</span><span>{translatePortalText("Lead time")}</span><span>{translatePortalText("Last order")}</span><span></span>
                  </div>
                  {suppliers.map((s, i) => (
                    <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[240px_180px_200px_110px_110px_130px_50px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-base">🏭</span>
                        <p className="truncate text-[13px] font-extrabold text-deep-900">{s.name}</p>
                      </div>
                      <div className="truncate text-xs text-slate-500">{s.contactName || '—'} · {s.phone || '—'}</div>
                      <div className="truncate text-xs text-slate-500">{supplierCategories(s).join(', ') || '—'}</div>
                      <div className="whitespace-nowrap"><Stars n={s.rating} size={11} /></div>
                      <div className="text-xs text-slate-500 whitespace-nowrap">{s.leadTimeDays}{translatePortalText("d")}</div>
                      <div className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(s.lastOrderAt)}</div>
                      <div className="flex justify-end"><button title={translatePortalText("Remove")} onClick={() => removeSupplier(s)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button></div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'Services' && (
        <>
          <div className="mb-3 flex justify-end"><button className="btn-maint" onClick={() => setAddServiceOpen(true)}><Plus size={15} /> {translatePortalText("Add service")}</button></div>
          {services.length === 0 && <p className="py-6 text-center text-xs text-slate-400">{translatePortalText("Your service menu is empty — add what your shop offers so customers can see it.")}</p>}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <div className="min-w-[1050px]">
                <div className="grid grid-cols-[240px_160px_110px_130px_110px_110px_110px_50px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span>{translatePortalText("Service")}</span><span>{translatePortalText("Category")}</span><span>{translatePortalText("From")}</span><span>{translatePortalText("Turnaround")}</span><span>{translatePortalText("Jobs done")}</span><span>{translatePortalText("Rating")}</span><span>{translatePortalText("Status")}</span><span></span>
                </div>
                {services.map((svc, i) => {
                  const c = catByKey(svc.category === 'navigation' ? 'nav' : svc.category)
                  return (
                    <motion.div key={svc.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[240px_160px_110px_130px_110px_110px_110px_50px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                        <p className="truncate text-[13px] font-extrabold text-deep-900">{localizedField(svc, 'name') ?? svc.name}</p>
                      </div>
                      <div className="truncate text-xs text-slate-500">{serviceCategoryLabel(svc.category)}</div>
                      <div className="text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{money(svc.priceFrom)}</div>
                      <div className="truncate text-xs text-slate-500">{localizedField(svc, 'turnaroundLabel') || '—'}</div>
                      <div className="text-xs font-semibold text-slate-500 whitespace-nowrap">{svc.jobsCompletedCount}</div>
                      <div className="whitespace-nowrap"><Stars n={Math.round(svc.rating)} size={11} /></div>
                      <div className="whitespace-nowrap">
                        <button onClick={() => toggleServiceStatus(svc)} className={`chip ${svc.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {svc.status === 'active' ? translatePortalText("Active") : translatePortalText("Paused")}
                        </button>
                      </div>
                      <div className="flex justify-end"><button title={translatePortalText("Remove")} onClick={() => removeService(svc)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button></div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {pos.length > 0 && (
        <Section title={translatePortalText("Purchase orders")} sub={translatePortalText("Placed orders awaiting receipt")} className="mt-5">
          <div className="space-y-2">
            {pos.map(po => (
              <div key={po.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-xs">
                <span className="font-mono font-extrabold text-deep-900">{po.id}</span>
                <span className="text-slate-500">{po.partName} × {po.qty}</span>
                <span className="text-slate-400">{po.supplier}</span>
                <span className="ms-auto"><MBadge dot={po.status === 'Ordered'}>{po.status}</MBadge></span>
                {po.status === 'Ordered' && <button onClick={() => receivePO(po.id)} className="btn-ghost !py-1 !px-2 !text-[11px]">{translatePortalText("Mark received")}</button>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Modal open={scan} onClose={() => setScan(false)} title={translatePortalText("📷 Scan barcode / QR Scanner")}>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative h-48 w-64 overflow-hidden rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50">
            <motion.div initial={{ top: 0 }} animate={{ top: '100%' }} transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }} className="absolute start-0 end-0 h-0.5 bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.8)]" />
            <div className="grid h-full place-items-center text-center">
              <ScanLine size={48} className="mx-auto text-violet-700 dark:text-violet-400" />
              <p className="mt-1 text-[11px] font-semibold text-violet-600">{translatePortalText("Scan or type SKU / Barcode below")}</p>
            </div>
          </div>
          <div className="flex w-full gap-2">
            <input value={scanQuery} onChange={e => setScanQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doScan()}
              placeholder={translatePortalText("Enter or scan barcode / SKU / name…")} className="input flex-1" autoFocus />
            <button onClick={doScan} className="btn-maint !px-3.5"><Search size={15} /> {translatePortalText("Search")}</button>
          </div>
          {scanResult === 'none' && (
            <div className="w-full rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-center space-y-2">
              <p className="text-xs font-bold text-rose-700">{translatePortalText("No matching part found for \"")}{scanQuery}"</p>
              <p className="text-[11px] text-slate-500">{translatePortalText("Would you like to register this SKU/barcode into your inventory?")}</p>
              <button onClick={() => { const q = scanQuery; setScan(false); openAddPart(q); }} className="btn-maint !py-1.5 !px-3 text-xs">
                {translatePortalText("+ Add \"")}{scanQuery}{translatePortalText("\" as new part")}
              </button>
            </div>
          )}
          {scanResult && scanResult !== 'none' && (
            <div className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{scanResult.name}</bdi></p>
                  <p className="font-mono text-xs font-semibold text-slate-500">{translatePortalText("SKU:")} {scanResult.sku} {translatePortalText("· Location: 📍")} {scanResult.location}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-extrabold text-emerald-800">{translatePortalText("In Stock:")} {formatPortalNumber(scanResult.stock)}</span>
              </div>
              <p className="text-xs text-slate-600">{translatePortalText("Supplier:")} {scanResult.supplier} {translatePortalText("· Price:")} {money(scanResult.price)}</p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { reserve(scanResult.id); setScan(false) }} className="btn-ghost flex-1 !py-1.5 text-xs">
                  {translatePortalText("Reserve (-1 Stock)")}
                </button>
                <button onClick={() => adjustStock(scanResult.id, 1)} className="btn-maint flex-1 !py-1.5 text-xs">
                  {translatePortalText("Add +1 Stock")}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* add new part modal */}
      <Modal open={addPartOpen} onClose={() => setAddPartOpen(false)} title={translatePortalText("📦 Add Spare Part to Inventory")}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">{translatePortalText("Part Name")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Racor 500FG Fuel Filter Element")} value={partForm.name}
                onChange={e => setPartForm(s => ({ ...s, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("SKU / Barcode Number")}</label>
              <input className="input font-mono uppercase" placeholder={translatePortalText("e.g. 2010TM-OR")} value={partForm.sku}
                onChange={e => setPartForm(s => ({ ...s, sku: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Category")}</label>
              <select className="input" value={partForm.cat} onChange={e => setPartForm(s => ({ ...s, cat: e.target.value }))}>
                <option value="engine">{translatePortalText("Engine & Propulsion")}</option>
                <option value="electrical">{translatePortalText("Electrical & Electronics")}</option>
                <option value="plumbing">{translatePortalText("Plumbing & Pumps")}</option>
                <option value="hull">{translatePortalText("Hull & Anodes")}</option>
                <option value="deck">{translatePortalText("Deck & Hardware")}</option>
                <option value="rigging">{translatePortalText("Rigging & Sails")}</option>
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Initial Stock Quantity")}</label>
              <input className="input" type="number" placeholder={translatePortalText("15")} value={partForm.stock}
                onChange={e => setPartForm(s => ({ ...s, stock: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Minimum Stock Alert Level")}</label>
              <input className="input" type="number" placeholder={translatePortalText("5")} value={partForm.min}
                onChange={e => setPartForm(s => ({ ...s, min: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Unit Cost ($)")}</label>
              <input className="input" type="number" step="0.01" placeholder={translatePortalText("45.00")} value={partForm.price}
                onChange={e => setPartForm(s => ({ ...s, price: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Shelf / Bin Location")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Shelf A-04")} value={partForm.location}
                onChange={e => setPartForm(s => ({ ...s, location: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="label">{translatePortalText("Supplier Name")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Parker Hannifin Marine, Volvo Penta")} value={partForm.supplier}
                onChange={e => setPartForm(s => ({ ...s, supplier: e.target.value }))} />
            </div>
          </div>
          <button className="btn-maint w-full !justify-center !py-2.5" disabled={partBusy} onClick={submitAddPart}>
            {partBusy ? translatePortalText("Adding part…") : translatePortalText("Add part to inventory")}
          </button>
        </div>
      </Modal>

      <Modal open={poOpen} onClose={() => setPoOpen(false)} title={translatePortalText("🧾 Create purchase order")}>
        <div className="space-y-3">
          <div><label className="label">{translatePortalText("Part")}</label>
            <select className="input" value={poPart} onChange={e => setPoPart(e.target.value)}>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Quantity")}</label><input type="number" min={1} className="input" value={poQty} onChange={e => setPoQty(Math.max(1, Number(e.target.value)))} /></div>
          <button onClick={submitPO} className="btn-maint w-full !justify-center">{translatePortalText("Create order")}</button>
        </div>
      </Modal>

      <AddToolModal open={addToolOpen} onClose={() => setAddToolOpen(false)} onSave={submitAddTool} busy={toolBusy} />
      <AddSupplierModal open={addSupplierOpen} onClose={() => setAddSupplierOpen(false)} onSave={submitAddSupplier} busy={supplierBusy} />
      <AddServiceModal open={addServiceOpen} onClose={() => setAddServiceOpen(false)} onSave={submitAddService} busy={serviceBusy} />
    </PageWrap>
  )
}

function AddServiceModal({ open, onClose, onSave, busy }: { open: boolean; onClose: () => void; onSave: (b: { name: string; category: string; priceFrom: number; turnaroundLabel?: string }) => void; busy: boolean }) {
  const blank = { name: '', category: 'engine', priceFrom: '', turnaroundLabel: '' }
  const [f, setF] = useState(blank)
  useEffect(() => { if (open) setF(blank) }, [open])
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))
  const submit = () => {
    if (!f.name.trim()) { maintToast('Service name is required', 'warn'); return }
    onSave({ name: f.name.trim(), category: f.category, priceFrom: parseFloat(f.priceFrom) || 0, turnaroundLabel: f.turnaroundLabel.trim() || undefined })
  }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🧰 Add service to your menu")}>
      <div className="space-y-3">
        <div><label className="label">{translatePortalText("Service name")}</label><input className="input" value={f.name} onChange={e => set('name')(e.target.value)} placeholder={translatePortalText("e.g. Annual engine service")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{translatePortalText("Category")}</label>
            <select className="input" value={f.category} onChange={e => set('category')(e.target.value)}>
              {SERVICE_CATEGORY_KEYS.map(k => <option key={k} value={k}>{serviceCategoryLabel(k)}</option>)}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Price from")}</label><input className="input" type="number" min={0} step="0.01" value={f.priceFrom} onChange={e => set('priceFrom')(e.target.value)} placeholder={translatePortalText("0.00")} /></div>
        </div>
        <div><label className="label">{translatePortalText("Turnaround")}</label><input className="input" value={f.turnaroundLabel} onChange={e => set('turnaroundLabel')(e.target.value)} placeholder={translatePortalText("e.g. 24–48h")} /></div>
        <button disabled={busy} onClick={submit} className="btn-maint w-full !justify-center disabled:opacity-70">{busy ? translatePortalText("Adding…") : translatePortalText("Add to service menu")}</button>
      </div>
    </Modal>
  )
}

function AddToolModal({ open, onClose, onSave, busy }: { open: boolean; onClose: () => void; onSave: (b: { name: string; kind: MaintenanceTool['kind'] }) => void; busy: boolean }) {
  const blank = { name: '', kind: 'tool' as MaintenanceTool['kind'] }
  const [f, setF] = useState(blank)
  useEffect(() => { if (open) setF(blank) }, [open])
  const submit = () => { if (!f.name.trim()) { maintToast('Name is required', 'warn'); return }; onSave(f) }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🛠️ Add tool / equipment")}>
      <div className="space-y-3">
        <div><label className="label">{translatePortalText("Name")}</label><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} placeholder={translatePortalText("e.g. Torque wrench set")} /></div>
        <div><label className="label">{translatePortalText("Kind")}</label>
          <select className="input" value={f.kind} onChange={e => setF(s => ({ ...s, kind: e.target.value as MaintenanceTool['kind'] }))}>
            {(['tool', 'equipment'] as const).map(k => <option key={k} value={k}>{translatePortalText(TOOL_KIND_LABEL[k])}</option>)}
          </select>
        </div>
        <button disabled={busy} onClick={submit} className="btn-maint w-full !justify-center disabled:opacity-70">{busy ? translatePortalText("Adding…") : translatePortalText("Add to inventory")}</button>
      </div>
    </Modal>
  )
}

function AddSupplierModal({ open, onClose, onSave, busy }: { open: boolean; onClose: () => void; onSave: (b: { name: string; contactName?: string; phone?: string; partsCategories: string[]; leadTimeDays: number }) => void; busy: boolean }) {
  const blank = { name: '', contactName: '', phone: '', categories: '', leadTimeDays: '2' }
  const [f, setF] = useState(blank)
  useEffect(() => { if (open) setF(blank) }, [open])
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))
  const submit = () => {
    if (!f.name.trim()) { maintToast('Supplier name is required', 'warn'); return }
    onSave({
      name: f.name.trim(), contactName: f.contactName.trim() || undefined, phone: f.phone.trim() || undefined,
      partsCategories: f.categories.split(',').map(s => s.trim()).filter(Boolean), leadTimeDays: parseInt(f.leadTimeDays, 10) || 0,
    })
  }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🏭 Add supplier")}>
      <div className="space-y-3">
        <div><label className="label">{translatePortalText("Supplier name")}</label><input className="input" value={f.name} onChange={e => set('name')(e.target.value)} placeholder={translatePortalText("e.g. Marine Parts Co.")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{translatePortalText("Contact name")}</label><input className="input" value={f.contactName} onChange={e => set('contactName')(e.target.value)} placeholder={translatePortalText("e.g. Dan Reyes")} /></div>
          <div><label className="label">{translatePortalText("Phone")}</label><input className="input" value={f.phone} onChange={e => set('phone')(e.target.value)} placeholder={translatePortalText("+1 305 800 1201")} /></div>
        </div>
        <div><label className="label">{translatePortalText("Parts supplied (comma separated)")}</label><input className="input" value={f.categories} onChange={e => set('categories')(e.target.value)} placeholder={translatePortalText("e.g. Engine, Cooling")} /></div>
        <div><label className="label">{translatePortalText("Lead time (days)")}</label><input className="input" type="number" min={0} value={f.leadTimeDays} onChange={e => set('leadTimeDays')(e.target.value)} /></div>
        <button disabled={busy} onClick={submit} className="btn-maint w-full !justify-center disabled:opacity-70">{busy ? translatePortalText("Adding…") : translatePortalText("Add supplier")}</button>
      </div>
    </Modal>
  )
}
