import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCommands } from '../src/commands/registry.js'
import { createMessageHandler } from '../src/handlers/messageHandler.js'
import { createGroupSettings } from '../src/services/groupSettings.js'
import { createSudoService } from '../src/services/sudo.js'
import { createGeminiBrain } from '../src/services/aiBrain.js'
import { config } from '../src/config.js'

const memoryStore = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next }, async flush() {} })
const OWNER_PN = '2349166712534'
const cfg = { ...config, ownerNumber: OWNER_PN, ownerLid: '', prefix: '.' }
const BOT = `${OWNER_PN}:28@s.whatsapp.net`
const SUDO_LID = '777000111@lid'
const SUDO_PN = '2348011112222@s.whatsapp.net'
const silent = { debug() {}, warn() {} }
let counter = 0

function harness({ sudoList = [], aiClient = null } = {}) {
  const sent = []; const deleted = []
  const sock = {
    user: { id: BOT, lid: '999@lid' },
    sendMessage: async (jid, content) => { if (content?.delete) deleted.push({ jid, key: content.delete }); else sent.push(content?.text ?? (content?.sticker ? '[sticker]' : '[media]')); return { key: { id: `out-${++counter}` } } },
    groupMetadata: async () => { throw new Error('not a group') }
  }
  const sudo = createSudoService(memoryStore(sudoList))
  const settings = createGroupSettings(memoryStore({}), cfg)
  const commands = buildCommands({ settings, warnings: memoryStore({}), sudo, startedAt: Date.now(), metrics: {}, downloader: null, reactions: null })
  const aiBrain = aiClient ? createGeminiBrain({ client: aiClient, config: { ...cfg, geminiFastModel: 'fast', geminiModel: 'main', geminiTimeoutMs: 1000 }, sudo, logger: silent }) : null
  const handle = createMessageHandler({ sock, commands, settings, config: cfg, seen: new Set(), onAutoDelete: async () => {}, aiBrain, metrics: {}, log: silent })
  const say = key => (text, extra = {}) => handle({ messages: [{ key: { id: `m-${++counter}`, ...key }, message: extra.contextInfo ? { extendedTextMessage: { text, contextInfo: extra.contextInfo } } : { conversation: text } }], type: 'notify' })
  return { sent, deleted, say }
}

test('a sudo user stored as LID is recognised in a DM that arrives under their phone number', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  await h.say({ remoteJid: SUDO_PN, remoteJidAlt: SUDO_LID, fromMe: false })('.quote')
  assert.equal(h.sent.length, 1, 'the command must be answered')
})

test('a sudo user stored as a phone number is recognised in a DM that arrives as LID', async () => {
  const h = harness({ sudoList: [SUDO_PN] })
  await h.say({ remoteJid: SUDO_LID, remoteJidAlt: SUDO_PN, fromMe: false })('.quote')
  assert.equal(h.sent.length, 1)
})

test('a sudo user whose stored identity matches the DM identity still works', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  await h.say({ remoteJid: SUDO_LID, fromMe: false })('.quote')
  assert.equal(h.sent.length, 1)
})

test('in a group the participant’s alternate identity also counts, and the group id itself never grants access', async () => {
  const h = harness({ sudoList: [SUDO_PN, '120363000000000001@g.us'] })
  await h.say({ remoteJid: '120363000000000002@g.us', participant: SUDO_LID, participantAlt: SUDO_PN, fromMe: false })('.quote')
  assert.equal(h.sent.length, 1)
  const stranger = harness({ sudoList: ['120363000000000001@g.us'] })
  await stranger.say({ remoteJid: '120363000000000001@g.us', participant: '555000999@lid', fromMe: false })('.quote')
  assert.equal(stranger.sent.length, 0, 'a sudo entry that is a group id must not authorise its members')
})

test('strangers are still ignored in DMs, whatever identities they present', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  await h.say({ remoteJid: '2347000000000@s.whatsapp.net', remoteJidAlt: '123123@lid', fromMe: false })('.quote')
  assert.equal(h.sent.length, 0)
})

test('sudo users still cannot use owner-only commands, even through an alternate identity', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  await h.say({ remoteJid: SUDO_PN, remoteJidAlt: SUDO_LID, fromMe: false })('.sudos')
  assert.equal(h.sent.length, 0)
})

test('the owner is recognised through an alternate identity in a DM (owner phone number appears only as the alt)', async () => {
  const h = harness()
  await h.say({ remoteJid: '424242@lid', remoteJidAlt: `${OWNER_PN}@s.whatsapp.net`, fromMe: false })('.sudos')
  assert.equal(h.sent.length, 1)
})

test('greet is a group welcome, so it stays group-only', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  await h.say({ remoteJid: SUDO_LID, fromMe: false })('.greet Ada')
  assert.match(h.sent[0], /only be used in a group/i)
})

test('delete and clear work in a private chat on a replied-to message, without needing group admin rights', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  const quote = { stanzaId: 'old-1', participant: BOT, quotedMessage: { conversation: 'oops' } }
  await h.say({ remoteJid: SUDO_LID, fromMe: false })('.delete', { contextInfo: quote })
  await h.say({ remoteJid: SUDO_LID, fromMe: false })('.clear', { contextInfo: { ...quote, stanzaId: 'old-2' } })
  assert.deepEqual(h.deleted.map(item => item.key.id), ['old-1', 'old-2'])
  assert.equal(h.deleted[0].jid, SUDO_LID)
})

test('delete without a replied-to message explains what to do instead of failing silently', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  await h.say({ remoteJid: SUDO_LID, fromMe: false })('.delete')
  assert.match(h.sent[0], /Reply to a message/)
})

test('commands that manage group members stay group-only and say so', async () => {
  const h = harness({ sudoList: [SUDO_LID] })
  for (const name of ['kick', 'mute', 'tagall', 'promote', 'antilink']) await h.say({ remoteJid: SUDO_LID, fromMe: false })(`.${name}`)
  assert.equal(h.sent.length, 5)
  assert.ok(h.sent.every(text => /only be used in a group/i.test(text)))
})

test('Shadow’s AI answers a sudo user in a DM that arrives under a different identity form, and ignores strangers', async () => {
  const calls = []
  const client = { interactions: { create: async request => { calls.push(request); return { output_text: 'Hello there', steps: [] } } } }
  const h = harness({ sudoList: [SUDO_LID], aiClient: client })
  await h.say({ remoteJid: SUDO_PN, remoteJidAlt: SUDO_LID, fromMe: false })('Shadow, hello')
  assert.equal(calls.length, 1)
  assert.ok(h.sent.some(text => /Hello there/.test(text)))
  await h.say({ remoteJid: '2347000000000@s.whatsapp.net', fromMe: false })('Shadow, hello')
  assert.equal(calls.length, 1, 'a stranger must not reach Gemini')
})
