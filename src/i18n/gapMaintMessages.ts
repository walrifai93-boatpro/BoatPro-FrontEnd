/**
 * Arabic for maint copy the other catalogs missed (2026-10-01 gap sweep).
 * Registered as fill-only in runtime.ts, so wording an existing catalog
 * already uses for the same English always wins over these.
 */
export const GAP_MAINT_ARABIC_MESSAGES: Record<string, string> = {
  // ── Boat portal: crew ──────────────────────────────────────
  'Crew member {{name}} activated': 'تم تفعيل فرد الطاقم {{name}}',
  'Crew member {{name}} disabled': 'تم تعطيل فرد الطاقم {{name}}',
  'Withdraw invite for {{name}}?': 'هل تريد سحب الدعوة المرسلة إلى {{name}}؟',
  'Profile & Compliance': 'الملف الشخصي والامتثال',
  'Invalid date format': 'تنسيق التاريخ غير صالح',
  'Notes cannot exceed 500 characters': 'يجب ألا تتجاوز الملاحظات 500 حرف',

  // ── Boat portal: fleet ─────────────────────────────────────
  '{{name}} removed successfully': 'تمت إزالة {{name}} بنجاح',

  // ── Maintenance: workshop status banner ────────────────────
  'Workshop submitted for admin verification!': 'تم إرسال الورشة للتحقق الإداري!',
  'Workshop published live!': 'تم نشر الورشة وأصبحت متاحة الآن!',
  'Workshop unpublished': 'تم إلغاء نشر الورشة',

  // ── Maintenance: reschedule proposals ──────────────────────
  'Your workshop is closed that day': 'ورشتك مغلقة في ذلك اليوم',
  'That day and time did not parse': 'تعذرت قراءة اليوم والوقت المحددين',
  'Could not send the request': 'تعذر إرسال الطلب',
  'Could not withdraw the request': 'تعذر سحب الطلب',

  // ── Maintenance: roles ─────────────────────────────────────
  'Could not load your roles': 'تعذر تحميل الأدوار',
  'Could not save that role': 'تعذر حفظ هذا الدور',
  'Could not remove that role': 'تعذرت إزالة هذا الدور',

  // ── Maintenance: calendar ──────────────────────────────────
  'Invoice due': 'استحقاق فاتورة',
  'Could not load the schedule': 'تعذر تحميل الجدول',

  // ── Maintenance: quality, history & fleet ──────────────────
  'None scheduled': 'لا يوجد موعد مجدول',
  '{{boat}} passed QC — certified': 'اجتاز {{boat}} فحص الجودة — معتمد',
  'Rework requested for {{boat}}': 'طُلبت إعادة العمل على {{boat}}',
  'Could not open claim': 'تعذر فتح المطالبة',
  'Could not log service': 'تعذر تسجيل الخدمة',
  'Parts used': 'القطع المستخدمة',
  'Preventive service': 'الصيانة الوقائية',
  'Annual inspection': 'الفحص السنوي',
  'Haul-out & antifoul': 'إخراج القارب من الماء ومكافحة الحشف',
  'Engine 250h service': 'صيانة المحرك كل 250 ساعة',
  'Safety recertification': 'إعادة اعتماد السلامة',
  'Could not create fleet account': 'تعذر إنشاء حساب الأسطول',

  // ── Maintenance: workshop profile & settings ───────────────
  'Maintenance Workshop': 'ورشة صيانة',
  'Could not save profile': 'تعذر حفظ الملف',
  'Could not save categories': 'تعذر حفظ الفئات',
  'Could not save schedule': 'تعذر حفظ الجدول',
  'Could not save emergency details': 'تعذر حفظ بيانات الطوارئ',
  'No photos yet': 'لا توجد صور بعد',
  'Could not save the settings': 'تعذر حفظ الإعدادات',
  'SMS notifications': 'إشعارات الرسائل النصية',
  'AI auto-assignment': 'الإسناد التلقائي بالذكاء الاصطناعي',
  'Predictive maintenance alerts': 'تنبيهات الصيانة التنبؤية',
  'Emergency callout dispatch': 'إرسال فرق الاستجابة للطوارئ',

  // ── Maintenance: invoices & payouts ────────────────────────
  'Could not save bank details': 'تعذر حفظ البيانات البنكية',
  'Could not load invoices': 'تعذر تحميل الفواتير',
  'Could not update invoice': 'تعذر تحديث الفاتورة',
  'Could not create invoice': 'تعذر إنشاء الفاتورة',
  'Could not mark invoice paid': 'تعذر تسجيل الفاتورة كمدفوعة',
  'Could not generate payment QR': 'تعذر إنشاء رمز QR للدفع',
  'Collect payment': 'تحصيل الدفعة',
  '{{code}} marked paid — collected another way': 'تم تسجيل الفاتورة {{code}} كمدفوعة — حُصّلت بطريقة أخرى',
  '{{code}} marked paid — cash': 'تم تسجيل الفاتورة {{code}} كمدفوعة — نقدًا',

  // ── Maintenance: requests & work orders ────────────────────
  'Could not load maintenance requests': 'تعذر تحميل طلبات الصيانة',
  'Could not update request': 'تعذر تحديث الطلب',
  'Could not duplicate request': 'تعذر تكرار الطلب',
  'Could not save request': 'تعذر حفظ الطلب',
  'Could not create work order': 'تعذر إنشاء أمر العمل',
  '{{code}} accepted & approved': 'تم قبول {{code}} واعتماده',
  '{{code}} resumed': 'تم استئناف {{code}}',
  'Could not load work orders': 'تعذر تحميل أوامر العمل',
  'Could not update work order': 'تعذر تحديث أمر العمل',
  'Could not reassign work order': 'تعذرت إعادة إسناد أمر العمل',
  'Could not assign technician': 'تعذر إسناد الفني',
  'Could not update status': 'تعذر تحديث الحالة',
  'Could not update progress': 'تعذر تحديث التقدم',
  'Could not update parts cost': 'تعذر تحديث تكلفة القطع',
  'Generate, assign, track and complete jobs through the full status flow': 'أنشئ المهام وأسندها وتابعها وأكملها عبر جميع مراحل الحالة',
  'Update the status of jobs assigned to you': 'حدّث حالة المهام المسندة إليك',
  'Could not send payment reminder': 'تعذر إرسال تذكير الدفع',
  'Could not save the inspection': 'تعذر حفظ الفحص',
  'Could not schedule job': 'تعذرت جدولة المهمة',

  // ── Maintenance: technicians, parts, tools & suppliers ─────
  'Lost': 'مفقود',
  'Tools': 'الأدوات',
  'Could not send invite': 'تعذر إرسال الدعوة',
  'Could not update access': 'تعذر تحديث صلاحيات الوصول',
  'Could not resend invite': 'تعذرت إعادة إرسال الدعوة',
  "{{name}}'s access disabled": 'تم تعطيل وصول {{name}}',
  "{{name}}'s access re-enabled": 'تمت إعادة تفعيل وصول {{name}}',
  'Could not copy — select and copy manually': 'تعذر النسخ — حدّد النص وانسخه يدويًا',
  'Could not change duty status': 'تعذر تغيير حالة المناوبة',
  'Could not upload that photo': 'تعذر رفع هذه الصورة',
  'Could not save technician': 'تعذر حفظ بيانات الفني',
  'Could not load parts': 'تعذر تحميل قطع الغيار',
  'Could not add tool': 'تعذرت إضافة الأداة',
  'Could not remove tool': 'تعذرت إزالة الأداة',
  'Could not add supplier': 'تعذرت إضافة المورّد',
  'Could not remove supplier': 'تعذرت إزالة المورّد',
  'Could not add service': 'تعذرت إضافة الخدمة',
  'Could not remove service': 'تعذرت إزالة الخدمة',
  'Could not add part': 'تعذرت إضافة القطعة',
}
