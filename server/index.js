const express = require('express')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = Number(process.env.PORT || 3001)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const MAX_MESSAGE_LENGTH = 2000
const MAX_HISTORY_MESSAGES = 6

// Minimal .env loader so the project does not require an extra dotenv dependency.
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env')
  if (!fs.existsSync(envPath)) return
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || process.env[match[1]] !== undefined) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[match[1]] = value
  }
}
loadEnv()

app.disable('x-powered-by')
app.use(helmet())
app.use(express.json({ limit: '32kb' }))
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }))
app.use('/api/chat', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }))

const ALLOWED_LANGUAGES = new Set(['en', 'de', 'zh', 'ko', 'ja', 'ru', 'es', 'fr'])
const csrfTokens = new Set()

app.get('/api/health', (_, res) => res.json({ ok: true, chatConfigured: true, geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY) }))
app.get('/api/csrf', (_, res) => {
  const token = crypto.randomBytes(24).toString('hex')
  csrfTokens.add(token)
  setTimeout(() => csrfTokens.delete(token), 10 * 60 * 1000).unref?.()
  res.json({ token })
})

// Preserve the existing lead endpoint; actual email delivery still requires a provider.
const uploadDir = path.join(__dirname, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })
const multer = require('multer')
const allowedTypes = new Set([
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_, file, cb) => cb(null, allowedTypes.has(file.mimetype))
})
app.post('/api/lead', upload.single('file'), (req, res) => {
  const token = req.get('x-csrf-token')
  if (!token || !csrfTokens.has(token)) return res.status(403).json({ error: 'Invalid CSRF token.' })
  const { name, email, message } = req.body
  if (![name, email, message].every(v => typeof v === 'string' && v.trim())) return res.status(400).json({ error: 'Name, email and message are required.' })
  if (name.length > 150 || email.length > 254 || message.length > 5000) return res.status(400).json({ error: 'One or more fields are too long.' })
  return res.status(501).json({ error: 'Lead delivery is not configured yet. Please use the official ZuiGO contact page.' })
})

let chatModulePromise
function getChatModule() {
  if (!chatModulePromise) chatModulePromise = import('./rag-chat.mjs')
  return chatModulePromise
}

app.post('/api/chat', async (req, res) => {
  const { message, history, language } = req.body || {}
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Please enter a question.' })
  if (message.length > MAX_MESSAGE_LENGTH) return res.status(413).json({ error: `Questions must be ${MAX_MESSAGE_LENGTH} characters or fewer.` })
  if (!Array.isArray(history)) return res.status(400).json({ error: 'History must be an array.' })
  if (history.length > MAX_HISTORY_MESSAGES) return res.status(400).json({ error: `Send no more than ${MAX_HISTORY_MESSAGES} previous messages.` })
  const safeHistory = []
  for (const item of history) {
    if (!item || !['user', 'assistant', 'bot'].includes(item.role) || typeof item.text !== 'string') continue
    safeHistory.push({ role: item.role === 'bot' ? 'assistant' : item.role, text: item.text.slice(0, 2000) })
  }
  const lang = typeof language === 'string' && ALLOWED_LANGUAGES.has(language) ? language : 'en'
  try {
    const chat = await getChatModule()
    const result = await chat.answerWithRag({ message: message.trim(), history: safeHistory.slice(-MAX_HISTORY_MESSAGES), language: lang })
    return res.json(result)
  } catch (error) {
    // Keep detailed diagnostics in the server terminal, but never expose secrets to the browser.
    const message = String(error?.message || 'Unknown error')
    console.error('Chat request failed:', message)
    const isUnavailable = /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|temporarily unavailable|quota/i.test(message)
    const userMessage = isUnavailable
      ? 'Gemini is temporarily busy or rate-limited. Please try again in a few seconds.'
      : 'I could not safely answer right now. Please try again or contact ZuiGO through its official website.'
    return res.status(isUnavailable ? 503 : 502).json({ error: userMessage })
  }
})

app.listen(PORT, () => {
  console.log(`ZuiGO chatbot backend running on http://localhost:${PORT}`)
  getChatModule().then(m => m.warmUp())
})
