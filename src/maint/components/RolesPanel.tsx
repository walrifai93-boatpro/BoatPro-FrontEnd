import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Tag, Users, Loader2 } from 'lucide-react'
import { Modal } from '../../ui'
import { money } from '../../format'
import { MAINT_CATEGORIES, catByKey } from '../maintData'
import { maintenancePortalApi, type MaintenanceRoleData } from '../../api'
import { formatPortalNumber, localizedField, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'
import { maintToast } from '../maintUi'

/**
 * The trades this workshop staffs.
 *
 * This is where a trade is defined, and it is the only place it is defined: a
 * technician's `skills` are derived from the roles they hold, so there is no
 * separate list of skills to keep in step. Before this existed, roles were free
 * text on each technician and skills were a parallel enum, bridged by a keyword
 * guess over the role's job title — which is why "Underwater Antifouling" used
 * to be filed as plumbing.
 *
 * Three things a role carries that a bare name could not:
 *   · **category** — the shelf a customer browses it under, and what the icons,
 *     colours and reporting key on
 *   · **keywords** — the shop's own search terms, because only it knows it calls
 *     that job "sterndrive bellows"
 *   · **default rate** — what a technician newly given the trade starts at,
 *     before their own seniority is applied
 */
export function RolesPanel({ onChanged }: { onChanged?: () => void }) {
  const [roles, setRoles] = useState<MaintenanceRoleData[]>([])
  const [loading, setLoading] = useState(true)
  const [showRetired, setShowRetired] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editing, setEditing] = useState<MaintenanceRoleData | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', category: 'engine', rate: '', keywords: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await maintenancePortalApi.listRoles(showRetired ? { includeInactive: true } : undefined)
      setRoles(res.data.roles)
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not load your roles', 'warn')
    } finally {
      setLoading(false)
    }
  }, [showRetired])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = () => {
    setEditing(null)
    setForm({ name: '', category: 'engine', rate: '', keywords: '' })
    setOpen(true)
  }

  const openEdit = (role: MaintenanceRoleData) => {
    setEditing(role)
    setForm({
      name: role.name,
      category: role.category,
      rate: String(role.defaultHourlyRate),
      keywords: role.keywords.join(', '),
    })
    setOpen(true)
  }

  const submit = async () => {
    const name = form.name.trim()
    if (name.length < 2) {
      maintToast('Give the trade a name', 'warn')
      return
    }
    const rate = Number(form.rate)
    if (!Number.isFinite(rate) || rate < 0) {
      maintToast('Set the rate a technician newly given this trade starts at', 'warn')
      return
    }
    // Blank means "let the server seed them from the name and category", which is
    // what keeps a role findable when the shop has not thought about keywords.
    const keywords = form.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)

    setBusy(true)
    try {
      if (editing) {
        await maintenancePortalApi.updateRole(editing.id, {
          name,
          category: form.category,
          defaultHourlyRate: rate,
          keywords: keywords.length ? keywords : undefined,
        })
        maintToast(`"${name}" updated`)
      } else {
        await maintenancePortalApi.createRole({
          name,
          category: form.category,
          defaultHourlyRate: rate,
          keywords: keywords.length ? keywords : undefined,
        })
        maintToast(`"${name}" added`)
      }
      setOpen(false)
      await load()
      // A technician's skills follow their roles, so the roster above may have
      // changed too.
      onChanged?.()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save that role', 'warn')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (role: MaintenanceRoleData) => {
    setBusy(true)
    try {
      const res = await maintenancePortalApi.deleteRole(role.id)
      // The server retires rather than deletes a role someone still holds, and
      // says so — pass that on instead of claiming it was removed.
      maintToast(res.message ?? `"${role.name}" removed`, res.message ? 'info' : 'success')
      await load()
      onChanged?.()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not remove that role', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-display text-base font-extrabold text-deep-900">
            <Tag size={16} className="text-violet-500" /> {translatePortalText("Trades you staff")}
          </p>
          <p className="text-[11px] text-slate-400">
            {translatePortalText("A technician's skills come from the trades they hold — this is where a trade is defined.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
            />
            {translatePortalText("Show retired")}
          </label>
          <button className="btn-maint !py-1.5 !px-3 !text-xs" onClick={openNew}>
            <Plus size={13} /> {translatePortalText("Add trade")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
          <Loader2 size={14} className="animate-spin" /> {translatePortalText("Loading trades…")}
        </div>
      ) : roles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
          <p className="text-sm font-bold text-deep-900">{translatePortalText("No trades defined yet")}</p>
          <p className="mt-1 text-xs text-slate-400">
            {translatePortalText("Add the trades your workshop does. Until a trade exists, a technician holding it counts as\r\n            qualified for nothing — and customers searching for it will not find you.")}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {roles.map((role) => {
            const cat = catByKey(role.category)
            const keywords = (localizedField<string[]>(role, 'keywords') as string[] | undefined) ?? role.keywords
            return (
              <div
                key={role.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 ${
                  role.active ? 'border-slate-200 bg-white' : 'border-slate-100 bg-sand/40 opacity-70'
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm"
                  style={{ backgroundColor: `${cat.color}1f` }}
                >
                  {cat.icon}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-[13px] font-bold text-deep-900"><bdi dir="auto">{localizedField(role, 'name') ?? role.name}</bdi></p>
                    {!role.active && (
                      <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                        {translatePortalText("Retired")}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-semibold text-slate-400">
                    {translatePortalText(cat.name)}
                    {keywords.length > 0 && <> · {translatePortalText("found by:")} <bdi dir="auto">{keywords.slice(0, 5).join(', ')}</bdi></>}
                    {keywords.length > 5 && ` ${translatePortalTemplate('+{{count}} more', { count: keywords.length - 5 })}`}
                  </p>
                </div>

                {role.technicians != null && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-sand px-2 py-0.5 text-[10px] font-bold text-slate-500">
                    <Users size={10} /> {formatPortalNumber(role.technicians)}
                  </span>
                )}

                <span className="shrink-0 text-end font-display text-sm font-extrabold text-deep-900">
                  {money(role.defaultHourlyRate)}
                  <span className="text-[10px] font-semibold text-slate-400">{translatePortalText("/hr")}</span>
                </span>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    disabled={busy}
                    onClick={() => openEdit(role)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                    title={`${translatePortalText("Edit")} ${localizedField(role, 'name') ?? role.name}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void remove(role)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    title={`${translatePortalText("Remove")} ${localizedField(role, 'name') ?? role.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `${translatePortalText("Edit")} ${editing.name}` : translatePortalText("Add a trade")}>
        <div className="space-y-4">
          <div>
            <label className="label">{translatePortalText("Trade name")}</label>
            <input
              className="input w-full"
              placeholder={translatePortalText("Master Marine Electrician")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {editing && (
              <p className="mt-1 text-[11px] text-amber-600">
                {translatePortalText("Renaming this also renames it on every technician who holds it.")}
              </p>
            )}
          </div>

          <div>
            <label className="label">{translatePortalText("Category")}</label>
            <select
              className="input w-full"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {MAINT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.icon} {translatePortalText(c.name)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText("Which section of the app a customer browses this under. Changing it re-files everyone who holds\r\n              the trade.")}
            </p>
          </div>

          <div>
            <label className="label">{translatePortalText("Default rate (SAR/hr)")}</label>
            <input
              type="number"
              min={0}
              step={5}
              className="input w-full"
              placeholder={formatPortalNumber(180)}
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText("What a technician newly given this trade starts at. Each person's own rate can differ.")}
            </p>
          </div>

          <div>
            <label className="label">{translatePortalText("Search keywords (optional)")}</label>
            <input
              className="input w-full"
              placeholder={translatePortalText("sterndrive, bellows, outdrive")}
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText("What a boat owner might type looking for this job. Leave blank and we'll build them from the\r\n              name and category.")}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              {translatePortalText("Cancel")}
            </button>
            <button className="btn-maint" disabled={busy} onClick={submit}>
              {editing ? translatePortalText("Save changes") : translatePortalText("Add trade")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
