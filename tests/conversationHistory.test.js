import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../src/services/jsonStore.js'
import { createPersistentContextStore } from '../src/services/conversationHistory.js'
import { createGeminiBrain } from '../src/services/aiBrain.js'

test('conversation history survives recreation and keeps chat-participant keys separate', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-history-')); const file = path.join(dir, 'history.json')
  try {
    const first = createPersistentContextStore(await createJsonStore(file, {}), { maxTurns: 4 })
    await first.add('chat-a@s.whatsapp.net:user@s.whatsapp.net', 'user', 'My name is Ada')
    await first.add('chat-a@s.whatsapp.net:user@s.whatsapp.net', 'model', 'Nice to meet you, Ada')
    await first.add('group@g.us:user@s.whatsapp.net', 'user', 'Group-only context')
    const restarted = createPersistentContextStore(await createJsonStore(file, {}), { maxTurns: 4 })
    assert.deepEqual(restarted.get('chat-a@s.whatsapp.net:user@s.whatsapp.net').map(turn => turn.content), ['My name is Ada', 'Nice to meet you, Ada'])
    assert.deepEqual(restarted.get('chat-b@s.whatsapp.net:user@s.whatsapp.net'), [])
    assert.deepEqual(restarted.get('group@g.us:other@s.whatsapp.net'), [])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('conversation history is bounded and ignores malformed records', async () => {
  const store = { data: { bad: { turns: [{ role: 'system', content: 'ignore' }, null] } }, get() { return this.data }, async update(fn) { this.data = await fn(this.data) } }
  const history = createPersistentContextStore(store, { maxTurns: 2 })
  assert.deepEqual(history.get('bad'), [])
  await Promise.all([history.add('key', 'user', 'one'), history.add('key', 'model', 'two'), history.add('key', 'user', 'three')])
  assert.deepEqual(history.get('key').map(turn => turn.content), ['two', 'three'])
})

test('group transcript persists speaker identities in order, deduplicates message ids, and isolates groups', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-group-history-')); const file = path.join(dir, 'history.json')
  try {
    const first = createPersistentContextStore(await createJsonStore(file, {}), { maxChatMessages: 4 })
    await first.addChatMessage('group-a@g.us', { id: 'miyamaru-1', sender: 'miyamaru@s.whatsapp.net', speaker: 'Miyamaru', role: 'participant', text: 'I argued with my reflection.' })
    await first.addChatMessage('group-a@g.us', { id: 'shadow-1', sender: 'shadow', speaker: 'Shadow', role: 'shadow', text: 'The reflection had a point.' })
    await first.addChatMessage('group-a@g.us', { id: 'shadow-1', sender: 'shadow', speaker: 'Shadow', role: 'shadow', text: 'Duplicate event.' })
    await first.addChatMessage('group-b@g.us', { id: 'other-1', sender: 'temi@s.whatsapp.net', speaker: 'Temi', text: 'Separate group.' })

    const restarted = createPersistentContextStore(await createJsonStore(file, {}), { maxChatMessages: 4 })
    const messages = restarted.getChatMessages('group-a@g.us')
    assert.deepEqual(messages.map(item => [item.speaker, item.sender, item.role, item.text]), [
      ['Miyamaru', 'miyamaru@s.whatsapp.net', 'participant', 'I argued with my reflection.'],
      ['Shadow', 'shadow', 'shadow', 'The reflection had a point.']
    ])
    assert.deepEqual(restarted.getChatMessages('other-group@g.us'), [])
    assert.equal(restarted.getChatMessages('group-b@g.us')[0].speaker, 'Temi')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('concurrent group transcript and participant history updates do not overwrite each other', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-history-concurrency-')); const file = path.join(dir, 'history.json')
  try {
    const history = createPersistentContextStore(await createJsonStore(file, {}), { maxChatMessages: 16 })
    await Promise.all(Array.from({ length: 8 }, (_, index) => Promise.all([
      history.addChatMessage('busy-group@g.us', { id: `message-${index}`, sender: `user-${index}@s.whatsapp.net`, speaker: `User ${index}`, text: `group message ${index}` }),
      history.add(`private-chat:user-${index}`, 'user', `private turn ${index}`)
    ])))
    const restarted = createPersistentContextStore(await createJsonStore(file, {}), { maxChatMessages: 16 })
    assert.equal(restarted.getChatMessages('busy-group@g.us').length, 8)
    for (let index = 0; index < 8; index += 1) assert.equal(restarted.get(`private-chat:user-${index}`)[0].content, `private turn ${index}`)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('recreated brain supplies saved history once to the next request', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-brain-history-')); const file = path.join(dir, 'history.json'); const store = await createJsonStore(file, {})
  try {
    const config = { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }
    const contextA = createPersistentContextStore(store)
    const clientA = { interactions: { create: async () => ({ output_text: 'Saved reply', steps: [] }) } }
    const brainA = createGeminiBrain({ client: clientA, config, historyStore: contextA, sudo: { has: () => true } })
    const message = { key: { remoteJid: 'chat@s.whatsapp.net', id: 'history-1' } }; const sock = { sendMessage: async () => {} }
    await brainA.run({ text: 'Shadow, my name is Ada', message, sock, sender: 'user@s.whatsapp.net' })
    const requests = []; const contextB = createPersistentContextStore(await createJsonStore(file, {}))
    const brainB = createGeminiBrain({ client: { interactions: { create: async request => { requests.push(request); return { output_text: 'Welcome back, Ada', steps: [] } } } }, config, historyStore: contextB, sudo: { has: () => true } })
    await brainB.run({ text: 'Shadow, do you remember my name?', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'history-2' } }, sock, sender: 'user@s.whatsapp.net' })
    assert.equal(requests.length, 1)
    assert.equal((requests[0].input.match(/my name is Ada/gi) || []).length, 1)
    assert.match(requests[0].input, /do you remember my name/i)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
