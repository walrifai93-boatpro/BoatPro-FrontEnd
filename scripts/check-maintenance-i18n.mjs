import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Cover the complete user-facing portal: Marina, Fuel, Maintenance, Admin,
// Boat, shared layout/components, and dialogs.
const sourceRoots = [path.join(root, 'src')]

// These are product/provider names or established technical identifiers. All
// other Latin words left in Arabic maintenance UI copy fail the audit.
const preservedTerms = [
  'BoatPro', 'HarborLink', 'HarborTech', 'GPS', 'QR', 'CSV', 'PDF', 'API',
  'SWIFT', 'IBAN', 'SAR', 'CSAT', 'HyperPay', 'Yamaha', 'Mercury', 'Volvo', 'Penta',
  'ABYC', 'Seakeeper', 'Racor', 'Parker', 'Hannifin', 'SKU', 'SUP', 'Excel', 'Enter',
  'PNG', 'WebP', 'SVG', 'MB', 'BIC', '2D', 'VHF', 'MRR', 'LOA', 'CTR', 'OCR', 'HH:mm',
  'Google Maps', 'Google', 'English', 'Socket', 'REST', 'URL', 'Bearer', 'curl',
  'Apple Pay', 'JPG', 'L', 'kWh', 'm³', 'AE', 'F', 'N1', 'VIP', 'B', 'AV', 'H', 'TOKEN', 'Authorization',
]
// Exact UI examples/identifiers retained from provider-entered data samples.
const preservedExamples = [
  '⌘K', 'HarborTech Marine Service', 'Parker Hannifin Marine', 'Nordlys', 'D-02', '500FG', '2010TM-OR', 'A-04',
  'Sam Ortiz', 'Jane Cooper', 'Sea Breeze', 'John Miller', 'Marcus Webb',
  'Harbor Point Fuel & Bunkering', '2 Fuel Pier Road', 'Azure Bay · Fuel Dock 1', '1010xxxxxx', '3xxxxxxxxxxxxx', '+966 5x xxx xxxx', 'https://',
  'https://harbortech.sa', 'curl -H "Authorization: Bearer $TOKEN"',
  'SA00 0000 0000 0000 0000 0000', 'RJHISARI', 'العربية', 'ع', 'جارٍ تجهيز الواجهة العربية…',
]
const preservedPattern = new RegExp(
  `(?<![A-Za-z0-9])(?:${preservedTerms.map(term => term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')}|[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,12})+|[A-Z0-9]{5,})(?![A-Za-z0-9])`,
  'gi',
)
const latinWordPattern = /[A-Za-z][A-Za-z0-9'’._/-]*/g
const placeholderPattern = /\{\{([a-z][\w]*)\}\}/gi

const storage = new Map([['boatpro.portal.language', 'ar']])
globalThis.window = {
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
}
const documentElement = {
  lang: '',
  dir: '',
  attributes: new Map(),
  classes: new Set(),
  setAttribute(name, value) { this.attributes.set(name, value) },
  classList: { add: value => documentElement.classes.add(value) },
}
globalThis.document = { documentElement }

const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const runtime = await server.ssrLoadModule('/src/i18n/runtime.ts')
  const notificationI18n = await server.ssrLoadModule('/src/maint/maintNotificationI18n.ts')
  const { MAINTENANCE_ARABIC_MESSAGES } = await server.ssrLoadModule('/src/i18n/maintMessages.ts')

  assert.equal(await runtime.bootstrapPortalLanguage(), 'ar')
  assert.equal(storage.get('boatpro.portal.language'), 'ar', 'Arabic selection persists')
  assert.equal(documentElement.lang, 'ar', 'Arabic sets the document language before render')
  assert.equal(documentElement.dir, 'rtl', 'Arabic sets RTL before render')

  const maintenanceNotificationCases = [
    {
      type: 'booking_request', title: 'طلب صيانة جديد',
      body: 'Alnajmah Luxury Motor Yacht: Engine & Propulsion, Paint & Varnish',
      titleArabic: 'طلب صيانة جديد', bodyHas: ['Alnajmah Luxury Motor Yacht', 'المحرك وأنظمة الدفع', 'الطلاء والورنيش'], bodyLacks: ['Engine & Propulsion', 'Paint & Varnish'],
    },
    {
      type: 'booking_reminder', title: '📋 Upcoming Job Tomorrow',
      body: 'Scheduled job for "Alnajmah Luxury Motor Yacht" (Engine & Propulsion, Paint & Varnish) is set for tomorrow at 9:30 AM.',
      titleArabic: '📋 مهمة مجدولة غدًا', bodyHas: ['Alnajmah Luxury Motor Yacht', 'المحرك وأنظمة الدفع', 'الطلاء والورنيش', '9:30 AM'], bodyLacks: ['Engine & Propulsion', 'Paint & Varnish'],
    },
    {
      type: 'booking_reminder', title: '🚀 Service Scheduled Now',
      body: 'Maintenance job for "Alnajmah Luxury Yacht" (Annual Pre-Season Marine Diagnostics & Hull Check) is scheduled to start now.',
      titleArabic: '🚀 موعد الخدمة الآن', bodyHas: ['Alnajmah Luxury Yacht', 'Annual Pre-Season Marine Diagnostics & Hull Check', 'الآن'], bodyLacks: ['is scheduled to start now'],
    },
    {
      type: 'booking_reminder', title: '⚡ Job Starts in 1 Hour',
      body: 'Prepare for dispatch: "Annual Pre-Season Marine Diagnostics & Hull Check" for "Alnajmah Luxury Yacht" starts in 1 hour.',
      titleArabic: '⚡ تبدأ المهمة خلال ساعة واحدة', bodyHas: ['Annual Pre-Season Marine Diagnostics & Hull Check', 'Alnajmah Luxury Yacht', 'خلال ساعة واحدة'], bodyLacks: ['Prepare for dispatch', 'starts in 1 hour'],
    },
    {
      type: 'booking_reminder', title: '⏰ Job in 2 Hours',
      body: 'Scheduled maintenance for "Alnajmah Luxury Yacht" starts in 2 hours (6:26 AM).',
      titleArabic: '⏰ مهمة بعد ساعتين', bodyHas: ['Alnajmah Luxury Yacht', 'بعد ساعتين', '6:26 AM'], bodyLacks: ['Scheduled maintenance', 'starts in 2 hours'],
    },
    {
      type: 'booking_reminder', title: '📋 Job in 12 Hours',
      body: 'Upcoming job for "Alnajmah Luxury Yacht" (Annual Pre-Season Marine Diagnostics & Hull Check) begins in 12 hours (6:26 AM).',
      titleArabic: '📋 مهمة بعد ١٢ ساعة', bodyHas: ['Alnajmah Luxury Yacht', 'Annual Pre-Season Marine Diagnostics & Hull Check', 'بعد ١٢ ساعة', '6:26 AM'], bodyLacks: ['Upcoming job', 'begins in 12 hours'],
    },
    {
      type: 'booking_confirmed', title: '💰 Payment Received — Alnajmah Luxury Motor Yacht',
      body: 'The boat owner paid SAR 750 via HyperPay for Work Order MWO-000007. Vessel delivery is now authorized.',
      titleArabic: '💰 تم استلام الدفعة — Alnajmah Luxury Motor Yacht', bodyHas: ['SAR', 'HyperPay', 'MWO-000007', 'أصبح تسليم القارب'], bodyLacks: ['The boat owner paid', 'Vessel delivery is now authorized'],
    },
    {
      type: 'general', title: 'Payout sent',
      body: 'Your payout of 7950 SAR for 2026-08-31 to 2026-09-06 is on its way to your bank account. The bank transfer receipt is attached to the payout in your app.',
      titleArabic: 'تم إرسال التحويل', bodyHas: ['٧٬٩٥٠', 'SAR', '2026-08-31', '2026-09-06', 'إيصال التحويل'], bodyLacks: ['Your payout', 'is on its way to your bank account', 'bank transfer receipt is attached'],
    },
    {
      type: 'review_received', title: 'New review',
      body: 'Red Sea Charters & Luxury Marine Escapes left a 5★ review: "Good"',
      titleArabic: 'تقييم جديد', bodyHas: ['Red Sea Charters & Luxury Marine Escapes', '٥', 'Good'], bodyLacks: ['left a', 'review:'],
    },
  ]
  for (const sample of maintenanceNotificationCases) {
    const localized = notificationI18n.localizeMaintenanceNotification(sample)
    assert.equal(localized.title, sample.titleArabic, `Notification title translates: ${sample.title}`)
    assert.doesNotMatch(`${localized.title} ${localized.body}`, /\{\{[a-z][\w]*\}\}/i, 'Notification templates never leak placeholders')
    const plainBody = localized.body.replace(/[\u2066-\u2069]/g, '')
    for (const fragment of sample.bodyHas) assert.ok(plainBody.includes(fragment), `Notification preserves/includes ${fragment}: ${localized.body}`)
    for (const fragment of sample.bodyLacks) assert.ok(!plainBody.includes(fragment), `Notification translates ${fragment}: ${localized.body}`)
    assert.equal(localized.type, sample.type === 'booking_request' ? 'طلب حجز' : sample.type === 'booking_reminder' ? 'تذكير بالحجز' : sample.type === 'booking_confirmed' ? 'تم تأكيد الحجز' : sample.type === 'review_received' ? 'تم استلام تقييم' : 'عام')
  }
  assert.equal(notificationI18n.localizedMaintenanceNotificationType('booking reminder'), 'تذكير بالحجز')
  const workerApproval = notificationI18n.localizeMaintenanceNotification({ type: 'general', title: 'تم اعتماد Worker', body: 'Cupidatat culpa eos was approved and may now use the portal.' })
  assert.equal(workerApproval.title, 'تم اعتماد العامل')
  assert.ok(workerApproval.body.includes('Cupidatat culpa eos') && workerApproval.body.includes('تم اعتماد'))
  const providerApproval = notificationI18n.localizeMaintenanceNotification({ type: 'general', title: 'تم اعتماد Your provider account is', body: 'Welcome aboard, HarborTech. Your account is approved — you can now list and take bookings.' })
  assert.equal(providerApproval.title, 'تم اعتماد حساب مزود الخدمة الخاص بك')
  assert.ok(providerApproval.body.includes('HarborTech') && providerApproval.body.includes('مرحبًا بك'))
  assert.equal(notificationI18n.localizeMaintenanceNotification({ type: 'booking_reminder', title: '⁨⏰ Job in 2⁩ ساعة', body: 'A provider note.' }).title, '⏰ مهمة بعد ساعتين')
  const broadcastBody = 'this is a importent broad cast — our price system is being increase from 10sar to 100000sar'
  assert.equal(notificationI18n.localizeMaintenanceNotification({ type: 'general', title: 'عام', body: broadcastBody }).body, broadcastBody, 'provider-authored broadcasts stay unchanged')

  const regressions = new Map([
    ['🧾 Log completed service', '🧾 تسجيل خدمة مكتملة'],
    ['🧾 New invoice', '🧾 فاتورة جديدة'],
    ['Access disabled', 'تم تعطيل الوصول'],
    ['Not Set (Click Edit Profile)', 'غير محدد (انقر على تعديل الملف)'],
    ['✏️ Edit Workshop Business Profile', '✏️ تعديل الملف التجاري للورشة'],
    ['Worker', 'عامل'],
    ['Active jobs', 'أعمال نشطة'],
    ['Techs on duty', 'فنيون في الخدمة'],
    ['Inboard Engines', 'المحركات الداخلية'],
    ['Outboard Engines', 'المحركات الخارجية'],
    ['Inboard & Outboard Engines', 'المحركات الداخلية والخارجية'],
    ['Electrical & Lithium Systems', 'الأنظمة الكهربائية وأنظمة الليثيوم'],
    ['Hull & Gelcoat Refit', 'تجديد الهيكل وطلاء الجل'],
    ['Hydraulics & Steering Systems', 'الأنظمة الهيدروليكية وأنظمة التوجيه'],
    ['Plumbing, Heads & Watermakers', 'السباكة والمراحيض وأجهزة تحلية المياه'],
    ['Marine HVAC & Climate Control', 'أنظمة التكييف والتحكم بالمناخ البحري'],
    ['Marine Electronics & Radar', 'الإلكترونيات البحرية والرادار'],
    ['Underwater Antifouling & Zincs', 'مكافحة الحشف تحت الماء وقطع الزنك'],
    ['Propeller & Drive Alignment', 'محاذاة المروحة ونظام الدفع'],
    ['Rigging & Sail Maintenance', 'صيانة تجهيزات القارب والأشرعة'],
    ['Diagnostic Survey & Inspection', 'المعاينة التشخيصية والفحص'],
    ['Lead Technician', 'فني رئيسي'],
    ['Marine Mechanic', 'ميكانيكي بحري'],
    ['Safety Inspector', 'مفتش سلامة'],
    ['Assigned', 'مُسنَد'],
    ['Diagnosis', 'التشخيص'],
    ['Waiting parts', 'بانتظار قطع الغيار'],
    ['On leave', 'في إجازة'],
    ['Invited', 'تمت الدعوة'],
    ['Pass', 'اجتاز'],
    ['Fail', 'فشل'],
    ['Attention', 'يحتاج إلى متابعة'],
    ['Expiring', 'على وشك الانتهاء'],
    ['Claim open', 'مطالبة مفتوحة'],
    ['Dockside', 'على الرصيف'],
    ['Mobile', 'متنقل'],
    ['Critical', 'حرج'],
    ['Active Job', 'عمل نشط'],
    ['Pending Request', 'طلب معلّق'],
    ['Awaiting Admin', 'بانتظار اعتماد الإدارة'],
    ['Labor hours · wk', 'ساعات العمل · أسبوعيًا'],
    ['Avg utilization', 'متوسط نسبة الاستخدام'],
    ['Skills, availability, assignment, hours, overtime & productivity', 'المهارات والتوافر والإسناد والساعات والعمل الإضافي والإنتاجية'],
    ['Preventive maintenance', 'الصيانة الوقائية'],
    ['Corrective maintenance', 'الصيانة التصحيحية'],
    ['Predictive maintenance', 'الصيانة التنبؤية'],
    ['Emergency maintenance', 'الصيانة الطارئة'],
    ['Seasonal maintenance', 'الصيانة الموسمية'],
    ['Annual maintenance', 'الصيانة السنوية'],
    ['Cards view', 'عرض البطاقات'],
    ['Table view', 'عرض الجدول'],
    ['Download as CSV', 'تنزيل بصيغة CSV'],
    ['Download as Excel', 'تنزيل بصيغة Excel'],
    ['Download as PDF', 'تنزيل بصيغة PDF'],
    ['Search subject or SUP- reference', 'ابحث عن الموضوع أو رقم مرجع SUP-'],
    ['h', 'س'],
    ['1 day', 'يوم واحد'],
    ['2 days', 'يومان'],
    ['5 days', '٥ أيام'],
    ['Approved by BoatPro Admin!', 'تم اعتماد ورشتك من إدارة BoatPro!'],
  ])
  for (const [english, arabic] of regressions) {
    assert.equal(runtime.translatePortalText(english), arabic, `Arabic regression: ${english}`)
  }

  const oneTrip = runtime.translatePortalText('1 trip')
  const twoTrips = runtime.translatePortalText('2 trip')
  assert.match(oneTrip, /رحلة واحدة/, 'singular count template resolves')
  assert.doesNotMatch(twoTrips, /رحلة واحدة/, 'singular translation cannot capture plural counts')
  assert.doesNotMatch(twoTrips, /\{\{[a-z][\w]*\}\}/i, 'template tokens never leak')

  const onDuty = runtime.translatePortalTemplate('{{count}} of {{total}} on duty', { count: 2, total: 5 })
  assert.match(onDuty, /٢/)
  assert.match(onDuty, /٥/)
  assert.doesNotMatch(onDuty, /\{\{[a-z][\w]*\}\}/i)
  const dashboardCounts = runtime.translatePortalTemplate(
    'New requests: {{requests}} · Jobs in progress: {{inProgress}} · Open work orders: {{openOrders}}',
    { requests: 1, inProgress: 2, openOrders: 6 },
  )
  assert.match(dashboardCounts, /طلبات جديدة/)
  assert.match(dashboardCounts, /أعمال قيد التنفيذ/)
  assert.match(dashboardCounts, /أوامر عمل مفتوحة/)
  assert.match(dashboardCounts, /١/)
  assert.match(dashboardCounts, /٢/)
  assert.match(dashboardCounts, /٦/)
  const inspectionTitle = runtime.translatePortalTemplate('{{type}} inspection', {
    type: runtime.translatePortalText('Pre-Service'),
  })
  assert.equal(inspectionTitle.replace(/[\u2068\u2069]/g, ''), 'فحص قبل الخدمة')
  const savedInspection = runtime.translatePortalTemplate(
    '{{type}} inspection saved — score {{score}}',
    { type: runtime.translatePortalText('Engine'), score: 87 },
  )
  assert.equal(savedInspection.replace(/[\u2068\u2069]/g, ''), 'تم حفظ فحص المحرك — النتيجة ٨٧')
  assert.doesNotMatch(`${inspectionTitle} ${savedInspection}`, /\{\{[a-z][\w]*\}\}/i)
  assert.match(runtime.translatePortalTemplate('Review requests ({{count}})', { count: 3 }), /مراجعة الطلبات.*٣/)
  assert.match(
    runtime.translatePortalTemplate('{{count}} technician awaiting BoatPro Admin verification', { count: 1 }),
    /فني واحد/,
  )
  assert.match(
    runtime.translatePortalTemplate('{{count}} technicians awaiting BoatPro Admin verification', { count: 3 }),
    /٣/,
  )
  assert.doesNotMatch(runtime.translatePortalTemplate('Hello {{name}}', {}), /\{\{[a-z][\w]*\}\}/i)

  for (const [english, arabic] of Object.entries(MAINTENANCE_ARABIC_MESSAGES)) {
    const sourceNames = new Set([...english.matchAll(placeholderPattern)].map(match => match[1].toLowerCase()))
    const translatedNames = new Set([...arabic.matchAll(placeholderPattern)].map(match => match[1].toLowerCase()))
    for (const name of translatedNames) {
      assert(sourceNames.has(name), `Unexpected {{${name}}} in Arabic catalog entry: ${english}`)
    }
    for (const name of sourceNames) {
      assert(translatedNames.has(name) || name === 'count', `Missing {{${name}}} in Arabic catalog entry: ${english}`)
    }
    assert.doesNotMatch(runtime.translatePortalTemplate(english, {}), /\{\{[a-z][\w]*\}\}/i)
  }

  const staticTexts = await collectTranslatedLiterals(sourceRoots)
  staticTexts.push(...await collectMaintenanceTaxonomyLiterals())
  const engageSource = await readFile(path.join(root, 'src', 'maint', 'pages', 'MaintEngage.tsx'), 'utf8')
  const resourcesSource = await readFile(path.join(root, 'src', 'maint', 'pages', 'MaintResources.tsx'), 'utf8')
  assert.match(engageSource, /<span>\{translatePortalText\(cat\)\}<\/span>/, 'fixed specialty options are localized')
  assert.match(engageSource, /<span className="truncate">\{translatePortalText\(cat\)\}<\/span>/, 'fixed service category rows are localized')
  assert.match(resourcesSource, /<span>\{translatePortalText\(r\)\}<\/span>/, 'default technician roles are localized in the role picker')
  assert.match(resourcesSource, /text-deep-900">\{translatePortalText\(r\)\}<\/span>/, 'selected technician roles are localized')
  assert.match(resourcesSource, /translatePortalText\(String\(localizedField\(r, 'role'\) \?\? r\.role\)\)/, 'known technician roles are localized while custom role names remain intact')
  assert.match(resourcesSource, /translatePortalText\('\/hr'\)/, 'hourly rate units are localized')
  const failures = []
  for (const { text: english, file, line, kind } of staticTexts) {
    // These exact values are intentionally supplied as examples, sample
    // provider names/addresses, or technical links. Their source-language
    // spelling is part of the example and should not be catalog-translated.
    if (preservedExamples.includes(english.trim())) continue
    if (kind === 'raw-jsx') {
      if (/[\u0621-\u063A\u0641-\u064A]/.test(english)) {
        const remainingArabic = withoutPreservedText(english)
        if (/[\u0621-\u063A\u0641-\u064A]/.test(remainingArabic)) {
          failures.push(`${path.relative(root, file)}:${line} Arabic-only/raw JSX text ${JSON.stringify(english)}`)
        }
        continue
      }
      const arabic = runtime.translatePortalStaticText(english)
      const translatedWords = [...withoutPreservedText(arabic).matchAll(latinWordPattern)].map(match => match[0])
      if (translatedWords.length) failures.push(`${path.relative(root, file)}:${line} raw JSX text ${JSON.stringify(english)} → ${JSON.stringify(arabic)}`)
      continue
    }
    const arabic = kind === 'translated-template'
      ? runtime.translatePortalTemplate(english, sampleTemplateValues(english))
      : runtime.translatePortalText(english)
    if (kind === 'translated-template') {
      assert.doesNotMatch(arabic, /\{\{[a-z][\w]*\}\}/i, `${path.relative(root, file)}:${line} template tokens never leak`)
    }
    const remainingLatin = withoutPreservedText(arabic)
    const words = [...remainingLatin.matchAll(latinWordPattern)].map(match => match[0])
    if (words.length) failures.push(`${path.relative(root, file)}:${line} ${JSON.stringify(english)} → ${JSON.stringify(arabic)}`)
  }
  assert.deepEqual(failures, [], `Untranslated or mixed-language maintenance UI literals:\n${failures.join('\n')}`)

  storage.set('boatpro.portal.language', 'en')
  assert.equal(await runtime.bootstrapPortalLanguage(), 'en', 'English is selected before first render')
  assert.equal(storage.get('boatpro.portal.language'), 'en', 'English selection persists')
  assert.equal(documentElement.lang, 'en', 'English sets the document language')
  assert.equal(documentElement.dir, 'ltr', 'English sets LTR before render')
  for (const { text: english } of staticTexts) {
    assert.equal(runtime.translatePortalText(english), english, `English copy changed: ${english}`)
  }
  for (const [english] of regressions) {
    assert.equal(runtime.translatePortalText(english), english, `English regression: ${english}`)
  }
  for (const sample of maintenanceNotificationCases) {
    const english = notificationI18n.localizeMaintenanceNotification(sample)
    assert.equal(english.title, sample.title, `English notification title stays unchanged: ${sample.title}`)
    assert.equal(english.body, sample.body, `English notification body stays unchanged: ${sample.body}`)
  }
  assert.equal(runtime.translatePortalTemplate('{{type}} inspection', { type: 'Engine' }), 'Engine inspection')
  assert.equal(
    runtime.translatePortalTemplate('{{type}} inspection saved — score {{score}}', { type: 'Engine', score: 87 }),
    'Engine inspection saved — score 87',
  )

  storage.set('boatpro.portal.language', 'ar')
  assert.equal(await runtime.bootstrapPortalLanguage(), 'ar', 'Arabic is selected before first render')
  assert.equal(documentElement.lang, 'ar', 'Arabic bootstrap restores the document language')
  assert.equal(documentElement.dir, 'rtl', 'Arabic bootstrap restores RTL')

  console.log(`Portal localization audit passed: ${staticTexts.length} UI strings across all portal areas, ${Object.keys(MAINTENANCE_ARABIC_MESSAGES).length} maintenance Arabic entries.`)
} finally {
  await server.close()
}

function sampleTemplateValues(template) {
  const values = {}
  for (const [, rawName] of template.matchAll(placeholderPattern)) {
    const name = rawName.toLowerCase()
    if (/^(count|.*count|qty|quantity|stock|capacity|remaining|available|balance|amount|percent|percentage|rate|score|total|hours|days|day|channel|workers|tanks|products|photos|vehicles|orders|fields|locations|load|required|maxRemaining)$/i.test(name)) {
      values[rawName] = 2
    } else if (name === 'status' || name === 'state' || name === 'approval') {
      values[rawName] = 'Pending'
    } else if (name === 'type' || name === 'category' || name === 'cat') {
      values[rawName] = 'المحرك'
    } else if (name === 'role') {
      values[rawName] = 'Marine Mechanic'
    } else if (name === 'kind') {
      values[rawName] = 'Workshop'
    } else if (name === 'unit') {
      values[rawName] = 'SAR'
    } else if (name === 'label') {
      values[rawName] = 'technician'
    } else if (name === 'id' || name.endsWith('id') || name === 'code' || name.endsWith('code')) {
      values[rawName] = 'MWO-0001'
    } else {
      values[rawName] = 'HarborTech'
    }
  }
  return values
}

async function collectTranslatedLiterals(sourcePaths) {
  const output = []
  const translatedTextAttributes = new Set([
    'sub', 'searchPlaceholder', 'title', 'placeholder', 'aria-label', 'alt', 'label',
    'description', 'emptyMessage', 'emptyText', 'helperText', 'hint', 'tooltip',
    'subtitle', 'caption', 'text', 'message', 'noun', 'heading', 'eyebrow',
    'confirmText', 'cancelText', 'actionLabel', 'buttonLabel', 'submitLabel', 'noResultsText',
    'accessibilityLabel', 'accessibilityHint', 'aria-description',
  ])
  const files = []
  for (const sourcePath of sourcePaths) {
    if ((await stat(sourcePath)).isDirectory()) files.push(...await walk(sourcePath))
    else if (/\.tsx?$/.test(sourcePath) && !/\.d\.ts$/.test(sourcePath)) files.push(sourcePath)
  }
  for (const file of [...new Set(files)]) {
    const source = await readFile(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file, source, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const decodeText = value => value.replace(/&(#x[\da-f]+|#\d+|amp|apos|bull|copy|hellip|lt|mdash|middot|nbsp|ndash|quot|reg|times|gt);/gi,
      (entity, name) => {
        if (name[0] === '#') {
          const code = name[1]?.toLowerCase() === 'x'
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10)
          try { return String.fromCodePoint(code) } catch { return entity }
        }
        return ({ amp: '&', apos: "'", bull: '•', copy: '©', hellip: '…', lt: '<', mdash: '—',
          middot: '·', nbsp: ' ', ndash: '–', quot: '"', reg: '®', times: '×', gt: '>' })[name.toLowerCase()] ?? entity
      })
    const insideLiteralBlock = node => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (!ts.isJsxElement(parent) && !ts.isJsxSelfClosingElement(parent)) continue
        const opening = ts.isJsxElement(parent) ? parent.openingElement : parent
        const tag = ts.isIdentifier(opening.tagName) ? opening.tagName.text.toLowerCase() : ''
        if (['code', 'pre', 'script', 'style', 'textarea', 'svg'].includes(tag)) return true
      }
      return false
    }
    const isLanguageSpecificLiteral = node => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isConditionalExpression(parent)
          && /isPortalArabic|isArabic|isRTL|language|lang/i.test(parent.condition.getText(sourceFile))) return true
        if (ts.isIfStatement(parent)
          && /getPortalLanguage|isPortalArabic|isArabic|isRTL|language|lang/i.test(parent.expression.getText(sourceFile))) return true
      }
      return false
    }
    const visit = node => {
      if (ts.isJsxText(node) && !insideLiteralBlock(node) && !isLanguageSpecificLiteral(node)) {
        const text = decodeText(node.text).replace(/\s+/g, ' ').trim()
        if (text.length > 1 && /[A-Za-z\u0621-\u063A\u0641-\u064A]/.test(text)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          output.push({ text, file, line: line + 1, kind: 'raw-jsx' })
        }
      }
      // A literal inside a JSX expression is visible too, for example
      // <span>{loading ? 'Loading…' : 'Refresh'}</span>.
      if (ts.isJsxExpression(node) && node.expression && node.parent && ts.isJsxElement(node.parent)
        && !insideLiteralBlock(node) && !isLanguageSpecificLiteral(node)) {
        const visibleLiterals = []
        const collect = child => {
          if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
            if (child.text.trim().length > 1 && /[A-Za-z\u0621-\u063A\u0641-\u064A]/.test(child.text)
              && !isLanguageSpecificLiteral(child)) visibleLiterals.push(child)
            return
          }
          if (ts.isConditionalExpression(child)) {
            collect(child.whenTrue)
            collect(child.whenFalse)
          } else if (ts.isBinaryExpression(child)
            && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(child.operatorToken.kind)) {
            collect(child.right)
          } else if (ts.isParenthesizedExpression(child) || ts.isAsExpression(child) || ts.isTypeAssertionExpression(child)) {
            collect(child.expression)
          }
        }
        collect(node.expression)
        for (const literal of visibleLiterals) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile))
          output.push({ text: literal.text, file, line: line + 1, kind: 'raw-jsx' })
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && ['translatePortalText', 'translatePortalStaticText', 'translatePortalTemplate'].includes(node.expression.text)) {
        const argument = node.arguments[0]
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
          const text = argument.text.trim()
          if (text) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile))
            output.push({
              text,
              file,
              line: line + 1,
              kind: node.expression.text === 'translatePortalTemplate' ? 'translated-template' : 'translated-call',
            })
          }
        }
      }
      const isTranslatedTextAttribute = ts.isJsxAttribute(node) && ts.isIdentifier(node.name)
        && translatedTextAttributes.has(node.name.text)
      const isDisplayLabelProperty = ts.isPropertyAssignment(node)
        && ((ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
          && ['l', 'label'].includes(node.name.text))
      if (isTranslatedTextAttribute || isDisplayLabelProperty) {
        const initializer = isTranslatedTextAttribute
          ? node.initializer
          : node.initializer
        const value = initializer && (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer))
          ? initializer
          : initializer && ts.isJsxExpression(initializer) && initializer.expression
            && (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
              ? initializer.expression
              : undefined
        const text = value ? decodeText(value.text).trim() : undefined
        if (text) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(value.getStart(sourceFile))
          output.push({ text, file, line: line + 1, kind: 'text-prop' })
        }
      }
      // React Native alerts bypass JSX and are easy to miss in a source scan.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(sourceFile) === 'Alert'
        && node.expression.name.text === 'alert') {
        const addAlertLiteral = literal => {
          const text = literal.text.trim()
          if (!text || !/[A-Za-z\u0600-\u06FF]/.test(text)) return
          const { line } = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile))
          output.push({ text, file, line: line + 1, kind: 'raw-jsx' })
        }
        for (const argument of node.arguments.slice(0, 2)) {
          if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) addAlertLiteral(argument)
        }
        const buttons = node.arguments[2]
        if (buttons && ts.isArrayLiteralExpression(buttons)) {
          for (const button of buttons.elements) {
            if (!ts.isObjectLiteralExpression(button)) continue
            const text = button.properties.find(prop => ts.isPropertyAssignment(prop)
              && ts.isIdentifier(prop.name) && prop.name.text === 'text')
            if (text && ts.isPropertyAssignment(text)
              && (ts.isStringLiteral(text.initializer) || ts.isNoSubstitutionTemplateLiteral(text.initializer))) {
              addAlertLiteral(text.initializer)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return output
}

async function collectMaintenanceTaxonomyLiterals() {
  const file = path.join(root, 'src', 'maint', 'maintData.ts')
  const source = await readFile(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const output = []
  const stringLiterals = node => {
    const values = []
    const visit = child => {
      if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
        values.push(child)
        return
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
    return values
  }
  const collectNamedProps = (initializer, names) => {
    const values = []
    const visit = node => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
        const value = node.initializer
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) values.push(value)
      }
      ts.forEachChild(node, visit)
    }
    visit(initializer)
    return values
  }
  const add = node => {
    const text = node.text.trim()
    if (!text) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    output.push({ text, file, line: line + 1, kind: 'maintenance-taxonomy' })
  }
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (['ALL_MARINE_SPECIALTIES', 'SENIORITY_ROLES'].includes(node.name.text)) {
        stringLiterals(node.initializer).forEach(add)
      } else if (['SERVICE_CATS', 'MAINT_CATEGORIES', 'INSPECTION_TYPES'].includes(node.name.text)) {
        collectNamedProps(node.initializer, new Set(['name', 'short'])).forEach(add)
      } else if (node.name.text === 'MAINT_PERMISSION_LABELS') {
        stringLiterals(node.initializer).forEach(add)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  for (const [relativePath, constantNames, propertyNames] of [
    ['src/maint/pages/MaintOps.tsx', new Set(['CHECKLIST_TEMPLATE']), new Set()],
    ['src/maint/pages/MaintOps.tsx', new Set(['MAINT_PLAN_META']), new Set(['name', 'desc'])],
  ]) {
    const additionalFile = path.join(root, relativePath)
    const additionalSource = await readFile(additionalFile, 'utf8')
    const additionalSourceFile = ts.createSourceFile(additionalFile, additionalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const addAdditional = node => {
      const text = node.text.trim()
      if (!text) return
      const { line } = additionalSourceFile.getLineAndCharacterOfPosition(node.getStart(additionalSourceFile))
      output.push({ text, file: additionalFile, line: line + 1, kind: 'maintenance-taxonomy' })
    }
    const visitAdditional = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && constantNames.has(node.name.text) && node.initializer) {
        if (node.name.text === 'CHECKLIST_TEMPLATE') stringLiterals(node.initializer).forEach(addAdditional)
        else collectNamedProps(node.initializer, propertyNames).forEach(addAdditional)
      }
      ts.forEachChild(node, visitAdditional)
    }
    visitAdditional(additionalSourceFile)
  }
  return output
}

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(fullPath))
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.push(fullPath)
  }
  return files
}

function withoutPreservedText(text) {
  const withoutExamples = preservedExamples.reduce((remaining, example) => {
    const escaped = example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return remaining.replace(new RegExp(escaped, 'gi'), '')
  }, text)
  return withoutExamples
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '')
    .replace(preservedPattern, '')
}
