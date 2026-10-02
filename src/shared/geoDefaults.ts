/**
 * Where a map opens, and where a location field starts, before anybody sets one.
 *
 * Every one of these defaults used to be `25.2048, 55.2708` — Dubai Marina —
 * scattered across the fuel and maintenance portals as bare literals. That is
 * roughly 1,200 km outside the country this platform operates in, and it was
 * not only a map centre: it prefilled the latitude and longitude on the fuel
 * station profile and on the add-a-station form, so a provider who entered a
 * name and address without scrolling down to the map saved a station recorded
 * in another country. Delivery radius, nearest-station lookups and the dispatch
 * map all read those coordinates afterwards.
 *
 * Collected here so there is one place to be right, and one place to change if
 * the platform ever operates somewhere else.
 *
 * A default is still a guess. Anywhere one of these seeds a value that gets
 * *saved*, the operator has to be able to see and move the pin before it
 * counts — the constant is a starting point for a map, never a substitute for
 * an address nobody entered.
 */

/**
 * Jeddah Islamic Port — the Kingdom's main commercial port and the busiest
 * marine-services hub on the Red Sea coast.
 *
 * Deliberately typed as plain numbers rather than `as const`: these seed
 * mutable form state, and literal types would make the setters reject every
 * other coordinate.
 */
export const DEFAULT_COORDS: { latitude: number; longitude: number } = {
  latitude: 21.4858,
  longitude: 39.1925,
}

/** The same point in the `{ lat, lng }` shape the map components take. */
export const DEFAULT_MAP_CENTRE: { lat: number; lng: number } = {
  lat: DEFAULT_COORDS.latitude,
  lng: DEFAULT_COORDS.longitude,
}
