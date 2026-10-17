export const OFF_TOPIC_REPLY = "I'm sorry, but that question is not related to the ZuiGO website, so I'm not able to answer it. I can help you with information about our services, technology, contact details, location and meetings. Please feel free to ask me anything about ZuiGO."
export const ABUSE_REPLY = "I'm sorry, I'm not able to answer that. I'm here to help you with the ZuiGO website, so I can tell you about our services, technology, contact details or location."
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
  if (PRICE.test(out)) return { ok: false, reply: UNSURE_REPLY }
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

export const ADDRESS_REPLY = "ZuiGO's address is Runwal Platinum, NDA Pashan Road, Ram Nagar, Bavdhan, Pune, Maharashtra – 411021, India."
const ADDRESS_Q = /^(?:(?:what(?:'s|\s+is)|tell\s+me|give\s+me|share|show\s+me)\s+)?(?:(?:your|the|zuigo(?:'s)?)\s+)*(?:office\s+|company\s+|business\s+)?(?:address|location)(?:\s+of\s+(?:zuigo|your\s+(?:office|company)))?$|^where\s+(?:is|are)\s+(?:you|zuigo|your\s+(?:office|company))(?:\s+(?:located|based))?$|^where\s+are\s+you\s+(?:located|based)$/i
export function isAddressQuestion(message) {
  const text = String(message || '').trim().replace(/[?!.\s]+$/, '').replace(/\s+/g, ' ')
  return ADDRESS_Q.test(text)
}
export const FOUNDER_REPLY = "ZuiGO was founded by Dr. Manisha Thakkar, who holds a PhD in Artificial Intelligence and Machine Learning. She has published multiple research papers at top-tier AI conferences and brings over 10 years of industry experience building software products across domains."
const FOUNDER_Q = /^(?:(?:who(?:'s|\s+is|\s+are)|tell\s+me\s+(?:about|who\s+is)|name\s+of)\s+)?(?:(?:the|your|zuigo(?:'s)?)\s+)*(?:co-?founders?|founders?|ceo|chief\s+executive(?:\s+officer)?|(?:managing\s+)?directors?|owner)(?:\s+(?:of|at)\s+(?:zuigo|this\s+company|the\s+company|your\s+company))?$|^who\s+(?:founded|started|owns|runs|leads|created)\s+(?:zuigo|this\s+company|the\s+company)$/i
export function isFounderQuestion(message) {
  const text = String(message || '').trim().replace(/[?!.\s]+$/, '').replace(/\s+/g, ' ')
  return FOUNDER_Q.test(text)
}

// Questions about money or about things the website does not confirm always get the fixed "can't confirm" reply.
const BUDGET_Q = /\b(?:budgets?|pric(?:e|es|ed|ing)|costs?|costing|quotes?|quotations?|estimates?|fees?|charges?|charging|expensive|cheap(?:er|est)?|afford(?:able|ability)?|discounts?|retainers?|(?:hourly|daily|day|monthly)\s+rates?|per\s+(?:hour|day|month|project)|how\s+much\s+(?:does|do|is|are|will|would|should|to|for|can|it))\b/i
// Add any other name or topic here that the website does not confirm, separated by |
const UNCONFIRMED_TOPICS = /\bnova\s*bot\b/i
export function isUnconfirmedQuestion(message) {
  const text = String(message || '')
  return BUDGET_Q.test(text) || UNCONFIRMED_TOPICS.test(text)
}
