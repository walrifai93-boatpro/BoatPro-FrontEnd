/**
 * Sample data for the "Fake fill" testing button.
 *
 * The button exists so a tester can sign up a provider without typing twenty
 * fields, and it is shown only while an admin has it switched on (see
 * `TestingToolsSettings` on the backend). Every press builds a new business
 * from scratch, so two test accounts made one after the other do not collide on
 * name or phone and do not look like copies of each other in the admin queue.
 *
 * The values are shaped to pass the same checks real input has to pass: phone
 * numbers in each country's mobile format, a 10-digit CR, a 15-digit VAT
 * number, and a Saudi IBAN with a correct mod-97 checksum and a real bank code,
 * so a fake-filled bank step saves instead of bouncing off `checkIban`.
 *
 * Email and password are never produced — the tester types those, because they
 * are what they will sign in with.
 *
 * Duplicated in `boatpro-provider/src/lib/fakeFill.ts` and
 * `marina-portal/src/shared/fakeFill.ts`, like `utils/iban.ts`, because the two
 * clients share no package. Change both.
 */

import { SAUDI_BANKS } from '../utils/iban';

export type FakeTrade = 'boat' | 'diver' | 'marina' | 'fuel' | 'maintenance';

export interface FakeLocation {
  latitude: number;
  longitude: number;
  /** Full street address, the way the geocoder writes one. */
  address: string;
  /** What the place is called — shown to guests instead of the address. */
  name: string;
  city: string;
  region: string;
  /** English country name, as the onboarding country chips store it. */
  country: string;
}

export interface FakeBank {
  bankName: string;
  accountHolderName: string;
  /** Normalised: no spaces, upper case. */
  iban: string;
  swiftCode: string;
}

export interface FakeHours {
  workingDays: number[];
  open24h: boolean;
  openTime: string;
  closeTime: string;
}

export interface FakeProvider {
  personName: string;
  businessNameEn: string;
  businessNameAr: string;
  /** A mobile number in the location's country, grouped for display. */
  mobile: string;
  crNumber: string;
  vatNumber: string;
  website: string;
  vhfChannel: string;
  location: FakeLocation;
  descriptionEn: string;
  descriptionAr: string;
  bank: FakeBank;
  hours: FakeHours;
  emergencyPerson: string;
  /** A second number, so the emergency line is not the business line. */
  emergencyPhone: string;
  emergencyProcedures: string;
}

// ── randomness ──────────────────────────────────────────────────────────────

export const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const int = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('');
const chance = (p: number) => Math.random() < p;
/** A few hundred metres either way, so the same base place never gives the same pin twice. */
const jitter = (v: number) => Math.round((v + (Math.random() - 0.5) * 0.008) * 1e6) / 1e6;

// ── people ──────────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Faisal', 'Abdullah', 'Khalid', 'Omar', 'Saud', 'Turki', 'Nasser', 'Majed', 'Fahad', 'Yousef',
  'Hamad', 'Ibrahim', 'Sultan', 'Rayan', 'Ziyad', 'Bandar', 'Meshal', 'Waleed', 'Hisham', 'Tariq',
  'Nora', 'Sara', 'Reem', 'Lama', 'Hala', 'Dana', 'Maha', 'Aseel', 'Joud', 'Lulwa', 'Ghada', 'Areej',
];
const LAST_NAMES = [
  'Al-Harbi', 'Al-Otaibi', 'Al-Qahtani', 'Al-Ghamdi', 'Al-Zahrani', 'Al-Shehri', 'Al-Dosari',
  'Al-Mutairi', 'Al-Subaie', 'Al-Anazi', 'Al-Shammari', 'Al-Juhani', 'Al-Malki', 'Al-Omari',
  'Al-Rashid', 'Al-Faraj', 'Al-Amri', 'Al-Balawi', 'Al-Hazmi', 'Al-Sulami', 'Al-Khaldi', 'Al-Yami',
];

const personName = () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;

// ── places ──────────────────────────────────────────────────────────────────

interface BasePlace {
  name: string;
  street: string;
  district: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  /** First digits of the postcode, so the address reads as local. */
  post: string;
}

/**
 * Real waterfronts, so the pin lands on a coast rather than in the desert and
 * the harbour filters that derive a city from coordinates get a sensible one.
 * Keyed by the English country names the onboarding chips use.
 */
const PLACES: BasePlace[] = [
  { name: 'Sharm Obhur', street: 'Prince Abdullah Al Faisal Rd', district: 'North Obhur', city: 'Jeddah', region: 'Makkah', country: 'Saudi Arabia', lat: 21.7275, lng: 39.0935, post: '238' },
  { name: 'Jeddah Corniche', street: 'Corniche Rd', district: 'Al Shati', city: 'Jeddah', region: 'Makkah', country: 'Saudi Arabia', lat: 21.6035, lng: 39.1065, post: '234' },
  { name: 'Durrat Al Arus', street: 'Durrat Al Arus Rd', district: 'Durrat Al Arus', city: 'Jeddah', region: 'Makkah', country: 'Saudi Arabia', lat: 21.9665, lng: 39.0485, post: '239' },
  { name: 'Bay La Sun Marina', street: 'Bay La Sun Blvd', district: 'Bay La Sun', city: 'King Abdullah Economic City', region: 'Makkah', country: 'Saudi Arabia', lat: 22.4435, lng: 39.0985, post: '239' },
  { name: 'Yanbu Corniche', street: 'King Abdulaziz Rd', district: 'Al Sharm', city: 'Yanbu', region: 'Madinah', country: 'Saudi Arabia', lat: 24.0895, lng: 38.0475, post: '465' },
  { name: 'Umluj Waterfront', street: 'Corniche St', district: 'Al Shati', city: 'Umluj', region: 'Tabuk', country: 'Saudi Arabia', lat: 25.0225, lng: 37.2655, post: '486' },
  { name: 'Al Wajh Harbour', street: 'Port Rd', district: 'Al Mina', city: 'Al Wajh', region: 'Tabuk', country: 'Saudi Arabia', lat: 26.2335, lng: 36.4675, post: '487' },
  { name: 'Dammam Corniche', street: 'Prince Mohammed Bin Fahd Rd', district: 'Al Shati Al Sharqi', city: 'Dammam', region: 'Eastern Province', country: 'Saudi Arabia', lat: 26.4505, lng: 50.1185, post: '324' },
  { name: 'Al Khobar Corniche', street: 'Corniche Rd', district: 'Al Corniche', city: 'Al Khobar', region: 'Eastern Province', country: 'Saudi Arabia', lat: 26.2965, lng: 50.2145, post: '346' },
  { name: 'Half Moon Bay', street: 'Half Moon Bay Rd', district: 'Al Nakheel', city: 'Al Khobar', region: 'Eastern Province', country: 'Saudi Arabia', lat: 26.0905, lng: 50.1705, post: '346' },
  { name: 'Jubail Corniche', street: 'Jubail Corniche Rd', district: 'Al Fanateer', city: 'Al Jubail', region: 'Eastern Province', country: 'Saudi Arabia', lat: 27.0175, lng: 49.6575, post: '359' },
  { name: 'Jazan Port', street: 'King Fahd Rd', district: 'Al Shati', city: 'Jazan', region: 'Jazan', country: 'Saudi Arabia', lat: 16.8895, lng: 42.5505, post: '826' },
  { name: 'Farasan Harbour', street: 'Harbour St', district: 'Al Qassar', city: 'Farasan', region: 'Jazan', country: 'Saudi Arabia', lat: 16.7035, lng: 42.1175, post: '826' },
  { name: 'Al Lith Waterfront', street: 'Coastal Rd', district: 'Al Shati', city: 'Al Lith', region: 'Makkah', country: 'Saudi Arabia', lat: 20.1505, lng: 40.2695, post: '219' },
  { name: 'Dubai Marina', street: 'Marina Walk', district: 'Dubai Marina', city: 'Dubai', region: 'Dubai', country: 'United Arab Emirates', lat: 25.0805, lng: 55.1405, post: '' },
  { name: 'Yas Marina', street: 'Yas Leisure Dr', district: 'Yas Island', city: 'Abu Dhabi', region: 'Abu Dhabi', country: 'United Arab Emirates', lat: 24.4665, lng: 54.6095, post: '' },
  { name: 'Al Hamra Marina', street: 'Al Hamra Rd', district: 'Al Hamra Village', city: 'Ras Al Khaimah', region: 'Ras Al Khaimah', country: 'United Arab Emirates', lat: 25.6905, lng: 55.7795, post: '' },
  { name: 'Fujairah Corniche', street: 'Corniche Rd', district: 'Al Faseel', city: 'Fujairah', region: 'Fujairah', country: 'United Arab Emirates', lat: 25.1305, lng: 56.3595, post: '' },
  { name: 'The Pearl Marina', street: 'Porto Arabia Dr', district: 'The Pearl', city: 'Doha', region: 'Doha', country: 'Qatar', lat: 25.3705, lng: 51.5505, post: '' },
  { name: 'Marina Crescent', street: 'Arabian Gulf St', district: 'Salmiya', city: 'Kuwait City', region: 'Hawalli', country: 'Kuwait', lat: 29.3405, lng: 48.0795, post: '' },
  { name: 'Bahrain Bay', street: 'King Faisal Hwy', district: 'Bahrain Bay', city: 'Manama', region: 'Capital', country: 'Bahrain', lat: 26.2445, lng: 50.5845, post: '' },
  { name: 'Marina Bandar Al Rowdha', street: 'Al Bustan St', district: 'Sidab', city: 'Muscat', region: 'Muscat', country: 'Oman', lat: 23.5855, lng: 58.6095, post: '' },
  { name: 'Hurghada Marina', street: 'Sheraton Rd', district: 'Sakala', city: 'Hurghada', region: 'Red Sea', country: 'Egypt', lat: 27.2235, lng: 33.8425, post: '' },
  { name: 'Ayla Marina', street: 'Ayla Blvd', district: 'Ayla', city: 'Aqaba', region: 'Aqaba', country: 'Jordan', lat: 29.5475, lng: 34.9955, post: '' },
];

function location(country?: string): FakeLocation {
  const pool = PLACES.filter((p) => !country || p.country === country);
  const p = pick(pool.length ? pool : PLACES);
  const building = int(1000, 9999);
  const postcode = p.post ? ` ${p.post}${digits(2)}` : '';
  return {
    latitude: jitter(p.lat),
    longitude: jitter(p.lng),
    address: `Building ${building}, ${p.street}, ${p.district}, ${p.city}${postcode}, ${p.country}`,
    name: p.name,
    city: p.city,
    region: p.region,
    country: p.country,
  };
}

// ── phones ──────────────────────────────────────────────────────────────────

/** Mobile formats per country — the carrier prefixes that actually exist there. */
const MOBILE: Record<string, () => string> = {
  'Saudi Arabia': () => `+966 5${pick(['0', '3', '4', '5', '6', '8', '9'])} ${digits(3)} ${digits(4)}`,
  'United Arab Emirates': () => `+971 5${pick(['0', '2', '4', '5', '6', '8'])} ${digits(3)} ${digits(4)}`,
  Qatar: () => `+974 ${pick(['3', '5', '6', '7'])}${digits(3)} ${digits(4)}`,
  Kuwait: () => `+965 ${pick(['5', '6', '9'])}${digits(3)} ${digits(4)}`,
  Bahrain: () => `+973 3${pick(['3', '4', '6', '9'])}${digits(2)} ${digits(4)}`,
  Oman: () => `+968 9${digits(3)} ${digits(4)}`,
  Egypt: () => `+20 1${pick(['0', '1', '2', '5'])} ${digits(4)} ${digits(4)}`,
  Jordan: () => `+962 7${pick(['7', '8', '9'])} ${digits(3)} ${digits(4)}`,
};

/** A Saudi mobile unless another country is named — signup happens before a country is known. */
export const fakeMobile = (country = 'Saudi Arabia') => (MOBILE[country] ?? MOBILE['Saudi Arabia'])();

// ── business names ──────────────────────────────────────────────────────────

/** Place words with their Arabic, so the English and Arabic names describe the same business. */
const NAME_WORDS: { en: string; ar: string }[] = [
  { en: 'Red Sea', ar: 'البحر الأحمر' },
  { en: 'Coral Bay', ar: 'خليج المرجان' },
  { en: 'Blue Lagoon', ar: 'البحيرة الزرقاء' },
  { en: 'Al Waha', ar: 'الواحة' },
  { en: 'Pearl Coast', ar: 'ساحل اللؤلؤ' },
  { en: 'Al Murjan', ar: 'المرجان' },
  { en: 'Najm Al Bahar', ar: 'نجم البحر' },
  { en: 'Al Shurooq', ar: 'الشروق' },
  { en: 'Golden Reef', ar: 'الشعاب الذهبية' },
  { en: 'Al Nawras', ar: 'النورس' },
  { en: 'Silver Wave', ar: 'الموجة الفضية' },
  { en: 'Al Dana', ar: 'الدانة' },
  { en: 'Horizon', ar: 'الأفق' },
  { en: 'Al Sanbouk', ar: 'السنبوك' },
  { en: 'Seven Seas', ar: 'البحار السبعة' },
  { en: 'Al Jazeera', ar: 'الجزيرة' },
  { en: 'Dolphin Point', ar: 'نقطة الدلفين' },
  { en: 'Al Marsa', ar: 'المرسى' },
  { en: 'Turquoise', ar: 'الفيروز' },
  { en: 'Al Bahriya', ar: 'البحرية' },
  { en: 'Sea Falcon', ar: 'صقر البحر' },
  { en: 'Anchor Point', ar: 'نقطة المرساة' },
  { en: 'Blue Horizon', ar: 'الأفق الأزرق' },
  { en: 'Al Lulu', ar: 'اللؤلؤ' },
  { en: 'Gulf Breeze', ar: 'نسيم الخليج' },
  { en: 'Al Safina', ar: 'السفينة' },
  { en: 'Sunrise Harbour', ar: 'مرفأ الشروق' },
  { en: 'Al Mawj', ar: 'الموج' },
  { en: 'Coral Crown', ar: 'تاج المرجان' },
  { en: 'Al Bandar', ar: 'البندر' },
  { en: 'Desert Pearl', ar: 'لؤلؤة الصحراء' },
  { en: 'Al Shiraa', ar: 'الشراع' },
  { en: 'Moonlight Bay', ar: 'خليج ضوء القمر' },
  { en: 'Al Hayat', ar: 'الحياة' },
  { en: 'Palm Shore', ar: 'شاطئ النخيل' },
  { en: 'Al Thuraya', ar: 'الثريا' },
  { en: 'Emerald Tide', ar: 'المد الزمردي' },
  { en: 'Al Fanar', ar: 'الفنار' },
  { en: 'Royal Reef', ar: 'الشعاب الملكية' },
  { en: 'Al Rimal', ar: 'الرمال' },
];

/** Per trade: the English suffix and the Arabic template, which puts the place word inside. */
const NAME_FORMS: Record<FakeTrade, { en: string; ar: (w: string) => string }[]> = {
  boat: [
    { en: 'Yacht Charters', ar: (w) => `${w} لتأجير اليخوت` },
    { en: 'Sea Tours', ar: (w) => `${w} للرحلات البحرية` },
    { en: 'Boat Trips', ar: (w) => `رحلات ${w} البحرية` },
    { en: 'Marine Tourism Co.', ar: (w) => `شركة ${w} للسياحة البحرية` },
  ],
  diver: [
    { en: 'Divers', ar: (w) => `غواصو ${w}` },
    { en: 'Dive Centre', ar: (w) => `مركز ${w} للغوص` },
    { en: 'Scuba Club', ar: (w) => `نادي ${w} للغوص` },
  ],
  marina: [
    { en: 'Marina', ar: (w) => `مرسى ${w}` },
    { en: 'Yacht Club', ar: (w) => `نادي ${w} لليخوت` },
    { en: 'Harbour Co.', ar: (w) => `شركة ميناء ${w}` },
  ],
  fuel: [
    { en: 'Marine Fuels', ar: (w) => `${w} للوقود البحري` },
    { en: 'Bunkering Co.', ar: (w) => `شركة ${w} لتزويد الوقود` },
    { en: 'Fuel Services', ar: (w) => `${w} لخدمات الوقود` },
  ],
  maintenance: [
    { en: 'Marine Workshop', ar: (w) => `ورشة ${w} البحرية` },
    { en: 'Boat Services', ar: (w) => `${w} لخدمات القوارب` },
    { en: 'Marine Engineering', ar: (w) => `${w} للهندسة البحرية` },
  ],
};

function businessName(trade: FakeTrade) {
  const word = pick(NAME_WORDS);
  const form = pick(NAME_FORMS[trade]);
  return { en: `${word.en} ${form.en}`, ar: form.ar(word.ar) };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30);

// ── registration numbers ────────────────────────────────────────────────────

/** Issuing-office prefixes a real CR starts with — Riyadh, Jeddah, Dammam, Makkah, Madinah, Tabuk, Jazan. */
const CR_PREFIXES = ['1010', '4030', '2050', '4031', '4650', '3550', '5900', '2051', '4700'];
const crNumber = () => `${pick(CR_PREFIXES)}${digits(6)}`;
/** ZATCA VAT numbers are 15 digits and begin and end with 3. */
const vatNumber = () => `3${digits(13)}3`;

// ── bank ────────────────────────────────────────────────────────────────────

/** ISO 13616 mod-97 of a numeric string, done in chunks so it never overflows. */
function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

/**
 * A Saudi IBAN that passes the checksum: `SA`, two check digits, a two-digit
 * bank code from the known table, then eighteen account digits.
 */
export function fakeSaudiIban(bankCode = pick(Object.keys(SAUDI_BANKS))): string {
  const bban = `${bankCode}${digits(18)}`;
  // Check digits are computed over BBAN + "SA00", with S=28 and A=10.
  const check = String(98 - mod97(`${bban}281000`)).padStart(2, '0');
  return `SA${check}${bban}`;
}

function bank(holder: string): FakeBank {
  const code = pick(Object.keys(SAUDI_BANKS));
  const info = SAUDI_BANKS[code];
  return { bankName: info.nameEn, accountHolderName: holder, iban: fakeSaudiIban(code), swiftCode: info.swift };
}

// ── hours ───────────────────────────────────────────────────────────────────

/** 0 = Sunday. The common Gulf working weeks, plus the every-day one. */
const WEEKS = [
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3, 4, 6],
  [6, 0, 1, 2, 3, 4],
  [0, 1, 2, 3, 4, 5, 6],
  [0, 1, 2, 3, 4, 5],
];

function hours(trade: FakeTrade): FakeHours {
  // A fuel dock is the one trade where round-the-clock is common.
  const open24h = chance(trade === 'fuel' ? 0.35 : 0.12);
  return {
    workingDays: [...pick(WEEKS)].sort((a, b) => a - b),
    open24h,
    openTime: pick(['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00']),
    closeTime: pick(['17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00']),
  };
}

// ── prose ───────────────────────────────────────────────────────────────────

const VHF_WORKING = [9, 12, 14, 67, 68, 69, 71, 72, 73, 77];
const vhf = () => {
  const ch = pick(VHF_WORKING);
  return chance(0.5) ? `Ch 16 / ${ch}` : `Ch ${ch}`;
};

const OFFER_EN: Record<FakeTrade, string[]> = {
  boat: ['sunset cruises, fishing trips and private yacht charters', 'island hopping, snorkelling day trips and family cruises', 'luxury yacht charters for events and corporate groups'],
  diver: ['guided reef dives, PADI courses and night dives', 'discover-scuba sessions, wreck dives and snorkelling trips', 'boat dives to offshore reefs and certification courses'],
  marina: ['wet berths, dry storage, fuel and shore power', 'monthly and annual berths with water, power and security', 'visitor berths, a chandlery and a waterfront lounge'],
  fuel: ['diesel and petrol at the dock and by delivery boat', 'on-dock fuelling and scheduled bunkering for fleets', 'marine diesel, lubricants and emergency fuel delivery'],
  maintenance: ['engine servicing, hull cleaning and electrical repairs', 'outboard and inboard repairs, antifouling and detailing', 'mobile technicians, haul-out work and annual surveys'],
};
const OFFER_AR: Record<FakeTrade, string[]> = {
  boat: ['رحلات الغروب ورحلات الصيد وتأجير اليخوت الخاصة', 'التنقل بين الجزر ورحلات الغطس السطحي والرحلات العائلية', 'تأجير اليخوت الفاخرة للمناسبات والشركات'],
  diver: ['غوص مرشد في الشعاب المرجانية ودورات PADI والغوص الليلي', 'تجارب الغوص للمبتدئين وغوص حطام السفن ورحلات السنوركل', 'رحلات غوص بالقارب إلى الشعاب البعيدة ودورات الشهادات'],
  marina: ['مراسٍ مائية وتخزين جاف ووقود وكهرباء', 'مراسٍ شهرية وسنوية مع الماء والكهرباء والحراسة', 'مراسٍ للزوار ومتجر مستلزمات بحرية وصالة على الواجهة البحرية'],
  fuel: ['الديزل والبنزين على الرصيف وبقارب التوصيل', 'التزويد على الرصيف والتزويد المجدول للأساطيل', 'الديزل البحري والزيوت وتوصيل الوقود الطارئ'],
  maintenance: ['صيانة المحركات وتنظيف الهياكل والإصلاحات الكهربائية', 'إصلاح المحركات الخارجية والداخلية والطلاء المضاد للحشف', 'فنيون متنقلون وأعمال الرفع والفحوصات السنوية'],
};

/** So the Arabic description names the town in Arabic too. */
const CITY_AR: Record<string, string> = {
  Jeddah: 'جدة', 'King Abdullah Economic City': 'مدينة الملك عبدالله الاقتصادية', Yanbu: 'ينبع', Umluj: 'أملج',
  'Al Wajh': 'الوجه', Dammam: 'الدمام', 'Al Khobar': 'الخبر', 'Al Jubail': 'الجبيل', Jazan: 'جازان',
  Farasan: 'فرسان', 'Al Lith': 'الليث', Dubai: 'دبي', 'Abu Dhabi': 'أبوظبي', 'Ras Al Khaimah': 'رأس الخيمة',
  Fujairah: 'الفجيرة', Doha: 'الدوحة', 'Kuwait City': 'مدينة الكويت', Manama: 'المنامة', Muscat: 'مسقط',
  Hurghada: 'الغردقة', Aqaba: 'العقبة',
};

function description(trade: FakeTrade, name: { en: string; ar: string }, place: FakeLocation) {
  const years = int(3, 25);
  // The Arabic is first person and gives a founding year rather than a count of
  // years: a business name can be masculine (مرسى، نادي) or feminine (شركة،
  // ورشة), and 3–10 take a different plural (أعوام) from 11+ (عاماً), so a
  // "تعمل X منذ N عاماً" template was wrong for most of what it produced.
  const since = new Date().getFullYear() - years;
  return {
    en: `${name.en} has operated from ${place.name}, ${place.city} for ${years} years, offering ${pick(OFFER_EN[trade])}. Our team is licensed, bilingual and on call seven days a week.`,
    ar: `${name.ar}: نعمل في ${CITY_AR[place.city] ?? place.city} منذ عام ${since}، ونقدم ${pick(OFFER_AR[trade])}. فريقنا مرخص ويتحدث العربية والإنجليزية ومتاح طوال أيام الأسبوع.`,
  };
}

function procedures(trade: FakeTrade, channel: string) {
  const coastguard = channel.includes('16') ? 'VHF Ch 16' : `VHF ${channel} and Ch 16`;
  return pick([
    `In an emergency call the duty manager, then raise the coastguard on ${coastguard}. Fire extinguishers and first-aid kits are at every pontoon head; the muster point is the main car park.`,
    `Report injuries to the duty officer immediately. A defibrillator is kept at reception, life rings hang every 30 metres along the quay, and the evacuation route is marked in green.`,
    trade === 'fuel'
      ? `Stop all fuelling, hit the emergency pump cut-off and call 911. Spill kits and foam extinguishers are at every dispenser. Staff muster at the main gate and account for every customer.`
      : `Sound the alarm, call 911 and the coastguard on ${coastguard}. First-aid kits are in the office and on every vessel. Staff muster at the main gate and account for every guest.`,
  ]);
}

// ── the whole business ──────────────────────────────────────────────────────

/**
 * One coherent sample provider: the name, the town, the phone's country code,
 * the bank holder and the description all describe the same business.
 */
export function fakeProvider(opts: { trade: FakeTrade; country?: string }): FakeProvider {
  const { trade } = opts;
  const place = location(opts.country);
  const name = businessName(trade);
  const person = personName();
  const channel = vhf();
  const desc = description(trade, name, place);
  return {
    personName: person,
    businessNameEn: name.en,
    businessNameAr: name.ar,
    mobile: fakeMobile(place.country),
    crNumber: crNumber(),
    vatNumber: vatNumber(),
    website: `https://www.${slug(name.en)}.sa`,
    vhfChannel: channel,
    location: place,
    descriptionEn: desc.en,
    descriptionAr: desc.ar,
    bank: bank(name.en),
    hours: hours(trade),
    emergencyPerson: personName(),
    emergencyPhone: fakeMobile(place.country),
    emergencyProcedures: procedures(trade, channel),
  };
}
