import React from 'react'
import { formatPortalNumber, translatePortalText } from '../../i18n/runtime'

// shared page wrapper — keeps consistent vertical rhythm
export function PageWrap({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>
}

// shared recharts tooltip (violet theme)
export const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      {label && <p className="font-bold text-deep-900 mb-1">{translatePortalText(label)}</p>}
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {translatePortalText(p.name)}: <b className="text-deep-900">{typeof p.value === 'number' ? formatPortalNumber(p.value) : p.value}</b>
        </p>
      ))}
    </div>
  )
}
