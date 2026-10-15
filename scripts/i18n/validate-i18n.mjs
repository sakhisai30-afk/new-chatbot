// Checks every language against the English source. Exit code 1 on any problem.
// Run:  npm run i18n:validate
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const LANGS = ['de', 'zh', 'ko', 'ja', 'ru', 'es', 'fr']
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const en = read(path.join(here, 'en.flat.json'))

// Terms that must stay exactly as written (names, products, address, e-mail).
const PROTECTED = ['ZuiGO', 'React', 'Next.js', 'Node.js', 'Python', 'PostgreSQL', 'AWS', 'Docker', 'Kubernetes', 'Terraform',
  'PyTorch', 'LangChain', 'FastAPI', 'MLflow', 'Redis', 'Kafka', 'Grafana', 'Prometheus', 'GitHub Actions', 'Google',
  'Llama 3.2', 'Ollama', 'Vite', 'Express', 'HL7', 'FHIR', 'HIPAA', 'RAG', 'CI/CD', 'Cloudflare Turnstile',
  'hello@zuigo.ai', 'Runwal Platinum, NDA Pashan Road, Ram Nagar, Bavdhan, Pune, Maharashtra', '411021']
// Script check: text in these languages must actually contain characters of that script.
const SCRIPT = { zh: /[一-鿿]/, ja: /[぀-ヿ一-鿿]/, ko: /[가-힯]/, ru: /[Ѐ-ӿ]/ }
// Strings that may legitimately equal the English text (names / abbreviations).
const SAME_OK = new Set(['services.fintech.name', 'buttons.fintech', 'serviceTopics.projects', 'services.cloudDevops.name', 'buttons.cloudDevops'])

const placeholders = s => (s.match(/\{\{\s*\w+\s*\}\}/g) || []).map(x => x.replace(/\s/g, '')).sort().join(',')
const bullets = s => (s.match(/\n/g) || []).length

let problems = 0
const fail = (lang, key, msg) => { problems++; console.log(`✗ [${lang}] ${key}: ${msg}`) }

for (const lang of LANGS) {
  const tr = read(path.join(here, 'translations', `${lang}.json`))
  const built = path.join(root, 'src/locales', lang, 'translation.json')
  const keys = new Set(Object.keys(en))
  for (const k of Object.keys(tr)) if (!keys.has(k)) fail(lang, k, 'extra key not in English')
  for (const [key, src] of Object.entries(en)) {
    const v = tr[key]
    if (typeof v !== 'string' || !v.trim()) { fail(lang, key, 'missing or empty'); continue }
    if (/TEMP_ENGLISH_PLACEHOLDER|\bTODO\b|TRANSLATE_ME/.test(v)) fail(lang, key, 'placeholder text left in')
    if (placeholders(v) !== placeholders(src)) fail(lang, key, `placeholders differ: "${placeholders(src)}" vs "${placeholders(v)}"`)
    if (bullets(v) !== bullets(src)) fail(lang, key, 'line-break count differs from English')
    for (const term of PROTECTED) if (src.includes(term) && !v.includes(term)) fail(lang, key, `protected term changed/missing: "${term}"`)
    if (SCRIPT[lang] && !SCRIPT[lang].test(v)) fail(lang, key, `no ${lang} characters found`)
    if (v === src && !SAME_OK.has(key) && /[a-z]{4,}/i.test(src) && !/^[\w@.\s,–-]+$/.test(src.replace(/[A-Z]/g, 'A')) ) fail(lang, key, 'identical to English (not translated?)')
  }
  // The built app file must match the translation file exactly.
  if (!fs.existsSync(built)) fail(lang, '(file)', 'src/locales file missing - run npm run i18n:build')
  else {
    const b = read(built)
    for (const key of Object.keys(en)) if (b[key] !== tr[key]) { fail(lang, key, 'src/locales is out of date - run npm run i18n:build'); break }
  }
  console.log(`${lang}: checked ${keys.size} keys`)
}
console.log(problems ? `\n${problems} problem(s) found` : '\nAll languages passed: same keys, placeholders, line breaks, protected terms, correct script.')
process.exit(problems ? 1 : 0)
