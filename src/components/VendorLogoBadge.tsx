import React from 'react';
import { fileUrl } from '../api';
import { translatePortalText } from '../i18n/runtime';

export type VendorRoleType = 'boat_provider' | 'marina_provider' | 'fuel_provider' | 'maintenance_provider' | 'customer' | 'general';

interface VendorLogoBadgeProps {
  logoUrl?: string | null;
  name?: string;
  role?: VendorRoleType;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showName?: boolean;
  subText?: string;
  className?: string;
  contrast?: boolean; // If on dark backdrop
}

const SIZE_CONFIG = {
  xs: { box: 'h-5 w-5 rounded-md text-[9px]', img: 'h-3.5 w-3.5', text: 'text-xs' },
  sm: { box: 'h-7 w-7 rounded-lg text-[11px]', img: 'h-5 w-5', text: 'text-xs font-bold' },
  md: { box: 'h-9 w-9 rounded-xl text-xs', img: 'h-6 w-6', text: 'text-sm font-bold' },
  lg: { box: 'h-12 w-12 rounded-2xl text-sm font-black', img: 'h-8 w-8', text: 'text-base font-extrabold' },
  xl: { box: 'h-16 w-16 rounded-2xl text-lg font-black', img: 'h-11 w-11', text: 'text-lg font-black' },
};

const GRADIENTS: Record<VendorRoleType, string> = {
  boat_provider: 'from-emerald-500 to-teal-600 text-white',
  marina_provider: 'from-sky-500 to-blue-600 text-white',
  fuel_provider: 'from-amber-500 to-orange-600 text-white',
  maintenance_provider: 'from-violet-500 to-indigo-600 text-white',
  customer: 'from-slate-500 to-slate-700 text-white',
  general: 'from-ocean-500 to-deep-900 text-white',
};

function getInitials(name?: string): string {
  if (!name || !name.trim()) return '⚓';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function VendorLogoBadge({
  logoUrl,
  name = '',
  role = 'general',
  size = 'md',
  showName = false,
  subText,
  className = '',
  contrast = false,
}: VendorLogoBadgeProps) {
  const cfg = SIZE_CONFIG[size];
  const gradient = GRADIENTS[role] || GRADIENTS.general;

  const badgeEl = logoUrl ? (
    <div
      className={`relative grid ${cfg.box} shrink-0 place-items-center overflow-hidden border shadow-2xs transition hover:scale-105 ${
        contrast
          ? 'bg-white/10 backdrop-blur-md border-white/20'
          : 'bg-white dark:bg-slate-800 border-slate-200/80 dark:border-slate-700'
      }`}
      title={name}
    >
      <img
        src={fileUrl(logoUrl)}
        alt={name}
        className={`${cfg.img} object-contain`}
        onError={(e) => {
          // If image fails to load, hide image and show initials
          (e.target as HTMLElement).style.display = 'none';
        }}
      />
    </div>
  ) : (
    <div
      className={`grid ${cfg.box} shrink-0 place-items-center font-black bg-gradient-to-br ${gradient} shadow-2xs border border-white/20 select-none transition hover:scale-105`}
      title={name}
    >
      {getInitials(name)}
    </div>
  );

  if (!showName) {
    return <div className={`inline-flex items-center ${className}`}>{badgeEl}</div>;
  }

  return (
    <div className={`inline-flex items-center gap-2.5 min-w-0 ${className}`}>
      {badgeEl}
      <div className="min-w-0 flex-1">
        <p className={`truncate leading-tight ${cfg.text} ${contrast ? 'text-white' : 'text-deep-900 dark:text-white'}`}>
          {name || translatePortalText('Unknown Partner')}
        </p>
        {subText && (
          <p className={`truncate text-[10px] ${contrast ? 'text-slate-300' : 'text-slate-400'}`}>{subText}</p>
        )}
      </div>
    </div>
  );
}
