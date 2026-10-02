import { formatMoney } from './live'

// ---------------------------------------------------------------------------
// Small formatting helpers shared by the fuel / maintenance / admin portals,
// which still run on their own local datasets. The marina portal formats
// through `live.tsx` instead, so amounts follow the marina's own currency.
// ---------------------------------------------------------------------------

/**
 * Amounts in the maintenance / fuel / admin portals.
 *
 * This formatted as US dollars, which was simply the wrong currency: the
 * platform bills in SAR through HyperPay, technician rates are entered and
 * displayed as "SAR/hr", and the customer app shows SAR. So a work order read
 * "$5,040" directly beside "28 hrs × 180 SAR/hr" — the same number, labelled two
 * different currencies, on one card.
 *
 * It now delegates to `formatMoney` in live.tsx outright rather than merely
 * matching it, so these portals pick up the display-currency switch for free:
 * the amounts they hold are riyals, and `formatMoney` converts them into
 * whatever the operator is reading in.
 */
export const money = (n: number) => formatMoney(n)
export const compactMoney = (n: number) => formatMoney(n, undefined, { compact: true })

/**
 * The stand-in for an account with no photo.
 *
 * This used to return a random portrait from `pravatar.cc` — a real stranger's
 * face, seeded off the record's id. On a screen listing "Unknown provider" that
 * is worse than showing nothing: it puts a human face against an account whose
 * identity we do not actually have, and an operator reading the row has no way to
 * tell the fabricated ones from the real ones.
 *
 * A neutral silhouette says what is true — no photo on file. Inlined as a data
 * URI rather than fetched, so it renders offline, cannot 404, and costs no
 * request on a list of forty rows.
 */
export const PLACEHOLDER_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
      '<rect width="96" height="96" fill="#e2e8f0"/>' +
      '<circle cx="48" cy="37" r="16" fill="#94a3b8"/>' +
      '<path d="M18 90c0-16.6 13.4-30 30-30s30 13.4 30 30z" fill="#94a3b8"/>' +
      '</svg>'
  );

/**
 * Kept as a function, and still ignoring its argument, so the couple of dozen
 * call sites that pass a seed keep working unchanged — they all wanted "a
 * placeholder", and the seed only ever chose which stranger to show.
 */
export const avatar = (_n?: number) => PLACEHOLDER_AVATAR;
