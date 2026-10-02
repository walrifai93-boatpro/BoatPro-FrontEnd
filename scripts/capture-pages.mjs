// Full-page screenshots of every marina portal page listed in the sidebar.
//
//   npm run screenshots                     (dev server must be running: npm run dev)
//   npm run screenshots -- --headless       (once you have signed in at least once)
//   npm run screenshots -- --only=billing,reports
//   npm run screenshots -- --url=http://localhost:5299
//
// The page list is read from the NAV array in src/Layout.tsx, so it stays in step with the
// sidebar. Each run writes to a new folder, screenshots/<date>_<time>/, one PNG per page.
//
// The browser keeps its own profile in screenshots/.browser-profile, so you sign in once
// (with "Keep me signed in on this device" ticked) and later runs go straight to capturing.
// The language, theme and currency you pick in that window are kept the same way.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORTAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_ROOT = path.join(PORTAL_DIR, 'screenshots')
const PROFILE_DIR = path.join(OUT_ROOT, '.browser-profile')
const VIEWPORT = { width: 1536, height: 864 }
const LOGIN_TIMEOUT_MS = 10 * 60_000

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=')
  return [k, v.length ? v.join('=') : true]
}))
const BASE_URL = String(args.url || process.env.PORTAL_URL || 'http://localhost:5199').replace(/\/+$/, '')
const HEADLESS = Boolean(args.headless)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The sidebar entries, in sidebar order: [{ to: '/live', label: 'Live Dock Map' }, ...]. */
function readSidebarRoutes() {
  const src = fs.readFileSync(path.join(PORTAL_DIR, 'src/Layout.tsx'), 'utf8')
  const start = src.indexOf('const NAV')
  const end = src.indexOf('function Sidebar', start)
  if (start < 0 || end < 0) throw new Error('Could not find the NAV array in src/Layout.tsx')
  const routes = [...src.slice(start, end).matchAll(/\{\s*to:\s*'([^']+)',\s*label:\s*'([^']+)'/g)]
    .map(([, to, label]) => ({ to, label }))
  if (!routes.length) throw new Error('The NAV array in src/Layout.tsx has no { to, label } entries')
  return routes
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
/** Local time as 2026-09-30_14-05-09, so folders sort by when they were taken. */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

async function launch() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  // The installed Chrome or Edge first, so nothing has to be downloaded; Playwright's own
  // Chromium (`npx playwright install chromium`) is the last resort.
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, {
        channel, headless: HEADLESS, viewport: VIEWPORT, deviceScaleFactor: 1,
      })
    } catch (e) {
      if (channel === undefined) throw e
    }
  }
}

/** Counts in-flight requests so a page is only captured once its data has arrived. */
function trackNetwork(page) {
  const inflight = new Set()
  // Socket.IO long-polling never goes quiet, so it would hold every page to the timeout.
  const ignored = (r) => r.url().includes('/socket.io/') || ['websocket', 'eventsource'].includes(r.resourceType())
  page.on('request', (r) => { if (!ignored(r)) inflight.add(r) })
  page.on('requestfinished', (r) => inflight.delete(r))
  page.on('requestfailed', (r) => inflight.delete(r))
  return async function waitForQuiet(idleMs = 800, timeoutMs = 20_000) {
    const started = Date.now()
    let quietSince = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (inflight.size) quietSince = Date.now()
      else if (Date.now() - quietSince >= idleMs) return true
      await sleep(100)
    }
    return false
  }
}

const OTHER_PORTALS = ['#/login', '#/onboarding', '#/fuel', '#/boat', '#/maint', '#/admin', '#/agent']

/** 'ready' once the marina portal's sidebar is showing, otherwise where the app sent us. */
async function portalState(page) {
  const { hash, sidebar } = await page.evaluate(() => ({
    hash: location.hash || '#/',
    sidebar: !!document.querySelector('aside.portal-sidebar'),
  }))
  // A whole segment only: '#/boat' is the boat-provider portal, '#/boats' a marina page.
  const other = OTHER_PORTALS.find((p) => hash === p || hash.startsWith(`${p}/`) || hash.startsWith(`${p}?`))
  if (other) return other.slice(2)
  return sidebar ? 'ready' : 'loading'
}

async function ensureSignedIn(page) {
  await page.goto(`${BASE_URL}/#/`)
  let state = 'loading'
  for (let i = 0; i < 150 && state === 'loading'; i++) {
    await sleep(200)
    state = await portalState(page)
  }
  if (state === 'ready') return

  if (HEADLESS) {
    throw new Error(`Not signed in to the marina portal (the app went to "${state}"). ` +
      'Run once without --headless and sign in in the browser window.')
  }
  console.log(state === 'login'
    ? '\nSign in with a marina account in the browser window (leave "Keep me signed in" ticked).'
    : `\nThis browser is on the "${state}" screen, not the marina portal. Sign in with a marina account.`)
  console.log('Capturing starts by itself once the dashboard appears.\n')
  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(500)
    if ((await portalState(page).catch(() => 'loading')) === 'ready') return
  }
  throw new Error('Timed out waiting for the marina dashboard after sign-in')
}

/** Scroll to the bottom and back so lazy images, charts and in-view animations all render. */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
}

async function capture(page, waitForQuiet, pageErrors, route, file) {
  const wasAlive = (await portalState(page)) === 'ready'
  pageErrors.length = 0
  await page.goto(`${BASE_URL}/#${route.to}`)
  // A render error on the previous page unmounts the whole app, and a hash change alone
  // will not bring it back.
  if (!wasAlive) await page.reload()
  await waitForQuiet()
  // Spinners in the page body mean data is still being fetched or rendered.
  await page.waitForFunction(
    () => ![...document.querySelectorAll('main .animate-spin')].some((el) => el.getClientRects().length),
    null, { timeout: 10_000 },
  ).catch(() => {})
  await scrollThrough(page)
  await waitForQuiet(500, 10_000)
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 8_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  // Page transition is 0.28s; Recharts draws its series over 1.5s from mount.
  await sleep(1_500)

  const state = await portalState(page)
  if (state !== 'ready') {
    throw new Error(state === 'loading'
      ? `the portal crashed on this page${pageErrors[0] ? `: ${pageErrors[0]}` : ''}`
      : `the app went to the ${state} screen`)
  }
  const landed = (await page.evaluate(() => location.hash.replace(/^#/, '').split('?')[0])) || '/'
  await stretchSidebar(page, true)
  try {
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
  } finally {
    await stretchSidebar(page, false)
  }
  return landed === route.to ? null : landed
}

/**
 * The sidebar is fixed at 100vh, so a full-page capture would show it beside the first
 * screen only, cut off mid-menu. For the shot it runs the full height of the page instead.
 * The screenshot re-measures the page after this, so a menu taller than the page makes
 * the image taller rather than being clipped.
 */
async function stretchSidebar(page, on) {
  await page.evaluate((on) => {
    const aside = document.querySelector('aside.portal-sidebar')
    if (!aside) return
    if (!on) {
      for (const prop of ['position', 'bottom', 'height']) aside.style.removeProperty(prop)
      return
    }
    // Tall enough for the whole menu too, which otherwise scrolls inside the sidebar.
    const nav = aside.querySelector('nav')
    const menuHeight = nav ? aside.offsetHeight - nav.clientHeight + nav.scrollHeight : 0
    const height = Math.max(document.documentElement.scrollHeight, window.innerHeight, menuHeight)
    aside.style.setProperty('position', 'absolute', 'important')
    aside.style.setProperty('bottom', 'auto', 'important')
    aside.style.setProperty('height', `${height}px`, 'important')
  }, on)
}

async function main() {
  const all = readSidebarRoutes()
  let routes = all
  if (typeof args.only === 'string') {
    const wanted = args.only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    routes = routes.filter((r) => wanted.some((w) => r.to.toLowerCase().includes(w) || slug(r.label).includes(w)))
    if (!routes.length) throw new Error(`--only=${args.only} matched no sidebar page`)
  }

  try {
    await fetch(BASE_URL)
  } catch {
    throw new Error(`Nothing is answering at ${BASE_URL}. Start the portal first: npm run dev`)
  }

  // Keep every run (and the browser profile, which holds a sign-in token) out of git.
  fs.mkdirSync(OUT_ROOT, { recursive: true })
  const ignoreFile = path.join(OUT_ROOT, '.gitignore')
  if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, '*\n')

  const ctx = await launch()
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const waitForQuiet = trackNetwork(page)
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const failed = []
  let outDir
  try {
    await ensureSignedIn(page)
    outDir = path.join(OUT_ROOT, stamp())
    fs.mkdirSync(outDir, { recursive: true })
    console.log(`Saving to ${outDir}\n`)
    for (const [i, route] of routes.entries()) {
      // Numbered by sidebar position, so a --only rerun keeps the same file names.
      const n = String(all.findIndex((r) => r.to === route.to) + 1).padStart(2, '0')
      const file = path.join(outDir, `${n}-${slug(route.label)}.png`)
      process.stdout.write(`[${i + 1}/${routes.length}] ${route.label} (#${route.to}) ... `)
      try {
        const redirectedTo = await capture(page, waitForQuiet, pageErrors, route, file)
        console.log(redirectedTo ? `saved, but the app redirected to #${redirectedTo}` : 'saved')
      } catch (e) {
        failed.push(route.label)
        console.log(`FAILED: ${e.message.split('\n')[0]}`)
      }
    }
  } finally {
    await ctx.close()
  }

  console.log(`\n${routes.length - failed.length} of ${routes.length} pages saved to ${outDir}`)
  if (failed.length) {
    console.log(`Failed: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})
