// Builds src/locales/<lang>/translation.json (flat keys) from
//   scripts/i18n/en.flat.json  (English source)
//   scripts/i18n/translations/<lang>.json  (one file per language)
// Run:  npm run i18n:build
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const LANGS = ['en', 'de', 'zh', 'ko', 'ja', 'ru', 'es', 'fr']
const en = JSON.parse(fs.readFileSync(path.join(here, 'en.flat.json'), 'utf8'))

for (const lang of LANGS) {
  const data = lang === 'en' ? en : JSON.parse(fs.readFileSync(path.join(here, 'translations', `${lang}.json`), 'utf8'))
  const out = {}
  for (const key of Object.keys(en)) out[key] = data[key]   // same key order as English
  const dir = path.join(root, 'src/locales', lang)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'translation.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`wrote src/locales/${lang}/translation.json (${Object.keys(out).length} keys)`)
}
