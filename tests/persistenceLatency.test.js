import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiBrain } from '../src/services/aiBrain.js'

const CHAT = 'chat@s.whatsapp.net'
const SLOW_WRITE_MS = 150

// A history store whose writes are slow, like a busy JSON store on a slow disk.
function slowStore(events, { fail = false } = {}) {
  const turns = []
  return {
    turns,
    get: () => [],
    getChatMessages: () => [],
    add: (key, role) => new Promise((resolve, reject) => setTimeout(() => {
      if (fail) { events.push(`write-${role}-failed`); reject(new Error('disk is on fire')); return }
      events.push(`write-${role}-done`); turns.push(role); resolve()
    }, SLOW_WRITE_MS)),
    flush: async () => {}
  }
}

function setup({ fail = false, logger = { debug() {}, warn() {}, error() {} } } = {}) {
  const events = []
  const historyStore = slowStore(events, { fail })
  const client = { interactions: { create: async () => { events.push('gemini-called'); return { output_text: 'a perfectly fine answer', steps: [] } } } }
  const sock = { sendMessage: async (jid, content) => { if (content?.text) events.push('reply-sent'); return { key: { id: 'sent-1' } } } }
  const brain = createGeminiBrain({ client, historyStore, logger, config: { geminiModel: 'main-test', geminiFastModel: 'fast-test', geminiTimeoutMs: 2000 }, sudo: { has: () => true } })
  const run = text => brain.run({ text, message: { key: { remoteJid: CHAT, id: `m-${Math.random()}` } }, sock, sender: CHAT, owner: true })
  return { events, historyStore, brain, run }
}

test('the Gemini request starts without waiting for the slow user-turn history write', async () => {
  const { events, brain, run } = setup()
  await run('Shadow, tell me something interesting')
  assert.ok(events.includes('gemini-called'), `order was ${events.join(' > ')}`)
  assert.ok(!events.includes('write-user-done'), `the user-turn write should remain pending: ${events.join(' > ')}`)
  await brain.flush()
  assert.ok(events.indexOf('gemini-called') < events.indexOf('write-user-done'), `order was ${events.join(' > ')}`)
})

test('the reply is sent without waiting for the slow model-turn history write', async () => {
  const { events, brain, run } = setup()
  await run('Shadow, tell me something interesting')
  assert.ok(events.includes('reply-sent'), `order was ${events.join(' > ')}`)
  assert.ok(!events.includes('write-model-done'), `the model-turn write should remain pending: ${events.join(' > ')}`)
  await brain.flush()
  assert.ok(events.indexOf('reply-sent') < events.indexOf('write-model-done'), `order was ${events.join(' > ')}`)
})

test('run() resolves before disk writes; flush() persists both turn records in order', async () => {
  const { events, historyStore, brain, run } = setup()
  await run('Shadow, tell me something interesting')
  assert.ok(!events.includes('write-user-done') || !events.includes('write-model-done'), `run should not wait for both writes: ${events.join(' > ')}`)
  assert.deepEqual(historyStore.turns, [])
  await brain.flush()
  assert.ok(events.includes('write-user-done') && events.includes('write-model-done'), `order was ${events.join(' > ')}`)
  assert.deepEqual(historyStore.turns, ['user', 'model'])
})

test('flush() waits for background history writes so nothing is lost on shutdown', async () => {
  const { historyStore, brain, run } = setup()
  const pending = run('Shadow, tell me something interesting')
  await new Promise(resolve => setTimeout(resolve, 20))
  await brain.flush()
  assert.deepEqual(historyStore.turns, ['user', 'model'])
  await pending
})

test('a failing history write is logged and never replaces a good answer with an error message', async () => {
  const warnings = []
  const { events, brain, run } = setup({ fail: true, logger: { debug() {}, error() {}, warn: (...args) => warnings.push(args) } })
  const handled = await run('Shadow, tell me something interesting')
  await brain.flush()
  assert.equal(handled, true)
  assert.ok(events.includes('reply-sent'), `order was ${events.join(' > ')}`)
  assert.ok(warnings.length >= 1, 'the write failure must be logged')
})
