import React from 'react'
import { Check } from 'lucide-react'

/** Multi-select checklist rendered as toggle chips (facilities, fuel types, service categories, …). */
export default function CheckboxGroup({
  options, value, onChange, columns = 3,
}: {
  options: { key: string; label: string }[]
  value: string[]
  onChange: (keys: string[]) => void
  columns?: number
}) {
  const set = new Set(value)
  const toggle = (key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(Array.from(next))
  }
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = set.has(o.key)
        return (
          <button key={o.key} type="button" onClick={() => toggle(o.key)}
            className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-xs font-semibold transition ${on ? 'border-ocean-400 bg-ocean-50/60 text-deep-900' : 'border-slate-200 text-slate-500 hover:border-ocean-200'}`}>
            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded ${on ? 'bg-ocean-500 text-white' : 'bg-slate-100'}`}>
              {on && <Check size={11} />}
            </span>
            <span className="truncate">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
