import React, { useRef, useState } from 'react'
import { Paperclip, BarChart3, X, Send, Loader2 } from 'lucide-react'
import { chatApi, type ApiMessage } from '../api'
import { toast, Spinner } from '../ui'
import { formatPortalNumber, translatePortalText } from '../i18n/runtime'


/**
 * Attaching things, for every web chat screen.
 *
 * The web composer was a text box and a send button, so a file or a report could
 * be *received* on the web and never sent from it — a support agent could read the
 * certificate a provider had attached and had no way to send one back. Both
 * screens now mount this next to their input rather than growing their own copy,
 * because two copies is exactly how one of them ends up with report sharing and
 * the other only with files.
 *
 * `onSent` hands the created message straight back rather than asking the host to
 * refetch: the thread is already on screen, and a reload to show one new message
 * puts a spinner over a conversation somebody is reading.
 */

/** What the server's `docUpload` filter admits. Stated so the picker matches it. */
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'
const MAX_BYTES = 15 * 1024 * 1024

export function ChatAttachments({
  chatId,
  replyTo,
  disabled,
  accentClass = 'btn-primary',
  onSent,
}: {
  chatId: string
  /** Carried onto the attachment, so a file can answer a specific message. */
  replyTo?: string
  disabled?: boolean
  accentClass?: string
  onSent: (message: ApiMessage) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset immediately: without this, choosing the same file twice in a row fires
    // no change event the second time and the send silently does nothing.
    e.target.value = ''
    if (!file) return

    /*
      Checked here as well as on the server.

      Not instead of — the server is the authority. But a 15 MB limit enforced only
      server-side means the user waits out the whole upload before being told, on
      exactly the slow connection where that matters most.
    */
    if (file.size > MAX_BYTES) {
      toast(translatePortalText(`${file.name} is ${formatPortalNumber(file.size / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB — the limit is ${formatPortalNumber(15)} MB`), 'warn')
      return
    }

    setUploading(true)
    try {
      const res = await chatApi.sendMedia(chatId, file, { replyTo })
      onSent(res.data.message)
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'That file could not be sent'), 'warn')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED}
        onChange={e => void pickFile(e)}
        className="hidden"
        // Labelled for screen readers even though it is visually hidden — the
        // button below is what gets clicked, but the input is what is focused.
        aria-label={translatePortalText("Attach a file")}
      />

      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={disabled || uploading}
        title={translatePortalText("Attach an image or PDF (up to 15 MB)")}
        className="btn-ghost !px-2 !py-2 disabled:opacity-40"
      >
        {uploading ? <Spinner size={13} /> : <Paperclip size={14} />}
      </button>

      <button
        type="button"
        onClick={() => setReportOpen(true)}
        disabled={disabled}
        title={translatePortalText("Share one of your reports")}
        className="btn-ghost !px-2 !py-2 disabled:opacity-40"
      >
        <BarChart3 size={14} />
      </button>

      {reportOpen && (
        <ShareReportDialog
          chatId={chatId}
          replyTo={replyTo}
          accentClass={accentClass}
          onClose={() => setReportOpen(false)}
          onSent={m => {
            onSent(m)
            setReportOpen(false)
          }}
        />
      )}
    </>
  )
}

/**
 * Picks a report and shares it.
 *
 * The catalog comes from the server so it can only contain reports this account may
 * actually run — a picker built from a hardcoded list would offer things the share
 * endpoint then refuses, and the user would have no idea why.
 *
 * The window defaults to the last 30 days, matching the server's own default, and
 * is sent explicitly so the message records the period it covers. A shared
 * spreadsheet whose window is unstated is a number nobody can check.
 */
function ShareReportDialog({
  chatId,
  replyTo,
  accentClass,
  onClose,
  onSent,
}: {
  chatId: string
  replyTo?: string
  accentClass: string
  onClose: () => void
  onSent: (m: ApiMessage) => void
}) {
  // Local date parts: a report bounded with a UTC-converted day asks the
  // server for a window one day off what the operator picked.
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const [reports, setReports] = useState<
    { key: string; label: string; group: string; description: string; dateRanged: boolean }[] | null
  >(null)
  /** Whose figures the shared report will contain, when the server could tell. */
  const [subject, setSubject] = useState<{ name: string; vertical: string } | null>(null)
  const [format, setFormat] = useState<'excel' | 'csv' | 'pdf'>('excel')
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo] = useState(iso(new Date()))
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [sendingKey, setSendingKey] = useState<string | null>(null)

  React.useEffect(() => {
    /*
      Asked per conversation, not per account.

      The account-wide list is the wrong list here: a thread with a boat operator
      has no use for fuel margin or berth revenue, and for an admin the
      account-wide list is every report on the platform.
    */
    // Switching conversations refetches: a slow answer for the previous chat
    // would otherwise list that counterpart's reports — and their name as the
    // subject — under the conversation now open.
    let alive = true
    chatApi
      .chatShareableReports(chatId)
      .then(res => {
        if (!alive) return
        setReports(res.data.reports)
        setSubject(
          res.data.counterpart
            ? { name: res.data.counterpart.name, vertical: res.data.counterpart.vertical }
            : null
        )
      })
      .catch(() => { if (alive) setReports([]) })
    return () => { alive = false }
  }, [chatId])

  const share = async (key: string) => {
    setSendingKey(key)
    try {
      const res = await chatApi.shareReport(chatId, {
        key,
        format,
        from,
        to,
        note: note.trim() || undefined,
        replyTo,
      })
      onSent(res.data.message)
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'That report could not be shared'), 'warn')
    } finally {
      setSendingKey(null)
    }
  }

  const shown = (reports ?? []).filter(r =>
    search.trim()
      ? `${r.label} ${r.description} ${translatePortalText(r.label)} ${translatePortalText(r.description)}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      : true
  )

  /** Grouped, because a flat list of forty reports is not a picker. */
  const grouped = [...new Map<string, typeof shown>(
    shown.map(r => [r.group, shown.filter(x => x.group === r.group)])
  ).entries()]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        // Stops a click inside from closing it — the backdrop is the dismiss
        // target, the panel is not.
        onClick={e => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
        role="dialog"
        aria-label={translatePortalText("Share a report")}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-extrabold text-deep-900">{translatePortalText("Share a report")}</h3>
            {/*
              Says whose figures these are.

              An admin sharing into a provider's thread gets a report scoped to
              *that* provider by default, and a picker that did not say so would
              hand over a platform-wide figure the reader assumes is theirs.
            */}
            <p className="text-[11px] text-slate-400">
              {subject
                ? translatePortalText(`About ${subject.name} — only their ${subject.vertical} data.`)
                : translatePortalText('Runs on the server under your own account, so it only ever contains your data.')}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost !px-1.5 !py-1.5" aria-label={translatePortalText("Close")}>
            <X size={14} />
          </button>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {translatePortalText("From\r\n            ")}<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
              className="input !mt-0.5 !py-1.5 !text-[12px]" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {translatePortalText("To\r\n            ")}<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
              className="input !mt-0.5 !py-1.5 !text-[12px]" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {translatePortalText("Format\r\n            ")}<select value={format} onChange={e => setFormat(e.target.value as 'excel' | 'csv' | 'pdf')}
              className="input !mt-0.5 !py-1.5 !text-[12px]">
              <option value="excel">{translatePortalText("Excel")}</option>
              <option value="csv">{translatePortalText("CSV")}</option>
              <option value="pdf">{translatePortalText("PDF")}</option>
            </select>
          </label>
        </div>

        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={translatePortalText("Add a note (optional)")}
          className="input mb-2 !py-1.5 !text-[12px]"
        />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={translatePortalText("Find a report…")}
          className="input mb-2 !py-1.5 !text-[12px]"
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {reports === null ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : !shown.length ? (
            <p className="py-10 text-center text-xs text-slate-400">
              {translatePortalText(reports.length ? 'Nothing matches that.' : 'No reports available on your account.')}
            </p>
          ) : (
            grouped.map(([group, list]) => (
              <div key={group} className="mb-2">
                <p className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {translatePortalText(group)}
                </p>
                {list.map(r => (
                  <button
                    key={r.key}
                    onClick={() => void share(r.key)}
                    disabled={sendingKey !== null}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start hover:bg-slate-50 disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-bold text-deep-900">{translatePortalText(r.label)}</span>
                      <span className="line-clamp-2 block text-[10.5px] text-slate-400">{translatePortalText(r.description)}</span>
                    </span>
                    {sendingKey === r.key ? (
                      <Loader2 size={14} className="animate-spin text-slate-400" />
                    ) : (
                      <Send size={13} className="shrink-0 text-slate-300" />
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <p className={`mt-2 text-[10px] text-slate-400 ${accentClass ? '' : ''}`}>
          {translatePortalText("The file is generated from the same query as the download, so the two always agree.\r\n        ")}</p>
      </div>
    </div>
  )
}

export default ChatAttachments
