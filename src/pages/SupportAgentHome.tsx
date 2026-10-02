import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Headset, LogOut } from 'lucide-react'
import { useAuth } from '../auth'
import { supportApi } from '../api'
import { toast } from '../ui'
import { SupportConsole } from '../shared/SupportConsole'
import { translatePortalText } from '../i18n/runtime'

export default function SupportAgentHome() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [queueRefresh, setQueueRefresh] = useState(0)
  useEffect(() => { supportApi.myAvailability().then(r => setAvailable(r.data.available)).catch(() => {}) }, [])
  const setPresence = async (next: boolean) => {
    setBusy(true)
    try {
      await supportApi.availability(next)
      setAvailable(next)
      setQueueRefresh(value => value + 1)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Availability could not be updated', 'warn')
    } finally { setBusy(false) }
  }
  return <div className="min-h-screen bg-sand p-4 md:p-7">
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Headset className="text-ocean-500" />
          <div><h1 className="font-display text-2xl font-bold text-deep-900">{translatePortalText('BoatPro Support')}</h1>
            <p className="text-sm text-slate-500">{user?.name}</p></div></div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-deep-900">
            <input type="checkbox" checked={available} disabled={busy}
              onChange={e => void setPresence(e.target.checked)} /> {translatePortalText('Available for new cases')}
          </label>
          <button className="btn-ghost" onClick={() => { logout(); nav('/login') }}>
            <LogOut size={15} /> {translatePortalText('Sign out')}
          </button>
        </div>
      </header>
      <SupportConsole title="Assigned cases" sub="Cases assigned to you across your approved desks" refreshKey={queueRefresh} />
    </div>
  </div>
}
