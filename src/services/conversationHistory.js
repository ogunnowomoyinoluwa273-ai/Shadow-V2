import { performance } from 'node:perf_hooks'

const normalizeTurn = turn => turn && (turn.role === 'user' || turn.role === 'model') && typeof turn.content === 'string' ? { role: turn.role, content: turn.content.slice(0, 6000) } : null

export function createPersistentContextStore(store, { maxTurns = 6, ttlMs = 30 * 60 * 1000, logger = console } = {}) {
  const queues = new Map()
  const maxChatMessages = 16
  let storeQueue = Promise.resolve()
  const updateStore = operation => {
    const next = storeQueue.catch(() => {}).then(() => store.update(operation))
    storeQueue = next.catch(() => {})
    return next
  }
  const read = key => {
    const record = store.get()?.[key]
    if (!record || typeof record !== 'object' || !Array.isArray(record.turns)) return []
    if (record.updatedAt && Date.now() - record.updatedAt > ttlMs) return []
    return record.turns.map(normalizeTurn).filter(Boolean).slice(-maxTurns)
  }
  const chatKey = jid => `chat:${String(jid || '')}`
  const normalizeChatMessage = message => {
    if (!message || typeof message !== 'object' || typeof message.text !== 'string' || !message.text.trim()) return null
    const timestamp = Number(message.timestamp)
    return {
      id: typeof message.id === 'string' ? message.id.slice(0, 200) : '',
      sender: typeof message.sender === 'string' ? message.sender.slice(0, 200) : '',
      speaker: typeof message.speaker === 'string' && message.speaker.trim() ? message.speaker.trim().slice(0, 100) : 'Unknown participant',
      role: message.role === 'shadow' ? 'shadow' : 'participant',
      text: message.text.slice(0, 2000),
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
    }
  }
  const readChat = jid => {
    const record = store.get()?.[chatKey(jid)]
    if (!record || typeof record !== 'object' || !Array.isArray(record.messages)) return []
    if (record.updatedAt && Date.now() - record.updatedAt > ttlMs) return []
    return record.messages.map(normalizeChatMessage).filter(Boolean).slice(-maxChatMessages)
  }
  const enqueue = (key, operation) => {
    const enqueuedAt = performance.now()
    const previous = queues.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      const startedAt = performance.now()
      logger.debug?.({ queueWaitMs: Math.round(startedAt - enqueuedAt) }, 'Conversation history queue wait completed')
      try { return await operation() } finally { logger.debug?.({ writeMs: Math.round(performance.now() - startedAt) }, 'Conversation history write completed') }
    }).finally(() => { if (queues.get(key) === next) queues.delete(key) })
    queues.set(key, next)
    return next
  }
  const get = key => read(String(key || ''))
  const add = (key, role, content) => enqueue(String(key || ''), async () => {
    const normalizedKey = String(key || '')
    if (!normalizedKey || !['user', 'model'].includes(role) || typeof content !== 'string' || !content.trim()) return
    await updateStore(all => {
      const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
      const turns = read(normalizedKey).concat({ role, content: content.slice(0, 6000) }).slice(-maxTurns)
      next[normalizedKey] = { turns, updatedAt: Date.now() }
      return next
    })
  })
  const getChatMessages = jid => readChat(jid)
  const addChatMessage = (jid, message) => enqueue(chatKey(jid), async () => {
    const normalized = normalizeChatMessage(message)
    if (!String(jid || '') || !normalized) return readChat(jid)
    await updateStore(all => {
      const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
      const key = chatKey(jid)
      const record = next[key]
      const existing = record && Array.isArray(record.messages) && !(record.updatedAt && Date.now() - record.updatedAt > ttlMs)
        ? record.messages.map(normalizeChatMessage).filter(Boolean)
        : []
      if (normalized.id && existing.some(item => item.id === normalized.id)) return next
      next[key] = { messages: existing.concat(normalized).slice(-maxChatMessages), updatedAt: Date.now() }
      return next
    })
    return readChat(jid)
  })
  const clear = key => enqueue(String(key || ''), async () => { await updateStore(all => { const next = { ...(all || {}) }; delete next[String(key || '')]; return next }) })
  return { get, add, getChatMessages, addChatMessage, clear, size: () => Object.keys(store.get() || {}).length, flush: () => store.flush?.() }
}
