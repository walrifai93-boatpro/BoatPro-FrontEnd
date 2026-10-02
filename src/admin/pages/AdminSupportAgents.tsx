import React, { useEffect, useState } from 'react'
import { Headset, RefreshCw } from 'lucide-react'
import { supportApi, type ApiSupportAgent, type ApiSupportApproval, type ApiSupportScope,
  type SupportDesk, type ApiSubscriber, idOf } from '../../api'
import { toast, Spinner } from '../../ui'
import { translatePortalText, isPortalArabic } from '../../i18n/runtime'

const DESKS: SupportDesk[] = ['admin', 'boat', 'marina', 'fuel', 'maintenance']
const BUSINESS_DESKS: SupportDesk[] = ['boat', 'marina', 'fuel', 'maintenance']
const DESK_LABELS: Record<SupportDesk, string> = {
  admin: 'BoatPro help requests', boat: 'Boat businesses', marina: 'Marina businesses',
  fuel: 'Fuel businesses', maintenance: 'Maintenance businesses',
}
type BusinessOption = { id: string; name: string; desk: SupportDesk }
const GRANTS = [
  ['customer.correct_profile', 'Correct customer name'],
  ['customer.verify', 'Review customer document'],
  ['provider.correct_profile', 'Correct provider profile'],
  ['provider.verify', 'Review provider document'],
  ['trip.update', 'Correct trip description'],
  ['trip.reschedule', 'Move an unbooked trip departure'],
  ['trip.cancel', 'Cancel a departure'],
  ['booking.correct_details', 'Correct booking note'],
  ['booking.reschedule', 'Move unapproved booking request'],
  ['booking.cancel', 'Cancel trip booking'],
  ['payment.refund', 'Issue refund within limit'],
  ['payment.retry_link', 'Send payment retry link'],
  ['payment.mark_issue', 'Mark payment issue'],
  ['support.reset_ai', 'Reset AI conversation context'],
] as const

export default function AdminSupportAgents() {
  const [agents, setAgents] = useState<ApiSupportAgent[]>([])
  const [pending, setPending] = useState<ApiSupportApproval[]>([])
  const [metrics, setMetrics] = useState<{ unassigned: number; failedActions: number; incompleteAudits: number; avgAssignmentMins: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ApiSupportAgent | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [desk, setDesk] = useState<SupportDesk>('admin')
  const [selectedBusinesses, setSelectedBusinesses] = useState<string[]>([])
  const [allRequesters, setAllRequesters] = useState(true)
  const [businesses, setBusinesses] = useState<BusinessOption[]>([])
  const [businessSearch, setBusinessSearch] = useState('')
  const [skills, setSkills] = useState('')
  const [capacity, setCapacity] = useState(5)
  const [grants, setGrants] = useState<string[]>([])
  const [refundLimit, setRefundLimit] = useState(0)
  const [otherScopes, setOtherScopes] = useState<ApiSupportScope[]>([])
  const [saving, setSaving] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [a, p, m] = await Promise.all([supportApi.agents(), supportApi.pendingActions(), supportApi.supportMetrics()])
      setAgents(a.data.items)
      setPending(p.data.items)
      setMetrics(m.data)
    } catch (err) { toast(err instanceof Error ? err.message : 'Support staff could not be loaded', 'warn') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    Promise.all(BUSINESS_DESKS.map(async kind => {
      const result = await supportApi.deskProviders(kind)
      return result.data.providers.map((provider: ApiSubscriber) => ({
        id: idOf(provider), name: provider.business?.businessName || provider.name, desk: kind,
      }))
    })).then(groups => setBusinesses(groups.flat()))
      .catch(() => toast('Business list could not be loaded. Refresh to try again.', 'warn'))
  }, [])

  const businessName = (id?: string) => businesses.find(b => b.id === id)?.name || translatePortalText('Business unavailable')
  const scopeLabel = (scope: ApiSupportScope & { owner?: string; requester?: string }) =>
    scope.desk === 'admin'
      ? scope.requesterId || scope.requester
        ? translatePortalText(`BoatPro help from ${businessName(scope.requesterId || scope.requester)}`)
        : translatePortalText('BoatPro help from everyone')
      : translatePortalText(`${businessName(scope.ownerId || scope.owner)} business desk`)
  const currentScopes = (): ApiSupportScope[] => desk === 'admin'
    ? allRequesters ? [{ desk, grants, refundLimit }]
      : selectedBusinesses.map(requesterId => ({ desk, requesterId, grants, refundLimit }))
    : selectedBusinesses.map(ownerId => ({ desk, ownerId, grants, refundLimit }))
  const addCoverage = () => {
    const next = currentScopes()
    if (!next.length) { toast('Choose at least one business.', 'warn'); return }
    const keys = new Set(otherScopes.map(s => `${s.desk}:${s.ownerId || ''}:${s.requesterId || ''}`))
    setOtherScopes(rows => [...rows, ...next.filter(s => !keys.has(`${s.desk}:${s.ownerId || ''}:${s.requesterId || ''}`))])
    setDesk('boat'); setSelectedBusinesses([]); setAllRequesters(false); setBusinessSearch('')
    setGrants([]); setRefundLimit(0)
  }

  const selectAgent = (agent: ApiSupportAgent) => {
    setEditing(agent)
    setName(agent.user.name)
    setEmail(agent.user.email)
    const scope = agent.scopes[0]
    const firstGrants = scope?.grants ?? []
    const firstLimit = scope?.refundLimit ?? 0
    const sameGroup = agent.scopes.filter(s => s.desk === scope?.desk &&
      JSON.stringify(s.grants) === JSON.stringify(firstGrants) && s.refundLimit === firstLimit &&
      !(scope?.desk === 'admin' && !scope.requesterId && !scope.requester))
    const grouped = sameGroup.length ? sameGroup : scope ? [scope] : []
    setOtherScopes(agent.scopes.filter(s => !grouped.includes(s)).map(s => ({
      desk: s.desk, ownerId: s.ownerId || s.owner, requesterId: s.requesterId || s.requester,
      grants: s.grants, refundLimit: s.refundLimit,
    })))
    setDesk(scope?.desk ?? 'admin')
    setAllRequesters(scope?.desk === 'admin' && !scope.requesterId && !scope.requester)
    setSelectedBusinesses(grouped.map(s => scope?.desk === 'admin'
      ? s.requesterId || s.requester || '' : s.ownerId || s.owner || '').filter(Boolean))
    setGrants(firstGrants)
    setRefundLimit(firstLimit)
    setSkills(agent.skills.join(', '))
    setCapacity(agent.capacity)
  }
  const reset = () => {
    setEditing(null); setName(''); setEmail(''); setDesk('admin'); setSelectedBusinesses([])
    setAllRequesters(true); setBusinessSearch('')
    setGrants([]); setRefundLimit(0); setOtherScopes([]); setSkills(''); setCapacity(5); setInviteUrl('')
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const scopes = [...otherScopes, ...currentScopes()]
    if (!scopes.length) { toast('Choose which help requests this agent will cover.', 'warn'); return }
    const keys = scopes.map(s => `${s.desk}:${s.ownerId || ''}:${s.requesterId || ''}`)
    if (new Set(keys).size !== keys.length) { toast('A business is included twice. Remove the duplicate coverage.', 'warn'); return }
    if (scopes.some(s => s.desk === 'admin' && !s.requesterId) &&
      scopes.some(s => s.desk === 'admin' && s.requesterId)) {
      toast('For BoatPro help, choose everyone or selected businesses, not both.', 'warn'); return
    }
    setSaving(true)
    try {
      const config = { scopes, skills: skills.split(',').map(s => s.trim()).filter(Boolean), capacity }
      if (editing) {
        await supportApi.updateAgent(editing._id, config)
        toast('Agent rules updated')
      } else {
        const created = await supportApi.createAgent({ name: name.trim(), email: email.trim(), ...config })
        setInviteUrl(created.data.inviteUrl || '')
        toast(created.data.emailSent ? 'Invitation sent' : 'Agent created; copy the invitation link below')
      }
      await load()
      if (editing) reset()
    } catch (err) { toast(err instanceof Error ? err.message : 'Agent could not be saved', 'warn') }
    finally { setSaving(false) }
  }
  const changeStatus = async (agent: ApiSupportAgent) => {
    try {
      await supportApi.updateAgent(agent._id, { status: agent.status === 'active' ? 'disabled' : 'active' })
      await load()
    } catch (err) { toast(err instanceof Error ? err.message : 'Status could not be updated', 'warn') }
  }
  const resend = async (agent: ApiSupportAgent) => {
    try {
      const r = await supportApi.resendAgentInvite(agent._id)
      setInviteUrl(r.data.inviteUrl || '')
      toast(r.data.emailSent ? 'Invitation resent' : 'Copy the invitation link below')
    } catch (err) { toast(err instanceof Error ? err.message : 'Invitation could not be resent', 'warn') }
  }
  const decide = async (item: ApiSupportApproval, approve: boolean) => {
    try {
      await supportApi.decideAction(item._id, approve)
      toast(approve ? 'Action approved and processed' : 'Action rejected')
      await load()
    } catch (err) { toast(err instanceof Error ? err.message : 'Decision could not be completed', 'warn') }
  }

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Headset className="text-ocean-500" />
        <div><h1 className="font-display text-2xl font-bold text-deep-900">{translatePortalText('Support agents')}</h1>
          <p className="text-sm text-slate-500">Choose who each agent helps. Unanswered AI questions go to an available agent covering that business.</p></div></div>
      <button className="btn-ghost" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
    </div>

    {metrics && <div className="grid gap-3 sm:grid-cols-4 text-sm">
      <div className="card p-3"><strong>{metrics.unassigned}</strong><p className="text-slate-500">Unassigned cases</p></div>
      <div className="card p-3"><strong>{metrics.avgAssignmentMins} min</strong><p className="text-slate-500">Average assignment time today</p></div>
      <div className="card p-3"><strong>{metrics.failedActions}</strong><p className="text-slate-500">Failed actions today</p></div>
      <div className="card p-3"><strong>{metrics.incompleteAudits}</strong><p className="text-slate-500">Actions needing audit review</p></div>
    </div>}

    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,450px)]">
      <section className="card p-4">
        <h2 className="mb-3 font-bold text-deep-900">Staff</h2>
        {loading ? <Spinner /> : agents.length === 0 ? <p className="text-sm text-slate-500">No support agents yet. Invite an agent, choose the businesses they cover, then ask them to switch on availability after accepting.</p> :
          <div className="space-y-2">{agents.map(agent => <div key={agent._id} className="rounded-xl border border-slate-100 p-3">
            <div className="flex items-center justify-between gap-2"><strong>{agent.user.name}</strong><span className="text-xs text-slate-500">{translatePortalText(agent.status === 'invited' ? 'Invitation pending' : agent.status === 'disabled' ? 'Disabled' : agent.available ? 'Available for cases' : 'Offline for new cases')}</span></div>
            <p className="text-xs text-slate-500">{agent.user.email} · Up to {agent.capacity} active cases</p>
            <p className="mt-1 text-xs text-slate-600">Covers: {agent.scopes.length ? agent.scopes.map(scopeLabel).join(isPortalArabic() ? '، ' : ', ') : translatePortalText('No help requests selected')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => selectAgent(agent)}>Configure</button>
              {agent.status === 'invited' ? <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => void resend(agent)}>Resend invite</button>
                : <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => void changeStatus(agent)}>
                  {translatePortalText(agent.status === 'active' ? 'Disable' : 'Enable')}</button>}
            </div>
          </div>)}</div>}
      </section>

      <form onSubmit={submit} className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="font-bold text-deep-900">{translatePortalText(editing ? 'Configure agent' : 'Invite agent')}</h2>
          {editing && <button type="button" className="text-xs text-ocean-600" onClick={reset}>New agent</button>}</div>
        {!editing && <><label className="block text-sm">Name<input required className="input mt-1 w-full" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="block text-sm">Email<input required type="email" className="input mt-1 w-full" value={email} onChange={e => setEmail(e.target.value)} /></label></>}
        <div className="rounded-xl border border-slate-200 p-3">
          <h3 className="font-semibold text-deep-900">Which help requests should this agent receive?</h3>
          <p className="mt-1 text-xs text-slate-500">BoatPro help is for questions sent to your platform team. A business desk is for questions sent directly to that provider.</p>
          <label className="mt-3 block text-sm">Help destination<select className="input mt-1 w-full" value={desk} onChange={e => {
            const next = e.target.value as SupportDesk
            setDesk(next); setSelectedBusinesses([]); setAllRequesters(next === 'admin'); setBusinessSearch('')
          }}>
            {DESKS.map(d => <option key={d} value={d}>{translatePortalText(DESK_LABELS[d])}</option>)}</select></label>
          {desk === 'admin' && <div className="mt-3 space-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={allRequesters} onChange={() => { setAllRequesters(true); setSelectedBusinesses([]) }} /> Everyone who contacts BoatPro</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!allRequesters} onChange={() => setAllRequesters(false)} /> Only selected provider businesses</label>
          </div>}
          {(desk !== 'admin' || !allRequesters) && <div className="mt-3">
            <label className="block text-sm">Choose businesses ({selectedBusinesses.length} selected)
              <input className="input mt-1 w-full" placeholder="Search business name" value={businessSearch}
                onChange={e => setBusinessSearch(e.target.value)} /></label>
            <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {businesses.filter(b => (desk === 'admin' || b.desk === desk) &&
                b.name.toLowerCase().includes(businessSearch.toLowerCase())).map(b =>
                <label key={b.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={selectedBusinesses.includes(b.id)} onChange={e => setSelectedBusinesses(ids =>
                    e.target.checked ? [...ids, b.id] : ids.filter(id => id !== b.id))} />
                  <span>{b.name}</span><span className="ml-auto text-xs text-slate-400">{translatePortalText(DESK_LABELS[b.desk])}</span>
                </label>)}
              {!businesses.some(b => (desk === 'admin' || b.desk === desk) &&
                b.name.toLowerCase().includes(businessSearch.toLowerCase())) &&
                <p className="p-2 text-xs text-slate-500">No approved businesses found. Try another search.</p>}
            </div>
          </div>}
          {!!otherScopes.length && <div className="mt-3 space-y-1 text-xs"><strong>Also covers</strong>
            {otherScopes.map((scope, index) => <div key={`${scope.desk}-${scope.ownerId || scope.requesterId}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
              <span>{scopeLabel(scope)}</span>
              <button type="button" className="text-ocean-600" onClick={() => setOtherScopes(rows => rows.filter((_, i) => i !== index))}>Remove</button></div>)}</div>}
          <button type="button" className="btn-ghost mt-3 w-full" onClick={addCoverage}>Keep this coverage and add another destination</button>
        </div>
        <label className="block text-sm">Maximum active cases<input className="input mt-1 w-full" type="number" min={1} max={100} value={capacity} onChange={e => setCapacity(Number(e.target.value))} /></label>
        <p className="text-xs text-slate-500">An agent receives new cases after accepting the invite and switching on “Available for new cases.” Waiting cases are picked up automatically.</p>
        <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Optional topic preferences and action permissions</summary>
        <p className="mt-2 text-xs text-slate-500">Topic preferences help choose between available agents. They never leave a case without an agent.</p>
        <p className="mt-1 text-xs text-slate-500">Action permissions below apply to the current help destination. Coverage already added above keeps its own permissions.</p>
        <label className="mt-2 block text-sm">Preferred topics, separated by commas<input className="input mt-1 w-full" value={skills} onChange={e => setSkills(e.target.value)} placeholder="For example: payments, bookings" /></label>
        <fieldset className="mt-3 space-y-1"><legend className="text-sm font-semibold">Actions this agent may perform</legend>
          {GRANTS.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grants.includes(key)}
            onChange={e => setGrants(g => e.target.checked ? [...g, key] : g.filter(x => x !== key))} />{translatePortalText(label)}</label>)}</fieldset>
        <label className="mt-3 block text-sm">Direct refund limit (SAR)<input className="input mt-1 w-full" type="number" min={0} step="0.01"
          value={refundLimit} onChange={e => setRefundLimit(Number(e.target.value))} /></label>
        </details>
        <button className="btn-admin w-full" disabled={saving}>{translatePortalText(saving ? 'Saving…' : editing ? 'Save rules' : 'Send invitation')}</button>
        {inviteUrl && <div className="rounded-lg bg-amber-50 p-2 text-xs break-all">Email delivery was unavailable. Share this single-use link securely: {inviteUrl}</div>}
      </form>
    </div>

    <section className="card p-4"><h2 className="mb-3 font-bold text-deep-900">Actions awaiting approval</h2>
      {pending.length === 0 ? <p className="text-sm text-slate-500">No pending actions.</p> : pending.map(item =>
        <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3 text-sm">
          <div><strong>{item.action}</strong> · {item.actor?.name || translatePortalText('Agent')}
            <p className="text-xs text-slate-500">{item.chat?.support?.reference || translatePortalText('Case')} · {item.chat?.subject || item.chat?._id} · Record {item.entityId}</p>
            <p className="text-xs text-slate-500">{item.reason}</p>
            {typeof item.input?.amount === 'number' && <p className="text-xs">Amount: {item.input.amount} SAR</p>}</div>
          <div className="flex gap-2"><button className="btn-ghost" onClick={() => void decide(item, false)}>Reject</button>
            <button className="btn-admin" onClick={() => void decide(item, true)}>Approve</button></div>
        </div>)}</section>
  </div>
}
