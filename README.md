# HarborLink — Marina & Port Provider Portal

A full-featured web portal for marina / port providers (companion to the BoatPro boater app), built with **React 18 + TypeScript + Vite + Tailwind CSS + Framer Motion + Recharts**. All data is dummy/demo data defined in [`src/data.ts`](src/data.ts).

## Run it

```bash
npm install      # already installed if node_modules exists
npm run dev      # → http://localhost:5199
npm run build    # production build → dist/
```

## Modules (24 functional areas → 22 pages)

| Area | Route |
|---|---|
| Dashboard (revenue, arrivals/departures, occupancy, weather & tide, alerts, quick actions) | `#/` |
| Live Dock Monitoring — interactive animated SVG marina map | `#/live` |
| Marina Calendar + occupancy heatmap | `#/calendar` |
| Dock Reservations (requests, accept/reject, auto berth allocation, waitlist, history) | `#/reservations` |
| Arrivals & Departures (check-in steps, security, inspection, invoice, berth release) | `#/movements` |
| Marina Service Requests (accept → assign staff → track → invoice) | `#/services` |
| Maintenance (kanban work orders) | `#/maintenance` |
| Berth Management (CRUD, specs, pricing, status) | `#/berths` |
| Facilities (20 amenities with live toggles) | `#/facilities` |
| Utility Usage (consumption charts, meter readings) | `#/utilities` |
| Marina Profile (public listing, gallery, rules, hours, verification) | `#/profile` |
| Customers · Boats · Staff | `#/customers` `#/boats` `#/staff` |
| Billing & Payments (invoices, collect, refund) | `#/billing` |
| Reports & Analytics | `#/reports` |
| Messaging (owners & staff, quick replies) | `#/messages` |
| Reviews & Ratings (reply, complaints) | `#/reviews` |
| Notifications | `#/notifications` |
| Documents & Compliance (expiry alerts, renew) | `#/documents` |
| Emergency Management (SOS, incidents, contacts) | `#/emergency` |
| Settings (pricing rules, policies, roles, preferences) | `#/settings` |
| APIs & Integrations (BoatPro, Stripe, NOAA, QR check-in…) | `#/integrations` |
