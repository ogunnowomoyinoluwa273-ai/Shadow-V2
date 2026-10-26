import crypto from 'node:crypto'

const MAX_MEMORIES_PER_USER = 100
const MAX_MEMORY_CHARS = 500
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
const keyFor = value => normalize(value).toLowerCase().replace(/:\d+(?=@)/, '')
const stopWords = new Set(['a', 'about', 'am', 'and', 'are', 'btw', 'can', 'do', 'does', 'for', 'how', 'i', 'is', 'me', 'my', 'of', 'please', 'the', 'that', 'what', 'whats', 'with', 'you', 'your'])
const searchable = value => String(value || '').toLowerCase().replace(/\bwhat['’]s\b/g, 'what').replace(/\bfav(?:ou?rite)?\b/g, 'favorite').replace(/\bcolour\b/g, 'color').replace(/[^\p{L}\p{N}@]+/gu, ' ')
const idFor = () => crypto.randomUUID()

export function createMemoryService(store, { maxPerUser = MAX_MEMORIES_PER_USER, maxChars = MAX_MEMORY_CHARS } = {}) {
  const read = () => {
    const value = store.get()
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }
  const list = user => {
    const entries = read()[keyFor(user)]
    return Array.isArray(entries) ? entries.filter(item => item && typeof item.text === 'string') : []
  }
  const remember = async (user, text, metadata = {}) => {
    const owner = keyFor(user); const value = normalize(text).slice(0, maxChars)
    if (!owner || !value) throw new Error('Memory text cannot be empty.')
    const record = { id: idFor(), text: value, createdAt: new Date().toISOString(), source: normalize(metadata.source).slice(0, 40) || 'conversation' }
    await store.update(all => {
      const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
      next[owner] = [...list(owner), record].slice(-maxPerUser)
      return next
    })
    return record
  }
  const recall = (user, query = '') => {
    const terms = searchable(normalize(query)).split(/\s+/).filter(term => term && !stopWords.has(term))
    const entries = list(user)
    if (!terms.length) return entries.slice(-10)
    return entries.filter(item => terms.every(term => searchable(item.text).includes(term))).slice(-10)
  }
  const forget = async (user, idOrText) => {
    const owner = keyFor(user); const needle = normalize(idOrText).toLowerCase(); let removed = false
    await store.update(all => {
      const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
      const before = list(owner)
      next[owner] = before.filter(item => { const match = item.id === idOrText || item.text.toLowerCase() === needle; if (match) removed = true; return !match })
      return next
    })
    return removed
  }
  const clear = async user => { const owner = keyFor(user); await store.update(all => { const next = { ...(all || {}) }; const count = list(owner).length; delete next[owner]; return next }); return true }
  return { remember, recall, forget, clear, list }
}
