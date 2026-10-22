import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Ship, Heart, Phone, Mail, MessageSquare, Anchor } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, Badge, Modal, toast, SearchInput, Img, ViewToggle, AsyncBlock, EmptyState, ListRowSkeleton } from '../ui'
import { TablePagination, useTableFilters, type TableFiltersConfig } from '../shared/TableFilters'
import { boatPhoto } from '../images'
import { boatTypeLabel, useAsync, useMarina, berthLabel, fmtDate, fmtRelative, formatMoney, humanize } from '../live'
import { chatApi, idOf, portalApi, reservationsApi, fileUrl, type ApiMarinaBoat, type ApiMarinaCustomer } from '../api'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'


const avatarFor = (name?: string, avatar?: string) =>
  fileUrl(avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(name ?? '?')}&background=e2e8f0&color=475569`

/**
 * A loyalty tier from what the berth holder has actually spent here — the badge
 * palette the portal already uses, driven by real money rather than a stored flag.
 */
const tierFor = (spend: number): 'Platinum' | 'Gold' | 'Silver' | 'Standard' =>
  spend >= 100_000 ? 'Platinum' : spend >= 50_000 ? 'Gold' : spend >= 10_000 ? 'Silver' : 'Standard'

/** The operator's own shortlist of berth holders, kept on this device. */
const FAV_KEY = 'bp-marina-favourites'
function useFavourites() {
  const [fav, setFav] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? '{}') } catch { return {} }
  })
  const toggle = (id: string) => {
    setFav(f => {
      const next = { ...f, [id]: !f[id] }
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }
  return { fav, toggle }
}

// ═══ Customers ═══
export function Customers() {
  const { currency } = useMarina()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<ApiMarinaCustomer | null>(null)
  const [view, setView] = useState<'card' | 'table'>('table')
  const [messaging, setMessaging] = useState(false)
  const { fav, toggle } = useFavourites()

  const state = useAsync(() => portalApi.customers({ search: q.trim() || undefined, limit: 100 }).then(r => r.data), [q])
  const rows = state.data?.items ?? []
  // The API pages at 100; the table below pages within what came back. Count
  // from the server's total so the header is not capped at 100.
  const total = state.data?.pagination?.total ?? rows.length
  const custCfg: TableFiltersConfig<ApiMarinaCustomer> = useMemo(() => ({
    searchFields: (c) => [c.name, c.email, c.role, ...(c.boats || []).map(b => b.name)],
  }), [])
  const custTf = useTableFilters(rows, custCfg)

  const message = async (c: ApiMarinaCustomer) => {
    setMessaging(true)
    try {
      const participantId = idOf(c)
      if (!participantId) throw new Error('This customer does not have a BoatPro account')
      await chatApi.create(participantId)
      toast(translatePortalText(`Conversation with ${c.name} opened`))
      nav('/messages')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not start that conversation'), 'warn')
    } finally { setMessaging(false) }
  }

  return (
    <div>
      <PageHeader title={translatePortalText("Boat Provider Management")} icon={<Users className="text-ocean-500" />}
        sub={translatePortalText(`${total} registered boat owners · profiles, membership, docking history & spend`)}
        actions={<>
          <ViewToggle view={view} onChange={setView} />
          <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search boat providers…")} />
        </>} />

      <AsyncBlock state={state} loadingLabel="Loading berth holders…"
        empty={d => d.items.length === 0
          ? { icon: '👤', text: q ? `Nobody matches “${q}”` : 'No boat providers yet — they appear here as berth reservations come in.' }
          : null}>
        {() => <>
        {total > rows.length && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
            {translatePortalText(`Showing the ${rows.length} highest-spending of ${total} — search by name, email or phone to find the others.`)}
          </p>
        )}
        {view === 'card' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 items-start gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {custTf.pagedRows.map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }}
                className="card card-hover relative p-5">
                <button title={translatePortalText("Add to your shortlist (kept on this device)")}
                  onClick={() => { toggle(c.id); toast(translatePortalText(fav[c.id] ? `${c.name} removed from favorites` : `${c.name} added to favorites ❤️`)) }}
                  className={`absolute end-4 top-4 transition ${fav[c.id] ? 'text-rose-500' : 'text-slate-400 hover:text-rose-500'}`}>
                  <Heart size={18} fill={fav[c.id] ? 'currentColor' : 'none'} />
                </button>
                <div className="flex items-center gap-3">
                  <img src={avatarFor(c.name, c.avatar)} alt="" className="h-14 w-14 rounded-2xl object-cover ring-2 ring-ocean-100" />
                  <div>
                    <p className="font-display font-extrabold text-deep-900">{c.name}</p>
                    <p className="text-xs text-slate-400">{translatePortalText(humanize(c.role))} {translatePortalText("· since ")}{formatPortalDate(c.memberSince, { year: 'numeric' })}</p>
                    <Badge>{tierFor(c.totalSpend)}</Badge>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-base font-extrabold text-deep-900">{formatPortalNumber(c.reservations)}</p><p className="text-slate-400">{translatePortalText("stays")}</p></div>
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-base font-extrabold text-deep-900">{formatMoney(c.totalSpend, currency, { compact: true })}</p><p className="text-slate-400">{translatePortalText("lifetime spend")}</p></div>
                </div>
                <button className="btn-ghost mt-3 w-full justify-center text-xs" onClick={() => setSel(c)}>{translatePortalText("Open profile")}</button>
              </motion.div>
            ))}
            </div>
            <TablePagination state={custTf} noun="boat providers" />
          </div>
        ) : (
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[920px]">
                <thead><tr className="border-b border-slate-100 bg-sand/50">
                  <th className="th">{translatePortalText("Boat Provider")}</th><th className="th">{translatePortalText("Membership")}</th><th className="th">{translatePortalText("Boats")}</th><th className="th text-right">{translatePortalText("Stays")}</th><th className="th text-right">{translatePortalText("Lifetime spend")}</th><th className="th text-right">{translatePortalText("Actions")}</th>
                </tr></thead>
                <tbody>
                  {custTf.pagedRows.map((c, i) => (
                    <motion.tr key={c.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
                      className="border-b border-slate-50 transition hover:bg-sand/60">
                      <td className="td">
                        <div className="flex items-center gap-2.5">
                          <img src={avatarFor(c.name, c.avatar)} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-ocean-50" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-extrabold text-deep-900">
                              {c.name} {fav[c.id] && <Heart size={12} className="inline text-rose-500" fill="currentColor" />}
                            </p>
                            {/* `lastSeen` is the newest reservation here, not a sign-in time. */}
                            <p className="truncate text-[11px] text-slate-400">{c.email} · {translatePortalText("last booking")} {fmtRelative(c.lastSeen)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="td"><Badge>{tierFor(c.totalSpend)}</Badge></td>
                      <td className="td max-w-[220px] truncate text-xs text-slate-500">⛵ {c.boats.map(b => b.name).join(', ') || translatePortalText('None')}</td>
                      <td className="td text-right text-xs font-bold text-deep-900">{formatPortalNumber(c.reservations)}{c.activeReservations ? ` · ${translatePortalText(`${c.activeReservations} live`)}` : ''}</td>
                      <td className="td text-right font-display font-extrabold">{formatMoney(c.totalSpend, currency)}</td>
                      <td className="td text-right"><button className="btn-ghost !py-1.5 !px-2.5 text-[11px]" onClick={() => setSel(c)}>{translatePortalText("Open profile")}</button></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination state={custTf} noun="boat providers" />
          </div>
        )}
        </>}
      </AsyncBlock>

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? translatePortalText(`👤 ${sel.name}`) : ''} wide>
        {sel && <CustomerProfile customer={sel} currency={currency} messaging={messaging} onMessage={() => message(sel)} />}
      </Modal>
    </div>
  )
}

/** The berth holder's real profile: contact, spend, boats and stay history. */
function CustomerProfile({ customer: c, currency, messaging, onMessage }: {
  customer: ApiMarinaCustomer; currency: string; messaging: boolean; onMessage: () => void
}) {
  // The reservations search matches boat name, plate and reservation number —
  // never the holder's name — so searching `c.name` found nothing, and the
  // populated subscriber carries `_id` only, so `who.id === c.id` never matched
  // either. Search by each of their plates (names when there is no plate) and
  // keep the rows that really are theirs.
  const history = useAsync(async () => {
    const terms = [...new Set(c.boats.map(b => (b.plate || b.name || '').trim()).filter(Boolean))].slice(0, 6)
    const pages = await Promise.all(terms.map(term => reservationsApi.list({ status: 'all', search: term, limit: 50 }).then(r => r.data.items)))
    const seen = new Set<string>()
    return pages.flat()
      .filter(r => idOf(r.subscriber) === String(c.id))
      .filter(r => { const id = idOf(r); if (seen.has(id)) return false; seen.add(id); return true })
      .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))
  }, [c.id])
  const stays = history.data ?? []

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <div className="flex items-center gap-4">
          <img src={avatarFor(c.name, c.avatar)} className="h-16 w-16 rounded-2xl object-cover ring-2 ring-ocean-100" alt="" />
          <div>
            <Badge>{tierFor(c.totalSpend)}</Badge>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Mail size={12} /> {c.email}</p>
            {c.phone && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Phone size={12} /> {c.phone}</p>}
          </div>
        </div>

        <p className="label mt-4">{translatePortalText("With this marina")}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            ['First seen', fmtDate(c.memberSince)],
            ['Last booking', fmtRelative(c.lastSeen)],
            ['Berth spend', formatMoney(c.berthSpend, currency)],
            ['Service spend', formatMoney(c.serviceSpend, currency)],
            ['Stays', formatPortalNumber(c.reservations)],
            ['Live berths', formatPortalNumber(c.activeReservations)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-sand px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(l)}</p>
              <p className="font-bold text-deep-900">{v}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          {c.email && <a className="btn-ghost flex-1 justify-center text-xs" href={`mailto:${c.email}`}><Mail size={13} /> {translatePortalText("Email")}</a>}
          {c.phone && <a className="btn-ghost flex-1 justify-center text-xs" href={`tel:${c.phone}`}><Phone size={13} /> {translatePortalText("Call")}</a>}
          <button className="btn-primary flex-1 justify-center text-xs" disabled={messaging} onClick={onMessage}>
            <MessageSquare size={13} /> {translatePortalText(messaging ? 'Opening…' : 'Message')}
          </button>
        </div>
      </div>

      <div>
        <p className="label">{translatePortalText("Boats")}</p>
        {c.boats.length === 0 && <p className="rounded-xl bg-sand p-3 text-xs text-slate-500">{translatePortalText("No boats on record.")}</p>}
        {/* The same boat can repeat with a different length per stay; the index keeps keys unique. */}
        {c.boats.map((b, i) => (
          <div key={`${b.name}-${b.plate}-${i}`} className="mb-2 flex items-center gap-3 rounded-xl border border-slate-100 p-2.5">
            <Img src={boatPhoto(b.name)} className="h-10 w-10 rounded-lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-deep-900">{b.name || translatePortalText('Unnamed vessel')}</p>
              <p className="truncate text-xs text-slate-400">{b.lengthFt ? `${formatPortalNumber(b.lengthFt)} ${translatePortalText('ft')} ` : ''}{translatePortalText(humanize(b.type))} · {b.plate || translatePortalText('No registration')}</p>
            </div>
          </div>
        ))}

        <p className="label mt-4">{translatePortalText("Reservation history")}</p>
        <div className="max-h-44 space-y-1.5 overflow-y-auto">
          {history.loading && !history.data && <ListRowSkeleton count={2} />}
          {history.error && !history.data && <p className="text-xs text-rose-500">{translatePortalText("Could not load the reservation history.")}</p>}
          {!history.loading && !history.error && stays.length === 0 && <p className="text-xs text-slate-400">{translatePortalText("No reservations found.")}</p>}
          {stays.map(r => (
            <div key={r.id} className="flex items-center gap-2 rounded-xl bg-sand px-3 py-2 text-xs">
              <span className="font-mono font-bold text-slate-500">{r.reservationNo}</span>
              <span className="text-slate-400">{formatPortalDate(new Date(`${r.startDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })} → {formatPortalDate(new Date(`${r.endDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
              <span className="ms-auto font-display font-extrabold text-deep-900">{formatMoney(r.totalSar, currency)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══ Boats ═══
export function Boats() {
  const { currency } = useMarina()
  const [q, setQ] = useState('')
  const [view, setView] = useState<'card' | 'table'>('card')
  const [sel, setSel] = useState<ApiMarinaBoat | null>(null)

  const state = useAsync(() => portalApi.boats({ search: q.trim() || undefined, limit: 100 }).then(r => r.data), [q])
  const rows = state.data?.items ?? []
  const total = state.data?.pagination?.total ?? rows.length
  // Counted from the rows that came back (the newest 100 stays at most).
  const berthed = rows.filter(b => b.currentBerth)
  const boatCfg: TableFiltersConfig<ApiMarinaBoat> = useMemo(() => ({
    searchFields: (b) => [b.name, b.plate, b.boatType, b.owner?.name, b.owner?.email],
  }), [])
  const boatTf = useTableFilters(rows, boatCfg)

  return (
    <div>
      <PageHeader title={translatePortalText("Registered Boats")} icon={<Ship className="text-ocean-500" />}
        sub={translatePortalText(`${total} vessels on the register · ${berthed.length} berthed right now`)}
        actions={<>
          <ViewToggle view={view} onChange={setView} />
          <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search boat or registration…")} />
        </>} />

      <AsyncBlock state={state} loadingLabel="Loading the register…"
        empty={d => d.items.length === 0 ? { icon: '⛵', text: translatePortalText(q ? `No boats match “${q}”` : 'No boats registered yet.') } : null}>
        {() => <>
        {total > rows.length && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
            {translatePortalText(`Showing the ${rows.length} most recent of ${total} — search by boat name or registration to find the others.`)}
          </p>
        )}
        {view === 'card' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {boatTf.pagedRows.map((b, i) => (
              <motion.button key={`${b.name}-${b.plate}-${i}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }}
                onClick={() => setSel(b)} className="card card-hover overflow-hidden !p-0 text-left">
                <div className="relative">
                  <Img src={boatPhoto(b.name)} className="h-40 w-full" />
                  <div className="absolute end-3 top-3">
                    {/* Was "Completed" — a boat with no live lease is simply not alongside. */}
                    {b.currentBerth ? <Badge dot>Occupied</Badge> : <Badge>Not berthed</Badge>}
                  </div>
                </div>
                <div className="p-5">
                  <p className="truncate font-display text-lg font-extrabold text-deep-900">{b.name || translatePortalText('Unnamed vessel')}</p>
                  <p className="truncate text-xs text-slate-400">{translatePortalText(boatTypeLabel(b.boatType))} · {b.plate || translatePortalText('No registration')}</p>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                    {[['LOA', b.lengthFt], ['Beam', b.widthFt], ['Draft', b.draftFt]].map(([l, v]) => (
                      <div key={l as string} className="rounded-lg bg-sand py-1.5">
                        <p className="font-extrabold text-deep-900">{v ? `${formatPortalNumber(Number(v))} ${translatePortalText('ft')}` : '—'}</p><p className="text-slate-400">{translatePortalText(String(l))}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    {b.currentBerth
                      ? <>{translatePortalText("Berth ")}<b className="text-ocean-700">{berthLabel(b.currentBerth.pontoon, b.currentBerth.slot)}</b> {translatePortalText("to ")}{fmtDate(b.currentBerth.endDate)}</>
                      : <>{translatePortalText("Last stay ")}{fmtRelative(b.lastStay)}</>}
                  </p>
                  {b.owner && <p className="mt-1 truncate text-xs text-slate-400">👤 {b.owner.name}</p>}
                </div>
              </motion.button>
            ))}
            </div>
            <TablePagination state={boatTf} noun="boats" />
          </div>
        ) : (
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[960px]">
                <thead><tr className="border-b border-slate-100 bg-sand/50">
                  <th className="th">{translatePortalText("Boat")}</th><th className="th">{translatePortalText("Owner")}</th><th className="th">{translatePortalText("Specs (LOA/beam/draft)")}</th>
                  <th className="th">{translatePortalText("Berth")}</th><th className="th text-right">{translatePortalText("Stays")}</th><th className="th text-right">{translatePortalText("Spend")}</th><th className="th">{translatePortalText("Last stay")}</th>
                </tr></thead>
                <tbody>
                  {boatTf.pagedRows.map((b, i) => (
                    <motion.tr key={`${b.name}-${b.plate}-${i}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
                      className="cursor-pointer border-b border-slate-50 transition hover:bg-sand/60" onClick={() => setSel(b)}>
                      <td className="td">
                        <div className="flex items-center gap-2.5">
                          <Img src={boatPhoto(b.name)} className="h-9 w-9 shrink-0 rounded-xl" />
                          <div className="min-w-0">
                            <p className="truncate font-bold text-deep-900">{b.name || translatePortalText('Unnamed vessel')}</p>
                            <p className="truncate text-[11px] text-slate-400">{b.plate || translatePortalText('No registration')} · {translatePortalText(boatTypeLabel(b.boatType))}</p>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        {b.owner ? (
                          <div className="flex items-center gap-2">
                            <img src={avatarFor(b.owner.name, b.owner.avatar)} className="h-7 w-7 rounded-full object-cover" alt="" />
                            <div className="min-w-0"><p className="truncate text-xs font-semibold text-deep-900">{b.owner.name}</p><p className="truncate text-[10px] text-slate-400">{b.owner.email}</p></div>
                          </div>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="td whitespace-nowrap text-xs text-slate-500">{b.lengthFt != null ? formatPortalNumber(b.lengthFt) : '—'} / {b.widthFt != null ? formatPortalNumber(b.widthFt) : '—'} / {b.draftFt != null ? formatPortalNumber(b.draftFt) : '—'} {translatePortalText("ft")}</td>
                      <td className="td text-xs">
                        {b.currentBerth
                          ? <span className="rounded-lg bg-ocean-50 px-2 py-1 font-extrabold text-ocean-700">{berthLabel(b.currentBerth.pontoon, b.currentBerth.slot)}</span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="td text-right font-semibold text-deep-900">{formatPortalNumber(b.stays)}</td>
                      <td className="td text-right font-display font-extrabold">{formatMoney(b.spend, currency)}</td>
                      <td className="td whitespace-nowrap text-xs text-slate-400">{fmtRelative(b.lastStay)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination state={boatTf} noun="boats" />
          </div>
        )}
        </>}
      </AsyncBlock>

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `⛵ ${sel.name || translatePortalText('Unnamed vessel')}` : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-2xl">
              <Img src={boatPhoto(sel.name)} className="h-44 w-full" />
              <div className="absolute end-3 top-3">{sel.currentBerth ? <Badge dot>Occupied</Badge> : <Badge>Not berthed</Badge>}</div>
            </div>
            <div>
              <h3 className="break-words font-display text-xl font-extrabold text-deep-900">{sel.name || translatePortalText('Unnamed vessel')}</h3>
              <p className="text-xs text-slate-400">{translatePortalText(boatTypeLabel(sel.boatType))} {translatePortalText("· Reg ")}{sel.plate || translatePortalText('No registration')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[
                ['LOA', sel.lengthFt ? `${formatPortalNumber(sel.lengthFt)} ${translatePortalText('ft')}` : '—'],
                ['Beam', sel.widthFt ? `${formatPortalNumber(sel.widthFt)} ${translatePortalText('ft')}` : '—'],
                ['Draft', sel.draftFt ? `${formatPortalNumber(sel.draftFt)} ${translatePortalText('ft')}` : '—'],
                ['Stays', formatPortalNumber(sel.stays)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{translatePortalText(l)}</p>
                  <p className="text-xs font-bold text-deep-900">{v}</p>
                </div>
              ))}
            </div>
            {sel.currentBerth && (
              <p className="rounded-xl bg-ocean-50 px-3 py-2.5 text-sm text-ocean-700">
                {translatePortalText("Berthed at ")}<b>{berthLabel(sel.currentBerth.pontoon, sel.currentBerth.slot)}</b> {translatePortalText("until ")}{fmtDate(sel.currentBerth.endDate)}
              </p>
            )}
            {sel.owner && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
                <img src={avatarFor(sel.owner.name, sel.owner.avatar)} className="h-10 w-10 rounded-full object-cover" alt="" />
                <div className="min-w-0">
                  <p className="font-bold text-deep-900">{sel.owner.name}</p>
                  <p className="truncate text-xs text-slate-500">{sel.owner.email}{sel.owner.phone ? ` · ${sel.owner.phone}` : ''}</p>
                </div>
                <span className="ms-auto font-display font-extrabold text-deep-900">{formatMoney(sel.spend, currency)}</span>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
