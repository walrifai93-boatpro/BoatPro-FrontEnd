import React, { useCallback, useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { PageHeader, Section, LoadingState, ErrorState } from '../../ui'
import { monetizationApi } from '../../api'
import { PackagePlanCard, type ProviderDashboardData } from '../../shared/packageLimit'
import { VendorWeeklyPayouts } from '../../components/VendorWeeklyPayouts'

export default function BoatBilling() {
  const [dashboard, setDashboard] = useState<ProviderDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await monetizationApi.providerDashboard()
      setDashboard(r.data as unknown as ProviderDashboardData)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your billing dashboard')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div>
      <PageHeader title="Package & Billing" sub="Your active plan, usage, weekly payouts, and bank transfer receipts" icon={<CreditCard className="text-ocean-500" />} />
      {loading ? (
        <LoadingState label="Loading your billing dashboard…" rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : (
        <>
          <Section title="Your Plan">
            <PackagePlanCard dashboard={dashboard} providerType="boat_provider" onChanged={load} />
          </Section>
          <VendorWeeklyPayouts title="Boat Provider Weekly Payouts & Transfer Receipts" accent="ocean" />
        </>
      )}
    </div>
  )
}
