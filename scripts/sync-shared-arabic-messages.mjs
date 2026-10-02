import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')
const roots = ['boatpro-provider', 'boatpro']
const translations = Object.create(null)

function pairStrings(english, arabic) {
  for (const [key, value] of Object.entries(english ?? {})) {
    const translated = arabic?.[key]
    if (typeof value === 'string' && typeof translated === 'string' && value !== translated) {
      // The provider app is first because its wording is closer to the portal.
      if (!translations[value] || translations[value] === value) translations[value] = translated
    } else if (value && typeof value === 'object' && translated && typeof translated === 'object') {
      pairStrings(value, translated)
    }
  }
}

for (const app of roots) {
  const englishDir = path.join(repoRoot, app, 'src/i18n/locales/en')
  const arabicDir = path.join(repoRoot, app, 'src/i18n/locales/ar')
  if (!fs.existsSync(englishDir) || !fs.existsSync(arabicDir)) continue

  for (const filename of fs.readdirSync(englishDir).filter(name => name.endsWith('.json'))) {
    const english = JSON.parse(fs.readFileSync(path.join(englishDir, filename), 'utf8'))
    const arabic = JSON.parse(fs.readFileSync(path.join(arabicDir, filename), 'utf8'))
    pairStrings(english, arabic)
  }
}

const output = `// Generated from BoatPro's reviewed English and Arabic app catalogs.\n// Run node marina-portal/scripts/sync-shared-arabic-messages.mjs from the repository root to refresh it.\nexport const SHARED_ARABIC_MESSAGES: Record<string, string> = ${JSON.stringify(translations, null, 2)};\n`
const outputPath = path.join(repoRoot, 'marina-portal/src/i18n/sharedMessages.ts')
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, output)
console.log(`Wrote ${Object.keys(translations).length} Arabic phrases to ${path.relative(repoRoot, outputPath)}`)
