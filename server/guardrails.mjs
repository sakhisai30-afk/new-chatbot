export const OFF_TOPIC_REPLY = "Sorry, I can't help with that. I can only answer questions about the ZuiGO website, such as its services, technology, contact details, location and meetings. Please ask me something about ZuiGO."
export const ABUSE_REPLY = "I'm here to help with questions about ZuiGO. Feel free to ask about our services, technology, contact details or location."
export const INJECTION_REPLY = "Sorry, I can't help with that. I can only answer questions about the ZuiGO website. Please ask me about ZuiGO's services, contact details or location."
export const UNSURE_REPLY = "I can't confirm that from the ZuiGO website. Please contact ZuiGO through its Contact page or at hello@zuigo.ai."

const ABUSE = /\b(dumb|stupid|idiot|useless|moron|shut\s*up|fuck\w*|shit\w*|bitch\w*|bastard|asshole|crap)\b/i
const INJECTION = /(ignore|forget|disregard)\b.{0,30}\b(instructions?|rules?|prompt)|\b(system|hidden|secret)\s+prompt\b|reveal\b.{0,25}\b(prompt|instructions?)|\b(act|pretend)\s+(as|like)\b|you\s+are\s+now\b|\bjailbreak\b|\bdeveloper\s+mode\b/i

export function checkInput(message) {
  const text = String(message || '')
  if (INJECTION.test(text)) return INJECTION_REPLY
  if (ABUSE.test(text)) return ABUSE_REPLY
  return null
}

const COMMON = new Set(['zuigo','yes','no','the','this','that','these','those','contact','page','website','book','call','link','email','please','sorry','you','your','we','our','it','if','for','and','but','also','each','all','any','use','learn','visit','ask'])
const PRICE = /(?:[$€£₹]\s?\d|\b\d[\d,.]*\s?(?:usd|inr|eur|dollars?|rupees?)\b|\bper\s+(?:hour|month|project)\b|\bstarting\s+(?:at|from)\s+\$)/i
const BAD_WORDS = /\b(fuck\w*|shit\w*|bitch\w*|bastard|asshole)\b/i

export function checkOutput(answer, excerptText) {
  const out = String(answer || '').trim()
  if (!out) return { ok: false, reply: UNSURE_REPLY }
  if (BAD_WORDS.test(out)) return { ok: false, reply: UNSURE_REPLY }
  const source = String(excerptText || '').toLowerCase()
  if (PRICE.test(out) && !PRICE.test(source)) return { ok: false, reply: UNSURE_REPLY }
  const sentences = out.split(/(?<=[.!?])\s+/)
  const unsupported = new Set()
  for (const s of sentences) {
    const words = s.match(/[A-Za-z][A-Za-z&+/.-]*|\d[\d,.]*/g) || []
    words.forEach((w, i) => {
      const isNumber = /^\d/.test(w)
      const isName = /^[A-Z]/.test(w) && i > 0
      if (!isNumber && !isName) return
      const key = w.toLowerCase().replace(/[.,]+$/, '')
      if (COMMON.has(key) || key.length < 3) return
      if (!source.includes(key)) unsupported.add(key)
    })
  }
  if (unsupported.size >= 2) return { ok: false, reply: UNSURE_REPLY }
  return { ok: true, reply: out }
}
