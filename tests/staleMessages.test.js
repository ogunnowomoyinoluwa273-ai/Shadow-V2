import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCommands } from '../src/commands/registry.js'
import { createMessageHandler } from '../src/handlers/messageHandler.js'
import { createGroupSettings } from '../src/services/groupSettings.js'
import { createSudoService } from '../src/services/sudo.js'
import { config } from '../src/config.js'

const store = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next }, async flush() {} })
const SUDO = '777000111@lid'
const GROUP = '120363000000000001@g.us'
const BOT = '2349166712534:28@s.whatsapp.net'
const nowSeconds = () => Math.floor(Date.now() / 1000)
let counter = 0

function harness({ maxAge = 300, chatTtlMs = 3 * 3600 * 1000, aiBrain = null, muted = false } = {}) {
  const sent = []; const infoLogs = []
  const sock = {
    user: { id: BOT },
    sendMessage: async (jid, content) => { sent.push(content); return { key: { id: `out-${++counter}` } } },
    groupMetadata: async () => ({ participants: [{ id: '2349166712534@s.whatsapp.net', admin: 'admin' }] })
  }
  const cfg = { ...config, ownerNumber: '2349166712534', ownerLid: '', prefix: '.', maxMessageAgeSeconds: maxAge, chatContextTtlMs: chatTtlMs }
  const sudo = createSudoService(store([SUDO]))
  const settings = createGroupSettings(store(muted ? { [GROUP]: { mutedParticipants: [SUDO] } } : {}), cfg)
  const commands = buildCommands({ settings, warnings: store({}), sudo, startedAt: Date.now(), metrics: {}, downloader: null, reactions: null })
  const log = { debug() {}, warn() {}, info: (...args) => infoLogs.push(args) }
  const handle = createMessageHandler({ sock, commands, settings, config: cfg, seen: new Set(), onAutoDelete: async () => {}, aiBrain, metrics: {}, log })
  const say = (text, { ageSeconds = 0, timestamp, jid = SUDO, group = false } = {}) => handle({ type: 'notify', messages: [{ key: { id: `m-${++counter}`, remoteJid: group ? GROUP : jid, ...(group ? { participant: SUDO } : {}), fromMe: false }, ...(timestamp === undefined ? (ageSeconds === null ? {} : { messageTimestamp: nowSeconds() - ageSeconds }) : { messageTimestamp: timestamp }), message: { conversation: text } }] })
  return { sent, infoLogs, say }
}

test('a fresh message is handled normally', async () => {
  const h = harness(); await h.say('.quote', { ageSeconds: 5 })
  assert.equal(h.sent.length, 1)
})

test('a message from while Shadow was offline is never acted on', async () => {
  const h = harness(); await h.say('.quote', { ageSeconds: 3600 })
  assert.equal(h.sent.length, 0)
})

test('messages without a timestamp are still handled (nothing to judge by)', async () => {
  const h = harness(); await h.say('.quote', { ageSeconds: null })
  assert.equal(h.sent.length, 1)
})

test('timestamps given as Long-like objects are understood', async () => {
  const h = harness()
  await h.say('.quote', { timestamp: { toNumber: () => nowSeconds() - 7200 } })
  assert.equal(h.sent.length, 0)
  await h.say('.quote', { timestamp: { toNumber: () => nowSeconds() - 2 } })
  assert.equal(h.sent.length, 1)
})

test('a message dated slightly in the future (clock drift) is treated as fresh', async () => {
  const h = harness(); await h.say('.quote', { timestamp: nowSeconds() + 90 })
  assert.equal(h.sent.length, 1)
})

test('MAX_MESSAGE_AGE_SECONDS=0 switches the guard off', async () => {
  const h = harness({ maxAge: 0 }); await h.say('.quote', { ageSeconds: 86400 })
  assert.equal(h.sent.length, 1)
})

test('old "Shadow ..." messages never reach the AI, but recent-enough group chatter is still kept as context', async () => {
  const recorded = []; const runs = []
  const aiBrain = { parseShadowAddress: text => /^shadow\b/i.test(text) ? text.replace(/^shadow[,\s]*/i, '') : null, recordGroupMessage: async input => { recorded.push(input.text); return [] }, run: async input => { runs.push(input.text); return true } }
  const h = harness({ aiBrain })
  await h.say('Shadow, hello from an hour ago', { group: true, ageSeconds: 3600 })
  assert.deepEqual(runs, [], 'not answered')
  assert.deepEqual(recorded, ['Shadow, hello from an hour ago'], 'but remembered as context')
  await h.say('Shadow, hello now', { group: true, ageSeconds: 3 })
  assert.deepEqual(runs, ['Shadow, hello now'])
})

test('messages older than the context window are dropped without any recording or disk work', async () => {
  let writes = 0
  const aiBrain = { parseShadowAddress: () => null, recordGroupMessage: async () => { writes += 1; return [] }, run: async () => true }
  const h = harness({ aiBrain })
  await h.say('a day old chatter', { group: true, ageSeconds: 22 * 3600 })
  assert.equal(writes, 0)
})

test('a muted member’s old messages do not trigger deletions or "muted" notices; fresh ones still do', async () => {
  const stale = harness({ muted: true }); await stale.say('spam', { group: true, ageSeconds: 7200 })
  assert.equal(stale.sent.length, 0)
  const fresh = harness({ muted: true }); await fresh.say('spam', { group: true, ageSeconds: 2 })
  assert.ok(fresh.sent.some(content => content.delete), 'the control case: a fresh muted message is removed')
})

test('a large offline backlog is skipped quickly and logged once, not once per message', async () => {
  let writes = 0
  const aiBrain = { parseShadowAddress: () => null, recordGroupMessage: async () => { writes += 1; return [] }, run: async () => true }
  const h = harness({ aiBrain })
  const started = performance.now()
  for (let i = 0; i < 2000; i += 1) await h.say(`old message ${i}`, { group: true, ageSeconds: 22 * 3600 })
  assert.equal(writes, 0)
  assert.ok(performance.now() - started < 1500, 'skipping 2000 old messages must be fast')
  assert.ok(h.infoLogs.length >= 1 && h.infoLogs.length <= 3, `expected a summary, got ${h.infoLogs.length} log lines`)
})
