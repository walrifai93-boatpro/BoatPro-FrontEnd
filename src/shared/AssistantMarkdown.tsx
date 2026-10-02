import React from 'react'

/**
 * The assistant's replies, drawn with the formatting it is told it may use.
 *
 * The support model writes Markdown — bold for the figure that answers the
 * question, short bullet lists, the odd heading — and every web chat screen
 * printed it raw: "**3 free berths out of 4**", "- **Berth A-02**". This draws
 * exactly that subset and nothing more.
 *
 * React elements only, never HTML, so a reply cannot inject markup. Links open
 * only when they are absolute http(s): the model builds app routes such as
 * /trip/<id> for the customer app, and those would 404 in the portal, so their
 * text is shown instead.
 */

type ListBlock = { kind: 'ul' | 'ol'; items: string[] }
type Block = { kind: 'p'; lines: string[] } | { kind: 'h'; text: string } | ListBlock

const isList = (block: Block | undefined): block is ListBlock => block?.kind === 'ul' || block?.kind === 'ol'

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  // Whether the last block may still grow; a blank line or a heading closes it.
  let open = false
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const last = blocks[blocks.length - 1]
    if (!line.trim()) { open = false; continue }

    const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line)
    if (heading) { blocks.push({ kind: 'h', text: heading[1] }); open = false; continue }

    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line)
    const numbered = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line)
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      const item = (bullet ?? numbered)![1]
      if (open && isList(last) && last.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] })
      open = true
      continue
    }

    // A line indented under a list item carries on that item.
    if (open && isList(last) && /^\s{2,}\S/.test(raw)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`
      continue
    }

    if (open && last?.kind === 'p') last.lines.push(line)
    else blocks.push({ kind: 'p', lines: [line] })
    open = true
  }
  return blocks
}

// **bold** · __bold__ · `code` · [label](url) · *italic* (not "5 * 3", which has spaces inside)
const INLINE = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s](?:[^*]*?[^*\s])?)\*/g

function renderInline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const pattern = new RegExp(INLINE.source, 'g')
  let cursor = 0
  let match: RegExpExecArray | null
  let n = 0
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index))
    const k = `${key}.${n++}`
    const [, bold, boldAlt, code, label, url, italic] = match
    if (bold ?? boldAlt) out.push(<strong key={k} className="font-bold">{renderInline(bold ?? boldAlt, k)}</strong>)
    else if (code) out.push(<code key={k} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">{code}</code>)
    else if (label) {
      out.push(/^https?:\/\//i.test(url)
        ? <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ocean-700 underline">{renderInline(label, k)}</a>
        : <React.Fragment key={k}>{renderInline(label, k)}</React.Fragment>)
    } else if (italic) out.push(<em key={k}>{italic}</em>)
    cursor = pattern.lastIndex
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

export function AssistantMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  // `dir="auto"`: an English reply in the Arabic portal (or the reverse) reads in
  // its own direction — otherwise the trailing colon of "Right now:" lands in front.
  return (
    <div dir="auto" className="space-y-2 break-words leading-relaxed">
      {blocks.map((block, i) => {
        const key = String(i)
        if (block.kind === 'h') return <p key={key} className="font-bold text-deep-900">{renderInline(block.text, key)}</p>
        if (block.kind === 'p') {
          return (
            <p key={key}>
              {block.lines.map((line, j) => (
                <React.Fragment key={j}>{j > 0 && <br />}{renderInline(line, `${key}.${j}`)}</React.Fragment>
              ))}
            </p>
          )
        }
        const List = block.kind === 'ul' ? 'ul' : 'ol'
        return (
          <List key={key} className={`${block.kind === 'ul' ? 'list-disc' : 'list-decimal'} space-y-1 ps-5 marker:text-ocean-500`}>
            {block.items.map((item, j) => <li key={j}>{renderInline(item, `${key}.${j}`)}</li>)}
          </List>
        )
      })}
    </div>
  )
}

/**
 * The same text as one plain line, for a thread-list preview.
 *
 * The preview is cut at 200 characters on the server, which can split a
 * `**…**` pair — so any marker left over is removed as well.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
    .replace(/(^|[\s(])\*([^*\s](?:[^*]*?[^*\s])?)\*(?=$|[\s).,!?:;])/gm, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
}
