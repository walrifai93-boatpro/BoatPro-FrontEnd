import React, { useMemo, useState } from 'react'
import { UsersRound, UserPlus, Mail, RotateCcw, Power, Trash2, Edit3, Copy, Ban, ShieldCheck, Phone, Clock } from 'lucide-react'
import {
  marinaStaffApi,
  MARINA_STAFF_PERMISSIONS,
  type ApiMarinaTeamMember,
  type MarinaInviteDelivery,
  type MarinaStaffPermission,
  type MarinaStaffRole,
  type MarinaStaffStatus,
} from '../api'
import { useAsync } from '../live'
import { useAuth, useMarinaPermissions } from '../auth'
import { MARINA_PERMISSION_INFO } from '../marinaAccess'
import { PageHeader, Modal, toast, copyText, LoadingButton, LoadingState, ErrorState, EmptyState, Avatar } from '../ui'
import { confirmAndRun } from '../async'
import { useLimitAwareAction, usePackageUsage, UsageMeter } from '../shared/packageLimit'
import { formatPortalDate, translatePortalText } from '../i18n/runtime'

/**
 * The marina's team — the marina console's equivalent of the fuel portal's
 * Workers page. The owner (or a staff manager holding `manage_staff`) invites
 * people by email with a role and the console pages they may open, then
 * resends or withdraws invites, edits access, switches people off and on, or
 * takes them off the team. The server enforces every rule shown here; the page
 * only explains them before the click.
 */

const ROLE_ORDER: MarinaStaffRole[] = ['manager', 'reception', 'dock_staff', 'security', 'fuel_staff']
const ROLE_LABEL: Record<MarinaStaffRole, string> = {
  manager: 'Marina manager',
  reception: 'Reception',
  dock_staff: 'Dock staff',
  security: 'Security',
  fuel_staff: 'Fuel staff',
}

/** A sensible starting point per role — the owner can tick anything else. */
const ROLE_PRESETS: Record<MarinaStaffRole, MarinaStaffPermission[]> = {
  manager: ['manage_bookings', 'check_in', 'manage_slots', 'manage_pricing', 'manage_services', 'view_reports', 'manage_staff'],
  reception: ['manage_bookings', 'check_in'],
  dock_staff: ['check_in', 'manage_slots'],
  security: ['check_in'],
  fuel_staff: ['manage_fuel', 'check_in'],
}

const STATUS_COPY: Record<MarinaStaffStatus, { label: string; tone: string }> = {
  invited: { label: 'Invite sent', tone: 'bg-sky-100 text-sky-700' },
  pending_approval: { label: 'Awaiting BoatPro approval', tone: 'bg-amber-100 text-amber-700' },
  active: { label: 'Active', tone: 'bg-emerald-100 text-emerald-700' },
  disabled: { label: 'Deactivated', tone: 'bg-slate-200 text-slate-600' },
  revoked: { label: 'Invite withdrawn', tone: 'bg-slate-100 text-slate-500' },
  removed: { label: 'Removed', tone: 'bg-rose-100 text-rose-700' },
}

type View = 'team' | 'invited' | 'all'

function StatusChip({ member }: { member: ApiMarinaTeamMember }) {
  const rejected = member.approvalStatus === 'rejected'
  const copy = rejected ? { label: 'Not approved', tone: 'bg-rose-100 text-rose-700' } : STATUS_COPY[member.status]
  return <span className={`chip ${copy.tone}`}>{translatePortalText(copy.label)}</span>
}

function PermissionPicker({
  value,
  onChange,
  grantable,
}: {
  value: MarinaStaffPermission[]
  onChange: (next: MarinaStaffPermission[]) => void
  grantable: readonly MarinaStaffPermission[]
}) {
  const toggle = (key: MarinaStaffPermission) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key])
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {MARINA_STAFF_PERMISSIONS.map((key) => {
        const allowed = grantable.includes(key)
        const on = value.includes(key)
        const info = MARINA_PERMISSION_INFO[key]
        return (
          <label
            key={key}
            title={allowed ? undefined : translatePortalText('You can only grant access you hold yourself')}
            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${
              !allowed ? 'cursor-not-allowed border-slate-100 opacity-50' : on ? 'cursor-pointer border-ocean-400 bg-ocean-50 shadow-sm' : 'cursor-pointer border-slate-200 hover:border-slate-300'
            }`}
          >
            <input type="checkbox" checked={on} disabled={!allowed} onChange={() => toggle(key)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-ocean-600" />
            <span>
              <span className="block font-semibold text-deep-900">{translatePortalText(info.label)}</span>
              <span className="block text-[11px] text-slate-500">{translatePortalText(info.detail)}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

/** The link to hand over when the email did not go (or, in development, always). */
function inviteLinkFrom(delivery: MarinaInviteDelivery): string | null {
  if (delivery.inviteUrl) return delivery.inviteUrl
  if (delivery.devInviteToken) return `${window.location.origin}${window.location.pathname}#/worker-invite/marina/${delivery.devInviteToken}`
  return null
}

export default function MarinaStaff() {
  const { user } = useAuth()
  const access = useMarinaPermissions()
  const [view, setView] = useState<View>('team')
  const state = useAsync(() => marinaStaffApi.list({ status: view === 'all' ? 'all' : undefined }).then((r) => r.data), [view])
  const usage = usePackageUsage()
  const workersUsage = usage.usage.find((u) => u.key === 'maxWorkers')

  const grantable = state.data?.grantable ?? (access.isOwner ? MARINA_STAFF_PERMISSIONS : access.permissions)
  const members = useMemo(() => {
    const all = state.data?.items ?? []
    if (view === 'invited') return all.filter((m) => m.status === 'invited' || m.status === 'pending_approval')
    return all
  }, [state.data, view])

  // ── invite ─────────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'reception' as MarinaStaffRole, title: '' })
  const [perms, setPerms] = useState<MarinaStaffPermission[]>([])
  const [busy, setBusy] = useState(false)
  const [linkFor, setLinkFor] = useState<{ name: string; url: string } | null>(null)
  const invite = useLimitAwareAction(marinaStaffApi.invite)

  const presetFor = (role: MarinaStaffRole) => ROLE_PRESETS[role].filter((p) => grantable.includes(p))

  const openInvite = () => {
    setForm({ name: '', email: '', phone: '', role: 'reception', title: '' })
    setPerms(presetFor('reception'))
    setInviteOpen(true)
  }

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await invite.run({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        role: form.role,
        title: form.title.trim() || undefined,
        permissions: perms,
      })
      if (!res) return // package limit — the upgrade modal is showing
      setInviteOpen(false)
      await Promise.all([state.reload(), usage.reload()])
      const link = inviteLinkFrom(res.data)
      if (res.data.emailSent) toast(translatePortalText(`Invite emailed to ${form.email.trim()}`))
      if (link) setLinkFor({ name: form.name.trim(), url: link })
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not send the invite'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  // ── edit ───────────────────────────────────────────────
  const [editing, setEditing] = useState<ApiMarinaTeamMember | null>(null)
  const [edit, setEdit] = useState({ role: 'reception' as MarinaStaffRole, title: '', phone: '' })
  const [editPerms, setEditPerms] = useState<MarinaStaffPermission[]>([])
  const openEdit = (m: ApiMarinaTeamMember) => {
    setEditing(m)
    setEdit({ role: m.role, title: m.title ?? '', phone: m.phone ?? '' })
    setEditPerms(m.permissions)
  }
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    try {
      await marinaStaffApi.update(editing.id, { role: edit.role, title: edit.title.trim(), phone: edit.phone.trim(), permissions: editPerms })
      toast(translatePortalText(`Access updated for ${editing.name}`))
      setEditing(null)
      await state.reload()
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not save'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  // ── row actions ────────────────────────────────────────
  /** Why the caller may not act on this row, or null. Mirrors the server's rules. */
  const lockedReason = (m: ApiMarinaTeamMember): string | null => {
    if (access.isOwner) return null
    if (m.userId && user && (m.userId === user._id || m.userId === user.id)) return 'Ask the marina owner to change your own access'
    if (m.permissions.some((p) => !grantable.includes(p))) return 'Only the marina owner can change a colleague whose access exceeds yours'
    return null
  }

  const resend = (m: ApiMarinaTeamMember) =>
    confirmAndRun({
      title: translatePortalText('Resend the invite?'),
      body: translatePortalText(`${m.name} gets a fresh link by email. The previous link stops working.`),
      confirmLabel: translatePortalText('Resend'),
      busyLabel: translatePortalText('Sending…'),
      run: () => marinaStaffApi.resend(m.id),
      success: (r) => (r.data.emailSent ? `Invite re-sent to ${m.email}` : 'New invite link ready'),
    }).then((r) => {
      if (!r) return
      const link = inviteLinkFrom(r.data)
      if (link) setLinkFor({ name: m.name, url: link })
      void state.reload()
    })

  const revoke = (m: ApiMarinaTeamMember) =>
    confirmAndRun({
      title: translatePortalText('Withdraw this invite?'),
      body: translatePortalText(`The link sent to ${m.email ?? m.name} stops working. You can invite them again later.`),
      confirmLabel: translatePortalText('Withdraw invite'),
      danger: true,
      busyLabel: translatePortalText('Withdrawing…'),
      run: () => marinaStaffApi.revoke(m.id),
      success: 'Invite withdrawn',
    }).then((r) => r && state.reload())

  const toggleActive = (m: ApiMarinaTeamMember) => {
    const off = m.status === 'active'
    return confirmAndRun({
      title: translatePortalText(off ? `Deactivate ${m.name}?` : `Reactivate ${m.name}?`),
      body: translatePortalText(off
        ? 'They are signed out at once and cannot use the marina console until you reactivate them. Their history stays.'
        : 'They can sign in again with their existing password and the same access as before.'),
      confirmLabel: translatePortalText(off ? 'Deactivate' : 'Reactivate'),
      danger: off,
      busyLabel: translatePortalText(off ? 'Deactivating…' : 'Reactivating…'),
      run: () => marinaStaffApi.setStatus(m.id, off ? 'disabled' : 'active'),
      success: off ? `${m.name} deactivated` : `${m.name} reactivated`,
    }).then((r) => r && state.reload())
  }

  const remove = (m: ApiMarinaTeamMember) =>
    confirmAndRun({
      title: translatePortalText(`Remove ${m.name} from the team?`),
      body: translatePortalText('Their access ends now. Their record is kept for your history (work orders, attendance, audit log) — nothing is deleted.'),
      confirmLabel: translatePortalText('Remove from team'),
      danger: true,
      busyLabel: translatePortalText('Removing…'),
      run: () => marinaStaffApi.remove(m.id),
      success: `${m.name} removed from the team`,
    }).then((r) => {
      if (!r) return
      void state.reload()
      void usage.reload()
    })

  const copyLink = async () => {
    if (!linkFor) return
    const ok = await copyText(linkFor.url)
    toast(translatePortalText(ok ? 'Invite link copied' : 'Could not copy — select and copy manually'), ok ? 'success' : 'warn')
  }

  const iconBtn = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-ocean-300 hover:text-ocean-700 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div>
      <PageHeader
        title="Staff & Access"
        sub="Invite your team and choose exactly which parts of the console each person can open"
        icon={<UsersRound className="text-ocean-500" />}
        actions={<button className="btn-primary" onClick={openInvite}><UserPlus size={16} /> {translatePortalText('Invite staff')}</button>}
      />

      {access.isOwner && workersUsage && (
        <div className="card mb-4 p-4"><UsageMeter item={workersUsage} /></div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {([['team', 'Team'], ['invited', 'Pending invites'], ['all', 'All, including removed']] as [View, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${view === key ? 'bg-ocean-600 text-white shadow-soft' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-ocean-300'}`}>
            {translatePortalText(label)}
          </button>
        ))}
      </div>

      {state.loading && !state.data ? (
        <LoadingState label="Loading your team…" rows={4} />
      ) : state.error && !state.data ? (
        <ErrorState error={state.error} onRetry={() => void state.reload()} />
      ) : members.length === 0 ? (
        <EmptyState icon="👥" text={view === 'invited' ? 'No pending invites' : 'No staff yet — invite your first team member'} />
      ) : (
        <div className="space-y-3">
          {members.map((m) => {
            const locked = lockedReason(m)
            const gone = m.status === 'removed' || m.status === 'revoked'
            return (
              <div key={m.id} className={`card flex flex-col gap-3 p-4 md:flex-row md:items-center ${gone ? 'opacity-70' : ''}`}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar name={m.name} src={m.avatar} size={42} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-display font-bold text-deep-900">
                      <bdi dir="auto">{m.name}</bdi> <StatusChip member={m} />
                    </p>
                    <p className="text-xs text-slate-500">
                      {translatePortalText(ROLE_LABEL[m.role] ?? m.roleLabel)}{m.title ? ` · ${m.title}` : ''}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                      {m.email && <span className="inline-flex items-center gap-1"><Mail size={11} />{m.email}</span>}
                      {m.phone && <span className="inline-flex items-center gap-1"><Phone size={11} /><bdi dir="ltr">{m.phone}</bdi></span>}
                      {m.status === 'invited' && m.inviteExpires && (
                        <span className="inline-flex items-center gap-1"><Clock size={11} />{translatePortalText('Link expires')} {formatPortalDate(m.inviteExpires)}</span>
                      )}
                      {m.approvalStatus === 'rejected' && m.rejectionReason && <span className="text-rose-600">{m.rejectionReason}</span>}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.permissions.length === 0 ? (
                        <span className="chip bg-slate-100 text-slate-500">{translatePortalText('Dashboard only')}</span>
                      ) : m.permissions.map((p) => (
                        <span key={p} className="chip bg-ocean-50 text-ocean-700">{translatePortalText(MARINA_PERMISSION_INFO[p]?.label ?? p)}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {!gone && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5" title={locked ? translatePortalText(locked) : undefined}>
                    <button className={iconBtn} disabled={!!locked} onClick={() => openEdit(m)} aria-label={translatePortalText('Edit access')} title={translatePortalText(locked ?? 'Edit access')}><Edit3 size={15} /></button>
                    {m.status === 'invited' && (<>
                      <button className={iconBtn} disabled={!!locked} onClick={() => void resend(m)} aria-label={translatePortalText('Resend invite')} title={translatePortalText(locked ?? 'Resend invite')}><RotateCcw size={15} /></button>
                      <button className={iconBtn} disabled={!!locked} onClick={() => void revoke(m)} aria-label={translatePortalText('Withdraw invite')} title={translatePortalText(locked ?? 'Withdraw invite')}><Ban size={15} /></button>
                    </>)}
                    {(m.status === 'active' || m.status === 'disabled') && (
                      <button className={iconBtn} disabled={!!locked || (m.status === 'disabled' && m.approvalStatus !== 'approved')}
                        onClick={() => void toggleActive(m)}
                        aria-label={translatePortalText(m.status === 'active' ? 'Deactivate' : 'Reactivate')}
                        title={translatePortalText(locked ?? (m.status === 'active' ? 'Deactivate' : m.approvalStatus !== 'approved' ? 'Awaiting BoatPro approval' : 'Reactivate'))}>
                        <Power size={15} className={m.status === 'active' ? 'text-emerald-600' : ''} />
                      </button>
                    )}
                    {m.status === 'pending_approval' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700"><ShieldCheck size={13} />{translatePortalText('BoatPro reviews new staff')}</span>
                    )}
                    {m.status !== 'invited' && (
                      <button className={`${iconBtn} hover:!border-rose-300 hover:!text-rose-600`} disabled={!!locked} onClick={() => void remove(m)} aria-label={translatePortalText('Remove from team')} title={translatePortalText(locked ?? 'Remove from team')}><Trash2 size={15} /></button>
                    )}
                  </div>
                )}
                {gone && m.removedAt && (
                  <p className="text-[11px] text-slate-400">{translatePortalText('Removed')} {formatPortalDate(m.removedAt)}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {invite.modal}

      {/* ── Invite ── */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title={translatePortalText('Invite a team member')} wide>
        <form onSubmit={submitInvite} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{translatePortalText('Full name')}</label>
              <input required minLength={2} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">{translatePortalText('Email')}</label>
              <input required type="email" className="input" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label">{translatePortalText('Mobile (optional)')}</label>
              <input className="input" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+966…" />
            </div>
            <div>
              <label className="label">{translatePortalText('Role')}</label>
              <select className="input" value={form.role} onChange={(e) => { const role = e.target.value as MarinaStaffRole; setForm({ ...form, role }); setPerms(presetFor(role)) }}>
                {ROLE_ORDER.map((r) => <option key={r} value={r}>{translatePortalText(ROLE_LABEL[r])}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">{translatePortalText('Job title (optional)')}</label>
              <input className="input" maxLength={80} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={translatePortalText('e.g. Harbour master')} />
            </div>
          </div>
          <div>
            <label className="label">{translatePortalText('What they can open')}</label>
            <PermissionPicker value={perms} onChange={setPerms} grantable={grantable} />
            <p className="mt-2 text-[11px] text-slate-500">{translatePortalText('Everyone sees the dashboard, alerts, the inbox and the incident log. Money is only visible with “Billing & reports”.')}</p>
          </div>
          <p className="rounded-xl bg-sand p-3 text-[11px] text-slate-500">
            {translatePortalText('We email them a link to set a password (valid 7 days). BoatPro approves each new staff account before it can open the console.')}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setInviteOpen(false)}>{translatePortalText('Cancel')}</button>
            <LoadingButton type="submit" loading={busy} className="btn-primary" icon={<Mail size={15} />}>{translatePortalText('Send invite')}</LoadingButton>
          </div>
        </form>
      </Modal>

      {/* ── Edit access ── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={translatePortalText(editing ? `Edit access — ${editing.name}` : '')} wide>
        {editing && (
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">{translatePortalText('Role')}</label>
                <select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as MarinaStaffRole })}>
                  {ROLE_ORDER.map((r) => <option key={r} value={r}>{translatePortalText(ROLE_LABEL[r])}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{translatePortalText('Job title')}</label>
                <input className="input" maxLength={80} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </div>
              <div>
                <label className="label">{translatePortalText('Mobile')}</label>
                <input className="input" dir="ltr" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">{translatePortalText('What they can open')}</label>
              <PermissionPicker value={editPerms} onChange={setEditPerms} grantable={grantable} />
            </div>
            <p className="text-[11px] text-slate-500">{translatePortalText('They are notified of the change, and it is recorded in the audit log.')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>{translatePortalText('Cancel')}</button>
              <LoadingButton type="submit" loading={busy} className="btn-primary">{translatePortalText('Save access')}</LoadingButton>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Invite link (email not delivered, or development) ── */}
      <Modal open={!!linkFor} onClose={() => setLinkFor(null)} title={translatePortalText('Invite link')}>
        {linkFor && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {translatePortalText('If the email does not arrive, send this link to')} <strong><bdi dir="auto">{linkFor.name}</bdi></strong> {translatePortalText('yourself — by SMS or WhatsApp. It works once and expires in 7 days.')}
            </p>
            <input readOnly className="input font-mono text-xs" dir="ltr" value={linkFor.url} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => void copyLink()}><Copy size={15} /> {translatePortalText('Copy link')}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
