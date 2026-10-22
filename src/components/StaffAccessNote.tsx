import { Lock } from 'lucide-react'
import type { MarinaStaffPermission } from '../api'
import { useMarinaPermissions } from '../auth'
import { MARINA_PERMISSION_INFO } from '../marinaAccess'
import { translatePortalText } from '../i18n/runtime'

/**
 * Tells a marina staff member, on a page they may open, which of its actions
 * their access does not cover — so a button they cannot use is explained
 * before the server refuses it. Renders nothing for the owner, or for staff
 * who hold any of `need`.
 */
export function StaffAccessNote({ need, action }: { need: MarinaStaffPermission[]; action: string }) {
  const access = useMarinaPermissions()
  if (!access.isStaff || access.can(...need)) return null
  const labels = need.map((p) => `“${translatePortalText(MARINA_PERMISSION_INFO[p].label)}”`).join(` ${translatePortalText('or')} `)
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800" role="note">
      <Lock size={14} className="mt-0.5 shrink-0" />
      <p>
        <strong>{translatePortalText('View only.')}</strong> {translatePortalText(action)} {translatePortalText('needs')} {labels} {translatePortalText('access — ask the marina owner if you need it.')}
      </p>
    </div>
  )
}
