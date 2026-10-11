/**
 * Canonical vessel/trip taxonomy — hand-mirrored from boatpro-backend.
 *
 * There is no shared package between boatpro-backend, boatpro-provider, boatpro
 * and marina-portal, so this file must stay in sync (same keys/labels) with:
 *   - boatpro-backend/src/constants/vesselTaxonomy.ts (source of truth)
 *   - boatpro-provider/src/constants/vesselTaxonomy.ts
 *   - boatpro/src/constants/vesselTaxonomy.ts
 * `icon` here holds lucide-react component names (this app's icon set) rather
 * than the Ionicons names used by the other two mirrors.
 */

export interface TaxonomyEntry {
  key: string;
  labelEn: string;
  labelAr: string;
  icon: string;
}

export const BOAT_CATEGORIES: TaxonomyEntry[] = [
  { key: 'sailing_boat', labelEn: 'Sailing Boat', labelAr: 'قارب شراعي', icon: 'Sailboat' },
  { key: 'motorboat', labelEn: 'Motorboat', labelAr: 'قارب بموتور', icon: 'Zap' },
  { key: 'yacht', labelEn: 'Yacht', labelAr: 'يخت', icon: 'Ship' },
  { key: 'jet_ski', labelEn: 'Jet Ski', labelAr: 'جت سكي', icon: 'Gauge' },
  { key: 'car_jet', labelEn: 'Car Jet', labelAr: 'كار جت', icon: 'Car' },
  { key: 'sports_jet_boat', labelEn: 'Sports Jet Boat', labelAr: 'قارب جت رياضي', icon: 'Rocket' },
  { key: 'floating_restaurant', labelEn: 'Floating Restaurant', labelAr: 'مطعم عائم', icon: 'UtensilsCrossed' },
  { key: 'water_bus', labelEn: 'Water Bus', labelAr: 'باص مائي', icon: 'Bus' },
  { key: 'cruise_ship', labelEn: 'Cruise Ship', labelAr: 'سفينة كروز', icon: 'Ship' },
  { key: 'other', labelEn: 'Other', labelAr: 'أخرى', icon: 'MoreHorizontal' },
];

export const TRIP_TYPES: TaxonomyEntry[] = [
  { key: 'leisure', labelEn: 'Leisure / Sightseeing Trips', labelAr: 'رحلات نزهة وجولات بحرية', icon: 'Sun' },
  { key: 'fishing', labelEn: 'Fishing Trips', labelAr: 'رحلات صيد بحري', icon: 'Fish' },
  { key: 'diving', labelEn: 'Diving Trips', labelAr: 'رحلات غوص واستكشاف الأعماق', icon: 'Waves' },
  { key: 'snorkeling', labelEn: 'Snorkeling Trips', labelAr: 'رحلات سنوركلينج وشعب مرجانية', icon: 'Eye' },
  { key: 'sunset_cruise', labelEn: 'Sunset Cruise', labelAr: 'رحلات غروب الشمس', icon: 'Sunset' },
  { key: 'island_hopping', labelEn: 'Island Hopping Trips', labelAr: 'رحلات جزر واستكشاف', icon: 'Navigation' },
  { key: 'water_sports', labelEn: 'Water Sports Trips', labelAr: 'رحلات رياضة مائية وأنشطة', icon: 'Dumbbell' },
  { key: 'water_taxi', labelEn: 'Maritime Transport / Water Taxi', labelAr: 'نقل وتوصيل بحري', icon: 'ArrowLeftRight' },
  { key: 'dining', labelEn: 'Dining / Restaurant Trips', labelAr: 'رحلات عشاء ومطاعم عائمة', icon: 'UtensilsCrossed' },
  { key: 'party_event', labelEn: 'Celebrations & Private Events', labelAr: 'حفلات ومناسبات خاصة', icon: 'Sparkles' },
  { key: 'stargazing', labelEn: 'Night Cruise & Stargazing', labelAr: 'رحلات ليلية ومراقبة النجوم', icon: 'Moon' },
  { key: 'dolphin_safari', labelEn: 'Dolphin Watching & Marine Safari', labelAr: 'مشاهدة الدلافين وسفاري بحري', icon: 'Heart' },
  { key: 'bbq_beach', labelEn: 'Beach Landing & Island BBQ', labelAr: 'إنزال شاطئي وحفلات شواء', icon: 'Flame' },
  { key: 'speed_adventure', labelEn: 'Speed & Adrenaline Tour', labelAr: 'مغامرة وإثارة وسرعة قصوى', icon: 'Zap' },
  { key: 'family_fun', labelEn: 'Family & Kids Cruise', labelAr: 'رحلات عائلية وأطفال', icon: 'Users' },
  { key: 'historical_coastal', labelEn: 'Coastal Heritage & Culture', labelAr: 'رحلات تراثية وثقافية', icon: 'Landmark' },
  { key: 'overnight_camp', labelEn: 'Overnight & Boat Camping', labelAr: 'مبيت وتخييم بحري', icon: 'Tent' },
  { key: 'photography', labelEn: 'Marine Photography & Drone', labelAr: 'جولات تصوير فوتوغرافي', icon: 'Camera' },
  { key: 'business_vip', labelEn: 'VIP & Corporate Charters', labelAr: 'رحلات رجال أعمال وVIP', icon: 'Crown' },
  { key: 'travel_recreation', labelEn: 'Travel & Recreation Trips', labelAr: 'رحلات سفر وترفيه ممتد', icon: 'Compass' },
  { key: 'other', labelEn: 'Other', labelAr: 'أخرى', icon: 'MoreHorizontal' },
];

export const BOAT_STATUSES: TaxonomyEntry[] = [
  { key: 'active', labelEn: 'Active', labelAr: 'نشط', icon: 'CheckCircle2' },
  { key: 'busy', labelEn: 'Busy', labelAr: 'مشغول', icon: 'Clock' },
  { key: 'available', labelEn: 'Available', labelAr: 'متاح', icon: 'Circle' },
  { key: 'maintenance', labelEn: 'Under Maintenance', labelAr: 'تحت الصيانة', icon: 'Wrench' },
  { key: 'out_of_service', labelEn: 'Out of Service', labelAr: 'خارج الخدمة', icon: 'XCircle' },
];

export const PRICING_MODELS: TaxonomyEntry[] = [
  { key: 'hourly', labelEn: 'Hourly Rate', labelAr: 'أجرة الرحلة بالساعة', icon: 'Clock' },
  { key: 'per_person', labelEn: 'Per Person Rate', labelAr: 'أجرة بالشخص', icon: 'User' },
  { key: 'package', labelEn: 'Package Rate (Bundled)', labelAr: 'أجرة بالبرنامج (البكج)', icon: 'Package' },
  { key: 'per_ticket', labelEn: 'Per-Ticket Rate (Per Person)', labelAr: 'أجرة بالتذكرة للشخص', icon: 'Ticket' },
];

export const BOAT_CATEGORY_KEYS = BOAT_CATEGORIES.map((c) => c.key);
export const TRIP_TYPE_KEYS = TRIP_TYPES.map((t) => t.key);
export const BOAT_STATUS_KEYS = BOAT_STATUSES.map((s) => s.key);
export const PRICING_MODEL_KEYS = PRICING_MODELS.map((p) => p.key);
