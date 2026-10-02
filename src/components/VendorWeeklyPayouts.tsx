import React, { useEffect, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Banknote, Calendar, ShieldCheck, AlertCircle, Eye, ExternalLink,
  FileText, RefreshCw, Landmark, ArrowDownRight, CheckCircle2, Clock
} from 'lucide-react'
import { Modal, toast } from '../ui'
import { monetizationApi, fileUrl, type PayoutRecord } from '../api'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'


const fmt = (n: number) => formatPortalNumber(Number(n || 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d?: string | null) => (d ? formatPortalDate(d, { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

interface VendorWeeklyPayoutsProps {
  /** Optional custom title, defaults to "Weekly Payouts & Transfer Receipts" */
  title?: string;
  /** Optional theme accent: 'violet' | 'amber' | 'ocean' | 'emerald' */
  accent?: 'violet' | 'amber' | 'ocean' | 'emerald';
}

export function VendorWeeklyPayouts({ title = 'Weekly Payouts & Bank Transfer Receipts', accent = 'ocean' }: VendorWeeklyPayoutsProps) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [payouts, setPayouts] = useState<PayoutRecord[]>([])
  const [walletBalance, setWalletBalance] = useState<number>(0)
  const [currency, setCurrency] = useState<string>('SAR')
  const [receiptModal, setReceiptModal] = useState<PayoutRecord | null>(null)

  const loadData = async () => {
    try {
      const [pRes, dRes] = await Promise.allSettled([
        monetizationApi.payouts({ limit: 50 }),
        monetizationApi.providerDashboard(),
      ])

      if (pRes.status === 'fulfilled') {
        setPayouts(pRes.value.data.items || [])
      }
      if (dRes.status === 'fulfilled') {
        const d = dRes.value.data
        setWalletBalance(d.walletBalance ?? 0)
        setCurrency(d.payoutCurrency || d.currency || 'SAR')
      }
    } catch (e: any) {
      toast(translatePortalText(e?.message || 'Failed to load weekly payouts'), 'warn')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    loadData()
  }

  // Summary figures
  const totals = useMemo(() => {
    const paidList = payouts.filter(p => p.status === 'paid')
    const totalPaid = paidList.reduce((sum, p) => sum + (p.payableAmount ?? p.netAmount), 0)
    const lastPaid = paidList.length > 0 ? (paidList[0].payableAmount ?? paidList[0].netAmount) : 0
    const lastPaidDate = paidList.length > 0 ? paidList[0].paidAt : null
    return { totalPaid, lastPaid, lastPaidDate }
  }, [payouts])

  const statusBadge = (p: PayoutRecord) => {
    switch (p.status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={11} /> {translatePortalText("Paid\n          ")}</span>
        )
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 border border-sky-200">
            <Clock size={11} /> {translatePortalText("Approved\n          ")}</span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
            <AlertCircle size={11} /> {translatePortalText("On hold\n          ")}</span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 border border-slate-200">
            <Clock size={11} /> {translatePortalText("Pending review\n          ")}</span>
        )
    }
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-black text-deep-900 flex items-center gap-2">
            <Banknote className="text-emerald-600" size={20} />
            {translatePortalText(title)}
          </h3>
          <p className="text-xs text-slate-400">
            {translatePortalText("Manual weekly bank wire settlements for customer online payments. View wire reference numbers and official bank transfer receipts.\n          ")}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading || refreshing}
          className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1.5 border border-slate-200"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> {translatePortalText("Refresh\n        ")}</button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Awaiting Weekly Payout")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-amber-600">
            {currency} {fmt(walletBalance)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">{translatePortalText("Current wallet balance from online sales")}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Last Wire Sent")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">
            {currency} {fmt(totals.lastPaid)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {totals.lastPaidDate ? translatePortalText(`Paid on ${fmtDate(totals.lastPaidDate)}`) : translatePortalText('No prior payouts')}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Total Transferred to Bank")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-emerald-600">
            {currency} {fmt(totals.totalPaid)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">{translatePortalText("Lifetime settled earnings")}</p>
        </div>
      </div>

      {/* Explainer Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-sand to-sand/60 border border-slate-200/80 p-4 text-xs text-slate-600 flex items-start gap-3">
        <Landmark className="text-ocean-600 shrink-0 mt-0.5" size={18} />
        <div className="space-y-1">
          <p className="font-bold text-deep-900">{translatePortalText("Weekly Settlement & Policy Summary")}</p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {translatePortalText("Payouts are processed ")}<strong>{translatePortalText("weekly (Monday to Sunday)")}</strong>{translatePortalText(". A standardized ")}<strong>{translatePortalText("3.5% transaction processing fee")}</strong> {translatePortalText("applies to online card transactions. Acquirer fees on customer refunds are deducted from the payout. When each transfer is wired at the bank, platform administrators attach the official bank transfer receipt so you have full proof of payment.\n          ")}</p>
        </div>
      </div>

      {/* Payouts Table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-xs border-collapse min-w-[780px]">
            <thead>
              <tr className="border-b border-slate-100 bg-sand px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">{translatePortalText("Settlement Week")}</th>
                <th className="py-3 px-3">{translatePortalText("Status")}</th>
                <th className="py-3 px-3 text-right">{translatePortalText("Gross")}</th>
                <th className="py-3 px-3 text-right">{translatePortalText("Fee Deductions")}</th>
                <th className="py-3 px-3 text-right">{translatePortalText("Net Payable")}</th>
                <th className="py-3 px-4">{translatePortalText("Bank & Reference")}</th>
                <th className="py-3 px-4 text-center">{translatePortalText("Bank Receipt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    {translatePortalText("Loading weekly payouts…\n                  ")}</td>
                </tr>
              ) : payouts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-slate-400">
                    <Banknote className="mx-auto mb-2 text-slate-300" size={32} />
                    <p className="font-bold text-slate-600">{translatePortalText("No weekly payouts yet")}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {translatePortalText("Your weekly payout records and bank transfer receipts will appear here after your first settled week of bookings.\n                    ")}</p>
                  </td>
                </tr>
              ) : (
                payouts.map((p) => {
                  const net = p.payableAmount ?? p.netAmount
                  const refundDeduction = p.refundFeeDeduction ?? 0
                  const feeTotal = (p.commissionAmount || 0) + refundDeduction

                  return (
                    <tr key={p._id} className="hover:bg-sand/60 transition">
                      <td className="py-3.5 px-4 font-bold text-deep-900">
                        {p.periodStart && p.periodEnd ? (
                          <span>{p.periodStart} <span className="text-slate-400 font-normal">→</span> {p.periodEnd}</span>
                        ) : (
                          <span>{translatePortalText("Week ")}{formatPortalNumber(p.month)}/{formatPortalNumber(p.year)}</span>
                        )}
                        {p.transactionCount ? (
                          <span className="block text-[10px] font-normal text-slate-400">
                            {formatPortalNumber(p.transactionCount)} {translatePortalText(p.transactionCount === 1 ? 'booking' : 'bookings')}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3.5 px-3">
                        {statusBadge(p)}
                        {p.status === 'paid' && p.paidAt && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {fmtDate(p.paidAt)}
                          </span>
                        )}
                        {p.status === 'rejected' && p.failureReason && (
                          <span className="block text-[10px] text-rose-600 font-bold mt-0.5">
                            {translatePortalText(p.failureReason)}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right font-medium text-slate-600">
                        {p.currency || currency} {fmt(p.grossAmount)}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <span className="font-medium text-slate-600">
                          - {p.currency || currency} {fmt(feeTotal)}
                        </span>
                        {refundDeduction > 0 && (
                          <span className="block text-[10px] text-amber-600" title={translatePortalText("Includes 3.5% acquirer card-processing fee on refunded bookings")}>
                            {translatePortalText("incl. ")}{fmt(refundDeduction)} {translatePortalText("refund fees\n                          ")}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <span className="font-display font-extrabold text-amber-600 text-sm">
                          {p.currency || currency} {fmt(net)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {p.bankAccount?.last4 ? (
                          <span className="text-xs font-mono text-slate-700 block">
                            •••• {p.bankAccount.last4}
                          </span>
                        ) : null}
                        {p.payoutReference ? (
                          <span className="text-[10px] font-mono text-slate-400 block truncate max-w-[160px]" title={p.payoutReference}>
                            {translatePortalText("Ref: ")}{p.payoutReference}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {p.transferProof?.url ? (
                          <button
                            type="button"
                            onClick={() => setReceiptModal(p)}
                            className="inline-flex items-center gap-1 rounded-lg border border-ocean-200 bg-ocean-50/70 hover:bg-ocean-100/80 px-2.5 py-1 text-[11px] font-bold text-ocean-700 transition shadow-xs"
                          >
                            <Eye size={12} /> {translatePortalText("View receipt\n                          ")}</button>
                        ) : p.status === 'paid' ? (
                          <span className="text-[11px] text-slate-400">{translatePortalText("Processed")}</span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">{translatePortalText("Pending")}</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bank Transfer Receipt Modal */}
      {receiptModal && (
        <Modal
          open={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          title={translatePortalText("🏦 Bank Transfer Payment Receipt")}
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-sand p-3.5 text-xs space-y-1.5 border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{translatePortalText("Settlement Week:")}</span>
                <span className="font-bold text-deep-900">{receiptModal.periodStart} → {receiptModal.periodEnd}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{translatePortalText("Amount Transferred:")}</span>
                <span className="font-extrabold text-amber-600 font-display text-sm">
                  {receiptModal.currency || currency} {fmt(receiptModal.payableAmount ?? receiptModal.netAmount)}
                </span>
              </div>
              {receiptModal.payoutReference && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">{translatePortalText("Bank Wire Reference:")}</span>
                  <span className="font-mono font-bold text-deep-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                    {receiptModal.payoutReference}
                  </span>
                </div>
              )}
              {receiptModal.paidAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{translatePortalText("Transfer Date:")}</span>
                  <span className="font-bold text-slate-700">{fmtDate(receiptModal.paidAt)}</span>
                </div>
              )}
            </div>

            {receiptModal.transferProof?.url ? (
              <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-900/5 p-3 text-center">
                {receiptModal.transferProof.mimeType?.includes('pdf') || receiptModal.transferProof.url.toLowerCase().endsWith('.pdf') ? (
                  <div className="py-8 space-y-3">
                    <FileText size={48} className="mx-auto text-ocean-600" />
                    <p className="text-xs font-bold text-slate-700">
                      {receiptModal.transferProof.originalName || translatePortalText('Bank Transfer Receipt (PDF)')}
                    </p>
                    <a
                      href={fileUrl(receiptModal.transferProof.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-admin inline-flex items-center gap-1.5 text-xs !py-2 !px-4 shadow-sm"
                    >
                      <ExternalLink size={13} /> {translatePortalText("Open Receipt Document\n                    ")}</a>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <img
                      src={fileUrl(receiptModal.transferProof.url)}
                      alt={translatePortalText("Bank Transfer Proof")}
                      className="max-h-[460px] w-auto mx-auto rounded-lg shadow-sm object-contain border border-slate-100 bg-white"
                    />
                    <div className="pt-1">
                      <a
                        href={fileUrl(receiptModal.transferProof.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost inline-flex items-center gap-1 text-xs text-ocean-600 font-bold"
                      >
                        <ExternalLink size={12} /> {translatePortalText("Open full size in new tab\n                      ")}</a>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex justify-end pt-1">
              <button type="button" onClick={() => setReceiptModal(null)} className="btn-ghost text-xs">
                {translatePortalText("Close\n              ")}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
