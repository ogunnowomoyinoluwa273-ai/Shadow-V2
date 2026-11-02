import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createMessageHandler } from '../src/handlers/messageHandler.js'
import { createGeminiBrain } from '../src/services/aiBrain.js'
import { formatConversationContext, resolveConversationReference, retrieveRelevantConversation } from '../src/services/conversationContext.js'
import { createPersistentContextStore } from '../src/services/conversationHistory.js'
import { createJsonStore } from '../src/services/jsonStore.js'

const OWNER = '2349166712534@s.whatsapp.net'
const silent = { debug() {}, info() {}, warn() {}, error() {} }
const fakeStore = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next; return this.data }, async flush() {} })

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-context-'))
  try { return await fn(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}

function message(id, sender, text, { speaker = 'Miyamaru', timestamp = Date.now(), role = 'participant', replyToId = '', replyToSender = '', replyToText = '', mentions = [] } = {}) {
  return { id, sender, speaker, role, text, timestamp, replyToId, replyToSender, replyToText, mentions }
}

test('ordinary private and group messages are recorded passively, remain isolated, and only an addressed follow-up calls Gemini', async () => {
  const history = createPersistentContextStore(fakeStore({}), { chatTtlMs: 3 * 60 * 60 * 1000, chatWriteBatchMs: 1_000, logger: silent })
  const requests = []
  const sent = []
  const brain = createGeminiBrain({
    client: { interactions: { create: async request => { requests.push(request); return { output_text: 'You said the train leaves at six.', outputs: [] } } } },
    historyStore: history,
    logger: silent,
    config: { geminiFastModel: 'test-fast', geminiTimeoutMs: 1_000, naturalCommands: false },
    sudo: { has: () => true }
  })
  const handler = createMessageHandler({
    sock: { user: { id: 'shadow@s.whatsapp.net' }, sendMessage: async (...args) => { sent.push(args); return { key: { id: `out-${sent.length}` } } } },
    commands: { lookup: () => undefined, sudo: { has: () => false } },
    settings: { get: () => ({}) },
    config: { prefix: '.', ownerNumber: '', naturalCommands: false, maxMessageAgeSeconds: 300, chatContextTtlMs: 3 * 60 * 60 * 1000 },
    seen: new Set(), onAutoDelete: async () => {}, aiBrain: brain, log: silent
  })
  const dm = 'friend@s.whatsapp.net'
  const group = '120363000000000001@g.us'
  const incoming = (id, jid, text, pushName = 'Tori', contextInfo = undefined) => ({
    key: { id, remoteJid: jid, ...(jid.endsWith('@g.us') ? { participant: OWNER } : {}) },
    pushName,
    message: { extendedTextMessage: { text, ...(contextInfo ? { contextInfo } : {}) } }
  })

  await handler({ type: 'notify', messages: [
    incoming('dm-1', dm, 'The train leaves at six.', 'Tori'),
    incoming('group-1', group, 'The meeting moved to Thursday.', 'Tori')
  ] })
  assert.equal(requests.length, 0, 'unaddressed conversation is recorded without a Gemini call')
  assert.equal(sent.length, 0, 'unaddressed conversation does not receive a reply')
  assert.match(history.getChatMessages(dm)[0].text, /train leaves at six/)
  assert.match(history.getChatMessages(group)[0].text, /meeting moved to Thursday/)
  assert.notEqual(history.getChatMessages(dm), history.getChatMessages(group))

  await handler({ type: 'notify', messages: [incoming('dm-2', dm, 'Shadow, what did I say earlier about the train?', 'Tori')] })
  assert.equal(requests.length, 1)
  assert.match(requests[0].input, /The train leaves at six/)
  assert.equal(sent.filter(([, payload]) => payload?.text).length, 1, 'one addressed message gets one text reply')
  await brain.flush()
})

test('retrieval selects the named participant and adjacent discussion, not the full transcript', () => {
  const messages = []
  for (let i = 0; i < 40; i += 1) messages.push(message(`m${i}`, `u${i % 3}@s.whatsapp.net`, `Participant ${i % 3} discussed unrelated topic ${i}.`, { speaker: `Participant ${i % 3}`, timestamp: 1000 + i }))
  messages[20] = message('david-key', 'david@s.whatsapp.net', 'The science project is due on Friday; I think the results need a control group.', { speaker: 'David', timestamp: 1020 })
  messages[21] = message('temi-reply', 'temi@s.whatsapp.net', 'Temi asked whether the control group can use water.', { speaker: 'Temi', timestamp: 1021, replyToId: 'david-key', replyToText: 'The science project is due on Friday.' })
  const reference = resolveConversationReference('What do you think about what David said earlier?', { messages, currentSender: OWNER })
  assert.equal(reference.target.speaker, 'David')
  const selected = retrieveRelevantConversation({ messages, prompt: 'What do you think about what David said earlier about the science project?', target: reference.target, maxMessages: 8, maxChars: 2_000, includeRecent: false })
  assert.ok(selected.messages.length <= 8)
  assert.ok(selected.chars <= 2_000)
  assert.ok(selected.messages.some(item => item.id === 'david-key'))
  assert.ok(selected.messages.some(item => item.id === 'temi-reply'), 'a nearby reply keeps conversational flow')
  assert.ok(selected.messages.length < messages.length)
  assert.match(formatConversationContext({ messages: selected.messages, channel: 'group', target: reference.target }), /Resolved reference target: David/)
})

test('ambiguous pronouns ask for clarification, but a prior Shadow reference or quote resolves them', () => {
  const base = [
    message('a1', 'miyamaru@s.whatsapp.net', 'I think we should postpone the plan.', { speaker: 'Miyamaru', timestamp: 1_000 }),
    message('b1', 'temi@s.whatsapp.net', 'I disagree; the venue is already booked.', { speaker: 'Temi', timestamp: 2_000 })
  ]
  const ambiguous = resolveConversationReference('What was she talking about earlier?', { messages: base, currentSender: OWNER })
  assert.match(ambiguous.clarification, /Miyamaru, Temi/)
  const afterShadow = [...base, message('shadow-1', 'shadow', 'Miyamaru made a point about postponing the plan.', { speaker: 'Shadow', role: 'shadow', timestamp: 3_000 })]
  const resolved = resolveConversationReference("What's up with him?", { messages: afterShadow, currentSender: OWNER })
  assert.equal(resolved.target.speaker, 'Miyamaru')
  const quoted = resolveConversationReference('What did she mean by that?', { messages: base, currentSender: OWNER, quoted: { sender: 'temi@s.whatsapp.net', speaker: 'Temi', role: 'participant', text: 'The venue is booked.', stanzaId: 'b1' } })
  assert.equal(quoted.target.speaker, 'Temi')
  assert.equal(quoted.clarification, null)
})

test('message records return immediately while disk writes coalesce to the latest bounded chat snapshot', async () => {
  const slowStore = {
    data: {}, calls: 0,
    get() { return this.data },
    async update(fn) { this.calls += 1; await new Promise(resolve => setTimeout(resolve, 80)); const next = await fn(this.data); if (next !== undefined) this.data = next; return this.data },
    async flush() {}
  }
  const context = createPersistentContextStore(slowStore, { maxChatMessages: 16, chatWriteBatchMs: 1_000, logger: silent })
  const started = performance.now()
  for (let i = 0; i < 24; i += 1) await context.addChatMessage('same-chat@s.whatsapp.net', message(`m${i}`, 'person@s.whatsapp.net', `This is an informative statement about topic number ${i}.`, { timestamp: Date.now() + i }))
  const addElapsedMs = performance.now() - started
  assert.ok(addElapsedMs < 60, `recording should not wait for slow disk writes; got ${Math.round(addElapsedMs)}ms`)
  assert.equal(slowStore.calls, 0, 'all writes are still inside the coalescing window')
  assert.equal(context.getChatMessages('same-chat@s.whatsapp.net').length, 16)
  await context.flush()
  assert.equal(slowStore.calls, 1, 'many messages in one chat coalesce into a single durable snapshot')
  assert.equal(slowStore.data['chat:same-chat@s.whatsapp.net'].messages.length, 16)
  assert.ok(slowStore.data['chat:same-chat@s.whatsapp.net'].summary.some(item => /topic number 0/.test(item.text)))
})

test('bounded transcript and extractive older recap survive a store restart and stay chat-local', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'history.json')
    const firstStore = await createJsonStore(file, {})
    const first = createPersistentContextStore(firstStore, { maxChatMessages: 16, chatWriteBatchMs: 1_000, logger: silent })
    for (let i = 0; i < 19; i += 1) await first.addChatMessage('group-a@g.us', message(`a${i}`, `u${i % 2}@s.whatsapp.net`, `A meaningful discussion point number ${i} about the project timeline.`, { speaker: i % 2 ? 'Temi' : 'David', timestamp: Date.now() + i }))
    await first.addChatMessage('group-b@g.us', message('b1', 'private@s.whatsapp.net', 'A private discussion that stays in another chat.', { speaker: 'Private', timestamp: Date.now() }))
    await first.flush()

    const secondStore = await createJsonStore(file, {})
    const second = createPersistentContextStore(secondStore, { maxChatMessages: 16, chatWriteBatchMs: 1_000, logger: silent })
    const a = second.getChatContext('group-a@g.us')
    assert.equal(a.messages.length, 16)
    assert.ok(a.summary.some(item => /point number 0/.test(item.text)))
    assert.doesNotMatch(JSON.stringify(a), /private discussion/)
    assert.match(second.getChatMessages('group-b@g.us')[0].text, /private discussion/)
    await second.flush()
  })
})

test('the AI asks a single clarification for an ambiguous participant and does not call Gemini', async () => {
  const history = createPersistentContextStore(fakeStore({}), { chatTtlMs: 3 * 60 * 60 * 1000, chatWriteBatchMs: 1_000, logger: silent })
  await history.addChatMessage('120363000000000099@g.us', message('d1', 'david@s.whatsapp.net', 'The meeting should move to Thursday.', { speaker: 'David' }))
  await history.addChatMessage('120363000000000099@g.us', message('t1', 'temi@s.whatsapp.net', 'I would keep the current date.', { speaker: 'Temi' }))
  let providerCalls = 0
  const sent = []
  const brain = createGeminiBrain({
    client: { interactions: { create: async () => { providerCalls += 1; return { output_text: 'should not run' } } } },
    historyStore: history,
    logger: silent,
    config: { geminiFastModel: 'test-fast', geminiTimeoutMs: 1_000 },
    sudo: { has: () => true }
  })
  await brain.run({
    text: 'Shadow, what was she talking about earlier?',
    message: { key: { remoteJid: '120363000000000099@g.us', id: 'followup' } },
    sock: { sendMessage: async (jid, payload) => { sent.push(payload); return { key: { id: 'clarification' } } } },
    sender: OWNER,
    speaker: 'Miyamaru',
    owner: true
  })
  assert.equal(providerCalls, 0)
  assert.equal(sent.filter(item => item?.text).length, 1)
  assert.match(sent.find(item => item?.text).text, /David, Temi/)
  await brain.flush()
})

test('reply IDs, quoted text and mention identities are retained as metadata without merging chats', async () => {
  const context = createPersistentContextStore(fakeStore({}), { chatWriteBatchMs: 1_000, logger: silent })
  await context.addChatMessage('group@g.us', message('reply', 't@s.whatsapp.net', 'I agree with that.', { speaker: 'Temi', replyToId: 'david-1', replyToSender: 'd@s.whatsapp.net', replyToText: 'The plan is ready.', mentions: ['m@s.whatsapp.net'] }))
  const [saved] = context.getChatMessages('group@g.us')
  assert.equal(saved.replyToId, 'david-1')
  assert.equal(saved.replyToSender, 'd@s.whatsapp.net')
  assert.equal(saved.replyToText, 'The plan is ready.')
  assert.deepEqual(saved.mentions, ['m@s.whatsapp.net'])
  assert.equal(context.getChatMessages('other-group@g.us').length, 0)
  await context.flush()
})

test('Gemini replies and immediate follow-ups do not wait for slow turn-history disk writes', async () => {
  const slowStore = {
    data: {}, calls: 0,
    get() { return this.data },
    async update(fn) { this.calls += 1; await new Promise(resolve => setTimeout(resolve, 70)); const next = await fn(this.data); if (next !== undefined) this.data = next; return this.data },
    async flush() {}
  }
  const history = createPersistentContextStore(slowStore, { chatWriteBatchMs: 1_000, logger: silent })
  const requests = []
  const brain = createGeminiBrain({
    client: { interactions: { create: async request => { requests.push(request); return { output_text: `Reply ${requests.length}`, outputs: [] } } } },
    historyStore: history,
    logger: silent,
    config: { geminiFastModel: 'test-fast', geminiTimeoutMs: 1_000 },
    sudo: { has: () => true }
  })
  const sock = { sendMessage: async () => ({ key: { id: `shadow-${requests.length}` } }) }
  const run = id => brain.run({ text: id === 'slow-1' ? 'Shadow, remember this: the meeting begins at nine.' : 'Shadow, what time does the meeting begin?', message: { key: { remoteJid: 'person@s.whatsapp.net', id } }, sock, sender: OWNER, owner: true })

  const started = performance.now()
  await run('slow-1')
  const firstResponseMs = performance.now() - started
  assert.ok(firstResponseMs < 60, `reply path should not wait for 70ms history writes; got ${Math.round(firstResponseMs)}ms`)
  assert.ok(slowStore.calls > 0)
  assert.equal(Object.values(slowStore.data).some(value => Array.isArray(value?.turns)), false, 'the response completes before the slow durable write')

  await run('slow-2')
  assert.match(JSON.stringify(requests[1]), /meeting begins at nine/i, 'the in-memory turn cache supports an immediate follow-up before disk completion')
  assert.ok(slowStore.calls > 0)
  await brain.flush()
  const personalRecord = Object.entries(slowStore.data).find(([key, value]) => !key.startsWith('chat:') && Array.isArray(value?.turns))?.[1]
  assert.deepEqual(personalRecord?.turns?.map(turn => turn.role), ['user', 'model', 'user', 'model'])
})

test('cache invalidation after a store reload exposes refreshed personal and chat history', async () => {
  const store = fakeStore({})
  const context = createPersistentContextStore(store, { chatWriteBatchMs: 1_000, logger: silent })
  await context.add('dm@s.whatsapp.net:person@s.whatsapp.net', 'user', 'Old cached turn.')
  await context.addChatMessage('group@g.us', message('old', 'person@s.whatsapp.net', 'Old cached group message.'))
  await context.flush()
  assert.match(context.get('dm@s.whatsapp.net:person@s.whatsapp.net')[0].content, /Old cached/)
  assert.match(context.getChatMessages('group@g.us')[0].text, /Old cached/)

  store.data = {
    'dm@s.whatsapp.net:person@s.whatsapp.net': { turns: [{ role: 'user', content: 'Reloaded turn.' }], updatedAt: Date.now() },
    'chat:group@g.us': { messages: [message('new', 'other@s.whatsapp.net', 'Reloaded group message.')], summary: [], updatedAt: Date.now() }
  }
  assert.match(context.get('dm@s.whatsapp.net:person@s.whatsapp.net')[0].content, /Old cached/)
  context.invalidateCache()
  assert.match(context.get('dm@s.whatsapp.net:person@s.whatsapp.net')[0].content, /Reloaded turn/)
  assert.match(context.getChatMessages('group@g.us')[0].text, /Reloaded group message/)
})
