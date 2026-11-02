import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createGeminiBrain } from '../src/services/aiBrain.js'
import { createPersistentContextStore } from '../src/services/conversationHistory.js'
import { createJsonStore } from '../src/services/jsonStore.js'
import { createMemoryService } from '../src/services/memory.js'
import { backupOnce, migrateHistoryKeys, migrateMemoryKeys } from '../src/services/dataMigration.js'

const DAY = 24 * 60 * 60 * 1000
const OWNER = '2349166712534@s.whatsapp.net'
const silent = { debug() {}, warn() {}, error() {} }

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-memory-'))
  try { return await fn(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
const memoryStoreOf = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next; return this.data } })

function brainWith({ historyStore, memory = null, replies = ['ok'] }) {
  const requests = []; let call = 0
  const client = { interactions: { create: async request => { requests.push(request); return { output_text: replies[Math.min(call++, replies.length - 1)], steps: [] } } } }
  const sock = { sendMessage: async () => ({ key: { id: 'sent' } }) }
  const brain = createGeminiBrain({ client, historyStore, memory, logger: silent, config: { ownerName: 'Miyamaru', geminiFastModel: 'fast-test', geminiModel: 'main-test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  let n = 0
  const ask = async (text, { jid = 'chat@s.whatsapp.net', sender = OWNER, recentMessages } = {}) => { const result = await brain.run({ text, message: { key: { remoteJid: jid, id: `msg-${++n}` } }, sock, sender, speaker: 'Miyamaru', owner: true, recentMessages }); await brain.flush(); return result }
  return { brain, requests, ask }
}

// ---------------------------------------------------------------- long-term memory service
test('relevant() ranks partial matches first and falls back to the most recent memories', async () => {
  const memory = createMemoryService(memoryStoreOf({}))
  for (const text of ['My favorite color is blue', 'I am studying WAEC biology', 'My dog is called Bingo']) await memory.remember(OWNER, text)
  const biology = memory.relevant(OWNER, 'how is my biology revision going', { limit: 5 })
  assert.equal(biology[0].text, 'I am studying WAEC biology')
  assert.equal(memory.relevant(OWNER, 'tell me something fun', { limit: 2 }).map(item => item.text).join('|'), 'I am studying WAEC biology|My dog is called Bingo')
  assert.equal(memory.relevant('someone-else@s.whatsapp.net', 'biology').length, 0, 'memories stay private to their owner')
  assert.equal(memory.recall(OWNER, 'how is my biology revision going').length, 0, 'strict recall() keeps its existing all-terms behaviour')
})

test('a memory filed under a chat+sender key is found under the sender, regardless of device number', async () => {
  const memory = createMemoryService(memoryStoreOf({}))
  await memory.remember('120363000000006155@g.us:2349166712534:28@s.whatsapp.net', 'I like jollof rice')
  assert.equal(memory.recall('2349166712534@s.whatsapp.net', 'jollof').length, 1)
  assert.equal(memory.recall('2349166712534:31@s.whatsapp.net', 'jollof').length, 1)
})

// ---------------------------------------------------------------- conversation history store
test('history survives a re-link: a new device number keeps the same conversation', async () => {
  await withTempDir(async dir => {
    const store = await createJsonStore(path.join(dir, 'h.json'), {})
    const history = createPersistentContextStore(store, { maxTurns: 20 })
    await history.add('chat@s.whatsapp.net:2349166712534:28@s.whatsapp.net', 'user', 'before the relink')
    const after = history.get('chat@s.whatsapp.net:2349166712534:31@s.whatsapp.net')
    assert.deepEqual(after.map(turn => turn.content), ['before the relink'])
  })
})

test('a long retention window keeps old conversations while the default window still expires them', async () => {
  const seeded = { 'chat@s.whatsapp.net:u@s.whatsapp.net': { turns: [{ role: 'user', content: 'three days ago' }], updatedAt: Date.now() - 3 * DAY } }
  const long = createPersistentContextStore(memoryStoreOf(structuredClone(seeded)), { ttlMs: 14 * DAY })
  const short = createPersistentContextStore(memoryStoreOf(structuredClone(seeded)))
  assert.equal(long.get('chat@s.whatsapp.net:u@s.whatsapp.net').length, 1)
  assert.equal(short.get('chat@s.whatsapp.net:u@s.whatsapp.net').length, 0)
  assert.ok(Math.abs(long.lastActiveAt('chat@s.whatsapp.net:u@s.whatsapp.net') - seeded['chat@s.whatsapp.net:u@s.whatsapp.net'].updatedAt) < 5)
})

test('the group transcript expiry is configured separately from per-person history', async () => {
  const chat = { 'chat:120363@g.us': { messages: [{ id: 'a', sender: 's', speaker: 'S', role: 'participant', text: 'two hours ago', timestamp: Date.now() }], updatedAt: Date.now() - 2 * 60 * 60 * 1000 } }
  const kept = createPersistentContextStore(memoryStoreOf(structuredClone(chat)), { ttlMs: 14 * DAY, chatTtlMs: 3 * 60 * 60 * 1000 })
  const dropped = createPersistentContextStore(memoryStoreOf(structuredClone(chat)), { ttlMs: 14 * DAY, chatTtlMs: 30 * 60 * 1000 })
  assert.equal(kept.getChatMessages('120363@g.us').length, 1)
  assert.equal(dropped.getChatMessages('120363@g.us').length, 0)
})

// ---------------------------------------------------------------- one-time data migration
test('migrateHistoryKeys merges device-numbered keys into one conversation, leaves group transcripts alone, and is idempotent', async () => {
  const now = Date.now()
  const store = memoryStoreOf({
    'g@g.us:2349166712534:28@s.whatsapp.net': { turns: [{ role: 'user', content: 'old one' }, { role: 'model', content: 'old reply' }], updatedAt: now - 5000 },
    'g@g.us:2349166712534:31@s.whatsapp.net': { turns: [{ role: 'user', content: 'newer one' }], updatedAt: now },
    'chat:g@g.us': { messages: [{ id: '1', text: 'hi', speaker: 'a', sender: 'a', role: 'participant', timestamp: now }], updatedAt: now }
  })
  const first = await migrateHistoryKeys(store, { maxTurns: 20 })
  assert.equal(first.changed, true)
  assert.deepEqual(Object.keys(store.get()).sort(), ['chat:g@g.us', 'g@g.us:2349166712534@s.whatsapp.net'])
  assert.deepEqual(store.get()['g@g.us:2349166712534@s.whatsapp.net'].turns.map(turn => turn.content), ['old one', 'old reply', 'newer one'])
  assert.equal(store.get()['g@g.us:2349166712534@s.whatsapp.net'].updatedAt, now)
  assert.equal((await migrateHistoryKeys(store, { maxTurns: 20 })).changed, false)
})

test('migrateMemoryKeys moves chat+sender and device-numbered keys onto the sender, without duplicates or losses', async () => {
  const store = memoryStoreOf({
    '120363@g.us:2349166712534:28@s.whatsapp.net': [{ id: 'a', text: 'I like jollof', createdAt: '2026-10-20T10:00:00.000Z', source: 'x' }],
    '2349166712534@s.whatsapp.net': [{ id: 'b', text: 'My dog is Bingo', createdAt: '2026-10-21T10:00:00.000Z', source: 'x' }, { id: 'a', text: 'I like jollof', createdAt: '2026-10-20T10:00:00.000Z', source: 'x' }]
  })
  const result = await migrateMemoryKeys(store)
  assert.equal(result.changed, true)
  assert.deepEqual(Object.keys(store.get()), ['2349166712534@s.whatsapp.net'])
  assert.deepEqual(store.get()['2349166712534@s.whatsapp.net'].map(item => item.id).sort(), ['a', 'b'])
  assert.equal((await migrateMemoryKeys(store)).changed, false)
})

test('backupOnce copies a data file exactly once and never overwrites an existing backup', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'memories.json'); await fs.writeFile(file, '{"a":1}')
    assert.equal(await backupOnce(file), true)
    await fs.writeFile(file, '{"a":2}')
    assert.equal(await backupOnce(file), false)
    assert.equal(await fs.readFile(`${file}.pre-memory-fix.bak`, 'utf8'), '{"a":1}')
    assert.equal(await backupOnce(path.join(dir, 'missing.json')), false)
  })
})

// ---------------------------------------------------------------- what the model actually receives
test('private chat: far more than six saved turns reach the model, not just the last few', async () => {
  await withTempDir(async dir => {
    const history = createPersistentContextStore(await createJsonStore(path.join(dir, 'h.json'), {}), { maxTurns: 24, ttlMs: 14 * DAY })
    const key = `chat@s.whatsapp.net:${OWNER}`
    for (let i = 1; i <= 10; i += 1) await history.add(key, i % 2 ? 'user' : 'model', `turn number ${i} about project Alpha`)
    const { ask, requests } = brainWith({ historyStore: history })
    await ask('Shadow, what were we saying about the project?')
    assert.match(requests[0].input, /turn number 1 about project Alpha/)
    assert.match(requests[0].input, /turn number 10 about project Alpha/)
  })
})

test('group chat: the requester’s earlier exchanges with Shadow are supplied even when the group transcript is empty, and other people’s are not', async () => {
  await withTempDir(async dir => {
    const history = createPersistentContextStore(await createJsonStore(path.join(dir, 'h.json'), {}), { maxTurns: 24, ttlMs: 14 * DAY })
    const group = '120363000000006155@g.us'
    await history.add(`${group}:${OWNER}`, 'user', 'my exam is on Friday')
    await history.add(`${group}:${OWNER}`, 'model', 'Noted, Friday it is.')
    await history.add(`${group}:other@s.whatsapp.net`, 'user', 'a private thing from someone else')
    const { ask, requests } = brainWith({ historyStore: history })
    await ask('Shadow, when is my exam again?', { jid: group, recentMessages: [] })
    assert.match(requests[0].input, /Earlier exchanges/i)
    assert.match(requests[0].input, /my exam is on Friday/)
    assert.doesNotMatch(requests[0].input, /private thing from someone else/)
  })
})

test('saved memories reach the model in private chats even when the question does not repeat their words, but never in groups', async () => {
  const memory = createMemoryService(memoryStoreOf({}))
  await memory.remember(OWNER, 'My dog is called Bingo')
  const dm = brainWith({ historyStore: createPersistentContextStore(memoryStoreOf({})), memory })
  await dm.ask('Shadow, any ideas for a walk this evening?')
  assert.match(dm.requests[0].input, /Bingo/)
  const grp = brainWith({ historyStore: createPersistentContextStore(memoryStoreOf({})), memory })
  await grp.ask('Shadow, any ideas for a walk this evening?', { jid: '120363@g.us', recentMessages: [] })
  assert.doesNotMatch(grp.requests[0].input, /Bingo/)
})

test('the favorite-colour answer is still exact and is not hijacked by unrelated memories', async () => {
  const memory = createMemoryService(memoryStoreOf({}))
  await memory.remember(OWNER, 'My dog is called Bingo')
  const { ask } = brainWith({ historyStore: createPersistentContextStore(memoryStoreOf({})), memory })
  const sent = []
  const brain = createGeminiBrain({ client: { interactions: { create: async () => ({ output_text: 'x', steps: [] }) } }, historyStore: createPersistentContextStore(memoryStoreOf({})), memory, logger: silent, config: { geminiFastModel: 't', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, what is my favorite color?', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'fav' } }, sock: { sendMessage: async (jid, content) => { sent.push(content?.text) } }, sender: OWNER, owner: true })
  assert.match(sent.find(Boolean), /do not have your favorite color saved/i)
  void ask
})

test('after a re-link the same person still gets their earlier conversation', async () => {
  await withTempDir(async dir => {
    const history = createPersistentContextStore(await createJsonStore(path.join(dir, 'h.json'), {}), { maxTurns: 24, ttlMs: 14 * DAY })
    const { ask, requests } = brainWith({ historyStore: history, replies: ['Got it, Ada.'] })
    await ask('Shadow, my name is Ada', { sender: '2349166712534:28@s.whatsapp.net' })
    await ask('Shadow, what is my name?', { sender: '2349166712534:31@s.whatsapp.net' })
    assert.match(requests[1].input, /my name is Ada/i)
  })
})

test('old banter does not escalate roasts: a conversation that has been idle for days starts fresh for tone', async () => {
  const banter = [{ role: 'user', content: 'tell me a joke' }, { role: 'model', content: 'sure' }, { role: 'user', content: 'another comeback' }]
  const seed = updatedAt => memoryStoreOf({ [`chat@s.whatsapp.net:${OWNER}`]: { turns: banter, updatedAt } })
  const stale = brainWith({ historyStore: createPersistentContextStore(seed(Date.now() - 2 * DAY), { ttlMs: 14 * DAY }) })
  await stale.ask('Shadow, give me a playful comeback')
  assert.match(stale.requests[0].system_instruction, /Roast mode is light/)
  const fresh = brainWith({ historyStore: createPersistentContextStore(seed(Date.now() - 60_000), { ttlMs: 14 * DAY }) })
  await fresh.ask('Shadow, give me a playful comeback')
  assert.match(fresh.requests[0].system_instruction, /Roast mode is sharp/)
})
