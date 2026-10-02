/**
 * Arabic for fuel copy the other catalogs missed (2026-10-01 gap sweep).
 * Registered as fill-only in runtime.ts, so wording an existing catalog
 * already uses for the same English always wins over these.
 */
export const GAP_FUEL_ARABIC_MESSAGES: Record<string, string> = {
  // Station status banner and approval notice
  'Fuel station submitted for admin verification!': 'تم إرسال محطة الوقود إلى الإدارة للتحقق منها!',
  'Fuel station published live!': 'تم نشر محطة الوقود مباشرةً!',
  'Fuel station unpublished': 'تم إلغاء نشر محطة الوقود',
  'Station Location Awaiting Platform Approval': 'موقع المحطة بانتظار اعتماد المنصة',
  'Could not load the fuel portal': 'تعذر تحميل بوابة الوقود',

  // Credit terms ("Net 30")
  'Net {{days}}': 'صافي {{days}} يومًا',
  'Net 7': 'صافي ٧ أيام',
  'Net 10': 'صافي ١٠ أيام',

  // Fleet map legend
  'Base': 'المقر',

  // Calendar
  'Could not schedule the event': 'تعذرت جدولة الفعالية',
  'Could not remove the event': 'تعذرت إزالة الفعالية',

  // Dashboard
  '{{city}} · barge ops window': '{{city}} · نافذة عمليات الصنادل',
  'Barge ops window': 'نافذة عمليات الصنادل',

  // Engage: tracking, messages, settings
  'Customer tracking link copied to clipboard': 'تم نسخ رابط تتبع العميل إلى الحافظة',
  'Could not copy link — please try again': 'تعذر نسخ الرابط — يُرجى المحاولة مرة أخرى',
  'Conversation': 'محادثة',
  'Could not send the file': 'تعذر إرسال الملف',
  '{{radius}} nm service radius': 'نطاق خدمة {{radius}} ميلًا بحريًا',
  'Could not save the settings': 'تعذر حفظ الإعدادات',
  'Could not update the product': 'تعذر تحديث المنتج',
  'Could not add the team member': 'تعذرت إضافة عضو الفريق',
  '— around {{city}}': '— بالقرب من {{city}}',

  // Inventory: sensors and purchase orders
  '{{count}} tanks updated from sensors': 'عدد الخزانات التي تم تحديثها من أجهزة الاستشعار: {{count}}',
  'Sensors polled — no new readings': 'تم استطلاع أجهزة الاستشعار — لا توجد قراءات جديدة',
  'Sensor sync failed': 'فشلت مزامنة أجهزة الاستشعار',
  'Could not raise the purchase orders': 'تعذر إنشاء أوامر الشراء',

  // Inventory: fuel products and suppliers
  'Could not update the fuel product': 'تعذر تحديث منتج الوقود',
  'Customers will no longer be able to order it. This cannot be undone.': 'لن يتمكن العملاء من طلبه بعد الآن. لا يمكن التراجع عن هذا الإجراء.',
  'Removing...': 'جارٍ الإزالة...',
  'Fuel product "{{name}}" added to catalog': 'تمت إضافة منتج الوقود «{{name}}» إلى قائمة منتجاتك',
  'Could not add fuel product': 'تعذرت إضافة منتج الوقود',
  'Supplier "{{name}}" added': 'تمت إضافة المورد «{{name}}»',
  'Could not add supplier': 'تعذرت إضافة المورد',

  // Inventory: tanks
  '{{code}} history exported': 'تم تصدير سجل الخزان {{code}}',
  'Could not export the tank log': 'تعذر تصدير سجل الخزان',
  'Tank {{code}} added to monitoring': 'تمت إضافة الخزان {{code}} إلى المراقبة',
  'Could not add the tank': 'تعذرت إضافة الخزان',
  'Could not order the refill': 'تعذر طلب إعادة التعبئة',
  'Tank {{code}} updated': 'تم تحديث الخزان {{code}}',
  'Could not update the tank': 'تعذر تحديث الخزان',
  'It will stop accepting deliveries and stop counting towards available stock.': 'لن يستقبل الخزان عمليات التوريد بعد الآن، ولن يُحتسب ضمن المخزون المتاح.',
  'Deactivating...': 'جارٍ الإيقاف...',
  '{{code}} received into stock': 'تم استلام {{code}} في المخزون',
  'Could not receive the order': 'تعذر استلام الطلب',
  '📍 {{station}} — tanks, stock levels, batches, suppliers, expiry & reorder automation': '📍 {{station}} — الخزانات ومستويات المخزون والدفعات والموردون وتواريخ الانتهاء وأتمتة إعادة الطلب',
  'Tanks, stock levels, batches, suppliers, expiry & reorder automation': 'الخزانات ومستويات المخزون والدفعات والموردون وتواريخ الانتهاء وأتمتة إعادة الطلب',
  'Storage tanks (All Stations)': 'خزانات التخزين (جميع المحطات)',
  'Storage tanks — {{station}}': 'خزانات التخزين — {{station}}',
  'Selected Station': 'المحطة المحددة',
  'this location': 'هذا الموقع',

  // Money: pricing, coupons, bank, invoices
  'Could not publish the price list': 'تعذر نشر قائمة الأسعار',
  'Could not create the coupon': 'تعذر إنشاء القسيمة',
  'Could not save bank details': 'تعذر حفظ البيانات البنكية',
  'Fuel & services': 'الوقود والخدمات',
  'Invoice {{number}} created': 'تم إنشاء الفاتورة {{number}}',
  'Could not create the invoice': 'تعذر إنشاء الفاتورة',
  'Payment collected for {{number}}': 'تم تحصيل الدفعة للفاتورة {{number}}',
  'Could not record the payment': 'تعذر تسجيل الدفعة',
  'Refund initiated': 'تم بدء الاسترداد',
  'Could not issue the refund': 'تعذر إصدار المبلغ المسترد',
  // Downloaded receipt lines
  'Customer: {{customer}}': 'العميل: {{customer}}',
  'Items: {{items}}': 'العناصر: {{items}}',
  'Amount: {{amount}}': 'المبلغ: {{amount}}',
  'Method: {{method}}': 'طريقة الدفع: {{method}}',
  'Issued: {{date}}': 'تاريخ الإصدار: {{date}}',
  'Due: {{date}}': 'تاريخ الاستحقاق: {{date}}',
  'Status: {{status}}': 'الحالة: {{status}}',

  // Ops: orders and bookings
  'That action could not be applied': 'تعذر تطبيق هذا الإجراء',
  'Could not save the change': 'تعذر حفظ التغيير',
  'Could not withdraw the request': 'تعذر سحب الطلب',
  'Order {{ref}} created': 'تم إنشاء الطلب {{ref}}',
  'Order created': 'تم إنشاء الطلب',
  'Could not create the order': 'تعذر إنشاء الطلب',
  'Order {{ref}} accepted — customer notified': 'تم قبول الطلب {{ref}} وإشعار العميل.',
  'Order {{ref}} accepted': 'تم قبول الطلب {{ref}}.',
  'Order {{ref}} scheduled': 'تمت جدولة الطلب {{ref}}.',
  'Order {{ref}} started': 'بدأ تنفيذ الطلب {{ref}}.',
  'Order {{ref}} completed': 'اكتمل الطلب {{ref}}.',
  '🗓️ Booking calendar — {{month}}': '🗓️ تقويم الحجوزات — {{month}}',
  'Could not cancel the booking': 'تعذر إلغاء الحجز',
  'Customer payment required via HyperPay before delivery completion': 'يلزم أن يدفع العميل عبر HyperPay قبل إتمام التوصيل',
  'Could not send reminder': 'تعذر إرسال التذكير',
  'Customer payment required via HyperPay before delivery': 'يلزم أن يدفع العميل عبر HyperPay قبل التوصيل',

  // Station profile
  'Station profile for "{{name}}" saved!': 'تم حفظ ملف المحطة «{{name}}»!',
  'Failed to create station': 'تعذر إنشاء المحطة',
  'Its tanks, pumps and stock records go with it. This cannot be undone.': 'ستُحذف معه خزاناته ومضخاته وسجلات مخزونه. لا يمكن التراجع عن هذا الإجراء.',
  'Service area added': 'تمت إضافة منطقة الخدمة.',
  'Service area removed': 'تمت إزالة منطقة الخدمة.',
  'License added': 'تمت إضافة الترخيص.',
  'License removed': 'تمت إزالة الترخيص.',
  'Emergency contact added': 'تمت إضافة جهة اتصال الطوارئ.',
  'Emergency contact removed': 'تمت إزالة جهة اتصال الطوارئ.',
  'Could not update parent profile': 'تعذر تحديث ملف الشركة الأم',
  'Renewed {{count}} license': 'تم تجديد ترخيص واحد.',
  'Renewed {{count}} licenses': 'عدد التراخيص التي تم تجديدها: {{count}}.',
  'Coordinates: {{gps}}': 'الإحداثيات: {{gps}}',
  'Station name is required': 'اسم المحطة مطلوب',
  'Address is required': 'العنوان مطلوب',
  'Could not create the station': 'تعذر إنشاء المحطة',

  // Workers
  'Could not send invite': 'تعذر إرسال الدعوة',
  'Could not copy — select and copy manually': 'تعذر النسخ — حدّد الرابط وانسخه يدويًا',
  'Could not upload that photo': 'تعذر رفع هذه الصورة',
  'Could not reassign worker': 'تعذر نقل الموظف',
  'Could not update status': 'تعذر تحديث الحالة',
  'Could not resend invite': 'تعذرت إعادة إرسال الدعوة',
  'They lose access to the fuel portal immediately.': 'سيفقد صلاحية الدخول إلى بوابة الوقود فورًا.',
  'at this location': 'في هذا الموقع',
  'Disable Account': 'تعطيل الحساب',
  'Re-enable Account': 'إعادة تفعيل الحساب',
  'Reason: "{{reason}}"': 'السبب: «{{reason}}»',
  'Edit Profile — {{name}}': 'تعديل الملف الشخصي — {{name}}',
  '🔗 Resend Invite Link — {{name}}': '🔗 إعادة إرسال رابط الدعوة — {{name}}',
  'Reassign — {{name}}': 'نقل الموظف — {{name}}',
}
