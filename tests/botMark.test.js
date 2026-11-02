import test from 'node:test'
import assert from 'node:assert/strict'
import { markBotMessages, reactionFromEnv } from '../src/services/botMark.js'
import { buildCommands } from '../src/commands/registry.js'
import { createMessageHandler } from '../src/handlers/messageHandler.js'
import { createGroupSettings } from '../src/services/groupSettings.js'
import { createSudoService } from '../src/services/sudo.js'
import { config } from '../src/config.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const silent = { debug() {}, warn() {}, error() {} }

function fakeSock({ reactionDelayMs = 0, failReaction = false } = {}) {
  const log = []
  let n = 0
  const sock = {
    user: { id: '2349166712534:28@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      if (content?.react) {
        if (reactionDelayMs) await new Promise(resolve => setTimeout(resolve, reactionDelayMs))
        if (failReaction) throw new Error('rate limited')
        log.push({ type: 'react', jid, text: content.react.text, key: content.react.key })
        return { key: { id: `r-${++n}`, remoteJid: jid, fromMe: true } }
      }
      const key = { id: `out-${++n}`, remoteJid: jid, fromMe: true }
      log.push({ type: 'send', jid, content, key })
      return { key, message: content }
    }
  }
  return { sock, log }
}

test('every message Shadow sends gets a spade reaction on that exact message', async () => {
  const { sock, log } = fakeSock(); markBotMessages(sock, { emoji: '♠️', logger: silent })
  const sent = await sock.sendMessage('chat@s.whatsapp.net', { text: 'hello' })
  assert.equal(sent.key.id, 'out-1', 'the original send result is returned unchanged')
  await tick(); await tick()
  const reaction = log.find(item => item.type === 'react')
  assert.ok(reaction, 'a reaction was sent')
  assert.equal(reaction.text, '♠️'); assert.equal(reaction.key.id, 'out-1'); assert.equal(reaction.jid, 'chat@s.whatsapp.net')
})

test('media, stickers and documents are marked too', async () => {
  const { sock, log } = fakeSock(); markBotMessages(sock, { emoji: '♠️', logger: silent })
  await sock.sendMessage('g@g.us', { sticker: Buffer.from('x') })
  await sock.sendMessage('g@g.us', { image: Buffer.from('x'), caption: 'c' })
  await sock.sendMessage('g@g.us', { document: Buffer.from('x'), fileName: 'a.pdf' })
  await tick(); await tick()
  assert.equal(log.filter(item => item.type === 'react').length, 3)
})

test('reactions, deletions, edits, status and newsletter sends are never marked', async () => {
  const { sock, log } = fakeSock(); markBotMessages(sock, { emoji: '♠️', logger: silent })
  await sock.sendMessage('chat@s.whatsapp.net', { react: { text: '👍', key: { id: 'x' } } })
  await sock.sendMessage('chat@s.whatsapp.net', { delete: { id: 'x', remoteJid: 'chat@s.whatsapp.net', fromMe: true } })
  await sock.sendMessage('chat@s.whatsapp.net', { text: 'edited', edit: { id: 'x', remoteJid: 'chat@s.whatsapp.net', fromMe: true } })
  await sock.sendMessage('status@broadcast', { text: 'status' })
  await sock.sendMessage('1203@newsletter', { text: 'news' })
  await tick(); await tick()
  assert.deepEqual(log.filter(item => item.type === 'react').map(item => item.text), ['👍'], 'only the caller’s own reaction exists')
})

test('a slow or failing reaction never delays or breaks the reply', async () => {
  const slow = fakeSock({ reactionDelayMs: 200 }); markBotMessages(slow.sock, { emoji: '♠️', logger: silent })
  const started = Date.now(); await slow.sock.sendMessage('c@s.whatsapp.net', { text: 'hi' })
  assert.ok(Date.now() - started < 100, 'reply returns without waiting for the reaction')
  const warnings = []
  const failing = fakeSock({ failReaction: true }); markBotMessages(failing.sock, { emoji: '♠️', logger: { ...silent, debug: (...args) => warnings.push(args) } })
  const sent = await failing.sock.sendMessage('c@s.whatsapp.net', { text: 'hi' })
  assert.ok(sent.key.id)
  await tick(); await tick(); await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(warnings.length >= 1, 'the failure is logged, not thrown')
})

test('an empty emoji disables marking and leaves the socket untouched; wrapping twice never double-reacts', async () => {
  const off = fakeSock(); const original = off.sock.sendMessage
  markBotMessages(off.sock, { emoji: '', logger: silent })
  assert.equal(off.sock.sendMessage, original)
  const twice = fakeSock(); markBotMessages(twice.sock, { emoji: '♠️', logger: silent }); markBotMessages(twice.sock, { emoji: '♠️', logger: silent })
  await twice.sock.sendMessage('c@s.whatsapp.net', { text: 'hi' }); await tick(); await tick()
  assert.equal(twice.log.filter(item => item.type === 'react').length, 1)
})

test('reactionFromEnv defaults to the spade, allows disabling, and trims', () => {
  assert.equal(reactionFromEnv(undefined), '♠️')
  assert.equal(reactionFromEnv(''), '')
  assert.equal(reactionFromEnv('  🔥 '), '🔥')
  assert.equal(config.botMessageReaction === undefined, false, 'config exposes the setting')
})

test('end to end: a command reply sent by the real handler carries the spade', async () => {
  const store = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next }, async flush() {} })
  const { sock, log } = fakeSock(); markBotMessages(sock, { emoji: '♠️', logger: silent })
  const cfg = { ...config, ownerNumber: '2349166712534', ownerLid: '', prefix: '.' }
  const sudo = createSudoService(store(['777000111@lid']))
  const settings = createGroupSettings(store({}), cfg)
  const commands = buildCommands({ settings, warnings: store({}), sudo, startedAt: Date.now(), metrics: {}, downloader: null, reactions: null })
  const handle = createMessageHandler({ sock, commands, settings, config: cfg, seen: new Set(), onAutoDelete: async () => {}, aiBrain: null, metrics: {}, log: silent })
  await handle({ messages: [{ key: { id: 'in-1', remoteJid: '777000111@lid', fromMe: false }, message: { conversation: '.quote' } }], type: 'notify' })
  await tick(); await tick(); await tick()
  const reply = log.find(item => item.type === 'send')
  const reaction = log.find(item => item.type === 'react')
  assert.ok(reply && reaction, 'the command replied and was marked')
  assert.equal(reaction.key.id, reply.key.id)
})
