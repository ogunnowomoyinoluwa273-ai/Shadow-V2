import { performance } from 'node:perf_hooks'

const DEFAULT_CHAT_MAX_MESSAGES = 80
const DEFAULT_CHAT_MAX_SUMMARY_ITEMS = 24
const DEFAULT_CHAT_MAX_CHATS = 500
const DEFAULT_CHAT_SUMMARY_TTL_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_CHAT_WRITE_BATCH_MS = 40
const MAX_CHAT_SUMMARY_CHARS = 4_000

// Conversations belong to a person in a chat, not to a linked-device number, so a re-link keeps them. Group transcripts ("chat:…") are left alone.
export const normalizeHistoryKey = key => { const value = String(key || ''); if (value.startsWith('chat:')) return value; const parts = value.match(/^([^:\s]+@[^:\s@]+):(\S+)$/); return parts ? `${parts[1]}:${parts[2].replace(/:\d+(?=@)/, '')}` : value }
const normalizeTurn = turn => turn && (turn.role === 'user' || turn.role === 'model') && typeof turn.content === 'string' ? { role: turn.role, content: turn.content.slice(0, 6000) } : null
const clone = value => structuredClone(value)

function normalizeChatMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.text !== 'string' || !message.text.trim()) return null
  const timestamp = Number(message.timestamp)
  const role = ['shadow', 'owner'].includes(message.role) ? message.role : 'participant'
  return {
    id: typeof message.id === 'string' ? message.id.slice(0, 200) : '',
    sender: typeof message.sender === 'string' ? message.sender.slice(0, 200) : '',
    speaker: typeof message.speaker === 'string' && message.speaker.trim() ? message.speaker.trim().slice(0, 100) : (role === 'shadow' ? 'Shadow' : 'Unknown participant'),
    role,
    text: message.text.slice(0, 1_200),
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    replyToId: typeof message.replyToId === 'string' ? message.replyToId.slice(0, 200) : '',
    replyToSender: typeof message.replyToSender === 'string' ? message.replyToSender.slice(0, 200) : '',
    replyToSpeaker: typeof message.replyToSpeaker === 'string' ? message.replyToSpeaker.slice(0, 100) : '',
    replyToText: typeof message.replyToText === 'string' ? message.replyToText.slice(0, 400) : '',
    mentions: Array.isArray(message.mentions) ? [...new Set(message.mentions.filter(value => typeof value === 'string').map(value => value.slice(0, 200)))].slice(0, 10) : []
  }
}

function normalizeSummaryItem(message) {
  const normalized = normalizeChatMessage(message)
  if (!normalized || normalized.text.trim().length < 8 || /^(?:ok(?:ay)?|yeah|yep|yes|no|lol|haha|hmm|hi|hey|thanks|thx)[.!?\s]*$/i.test(normalized.text)) return null
  normalized.text = normalized.text.replace(/\s+/g, ' ').trim().slice(0, 220)
  normalized.replyToText = ''
  normalized.replyToId = ''
  normalized.mentions = []
  return normalized
}

function normalizeChatRecord(record) {
  if (!record || typeof record !== 'object') return { messages: [], summary: [], updatedAt: 0, summaryUpdatedAt: 0 }
  return {
    messages: Array.isArray(record.messages) ? record.messages.map(normalizeChatMessage).filter(Boolean) : [],
    summary: Array.isArray(record.summary) ? record.summary.map(normalizeSummaryItem).filter(Boolean) : [],
    updatedAt: Number(record.updatedAt) || 0,
    summaryUpdatedAt: Number(record.summaryUpdatedAt) || 0
  }
}

export function createPersistentContextStore(store, {
  maxTurns = 6,
  ttlMs = 30 * 60 * 1000,
  chatTtlMs = ttlMs,
  maxChatMessages = DEFAULT_CHAT_MAX_MESSAGES,
  maxSummaryItems = DEFAULT_CHAT_MAX_SUMMARY_ITEMS,
  maxChats = DEFAULT_CHAT_MAX_CHATS,
  summaryTtlMs = DEFAULT_CHAT_SUMMARY_TTL_MS,
  chatWriteBatchMs = DEFAULT_CHAT_WRITE_BATCH_MS,
  logger = console,
  now = () => Date.now()
} = {}) {
  const queues = new Map()
  const turnCache = new Map()
  const chatCache = new Map()
  const pendingChatWrites = new Map()
  let storeQueue = Promise.resolve()
  let chatFlushTimer = null
  let chatFlushPromise = null
  const boundedMaxMessages = Math.max(16, Math.min(200, Number(maxChatMessages) || DEFAULT_CHAT_MAX_MESSAGES))
  const boundedMaxSummaryItems = Math.max(4, Math.min(48, Number(maxSummaryItems) || DEFAULT_CHAT_MAX_SUMMARY_ITEMS))
  const boundedMaxChats = Math.max(20, Math.min(2_000, Number(maxChats) || DEFAULT_CHAT_MAX_CHATS))
  const boundedBatchMs = Math.max(0, Math.min(250, Number(chatWriteBatchMs) || 0))

  const updateStore = operation => {
    const next = storeQueue.catch(() => {}).then(() => store.update(operation))
    storeQueue = next.catch(() => {})
    return next
  }
  const read = key => {
    const normalizedKey = normalizeHistoryKey(key)
    let record = turnCache.get(normalizedKey)
    if (!record) {
      const stored = store.get()?.[normalizedKey]
      if (!stored || typeof stored !== 'object' || !Array.isArray(stored.turns)) return []
      record = { turns: stored.turns.map(normalizeTurn).filter(Boolean).slice(-maxTurns), updatedAt: Number(stored.updatedAt) || 0 }
      turnCache.set(normalizedKey, record)
      if (turnCache.size > boundedMaxChats) turnCache.delete(turnCache.keys().next().value)
    }
    if (!record || typeof record !== 'object' || !Array.isArray(record.turns)) return []
    if (record.updatedAt && now() - record.updatedAt > ttlMs) return []
    turnCache.delete(normalizedKey)
    turnCache.set(normalizedKey, record)
    return record.turns.slice(-maxTurns)
  }
  const chatKey = jid => `chat:${String(jid || '')}`
  const boundPendingWrites = () => {
    if (pendingChatWrites.size <= boundedMaxChats) return
    const keep = new Set([...pendingChatWrites.entries()].sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0)).slice(0, boundedMaxChats).map(([key]) => key))
    for (const key of pendingChatWrites.keys()) if (!keep.has(key)) pendingChatWrites.delete(key)
  }
  const loadChat = jid => {
    const key = chatKey(jid)
    let record = chatCache.get(key)
    if (!record) {
      record = normalizeChatRecord(store.get()?.[key])
      chatCache.set(key, record)
      if (chatCache.size > boundedMaxChats) {
        const oldest = [...chatCache.entries()].filter(([entryKey]) => entryKey !== key).sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
        if (oldest) chatCache.delete(oldest[0])
      }
    } else {
      chatCache.delete(key)
      chatCache.set(key, record)
    }
    return record
  }
  const chatContext = jid => {
    const record = loadChat(jid)
    const current = now()
    const idleExpired = record.updatedAt > 0 && current - record.updatedAt > chatTtlMs
    const messages = idleExpired ? [] : record.messages.filter(item => item.timestamp >= current - chatTtlMs).slice(-boundedMaxMessages)
    const summary = record.summary.filter(item => item.timestamp >= current - summaryTtlMs).slice(-boundedMaxSummaryItems)
    return { messages: clone(messages), summary: clone(summary), updatedAt: record.updatedAt }
  }
  const scheduleChatFlush = () => {
    if (chatFlushTimer || chatFlushPromise || !pendingChatWrites.size) return
    chatFlushTimer = setTimeout(() => {
      chatFlushTimer = null
      void flushChatWrites().catch(error => logger.warn?.({ error: String(error?.message || error) }, 'Conversation context batch write failed'))
    }, boundedBatchMs)
    chatFlushTimer.unref?.()
  }
  const flushChatWrites = async () => {
    if (chatFlushTimer) { clearTimeout(chatFlushTimer); chatFlushTimer = null }
    if (chatFlushPromise) {
      try { await chatFlushPromise } catch {}
      if (pendingChatWrites.size) return flushChatWrites()
      return
    }
    if (!pendingChatWrites.size) return
    const batch = new Map(pendingChatWrites)
    pendingChatWrites.clear()
    const startedAt = performance.now()
    let retryAfterFlight = true
    chatFlushPromise = updateStore(all => {
      const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
      for (const [key, record] of batch) next[key] = clone(record)
      const chatKeys = Object.keys(next).filter(key => key.startsWith('chat:'))
      if (chatKeys.length > boundedMaxChats) {
        const keep = new Set(chatKeys.sort((a, b) => (Number(next[b]?.updatedAt) || 0) - (Number(next[a]?.updatedAt) || 0)).slice(0, boundedMaxChats))
        for (const key of chatKeys) if (!keep.has(key)) { delete next[key]; chatCache.delete(key); pendingChatWrites.delete(key) }
      }
      return next
    }).then(() => {
      logger.debug?.({ chatRecords: batch.size, elapsedMs: Math.round(performance.now() - startedAt) }, 'Conversation context batch persisted')
    }).catch(error => {
      retryAfterFlight = false
      for (const [key, record] of batch) if (!pendingChatWrites.has(key)) pendingChatWrites.set(key, record)
      throw error
    }).finally(() => {
      chatFlushPromise = null
      if (retryAfterFlight && pendingChatWrites.size) scheduleChatFlush()
    })
    return chatFlushPromise
  }
  const readChat = jid => chatContext(jid).messages
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
  const get = key => read(normalizeHistoryKey(key))
  const add = (key, role, content) => {
    const normalizedKey = normalizeHistoryKey(key)
    if (!normalizedKey || !['user', 'model'].includes(role) || typeof content !== 'string' || !content.trim()) return Promise.resolve()
    const turns = read(normalizedKey).concat({ role, content: content.slice(0, 6000) }).slice(-maxTurns)
    const snapshot = { turns, updatedAt: now() }
    turnCache.set(normalizedKey, snapshot)
    turnCache.delete(normalizedKey)
    turnCache.set(normalizedKey, snapshot)
    if (turnCache.size > boundedMaxChats) turnCache.delete(turnCache.keys().next().value)
    return enqueue(normalizedKey, async () => updateStore(all => {
      const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
      next[normalizedKey] = clone(snapshot)
      return next
    }))
  }
  const getChatContext = jid => chatContext(jid)
  const getChatMessages = jid => readChat(jid)
  const addChatMessage = (jid, message) => {
    const key = chatKey(jid)
    if (!String(jid || '')) return Promise.resolve([])
    const normalized = normalizeChatMessage(message)
    if (!normalized) return Promise.resolve(readChat(jid))
    const current = now()
    const record = loadChat(jid)
    const prior = record.messages.find(item => normalized.id && item.id === normalized.id)
    if (prior) {
      // A locally generated reply is authoritative over the echo of our linked-device account.
      if (normalized.role === 'shadow' && prior.role !== 'shadow') {
        record.messages = record.messages.map(item => item.id === normalized.id ? normalized : item)
        record.updatedAt = current
        chatCache.set(key, record)
        pendingChatWrites.set(key, clone(record))
        boundPendingWrites()
        scheduleChatFlush()
      }
      return Promise.resolve(chatContext(jid).messages)
    }

    const cutoff = current - chatTtlMs
    const summaryCutoff = current - summaryTtlMs
    const expired = record.messages.filter(item => item.timestamp < cutoff)
    let messages = record.messages.filter(item => item.timestamp >= cutoff)
    if (normalized.timestamp < cutoff) expired.push(normalized)
    else messages.push(normalized)
    messages.sort((a, b) => a.timestamp - b.timestamp)
    const overflow = messages.length > boundedMaxMessages ? messages.splice(0, messages.length - boundedMaxMessages) : []
    const recap = [...record.summary.filter(item => item.timestamp >= summaryCutoff)]
    for (const evicted of [...expired, ...overflow]) {
      const item = normalizeSummaryItem(evicted)
      if (item && !recap.some(existing => (item.id && existing.id === item.id) || `${existing.sender}:${existing.text}` === `${item.sender}:${item.text}`)) recap.push(item)
    }
    recap.sort((a, b) => a.timestamp - b.timestamp)
    const summary = recap.slice(-boundedMaxSummaryItems)
    while (summary.length && summary.reduce((total, item) => total + item.text.length, 0) > MAX_CHAT_SUMMARY_CHARS) summary.shift()
    const next = { messages, summary, updatedAt: current, summaryUpdatedAt: summary.length ? current : record.summaryUpdatedAt }
    chatCache.set(key, next)
    pendingChatWrites.set(key, clone(next))
    boundPendingWrites()
    scheduleChatFlush()
    return Promise.resolve(chatContext(jid).messages)
  }
  const clear = key => { const normalizedKey = normalizeHistoryKey(key); turnCache.set(normalizedKey, { turns: [], updatedAt: now() }); return enqueue(normalizedKey, async () => { await updateStore(all => { const next = { ...(all || {}) }; delete next[normalizedKey]; return next }) }) }
  const lastActiveAt = key => { const normalizedKey = normalizeHistoryKey(key); const record = turnCache.get(normalizedKey) || store.get()?.[normalizedKey]; return record && Number(record.updatedAt) > 0 ? Number(record.updatedAt) : 0 }
  const invalidateCache = () => { turnCache.clear(); chatCache.clear() }
  const flush = async () => {
    if (chatFlushTimer) { clearTimeout(chatFlushTimer); chatFlushTimer = null }
    await Promise.allSettled([...queues.values()])
    await flushChatWrites()
    await storeQueue.catch(() => {})
    await store.flush?.()
  }
  return { get, add, getChatContext, getChatMessages, addChatMessage, clear, lastActiveAt, invalidateCache, size: () => Object.keys(store.get() || {}).length, flush }
}
