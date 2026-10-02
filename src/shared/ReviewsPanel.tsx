import { useCallback, useEffect, useState } from 'react'
import { Star, MessageSquareReply, ShieldCheck, User } from 'lucide-react'
import { reviewsApi, type ApiReview } from '../api'
import { toast, ListRowSkeleton } from '../ui'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'


/**
 * "What people say about us", for any portal.
 *
 * One component rather than a copy per portal: the fuel and maintenance desks
 * had no reviews page at all, and the shape of the answer is identical for
 * every business type now that `/reviews/about-me` resolves it from the
 * review's denormalised `provider`.
 *
 * It also lists reviews of the business's own **staff** — that is the roll-up
 * working as intended. A workshop is accountable for the technicians it sends
 * out, so a rating of one of them belongs on the workshop's page, labelled as
 * being about a person rather than the business.
 */

const TARGET_LABEL: Record<string, string> = {
  boat: 'Boat',
  trip: 'Trip',
  captain: 'Captain',
  marina: 'Marina',
  fuel_station: 'Station',
  maintenance_shop: 'Workshop',
  staff: 'Team member',
}

function nameOf(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return (o.name as string) || (o.nameEn as string) || undefined
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={translatePortalText(`${n} out of 5`)}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={13} className={i <= n ? 'fill-amber-700 text-amber-700 dark:fill-amber-400 dark:text-amber-400' : 'text-slate-400'} />
      ))}
    </span>
  )
}

export default function ReviewsPanel({ accentClass = 'btn-fuel' }: { accentClass?: string }) {
  const [items, setItems] = useState<ApiReview[]>([])
  const [summary, setSummary] = useState<{ average: number; count: number }>({ average: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  const [onlyUnanswered, setOnlyUnanswered] = useState(false)
  /** Which review's reply box is open, and what has been typed into it. */
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await reviewsApi.aboutMe({ limit: 50, ...(onlyUnanswered ? { unanswered: true } : {}) })
      setItems(r.data.items || [])
      setSummary(r.data.summary ?? { average: 0, count: 0 })
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load reviews'), 'warn')
    } finally {
      setLoading(false)
    }
  }, [onlyUnanswered])

  useEffect(() => { void load() }, [load])

  const sendReply = async (id: string) => {
    if (!replyText.trim()) return
    setBusy(true)
    try {
      await reviewsApi.reply(id, replyText.trim())
      setReplyingTo(null)
      setReplyText('')
      await load()
      toast(translatePortalText('Reply posted'))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not post that reply'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold tabular-nums">
            {summary.count ? formatPortalNumber(summary.average, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
          </span>
          <Stars n={Math.round(summary.average)} />
          <span className="text-xs font-semibold text-slate-400">
            {formatPortalNumber(summary.count)} {translatePortalText(summary.count === 1 ? 'review' : 'reviews')}
          </span>
        </div>
        <label className="ms-auto flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-500">
          <input
            type="checkbox"
            checked={onlyUnanswered}
            onChange={e => setOnlyUnanswered(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          {translatePortalText("Needs a reply\n        ")}</label>
      </div>

      {loading && <ListRowSkeleton count={3} />}

      {!loading && items.length === 0 && (
        <div className="py-10 text-center text-sm text-slate-400">
          {translatePortalText(onlyUnanswered ? 'Every review has been answered.' : 'No reviews yet.')}
        </div>
      )}

      {!loading && items.map(r => {
        const author = typeof r.author === 'object' ? r.author : undefined
        const staffName = nameOf(r.staff)
        return (
          <div key={r.id || r._id} className="rounded-2xl border border-slate-100 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-slate-500">
                {author?.avatar ? <img src={author.avatar} alt="" className="h-full w-full object-cover" /> : <User size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-deep-900">{author?.name || translatePortalText('A customer')}</span>
                  <Stars n={r.rating} />
                  {/* Every review is verified now, but the badge still earns its
                      place: it tells the business this came from a real job. */}
                  {r.verifiedPurchase && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                      <ShieldCheck size={11} /> {translatePortalText("Verified\n                    ")}</span>
                  )}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                    {translatePortalText(TARGET_LABEL[r.targetType || ''] || 'Review')}
                  </span>
                  <span className="ms-auto text-[11px] text-slate-400">
                    {formatPortalDate(r.createdAt)}
                  </span>
                </div>

                {/* Named when the review is about a person, so the desk knows
                    whose work is being rated rather than reading it as feedback
                    on the business as a whole. */}
                {r.targetType === 'staff' && staffName && (
                  <p className="mt-0.5 text-[11px] font-semibold text-violet-600">{translatePortalText("About ")}{staffName}</p>
                )}

                {!!r.comment && <p className="mt-1.5 text-sm text-slate-600">{r.comment}</p>}

                {r.reply?.text ? (
                  <div className="mt-2.5 rounded-xl border-s-2 border-slate-300 bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText("Your reply")}</p>
                    <p className="text-sm text-slate-600">{r.reply.text}</p>
                  </div>
                ) : replyingTo === (r.id || r._id) ? (
                  <div className="mt-2.5 space-y-2">
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder={translatePortalText("Answer publicly…")}
                      className="input w-full text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        className={`${accentClass} !py-1.5 !px-3 text-xs`}
                        disabled={busy || !replyText.trim()}
                        onClick={() => void sendReply(r.id || r._id)}
                      >
                        {translatePortalText(busy ? 'Posting…' : 'Post reply')}
                      </button>
                      <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => { setReplyingTo(null); setReplyText('') }}>
                        {translatePortalText("Cancel\n                      ")}</button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-deep-900"
                    onClick={() => { setReplyingTo(r.id || r._id); setReplyText('') }}
                  >
                    <MessageSquareReply size={13} /> {translatePortalText("Reply\n                  ")}</button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
