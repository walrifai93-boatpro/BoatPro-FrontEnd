import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { Search, SlidersHorizontal, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { translatePortalText, isPortalArabic, formatPortalNumber } from '../i18n/runtime'

/**
 * Search, filtering, and URL-synchronized pagination for the portal's tables.
 *
 * Every table on the platform was hand-rolling this, which is why so many had
 * neither: a search box is three pieces of state, a `.filter()`, and pagination
 * math.
 *
 * The design point is that a table declares *what* is searchable, filterable
 * and paginated. `useTableFilters` owns the state, matching, and pagination;
 * the toolbar and pagination components render whatever was declared with
 * full URL query parameter synchronization.
 */

/** One filter control, resolved against the rows the table already holds. */
export interface TableFilterDef<T> {
  key: string
  label: string
  /**
   * How this filter is presented and matched.
   *
   * `select` (the default) is a dropdown of discrete values. `dateRange` renders
   * a from/to pair of day pickers and matches on whether the row's date falls
   * inside them — added because bounding a list by *when* was the filter most
   * often missing: the pages that offered dates at all did it with loose
   * `type="date"` inputs wired to their own state, each with its own bugs.
   */
  kind?: 'select' | 'dateRange'
  /** Fixed options, or omitted to derive them from the rows themselves. */
  options?: { value: string; label: string }[]
  /** The value this filter compares against, per row. */
  get: (row: T) => string | number | null | undefined
  /** Overrides equality — for ranges, dates, or anything not a string match. */
  match?: (row: T, value: string) => boolean
  /** Label for the "any value" choice. Defaults to `All <label>`. */
  anyLabel?: string
}

/** One way a table can be ordered. */
export interface TableSortDef<T> {
  key: string
  label: string
  /** Value to order by. Numbers and dates are both understood. */
  get: (row: T) => string | number | Date | null | undefined
  /** Direction chosen when this option is first selected. */
  defaultDir?: 'asc' | 'desc'
}

/**
 * A `dateRange` value is the two days joined by `..`, so it still lives in the
 * flat `Record<string, string>` every other filter uses (and in the URL, if
 * that is ever synced) instead of needing a second parallel store.
 */
export function parseDateRange(value: string): { from: string; to: string } {
  const [from = '', to = ''] = (value || '').split('..')
  return { from, to }
}

export function buildDateRange(from: string, to: string): string {
  return from || to ? `${from}..${to}` : ''
}

/** Midnight starting a `YYYY-MM-DD`, local time. */
function dayStart(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).valueOf()
}

/**
 * Whether a row's date is inside a `from..to` range.
 *
 * The end day is *included* — the range runs to the instant after it. Comparing
 * against the end day's midnight, which is the obvious way to write this, drops
 * everything that happened on the last day the operator asked for, and a range
 * of a single day then matches nothing at all.
 */
function withinDateRange(raw: unknown, value: string): boolean {
  const { from, to } = parseDateRange(value)
  if (!from && !to) return true
  if (raw === null || raw === undefined || raw === '') return false
  const t = raw instanceof Date ? raw.valueOf() : new Date(raw as string | number).valueOf()
  if (Number.isNaN(t)) return false
  const lo = from ? dayStart(from) : null
  const hi = to ? dayStart(to) : null
  if (lo !== null && t < lo) return false
  if (hi !== null && t >= hi + 86_400_000) return false
  return true
}

export interface TableFiltersConfig<T> {
  /** Fields the search box looks at. Anything falsy on a row is skipped. */
  searchFields?: (row: T) => (string | number | null | undefined)[]
  filters?: TableFilterDef<T>[]
  /**
   * Orderings offered by the toolbar. Omit for tables whose server-side order
   * is the point — the featured-listing queue, for one, where position *is* the
   * product.
   */
  sortOptions?: TableSortDef<T>[]
  /** Which ordering starts selected. Defaults to the first. */
  defaultSort?: string
  /** Default page size. Defaults to 15. Set to 0 to disable pagination by default. */
  defaultPageSize?: number
  /** Whether to sync page and limit with URL query params. Defaults to true. */
  syncUrl?: boolean
  /** URL param key for page number. Defaults to 'page'. */
  pageParam?: string
  /** URL param key for page size limit. Defaults to 'limit'. */
  limitParam?: string
}

export interface TableFiltersState<T> {
  query: string
  setQuery: (q: string) => void
  values: Record<string, string>
  setValue: (key: string, value: string) => void
  clear: () => void
  /** Rows surviving the search and every active filter, in their original order. */
  filtered: T[]
  /** Sliced rows for the current active page */
  paged: T[]
  /** Alias for paged */
  pagedRows: T[]
  /** Current 1-based page number */
  page: number
  setPage: (page: number) => void
  /** Page size limit */
  pageSize: number
  setPageSize: (size: number) => void
  /** Total calculated pages */
  totalPages: number
  /** Total rows after filters */
  totalFiltered: number
  /** 1-based start item index */
  pageStart: number
  /** 1-based end item index */
  pageEnd: number
  hasPrevPage: boolean
  hasNextPage: boolean
  /** How many controls are narrowing the list, search included. */
  activeCount: number
  total: number
  /** Selected ordering key, `''` when the table declares none. */
  sort: string
  setSort: (key: string) => void
  dir: 'asc' | 'desc'
  setDir: (dir: 'asc' | 'desc') => void
  toggleDir: () => void
}

/**
 * Folds a value to something two people typing the same name will agree on.
 *
 * This was `toLowerCase().trim()`, which is enough for Latin text and does
 * nothing at all for Arabic — and most business and personal names on this
 * platform are Arabic. Three differences routinely stop a search matching:
 *
 *   - Diacritics (harakat). "شَرِكة" typed as "شركة" found nothing.
 *   - Alef and ya variants. أ/إ/آ are all typed for ا, and ى for ي, depending
 *     on keyboard and habit; a name stored one way was unfindable the other.
 *   - The tatweel (ـ), inserted purely to stretch a word for layout.
 *
 * Latin text also gains accent folding — "Alharbi" now matches "Álharbi" —
 * which costs nothing and removes the same class of miss.
 *
 * Applied to both the needle and the haystack, so the two always agree.
 */
const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // U+064B–U+0655 covers the harakat *and* the combining hamza and maddah
    // that NFKD splits off أ إ آ, plus the tatweel and the superscript alef.
    // Stopping at U+0652, as the obvious range does, leaves those combining
    // marks behind — and since NFKD has already dismantled the precomposed
    // letters, the أ/إ/آ replace below then matches nothing and the folding
    // silently does not happen.
    .replace(/[ً-ٕـٰ]/g, '')
    // Combining marks NFKD split off Latin letters (é → e + ́).
    .replace(/[̀-ͯ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()

export function useTableFilters<T>(rows: T[], config: TableFiltersConfig<T>): TableFiltersState<T> {
  const syncUrl = config.syncUrl !== false
  const pageParam = config.pageParam || 'page'
  const limitParam = config.limitParam || 'limit'
  const defaultPageSize = config.defaultPageSize ?? 15

  // URL search params
  const [searchParams, setSearchParams] = useSearchParams()

  const urlPage = useMemo(() => {
    if (!syncUrl) return 1
    const p = parseInt(searchParams.get(pageParam) || '1', 10)
    return isNaN(p) || p < 1 ? 1 : p
  }, [searchParams, syncUrl, pageParam])

  const urlLimit = useMemo(() => {
    if (!syncUrl) return defaultPageSize
    const l = parseInt(searchParams.get(limitParam) || String(defaultPageSize), 10)
    return isNaN(l) || l < 1 ? defaultPageSize : l
  }, [searchParams, syncUrl, limitParam, defaultPageSize])

  const [query, setQueryState] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [localPage, setLocalPage] = useState(urlPage)
  const [localPageSize, setLocalPageSize] = useState(urlLimit)

  // Keep state in sync with URL
  useEffect(() => {
    if (syncUrl) {
      setLocalPage(urlPage)
      setLocalPageSize(urlLimit)
    }
  }, [urlPage, urlLimit, syncUrl])

  const updateUrl = useCallback((newPage: number, newLimit: number) => {
    if (!syncUrl) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (newPage > 1) next.set(pageParam, String(newPage))
      else next.delete(pageParam)

      if (newLimit !== defaultPageSize) next.set(limitParam, String(newLimit))
      else next.delete(limitParam)

      return next
    }, { replace: true })
  }, [syncUrl, setSearchParams, pageParam, limitParam, defaultPageSize])

  const setPage = useCallback((p: number) => {
    const valid = Math.max(1, p)
    setLocalPage(valid)
    updateUrl(valid, localPageSize)
  }, [localPageSize, updateUrl])

  const setPageSize = useCallback((size: number) => {
    const valid = Math.max(1, size)
    setLocalPageSize(valid)
    setLocalPage(1)
    updateUrl(1, valid)
  }, [updateUrl])

  const setQuery = useCallback((q: string) => {
    setQueryState(q)
    setLocalPage(1)
    if (syncUrl && urlPage > 1) {
      updateUrl(1, localPageSize)
    }
  }, [syncUrl, urlPage, updateUrl, localPageSize])

  const setValue = useCallback((key: string, value: string) => {
    setValues(prev => {
      const next = { ...prev }
      if (!value) delete next[key]
      else next[key] = value
      return next
    })
    setLocalPage(1)
    if (syncUrl && urlPage > 1) {
      updateUrl(1, localPageSize)
    }
  }, [syncUrl, urlPage, updateUrl, localPageSize])

  const clear = useCallback(() => {
    setQueryState('')
    setValues({})
    setLocalPage(1)
    if (syncUrl && urlPage > 1) {
      updateUrl(1, localPageSize)
    }
  }, [syncUrl, urlPage, updateUrl, localPageSize])

  const searchFields = config.searchFields
  const filters = config.filters
  const sortOptions = config.sortOptions

  const [sort, setSortState] = useState(config.defaultSort || sortOptions?.[0]?.key || '')
  const [dir, setDir] = useState<'asc' | 'desc'>(
    sortOptions?.find(o => o.key === (config.defaultSort || sortOptions?.[0]?.key))?.defaultDir ?? 'desc'
  )

  /** Choosing an ordering adopts its natural direction rather than keeping the last one. */
  const setSort = useCallback(
    (key: string) => {
      setSortState(key)
      const next = sortOptions?.find(o => o.key === key)?.defaultDir
      if (next) setDir(next)
    },
    [sortOptions]
  )

  const matched = useMemo(() => {
    const needles = norm(query).split(/\s+/).filter(Boolean)

    return rows.filter(row => {
      if (needles.length && searchFields) {
        const haystack = searchFields(row)
          .filter(v => v !== null && v !== undefined && v !== '')
          .map(norm)
          .join(' ')
        if (!needles.every(n => haystack.includes(n))) return false
      }

      for (const def of filters ?? []) {
        const picked = values[def.key]
        if (!picked) continue
        if (def.match) {
          if (!def.match(row, picked)) return false
        } else if (def.kind === 'dateRange') {
          // A range is never an equality test, so it gets the range comparison
          // by default — a `dateRange` filter needs no `match` of its own.
          if (!withinDateRange(def.get(row), picked)) return false
        } else if (norm(def.get(row)) !== norm(picked)) {
          return false
        }
      }
      return true
    })
  }, [rows, query, values, searchFields, filters])

  const filtered = useMemo(() => {
    const option = sortOptions?.find(o => o.key === sort)
    if (!option) return matched
    const sign = dir === 'asc' ? 1 : -1
    // Copied first: `rows` comes from a caller's state and must not be
    // reordered underneath them.
    return [...matched].sort((a, b) => {
      const av = option.get(a)
      const bv = option.get(b)
      // Blanks sink in both directions, so reversing a column never fills the
      // first page with empty rows.
      const aEmpty = av === null || av === undefined || av === ''
      const bEmpty = bv === null || bv === undefined || bv === ''
      if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1
      if (typeof av === 'number' && typeof bv === 'number') return sign * (av - bv)
      const at = av instanceof Date ? av.valueOf() : new Date(av as string).valueOf()
      const bt = bv instanceof Date ? bv.valueOf() : new Date(bv as string).valueOf()
      if (!Number.isNaN(at) && !Number.isNaN(bt)) return sign * (at - bt)
      return sign * String(av).localeCompare(String(bv), undefined, { numeric: true })
    })
  }, [matched, sortOptions, sort, dir])

  // Pagination calculations
  const totalFiltered = filtered.length
  const effectivePageSize = localPageSize > 0 ? localPageSize : (totalFiltered || 1)
  const totalPages = Math.max(1, Math.ceil(totalFiltered / effectivePageSize))
  
  // Guard against out-of-bounds page
  const safePage = Math.min(Math.max(1, localPage), totalPages)

  const paged = useMemo(() => {
    if (localPageSize <= 0) return filtered
    const start = (safePage - 1) * effectivePageSize
    return filtered.slice(start, start + effectivePageSize)
  }, [filtered, safePage, effectivePageSize, localPageSize])

  const pageStart = totalFiltered === 0 ? 0 : (safePage - 1) * effectivePageSize + 1
  const pageEnd = Math.min(safePage * effectivePageSize, totalFiltered)

  return {
    query,
    setQuery,
    values,
    setValue,
    clear,
    filtered,
    paged,
    pagedRows: paged,
    page: safePage,
    setPage,
    pageSize: effectivePageSize,
    setPageSize,
    totalPages,
    totalFiltered,
    pageStart,
    pageEnd,
    hasPrevPage: safePage > 1,
    hasNextPage: safePage < totalPages,
    activeCount: (query.trim() ? 1 : 0) + Object.keys(values).length,
    total: rows.length,
    sort,
    setSort,
    dir,
    setDir,
    toggleDir: () => setDir(d => (d === 'asc' ? 'desc' : 'asc')),
  }
}

/** Options for a filter, taken from the rows when none were declared. */
function optionsFor<T>(def: TableFilterDef<T>, rows: T[]): { value: string; label: string }[] {
  if (def.options) return def.options
  const seen = new Map<string, string>()
  for (const row of rows) {
    const raw = def.get(row)
    if (raw === null || raw === undefined || raw === '') continue
    const value = String(raw)
    if (!seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).map(v => ({ value: v, label: v }))
}

interface ToolbarProps<T> {
  state: TableFiltersState<T>
  config: TableFiltersConfig<T>
  /** The unfiltered rows, so derived options do not shrink as you filter. */
  rows: T[]
  searchPlaceholder?: string
  /** What the count is counting — "providers", "orders". */
  noun?: string
  /** Extra controls (a view toggle, an export button) pinned to the right. */
  children?: React.ReactNode
  className?: string
}

export function TableToolbar<T>({
  state,
  config,
  rows,
  searchPlaceholder = 'Search...',
  noun = 'rows',
  children,
  className = '',
}: ToolbarProps<T>) {
  const defs = config.filters ?? []
  const [open, setOpen] = useState(false)
  const filterCount = Object.keys(state.values).length

  return (
    <div className={`mb-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {config.searchFields && (
          <div className="relative min-w-[200px] flex-1 md:max-w-sm">
            <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={state.query}
              onChange={e => state.setQuery(e.target.value)}
              placeholder={translatePortalText(searchPlaceholder)}
              className="input w-full ps-9"
              aria-label={translatePortalText(searchPlaceholder)}
            />
            {state.query && (
              <button
                onClick={() => state.setQuery('')}
                className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-deep-900"
                aria-label={translatePortalText('Clear search')}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {defs.length > 0 && (
          <button
            onClick={() => setOpen(o => !o)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold transition ${
              open || filterCount ? 'bg-deep-900 text-white shadow-xs' : 'bg-white text-slate-500 hover:text-deep-900 ring-1 ring-slate-200'
            }`}
          >
            <SlidersHorizontal size={13} />
            {translatePortalText('Filters')}
            {filterCount > 0 && (
              <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] leading-none">{filterCount}</span>
            )}
          </button>
        )}

        {/*
          Ordering sits beside the filters rather than inside the collapsible
          panel: which way a list is sorted changes what the first screen shows,
          so it should be readable without opening anything.
        */}
        {(config.sortOptions?.length ?? 0) > 0 && (
          <div className="flex items-center gap-1">
            <select
              value={state.sort}
              onChange={e => state.setSort(e.target.value)}
              aria-label={translatePortalText('Sort by')}
              className="input !w-auto !py-2 !text-[11px] !font-bold"
            >
              {config.sortOptions!.map(o => (
                <option key={o.key} value={o.key}>
                  {translatePortalText(o.label)}
                </option>
              ))}
            </select>
            <button
              onClick={state.toggleDir}
              aria-label={state.dir === 'asc' ? translatePortalText('Ascending — switch to descending') : translatePortalText('Descending — switch to ascending')}
              title={state.dir === 'asc' ? translatePortalText('Ascending') : translatePortalText('Descending')}
              className="rounded-full bg-white px-2.5 py-2 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 transition hover:text-deep-900"
            >
              {state.dir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        )}

        {state.activeCount > 0 && (
          <>
            <span className="text-[11px] font-bold text-slate-400">
              {isPortalArabic()
                ? `${formatPortalNumber(state.filtered.length)} من ${formatPortalNumber(state.total)} ${translatePortalText(noun)}`
                : `${formatPortalNumber(state.filtered.length)} of ${formatPortalNumber(state.total)} ${noun}`}
            </span>
            <button
              onClick={state.clear}
              className="text-[11px] font-bold text-emerald-600 transition hover:text-emerald-700"
            >
              {translatePortalText('Clear all')}
            </button>
          </>
        )}

        {children && <div className="ms-auto flex items-center gap-2">{children}</div>}
      </div>

      {open && defs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-2xl bg-white/80 p-3 ring-1 ring-slate-100 shadow-2xs">
          {defs.map(def => {
            if (def.kind === 'dateRange') {
              const { from, to } = parseDateRange(state.values[def.key] ?? '')
              return (
                <div key={def.key} className="flex min-w-[240px] flex-1 flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(def.label)}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={from}
                      // Bounded by each other so the pickers cannot express an
                      // empty range and leave an unexplained blank table.
                      max={to || undefined}
                      onChange={e => state.setValue(def.key, buildDateRange(e.target.value, to))}
                      aria-label={`${translatePortalText(def.label)} ${translatePortalText('from')}`}
                      className="input !py-1.5 !text-[12px]"
                    />
                    <span className="shrink-0 text-slate-300">→</span>
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={e => state.setValue(def.key, buildDateRange(from, e.target.value))}
                      aria-label={`${translatePortalText(def.label)} ${translatePortalText('to')}`}
                      className="input !py-1.5 !text-[12px]"
                    />
                  </div>
                </div>
              )
            }
            const opts = optionsFor(def, rows)
            return (
              <label key={def.key} className="flex min-w-[150px] flex-1 flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(def.label)}</span>
                <select
                  value={state.values[def.key] ?? ''}
                  onChange={e => state.setValue(def.key, e.target.value)}
                  className="input !py-1.5 !text-[12px]"
                >
                  <option value="">{def.anyLabel ? translatePortalText(def.anyLabel) : `${translatePortalText('All')} ${translatePortalText(def.label)}`}</option>
                  {opts.map(o => (
                    <option key={o.value} value={o.value}>
                      {translatePortalText(o.label)}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Reusable, responsive table pagination bar with page sizes, smart page numbers, and item summary.
 */
export function TablePagination<T>({
  state,
  noun = 'items',
  pageSizeOptions = [10, 15, 25, 50, 100],
  className = '',
}: {
  state: TableFiltersState<T>
  noun?: string
  pageSizeOptions?: number[]
  className?: string
}) {
  const { page, pageSize, totalPages, totalFiltered, pageStart, pageEnd, setPage, setPageSize, hasPrevPage, hasNextPage } = state

  // Generate page numbers with ellipsis
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    const pages: (number | 'ellipsis')[] = []
    if (page <= 4) {
      pages.push(1, 2, 3, 4, 5, 'ellipsis', totalPages)
    } else if (page >= totalPages - 3) {
      pages.push(1, 'ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
    } else {
      pages.push(1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', totalPages)
    }
    return pages
  }, [page, totalPages])

  if (totalFiltered === 0) return null

  return (
    <div className={`mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 px-2 text-xs text-slate-500 ${className}`}>
      {/* Items Summary & Per-Page Selector */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-slate-500">
          {isPortalArabic() ? (
            <>
              عرض <span className="font-bold text-deep-900">{formatPortalNumber(pageStart)}</span> إلى{' '}
              <span className="font-bold text-deep-900">{formatPortalNumber(pageEnd)}</span> من{' '}
              <span className="font-bold text-deep-900">{formatPortalNumber(totalFiltered)}</span> {translatePortalText(noun)}
            </>
          ) : (
            <>
              {translatePortalText("Showing ")}<span className="font-bold text-deep-900">{formatPortalNumber(pageStart)}</span> {translatePortalText("to")}{' '}
              <span className="font-bold text-deep-900">{formatPortalNumber(pageEnd)}</span> {translatePortalText("of")}{' '}
              <span className="font-bold text-deep-900">{formatPortalNumber(totalFiltered)}</span> {noun}
            </>
          )}
        </span>

        {pageSizeOptions.length > 0 && totalFiltered > Math.min(...pageSizeOptions) && (
          <div className="flex items-center gap-1.5 ps-2 border-s border-slate-200">
            <span className="text-[11px] font-medium text-slate-400">{translatePortalText('Rows:')}</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs focus:border-ocean-500 focus:outline-none"
            >
              {pageSizeOptions.map(size => (
                <option key={size} value={size}>
                  {formatPortalNumber(size)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {/* First page */}
          <button
            onClick={() => setPage(1)}
            disabled={!hasPrevPage}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-deep-900 disabled:opacity-30 disabled:pointer-events-none"
            title={translatePortalText('First page')}
          >
            <ChevronsLeft size={14} className={isPortalArabic() ? 'rotate-180' : ''} />
          </button>

          {/* Previous page */}
          <button
            onClick={() => setPage(page - 1)}
            disabled={!hasPrevPage}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-deep-900 disabled:opacity-30 disabled:pointer-events-none"
            title={translatePortalText('Previous page')}
          >
            <ChevronLeft size={14} className={isPortalArabic() ? 'rotate-180' : ''} />
          </button>

          {/* Page numbers */}
          <div className="flex items-center gap-1 px-1">
            {pageNumbers.map((p, i) => {
              if (p === 'ellipsis') {
                return (
                  <span key={`ellipsis-${i}`} className="px-1.5 text-slate-300 font-bold">
                    …
                  </span>
                )
              }
              const active = p === page
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`grid h-8 min-w-[32px] px-2 place-items-center rounded-lg text-xs font-bold transition ${
                    active
                      ? 'bg-deep-900 text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-sand/80 hover:text-deep-900'
                  }`}
                >
                  {formatPortalNumber(p)}
                </button>
              )
            })}
          </div>

          {/* Next page */}
          <button
            onClick={() => setPage(page + 1)}
            disabled={!hasNextPage}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-deep-900 disabled:opacity-30 disabled:pointer-events-none"
            title={translatePortalText('Next page')}
          >
            <ChevronRight size={14} className={isPortalArabic() ? 'rotate-180' : ''} />
          </button>

          {/* Last page */}
          <button
            onClick={() => setPage(totalPages)}
            disabled={!hasNextPage}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-deep-900 disabled:opacity-30 disabled:pointer-events-none"
            title={translatePortalText('Last page')}
          >
            <ChevronsRight size={14} className={isPortalArabic() ? 'rotate-180' : ''} />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * What a table shows when filtering has excluded everything.
 */
export function NoFilterMatches({ noun = 'rows', onClear }: { noun?: string; onClear: () => void }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm font-bold text-slate-500">
        {isPortalArabic() ? 'لا توجد نتائج تطابق البحث أو عوامل التصفية.' : `No ${noun} match your search or filters.`}
      </p>
      <button onClick={onClear} className="mt-2 text-[12px] font-bold text-emerald-600 hover:text-emerald-700">
        {translatePortalText('Clear all filters')}
      </button>
    </div>
  )
}
