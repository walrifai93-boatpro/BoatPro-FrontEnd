import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import ts from 'typescript'
import path from 'node:path'

const TRANSLATABLE_PROPS = new Set([
  'alt', 'aria-description', 'aria-label', 'aria-roledescription', 'caption',
  'confirmLabel', 'description', 'emptyLabel', 'helperText', 'label', 'placeholder',
  'searchPlaceholder', 'sub', 'title',
])

const JSX_ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", bull: '•', copy: '©', hellip: '…', lt: '<', mdash: '—',
  middot: '·', nbsp: ' ', ndash: '–', quot: '"', reg: '®', times: '×', gt: '>',
}

function decodeJsxEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      try { return String.fromCodePoint(code) } catch { return entity }
    }
    return JSX_ENTITIES[name] ?? entity
  })
}

/** Apply React's JSX whitespace rules before replacing a text node. */
function normalizeJsxText(raw: string): string {
  const lines = decodeJsxEntities(raw).split(/\r\n|\n|\r/)
  let last = lines.length - 1
  while (last >= 0 && !lines[last].trim()) last--
  let result = ''
  for (let index = 0; index <= last; index++) {
    let line = lines[index]
    if (index !== 0) line = line.replace(/^\s+/, '')
    if (index !== last) line = line.replace(/\s+$/, '')
    if (line) result += line + (index !== last ? ' ' : '')
  }
  return result
}

function insideLiteralBlock(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) {
      const opening = ts.isJsxElement(parent) ? parent.openingElement : parent
      const tag = ts.isIdentifier(opening.tagName) ? opening.tagName.text.toLowerCase() : ''
      if (['code', 'pre', 'script', 'style', 'textarea'].includes(tag)) return true
    }
  }
  return false
}

function portalArabicCatalogPlugin() {
  return {
    name: 'boatpro-portal-arabic-catalog',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const filename = id.split('?')[0]
      if (!filename.endsWith('.tsx') || filename.includes(`${path.sep}node_modules${path.sep}`)) return null

      const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const edits: { start: number; end: number; value: string }[] = []
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && !insideLiteralBlock(node)) {
          const text = normalizeJsxText(node.text)
          if (text.trim()) edits.push({
            start: node.getStart(source), end: node.getEnd(),
            value: `{__boatproText(${JSON.stringify(text)})}`,
          })
        } else if (
          ts.isJsxAttribute(node) &&
          TRANSLATABLE_PROPS.has(node.name.getText(source)) &&
          node.initializer && ts.isStringLiteral(node.initializer)
        ) {
          const value = decodeJsxEntities(node.initializer.text)
          edits.push({
            start: node.initializer.getStart(source), end: node.initializer.getEnd(),
            value: `{__boatproText(${JSON.stringify(value)})}`,
          })
        } else if (ts.isNewExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const owner = ts.isIdentifier(node.expression.expression) ? node.expression.expression.text : ''
          const formatter = node.expression.name.text
          if (owner === 'Intl' && ['DateTimeFormat', 'NumberFormat'].includes(formatter)) {
            const localeArg = node.arguments?.[0]
            const isEnglishLocale = localeArg && ts.isStringLiteral(localeArg) && /^en(?:-|$)/i.test(localeArg.text)
            const isBrowserLocale = !localeArg || ts.isIdentifier(localeArg) && localeArg.text === 'undefined'
            if (isEnglishLocale || isBrowserLocale) {
              edits.push(localeArg
                ? { start: localeArg.getStart(source), end: localeArg.getEnd(), value: '__boatproLocale()' }
                : { start: node.arguments?.pos ?? node.expression.end, end: node.arguments?.pos ?? node.expression.end, value: '__boatproLocale()' })
            }
          }
        } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text
          if (['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'].includes(method)) {
            const localeArg = node.arguments[0]
            const mayUseBrowserLocale = !localeArg ||
              ts.isStringLiteral(localeArg) ||
              (ts.isArrayLiteralExpression(localeArg) && localeArg.elements.length === 0) ||
              (ts.isIdentifier(localeArg) && localeArg.text === 'undefined')
            if (mayUseBrowserLocale) {
              edits.push(localeArg
                ? { start: localeArg.getStart(source), end: localeArg.getEnd(), value: '__boatproLocale()' }
                : { start: node.arguments.pos, end: node.arguments.pos, value: '__boatproLocale()' })
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      if (!edits.length) return null

      let transformed = code
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        transformed = transformed.slice(0, edit.start) + edit.value + transformed.slice(edit.end)
      }
      const fromDir = path.dirname(filename)
      let importPath = path.relative(fromDir, path.resolve(process.cwd(), 'src/i18n/runtime.ts')).replace(/\\/g, '/')
      if (!importPath.startsWith('.')) importPath = `./${importPath}`
      transformed = `import { translatePortalStaticText as __boatproText, portalLocale as __boatproLocale } from ${JSON.stringify(importPath)};\n${transformed}`
      return { code: transformed, map: null }
    },
  }
}

export default defineConfig({
  plugins: [portalArabicCatalogPlugin(), react()],
  // Relative asset URLs: the portal uses HashRouter, so the page itself is
  // always the folder's index.html and it can be hosted under any subpath
  // (e.g. boatpro.club/Admin/) as well as at a domain root.
  base: './',
  server: { port: 5199 },
})
