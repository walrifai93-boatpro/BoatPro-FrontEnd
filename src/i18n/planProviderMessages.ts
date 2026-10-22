/** Arabic wording for what a provider sees of their plan price: introductory steps, offers, next renewal. */
export const PLAN_PROVIDER_ARABIC_MESSAGES: Record<string, string> = {
  // Schedule lines ("Months 2–4: 250 SAR / month")
  'Intro offer': 'عرض تمهيدي',
  'Every month': 'كل شهر',
  'From month {{month}}': 'من الشهر {{month}}',
  'Month {{month}}': 'الشهر {{month}}',
  'Months {{from}}–{{to}}': 'الأشهر {{from}}–{{to}}',
  '{{amount}} per booking': '{{amount}} لكل حجز',
  'month': 'شهر',
  'months': 'أشهر',
  'year': 'سنة',
  'years': 'سنوات',
  'Free': 'مجانًا',
  'Now': 'الآن',
  'Next': 'التالي',

  // How a charge was reached
  'Regular price': 'السعر المعتاد',
  'Intro price': 'السعر التمهيدي',
  'Offer': 'العرض',
  'Amount due': 'المبلغ المستحق',
  'Next renewal': 'التجديد القادم',
  'Billing period {{n}} of this plan': 'فترة الفوترة {{n}} من هذه الخطة',
  'Your price schedule': 'جدول أسعارك',
  'Your first payment': 'دفعتك الأولى',
  'The amount on the payment form is what your card will be charged.': 'المبلغ الظاهر في نموذج الدفع هو ما سيُخصم من بطاقتك.',

  // Commission in force
  'Your commission now': 'عمولتك الحالية',
  'Regular rate': 'النسبة المعتادة',
  'Intro rate until month {{month}} of your plan': 'سعر تمهيدي حتى الشهر {{month}} من خطتك',
  'You are in month {{month}}': 'أنت في الشهر {{month}}',
  'Your commission schedule': 'جدول عمولتك',

  // Offers
  'Your offers': 'عروضك',
  'Your price & offers': 'سعرك وعروضك',
  'Upcoming': 'قادم',
  'Active': 'نشط',
  'on your commission': 'على عمولتك',
  'on your subscription': 'على اشتراكك',
  '{{discount}} off your commission': 'خصم {{discount}} على عمولتك',
  '{{discount}} off each period': 'خصم {{discount}} على كل فترة',
  '{{amount}} per period': '{{amount}} لكل فترة',
  '{{rate}} commission per booking': 'عمولة {{rate}} لكل حجز',
  'Starts on {{date}}': 'يبدأ في {{date}}',
  'Valid until {{date}}': 'ساري حتى {{date}}',
  'No end date': 'بلا تاريخ انتهاء',
  'Discounted periods left: {{count}}': 'الفترات المخفّضة المتبقية: {{count}}',
  'Renew · {{amount}}': 'تجديد · {{amount}}',
  '{{amount}} off': 'خصم {{amount}}',

  // Offers that do not touch today's bill
  'Not applied': 'غير مطبّق',
  'Applies if you switch to commission': 'يسري إذا انتقلت إلى نظام العمولة',
  'Applies if you switch to subscription': 'يسري إذا انتقلت إلى نظام الاشتراك',
  'Does not apply to your current fee type': 'لا ينطبق على نوع الرسوم الحالي لديك',

  // Next renewal with a change, a move to commission or a cancellation ahead
  'After your plan changes on {{date}}': 'بعد تغيير خطتك في {{date}}',
  'After your scheduled plan change': 'بعد التغيير المجدول على خطتك',
  'New plan: {{name}}': 'الخطة الجديدة: {{name}}',
  'No renewal — your account moves to commission on {{date}}.': 'لا يوجد تجديد — سينتقل حسابك إلى نظام العمولة في {{date}}.',
  'No renewal — your account moves to commission at the end of this period.': 'لا يوجد تجديد — سينتقل حسابك إلى نظام العمولة في نهاية هذه الفترة.',
  'Your plan ends on {{date}}': 'تنتهي خطتك في {{date}}',
  'Your plan ends at the end of this period': 'تنتهي خطتك في نهاية هذه الفترة',
  'Undo the cancellation to keep your plan renewing.': 'تراجع عن الإلغاء ليستمر تجديد خطتك.',
  'Renewing early is not available while a plan change is scheduled. It opens again after your plan changes on {{date}}.':
    'التجديد المبكر غير متاح أثناء وجود تغيير مجدول على خطتك. سيتاح مجددًا بعد تغيير خطتك في {{date}}.',
  'Renewing early is not available while a plan change is scheduled.': 'التجديد المبكر غير متاح أثناء وجود تغيير مجدول على خطتك.',
  'BoatPro cannot take this payment right now. If your account was suspended by the BoatPro team, contact them to restore it.':
    'لا يمكن لـ BoatPro استلام هذه الدفعة حاليًا. إذا علّق فريق BoatPro حسابك، فتواصل معهم لاستعادته.',
}
