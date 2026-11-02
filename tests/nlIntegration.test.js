import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCommands } from '../src/commands/registry.js'
import { createMessageHandler } from '../src/handlers/messageHandler.js'
import { createGroupSettings } from '../src/services/groupSettings.js'
import { createSudoService } from '../src/services/sudo.js'
import { createNlRouter } from '../src/services/nlCommands.js'
import { config } from '../src/config.js'
import { EXAMPLES, T } from './nlExamples.js'

const GROUP = '120363000000000001@g.us'
const OWNER = '2349166712534@s.whatsapp.net'
const SUDO = '777000111@lid'
const SUDO2 = '888000222@lid'
const STRANGER = '2347000000000@s.whatsapp.net'
const BOT = '2348000000000:5@s.whatsapp.net'
const silent = { debug() {}, warn() {}, info() {} }
const store = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next }, async flush() {} })
let counter = 0

// spy:true replaces every command's run() with a recorder, so we observe exactly what the real dispatcher would execute.
function harness({ spy = true, sudoList = [SUDO], aiBrain = null, settingsData = {}, nlRouter = null, naturalCommands = true, lyricsLookup } = {}) {
  const sent = []; const calls = []; const updates = []
  const sock = {
    user: { id: BOT },
    sendMessage: async (jid, content) => { sent.push(content?.text ?? (content?.delete ? '[delete]' : '[media]')); return { key: { id: `out-${++counter}` } } },
    groupMetadata: async () => ({ id: GROUP, participants: [{ id: OWNER, admin: 'admin' }, { id: '2348000000000@s.whatsapp.net', admin: 'admin' }, { id: T }, { id: SUDO }] }),
    groupParticipantsUpdate: async (...args) => { updates.push(args); return [{ status: '200' }] }
  }
  const cfg = { ...config, ownerNumber: '2349166712534', ownerLid: '', prefix: '.', naturalCommands }
  const sudo = createSudoService(store(sudoList))
  const settings = createGroupSettings(store(settingsData), cfg)
  const commands = buildCommands({ settings, warnings: store({}), sudo, startedAt: Date.now(), metrics: {}, downloader: null, reactions: null, ...(lyricsLookup ? { lyricsLookup } : {}) })
  if (spy) for (const command of commands.allCommands) command.run = async ctx => { calls.push({ name: command.name, args: ctx.args.join(' '), messageId: ctx.message.key.id }) }
  const handle = createMessageHandler({ sock, commands, settings, config: cfg, seen: new Set(), onAutoDelete: async () => {}, aiBrain, nlRouter, metrics: {}, log: silent })
  const say = (from, text, { group = true, mention, quote, id = `m-${++counter}` } = {}) => {
    const who = { owner: OWNER, sudo: SUDO, sudo2: SUDO2, stranger: STRANGER }[from]
    const contextInfo = {}
    if (mention) contextInfo.mentionedJid = [mention]
    if (quote) Object.assign(contextInfo, { stanzaId: quote.id, participant: quote.participant, quotedMessage: { conversation: quote.text } })
    const body = Object.keys(contextInfo).length ? { extendedTextMessage: { text, contextInfo } } : { conversation: text }
    return handle({ type: 'notify', messages: [{ key: { id, remoteJid: group ? GROUP : who, ...(group ? { participant: who } : {}), fromMe: false }, pushName: from, message: body }] }).then(() => id)
  }
  return { say, sent, calls, updates, commands, sock }
}
const router = createNlRouter({ commands: harness().commands })
const confirmText = /confirm/i

// ---- every registered command, through the real dispatcher -------------------------------------------------------------
for (const [name, said, opts, expected] of EXAMPLES) {
  test(`pipeline: "Shadow, ${said}" runs .${name} immediately`, async () => {
    const h = harness()
    const id = await h.say('owner', `Shadow, ${said}`, opts)
    assert.deepEqual(h.calls, [{ name, args: expected, messageId: id }], 'the registered handler ran once, with the right arguments and the original message')
    assert.ok(!h.sent.some(text => confirmText.test(text)), 'natural-language commands do not add a second confirmation')
  })

  test(`unchanged: typed ".${name}" still runs at once, with no confirmation`, async () => {
    const h = harness(); const id = await h.say('owner', `.${name}${expected ? ` ${expected}` : ''}`, opts)
    assert.deepEqual(h.calls, [{ name, args: expected, messageId: id }])
    assert.ok(!h.sent.some(text => confirmText.test(text)))
  })
}

// ---- permissions are exactly the pipeline's -----------------------------------------------------------------------------
test('strangers get nothing: no command, no clarification, no confirmation', async () => {
  const h = harness()
  await h.say('stranger', 'Shadow, ping.'); await h.say('stranger', 'Shadow, kick', {}); await h.say('stranger', 'Shadow, remove this member', { mention: T })
  assert.deepEqual(h.calls, []); assert.deepEqual(h.sent, [])
})

test('a sudo user can use ordinary and group commands, but never owner-only commands', async () => {
  const h = harness()
  await h.say('sudo', 'Shadow, ping.')
  assert.deepEqual(h.calls.map(call => call.name), ['ping'])
  await h.say('sudo', 'Shadow, who are the sudo users?'); await h.say('sudo', 'Shadow, show me your diagnostics'); await h.say('sudo', 'Shadow, broadcast: hello everyone')
  assert.deepEqual(h.calls.map(call => call.name), ['ping'], 'owner-only commands are refused exactly as when typed')
  assert.ok(!h.sent.some(text => confirmText.test(text)), 'and Shadow does not even ask to confirm something that would be refused')
  await h.say('sudo', 'Shadow, mute this member', { mention: T })
  assert.deepEqual(h.calls.map(call => call.name), ['ping', 'mute'])
})

test('private chats: group-only commands are refused with the usual message and never ask for confirmation', async () => {
  const h = harness()
  await h.say('sudo', 'Shadow, tag everyone in this group.', { group: false })
  await h.say('sudo', 'Shadow, remove this member from the group.', { group: false, mention: T })
  assert.deepEqual(h.calls, [])
  assert.equal(h.sent.filter(text => /only be used in a group/i.test(text)).length, 2)
  assert.ok(!h.sent.some(text => confirmText.test(text)))
  await h.say('sudo', 'Shadow, are you alive?', { group: false })
  assert.deepEqual(h.calls.map(call => call.name), ['alive'])
})

test('a command disabled in the group is refused through natural language exactly as when typed', async () => {
  const h = harness({ settingsData: { [GROUP]: { disabledCommands: ['ping'] } } })
  await h.say('sudo', '.ping'); const typed = [...h.sent]
  await h.say('sudo', 'Shadow, ping.')
  assert.deepEqual(h.calls, [])
  assert.ok(typed.length >= 1 && h.sent.length === typed.length * 2, 'same refusal message both ways')
  assert.deepEqual(h.sent.slice(typed.length), typed)
})

// ---- clarification and authorization behaviour ---------------------------------------------------------------------------
test('missing information is asked for, nothing is executed, and a later "yes" does nothing', async () => {
  const h = harness()
  await h.say('owner', 'Shadow, kick')
  assert.match(h.sent.at(-1), /Who should I remove/)
  await h.say('owner', 'Shadow, yes')
  assert.deepEqual(h.calls, [])
})

test('recognized sensitive actions execute immediately and cancel is not a second confirmation step', async () => {
  const h = harness()
  await h.say('owner', 'Shadow, remove this member from the group', { mention: T })
  assert.deepEqual(h.calls.map(call => call.name), ['kick'])
  await h.say('owner', 'Shadow, cancel')
  assert.deepEqual(h.calls.map(call => call.name), ['kick'])
})

test('recognized sensitive actions do not create a pending confirmation for another user', async () => {
  const h = harness({ sudoList: [SUDO, SUDO2] })
  await h.say('sudo', 'Shadow, mute this member', { mention: T })
  await h.say('sudo2', 'Shadow, yes')
  assert.deepEqual(h.calls.map(call => call.name), ['mute'])
})

test('sensitive natural-language actions retain the original message context', async () => {
  const h = harness()
  await h.say('owner', 'Shadow, tag everyone in this group.')
  const id = await h.say('owner', 'Shadow, delete this message', { quote: { id: 'old-9', participant: T, text: 'bad message' } })
  assert.deepEqual(h.calls, [{ name: 'tagall', args: '', messageId: h.calls[0].messageId }, { name: 'delete', args: '', messageId: id }])
})

// ---- real handlers, not spies -------------------------------------------------------------------------------------------
test('real .kick through natural language executes immediately and removes exactly the tagged member', async () => {
  const h = harness({ spy: false })
  await h.say('owner', 'Shadow, remove this member from the group.', { mention: T })
  assert.equal(h.updates.length, 1)
  assert.deepEqual(h.updates[0], [GROUP, [T], 'remove'])
})

test('the real admin check still applies: a sudo user who is not a group admin gets the same result by typing or by asking', async () => {
  const typed = harness({ spy: false }); await typed.say('sudo', `.kick ${T}`)
  const natural = harness({ spy: false }); await natural.say('sudo', 'Shadow, kick this member', { mention: T })
  assert.equal(typed.updates.length, natural.updates.length, 'same enforcement')
  assert.equal(natural.updates.length, 0, 'a non-admin cannot remove anyone')
})

test('real read-only commands answer through natural language', async () => {
  const h = harness({ spy: false })
  await h.say('sudo', 'Shadow, ping.'); await h.say('sudo', 'Shadow, are you alive?'); await h.say('sudo', 'Shadow, show me your commands.')
  assert.ok(h.sent.length >= 3)
  assert.ok(h.sent.some(text => /ping|pong|latency|ms/i.test(text)))
  assert.ok(h.sent.some(text => /𝐋𝐘𝐑𝐈𝐂𝐒/.test(text)), 'the rendered menu lists the lyrics command in its existing bold style')
})

test('real .lyrics command and natural-language lookup return only song metadata and a Genius link', async () => {
  const lookups = []
  const lyricsLookup = async query => { lookups.push(query); return [{ title: 'Blinding Lights', artist: 'The Weeknd', url: 'https://genius.com/search?q=Blinding%20Lights%20The%20Weeknd' }] }
  const typed = harness({ spy: false, lyricsLookup })
  await typed.say('owner', '.lyrics Blinding Lights - The Weeknd', { group: false })
  assert.match(typed.sent.at(-1), /Blinding Lights — The Weeknd/)
  assert.match(typed.sent.at(-1), /genius\.com/)
  assert.doesNotMatch(typed.sent.at(-1), /\[00:|\bplainLyrics\b/i)
  const natural = harness({ spy: false, lyricsLookup })
  await natural.say('owner', 'Shadow, find lyrics for Blinding Lights by The Weeknd', { group: false })
  assert.match(natural.sent.at(-1), /Blinding Lights — The Weeknd/)
  assert.deepEqual(lookups, ['Blinding Lights - The Weeknd', 'Blinding Lights by The Weeknd'])
})

// ---- interaction with the AI and the switch -----------------------------------------------------------------------------
function fakeAi() {
  const runs = []
  return { runs, parseShadowAddress: text => { const m = String(text).match(/^\s*shadow\b[\s,:]*([\s\S]*)$/i); return m ? m[1] : null }, run: async input => { runs.push(input.text); return true } }
}

test('ordinary conversation still goes to the AI, and routed commands never reach it', async () => {
  const ai = fakeAi(); const h = harness({ aiBrain: ai })
  await h.say('sudo', 'Shadow, tell me a joke about kicking')
  assert.deepEqual(ai.runs, ['Shadow, tell me a joke about kicking']); assert.deepEqual(h.calls, [])
  await h.say('sudo', 'Shadow, ping.')
  assert.equal(ai.runs.length, 1, 'the AI is not consulted for a recognised command')
  assert.deepEqual(h.calls.map(call => call.name), ['ping'])
})

test('natural-language commands work even when the AI is not configured', async () => {
  const h = harness({ aiBrain: null }); await h.say('sudo', 'Shadow, are you alive?')
  assert.deepEqual(h.calls.map(call => call.name), ['alive'])
})

test('NATURAL_COMMANDS=off disables the feature and leaves everything else alone', async () => {
  const ai = fakeAi(); const h = harness({ aiBrain: ai, naturalCommands: false })
  await h.say('sudo', 'Shadow, ping.'); assert.deepEqual(h.calls, []); assert.deepEqual(ai.runs, ['Shadow, ping.'])
  await h.say('sudo', '.ping'); assert.deepEqual(h.calls.map(call => call.name), ['ping'])
})
