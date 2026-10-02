import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supportApi } from '../api'
import { toast } from '../ui'
import { translatePortalText } from '../i18n/runtime'

export default function SupportAgentInvite() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8 || password !== confirm) {
      toast('Use at least 8 characters and matching passwords.', 'warn')
      return
    }
    setBusy(true)
    try {
      await supportApi.acceptAgentInvite(token, password)
      toast('Your support account is ready. Sign in to continue.')
      nav('/login', { replace: true })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'This invitation could not be accepted', 'warn')
    } finally { setBusy(false) }
  }
  return <main className="grid min-h-screen place-items-center bg-sand p-4">
    <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
      <h1 className="font-display text-xl font-bold text-deep-900">Join BoatPro Support</h1>
      <p className="text-sm text-slate-500">Set a password for your agent account.</p>
      <label className="block text-sm">Password<input className="input mt-1 w-full" type="password" minLength={8}
        value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <label className="block text-sm">Confirm password<input className="input mt-1 w-full" type="password"
        value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>
      <button className="btn-admin w-full" disabled={busy}>{translatePortalText(busy ? 'Setting password…' : 'Activate account')}</button>
    </form>
  </main>
}
