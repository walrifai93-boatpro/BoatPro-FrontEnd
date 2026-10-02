import React, { useEffect, useState } from 'react'
import { LifeBuoy, Plus, Send } from 'lucide-react'
import { SupportConsole } from './SupportConsole'
import { supportApi, type ApiChat, type SupportDesk } from '../api'
import { Modal, toast, Spinner } from '../ui'
import { translatePortalText } from '../i18n/runtime'


/**
 * A provider's support page.
 *
 * Two halves, because a business on this platform sits on both sides of support
 * at once: it *answers* boat operators who raise problems with its berths, fuel
 * or servicing, and it *asks* the platform when something is wrong with its own
 * account. The desk queue is the first; the composer at the top is the second.
 *
 * Both run on the same support threads, so a reply typed here lands in the other
 * party's inbox as an ordinary message rather than in a ticket system they have
 * to be told to check.
 */
export default function ProviderSupport({
  title = 'Support',
  accentClass = 'btn-primary',
}: {
  title?: string
  /** The portal's own call-to-action class, so this looks native in each vertical. */
  accentClass?: string
}) {
  const [composing, setComposing] = useState(false)

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <LifeBuoy className="text-ocean-500" size={20} />
          <div>
            <h1 className="font-display text-2xl font-extrabold text-deep-900">{translatePortalText(title)}</h1>
            <p className="text-xs text-slate-400">
              {translatePortalText("Answer the operators you serve, and raise anything you need from BoatPro.\n            ")}</p>
          </div>
        </div>
        <button onClick={() => setComposing(true)} className={`${accentClass} !py-2 !px-3.5 !text-[12px]`}>
          <Plus size={13} /> {translatePortalText("Contact BoatPro\n        ")}</button>
      </div>

      <SupportConsole
        title={translatePortalText("Your desk")}
        sub={translatePortalText("Conversations boat operators have opened with your business.")}
      />

      <NewThreadModal open={composing} onClose={() => setComposing(false)} accentClass={accentClass} />
    </div>
  )
}

/**
 * Raising a ticket with another desk.
 *
 * The desk list comes from the server rather than being hardcoded: which desks
 * an account may write to is a function of its role, and a marina that could
 * suddenly see a "contact a fuel station" option it is not allowed to use would
 * only produce a 403 at the end of the form.
 */
export function NewThreadModal({
  open,
  onClose,
  accentClass,
  onOpened,
}: {
  open: boolean
  onClose: () => void
  accentClass: string
  onOpened?: (chat: ApiChat) => void
}) {
  const [desks, setDesks] = useState<{ desk: SupportDesk; requiresProvider: boolean }[]>([])
  const [desk, setDesk] = useState<SupportDesk>('admin')
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([])
  const [deskOwnerId, setDeskOwnerId] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    supportApi.desks().then(r => setDesks(r.data.desks)).catch(() => setDesks([{ desk: 'admin', requiresProvider: false }]))
  }, [open])

  const requiresProvider = desks.find(d => d.desk === desk)?.requiresProvider ?? false

  useEffect(() => {
    if (!requiresProvider) { setProviders([]); setDeskOwnerId(''); return }
    supportApi.deskProviders(desk)
      .then(r => setProviders(r.data.providers.map(p => ({ id: p.id ?? p._id, label: p.business?.businessName || p.name }))))
      .catch(() => setProviders([]))
  }, [desk, requiresProvider])

  const submit = async () => {
    if (!subject.trim() || !message.trim() || (requiresProvider && !deskOwnerId)) return
    setSending(true)
    try {
      const res = await supportApi.open({
        desk,
        deskOwnerId: deskOwnerId || undefined,
        subject: subject.trim(),
        message: message.trim(),
      })
      toast(translatePortalText(`Help request sent — ${(res.data.chat as ApiChat).support?.reference ?? ''}`))
      setSubject(''); setMessage(''); setDeskOwnerId('')
      onClose()
      onOpened?.(res.data.chat)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not open the conversation'), 'warn')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("New help request")}>
      <div className="space-y-3">
        {desks.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Who should help?")}</span>
            <select className="input" value={desk} onChange={e => { setDesk(e.target.value as SupportDesk); setDeskOwnerId('') }}>
              {desks.map(d => (
                <option key={d.desk} value={d.desk}>
                  {translatePortalText(d.desk === 'admin' ? 'BoatPro support' : `A ${d.desk} provider`)}
                </option>
              ))}
            </select>
          </label>
        )}

        {requiresProvider && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Which business?")}</span>
            <select className="input" value={deskOwnerId} onChange={e => setDeskOwnerId(e.target.value)}>
              <option value="">{translatePortalText("Choose…")}</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("What do you need help with?")}</span>
          <input className="input" value={subject} onChange={e => setSubject(e.target.value)} maxLength={200}
            placeholder={translatePortalText("A few words — e.g. Payout for July has not arrived")} />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Details")}</span>
          <textarea className="input min-h-[110px]" value={message} onChange={e => setMessage(e.target.value)}
            maxLength={4000} placeholder={translatePortalText("Tell us what happened and what you need us to check")}/>
        </label>

        <button onClick={() => void submit()} disabled={sending || !subject.trim() || !message.trim() || (requiresProvider && !deskOwnerId)}
          className={`${accentClass} w-full !justify-center disabled:opacity-40`}>
          {sending ? <Spinner /> : <Send size={14} />} {translatePortalText("Send request")}</button>
      </div>
    </Modal>
  )
}
