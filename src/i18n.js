import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en/translation.json'
import de from './locales/de/translation.json'
import zh from './locales/zh/translation.json'
import ko from './locales/ko/translation.json'
import ja from './locales/ja/translation.json'
import ru from './locales/ru/translation.json'
import es from './locales/es/translation.json'
import fr from './locales/fr/translation.json'

// Each language is shown in its own name so users can always find theirs.
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'ja', name: '日本語' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' }
]
const CODES = LANGUAGES.map(l => l.code)
const STORAGE_KEY = 'zuigo-language'

function initialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && CODES.includes(saved)) return saved
  } catch { /* storage blocked: ignore */ }
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return CODES.includes(browser) ? browser : 'en'
}

export function saveLanguage(code) {
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en }, de: { translation: de }, zh: { translation: zh }, ko: { translation: ko },
    ja: { translation: ja }, ru: { translation: ru }, es: { translation: es }, fr: { translation: fr }
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  keySeparator: false,          // our keys are flat, e.g. "buttons.services"
  interpolation: { escapeValue: false }
})

export default i18n
