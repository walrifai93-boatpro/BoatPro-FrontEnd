import React from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Clock, ArrowRight, ShieldAlert, Fuel, CheckCircle2 } from 'lucide-react'
import { useFuel, ALL_STATIONS } from '../fuelStore'
import { type ApiFuelStation } from '../fuelApi'
import { localizedField, translatePortalText } from '../../i18n/runtime'

interface Props {
  /** Optional custom title override */
  title?: string
  /** Specific station object to check (defaults to currentStation from useFuel) */
  station?: ApiFuelStation | null
  /** Compact style for tighter layouts */
  compact?: boolean
}

/** Returns true if the given station is in an unapproved state (pending or rejected). */
export function isStationUnapproved(st?: ApiFuelStation | null): boolean {
  if (!st || !st.approvalStatus) return false
  return st.approvalStatus === 'pending' || st.approvalStatus === 'rejected'
}

export function StationApprovalNotice({ title, station: propStation, compact = false }: Props) {
  const { currentStation, isAllStations, stations, setCurrentStationId } = useFuel()
  const nav = useNavigate()

  const st = propStation ?? currentStation

  // If "All Stations" rollup is selected or station is approved / not set, don't show notice
  if (isAllStations || !st || !st.approvalStatus || st.approvalStatus === 'approved') {
    return null
  }

  const isPending = st.approvalStatus === 'pending'
  const isRejected = st.approvalStatus === 'rejected'

  const firstApprovedStation = stations.find(s => s.id !== st.id && s.approvalStatus === 'approved')

  if (compact) {
    return (
      <div className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-xs font-semibold border ${
        isPending
          ? 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:bg-amber-950/30 dark:border-amber-400/40 dark:text-amber-200'
          : 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:bg-rose-950/30 dark:border-rose-400/40 dark:text-rose-200'
      }`}>
        <span className="text-base">{isPending ? '⏳' : '❌'}</span>
        <span className="flex-1 truncate">
          <strong><bdi dir="auto">{localizedField<string>(st, 'name', st.name)}</bdi></strong>{translatePortalText(" is ")}{isPending ? translatePortalText("awaiting admin approval") : translatePortalText("rejected")}{translatePortalText(". Operational actions are locked.")}</span>
        <button
          onClick={() => nav('/fuel/station')}
          className="text-xs font-bold text-amber-800 dark:text-amber-200 hover:underline shrink-0 ms-auto flex items-center gap-0.5"
        >{translatePortalText("View Profile ")}<ArrowRight size={11} className="rtl:rotate-180" />
        </button>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative mb-5 overflow-hidden rounded-2xl border p-4 sm:p-5 shadow-sm ${
        isPending
          ? 'bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent border-amber-400/40 text-amber-950 dark:border-amber-400/50 dark:text-amber-100'
          : 'bg-gradient-to-r from-rose-500/15 via-rose-500/5 to-transparent border-rose-400/40 text-rose-950 dark:border-rose-400/50 dark:text-rose-100'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow-sm text-2xl ${
            isPending ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white'
          }`}>
            {isPending ? '⏳' : <ShieldAlert size={22} />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-display text-base font-extrabold text-deep-900">
                {title || translatePortalText(isPending ? 'Station Location Awaiting Platform Approval' : 'Station Location Request Rejected')}
              </h4>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide border ${
                isPending
                  ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-400/40'
                  : 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-400/40'
              }`}>
                {isPending ? translatePortalText("Pending Review") : translatePortalText("Rejected")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-700 dark:text-slate-200 leading-relaxed max-w-2xl">
              {isPending ? (
                <>{translatePortalText("Station branch ")}<strong><bdi dir="auto">{localizedField<string>(st, 'name', st.name)}</bdi></strong>{translatePortalText(" is currently under review by platform administrators. Operational activities (adding fuel tanks, catalog products, pump dispensing, live fleet tracking, and taking customer bookings) are locked until approval is granted.")}</>
              ) : (
                <>{translatePortalText("Station branch ")}<strong><bdi dir="auto">{localizedField<string>(st, 'name', st.name)}</bdi></strong>{translatePortalText(" was reviewed and rejected by platform administrators.")}{st.rejectionReason && (
                    <span className="block mt-1 font-semibold text-rose-900 dark:text-rose-200 bg-white/70 dark:bg-rose-950/70 p-2 rounded-lg border border-rose-200 dark:border-rose-400/40">{translatePortalText("Rejection Reason: ")}{st.rejectionReason}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:self-start shrink-0">
          <button
            onClick={() => nav('/fuel/station')}
            className="btn-ghost !bg-white/80 hover:!bg-white dark:!bg-slate-800 dark:hover:!bg-slate-700 !py-1.5 !px-3 text-xs font-bold border border-slate-200/80 dark:border-slate-600 shadow-sm"
          >
            <Fuel size={13} className="text-amber-600" />{translatePortalText(" Station Profile")}</button>
          {firstApprovedStation && (
            <button
              onClick={() => setCurrentStationId(firstApprovedStation.id)}
              className="btn-admin !bg-emerald-600 hover:!bg-emerald-700 text-white !py-1.5 !px-3 text-xs font-bold shadow-sm"
            >
              <CheckCircle2 size={13} />{translatePortalText(" Switch to ")}<bdi dir="auto">{localizedField<string>(firstApprovedStation, 'name', firstApprovedStation.name)}</bdi>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
