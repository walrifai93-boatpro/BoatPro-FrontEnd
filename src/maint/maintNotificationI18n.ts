import type { ApiNotification } from '../api'
import { isPortalArabic, localizedEnum, localizedField, translatePortalTemplate, translatePortalText } from '../i18n/runtime'

type NotificationCopy = Pick<ApiNotification, 'type' | 'title' | 'body'> & { titleAr?: string; bodyAr?: string }

const NOTIFICATION_TYPE_AR: Record<string, string> = {
  booking_request: 'طلب حجز', booking_approved: 'تمت الموافقة على الحجز', booking_rejected: 'تم رفض الحجز',
  booking_confirmed: 'تم تأكيد الحجز', booking_cancelled: 'تم إلغاء الحجز', booking_completed: 'اكتمل الحجز',
  berth_arrival: 'الوصول إلى المرساة', berth_departure: 'المغادرة من المرساة',
  work_order_assigned: 'تم إسناد أمر العمل', utility_billed: 'فاتورة الخدمات', incident_reported: 'تم الإبلاغ عن حادث',
  fuel_arriving: 'وصول الوقود', fuel_request: 'طلب وقود', trip_starting: 'بدء الرحلة', trip_finished: 'انتهاء الرحلة',
  payment_success: 'نجاح الدفع', payment_refund: 'استرداد الدفعة', documents_expiring: 'مستندات قاربت على الانتهاء',
  document_approved: 'تمت الموافقة على المستند', document_rejected: 'تم رفض المستند', review_received: 'تم استلام تقييم',
  review_moderated: 'تمت مراجعة التقييم', emergency_sos: 'نداء استغاثة', staff_assigned: 'تم إسناد الموظف',
  booking_modified: 'تم تعديل الحجز', booking_arrived: 'تم تسجيل الوصول للحجز', booking_no_show: 'تعذر حضور الحجز',
  provider_signup: 'تسجيل مزود خدمة جديد', worker_approval: 'اعتماد العامل', document_submitted: 'تم إرسال المستند',
  fraud_alert: 'تنبيه احتيال', support_ticket: 'تذكرة دعم', message: 'رسالة', booking_reminder: 'تذكير بالحجز',
  document_action_required: 'يلزم اتخاذ إجراء بشأن المستند', general: 'عام',
}

const SERVICE_CATEGORIES = new Set([
  'Engine & Propulsion', 'Inboard Engines', 'Outboard Engines', 'Inboard & Outboard Engines', 'Marine Electronics & Radar',
  'Hull & Gelcoat Refit', 'Electrical & Lithium Systems', 'Rigging & Sail Maintenance',
  'Hydraulics & Steering Systems', 'Marine HVAC & Climate Control', 'Underwater Antifouling & Zincs',
  'Propeller & Drive Alignment', 'Plumbing, Heads & Watermakers', 'Diagnostic Survey & Inspection',
  'Paint & Varnish', 'Cleaning & Detailing', 'Electrical & Electronics', 'Hull & Anodes', 'Rigging & Sails',
])

function textField(notification: NotificationCopy, field: 'title' | 'body'): string {
  const value = localizedField<string>(notification, field)
  return typeof value === 'string' ? value : notification[field] ?? ''
}

function translateKnownTitle(title: string): string | undefined {
  const normalized = title.replace(/[\u2066-\u2069]/g, '').trim()
  const leading = normalized.match(/^\s*[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u)?.[0] ?? ''
  const phrase = normalized.slice(leading.length)
  const direct: Record<string, string> = {
    'Upcoming Job Tomorrow': 'مهمة مجدولة غدًا', 'Job in 12 Hours': 'مهمة بعد ١٢ ساعة',
    'Job in 2 Hours': 'مهمة بعد ساعتين', 'Job Starts in 1 Hour': 'تبدأ المهمة خلال ساعة واحدة',
    'Service Scheduled Now': 'موعد الخدمة الآن', 'New review': 'تقييم جديد', 'Payout sent': 'تم إرسال التحويل',
    'New maintenance request': 'طلب صيانة جديد', 'Maintenance job rescheduled': 'تم تغيير موعد مهمة الصيانة',
    'Worker approved': 'تم اعتماد العامل', 'Worker access approved': 'تم اعتماد وصول العامل',
    'Your provider account is approved': 'تم اعتماد حساب مزود الخدمة الخاص بك',
  }
  for (const [english, arabic] of Object.entries(direct)) {
    if (phrase.toLowerCase() === english.toLowerCase()) return `${leading}${arabic}`
  }

  const paymentTitle = phrase.match(/^Payment Received\s*[—–-]\s*(.+)$/i)
  if (paymentTitle) return `${leading}تم استلام الدفعة — ${paymentTitle[1]}`

  // Repair legacy Arabic translations that were partially generated from a
  // title template. The identifier is fixed interface copy; only the name is
  // carried through when a title actually contains one.
  if (/^تم اعتماد\s+Worker$/i.test(phrase)) return 'تم اعتماد العامل'
  if (/^تم اعتماد\s+Your provider account is$/i.test(phrase)) return 'تم اعتماد حساب مزود الخدمة الخاص بك'
  if (/^تم اعتماد\s+Worker access$/i.test(phrase)) return 'تم اعتماد وصول العامل'
  const mixedReminder = phrase.match(/^Job in 12\s*(?:Hours|ساعة)$/i)
  if (mixedReminder) return `${leading}مهمة بعد ١٢ ساعة`
  const mixedTwoHour = phrase.match(/^Job in 2\s*(?:Hours|ساعة)$/i)
  if (mixedTwoHour) return `${leading}مهمة بعد ساعتين`

  return undefined
}

function categoryList(value: string): string {
  const parts = value.split(/\s*,\s*/)
  if (!parts.length || parts.some(part => !SERVICE_CATEGORIES.has(part))) return value
  return parts.map(part => translatePortalText(part)).join('، ')
}

function normalizeMaintenanceRequestBody(body: string): string {
  const match = body.match(/^([^:]+):\s*(.+)$/s)
  if (!match) return body
  const translatedCategories = categoryList(match[2])
  return translatedCategories === match[2] ? body : `${match[1]}: ${translatedCategories}`
}

function numericValue(raw: string): number | string {
  const numeric = Number(raw.replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : raw
}

function translateKnownBody(body: string, type: string): string | undefined {
  if (type.trim().toLowerCase().replace(/[\s-]+/g, '_') === 'booking_request') {
    const categories = normalizeMaintenanceRequestBody(body)
    if (categories !== body) return categories
  }

  const request = body.match(/^طلب صيانة جديد\s*[—–-]\s*(.+)$/)
  if (request) return `طلب صيانة جديد — ${normalizeMaintenanceRequestBody(request[1])}`

  const tomorrow = body.match(/^Scheduled job(?: for "([\s\S]+?)")? \((.+)\) is set for tomorrow at (.+)\.$/i)
  if (tomorrow) {
    const job = categoryList(tomorrow[2])
    return translatePortalTemplate(
      tomorrow[1]
        ? 'Scheduled job for "{{boat}}" ({{job}}) is set for tomorrow at {{time}}.'
        : 'Scheduled job ({{job}}) is set for tomorrow at {{time}}.',
      { ...(tomorrow[1] ? { boat: tomorrow[1] } : {}), job, time: tomorrow[3] },
    )
  }

  const twelveHours = body.match(/^Upcoming job(?: for "([\s\S]+?)")? \((.+)\) begins in 12 hours \((.+)\)\.$/i)
  if (twelveHours) {
    return translatePortalTemplate(
      twelveHours[1]
        ? 'Upcoming job for "{{boat}}" ({{job}}) begins in 12 hours ({{time}}).'
        : 'Upcoming job ({{job}}) begins in 12 hours ({{time}}).',
      { ...(twelveHours[1] ? { boat: twelveHours[1] } : {}), job: twelveHours[2], time: twelveHours[3] },
    )
  }

  const twoHours = body.match(/^Scheduled maintenance(?: for "([\s\S]+?)")? starts in 2 hours \((.+)\)\.$/i)
  if (twoHours) {
    return translatePortalTemplate(
      twoHours[1]
        ? 'Scheduled maintenance for "{{boat}}" starts in 2 hours ({{time}}).'
        : 'Scheduled maintenance starts in 2 hours ({{time}}).',
      { ...(twoHours[1] ? { boat: twoHours[1] } : {}), time: twoHours[2] },
    )
  }

  const oneHour = body.match(/^Prepare for dispatch: "([\s\S]+?)"(?: for "([\s\S]+?)")? starts in 1 hour\.$/i)
  if (oneHour) {
    return translatePortalTemplate(
      oneHour[2]
        ? 'Prepare for dispatch: "{{job}}" for "{{boat}}" starts in 1 hour.'
        : 'Prepare for dispatch: "{{job}}" starts in 1 hour.',
      { job: oneHour[1], ...(oneHour[2] ? { boat: oneHour[2] } : {}) },
    )
  }

  const startsNow = body.match(/^Maintenance job(?: for "([\s\S]+?)")? \((.+)\) is scheduled to start now\.$/i)
  if (startsNow) {
    return translatePortalTemplate(
      startsNow[1]
        ? 'Maintenance job for "{{boat}}" ({{job}}) is scheduled to start now.'
        : 'Maintenance job ({{job}}) is scheduled to start now.',
      { ...(startsNow[1] ? { boat: startsNow[1] } : {}), job: startsNow[2] },
    )
  }

  const review = body.match(/^([\s\S]+?) left a (\d+)★ review(?:: "([\s\S]*)")?$/)
  if (review) {
    return translatePortalTemplate(
      review[3] === undefined
        ? '{{name}} left a {{rating}}★ review'
        : '{{name}} left a {{rating}}★ review: "{{comment}}"',
      { name: review[1], rating: Number(review[2]), ...(review[3] === undefined ? {} : { comment: review[3] }) },
    )
  }

  const payment = body.match(/^The boat owner paid SAR ([\d,.]+)( via HyperPay)? for Work Order ([A-Za-z0-9-]+)\. Vessel delivery is now authorized\.$/i)
  if (payment) {
    return translatePortalTemplate(
      payment[2]
        ? 'The boat owner paid SAR {{amount}} via HyperPay for Work Order {{code}}. Vessel delivery is now authorized.'
        : 'The boat owner paid SAR {{amount}} for Work Order {{code}}. Vessel delivery is now authorized.',
      { amount: numericValue(payment[1]), code: payment[3] },
    )
  }

  const payout = body.match(/^Your payout of ([\d,.]+) ([A-Z]{3}) for (.+?) to (.+?) is on its way to your bank account\.(?: ([\d,.]+) ([A-Z]{3}) of card-processing fees on refunded bookings was deducted\.)? The bank transfer receipt is attached to the payout in your app\.$/i)
  if (payout) {
    const hasDeduction = payout[5] !== undefined
    return translatePortalTemplate(
      hasDeduction
        ? 'Your payout of {{amount}} {{currency}} for {{start}} to {{end}} is on its way to your bank account. {{deduction}} {{currency}} of card-processing fees on refunded bookings was deducted. The bank transfer receipt is attached to the payout in your app.'
        : 'Your payout of {{amount}} {{currency}} for {{start}} to {{end}} is on its way to your bank account. The bank transfer receipt is attached to the payout in your app.',
      {
        amount: numericValue(payout[1]), currency: payout[2], start: payout[3], end: payout[4],
        ...(hasDeduction ? { deduction: numericValue(payout[5]) } : {}),
      },
    )
  }

  const workerApproval = body.match(/^(.+?) was approved and may now use the portal\.$/i)
  if (workerApproval) return translatePortalTemplate('{{name}} was approved and may now use the portal.', { name: workerApproval[1] })
  const accountWelcome = body.match(/^Welcome aboard, (.+?)\. Your account is approved — you can now list and take bookings\.$/i)
  if (accountWelcome) return translatePortalTemplate('Welcome aboard, {{name}}. Your account is approved — you can now list and take bookings.', { name: accountWelcome[1] })
  if (body === 'Welcome aboard. Your account is approved — you can now list and take bookings.') {
    return translatePortalTemplate('Welcome aboard. Your account is approved — you can now list and take bookings.', {})
  }
  if (body === 'An admin approved your worker account. You can now use the provider portal.') {
    return translatePortalTemplate('An admin approved your worker account. You can now use the provider portal.', {})
  }

  return undefined
}

export function localizedMaintenanceNotificationType(type: string): string {
  const key = type.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!isPortalArabic()) return key.replace(/_/g, ' ')
  return NOTIFICATION_TYPE_AR[key] ?? localizedEnum(key)
}

/** Translate known notification templates without translating provider-authored data. */
export function localizeMaintenanceNotification(notification: NotificationCopy): { type: string; title: string; body: string } {
  const rawTitle = textField(notification, 'title')
  const rawBody = textField(notification, 'body')
  if (!isPortalArabic()) {
    return { type: localizedMaintenanceNotificationType(notification.type), title: notification.title, body: notification.body }
  }

  const translatedTitle = translateKnownTitle(rawTitle) ?? rawTitle
  const translatedBody = translateKnownBody(rawBody, notification.type) ?? rawBody
  return {
    type: localizedMaintenanceNotificationType(notification.type),
    title: translatedTitle,
    body: translatedBody,
  }
}
