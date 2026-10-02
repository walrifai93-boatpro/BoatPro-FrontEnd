import { PORTAL_ARABIC_MESSAGES } from './portalMessages'
import { ADMIN_ARABIC_MESSAGES } from './adminMessages'
import { MARINA_PANEL_ARABIC_MESSAGES } from './marinaPanelMessages'
import { MARINA_PAGES_ARABIC_MESSAGES } from './marinaPagesMessages'
import { MARINA_SETTINGS_ARABIC_MESSAGES } from './marinaSettingsMessages'
import { MARINA_SHARED_ARABIC_MESSAGES } from './marinaSharedMessages'
import { MARINA_ACCESS_ARABIC_MESSAGES } from './marinaAccessMessages'
import { MARINA_ONBOARDING_ARABIC_MESSAGES } from './marinaOnboardingMessages'
import { BOAT_PORTAL_ARABIC_MESSAGES } from './boatMessages'
import { FUEL_ARABIC_MESSAGES } from './fuelMessages'
import { MAINTENANCE_ARABIC_MESSAGES } from './maintMessages'
import { REPORTS_ARABIC_MESSAGES } from './reportsMessages'
import { GAP_ADMIN_ARABIC_MESSAGES } from './gapAdminMessages'
import { GAP_FUEL_ARABIC_MESSAGES } from './gapFuelMessages'
import { GAP_MAINT_ARABIC_MESSAGES } from './gapMaintMessages'
import { GAP_MARINA_ARABIC_MESSAGES } from './gapMarinaMessages'
import { GAP_SERVER_1_ARABIC_MESSAGES } from './gapServer1Messages'
import { GAP_SERVER_2_ARABIC_MESSAGES } from './gapServer2Messages'
import { GAP_SERVER_3_ARABIC_MESSAGES } from './gapServer3Messages'
import { GAP_SERVER_4_ARABIC_MESSAGES } from './gapServer4Messages'

export type PortalLanguage = 'en' | 'ar'
export const PORTAL_LANGUAGE_KEY = 'boatpro.portal.language'

const NORMALIZED_MESSAGES = new Map<string, string>()
type PortalTemplateMatch = {
  source: RegExp
  names: string[]
  translation: string
  score: number
  omittedCountPlaceholder: boolean
}
let portalTemplateMatches: PortalTemplateMatch[] = []

// Lowercased: catalog keys are normalized to lowercase, so `{{stationName}}`
// in the English arrives as `{{stationname}}` while the Arabic keeps its case.
// Comparing them as written dropped every camelCase template as mismatched.
function portalTemplatePlaceholders(input: string): string[] {
  return [...input.matchAll(/\{\{([a-z][\w]*)\}\}/gi)].map(match => match[1].toLowerCase())
}

function addMessages(messages: Record<string, string>, overwrite = true): void {
  for (const [english, arabic] of Object.entries(messages)) {
    const key = normalizeKey(english)
    if (overwrite || !NORMALIZED_MESSAGES.has(key)) NORMALIZED_MESSAGES.set(key, arabic)
  }
  portalTemplateMatches = buildPortalTemplateMatches()
}

function buildPortalTemplateMatches(): PortalTemplateMatch[] {
  return [...NORMALIZED_MESSAGES.entries()]
    .filter(([english]) => /\{\{[a-z][\w]*\}\}/i.test(english))
    .map(([english, translation]) => {
      const names: string[] = []
      const parts = english.split(/(\{\{[a-z][\w]*\}\})/i)
      const fixedText = english.replace(/\{\{[a-z][\w]*\}\}/gi, '')
      const sourceNames = new Set(portalTemplatePlaceholders(english))
      const translatedNames = new Set(portalTemplatePlaceholders(translation))
      const hasUnexpectedPlaceholder = [...translatedNames].some(name => !sourceNames.has(name))
      const missingNames = [...sourceNames].filter(name => !translatedNames.has(name))

      // A variable-only pattern such as "🧾 {{invoiceNumber}}" can capture
      // any text after the icon and steal an exact translation. Require a
      // literal word to identify a template. Arabic may omit {{count}} for a
      // one-item form, but that translation must never be used for other counts.
      if (!/[A-Za-z]{3,}/.test(fixedText) || hasUnexpectedPlaceholder) return null
      if (missingNames.some(name => name !== 'count')) return null

      const source = parts.map((part) => {
        const placeholder = part.match(/^\{\{([a-z][\w]*)\}\}$/i)
        if (placeholder) {
          names.push(placeholder[1])
          return '([\\s\\S]+?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
      }).join('')
      return {
        source: new RegExp(`^${source}$`, 'i'),
        names,
        translation,
        score: fixedText.length,
        omittedCountPlaceholder: missingNames.includes('count'),
      }
    })
    .filter((entry): entry is PortalTemplateMatch => entry !== null)
    .sort((a, b) => b.score - a.score)
}

function interpolatePortalTemplate(template: string, values: Record<string, string | number>): string {
  const normalizedValues = new Map(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]),
  )
  return template.replace(/\{\{([a-z][\w]*)\}\}/gi, (token, name: string) => {
    const value = normalizedValues.get(name.toLowerCase())
    // Keep template syntax out of the rendered UI when a caller omits a value.
    if (value === null || value === undefined) return '—'
    const valueText = isPortalArabic() && typeof value === 'number' && Number.isFinite(value)
      ? formatPortalNumber(value)
      : String(value)
    return isPortalArabic() ? `\u2068${valueText}\u2069` : valueText
  })
}

function arabicFuelEquipmentParts(value: string): string {
  const translated = value.split(/\s*,\s*/).map((part) => {
    const match = part.match(/^(\d+)\s+(tanks?|pumps?|crew members?)$/i)
    if (!match) return part
    const count = parsePortalInteger(match[1])
    const digits = formatPortalNumber(count)
    const noun = match[2].toLowerCase()
    if (noun.startsWith('tank')) {
      if (count === 1) return 'خزان واحد'
      if (count === 2) return 'خزانان'
      if (count >= 3 && count <= 10) return `${digits} خزانات`
      return `${digits} خزانًا`
    }
    if (noun.startsWith('pump')) {
      if (count === 1) return 'مضخة واحدة'
      if (count === 2) return 'مضختان'
      if (count >= 3 && count <= 10) return `${digits} مضخات`
      return `${digits} مضخة`
    }
    if (count === 1) return 'فرد واحد من الطاقم'
    if (count === 2) return 'فردان من الطاقم'
    if (count >= 3 && count <= 10) return `${digits} أفراد من الطاقم`
    return `${digits} فردًا من الطاقم`
  })
  return translated.join('، ')
}

function localizedTemplateValues(names: string[], captures: string[]): Record<string, string | number> {
  const values: Record<string, string | number> = {}
  names.forEach((name, index) => {
    const raw = captures[index]
    const numericValue = parsePortalInteger(raw)
    const isNumericLabel = /^(count|.*count|qty|quantity|stock|capacity|remaining|available|balance|amount|percent|percentage|rate|score|total|hours|days|day|channel|workers|tanks|products|photos|vehicles|orders|fields|locations|quantity|load|required|maxRemaining)$/i.test(name)
    if (isPortalArabic() && isNumericLabel && Number.isFinite(numericValue)) {
      values[name] = formatPortalNumber(numericValue)
      return
    }

    if (isPortalArabic() && name.toLowerCase() === 'parts') {
      values[name] = arabicFuelEquipmentParts(raw)
      return
    }

    if (isPortalArabic() && name.toLowerCase() === 'unit') {
      const units: Record<string, string> = {
        l: 'لتر', litre: 'لتر', litres: 'لتر', liter: 'لتر', liters: 'لتر',
        ml: 'ملليلتر', millilitre: 'ملليلتر', millilitres: 'ملليلتر',
        gal: 'غالون', gallon: 'غالون', gallons: 'غالون',
        'us gal': 'غالون أمريكي', 'us gallon': 'غالون أمريكي', 'us gallons': 'غالون أمريكي',
      }
      values[name] = units[raw.trim().toLowerCase()] ?? raw
      return
    }

    if (isPortalArabic() && name.toLowerCase() === 'label') {
      const fuelEntityLabels: Record<string, string> = {
        product: 'منتج', supplier: 'مورد', tank: 'خزان',
        'purchase order': 'أمر شراء', pump: 'مضخة', vehicle: 'مركبة',
        'staff member': 'عضو طاقم',
      }
      values[name] = fuelEntityLabels[raw.trim().toLowerCase()] ?? raw
      return
    }

    // Only translate values that are app-owned enums. Names, references,
    // product labels, and free-form calendar titles intentionally keep their
    // source-language spelling unless the record has an Arabic field.
    if (isPortalArabic() && /^(kind|eventKind|status|action|page|range|approval|limit|method|preference)$/i.test(name)) {
      const displayValue = raw.trim().replace(/_/g, ' ')
      const fuelPageNames: Record<string, string> = {
        calendar: 'تقويم الوقود', tracking: 'التتبع المباشر', bookings: 'طلبات الوقود',
        deliveries: 'إدارة طلبات الوقود', inventory: 'المخزون والخزانات', pricing: 'التسعير',
        billing: 'الفوترة والمدفوعات', reports: 'التقارير والتحليلات', messages: 'التواصل',
        notifications: 'الإشعارات', station: 'ملف المحطة', dashboard: 'لوحة التحكم',
      }
      values[name] = name.toLowerCase() === 'page' ? fuelPageNames[displayValue.toLowerCase()] ?? raw
        : NORMALIZED_MESSAGES.get(normalizeKey(raw))
          ?? NORMALIZED_MESSAGES.get(normalizeKey(displayValue))
        ?? raw
      return
    }
    values[name] = raw
  })
  return values
}

function translatePortalTemplateMatch(input: string): string | undefined {
  for (const entry of portalTemplateMatches) {
    const match = input.match(entry.source)
    if (!match) continue
    if (entry.omittedCountPlaceholder) {
      const countIndex = entry.names.indexOf('count')
      if (countIndex < 0 || parsePortalInteger(match[countIndex + 1]) !== 1) continue
    }
    const values = localizedTemplateValues(entry.names, match.slice(1))
    return interpolatePortalTemplate(entry.translation, values)
  }
  return undefined
}
addMessages(PORTAL_ARABIC_MESSAGES)
addMessages(ADMIN_ARABIC_MESSAGES)
addMessages(MARINA_PANEL_ARABIC_MESSAGES)
addMessages(MARINA_PAGES_ARABIC_MESSAGES)
addMessages(MARINA_SETTINGS_ARABIC_MESSAGES)
addMessages(MARINA_SHARED_ARABIC_MESSAGES)
addMessages(MARINA_ACCESS_ARABIC_MESSAGES)
addMessages(MARINA_ONBOARDING_ARABIC_MESSAGES)
addMessages(BOAT_PORTAL_ARABIC_MESSAGES)
addMessages(FUEL_ARABIC_MESSAGES)

// Short prepositions and auxiliary verbs make poor partial-translation
// matches: replacing "is" or "in" inside an otherwise unknown sentence can
// produce broken Arabic. They still translate when the whole phrase is a key.
const PARTIAL_TRANSLATION_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'for',
  'from', 'has', 'have', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to',
  'was', 'were', 'with',
])
addMessages(MAINTENANCE_ARABIC_MESSAGES)
// The Reports Center's own strings fill gaps only; wording other catalogs already use wins.
addMessages(REPORTS_ARABIC_MESSAGES, false)
// Copy the per-portal catalogs above missed; fill-only for the same reason.
addMessages(GAP_ADMIN_ARABIC_MESSAGES, false)
addMessages(GAP_FUEL_ARABIC_MESSAGES, false)
addMessages(GAP_MAINT_ARABIC_MESSAGES, false)
addMessages(GAP_MARINA_ARABIC_MESSAGES, false)
// Server error and validation text (the backend answers in English).
addMessages(GAP_SERVER_1_ARABIC_MESSAGES, false)
addMessages(GAP_SERVER_2_ARABIC_MESSAGES, false)
addMessages(GAP_SERVER_3_ARABIC_MESSAGES, false)
addMessages(GAP_SERVER_4_ARABIC_MESSAGES, false)

function createPartialTranslationPattern(): RegExp {
  return new RegExp(
    `(^|[^A-Za-z0-9])(${[...NORMALIZED_MESSAGES.keys()]
    .filter(english => /[A-Za-z]/.test(english) && english.length >= 3 && !PARTIAL_TRANSLATION_STOPWORDS.has(english))
    .sort((a, b) => b.length - a.length)
    .map(english => english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .join('|')})(?=$|[^A-Za-z0-9])`,
    'gi',
  )
}

let partialTranslationPattern = createPartialTranslationPattern()
const PARTIAL_TRANSLATION_CACHE = new Map<string, string>()
let sharedArabicCatalog: Promise<void> | null = null

async function loadSharedArabicCatalog(): Promise<void> {
  if (!sharedArabicCatalog) {
    sharedArabicCatalog = import('./sharedMessages').then(({ SHARED_ARABIC_MESSAGES }) => {
      // Portal/page catalogs are more specific than the broad shared catalog.
      // Keep their wording when the same English key has different meanings.
      addMessages(SHARED_ARABIC_MESSAGES, false)
      partialTranslationPattern = createPartialTranslationPattern()
      PARTIAL_TRANSLATION_CACHE.clear()
    }).catch(() => {
      // Portal-specific wording remains available if the shared catalog fails.
      sharedArabicCatalog = null
    })
  }
  await sharedArabicCatalog
}

function normalizeKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
}

export function getPortalLanguage(): PortalLanguage {
  try {
    const stored = window.localStorage.getItem(PORTAL_LANGUAGE_KEY)
    if (stored === 'ar' || stored === 'en') return stored
    return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en'
  } catch {
    return 'en'
  }
}

export function isPortalArabic(): boolean {
  return getPortalLanguage() === 'ar'
}

function parsePortalInteger(value: string): number {
  const westernDigits = value
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/٫/g, '.')
  return Number(westernDigits.replace(/[٬,]/g, ''))
}

function arabicMonthCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  if (count === 1) return 'شهر واحد'
  if (count === 2) return 'شهران'
  if (count >= 3 && count <= 10) return `${formatPortalNumber(count)} أشهر`
  return `${formatPortalNumber(count)} شهرًا`
}

function arabicDayCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  if (count === 1) return 'يوم واحد'
  if (count === 2) return 'يومان'
  if (count >= 3 && count <= 10) return `${formatPortalNumber(count)} أيام`
  return `${formatPortalNumber(count)} يومًا`
}

function arabicPhotoCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  if (count === 1) return 'صورة واحدة'
  if (count === 2) return 'صورتان'
  if (count % 100 >= 3 && count % 100 <= 10) return `${formatPortalNumber(count)} صور`
  return `${formatPortalNumber(count)} صورة`
}

function arabicPhotoObjectCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  return count === 2 ? 'صورتين' : arabicPhotoCount(count)
}

function arabicPhotoNoun(value: number): string {
  const count = Math.abs(Math.trunc(value))
  return count % 100 >= 3 && count % 100 <= 10 ? 'صور' : 'صورة'
}

function arabicBerthCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  if (count === 1) return 'رصيف واحد'
  if (count === 2) return 'رصيفان'
  if (count >= 3 && count <= 10) return `${formatPortalNumber(count)} أرصفة`
  return `${formatPortalNumber(count)} رصيفًا`
}

function arabicBerthObjectCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  if (count === 1) return 'رصيفًا واحدًا'
  if (count === 2) return 'رصيفين'
  if (count >= 3 && count <= 10) return `${formatPortalNumber(count)} أرصفة`
  return `${formatPortalNumber(count)} رصيفًا`
}

function arabicContractCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  if (count === 1) return 'عقد واحد'
  if (count === 2) return 'عقدان'
  if (count >= 3 && count <= 10) return `${formatPortalNumber(count)} عقود`
  return `${formatPortalNumber(count)} عقدًا`
}

function arabicStayCount(value: number): string {
  const count = Math.abs(Math.trunc(value))
  if (count === 1) return 'إقامة واحدة'
  if (count === 2) return 'إقامتان'
  if (count >= 3 && count <= 10) return `${formatPortalNumber(count)} إقامات`
  return `${formatPortalNumber(count)} إقامة`
}

export function portalLocale(): string {
  // Keep dates Gregorian in both languages. Saudi Arabia's default calendar
  // can be Hijri, which changes the meaning of an invoice or booking date.
  return isPortalArabic() ? 'ar-SA-u-ca-gregory' : 'en-US-u-ca-gregory'
}

/** Monday-first weekday labels in the active portal language. */
export function portalWeekdayLabels(): string[] {
  const startOfMonday = Date.UTC(2024, 0, 1)
  const formatter = new Intl.DateTimeFormat(portalLocale(), { weekday: 'short', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, day) => formatter.format(new Date(startOfMonday + day * 86_400_000)))
}

export function applyPortalLanguage(language: PortalLanguage): void {
  try {
    window.localStorage.setItem(PORTAL_LANGUAGE_KEY, language)
  } catch {
    // The language still takes effect for this page when storage is blocked.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.setAttribute('translate', 'no')
    document.documentElement.classList.add('notranslate')
  }
}

export async function bootstrapPortalLanguage(): Promise<PortalLanguage> {
  const language = getPortalLanguage()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.setAttribute('translate', 'no')
    document.documentElement.classList.add('notranslate')
  }
  if (language === 'ar') await loadSharedArabicCatalog()
  return language
}

/** Translate fixed interface copy; free-form account data stays intact. */
export function translatePortalText(input: string): string {
  if (!isPortalArabic() || !input) return input

  // A known fixed phrase must win before a dynamic template or partial match.
  // Otherwise a broad key such as "🧾 {{invoiceNumber}}" can capture a
  // different icon-led phrase and replace its correct Arabic translation.
  const exact = NORMALIZED_MESSAGES.get(normalizeKey(input))
  if (exact !== undefined && !/\{\{[a-z][\w]*\}\}/i.test(exact)) {
    const leading = input.match(/^\s*/)?.[0] ?? ''
    const trailing = input.match(/\s*$/)?.[0] ?? ''
    return `${leading}${exact}${trailing}`
  }

  // Day counts have Arabic dual and plural forms. Resolve them before generic
  // catalog templates such as "{{count}} days", whose fixed translation cannot
  // express the correct one/two/few/many form for every value.
  const standaloneDayCount = input.match(/^([\d٠-٩۰-۹,٬]+)\s+days?$/i)
  if (standaloneDayCount) return arabicDayCount(parsePortalInteger(standaloneDayCount[1]))

  // Dynamic fuel UI and API messages use complete catalog phrases with named
  // placeholders. Match the whole source phrase so Arabic can reorder its
  // sentence without guessing from English fragments.
  const templated = translatePortalTemplateMatch(input)
  if (templated !== undefined) return templated

  const berthInvoiceLineMatch = input.match(/^Berth (.*?) · (.+)$/i)
  if (berthInvoiceLineMatch) return `رصيف ${berthInvoiceLineMatch[1]} · ${berthInvoiceLineMatch[2]}`

  const dockStayInvoiceLineMatch = input.match(/^Berth (.+?) at (.+) — (\d+) day\(s\)$/i)
  if (dockStayInvoiceLineMatch) {
    return `رصيف ${dockStayInvoiceLineMatch[1]} في ${dockStayInvoiceLineMatch[2]} — ${formatPortalNumber(Number(dockStayInvoiceLineMatch[3]))} يومًا`
  }

  const dockRenewalInvoiceLineMatch = input.match(/^Berth (.+?) renewal — (\d+) month\(s\)$/i)
  if (dockRenewalInvoiceLineMatch) {
    return `تجديد رصيف ${dockRenewalInvoiceLineMatch[1]} — ${formatPortalNumber(Number(dockRenewalInvoiceLineMatch[2]))} شهرًا`
  }

  const utilityInvoiceLineMatch = input.match(/^(Electricity|Water) · ([\d.,]+) (kWh|m³) \(([^)]+)\)$/i)
  if (utilityInvoiceLineMatch) {
    const kind = utilityInvoiceLineMatch[1].toLowerCase() === 'electricity' ? 'الكهرباء' : 'المياه'
    return `${kind} · ${formatPortalNumber(Number(utilityInvoiceLineMatch[2]))} ${utilityInvoiceLineMatch[3]} (${utilityInvoiceLineMatch[4]})`
  }

  const dockCreatedWithBerthsMatch = input.match(/^✨ Dock (.+) created with (\d+) berths!$/i)
  if (dockCreatedWithBerthsMatch) {
    return `✨ تم إنشاء الرصيف ${dockCreatedWithBerthsMatch[1]} بنجاح، وأُضيفت إليه ${formatPortalNumber(Number(dockCreatedWithBerthsMatch[2]))} مواقف!`
  }

  const dockCreatedMatch = input.match(/^✨ Dock (.+) created successfully!$/i)
  if (dockCreatedMatch) return `✨ تم إنشاء الرصيف ${dockCreatedMatch[1]} بنجاح!`

  const berthPhotoUploadMatch = input.match(/^Uploaded (\d+) berth photos?$/i)
  if (berthPhotoUploadMatch) {
    return `تم رفع ${arabicPhotoObjectCount(parsePortalInteger(berthPhotoUploadMatch[1]))} للرصيف.`
  }

  const berthPhotoStagedMatch = input.match(/^Added (\d+) photos? to upload upon saving$/i)
  if (berthPhotoStagedMatch) {
    return `تمت إضافة ${arabicPhotoObjectCount(parsePortalInteger(berthPhotoStagedMatch[1]))} لرفعها عند الحفظ.`
  }

  const photoUploadCountMatch = input.match(/^(\d+) photos? uploaded$/i)
  if (photoUploadCountMatch) return `تم رفع ${arabicPhotoObjectCount(parsePortalInteger(photoUploadCountMatch[1]))}.`

  const berthSavedMatch = input.match(/^Berth (.+) (created|updated) successfully!?$/i)
  if (berthSavedMatch) {
    const verb = berthSavedMatch[2].toLowerCase() === 'created' ? 'إنشاء' : 'تحديث'
    return `تم ${verb} الرصيف ${berthSavedMatch[1]} بنجاح.`
  }

  const saudiIbanLengthMatch = input.match(/^A Saudi IBAN is SA followed by 22 digits \(24 characters in total\); this one has (\d+)$/i)
  if (saudiIbanLengthMatch) {
    return `يتكون رقم IBAN السعودي من SA و٢٢ رقمًا (٢٤ خانة إجمالًا)؛ الرقم الحالي يحتوي على ${formatPortalNumber(Number(saudiIbanLengthMatch[1]))} خانة.`
  }

  const imageGalleryCountMatch = input.match(/^(\d+) \/ (\d+) images uploaded(?: \(minimum (\d+) required\))?$/i)
  if (imageGalleryCountMatch) {
    const count = formatPortalNumber(parsePortalInteger(imageGalleryCountMatch[1]))
    const maximum = parsePortalInteger(imageGalleryCountMatch[2])
    const minimum = imageGalleryCountMatch[3]
      ? ` الحد الأدنى ${arabicPhotoCount(parsePortalInteger(imageGalleryCountMatch[3]))}.`
      : '.'
    return `تم رفع ${count} من أصل ${formatPortalNumber(maximum)} ${arabicPhotoNoun(maximum)}.${minimum}`
  }

  const maximumImagesMatch = input.match(/^Maximum (\d+) images reached$/i)
  if (maximumImagesMatch) {
    return `تم الوصول إلى الحد الأقصى لعدد الصور (${formatPortalNumber(Number(maximumImagesMatch[1]))}).`
  }

  const chatFileSizeMatch = input.match(/^(.+) is ([\d٠-٩,٬٫.]+) MB — the limit is ([\d٠-٩,٬٫.]+) MB$/i)
  if (chatFileSizeMatch) {
    return `حجم الملف ${chatFileSizeMatch[1]} هو ${chatFileSizeMatch[2]} ميغابايت — الحد الأقصى ${chatFileSizeMatch[3]} ميغابايت.`
  }

  const tamaraInstalmentRangeMatch = input.match(/^Instalments are available for totals between ([\d,.]+) and ([\d,.]+) ([A-Z]{3})\.$/i)
  if (tamaraInstalmentRangeMatch) {
    return `تتوفر خدمة التقسيط للمبالغ من ${formatPortalNumber(Number(tamaraInstalmentRangeMatch[1]))} إلى ${formatPortalNumber(Number(tamaraInstalmentRangeMatch[2]))} ${tamaraInstalmentRangeMatch[3].toUpperCase()}.`
  }

  const providerKind = '(boat|marina|fuel|maintenance)'
  const localizedInteger = '[\\d٠-٩۰-۹٬,]+'
  const searchToastMatch = input.match(/^Searching “([\s\S]*)”…$/i)
  if (searchToastMatch) return `جارٍ البحث عن «${searchToastMatch[1]}»…`

  const providerListErrorMatch = input.match(/^Could not load (Boat Listings|Marinas & Berths|Fuel Stations|Service Catalog)$/i)
  if (providerListErrorMatch) {
    const list = providerListErrorMatch[1].toLowerCase()
    const label = list === 'boat listings' ? 'إعلانات القوارب' : list === 'marinas & berths' ? 'المراسي والأرصفة' : list === 'fuel stations' ? 'محطات الوقود' : 'كتالوج الخدمات'
    return `تعذر تحميل ${label}`
  }

  const rejectNamedEntityMatch = input.match(/^Reject (vendor|marina): "([\s\S]*)"$/i)
  if (rejectNamedEntityMatch) return `رفض ${rejectNamedEntityMatch[1].toLowerCase() === 'vendor' ? 'مقدم الخدمة' : 'المرسى'}: «${rejectNamedEntityMatch[2]}»`

  const providerRejectTitleMatch = input.match(/^Reject (.+)$/i)
  if (providerRejectTitleMatch) return `رفض ${translatePortalText(providerRejectTitleMatch[1])}`

  const verificationTitleMatch = input.match(/^Verification: (.+)$/i)
  if (verificationTitleMatch) return `التحقق: ${translatePortalText(verificationTitleMatch[1])}`

  const providerPayableTitleMatch = input.match(new RegExp(`^(${localizedInteger}) providers? · (.+) payable$`, 'i'))
  if (providerPayableTitleMatch) return `${formatPortalNumber(parsePortalInteger(providerPayableTitleMatch[1]))} من المزودين · المستحق ${providerPayableTitleMatch[2]}`

  const transferReceiptTitleMatch = input.match(/^Bank Transfer Receipt — (.+)$/i)
  if (transferReceiptTitleMatch) return `إيصال التحويل البنكي — ${transferReceiptTitleMatch[1]}`

  const collectionsIssuedMatch = input.match(new RegExp(`^(.+): (${localizedInteger}) statement\\(s\\) issued to (${localizedInteger}) provider\\(s\\)$`, 'i'))
  if (collectionsIssuedMatch) return `${collectionsIssuedMatch[1]}: تم إصدار ${formatPortalNumber(parsePortalInteger(collectionsIssuedMatch[2]))} من الكشوفات إلى ${formatPortalNumber(parsePortalInteger(collectionsIssuedMatch[3]))} من المزودين`

  const collectionsOverdueMatch = input.match(new RegExp(`^(${localizedInteger}) statement\\(s\\) marked overdue$`, 'i'))
  if (collectionsOverdueMatch) return `تم وضع علامة متأخر على ${formatPortalNumber(parsePortalInteger(collectionsOverdueMatch[1]))} من الكشوفات`

  const providerLiveApprovedMatch = input.match(/^(.+) approved — now live$/i)
  if (providerLiveApprovedMatch) return `تم اعتماد ${providerLiveApprovedMatch[1]} وأصبح متاحًا الآن`
  const approvedItemMatch = input.match(/^(.+) approved$/i)
  if (approvedItemMatch) return `تم اعتماد ${approvedItemMatch[1]}`

  const marketListingMatch = input.match(/^(.+) (approved & listed|rejected|unfeatured|featured on homepage|verified|taken offline|brought online)$/i)
  if (marketListingMatch) {
    const verb = marketListingMatch[2].toLowerCase()
    const action = verb === 'approved & listed' ? 'تم اعتماد وإدراج' : verb === 'rejected' ? 'تم رفض' : verb === 'unfeatured' ? 'تمت إزالة تمييز' : verb === 'featured on homepage' ? 'تم تمييزه على الصفحة الرئيسية:' : verb === 'verified' ? 'تم التحقق من' : verb === 'taken offline' ? 'تم إيقاف' : 'تم إعادة تشغيل'
    return `${action} ${marketListingMatch[1]}`
  }

  const maintenanceServiceStateMatch = input.match(/^(.+) (paused|activated)$/i)
  if (maintenanceServiceStateMatch) return maintenanceServiceStateMatch[2].toLowerCase() === 'paused' ? `تم إيقاف ${maintenanceServiceStateMatch[1]}` : `تم تفعيل ${maintenanceServiceStateMatch[1]}`

  const vendorRemovedMatch = input.match(/^(.+) removed$/i)
  if (vendorRemovedMatch) return `تم حذف ${vendorRemovedMatch[1]}`

  const couponCreatedMatch = input.match(/^Coupon ([A-Z0-9_-]+) created$/i)
  if (couponCreatedMatch) return `تم إنشاء القسيمة ${couponCreatedMatch[1]}`
  const couponStateMatch = input.match(/^([A-Z0-9_-]+) (deactivated|activated)$/i)
  if (couponStateMatch) return couponStateMatch[2].toLowerCase() === 'activated' ? `تم تفعيل القسيمة ${couponStateMatch[1]}` : `تم إيقاف القسيمة ${couponStateMatch[1]}`
  const campaignCreatedMatch = input.match(/^Campaign "([\s\S]*)" created$/i)
  if (campaignCreatedMatch) return `تم إنشاء الحملة «${campaignCreatedMatch[1]}»`

  const intelStateMatch = input.match(/^Marked (.+)$/i)
  if (intelStateMatch) return `تم وضع علامة ${translatePortalText(intelStateMatch[1])}`
  const settingStateMatch = input.match(/^(.+) (enabled|disabled)$/i)
  if (settingStateMatch) return settingStateMatch[2].toLowerCase() === 'enabled' ? `تم تفعيل ${translatePortalText(settingStateMatch[1])}` : `تم تعطيل ${translatePortalText(settingStateMatch[1])}`

  const workerTitleMatch = input.match(new RegExp(`^${providerKind} Worker Requests$`, 'i'))
  if (workerTitleMatch) return `طلبات العاملين — ${translatePortalText(workerTitleMatch[1])}`

  const providerSearchMatch = input.match(new RegExp(`^Search ${providerKind} providers by name, owner, email\\.\\.\\.$`, 'i'))
  if (providerSearchMatch) return `ابحث عن مزودي ${translatePortalText(providerSearchMatch[1])} بالاسم أو المالك أو البريد الإلكتروني…`

  const providerLoadErrorMatch = input.match(new RegExp(`^Failed to load ${providerKind} providers$`, 'i'))
  if (providerLoadErrorMatch) return `تعذر تحميل مزودي ${translatePortalText(providerLoadErrorMatch[1])}`

  const providerBookingsErrorMatch = input.match(new RegExp(`^Failed to load ${providerKind} bookings$`, 'i'))
  if (providerBookingsErrorMatch) return `تعذر تحميل حجوزات مزودي ${translatePortalText(providerBookingsErrorMatch[1])}`

  const providerAnalyticsErrorMatch = input.match(new RegExp(`^Failed to load ${providerKind} analytics$`, 'i'))
  if (providerAnalyticsErrorMatch) return `تعذر تحميل تحليلات مزودي ${translatePortalText(providerAnalyticsErrorMatch[1])}`

  const providerReviewsErrorMatch = input.match(new RegExp(`^Could not load ${providerKind} reviews$`, 'i'))
  if (providerReviewsErrorMatch) return `تعذر تحميل مراجعات مزودي ${translatePortalText(providerReviewsErrorMatch[1])}`

  const providerCommissionErrorMatch = input.match(new RegExp(`^Failed to load ${providerKind} commission revenue$`, 'i'))
  if (providerCommissionErrorMatch) return `تعذر تحميل إيرادات العمولات لمزودي ${translatePortalText(providerCommissionErrorMatch[1])}`

  const providerPackagesErrorMatch = input.match(new RegExp(`^Failed to load ${providerKind} package revenue$`, 'i'))
  if (providerPackagesErrorMatch) return `تعذر تحميل إيرادات الباقات لمزودي ${translatePortalText(providerPackagesErrorMatch[1])}`

  const workerSubtitleMatch = input.match(/^Review, verify, and approve staff access requests submitted by (.+)\.$/i)
  if (workerSubtitleMatch) return `راجع طلبات وصول الموظفين المقدمة من ${translatePortalText(workerSubtitleMatch[1])}.`

  const workerSearchMatch = input.match(new RegExp(`^Search ${providerKind} workers, email or business…$`, 'i'))
  if (workerSearchMatch) return `ابحث عن موظفي ${translatePortalText(workerSearchMatch[1])} بالاسم أو البريد الإلكتروني أو النشاط التجاري…`

  const workerPendingEmptyMatch = input.match(new RegExp(`^There are no pending ${providerKind} worker approvals\\.$`, 'i'))
  if (workerPendingEmptyMatch) return `لا توجد طلبات معلقة لاعتماد موظفي ${translatePortalText(workerPendingEmptyMatch[1])}.`

  const approvalCriticalRequirementsMatch = input.match(new RegExp(`^Cannot approve: (${localizedInteger}) critical requirements are missing\\.$`, 'i'))
  if (approvalCriticalRequirementsMatch) return `تعذر الاعتماد: لا تزال ${formatPortalNumber(parsePortalInteger(approvalCriticalRequirementsMatch[1]))} من المتطلبات الحرجة ناقصة.`

  const workerStatusEmptyMatch = input.match(/^No workers registered under (pending|approved|rejected|all) status\.$/i)
  if (workerStatusEmptyMatch) return `لا يوجد موظفون مسجلون بحالة ${translatePortalText(workerStatusEmptyMatch[1])}.`

  const providerBookingsSubtitleMatch = input.match(new RegExp(`^Every ${providerKind} payment — sourced live from the Payment ledger$`, 'i'))
  if (providerBookingsSubtitleMatch) return `جميع مدفوعات ${translatePortalText(providerBookingsSubtitleMatch[1])} — من سجل المدفوعات المباشر`

  const providerPerformanceSubtitleMatch = input.match(new RegExp(`^Revenue, bookings & health across all ${providerKind} providers — sourced live from Payments$`, 'i'))
  if (providerPerformanceSubtitleMatch) return `الإيرادات والحجوزات والأداء لجميع مزودي ${translatePortalText(providerPerformanceSubtitleMatch[1])} — من بيانات المدفوعات المباشرة`

  const providerRevenueTrendMatch = input.match(new RegExp(`^${providerKind} vertical — gross vs commission, trailing 12 months$`, 'i'))
  if (providerRevenueTrendMatch) return `${translatePortalText(providerRevenueTrendMatch[1])} — إجمالي الإيرادات مقابل العمولات خلال آخر ١٢ شهرًا`

  const providerReviewsSubtitleMatch = input.match(new RegExp(`^Ratings & moderation for ${providerKind} providers$`, 'i'))
  if (providerReviewsSubtitleMatch) return `تقييمات ومراجعة مزودي ${translatePortalText(providerReviewsSubtitleMatch[1])}`

  const providerReviewEmptyMatch = input.match(new RegExp(`^No ${providerKind} reviews match this filter\\.$`, 'i'))
  if (providerReviewEmptyMatch) return `لا توجد مراجعات لمزودي ${translatePortalText(providerReviewEmptyMatch[1])} تطابق عامل التصفية هذا.`

  const providerKycEmptyMatch = input.match(new RegExp(`^No ${providerKind} providers in the verification queue\\.$`, 'i'))
  if (providerKycEmptyMatch) return `لا يوجد مزودو ${translatePortalText(providerKycEmptyMatch[1])} في قائمة التحقق.`

  const providerKycSubtitleMatch = input.match(new RegExp(`^AI-powered document review for ${providerKind} providers$`, 'i'))
  if (providerKycSubtitleMatch) return `مراجعة المستندات بالذكاء الاصطناعي لمزودي ${translatePortalText(providerKycSubtitleMatch[1])}`

  const providerCommissionSubtitleMatch = input.match(new RegExp(`^Track total platform commission earned per transaction from ${providerKind} providers$`, 'i'))
  if (providerCommissionSubtitleMatch) return `تابع إجمالي عمولات المنصة المكتسبة من كل معاملة لمزودي ${translatePortalText(providerCommissionSubtitleMatch[1])}`

  const providerPackageSubtitleMatch = input.match(new RegExp(`^Track recurring subscription package revenue from ${providerKind} providers$`, 'i'))
  if (providerPackageSubtitleMatch) return `تابع إيرادات باقات الاشتراك المتكررة لمزودي ${translatePortalText(providerPackageSubtitleMatch[1])}`

  const workerApprovedMatch = input.match(/^(.+) approved successfully$/i)
  if (workerApprovedMatch) return `تم اعتماد ${workerApprovedMatch[1]} بنجاح`
  const personRejectedMatch = input.match(/^(.+) rejected$/i)
  if (personRejectedMatch) return `تم رفض ${personRejectedMatch[1]}`
  const personSuspendedMatch = input.match(/^(.+) suspended$/i)
  if (personSuspendedMatch) return `تم إيقاف ${personSuspendedMatch[1]}`
  const personReactivatedMatch = input.match(/^(.+) reactivated$/i)
  if (personReactivatedMatch) return `تمت إعادة تفعيل ${personReactivatedMatch[1]}`

  const exportedCountMatch = input.match(new RegExp(`^Exported (${localizedInteger}) (reviews?|bookings?|providers?|users?|subscriptions?)$`, 'i'))
  if (exportedCountMatch) {
    const count = parsePortalInteger(exportedCountMatch[1])
    const amount = formatPortalNumber(count)
    const noun = exportedCountMatch[2].toLowerCase().replace(/s$/, '')
    const arabicNoun = noun === 'review' ? (count === 1 ? 'مراجعة' : count === 2 ? 'مراجعتين' : count >= 3 && count <= 10 ? 'مراجعات' : 'مراجعة')
      : noun === 'booking' ? (count === 1 ? 'حجز' : count === 2 ? 'حجزين' : count >= 3 && count <= 10 ? 'حجوزات' : 'حجزًا')
      : noun === 'provider' ? (count === 1 ? 'مزود' : count === 2 ? 'مزودين' : count >= 3 && count <= 10 ? 'مزودين' : 'مزودًا')
      : noun === 'user' ? (count === 1 ? 'مستخدم' : count === 2 ? 'مستخدمين' : count >= 3 && count <= 10 ? 'مستخدمين' : 'مستخدمًا')
      : (count === 1 ? 'اشتراك' : count === 2 ? 'اشتراكين' : count >= 3 && count <= 10 ? 'اشتراكات' : 'اشتراكًا')
    return `تم تصدير ${amount} ${arabicNoun}`
  }

  const sentCustomerCountMatch = input.match(new RegExp(`^Sent to (${localizedInteger}) customers?$`, 'i'))
  if (sentCustomerCountMatch) return `تم الإرسال إلى ${formatPortalNumber(parsePortalInteger(sentCustomerCountMatch[1]))} من العملاء`

  const broadcastRecipientCountMatch = input.match(new RegExp(`^Broadcast queued for (${localizedInteger}) recipients?$`, 'i'))
  if (broadcastRecipientCountMatch) return `تمت جدولة الرسالة الجماعية لإرسالها إلى ${formatPortalNumber(parsePortalInteger(broadcastRecipientCountMatch[1]))} من المستلمين`

  const subscriptionExtendedMatch = input.match(new RegExp(`^Subscription extended by (${localizedInteger}) month\\(s\\)$`, 'i'))
  if (subscriptionExtendedMatch) return `تم تمديد الاشتراك ${arabicMonthCount(parsePortalInteger(subscriptionExtendedMatch[1]))}`

  const addOnApprovedMatch = input.match(/^✨ Request approved for ([\d٠-٩.,٬٫]+) SAR\/mo\. Provider notified to pay!$/i)
  if (addOnApprovedMatch) return `✨ تمت الموافقة على الطلب بسعر ${addOnApprovedMatch[1]} ريال سعودي شهريًا. تم إشعار المزود بالدفع!`

  const reviewStatusMatch = input.match(/^Review set to (.+)$/i)
  if (reviewStatusMatch) return `تم تغيير حالة المراجعة إلى ${translatePortalText(reviewStatusMatch[1])}`

  const recordedRiskScoreMatch = input.match(new RegExp(`^Recorded — score is now (${localizedInteger})$`, 'i'))
  if (recordedRiskScoreMatch) return `تم التسجيل — الدرجة الآن ${formatPortalNumber(parsePortalInteger(recordedRiskScoreMatch[1]))}`

  const riskSweepMatch = input.match(new RegExp(`^Swept (${localizedInteger}) provider\\(s\\), raised (${localizedInteger}) signal\\(s\\)$`, 'i'))
  if (riskSweepMatch) return `تم فحص ${formatPortalNumber(parsePortalInteger(riskSweepMatch[1]))} من المزودين ورصد ${formatPortalNumber(parsePortalInteger(riskSweepMatch[2]))} من الإشارات`

  const scanCompleteMatch = input.match(new RegExp(`^Scan complete — (${localizedInteger}) new alert\\(s\\), (${localizedInteger}) updated$`, 'i'))
  if (scanCompleteMatch) return `اكتمل الفحص — تنبيهات جديدة: ${formatPortalNumber(parsePortalInteger(scanCompleteMatch[1]))}، تم تحديث ${formatPortalNumber(parsePortalInteger(scanCompleteMatch[2]))}`

  const signInRoleMatch = input.match(/^Sign in to (.+)$/i)
  if (signInRoleMatch) return `تسجيل الدخول إلى ${translatePortalText(signInRoleMatch[1])}`

  const createRoleAccountMatch = input.match(/^Create your (.+) account$/i)
  if (createRoleAccountMatch) return `إنشاء حساب ${translatePortalText(createRoleAccountMatch[1])}`

  const signInAsRoleMatch = input.match(/^Sign in as (.+)$/i)
  if (signInAsRoleMatch) return `تسجيل الدخول بصفة ${translatePortalText(signInAsRoleMatch[1])}`

  const createRoleMatch = input.match(/^Create (.+) account$/i)
  if (createRoleMatch) return `إنشاء حساب ${translatePortalText(createRoleMatch[1])}`

  const accountCreatedWelcomeMatch = input.match(/^Welcome to BoatPro, (.+) — account created 🎉$/i)
  if (accountCreatedWelcomeMatch) {
    const accountName = accountCreatedWelcomeMatch[1] === 'new provider'
      ? 'مزود جديد'
      : accountCreatedWelcomeMatch[1]
    return `مرحبًا بك في BoatPro، ${accountName} — تم إنشاء الحساب 🎉`
  }

  const onboardingDocumentUploadedMatch = input.match(/^(.+) uploaded — checking it now$/i)
  if (onboardingDocumentUploadedMatch) {
    return `تم رفع ${translatePortalText(onboardingDocumentUploadedMatch[1])} — جارٍ التحقق منه الآن`
  }

  const paymentReceivedMatch = input.match(/^(.+) — payment received\.$/i)
  if (paymentReceivedMatch) {
    return `${translatePortalText(paymentReceivedMatch[1])} — ${translatePortalText('Payment received')}.`
  }

  const fuelLowTankNotice = input.match(/^(.+) are below the reorder point — raise a purchase order\.$/i)
  if (fuelLowTankNotice) {
    return `الخزانات التالية دون حد إعادة الطلب: ${fuelLowTankNotice[1]}. يرجى إنشاء أمر شراء.`
  }

  // The fuel portal ticker is assembled by the API from live station data.
  // Translate only its fixed labels and keep station, vehicle and tank names
  // intact as provider-entered content.
  const fuelTickerDeliveryAlongside = input.match(/^🛳️ (.+) alongside — fuelling$/i)
  if (fuelTickerDeliveryAlongside) return `🛳️ ${fuelTickerDeliveryAlongside[1]} راسية بمحاذاة الرصيف — جارٍ التزوّد بالوقود`

  const fuelTickerDeliveryEnRoute = input.match(/^🛳️ (.+) en route$/i)
  if (fuelTickerDeliveryEnRoute) return `🛳️ ${fuelTickerDeliveryEnRoute[1]} في الطريق`

  const fuelTickerTank = input.match(/^📉 (.+) below reorder point — (.+) \/ (.+)$/i)
  if (fuelTickerTank) {
    const formatStock = (value: string) => {
      const amount = Number(value.replace(/,/g, ''))
      return Number.isFinite(amount) ? formatPortalNumber(amount, { maximumFractionDigits: 2 }) : value
    }
    return `📉 ${fuelTickerTank[1]} دون حد إعادة الطلب — ${formatStock(fuelTickerTank[2])} / ${formatStock(fuelTickerTank[3])}`
  }

  const fuelTickerEmergency = input.match(/^🚨 (\d+) emergency requests? pending$/i)
  if (fuelTickerEmergency) {
    const count = parsePortalInteger(fuelTickerEmergency[1])
    const amount = formatPortalNumber(count)
    const label = count === 1
      ? 'طلب طارئ واحد قيد الانتظار'
      : count === 2
        ? 'طلبان طارئان قيد الانتظار'
        : count >= 3 && count <= 10
          ? `${amount} طلبات طارئة قيد الانتظار`
          : `${amount} طلبًا طارئًا قيد الانتظار`
    return `🚨 ${label}`
  }

  const fuelTickerCalibration = input.match(/^🔧 (.+) calibration overdue — dispensing locked$/i)
  if (fuelTickerCalibration) return `🔧 ${fuelTickerCalibration[1]} — انتهت صلاحية معايرة المضخة، وتم إيقاف الصرف`

  const fuelTickerTakings = input.match(/^💵 ([A-Z]{3}) ([\d,]+(?:\.\d+)?) collected today$/i)
  if (fuelTickerTakings) {
    const total = Number(fuelTickerTakings[2].replace(/,/g, ''))
    const amount = Number.isFinite(total) ? formatPortalCurrency(total, fuelTickerTakings[1]) : `${fuelTickerTakings[1]} ${fuelTickerTakings[2]}`
    return `💵 تم تحصيل ${amount} اليوم`
  }

  const fuelTankSummary = input.match(/^([\d٠-٩,٬٫.]+) of ([\d٠-٩,٬٫.]+) stored · (\d+) tanks? monitored live$/i)
  if (fuelTankSummary) {
    const count = Number(fuelTankSummary[3])
    const tankLabel = count === 1 ? 'خزان واحد مراقب مباشرة' : count === 2 ? 'خزانان مراقبان مباشرة' : `${formatPortalNumber(count)} خزانات مراقبة مباشرة`
    return `المخزون ${fuelTankSummary[1]} من السعة ${fuelTankSummary[2]} · ${tankLabel}`
  }

  const fuelStationApprovalMatch = input.match(/^Station "(.+)" is (?:currently )?awaiting platform admin approval\.(?: Adding tanks is locked\.| Tank installations will be enabled once approved\.)$/i)
  if (fuelStationApprovalMatch) {
    return `محطة ${fuelStationApprovalMatch[1]} بانتظار اعتماد إدارة المنصة. ستُتاح إضافة الخزانات بعد الاعتماد.`
  }

  const fuelTankNotFoundMatch = input.match(/^No tanks found for (.+) — click "\+ Add fuel tank" to install one here\.$/i)
  if (fuelTankNotFoundMatch) {
    return `لم يتم العثور على خزانات في ${fuelTankNotFoundMatch[1]}. اختر «إضافة خزان وقود» لتركيب خزان هنا.`
  }

  const fuelTrackingLinksMatch = input.match(/^Tracking links sent to (\d+) active customers?$/i)
  if (fuelTrackingLinksMatch) {
    return `تم إرسال روابط التتبع إلى ${formatPortalNumber(Number(fuelTrackingLinksMatch[1]))} من العملاء النشطين.`
  }

  const fuelBookingsOnDateMatch = input.match(/^(\d+) bookings? on (.+)$/i)
  if (fuelBookingsOnDateMatch) {
    return `عدد الحجوزات: ${formatPortalNumber(Number(fuelBookingsOnDateMatch[1]))} · ${fuelBookingsOnDateMatch[2]}`
  }

  const fuelPriceUpdateMatch = input.match(/^Price list published — (\d+) products? updated$/i)
  if (fuelPriceUpdateMatch) {
    return `تم نشر قائمة الأسعار وتحديث ${formatPortalNumber(Number(fuelPriceUpdateMatch[1]))} من المنتجات.`
  }

  const fuelPurchaseOrdersMatch = input.match(/^(\d+) purchase orders? sent$/i)
  if (fuelPurchaseOrdersMatch) {
    return `تم إرسال ${formatPortalNumber(Number(fuelPurchaseOrdersMatch[1]))} من أوامر الشراء.`
  }

  const fuelRefillOrderedMatch = input.match(/^(.+) refill ordered for (.+)$/i)
  if (fuelRefillOrderedMatch) {
    return `تم طلب إعادة تعبئة ${fuelRefillOrderedMatch[1]} للخزان ${fuelRefillOrderedMatch[2]}.`
  }

  const fuelStockCapacityMatch = input.match(/^Current stock \((.+)\) cannot exceed tank capacity \((.+)\)$/i)
  if (fuelStockCapacityMatch) {
    return `لا يمكن أن يتجاوز المخزون الحالي (${fuelStockCapacityMatch[1]}) سعة الخزان (${fuelStockCapacityMatch[2]}).`
  }

  const fuelRefillCapacityMatch = input.match(/^Refill quantity \((.+)\) cannot exceed remaining tank capacity \((.+)\)$/i)
  if (fuelRefillCapacityMatch) {
    return `لا يمكن أن تتجاوز كمية إعادة التعبئة (${fuelRefillCapacityMatch[1]}) السعة المتبقية للخزان (${fuelRefillCapacityMatch[2]}).`
  }

  const fuelIncompleteProfileMatch = input.match(/^Station profile is incomplete \((\d+)%\)\. Please complete all required items before submitting for review\.$/i)
  if (fuelIncompleteProfileMatch) {
    return `ملف المحطة غير مكتمل (${formatPortalNumber(Number(fuelIncompleteProfileMatch[1]))}٪). أكمل جميع المتطلبات قبل إرسال الملف للمراجعة.`
  }

  const fuelToggleMatch = input.match(/^(.+?) (enabled|disabled|on|off)$/i)
  if (fuelToggleMatch) {
    const subject = translatePortalText(fuelToggleMatch[1])
    const state = fuelToggleMatch[2].toLowerCase()
    return `${state === 'enabled' || state === 'on' ? 'تم تفعيل' : 'تم إيقاف'} ${subject}`
  }

  const formErrorCountMatch = input.match(/^(\d+) fields need attention$/i)
  if (formErrorCountMatch) return `${formatPortalNumber(Number(formErrorCountMatch[1]))} حقول تحتاج إلى مراجعة`

  const activeMaintenanceJobsMatch = input.match(/^(\d+) active jobs?$/i)
  if (activeMaintenanceJobsMatch) return `الأعمال النشطة: ${formatPortalNumber(Number(activeMaintenanceJobsMatch[1]))}`

  const maintenanceEmergencyCountMatch = input.match(/^(\d+) emergencies?$/i)
  if (maintenanceEmergencyCountMatch) return `حالات الطوارئ: ${formatPortalNumber(Number(maintenanceEmergencyCountMatch[1]))}`

  const maintenancePendingCountMatch = input.match(/^(\d+) pending$/i)
  if (maintenancePendingCountMatch) return `طلبات معلقة: ${formatPortalNumber(Number(maintenancePendingCountMatch[1]))}`

  const openEmergencyJobsMatch = input.match(/^(\d+) open emergency jobs?$/i)
  if (openEmergencyJobsMatch) return `أعمال طوارئ مفتوحة: ${formatPortalNumber(Number(openEmergencyJobsMatch[1]))}`

  const unreadMaintenanceNotificationsMatch = input.match(/^(\d+) unread notifications?$/i)
  if (unreadMaintenanceNotificationsMatch) return `إشعارات غير مقروءة: ${formatPortalNumber(Number(unreadMaintenanceNotificationsMatch[1]))}`

  const maintenanceReadinessMatch = input.match(/^Workshop Profile Incomplete \((\d+)% Ready\)$/i)
  if (maintenanceReadinessMatch) return `ملف الورشة غير مكتمل (${formatPortalNumber(Number(maintenanceReadinessMatch[1]))}٪)`

  const maintenanceCriticalItemsMatch = input.match(/^(\d+) Critical Items? Missing$/i)
  if (maintenanceCriticalItemsMatch) return `متطلبات حرجة ناقصة: ${formatPortalNumber(Number(maintenanceCriticalItemsMatch[1]))}`

  const maintenanceChecklistCountMatch = input.match(/^Checklist \((\d+)\)$/i)
  if (maintenanceChecklistCountMatch) return `قائمة التحقق (${formatPortalNumber(Number(maintenanceChecklistCountMatch[1]))})`

  const maintenanceSaveCategoriesMatch = input.match(/^Save (\d+) Categories$/i)
  if (maintenanceSaveCategoriesMatch) {
    return `حفظ الفئات (${formatPortalNumber(Number(maintenanceSaveCategoriesMatch[1]))})`
  }

  const maintenanceActiveCapabilitiesMatch = input.match(/^(\d+) active service capabilities$/i)
  if (maintenanceActiveCapabilitiesMatch) {
    return `قدرات الخدمات النشطة: ${formatPortalNumber(Number(maintenanceActiveCapabilitiesMatch[1]))}`
  }

  const maintenancePhotoFacilitiesMatch = input.match(/^(\d+) photos · Official Logo & Workshop Service Facilities$/i)
  if (maintenancePhotoFacilitiesMatch) {
    return `${formatPortalNumber(Number(maintenancePhotoFacilitiesMatch[1]))} صور · الشعار الرسمي ومرافق خدمات الورشة`
  }

  const maintenanceDutyAvailabilityMatch = input.match(/^(\d+) of (\d+) on duty$/i)
  if (maintenanceDutyAvailabilityMatch) {
    return `الفنيون المناوبون: ${formatPortalNumber(Number(maintenanceDutyAvailabilityMatch[1]))} من ${formatPortalNumber(Number(maintenanceDutyAvailabilityMatch[2]))}`
  }

  const maintenanceRequirementsMatch = input.match(/^(\d+)\/(\d+) requirements$/i)
  if (maintenanceRequirementsMatch) {
    return `المتطلبات المستوفاة: ${formatPortalNumber(Number(maintenanceRequirementsMatch[1]))} من ${formatPortalNumber(Number(maintenanceRequirementsMatch[2]))}`
  }

  const approvedTechnicianCountMatch = input.match(/^of (\d+) approved$/i)
  if (approvedTechnicianCountMatch) return `من ${formatPortalNumber(Number(approvedTechnicianCountMatch[1]))} فنيين معتمدين`

  const pendingTechnicianApprovalMatch = input.match(/^(\d+) technicians? awaiting BoatPro Admin verification$/i)
  if (pendingTechnicianApprovalMatch) {
    const count = Number(pendingTechnicianApprovalMatch[1])
    const technicianCount = count === 1 ? 'فني واحد' : count === 2 ? 'فنيان' : `${formatPortalNumber(count)} فنيين`
    return `بانتظار اعتماد إدارة BoatPro لـ${technicianCount}`
  }

  const maintenanceQuoteResponseMatch = input.match(/^(.+?): (.+?) — the customer (accepted|declined) the ([\d,.]+) quote\.$/i)
  if (maintenanceQuoteResponseMatch) {
    const response = maintenanceQuoteResponseMatch[3].toLowerCase() === 'accepted'
      ? 'وافق العميل على عرض السعر'
      : 'رفض العميل عرض السعر'
    return `القارب ${maintenanceQuoteResponseMatch[1]}: ${maintenanceQuoteResponseMatch[2]} — ${response} بقيمة ${formatPortalNumber(Number(maintenanceQuoteResponseMatch[4].replace(/,/g, '')))} ريال.`
  }

  const maintenanceCancellationNoticeMatch = input.match(/^(.+?): (.+?) was cancelled by the customer(?:\. (.+))?\.$/i)
  if (maintenanceCancellationNoticeMatch) {
    const reason = maintenanceCancellationNoticeMatch[3]
      ? ` ${translatePortalText(maintenanceCancellationNoticeMatch[3])}`
      : ''
    return `ألغى العميل طلب الصيانة «${maintenanceCancellationNoticeMatch[2]}» للقارب ${maintenanceCancellationNoticeMatch[1]}.${reason}`
  }

  const maintenanceRescheduleNoticeMatch = input.match(/^(.+?): (.+?) moved(?: from (.+?))? to (.+?) at (.+)\.$/i)
  if (maintenanceRescheduleNoticeMatch) {
    const from = maintenanceRescheduleNoticeMatch[3] ? ` من ${maintenanceRescheduleNoticeMatch[3]}` : ''
    return `تم تغيير موعد صيانة «${maintenanceRescheduleNoticeMatch[2]}» للقارب ${maintenanceRescheduleNoticeMatch[1]}${from} إلى ${maintenanceRescheduleNoticeMatch[4]}، الساعة ${maintenanceRescheduleNoticeMatch[5]}.`
  }

  const maintenanceTechnicianAssignedMatch = input.match(/^(.+) is assigned to "(.+)"$/i)
  if (maintenanceTechnicianAssignedMatch) {
    return `تم إسناد ${maintenanceTechnicianAssignedMatch[1]} إلى المهمة «${maintenanceTechnicianAssignedMatch[2]}».`
  }

  const calendarEstimatedHoursMatch = input.match(/^Estimated hours per day across (.+) — darker is busier\.$/i)
  if (calendarEstimatedHoursMatch) return `ساعات العمل المقدّرة يوميًا خلال ${calendarEstimatedHoursMatch[1]} — اللون الداكن يعني انشغالًا أكبر.`

  const calendarMissingHoursMatch = input.match(/^No work orders in (.+) carry an hours estimate\.$/i)
  if (calendarMissingHoursMatch) return `لا توجد أوامر عمل في ${calendarMissingHoursMatch[1]} تتضمن تقديرًا لساعات العمل.`

  const maintenanceSearchMatch = input.match(/^Searching “(.*)”…$/i)
  if (maintenanceSearchMatch) return `جارٍ البحث عن «${maintenanceSearchMatch[1]}»…`

  const warrantyClaimOpenedMatch = input.match(/^Warranty claim opened for (.+)$/i)
  if (warrantyClaimOpenedMatch) return `تم فتح مطالبة ضمان للقارب ${warrantyClaimOpenedMatch[1]}.`

  const serviceLoggedMatch = input.match(/^Logged service for (.+)$/i)
  if (serviceLoggedMatch) return `تم تسجيل أعمال الصيانة للقارب ${serviceLoggedMatch[1]}.`

  const fleetAccountAddedMatch = input.match(/^(.+) added as a fleet account$/i)
  if (fleetAccountAddedMatch) return `تمت إضافة ${fleetAccountAddedMatch[1]} إلى حسابات الأسطول.`

  const fleetAccountNoBoatsMatch = input.match(/^(.+) has no boats on file yet$/i)
  if (fleetAccountNoBoatsMatch) return `لا توجد قوارب مسجلة لـ${fleetAccountNoBoatsMatch[1]} بعد.`

  const fleetServiceScheduledMatch = input.match(/^(.+) scheduled for (.+) \((\d+) boats?\)$/i)
  if (fleetServiceScheduledMatch) return `تمت جدولة ${fleetServiceScheduledMatch[1]} لـ${fleetServiceScheduledMatch[2]} (${formatPortalNumber(Number(fleetServiceScheduledMatch[3]))} قوارب).`

  const etaDispatchUpdatedMatch = input.match(/^ETA dispatch updated for (.+)$/i)
  if (etaDispatchUpdatedMatch) return `تم تحديث موعد الوصول المتوقع لـ${etaDispatchUpdatedMatch[1]}.`

  const photoUploadCompleteMatch = input.match(/^(\d+) photos? uploaded$/i)
  if (photoUploadCompleteMatch) return `تم رفع ${formatPortalNumber(Number(photoUploadCompleteMatch[1]))} صورة.`

  const invoiceStatusUpdatedMatch = input.match(/^Invoice (.+) marked as (.+)$/i)
  if (invoiceStatusUpdatedMatch) return `تم تحديث حالة الفاتورة ${invoiceStatusUpdatedMatch[1]} إلى ${translatePortalText(invoiceStatusUpdatedMatch[2])}.`

  const invoiceReminderSentMatch = input.match(/^Reminder sent to (.+)$/i)
  if (invoiceReminderSentMatch) return `تم إرسال التذكير إلى ${invoiceReminderSentMatch[1]}.`

  const invoiceMarkedPaidMatch = input.match(/^(.+) marked paid — (.+)$/i)
  if (invoiceMarkedPaidMatch) return `تم تسجيل الفاتورة ${invoiceMarkedPaidMatch[1]} كمدفوعة — ${invoiceMarkedPaidMatch[2]}.`

  const workOrderReassignedMatch = input.match(/^(.+) reassigned to (.+)$/i)
  if (workOrderReassignedMatch) return `تمت إعادة إسناد أمر العمل ${workOrderReassignedMatch[1]} إلى ${workOrderReassignedMatch[2]}.`

  const workOrderAssignedMatch = input.match(/^(.+) assigned to (.+)$/i)
  if (workOrderAssignedMatch) return `تم إسناد أمر العمل ${workOrderAssignedMatch[1]} إلى ${workOrderAssignedMatch[2]}.`

  const workOrderStatusChangedMatch = input.match(/^(.+) moved to (.+)$/i)
  if (workOrderStatusChangedMatch) return `تم تغيير حالة أمر العمل ${workOrderStatusChangedMatch[1]} إلى ${translatePortalText(workOrderStatusChangedMatch[2])}.`

  const inspectionSavedMatch = input.match(/^(.+) inspection saved — score (\d+)$/i)
  if (inspectionSavedMatch) return `تم حفظ فحص ${inspectionSavedMatch[1]} — النتيجة ${formatPortalNumber(Number(inspectionSavedMatch[2]))}.`

  const technicianInvitedMatch = input.match(/^Invited (.+)$/i)
  if (technicianInvitedMatch) return `تمت دعوة ${technicianInvitedMatch[1]}.`

  const technicianShiftUpdatedMatch = input.match(/^(.+) shift updated to (.+)$/i)
  if (technicianShiftUpdatedMatch) return `تم تحديث وردية ${technicianShiftUpdatedMatch[1]} إلى ${translatePortalText(technicianShiftUpdatedMatch[2])}.`

  const tradeAddedMatch = input.match(/^Added role "(.+)"$/i)
  if (tradeAddedMatch) return `تمت إضافة التخصص «${tradeAddedMatch[1]}».`

  const technicianAddedPendingMatch = input.match(/^Technician (.+) added — awaiting admin approval$/i)
  if (technicianAddedPendingMatch) return `تمت إضافة الفني ${technicianAddedPendingMatch[1]} — بانتظار اعتماد المسؤول.`

  const namedUpdatedMatch = input.match(/^"(.+)" updated$/i)
  if (namedUpdatedMatch) return `تم تحديث ${namedUpdatedMatch[1]}.`

  const plainNamedUpdatedMatch = input.match(/^(.+) updated$/i)
  if (plainNamedUpdatedMatch) return `تم تحديث ${plainNamedUpdatedMatch[1]}.`

  const namedAddedMatch = input.match(/^"?(.+?)"? added$/i)
  if (namedAddedMatch) return `تمت إضافة ${namedAddedMatch[1]}.`

  const namedRemovedMatch = input.match(/^(.+) removed$/i)
  if (namedRemovedMatch) return `تمت إزالة ${namedRemovedMatch[1]}.`

  const namedAddedToMenuMatch = input.match(/^(.+) added to your service menu$/i)
  if (namedAddedToMenuMatch) return `تمت إضافة ${namedAddedToMenuMatch[1]} إلى قائمة خدماتك.`

  const marinaServiceAddedMatch = input.match(/^(.+) added to your service list$/i)
  if (marinaServiceAddedMatch) return `تمت إضافة ${marinaServiceAddedMatch[1]} إلى قائمة خدماتك.`

  const partAddedMatch = input.match(/^Part (.+) added to inventory$/i)
  if (partAddedMatch) return `تمت إضافة القطعة ${partAddedMatch[1]} إلى المخزون.`

  const stockUpdatedMatch = input.match(/^Stock updated: (.+) is now (\d+)$/i)
  if (stockUpdatedMatch) return `تم تحديث المخزون: أصبح رصيد ${stockUpdatedMatch[1]} ${formatPortalNumber(Number(stockUpdatedMatch[2]))}.`

  const highlightedFieldsMatch = input.match(/^Please fix the (\d+) highlighted fields\.$/i)
  if (highlightedFieldsMatch) return `يرجى تصحيح الحقول المحددة (${formatPortalNumber(Number(highlightedFieldsMatch[1]))}).`

  const dockDeleteMatch = input.match(/^Delete Dock (.+) and all its berths$/i)
  if (dockDeleteMatch) return `حذف الرصيف ${dockDeleteMatch[1]} وجميع مواقف الرسو التابعة له`

  const photoCountMatch = input.match(/^(\d+) photo\(s\)$/i)
  if (photoCountMatch) return `عدد الصور: ${formatPortalNumber(Number(photoCountMatch[1]))}`

  const revenueMonthMatch = input.match(/^Revenue · (.+)$/i)
  if (revenueMonthMatch) return `الإيرادات · ${revenueMonthMatch[1]}`

  const photoGalleryMatch = input.match(/^(\d+) photos? · Official Logo & Gallery$/i)
  if (photoGalleryMatch) return `عدد الصور: ${formatPortalNumber(Number(photoGalleryMatch[1]))} · الشعار الرسمي ومعرض الصور`

  const noCategoryPhotosMatch = input.match(/^No (.+) photos yet$/i)
  if (noCategoryPhotosMatch) {
    return `لا توجد صور لفئة ${translatePortalText(noCategoryPhotosMatch[1])} بعد`
  }

  const workingDaysMatch = input.match(/^Working Days \((\d+) active\)$/i)
  if (workingDaysMatch) {
    return `أيام العمل النشطة: ${formatPortalNumber(Number(workingDaysMatch[1]))}`
  }

  const facilityDetailPromptMatch = input.match(/^Add detail — (.+)$/i)
  if (facilityDetailPromptMatch) {
    return `أضف تفاصيل: ${translatePortalText(facilityDetailPromptMatch[1])}`
  }

  const meterReadingCountMatch = input.match(/^(\d+) reading\(s\)$/i)
  if (meterReadingCountMatch) {
    return `قراءات العداد: ${formatPortalNumber(Number(meterReadingCountMatch[1]))}`
  }

  const invoicedReadingsMatch = input.match(/^Invoiced (\d+) readings? - (.+)$/i)
  if (invoicedReadingsMatch) {
    return `تمت فوترة ${formatPortalNumber(Number(invoicedReadingsMatch[1]))} قراءة عداد — ${invoicedReadingsMatch[2]}`
  }

  const berthPlanEditMatch = input.match(/^✏️ Edit Berth (.+)$/i)
  if (berthPlanEditMatch) return `✏️ تعديل الرصيف ${berthPlanEditMatch[1]}`

  const editNamedItemMatch = input.match(/^✏️ Edit (.+)$/i)
  if (editNamedItemMatch) return `✏️ تعديل ${editNamedItemMatch[1]}`

  const berthSummaryMatch = input.match(/^([\d٠-٩۰-۹,٬]+) slips across ([\d٠-٩۰-۹,٬]+) docks? · pricing, specs, connections & availability$/i)
  if (berthSummaryMatch) {
    return `مواقف الرسو: ${formatPortalNumber(parsePortalInteger(berthSummaryMatch[1]))} · الأرصفة: ${formatPortalNumber(parsePortalInteger(berthSummaryMatch[2]))} · الأسعار والمواصفات والتجهيزات والتوافر`
  }

  const reservationEmptyQueryMatch = input.match(/^Nothing matches “(.+)”\.$/i)
  if (reservationEmptyQueryMatch) return `لا توجد نتائج تطابق «${reservationEmptyQueryMatch[1]}»`

  const berthApprovedMatch = input.match(/^(.+) approved for (.+) — awaiting payment$/i)
  if (berthApprovedMatch) return `تم اعتماد الرصيف ${berthApprovedMatch[1]} للقارب ${berthApprovedMatch[2]} — بانتظار الدفع`

  const berthMovedMatch = input.match(/^(.+) moved to (.+)$/i)
  if (berthMovedMatch) return `تم نقل ${berthMovedMatch[1]} إلى الرصيف ${berthMovedMatch[2]}`

  const berthPaymentRecordedMatch = input.match(/^Payment recorded — (.+) is berthed$/i)
  if (berthPaymentRecordedMatch) return `تم تسجيل الدفعة — رسا القارب ${berthPaymentRecordedMatch[1]}`

  const stayCompletedMatch = input.match(/^(.+)'s stay completed$/i)
  if (stayCompletedMatch) return `اكتملت إقامة ${stayCompletedMatch[1]}`

  // A reservation number is one token ("MB-2026-0001 declined"). Matching any
  // text before the verb turned whole sentences ("Booking X was already
  // cancelled", "Nadia Marine declined") into "booking … declined".
  const reservationDeclinedMatch = input.match(/^(\S+) declined$/i)
  if (reservationDeclinedMatch) return `تم رفض الحجز ${reservationDeclinedMatch[1]}`

  const reservationCancelledMatch = input.match(/^(\S+) cancelled$/i)
  if (reservationCancelledMatch) return `تم إلغاء الحجز ${reservationCancelledMatch[1]}`

  const walkInBookingCreatedMatch = input.match(/^Booking (.+) created — awaiting payment$/i)
  if (walkInBookingCreatedMatch) return `تم إنشاء الحجز ${walkInBookingCreatedMatch[1]} — بانتظار الدفع`

  const berthDeletedMatch = input.match(/^Berth (.+) deleted successfully$/i)
  if (berthDeletedMatch) return `تم حذف الرصيف ${berthDeletedMatch[1]} بنجاح`

  const dockDeletedMatch = input.match(/^Dock (.+) deleted successfully$/i)
  if (dockDeletedMatch) return `تم حذف الرصيف العائم ${dockDeletedMatch[1]} بنجاح`

  const dockPlanDeletedMatch = input.match(/^Plan “(.+)” deleted successfully$/i)
  if (dockPlanDeletedMatch) return `تم حذف الخطة «${dockPlanDeletedMatch[1]}» بنجاح`

  const marinaDocumentDeletedMatch = input.match(/^"([\s\S]*)" deleted successfully$/i)
  if (marinaDocumentDeletedMatch) return `تم حذف «${marinaDocumentDeletedMatch[1]}» بنجاح`

  const marinaIncidentDeletedMatch = input.match(/^Incident ([A-Z0-9-]+) deleted successfully$/i)
  if (marinaIncidentDeletedMatch) return `تم حذف البلاغ ${marinaIncidentDeletedMatch[1]} بنجاح`

  const deleteMarinaDocumentConfirmMatch = input.match(/^Delete "([\s\S]*)"\?$/i)
  if (deleteMarinaDocumentConfirmMatch) return `هل تريد حذف «${deleteMarinaDocumentConfirmMatch[1]}»؟`

  const deleteMarinaIncidentConfirmMatch = input.match(/^Delete incident ([A-Z0-9-]+)\?$/i)
  if (deleteMarinaIncidentConfirmMatch) return `هل تريد حذف البلاغ ${deleteMarinaIncidentConfirmMatch[1]}؟`

  const deleteMarinaWorkOrderConfirmMatch = input.match(/^Delete work order (.+)\?$/i)
  if (deleteMarinaWorkOrderConfirmMatch) return `هل تريد حذف أمر العمل ${deleteMarinaWorkOrderConfirmMatch[1]}؟`

  const deleteDockConfirmMatch = input.match(/^Delete Dock (.+)\?$/i)
  if (deleteDockConfirmMatch) return `هل تريد حذف الرصيف ${deleteDockConfirmMatch[1]}؟`

  const deleteDockPlanConfirmMatch = input.match(/^Delete plan “([\s\S]*)”\?$/i)
  if (deleteDockPlanConfirmMatch) return `هل تريد حذف الخطة «${deleteDockPlanConfirmMatch[1]}»؟`

  const invoiceUnbilledUtilitiesConfirmMatch = input.match(/^Invoice all unbilled utilities for (.+)\?$/i)
  if (invoiceUnbilledUtilitiesConfirmMatch) {
    return `إصدار فاتورة بجميع رسوم المرافق غير المفوترة للقارب ${invoiceUnbilledUtilitiesConfirmMatch[1]}؟`
  }

  const marinaWorkOrderDeletedMatch = input.match(/^Work order (.+) deleted successfully$/i)
  if (marinaWorkOrderDeletedMatch) return `تم حذف أمر العمل ${marinaWorkOrderDeletedMatch[1]} بنجاح`

  const berthDeleteConfirmMatch = input.match(/^Delete berth (.+)\?$/i)
  if (berthDeleteConfirmMatch) return `هل تريد حذف الرصيف ${berthDeleteConfirmMatch[1]}؟`

  const bulkBerthDeleteConfirmMatch = input.match(/^Delete ([\d٠-٩۰-۹,٬]+) berths?\?$/i)
  if (bulkBerthDeleteConfirmMatch) return `هل تريد حذف ${arabicBerthCount(parsePortalInteger(bulkBerthDeleteConfirmMatch[1]))}؟`

  const bulkBerthDeletingMatch = input.match(/^Deleting ([\d٠-٩۰-۹,٬]+)…$/i)
  if (bulkBerthDeletingMatch) return `جارٍ حذف ${arabicBerthCount(parsePortalInteger(bulkBerthDeletingMatch[1]))}…`

  const dockBerthDeleteConfirmMatch = input.match(/^This will also delete all ([\d٠-٩۰-۹,٬]+) berths? inside it\. This cannot be undone\.$/i)
  if (dockBerthDeleteConfirmMatch) {
    return `سيؤدي ذلك أيضًا إلى حذف ${arabicBerthObjectCount(parsePortalInteger(dockBerthDeleteConfirmMatch[1]))} ضمن الرصيف. لا يمكن التراجع عن هذا الإجراء.`
  }

  const berthCountMatch = input.match(/^([\d٠-٩۰-۹,٬]+) berths?$/i)
  if (berthCountMatch) return arabicBerthCount(parsePortalInteger(berthCountMatch[1]))

  const completedBulkDeleteMatch = input.match(/^(\d+) berths? deleted successfully$/i)
  if (completedBulkDeleteMatch) return `تم حذف ${arabicBerthObjectCount(parsePortalInteger(completedBulkDeleteMatch[1]))} بنجاح`

  const partialBulkDeleteMatch = input.match(/^(\d+) of (\d+) deleted · (\d+) failed$/i)
  if (partialBulkDeleteMatch) {
    return `تم حذف ${formatPortalNumber(Number(partialBulkDeleteMatch[1]))} من أصل ${formatPortalNumber(Number(partialBulkDeleteMatch[2]))} · تعذر حذف ${formatPortalNumber(Number(partialBulkDeleteMatch[3]))}`
  }

  const movementArrivalNoticeMatch = input.match(/^(.+) arriving (.+) → berth (.+)\. Please attend\.$/i)
  if (movementArrivalNoticeMatch) return `القارب ${movementArrivalNoticeMatch[1]} قادم ${movementArrivalNoticeMatch[2]} إلى الرصيف ${movementArrivalNoticeMatch[3]}. يرجى الحضور.`

  const movementDocsVerifiedMatch = input.match(/^(.+)'s documents verified$/i)
  if (movementDocsVerifiedMatch) return `تم التحقق من مستندات ${movementDocsVerifiedMatch[1]}`

  const checkedInMovementMatch = input.match(/^(.+) checked in at (.+) ⚓ — moved to departures board$/i)
  if (checkedInMovementMatch) return `سُجّل وصول ${checkedInMovementMatch[1]} في ${checkedInMovementMatch[2]} ⚓ — ونُقل إلى لوحة المغادرة`

  const dockStaffPagedMatch = input.match(/^Dock staff paged for (.+) → (.+)$/i)
  if (dockStaffPagedMatch) return `تم إشعار طاقم الرصيف بوصول ${dockStaffPagedMatch[1]} إلى ${dockStaffPagedMatch[2]}`

  const invoiceEmailedGuestMatch = input.match(/^Invoice emailed to (.+)$/i)
  if (invoiceEmailedGuestMatch) return `تم إرسال الفاتورة بالبريد الإلكتروني إلى ${invoiceEmailedGuestMatch[1]}`

  const payoutPaidOnMatch = input.match(/^Paid on (.+)$/i)
  if (payoutPaidOnMatch) return `تم الدفع في ${payoutPaidOnMatch[1]}`

  const movementScheduledMatch = input.match(/^(Arrival|Departure) scheduled$/i)
  if (movementScheduledMatch) return `تمت جدولة ${movementScheduledMatch[1].toLowerCase() === 'arrival' ? 'الوصول' : 'المغادرة'}`

  const checkoutContractDateMatch = input.match(/^contract to (.+)$/i)
  if (checkoutContractDateMatch) return `ينتهي العقد في ${checkoutContractDateMatch[1]}`

  const homeHarborMatch = input.match(/^(.+) — home harbor$/i)
  if (homeHarborMatch) return `${homeHarborMatch[1]} — المرسى الرئيسي`

  const hailedVesselMatch = input.match(/^📻 Hailed (.+) on VHF (.+)$/i)
  if (hailedVesselMatch) return `📻 تم نداء ${hailedVesselMatch[1]} عبر قناة VHF ${hailedVesselMatch[2]}`

  const fleetRosterCountMatch = input.match(/^Fleet roster \((\d+)\)$/i)
  if (fleetRosterCountMatch) return `قائمة القوارب (${formatPortalNumber(Number(fleetRosterCountMatch[1]))})`

  const dockCrewNotifiedCountMatch = input.match(/^Dock crew notified \((\d+)\)$/i)
  if (dockCrewNotifiedCountMatch) return `تم إشعار طاقم الرصيف (${formatPortalNumber(Number(dockCrewNotifiedCountMatch[1]))})`

  const crewMemberCountMatch = input.match(/^(\d+) on the crew$/i)
  if (crewMemberCountMatch) return `${formatPortalNumber(Number(crewMemberCountMatch[1]))} من أفراد الطاقم`

  const nauticalDistanceMatch = input.match(/^([\d.]+) nm$/i)
  if (nauticalDistanceMatch) return `${formatPortalNumber(Number(nauticalDistanceMatch[1]))} ميل بحري`

  const secondsAgoMatch = input.match(/^(\d+)s ago$/i)
  if (secondsAgoMatch) return `منذ ${formatPortalNumber(Number(secondsAgoMatch[1]))} ث`

  const supportConversationOpenedMatch = input.match(/^Conversation opened — (.+)$/i)
  if (supportConversationOpenedMatch) return `تم فتح المحادثة — ${supportConversationOpenedMatch[1]}`

  const openReportTitleMatch = input.match(/^Open the (.+) report$/i)
  if (openReportTitleMatch) return `فتح تقرير ${translatePortalText(openReportTitleMatch[1])}`

  const scopedReportDescriptionMatch = input.match(/^About (.+) — only their (.+) data\.$/i)
  if (scopedReportDescriptionMatch) {
    return `بيانات ${translatePortalText(scopedReportDescriptionMatch[2])} الخاصة بـ${scopedReportDescriptionMatch[1]} فقط.`
  }

  const movementDistanceOnlyMatch = input.match(/^([\d.]+) nm out$/i)
  if (movementDistanceOnlyMatch) return `على بُعد ${formatPortalNumber(Number(movementDistanceOnlyMatch[1]))} ميل بحري`

  const reservationTermMatch = input.match(/^([\d٠-٩۰-۹,٬]+) months?$/i)
  if (reservationTermMatch) return arabicMonthCount(parsePortalInteger(reservationTermMatch[1]))

  const contractCountMatch = input.match(/^([\d٠-٩۰-۹,٬]+) contracts?$/i)
  if (contractCountMatch) return arabicContractCount(parsePortalInteger(contractCountMatch[1]))

  const stayCountMatch = input.match(/^([\d٠-٩۰-۹,٬]+) stays?$/i)
  if (stayCountMatch) return arabicStayCount(parsePortalInteger(stayCountMatch[1]))

  const berthMonthCountMatch = input.match(/^([\d٠-٩۰-۹,٬]+) berth-months?$/i)
  if (berthMonthCountMatch) {
    const count = Math.abs(Math.trunc(parsePortalInteger(berthMonthCountMatch[1])))
    if (count === 1) return 'وحدة رصيف-شهر'
    if (count === 2) return 'وحدتا رصيف-شهر'
    if (count >= 3 && count <= 10) return `${formatPortalNumber(count)} وحدات رصيف-شهر`
    return `${formatPortalNumber(count)} وحدة رصيف-شهر`
  }

  const openWorkOrderCountMatch = input.match(/^([\d٠-٩۰-۹,٬]+) open$/i)
  if (openWorkOrderCountMatch) return `أعمال مفتوحة: ${formatPortalNumber(parsePortalInteger(openWorkOrderCountMatch[1]))}`

  const reservationPriceSummaryMatch = input.match(/^([\d٠-٩۰-۹,٬]+) months? × (.+)\/month \+ VAT$/i)
  if (reservationPriceSummaryMatch) {
    return `${arabicMonthCount(parsePortalInteger(reservationPriceSummaryMatch[1]))} × ${reservationPriceSummaryMatch[2]} شهريًا + ضريبة القيمة المضافة`
  }

  const occupancySummaryMatch = input.match(/^% of (\d+) berths occupied per day$/i)
  if (occupancySummaryMatch) return `الإشغال اليومي من الأرصفة: ${formatPortalNumber(Number(occupancySummaryMatch[1]))}`

  const occupancyHeatMatch = input.match(/^Share of (\d+) berths occupied per day — last two weeks$/i)
  if (occupancyHeatMatch) {
    return `نسبة إشغال ${formatPortalNumber(Number(occupancyHeatMatch[1]))} رصيفًا يوميًا خلال الأسبوعين الماضيين`
  }

  const occupancyDayMatch = input.match(/^(.+) · ([\d٠-٩.,٬٫]+)% occupied$/i)
  if (occupancyDayMatch) {
    const percentage = Number(occupancyDayMatch[2].replace(/,/g, ''))
    return `${occupancyDayMatch[1]} · نسبة الإشغال: ${formatPortalNumber(percentage)}٪`
  }

  const reviewRequestsMatch = input.match(/^Review (\d+) requests?$/i)
  if (reviewRequestsMatch) return `مراجعة طلبات الحجز (${formatPortalNumber(Number(reviewRequestsMatch[1]))})`

  const invoiceCountMatch = input.match(/^(\d+) invoices?$/i)
  if (invoiceCountMatch) return `عدد الفواتير: ${formatPortalNumber(Number(invoiceCountMatch[1]))}`

  const exportedInvoicesMatch = input.match(/^Exported (\d+) invoices?$/i)
  if (exportedInvoicesMatch) return `تم تصدير ${formatPortalNumber(Number(exportedInvoicesMatch[1]))} فاتورة`

  const invoiceEmailedMatch = input.match(/^(.+) emailed to the customer$/i)
  if (invoiceEmailedMatch) return `تم إرسال الفاتورة ${invoiceEmailedMatch[1]} إلى العميل`

  const leaveTypeMatch = input.match(/^On (.+) leave$/i)
  if (leaveTypeMatch) return `في إجازة ${translatePortalText(leaveTypeMatch[1])}`

  const enRouteDistanceMatch = input.match(/^En route · ([\d.]+) nm out$/i)
  if (enRouteDistanceMatch) {
    return `في الطريق، على بُعد ${formatPortalNumber(Number(enRouteDistanceMatch[1]))} ميل بحري`
  }

  const customerListSummaryMatch = input.match(/^(\d+) registered boat owners · profiles, membership, docking history & spend$/i)
  if (customerListSummaryMatch) {
    return `أصحاب القوارب المسجلون: ${formatPortalNumber(Number(customerListSummaryMatch[1]))} · الملفات والعضوية وسجل الرسو والإنفاق`
  }

  const boatRegisterSummaryMatch = input.match(/^(\d+) vessels on the register · (\d+) berthed right now$/i)
  if (boatRegisterSummaryMatch) {
    return `القوارب المسجلة: ${formatPortalNumber(Number(boatRegisterSummaryMatch[1]))} · الراسية الآن: ${formatPortalNumber(Number(boatRegisterSummaryMatch[2]))}`
  }

  const nobodyMatchesQuery = input.match(/^Nobody matches “(.+)”$/i)
  if (nobodyMatchesQuery) return `لا توجد نتائج تطابق «${nobodyMatchesQuery[1]}»`

  const boatsMatchQuery = input.match(/^No boats match “(.+)”$/i)
  if (boatsMatchQuery) return `لا توجد قوارب تطابق «${boatsMatchQuery[1]}»`

  const conversationOpenedMatch = input.match(/^Conversation with (.+) opened$/i)
  if (conversationOpenedMatch) return `تم فتح محادثة مع ${conversationOpenedMatch[1]}`

  const favoriteChangeMatch = input.match(/^(.+) (removed from favorites|added to favorites ❤️)$/i)
  if (favoriteChangeMatch) {
    const action = favoriteChangeMatch[2].toLowerCase().startsWith('removed') ? 'تمت إزالته من المفضلة' : 'تمت إضافته إلى المفضلة ❤️'
    return `${favoriteChangeMatch[1]} ${action}`
  }

  const liveReservationCountMatch = input.match(/^(\d+) live$/i)
  if (liveReservationCountMatch) return `حجوزات نشطة: ${formatPortalNumber(Number(liveReservationCountMatch[1]))}`

  const unreadOnlyCountMatch = input.match(/^Unread only · (\d+)$/i)
  if (unreadOnlyCountMatch) {
    return `غير المقروءة فقط · ${formatPortalNumber(Number(unreadOnlyCountMatch[1]))}`
  }

  const daysOverdueMatch = input.match(/^(\d+) days overdue$/i)
  if (daysOverdueMatch) return `متأخر منذ ${formatPortalNumber(Number(daysOverdueMatch[1]))} يومًا`

  const daysLeftMatch = input.match(/^(\d+) days left$/i)
  if (daysLeftMatch) return `متبقٍ ${formatPortalNumber(Number(daysLeftMatch[1]))} يوم`

  const liveBerthSummaryMatch = input.match(/^(\d+) slips by live status$/i)
  if (liveBerthSummaryMatch) return `مواقف الرسو حسب الحالة الحالية: ${formatPortalNumber(Number(liveBerthSummaryMatch[1]))}`

  const reviewCountMatch = input.match(/^(\d+) reviews?$/i)
  if (reviewCountMatch) return `عدد التقييمات: ${formatPortalNumber(Number(reviewCountMatch[1]))}`

  const eventCountMatch = input.match(/^(\d+) events?$/i)
  if (eventCountMatch) return `عدد الفعاليات: ${formatPortalNumber(Number(eventCountMatch[1]))}`

  const facilitiesSummaryMatch = input.match(/^(\d+) of (\d+) facilities currently available to guests — toggles publish instantly to the BoatPro app$/i)
  if (facilitiesSummaryMatch) {
    return `المرافق المتاحة للضيوف: ${formatPortalNumber(Number(facilitiesSummaryMatch[1]))} من ${formatPortalNumber(Number(facilitiesSummaryMatch[2]))} — تظهر التغييرات فورًا في تطبيق BoatPro.`
  }

  const movementsSummaryMatch = input.match(/^Check-in flow, security clearance, checkout & berth release — check-in from (.+), check-out by (.+)$/i)
  if (movementsSummaryMatch) {
    return `سير تسجيل الوصول والتخليص الأمني وتسجيل المغادرة وإخلاء الرصيف — يبدأ الوصول ${movementsSummaryMatch[1]}، وتكون المغادرة بحلول ${movementsSummaryMatch[2]}`
  }

  const berthDetailsTitleMatch = input.match(/^⚓ Berth (.+) Details$/i)
  if (berthDetailsTitleMatch) return `⚓ تفاصيل الرصيف ${berthDetailsTitleMatch[1]}`

  const hailVesselMatch = input.match(/^📻 Hail vessel(?: — (.+))?$/i)
  if (hailVesselMatch) return hailVesselMatch[1] ? `📻 الاتصال بالقارب ${hailVesselMatch[1]}` : '📻 الاتصال بالقارب'

  const notifyCrewMatch = input.match(/^📣 Notify dock crew(?: — berth (.+))?$/i)
  if (notifyCrewMatch) return notifyCrewMatch[1] ? `📣 إخطار طاقم الرصيف — الرصيف ${notifyCrewMatch[1]}` : '📣 إخطار طاقم الرصيف'

  const reviewRequestTitleMatch = input.match(/^Review request — (.+)$/i)
  if (reviewRequestTitleMatch) return `مراجعة طلب ${reviewRequestTitleMatch[1]}`

  const moveBerthTitleMatch = input.match(/^Move berth — (.+)$/i)
  if (moveBerthTitleMatch) return `تغيير رصيف ${moveBerthTitleMatch[1]}`

  const bookingTitleMatch = input.match(/^Booking (.+)$/i)
  if (bookingTitleMatch) return `الحجز ${bookingTitleMatch[1]}`

  const searchNoMatchesMatch = input.match(/^No matches for “([\s\S]+)”\.$/i)
  if (searchNoMatchesMatch) return `لا توجد نتائج تطابق «${searchNoMatchesMatch[1]}».`

  const openingSearchResultMatch = input.match(/^Opening (.+) “([\s\S]+)”$/i)
  if (openingSearchResultMatch) {
    return `جارٍ فتح ${translatePortalText(openingSearchResultMatch[1])} «${openingSearchResultMatch[2]}»`
  }

  const reservationTitleMatch = input.match(/^📋 Reservation (.+)$/i)
  if (reservationTitleMatch) return `📋 الحجز ${reservationTitleMatch[1]}`

  const ratingScaleMatch = input.match(/^(\d+) of (\d+)$/i)
  if (ratingScaleMatch) return `${formatPortalNumber(Number(ratingScaleMatch[1]))} من ${formatPortalNumber(Number(ratingScaleMatch[2]))}`

  const starRatingMatch = input.match(/^(\d+) out of 5$/i)
  if (starRatingMatch) return `${formatPortalNumber(Number(starRatingMatch[1]))} من ${formatPortalNumber(5)}`

  const quotaTitleMatch = input.match(/^(.+) Quota Limit Reached$/i)
  if (quotaTitleMatch) return `تم بلوغ حد الحصة المسموح به لـ${translatePortalText(quotaTitleMatch[1])}`

  const scheduledDowngradeMatch = input.match(/^Scheduled: you'll move to (.+) at the end of your current period\.$/i)
  if (scheduledDowngradeMatch) return `تمت الجدولة: ستنتقل إلى ${scheduledDowngradeMatch[1]} في نهاية الفترة الحالية.`

  const downloadFormatMatch = input.match(/^Download as (Excel|CSV|PDF|JSON)$/i)
  if (downloadFormatMatch) {
    const format = downloadFormatMatch[1].toUpperCase()
    // Excel is a product name, not an acronym. Keep its brand spelling while
    // retaining the conventional uppercase forms for file extensions.
    return `تنزيل بصيغة ${format === 'EXCEL' ? 'Excel' : format}`
  }

  const uploadProgressMatch = input.match(/^(.+) upload progress$/i)
  if (uploadProgressMatch) return `تقدم رفع الملف ${uploadProgressMatch[1]}`

  const smallCraftWarningMatch = input.match(/^Small-craft advisory — gusts to (\d+) kn$/i)
  if (smallCraftWarningMatch) {
    return `تنبيه للقوارب الصغيرة — هبّات رياح تصل إلى ${formatPortalNumber(Number(smallCraftWarningMatch[1]))} عقدة`
  }

  const roughSeasWarningMatch = input.match(/^Rough seas — ([\d.]+) m waves$/i)
  if (roughSeasWarningMatch) {
    return `أمواج هائجة بارتفاع ${formatPortalNumber(Number(roughSeasWarningMatch[1]))} م`
  }

  if (/^Please fix the highlighted field\.$/i.test(input)) return 'يرجى تصحيح الحقل المحدد.'

  const numericChartTitleMatch = input.match(/^(.+): ([\d٠-٩.,٬٫-]+)$/)
  if (numericChartTitleMatch) return `${translatePortalText(numericChartTitleMatch[1])}: ${numericChartTitleMatch[2]}`

  const boatCountMatch = input.match(/^(\d+) boats? not earning yet$/i)
  if (boatCountMatch) {
    const count = formatPortalNumber(Number(boatCountMatch[1]))
    return `قوارب لا تحقق دخلًا بعد: ${count}`
  }

  const listedCountMatch = input.match(/^(\d+) listed$/i)
  if (listedCountMatch) return `العناصر المدرجة: ${formatPortalNumber(Number(listedCountMatch[1]))}`

  const marinaBlockersMatch = input.match(/^(\d+) Blockers$/i)
  if (marinaBlockersMatch) return `متطلبات مانعة: ${formatPortalNumber(Number(marinaBlockersMatch[1]))}`

  const marinaReadinessMatch = input.match(/^Marina Profile Incomplete \((\d+)% Ready\)$/i)
  if (marinaReadinessMatch) return `ملف المرسى غير مكتمل — الجاهزية ${formatPortalNumber(Number(marinaReadinessMatch[1]))}٪`

  const marinaScoreMatch = input.match(/^(\d+)% Complete$/i)
  if (marinaScoreMatch) return `اكتمل ${formatPortalNumber(Number(marinaScoreMatch[1]))}٪`

  const marinaInspectMatch = input.match(/^Inspect Readiness \((\d+)%\)$/i)
  if (marinaInspectMatch) return `عرض الجاهزية (${formatPortalNumber(Number(marinaInspectMatch[1]))}٪)`

  const marinaCriticalItemsMatch = input.match(/^(\d+) Critical Items? Missing$/i)
  if (marinaCriticalItemsMatch) return `المتطلبات الحرجة الناقصة: ${formatPortalNumber(Number(marinaCriticalItemsMatch[1]))}`

  const marinaChecklistMatch = input.match(/^Checklist \((\d+)\)$/i)
  if (marinaChecklistMatch) return `قائمة التحقق (${formatPortalNumber(Number(marinaChecklistMatch[1]))})`

  const marinaMoreMatch = input.match(/^\+(\d+) more$/i)
  if (marinaMoreMatch) return `+${formatPortalNumber(Number(marinaMoreMatch[1]))} أخرى`

  const marinaSubmitCountMatch = input.match(/^Please complete the (\d+) critical items before submitting for review\.$/i)
  if (marinaSubmitCountMatch) {
    return `يرجى استكمال ${formatPortalNumber(Number(marinaSubmitCountMatch[1]))} من المتطلبات الحرجة قبل إرسال الطلب للمراجعة.`
  }

  const aiFindingCountMatch = input.match(/^Flagged for manual verification — (\d+) findings?$/i)
  if (aiFindingCountMatch) {
    return `يتطلب تحققًا يدويًا — ${formatPortalNumber(Number(aiFindingCountMatch[1]))} ملاحظات`
  }

  const aiExpiryDateMatch = input.match(/^The expiry date reads (\d{4}-\d{2}-\d{2}), which has passed\.$/i)
  if (aiExpiryDateMatch) {
    const date = formatPortalDate(new Date(`${aiExpiryDateMatch[1]}T00:00:00`), { year: 'numeric', month: 'long', day: 'numeric' })
    return `انتهت صلاحية المستند في ${date}.`
  }

  const aiCrossCheckMatch = input.match(/^the document says "([\s\S]*)", our records say "([\s\S]*)"\.$/i)
  if (aiCrossCheckMatch) return `يذكر المستند «${aiCrossCheckMatch[1]}»، بينما تُظهر سجلاتنا «${aiCrossCheckMatch[2]}».`

  const aiMissingFieldsMatch = input.match(/^(.+) — required for this document type\.$/i)
  if (aiMissingFieldsMatch) {
    const fields = aiMissingFieldsMatch[1].replace(/,\s*/g, '، ')
    return `${fields} — مطلوبة لهذا النوع من المستندات.`
  }

  const aiLegibilityMatch = input.match(/^Only (\d+)% of the page could be read confidently\.$/i)
  if (aiLegibilityMatch) {
    return `تعذّرت قراءة الصفحة بثقة إلا بنسبة ${formatPortalNumber(Number(aiLegibilityMatch[1]))}٪.`
  }

  const aiDisagreementMatch = input.match(/^(.+) disagrees:$/i)
  if (aiDisagreementMatch) return `يوجد تعارض في ${aiDisagreementMatch[1]}:`

  const marinaCustomersSummaryMatch = input.match(/^(\d+) registered boat owners · profiles, membership, docking history & spend$/i)
  if (marinaCustomersSummaryMatch) {
    return `ملاك القوارب المسجلون: ${formatPortalNumber(Number(marinaCustomersSummaryMatch[1]))} · الملفات والعضوية وسجل الإرساء والإنفاق`
  }

  const marinaFleetSummaryMatch = input.match(/^(\d+) vessels on the register · (\d+) berthed right now$/i)
  if (marinaFleetSummaryMatch) {
    return `القوارب المسجلة: ${formatPortalNumber(Number(marinaFleetSummaryMatch[1]))} · الراسية حاليًا: ${formatPortalNumber(Number(marinaFleetSummaryMatch[2]))}`
  }

  const marinaCustomerSearchMatch = input.match(/^Nobody matches “([\s\S]*)”$/i)
  if (marinaCustomerSearchMatch) return `لا توجد نتائج تطابق «${marinaCustomerSearchMatch[1]}»`

  const marinaBoatSearchMatch = input.match(/^No boats match “([\s\S]*)”$/i)
  if (marinaBoatSearchMatch) return `لا توجد قوارب تطابق «${marinaBoatSearchMatch[1]}»`

  const marinaReservationSearchMatch = input.match(/^Nothing matches “([\s\S]*)”\.$/i)
  if (marinaReservationSearchMatch) return `لا توجد نتائج تطابق «${marinaReservationSearchMatch[1]}»`

  const marinaSubmitErrorMatch = input.match(/^Cannot submit marina for admin review\. There are (\d+) critical details missing\.$/i)
  if (marinaSubmitErrorMatch) {
    return `تعذر إرسال المرسى لمراجعة الإدارة. لا يزال هناك ${formatPortalNumber(Number(marinaSubmitErrorMatch[1]))} من البيانات الحرجة الناقصة.`
  }

  const marinaPublishErrorMatch = input.match(/^Cannot publish marina\. Required details are missing \((\d+) critical items\)\.$/i)
  if (marinaPublishErrorMatch) {
    return `تعذر نشر المرسى. توجد بيانات مطلوبة ناقصة (${formatPortalNumber(Number(marinaPublishErrorMatch[1]))} متطلبات حرجة).`
  }

  const fleetCountMatch = input.match(/^(\d+) in the fleet$/i)
  if (fleetCountMatch) return `في الأسطول: ${formatPortalNumber(Number(fleetCountMatch[1]))}`

  const boatsNotEarningMatch = input.match(/^(\d+) boats? not earning yet$/i)
  if (boatsNotEarningMatch) return `قوارب لم تحقق إيرادات بعد: ${formatPortalNumber(Number(boatsNotEarningMatch[1]))}`

  const boatProfileIncompleteMatch = input.match(/^Profile Incomplete \((\d+)% Ready\)$/i)
  if (boatProfileIncompleteMatch) {
    return `الملف غير مكتمل (${formatPortalNumber(Number(boatProfileIncompleteMatch[1]))}٪ من الجاهزية)`
  }

  const crewHeaderMatch = input.match(/^(\d+) crew on record\s*·\s*manage personnel, duty shifts, certifications, and onboard permissions$/i)
  if (crewHeaderMatch) {
    return `أفراد الطاقم المسجلون: ${formatPortalNumber(Number(crewHeaderMatch[1]))} · إدارة الموظفين والورديات والشهادات والصلاحيات على متن القارب`
  }

  const boatTripCountMatch = input.match(/^(\d+)\/(\d+) trip\(s\) on sale$/i)
  if (boatTripCountMatch) {
    return `الرحلات المتاحة للحجز: ${formatPortalNumber(Number(boatTripCountMatch[1]))}/${formatPortalNumber(Number(boatTripCountMatch[2]))}`
  }

  const sailingCountMatch = input.match(/^(\d+)\s+sailing\(s\) are on sale\.$/i)
  if (sailingCountMatch) return `مواعيد الإبحار المتاحة للحجز: ${formatPortalNumber(Number(sailingCountMatch[1]))}.`

  const unscheduledCountMatch = input.match(/^(\d+) could not be scheduled:$/i)
  if (unscheduledCountMatch) return `تعذرت جدولة ${formatPortalNumber(Number(unscheduledCountMatch[1]))} من المواعيد:`

  const addedBoatMatch = input.match(/^(.*?) added to your fleet — now create a trip on it$/i)
  if (addedBoatMatch) return `تمت إضافة ${addedBoatMatch[1]} إلى أسطولك — أنشئ رحلة عليه الآن`

  const boatCreatedTripMatch = input.match(/^(.*?) created$/i)
  if (boatCreatedTripMatch && !/^crew member /i.test(input)) return `تم إنشاء ${boatCreatedTripMatch[1]}`

  const certifiedPassengersMatch = input.match(/^(.*?) is certified for (\d+) passengers$/i)
  if (certifiedPassengersMatch) return `${certifiedPassengersMatch[1]} معتمد لاستيعاب ${formatPortalNumber(Number(certifiedPassengersMatch[2]))} ركاب`

  const crewStatusMatch = input.match(/^Crew member (.*?) (activated|disabled)$/i)
  if (crewStatusMatch) return crewStatusMatch[2].toLowerCase() === 'activated'
    ? `تم تفعيل فرد الطاقم ${crewStatusMatch[1]}`
    : `تم تعطيل فرد الطاقم ${crewStatusMatch[1]}`

  const inviteResentMatch = input.match(/^Invite resent to (.+)$/i)
  if (inviteResentMatch) return `تمت إعادة إرسال الدعوة إلى ${inviteResentMatch[1]}`

  const inviteWithdrawnMatch = input.match(/^Invite for (.+) withdrawn$/i)
  if (inviteWithdrawnMatch) return `تم سحب دعوة ${inviteWithdrawnMatch[1]}`

  const inviteCreatedMatch = input.match(/^Crew member (.+) invited successfully!$/i)
  if (inviteCreatedMatch) return `تمت دعوة فرد الطاقم ${inviteCreatedMatch[1]} بنجاح!`

  const crewUpdatedMatch = input.match(/^Crew details for (.+) updated!$/i)
  if (crewUpdatedMatch) return `تم تحديث بيانات فرد الطاقم ${crewUpdatedMatch[1]}!`

  const removeConfirmMatch = input.match(/^Remove (.+)\?$/i)
  if (removeConfirmMatch) return `إزالة ${removeConfirmMatch[1]}؟`

  const cancelReservationMatch = input.match(/^Cancel (.+)\?$/i)
  if (cancelReservationMatch) return `إلغاء الحجز ${cancelReservationMatch[1]}؟`

  const tripCascadeMatch = input.match(/^Its (\d+) (trip|trips) will be removed too\. This cannot be undone\.$/i)
  if (tripCascadeMatch) return `ستتم إزالة ${formatPortalNumber(Number(tripCascadeMatch[1]))} من الرحلات المرتبطة أيضًا. لا يمكن التراجع عن هذا الإجراء.`

  const featuredCapacityExplanationMatch = input.match(/^(\d+) taken right now(?:, (\d+) waiting in the queue)?\. Lowering this below (\d+) does not stop anything already paid for — it just means nothing new is approved until enough runs end\.$/i)
  if (featuredCapacityExplanationMatch) {
    const waiting = featuredCapacityExplanationMatch[2]
    return `المواضع المستخدمة الآن: ${formatPortalNumber(Number(featuredCapacityExplanationMatch[1]))}${waiting ? `، والطلبات المنتظرة: ${formatPortalNumber(Number(waiting))}` : ''}. خفض السعة عن ${formatPortalNumber(Number(featuredCapacityExplanationMatch[3]))} لا يلغي المواضع المدفوعة مسبقًا، لكنه يوقف الموافقات الجديدة حتى تتوفر سعة.`
  }

  const photoAddedMatch = input.match(/^Added (\d+) (.+?) photo\(s\)$/i)
  if (photoAddedMatch) return `تمت إضافة ${formatPortalNumber(Number(photoAddedMatch[1]))} صورة إلى فئة «${translatePortalText(photoAddedMatch[2])}»`

  // Handle common dynamic patterns for notification messages and system phrases:
  const appliedMatch = input.match(/^(.*?)\s+applied as a\s+(boat|marina|fuel|maintenance)\s+provider\s*—\s*awaiting approval\.?$/i)
  if (appliedMatch) {
    const roleName = appliedMatch[2].toLowerCase()
    const roleAr: Record<string, string> = {
      boat: 'كمزود قوارب',
      marina: 'كمشغل مرسى',
      fuel: 'كمحطة وقود',
      maintenance: 'كمزود صيانة',
    }
    return `${appliedMatch[1]} تقدم بطلب ${roleAr[roleName] || 'كمزود خدمة'} — بانتظار الاعتماد`
  }

  const diverMatch = input.match(/^(.*?)\s+applied as a scuba diver\s*—\s*diving trips only, no documents required\.?$/i)
  if (diverMatch) {
    return `${diverMatch[1]} تقدم بطلب كغواص سكوبا — رحلات غوص فقط، لا مستندات مطلوبة.`
  }

  const issueMatch = input.match(/^(.*?):\s*Booking issue$/i)
  if (issueMatch) {
    return `${issueMatch[1]}: مشكلة في الحجز`
  }

  const inquiryMatch = input.match(/^(.*?):\s*General inquiry$/i)
  if (inquiryMatch) {
    return `${inquiryMatch[1]}: استفسار عام`
  }

  const refundMatch = input.match(/^(.*?):\s*Refund request$/i)
  if (refundMatch) {
    return `${refundMatch[1]}: طلب استرداد`
  }

  const warningDocMatch = input.match(/^(.*?)\s+can submit their application without uploading any document\.?$/i)
  if (warningDocMatch) {
    const subject = translatePortalText(warningDocMatch[1])
    return `${subject} يمكنهم تقديم طلباتهم دون رفع أي مستندات.`
  }

  const payoutCalendarMatch = input.match(/^Settles the week of (.*?) – (.*?)\. Transfers are sent manually and marked paid with the bank's receipt\.$/)
  if (payoutCalendarMatch) {
    return `تُسوّى مستحقات الأسبوع من ${payoutCalendarMatch[1]} إلى ${payoutCalendarMatch[2]}. تُرسل التحويلات يدويًا، ويُسجل كل تحويل كمدفوع بعد استلام إيصال البنك.`
  }

  const renewalCalendarMatch = input.match(/^(.*)'s (.*?) lapses on this date\. Once it does they stop receiving bookings until it is renewed\.$/)
  if (renewalCalendarMatch) {
    return `تنتهي باقة ${renewalCalendarMatch[2]} الخاصة بـ${renewalCalendarMatch[1]} في هذا التاريخ. تتوقف الحجوزات الجديدة حتى تجديدها.`
  }

  const documentCalendarMatch = input.match(/^(.*)'s (.*?) expires\. An expired document blocks the compliance checks that let them keep trading, so a replacement should be requested before this date\.$/)
  if (documentCalendarMatch) {
    return `تنتهي صلاحية ${translatePortalText(documentCalendarMatch[2])} الخاصة بـ${documentCalendarMatch[1]} في هذا التاريخ. يعيق انتهاء المستند فحوص الامتثال اللازمة لمواصلة العمل، لذا يُرجى طلب بديل قبل هذا التاريخ.`
  }

  return input
}

/** Translate known phrases inside fixed UI copy, including icon-prefixed labels. */
export function translatePortalStaticText(input: string): string {
  if (!isPortalArabic() || !input) return input
  return translatePortalText(input)
}

/** Translate a complete message template and safely isolate inserted values. */
export function translatePortalTemplate(
  input: string,
  values: Record<string, string | number>,
): string {
  if (!input) return input
  const template = isPortalArabic() ? NORMALIZED_MESSAGES.get(normalizeKey(input)) ?? input : input
  return interpolatePortalTemplate(template, values)
}

/** Select a database field's Arabic counterpart when the provider supplied it. */
export function localizedField<T = string>(record: any, field: string, fallback?: T): T | string | undefined {
  if (!record || typeof record !== 'object') return fallback
  const arabicField = field.endsWith('Ar')
    ? field
    : field.endsWith('En')
      ? `${field.slice(0, -2)}Ar`
      : `${field}Ar`
  const localized = record[arabicField]
  if (isPortalArabic() && typeof localized === 'string' && localized.trim()) {
    return localized
  }
  if (isPortalArabic() && Array.isArray(localized) && localized.length > 0 && localized.every((item) => typeof item === 'string')) {
    return localized as T
  }
  const value = record[field]
  return value === null || value === undefined || value === '' ? fallback : value
}

/**
 * Which language a piece of user-written text is in, by the script most of its
 * letters use; `null` for text with no letters or an even split. The same rule
 * the server uses to decide what to translate.
 */
export function detectTextLanguage(text: string | null | undefined): PortalLanguage | null {
  if (!text) return null
  const arabic = text.match(/(?=\p{L})\p{Script=Arabic}/gu)?.length ?? 0
  const latin = text.match(/(?=\p{L})\p{Script=Latin}/gu)?.length ?? 0
  if (arabic === latin) return null
  return arabic > latin ? 'ar' : 'en'
}

/**
 * The author's own text when editing a record localized by the API.
 *
 * The API translates content into the reader's language both ways now, and
 * attaches what was actually written as `<field>Original` (Arabic or English).
 * `<field>En` is the older companion, present only when the source was English.
 */
export function canonicalField<T = string>(record: any, field: string, fallback?: T): T | string | undefined {
  if (!record || typeof record !== 'object') return fallback
  const original = record[`${field.replace(/(En|Original)$/, '')}Original`]
  if (original !== null && original !== undefined && original !== '') return original
  const englishField = field.endsWith('En') ? field : `${field}En`
  const source = record[englishField]
  if (source !== null && source !== undefined && source !== '') return source
  const value = record[field]
  return value === null || value === undefined || value === '' ? fallback : value
}

/** Translate stable status/role/type keys while leaving names and identifiers untouched. */
export function localizedEnum(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  const raw = String(value)
  if (!isPortalArabic()) return raw.replace(/[_-]+/g, ' ')
  const words = raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  return translatePortalText(words)
}

export function formatPortalNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat(portalLocale(), options).format(value)
  } catch {
    return String(value)
  }
}

export function formatPortalPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${formatPortalNumber(value, { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits })}${isPortalArabic() ? '٪' : '%'}`
}

export function formatPortalDate(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'short', day: 'numeric',
}): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(portalLocale(), { calendar: 'gregory', ...options }).format(date)
}

export function formatPortalTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(portalLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

/** Format a time-only value such as the marina's "08:30" check-in setting. */
export function formatPortalClock(value: string | null | undefined): string {
  if (!value) return '—'
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return value

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return value

  const formatter = new Intl.NumberFormat(portalLocale(), {
    useGrouping: false,
    minimumIntegerDigits: 2,
    maximumFractionDigits: 0,
  })
  return `${formatter.format(hour)}:${formatter.format(minute)}`
}

export function formatPortalCurrency(value: number | null | undefined, currency = 'SAR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const code = currency.toUpperCase()
  const digits = code === 'SAR' ? 0 : 2
  try {
    return new Intl.NumberFormat(portalLocale(), {
      style: 'currency', currency: code, currencyDisplay: 'symbol',
      minimumFractionDigits: value % 1 ? 2 : digits,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${formatPortalNumber(value, { maximumFractionDigits: 2 })} ${code}`
  }
}
