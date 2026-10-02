import React from 'react'
import { Anchor, Fuel, Sailboat, Wrench } from 'lucide-react'
import { AIMG, type ABooking, type Provider } from '../adminData'

// Keep route configuration outside the large provider screens. The app shell
// needs these labels before it needs any of the Admin panels.
export interface DomainCfg {
  kind: Provider['kind']
  slug: string
  name: string
  provPlural: string
  icon: React.ReactNode
  hero: string
  bookingKind: ABooking['kind']
  listLabel: string
  listSub: string
  /** The bookings page's title — the sidebar's own name for it. */
  bookingsLabel: string
}

export const CFGS: Record<string, DomainCfg> = {
  boat: { kind: 'Boat', slug: 'boat', name: 'Boat', provPlural: 'Boat Providers', icon: <Sailboat className="text-emerald-500" />, hero: AIMG.yacht, bookingKind: 'Boat rental', listLabel: 'Boat Listings', listSub: 'Boats offered by rental providers, their trips, and whether customers can see them', bookingsLabel: 'Boat Bookings' },
  marina: { kind: 'Marina', slug: 'marina', name: 'Marina', provPlural: 'Marina Providers', icon: <Anchor className="text-emerald-500" />, hero: AIMG.marina, bookingKind: 'Berth', listLabel: 'Marinas & Berths', listSub: 'Marinas run by marina providers, their berths, and whether customers can see them', bookingsLabel: 'Berth Bookings' },
  fuel: { kind: 'Fuel', slug: 'fuel', name: 'Fuel', provPlural: 'Fuel Providers', icon: <Fuel className="text-emerald-500" />, hero: AIMG.fuel, bookingKind: 'Fuel', listLabel: 'Fuel Stations', listSub: 'Monitor bunkering points, stock levels & pricing', bookingsLabel: 'Fuel Orders' },
  maintenance: { kind: 'Maintenance', slug: 'maintenance', name: 'Maintenance', provPlural: 'Maintenance Providers', icon: <Wrench className="text-emerald-500" />, hero: AIMG.workshop, bookingKind: 'Maintenance', listLabel: 'Service Catalog', listSub: 'Review services, pricing & turnaround by workshop', bookingsLabel: 'Work Orders' },
}
