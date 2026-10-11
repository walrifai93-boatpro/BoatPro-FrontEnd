// One-off: render the apps' vector category logos (react-native-svg components
// in boatpro/src/components/icons) to plain .svg files the web admin can show,
// so "Vessel & Trip Types" lists the built-in types with the artwork providers
// and customers actually see.
//
//   node scripts/export-vessel-logos.mjs   (from marina-portal/)
//
// Re-run when a logo changes. Output:
//   public/vessel-logos/<vessel_category_key>.svg
//   public/trip-logos/<trip_type_key>.svg
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const portal = resolve(here, '..');
const iconsDir = resolve(portal, '../boatpro/src/components/icons').replace(/\\/g, '/');

const shims = {
  'react-native-svg': `
    import React from 'react';
    const el = (tag) => ({ children, style, ...p }) => React.createElement(tag, p, children);
    export default ({ children, style, ...p }) => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', ...p }, children);
    export const Path = el('path'); export const G = el('g'); export const Circle = el('circle');
    export const Rect = el('rect'); export const Ellipse = el('ellipse'); export const Polygon = el('polygon');
    export const Defs = el('defs'); export const Stop = el('stop'); export const LinearGradient = el('linearGradient');`,
  'react-native': `
    import React from 'react';
    export const View = ({ children }) => React.createElement(React.Fragment, null, children);`,
  // TripCategoryLogo reads the theme for its defaults and draws "Other" with an
  // Ionicon; neither matters for a light-mode export of the illustrated types.
  theme: `export const useTheme = () => ({ isDark: false, colors: {} });`,
  icon: `export const Ionicons = () => null;`,
};

// The keys each list ships with — mirrors constants/vesselTaxonomy.ts.
const TRIP_KEYS = [
  'leisure', 'fishing', 'diving', 'snorkeling', 'sunset_cruise', 'island_hopping', 'water_sports', 'water_taxi',
  'dining', 'party_event', 'stargazing', 'dolphin_safari', 'bbq_beach', 'speed_adventure', 'family_fun',
  'historical_coastal', 'overnight_camp', 'photography', 'business_vip', 'travel_recreation',
];

const entry = `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import * as L from '${iconsDir}/logos/index.ts';
  import { TripCategoryLogo } from '${iconsDir}/TripCategoryLogos.tsx';
  const VESSELS = {
    sailing_boat: L.SailingBoatLogo, motorboat: L.MotorboatLogo, yacht: L.YachtLogo, jet_ski: L.JetSkiLogo,
    car_jet: L.CarJetLogo, sports_jet_boat: L.SportJetLogo, floating_restaurant: L.FloatingRestaurantLogo,
    water_bus: L.WaterBusLogo, cruise_ship: L.CruiseShipLogo,
  };
  // The customer app's own palette (primary navy, secondary sky, white accent).
  const P = { size: 96, primary: '#013163', secondary: '#00A3FF', accent: '#FFFFFF' };
  const svg = (el) => renderToStaticMarkup(el);
  export const render = () => ({
    'vessel-logos': Object.fromEntries(Object.entries(VESSELS).map(([k, C]) => [k, svg(React.createElement(C, P))])),
    'trip-logos': Object.fromEntries(${JSON.stringify(TRIP_KEYS)}.map((k) => [k, svg(React.createElement(TripCategoryLogo, { ...P, name: k }))])),
  });`;

const result = await build({
  stdin: { contents: entry, resolveDir: portal, loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  nodePaths: [resolve(portal, 'node_modules')],
  // One React — the portal's — resolved at run time from node_modules.
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
  plugins: [{
    name: 'shims',
    setup(b) {
      b.onResolve({ filter: /^react-native(-svg)?$/ }, (a) => ({ path: a.path, namespace: 'shim' }));
      b.onResolve({ filter: /theme\/ThemeContext$/ }, () => ({ path: 'theme', namespace: 'shim' }));
      b.onResolve({ filter: /^\.\/Icon$/ }, () => ({ path: 'icon', namespace: 'shim' }));
      b.onLoad({ filter: /.*/, namespace: 'shim' }, (a) => ({ contents: shims[a.path], loader: 'jsx', resolveDir: portal }));
    },
  }],
});

const tmp = resolve(portal, 'node_modules/.cache/category-logos.mjs');
mkdirSync(dirname(tmp), { recursive: true });
writeFileSync(tmp, result.outputFiles[0].text);
const { render } = await import(pathToFileURL(tmp).href);
for (const [folder, files] of Object.entries(render())) {
  const outDir = resolve(portal, 'public', folder);
  mkdirSync(outDir, { recursive: true });
  for (const [key, markup] of Object.entries(files)) {
    if (!markup) { console.warn('skipped (no artwork):', folder, key); continue; }
    writeFileSync(resolve(outDir, `${key}.svg`), markup);
    console.log('wrote', `public/${folder}/${key}.svg`, markup.length, 'bytes');
  }
}
