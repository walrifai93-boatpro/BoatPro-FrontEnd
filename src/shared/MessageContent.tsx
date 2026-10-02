import { useState } from 'react'
import { FileSpreadsheet, FileText, Paperclip, Mic, CornerDownRight, Download, Languages } from 'lucide-react'
import { fileUrl, idOf, translateApi, type ApiMessage } from '../api'
import { detectTextLanguage, formatPortalDate, formatPortalNumber, getPortalLanguage, isPortalArabic, translatePortalText } from '../i18n/runtime'
import { AssistantMarkdown, stripMarkdown } from './AssistantMarkdown'

/**
 * What a message actually contains, rendered once for every chat screen on the web.
 *
 * Both web chat screens drew `m.text` and nothing else, which was fine while every
 * message was text. It is not fine now: an image, a document or a shared report has
 * no `text` at all, so each one rendered as an empty bubble — the sender saw their
 * attachment go, the recipient saw a blank box, and nothing anywhere reported an
 * error. One component rather than two copies, because that is exactly how the two
 * screens would drift again the next time a message type is added.
 */

const REPORT_ICON: Record<string, typeof FileText> = {
  csv: FileSpreadsheet,
  excel: FileSpreadsheet,
  pdf: FileText,
}

/**
 * Whether the signed-in account sent this message.
 *
 * Prefers the server's own `mine`, which cannot be wrong because the server knows
 * who asked. The id comparison is the fallback for socket-delivered messages,
 * which are broadcast to a room and so carry no per-recipient flag.
 *
 * Shared rather than reimplemented per screen: this is the comparison that had two
 * clients disagreeing about who spoke in the same thread, and the surest way back
 * to that is two copies of it.
 */
export function isMine(m: Pick<ApiMessage, 'mine' | 'sender'>, meId: string | undefined): boolean {
  if (typeof m.mine === 'boolean') return m.mine
  const senderId = typeof m.sender === 'string' ? m.sender : idOf(m.sender)
  return !!meId && !!senderId && String(senderId) === String(meId)
}

/** `1.4 MB`. Raw bytes tell a reader nothing about whether to click. */
function humanSize(bytes?: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${formatPortalNumber(bytes)} B`
  if (bytes < 1024 * 1024) return `${formatPortalNumber(Math.round(bytes / 1024))} KB`
  return `${formatPortalNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
}

/**
 * A short label for a message with no text of its own.
 *
 * Used in a reply quote, where a photo has nothing to quote — and an empty quote
 * reads as a rendering fault rather than as "they replied to a photo".
 */
export function messageKindLabel(type: ApiMessage['type'], fallback = ''): string {
  if (type === 'image') return `📷 ${translatePortalText('Photo')}`
  if (type === 'voice') return `🎤 ${translatePortalText('Voice message')}`
  if (type === 'report') return `📊 ${translatePortalText('Report')}`
  if (type === 'file') return `📎 ${translatePortalText('File')}`
  return fallback
}

/** The one-line preview for a thread list. */
export function messagePreview(m: Pick<ApiMessage, 'type' | 'text' | 'fileName' | 'report'>): string {
  if (m.text) return m.text
  if (m.type === 'report') return `📊 ${translatePortalText(m.report?.label ?? 'Report')}`
  if (m.type === 'file' && m.fileName) return `📎 ${m.fileName}`
  return messageKindLabel(m.type, '')
}

/**
 * Localizes fixed attachment previews, and flattens the assistant's Markdown
 * so a thread list shows "3 free berths" rather than "**3 free berths**".
 */
export function localizeMessagePreview(text: string | undefined): string {
  if (!text) return ''
  if (text === '📷 Photo') return messageKindLabel('image')
  if (text === '🎤 Voice message') return messageKindLabel('voice')
  if (text.startsWith('📊 ')) return `📊 ${translatePortalText(text.slice(3))}`
  return stripMarkdown(text)
}

/**
 * Whether BoatPro's AI assistant wrote this message.
 *
 * The server marks it three ways depending on the path it arrived by — a
 * `category` on the saved message, `isAI` on the socket payload, the `ai` tag —
 * so any one of them counts.
 */
export function isAssistantMessage(m: ApiMessage): boolean {
  const meta = m as ApiMessage & { category?: string; isAI?: boolean }
  return meta.category === 'ai_response' || meta.isAI === true || !!m.tags?.includes('ai')
}

export function MessageContent({ m, mine }: { m: ApiMessage; mine: boolean }) {
  /*
    Two colour sets, picked from whose side the bubble is on.

    Kept as explicit class strings rather than computed ones: Tailwind only emits
    classes it can see in the source, so a template-built class name silently
    produces an unstyled element in a production build.
  */
  const muted = mine ? 'text-white/60' : 'text-slate-400'
  const strong = mine ? 'text-white' : 'text-deep-900'
  const panel = mine ? 'bg-white/15' : 'bg-white'
  const accent = mine ? 'text-white/80' : 'text-ocean-600'

  const href = m.mediaUrl ? fileUrl(m.mediaUrl) : undefined
  const ReportIcon = m.report ? (REPORT_ICON[m.report.format] ?? FileSpreadsheet) : FileSpreadsheet

  return (
    <div className="space-y-1.5">
      {/* The quoted parent, above whatever this message is. */}
      {!!m.replyTo && (
        <div className={`rounded-lg border-s-2 ${mine ? 'border-white/50' : 'border-ocean-500'} ${panel} px-2 py-1`}>
          <p className={`text-[9.5px] font-bold ${accent}`}>{m.replyTo.senderName || translatePortalText('You')}</p>
          <p className={`line-clamp-2 text-[10.5px] ${muted}`}>
            {m.replyTo.text || messageKindLabel(m.replyTo.type)}
          </p>
        </div>
      )}

      {/* An image previews inline — a filename tells nobody what they were sent. */}
      {m.type === 'image' && !!href && (
        <a href={href} target="_blank" rel="noreferrer" className="block">
          <img
            src={href}
            alt={m.fileName || translatePortalText('Photo')}
            /* Capped rather than natural size: a portrait photo at full height
               pushes every other message out of the thread. */
            className="max-h-56 w-auto max-w-full rounded-lg object-cover"
            loading="lazy"
          />
        </a>
      )}

      {/* A document or voice note: what it is, how big, and a way in. */}
      {(m.type === 'file' || m.type === 'voice') && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`flex items-center gap-2 rounded-lg ${panel} px-2.5 py-2 no-underline`}
        >
          {m.type === 'voice' ? (
            <Mic size={15} className={accent} />
          ) : (
            <Paperclip size={15} className={accent} />
          )}
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[11.5px] font-bold ${strong}`}>
              {m.fileName || messageKindLabel(m.type)}
            </span>
            <span className={`block text-[9.5px] ${muted}`}>
              {m.type === 'voice' && m.duration
                ? `${formatPortalNumber(Math.round(m.duration))}${isPortalArabic() ? ' ث' : 's'}`
                : humanSize(m.fileSize) || translatePortalText('Open attachment')}
            </span>
          </span>
          <Download size={13} className={muted} />
        </a>
      )}

      {/*
        A shared report states what it says.

        The window, the row count and the headline figures on the bubble itself, so
        the recipient knows what they are looking at — and can read the totals —
        without downloading anything. A spreadsheet whose period is invisible is a
        number nobody can check.
      */}
      {m.type === 'report' && !!m.report && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`block rounded-lg ${panel} px-2.5 py-2 no-underline`}
        >
          <span className="flex items-center gap-2">
            <ReportIcon size={16} className={accent} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[11.5px] font-bold ${strong}`}>{translatePortalText(m.report.label)}</span>
              <span className={`block text-[9.5px] ${muted}`}>
                {[
                  m.report.from && m.report.to
                    ? `${formatPortalDate(m.report.from)} → ${formatPortalDate(m.report.to)}`
                    : null,
                  typeof m.report.rowCount === 'number'
                    ? `${formatPortalNumber(m.report.rowCount)} ${translatePortalText('Rows')}`
                    : null,
                  m.report.format.toUpperCase(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <Download size={13} className={muted} />
          </span>

          {!!m.report.summary?.length && (
            <span className="mt-1.5 block space-y-0.5">
              {m.report.summary.map(f => (
                <span key={f.label} className="flex items-baseline justify-between gap-3">
                  <span className={`truncate text-[9.5px] ${muted}`}>{translatePortalText(f.label)}</span>
                  <span className={`text-[10.5px] font-bold tabular-nums ${strong}`}>{f.value}</span>
                </span>
              ))}
            </span>
          )}
        </a>
      )}

      {/* The text, when there is any. A photo sent alone has none, and an empty
          line beneath it looks like a fault. */}
      {/* The assistant writes Markdown (bold figures, lists); people write plain text. */}
      {!!m.text && (isAssistantMessage(m) && !mine
        ? <AssistantMarkdown text={m.text} />
        : <TranslatableText text={m.text} mine={mine} muted={muted} accent={accent} />)}
    </div>
  )
}

/**
 * A person's message, with a way to read it in the portal's language.
 *
 * Messages stay as their author wrote them — a customer writing Arabic to an
 * English-speaking marina sees their own words, and so does everyone else by
 * default. When a message is in the other language, a "Translate" link shows the
 * translation under it (cached on the server, so re-opening it is free), with a
 * way back to the original. Your own messages are never offered: you know what
 * you wrote.
 */
function TranslatableText({ text, mine, muted, accent }: { text: string; mine: boolean; muted: string; accent: string }) {
  const target = getPortalLanguage()
  const source = detectTextLanguage(text)
  const [translation, setTranslation] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const offer = !mine && !!source && source !== target

  const toggle = async () => {
    if (showing) { setShowing(false); return }
    if (translation !== null) { setShowing(true); return }
    setBusy(true)
    setFailed(false)
    try {
      const res = await translateApi.text(text, target)
      if (res.data.configured === false || !res.data.translation || res.data.translation === text) {
        setFailed(true)
      } else {
        setTranslation(res.data.translation)
        setShowing(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p dir="auto" className="whitespace-pre-wrap break-words">{text}</p>
      {showing && translation !== null && (
        <p dir="auto" className={`mt-1 whitespace-pre-wrap break-words border-t pt-1 text-[0.95em] ${mine ? 'border-white/20' : 'border-slate-200/80'}`}>
          {translation}
        </p>
      )}
      {offer && (
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={`mt-1 inline-flex items-center gap-1 text-[10px] font-bold ${accent} hover:underline disabled:opacity-60`}
        >
          <Languages size={11} />
          {busy
            ? translatePortalText('Translating…')
            : showing
              ? translatePortalText('Show original')
              : translatePortalText(source === 'ar' ? 'Translate from Arabic' : 'Translate from English')}
        </button>
      )}
      {failed && <span className={`ms-2 text-[10px] ${muted}`}>{translatePortalText('Translation is not available right now')}</span>}
    </div>
  )
}

/**
 * The tags on a message, as filter buttons.
 *
 * Clickable, because the only reason to have tagged something is to find it again
 * — a tag that merely displays is a label, not an index.
 */
export function MessageTags({
  tags,
  mine,
  activeTag,
  onPick,
}: {
  tags?: string[]
  mine: boolean
  activeTag?: string | null
  onPick?: (tag: string) => void
}) {
  if (!tags?.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.map(tag => (
        <button
          key={tag}
          type="button"
          onClick={() => onPick?.(tag)}
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 transition ${
            mine
              ? 'bg-white/20 text-white ring-white/30'
              : 'bg-ocean-50 text-ocean-700 ring-ocean-100'
          } ${activeTag === tag ? 'ring-2' : ''}`}
        >
          #{tag}
        </button>
      ))}
    </div>
  )
}

export default MessageContent
