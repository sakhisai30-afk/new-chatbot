import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import catalogue from './data/catalogue.json'
import flows from './data/flows.json'
import serviceDetails from './data/serviceDetails.json'
import { useTranslation } from 'react-i18next'
import i18n, { LANGUAGES, saveLanguage } from './i18n'
import './styles.css'

// Buttons are stored as IDs (never as English text) and translated when drawn,
// so switching language re-labels every button and message already on screen.
const BUTTON_IDS = {
  Services: 'services', Contact: 'contact', 'Contact ZuiGO': 'contactZuigo', 'Address / Location': 'addressLocation',
  Meeting: 'meeting', 'Technology Information': 'technologyInformation', 'About ZuiGO': 'aboutZuigo',
  Healthcare: 'healthcare', 'AI & Machine Learning': 'aiMl', Fintech: 'fintech',
  'Custom Software Development': 'customSoftware', 'Cloud & DevOps': 'cloudDevops',
  'Open Contact Page': 'openContactPage', 'Book a Free Consultation': 'bookFreeConsultation',
  'Book a Call': 'bookCall', 'Send a Message': 'sendMessage', 'View on Google Maps': 'viewOnGoogleMaps'
}
const ids = labels => (labels || []).map(l => BUTTON_IDS[l] || l)
const START_BUTTONS = ids(flows.start.buttons)
const SERVICE_BUTTONS = ids(flows.services.buttons)
const QUICK_MAP = {
  contact: 'contact', contactZuigo: 'contact', addressLocation: 'location', meeting: 'meeting',
  technologyInformation: 'tech-stack', aboutZuigo: 'about'
}
const SERVICE_KEY = { healthcare: 'healthcare', 'ai-ml': 'aiMl', fintech: 'fintech', 'custom-software': 'customSoftware', 'cloud-devops': 'cloudDevops' }
const BUTTON_FOR_SERVICE = Object.fromEntries(Object.entries(SERVICE_KEY).map(([id, key]) => [key, id]))
const ANSWER_KEY = {
  services: 'services', healthcare: 'healthcare', 'ai-ml': 'aiMl', fintech: 'fintech', 'custom-software': 'customSoftware',
  'cloud-devops': 'cloudDevops', about: 'about', 'tech-stack': 'technology', contact: 'contact', location: 'location',
  meeting: 'meeting', website: 'website'
}
const TOPICS = ['solutions', 'howWeDeliver', 'technologies', 'projects']
const TOPIC_BUTTONS = TOPICS.map(t => `topic.${t}`)
const LINKS = {
  openContactPage: 'https://zuigo.ai/contact',
  bookFreeConsultation: 'https://zuigo.ai/',
  bookCall: 'https://zuigo.ai/book',
  sendMessage: 'https://zuigo.ai/contact',
  viewOnGoogleMaps: 'https://www.google.com/maps/search/?api=1&query=Runwal%20Platinum%2C%20NDA%20Pashan%20Road%2C%20Ram%20Nagar%2C%20Bavdhan%2C%20Pune%2C%20Maharashtra%20411021'
}

function createMessage(role, content, extra = {}) {
  // content: { tk, tp } = translation key (+ params) shown in the current language,
  //          { text }   = free text coming from the AI backend (already in the chosen language)
  return { role, ...content, timestamp: new Date(), ...extra }
}

const startMessage = () => createMessage('bot', { tk: 'flows.start.message' }, { buttons: START_BUTTONS })
const servicesMessage = () => createMessage('bot', { tk: 'flows.services.message' }, { buttons: SERVICE_BUTTONS })

function App() {
  const { t } = useTranslation()
  const language = i18n.resolvedLanguage || i18n.language || 'en'
  const [messages, setMessages] = useState(() => [startMessage()])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const messagesRef = useRef(null)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const audioUrlsRef = useRef([])

  useEffect(() => { document.documentElement.lang = language }, [language])

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages, isTyping])

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(track => track.stop())
    audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
  }, [])

  const changeLanguage = (code) => {
    saveLanguage(code)
    i18n.changeLanguage(code)   // every message/button is stored as a key, so all of it re-renders in `code`
  }

  // Turn a stored message into the text shown in the current language.
  const messageText = (m) => {
    if (m.tk) {
      const params = { ...(m.tp || {}) }
      if (m.serviceKey) params.serviceName = t(`services.${m.serviceKey}.name`)
      return t(m.tk, params)
    }
    return m.text || ''
  }
  const buttonLabel = (id) => id.startsWith('topic.') ? t(`serviceTopics.${id.slice(6)}`) : t(`buttons.${id}`)

  const catalogueAnswer = (entry) => createMessage('bot', { tk: `answers.${ANSWER_KEY[entry.id]}.answer` }, {
    buttons: ids(entry.buttons),
    source: entry.source,
    preserveFormatting: entry.id === 'tech-stack'
  })

  const topicsPrompt = (service, serviceKey, extra = {}) => createMessage('bot', { tk: 'flows.topicsPrompt', serviceKey }, {
    buttons: TOPIC_BUTTONS, serviceId: service.id, source: service.source, ...extra
  })

  const handleChoice = async (id, context = {}) => {
    if (busy) return
    setBusy(true)
    setIsTyping(true)
    setMessages(m => [...m, createMessage('user', { tk: id.startsWith('topic.') ? `serviceTopics.${id.slice(6)}` : `buttons.${id}` })])

    let response
    const service = serviceDetails.find(item => item.id === context.serviceId)
    const serviceKey = service && SERVICE_KEY[service.id]
    if (id === 'services' || (service && id === 'backToServices')) {
      response = servicesMessage()
    } else if (service && id === 'backToTopics') {
      response = topicsPrompt(service, serviceKey, { promptQuestion: true })
    } else if (service) {
      const topic = id.startsWith('topic.') ? id.slice(6) : null
      response = createMessage('bot',
        topic ? { tk: `services.${serviceKey}.topics.${topic}` } : { tk: 'messages.serviceInformationUnavailable' }, {
        buttons: [...TOPIC_BUTTONS.filter(b => b !== id), 'backToTopics', 'backToServices'],
        serviceId: service.id,
        source: service.source,
        animateServiceAnswer: true
      })
    } else if (BUTTON_FOR_SERVICE[id]) {
      const selected = serviceDetails.find(item => item.id === BUTTON_FOR_SERVICE[id])
      response = topicsPrompt(selected, id, { promptLeadKey: `services.${id}.introduction`, promptQuestion: true })
    } else {
      const featureId = QUICK_MAP[id]
      const entry = featureId && catalogue.features.find(e => e.id === featureId)
      if (entry) response = catalogueAnswer(entry)
    }

    await new Promise(resolve => setTimeout(resolve, 450))
    if (response) setMessages(m => [...m, response])
    setIsTyping(false)
    setBusy(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const priorMessages = messages
      .filter(m => ['user', 'bot'].includes(m.role))
      .slice(-6)
      .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', text: messageText(m) }))
    setMessages(m => [...m, createMessage('user', { text })])
    setBusy(true)
    setIsTyping(true)
    const followUp = ['services', 'contactZuigo']
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: priorMessages, language })
      })
      const data = await response.json()
      if (!response.ok) throw new Error('chat-failed')
      const sources = Array.isArray(data.sources) ? data.sources : []
      setMessages(m => [...m, createMessage('bot', data.answer ? { text: data.answer } : { tk: 'messages.noConfirm' }, {
        sources, source: sources[0]?.url, buttons: followUp
      })])
    } catch (error) {
      // Server error texts are English; always show the translated message instead.
      setMessages(m => [...m, createMessage('bot', { tk: 'messages.genericError' }, { buttons: followUp })])
    } finally {
      setIsTyping(false)
      setBusy(false)
    }
  }

  const openPage = (url) => window.open(url, '_blank', 'noopener,noreferrer')

  const copyMessage = async (message, index) => {
    try {
      await navigator.clipboard.writeText(messageText(message))
      setCopyStatus(t('messages.copySuccess', { number: index + 1 }))
    } catch (error) {
      console.error('Unable to copy chat message:', error)
      setCopyStatus(t('messages.copyFailure'))
    }
    window.setTimeout(() => setCopyStatus(''), 2200)
  }

  const toggleVoiceNote = async () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessages(m => [...m, createMessage('bot', { tk: 'messages.voiceRecordingUnsupported' })])
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      const chunks = []
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        const audioUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        audioUrlsRef.current.push(audioUrl)
        setMessages(m => [...m, createMessage('user', { tk: 'controls.voiceNote' }, { audioUrl })])
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        recorderRef.current = null
        setIsRecording(false)
      }
      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error('Unable to start voice recording:', error)
      setMessages(m => [...m, createMessage('bot', { tk: 'messages.microphoneUnavailable' })])
    }
  }

  const clearMessages = () => {
    audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    audioUrlsRef.current = []
    setMessages([startMessage()])
    setInput('')
    setIsMenuOpen(false)
  }

  const languageSelect = (className) => <label className={className}>
    <span className="sr-only">{t('app.languageLabel')}</span>
    <select value={language} aria-label={t('app.languageLabel')} onChange={e => changeLanguage(e.target.value)}>
      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  </label>

  return <div className="app-shell">
    <div className="site-bg" />
    <header className="topbar">
      <a className="brand" href="https://zuigo.ai/" target="_blank" rel="noreferrer"><span className="brand-mark">Z</span><span>ZuiGO</span></a>
      <div className="topbar-right">
        {languageSelect('lang-select')}
        <span className="status"><i /> {t('app.websiteAssistantStatus')}</span>
      </div>
    </header>
    <main className={`chat-wrap${isOpen ? ' is-open' : ''}`}>
      <section className="hero">
        <div>
          <p className="eyebrow">{t('app.eyebrow')}</p>
          <h1>{t('app.heroTitle')}</h1>
          <p className="hero-copy">{t('app.heroDescription')}</p>
        </div>
      </section>
      {isOpen && <section className="chat-card" aria-label={t('app.chatAriaLabel')}>
        <header className="widget-header">
          <div className="widget-menu-wrap">
            <button
              className="menu-toggle"
              type="button"
              aria-label={t('controls.chatOptions')}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen(open => !open)}
            >
              <span /><span /><span />
            </button>
            {isMenuOpen && <div className="widget-menu">
              <button type="button" onClick={clearMessages}>{t('controls.clearMessages')}</button>
              <button type="button" onClick={clearMessages}>{t('controls.restartChat')}</button>
              <button type="button" onClick={() => { openPage('https://zuigo.ai/contact'); setIsMenuOpen(false) }}>{t('buttons.contact')}</button>
              {languageSelect('lang-select lang-select-menu')}
            </div>}
          </div>
          <div className="widget-title">
            <span className="assistant-mark" aria-hidden="true">Z</span>
            <span><strong>{t('app.assistantName')}</strong><small><i /> {t('app.onlineStatus')}</small></span>
          </div>
          <button className="restart-button" type="button" aria-label={t('controls.restartChat')} title={t('controls.restartChat')} onClick={clearMessages}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.8-3L3 11m0 0V5m0 6h6m-5 2a8 8 0 0 0 14.8 3L21 13m0 0v6m0-6h-6" /></svg>
          </button>
          <button className="minimize-button" type="button" aria-label={t('controls.minimizeChat')} onClick={() => { setIsOpen(false); setIsMenuOpen(false) }}>−</button>
        </header>
        <div className="messages" ref={messagesRef}>
          {messages.map((m, i) => <div key={i} className={`row ${m.role}${m.animateServiceAnswer ? ' service-answer-enter' : ''}`}>
            <div className="bubble">
              <div className={`message-text${m.preserveFormatting ? ' preserve-formatting' : ''}`}>
                {m.promptQuestion
                  ? <>{m.promptLeadKey && <>{t(m.promptLeadKey)}<br /><br /></>}<span className="prompt-question">{messageText(m)}</span></>
                  : messageText(m)}
              </div>
              {m.audioUrl && <audio className="voice-playback" controls src={m.audioUrl}>{t('controls.voicePlaybackUnsupported')}</audio>}
              <div className="message-meta">
                <time dateTime={m.timestamp.toISOString()}>{m.timestamp.toLocaleString(language, { dateStyle: 'short', timeStyle: 'short' })}</time>
                <button type="button" className="copy-button" aria-label={t('controls.copyMessageAriaLabel', { number: i + 1 })} title={t('controls.copyMessageTitle')} onClick={() => copyMessage(m, i)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
                </button>
              </div>
              {(m.sources?.length ? m.sources : (m.source ? [{ url: m.source }] : [])).map((src, sourceIndex) => <button key={`${src.url}-${sourceIndex}`} className="source" onClick={() => openPage(src.url)}>{t('controls.sourcePage')}</button>)}
              {m.buttons?.length > 0 && <div className="chips">{m.buttons.map(b => <button className={b === 'viewOnGoogleMaps' ? 'map-button' : undefined} disabled={busy} key={b} onClick={() => LINKS[b] ? openPage(LINKS[b]) : handleChoice(b, m)}>{b === 'viewOnGoogleMaps' && <svg className="map-pin" viewBox="0 0 24 24" aria-hidden="true"><path fill="#ea4335" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z" /><circle cx="12" cy="9" r="2.5" fill="#fff" /></svg>}{buttonLabel(b)}</button>)}</div>}
            </div>
          </div>)}
          {isTyping && <div className="row bot" role="status" aria-label={t('controls.assistantResponding')}>
            <div className="typing-bubble"><i /><i /><i /></div>
          </div>}
        </div>
        <form className="composer" onSubmit={handleSubmit}>
          <input autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder={t('controls.inputPlaceholder')} aria-label={t('controls.inputAriaLabel')} />
          <button className={`composer-tool voice-button${isRecording ? ' is-recording' : ''}`} type="button" aria-label={isRecording ? t('controls.stopVoiceNote') : t('controls.recordVoiceNote')} title={isRecording ? t('controls.stopRecording') : t('controls.recordVoiceNote')} onClick={toggleVoiceNote}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-4 0h8" /></svg>
          </button>
          <button className="send-button" type="submit" aria-label={t('controls.sendMessage')} title={t('controls.sendMessage')} disabled={busy || !input.trim()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.2 18-3.9-7.9L2 9.2 21 3Zm-11.1 10.1L21 3" /></svg>
          </button>
        </form>
        <div className="notice">{t('controls.notice')}</div>
        <div className="copy-status" role="status" aria-live="polite">{copyStatus}</div>
      </section>}
      <section className="security-card">
        <div><strong>{t('app.privacySecurityTitle')}</strong><p>{t('app.privacySecurityDescription')}</p></div>
        <a href="https://zuigo.ai/privacy" target="_blank" rel="noreferrer">{t('app.privacyPolicyLink')}</a>
      </section>
      <footer>{t('app.footer')}</footer>
    </main>
    {!isOpen && <button className="chat-launcher" type="button" aria-label={t('app.openAssistant')} onClick={() => setIsOpen(true)}>
      <span className="launcher-icon" aria-hidden="true"><span /><i /></span>
      <span className="launcher-label">{t('app.launcherLabel')}</span>
    </button>}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
