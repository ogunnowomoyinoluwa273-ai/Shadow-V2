import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extractText, getMentions, getQuoted, getQuotedMessageInfo, parseCommand } from '../src/utils/message.js'
import { detectProhibitedLink } from '../src/services/antiLink.js'
import { renderTemplate } from '../src/services/welcome.js'
import { isAdmin, isOwner, authenticatedAccountIsOwner, botIsAdmin } from '../src/utils/permissions.js'
import { classifyQuotedSender, createMessageHandler } from '../src/handlers/messageHandler.js'
import { attachHandlers } from '../src/handlers/eventHandler.js'
import { buildCommands, renderHelp, renderMenu } from '../src/commands/registry.js'
import { calculate } from '../src/services/calculator.js'
import { mediaType, resolveFfmpeg } from '../src/services/media.js'
import { buildTranslationRequest, define } from '../src/services/webTools.js'
import { createMessageCache, recoverDeletedMessage } from '../src/services/antiDelete.js'
import { buildAudioArgs, buildVideoArgs, createDownloader, formatMaxFileSize, formatSizeLimitMessage, validateAnimeThemeUrl, validateMediaUrl, videoMimeType } from '../src/services/downloader.js'
import { animeThemes, createQuizService, parseBattleArgs } from '../src/services/anime.js'
import { createReactionService, REACTION_ACTIONS } from '../src/services/reactions.js'
import { createTsundereService, TSUNDERE_LINES } from '../src/services/tsundere.js'
import { measuredPingLatencyMs } from '../src/services/ping.js'
import { errorLogDetails, GENERIC_FAILURE_MESSAGE, UserFacingError } from '../src/utils/errors.js'
import { createFatalProcessErrorHandler } from '../src/utils/processSafety.js'
import { createToolRegistry } from '../src/services/aiBrain.js'

function webpChunk(name, payload) {
  const padding = payload.length & 1
  const header = Buffer.alloc(8)
  header.write(name, 0, 4, 'ascii')
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload, Buffer.alloc(padding)])
}
function animatedWebpFixture({ width = 512, height = 512, durations = [100, 100], frameDataBytes = 4 } = {}) {
  const extended = Buffer.alloc(10)
  extended[0] = 0x02
  extended.writeUIntLE(width - 1, 4, 3)
  extended.writeUIntLE(height - 1, 7, 3)
  const animation = Buffer.alloc(6)
  const frames = durations.map(duration => {
    const frame = Buffer.alloc(24 + frameDataBytes)
    frame.writeUIntLE(511, 6, 3)
    frame.writeUIntLE(511, 9, 3)
    frame.writeUIntLE(duration, 12, 3)
    frame.write('VP8 ', 16, 4, 'ascii')
    frame.writeUInt32LE(frameDataBytes, 20)
    return webpChunk('ANMF', frame)
  })
  const body = Buffer.concat([Buffer.from('WEBP'), webpChunk('VP8X', extended), webpChunk('ANIM', animation), ...frames])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 4, 'ascii')
  riff.writeUInt32LE(body.length, 4)
  return Buffer.concat([riff, body])
}
function reactionResponse(bytes, contentType, url) {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : name.toLowerCase() === 'content-length' ? String(bytes.length) : null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
}
function mockReactionFetch({ defaultGifUrl, gifByCategory = {}, mediaByUrl = new Map(), gifBytes = Buffer.from('GIF89a-test-animation') } = {}) {
  const requested = []
  if (defaultGifUrl && !mediaByUrl.has(defaultGifUrl)) mediaByUrl.set(defaultGifUrl, gifBytes)
  const fetchImpl = async input => {
    const url = new URL(input)
    requested.push(url)
    if (url.hostname === 'animegifs-enkidu.koyeb.app') {
      const gif = gifByCategory[url.searchParams.get('category')] || defaultGifUrl
      return reactionResponse(Buffer.from(JSON.stringify({ gif })), 'application/json', url.href)
    }
    if (mediaByUrl.has(url.href)) return reactionResponse(mediaByUrl.get(url.href), 'image/gif', url.href)
    throw new Error(`Unexpected network target in test: ${url.href}`)
  }
  return { fetchImpl, requested }
}

test('parses configured prefixes and arguments', () => { assert.deepEqual(parseCommand('.ping now', '.'), { command: 'ping', args: ['now'], rawArgs: 'now' }); assert.equal(parseCommand('!ping', '.'), null) })
test('rejects empty command after prefix', () => assert.equal(parseCommand('.', '.'), null))
test('extracts quoted context and mentions from image-caption messages', () => {
  const message = { key: { remoteJid: '123-456@g.us' }, message: { imageMessage: { caption: '.translate', contextInfo: { stanzaId: 'quoted-1', participant: 'user@s.whatsapp.net', mentionedJid: ['target@s.whatsapp.net'], quotedMessage: { conversation: 'Bonjour' } } } } }
  assert.equal(extractText(message), '.translate')
  assert.deepEqual(getMentions(message), ['target@s.whatsapp.net'])
  assert.equal(getQuoted(message).message.conversation, 'Bonjour')
})
test('extracts quoted sender, text, and media metadata without confusing the requester', () => {
  const message = { key: { remoteJid: '123-456@g.us' }, message: { extendedTextMessage: { text: 'Shadow, what do you think?', contextInfo: { stanzaId: 'quoted-2', participant: 'other@s.whatsapp.net', quotedMessage: { imageMessage: { caption: 'Shadow is stupid', mimetype: 'image/jpeg' } } } } } }
  const info = getQuotedMessageInfo(message)
  assert.equal(info.sender, 'other@s.whatsapp.net')
  assert.equal(info.text, 'Shadow is stupid')
  assert.equal(info.type, 'imageMessage')
  assert.equal(info.mimetype, 'image/jpeg')
  assert.equal(info.hasCaption, true)
})
test('classifies quoted participant, verified owner, and Shadow identities separately', () => {
  const config = { ownerNumber: '+2349166712534', ownerLid: 'owner-lid@lid' }
  const sock = { user: { id: 'shadow-lid@lid', phoneNumber: '2349166712534@s.whatsapp.net' } }
  assert.equal(classifyQuotedSender({ sender: 'friend@s.whatsapp.net' }, sock, config), 'participant')
  assert.equal(classifyQuotedSender({ sender: '2349166712534@s.whatsapp.net' }, { user: { id: 'bot-lid@lid', phoneNumber: '999@s.whatsapp.net' } }, config), 'owner')
  assert.equal(classifyQuotedSender({ sender: 'shadow-lid@lid' }, sock, config), 'shadow')
  assert.equal(classifyQuotedSender({ sender: '' }, sock, config), 'unknown')
})
test('extracts document captions and detects wrapped media types', () => {
  const document = { message: { ephemeralMessage: { message: { documentMessage: { caption: 'translated document' } } } } }
  assert.equal(extractText(document), 'translated document')
  assert.equal(mediaType(document), 'documentMessage')
})
test('detects group invite links only when enabled', () => { assert.equal(detectProhibitedLink('join https://chat.whatsapp.com/abc', { antiLink: true }), true); assert.equal(detectProhibitedLink('https://example.com', { antiLink: true, antiLinkAllUrls: false }), false); assert.equal(detectProhibitedLink('https://example.com', { antiLink: true, antiLinkAllUrls: true }), true) })
test('renders welcome placeholders with mentions', () => assert.equal(renderTemplate('Hi {user} in {group} ({count})', { user: '123@s.whatsapp.net', group: 'Test', count: 4 }), 'Hi @123 in Test (4)'))
test('checks owner by normalized configured phone number', () => assert.equal(isOwner('12345@s.whatsapp.net', { ownerNumber: '+1 2345' }), true))
test('checks administrator role', () => assert.equal(isAdmin({ participants: [{ id: 'a@s.whatsapp.net', admin: 'admin' }] }, 'a@s.whatsapp.net'), true))
test('recognizes bot administrator through rc14 LID, phone number, and device identities', () => {
  const metadata = { participants: [{ id: '12345@lid', phoneNumber: '2349166712534@s.whatsapp.net', admin: 'admin' }] }
  assert.equal(botIsAdmin(metadata, { user: { id: '12345@lid' } }), true)
  assert.equal(botIsAdmin(metadata, { user: { id: '2349166712534:0@s.whatsapp.net' } }), true)
})
test('recognizes the configured owner through the authenticated PN identity even when the socket id is a LID', () => assert.equal(authenticatedAccountIsOwner({ user: { id: '98765@lid', phoneNumber: '2349166712534@s.whatsapp.net' } }, { ownerNumber: '+2349166712534' }), true))
test('processes owner self-commands and participant commands, but ignores ordinary self-messages', async () => {
  const processed = []
  const command = { name: 'ping', aliases: [], run: async ({ message }) => processed.push(message.key.participant || 'owner-self') }
  const makeMessage = (id, key, text) => ({ key: { id, remoteJid: '123-456@g.us', ...key }, message: { conversation: text } })
  const base = { commands: { lookup: name => name === 'ping' ? command : undefined, sudo: { has: jid => jid === '99999@s.whatsapp.net' } }, settings: { get: () => ({}) }, config: { prefix: '.', ownerNumber: '+2349166712534' }, seen: new Set(), onAutoDelete: async () => {}, }
  const ownerSock = { user: { id: '98765@lid', phoneNumber: '2349166712534@s.whatsapp.net' }, sendMessage: async () => {} }
  await createMessageHandler({ ...base, sock: ownerSock })({ messages: [makeMessage('self-1', { fromMe: true }, '.ping')], type: 'notify' })
  await createMessageHandler({ ...base, sock: ownerSock })({ messages: [makeMessage('friend-1', { participant: '99999@s.whatsapp.net' }, '.ping')], type: 'notify' })
  const otherSock = { user: { id: '11111@s.whatsapp.net', phoneNumber: '11111@s.whatsapp.net' }, sendMessage: async () => {} }
  await createMessageHandler({ ...base, sock: otherSock })({ messages: [makeMessage('self-2', { fromMe: true }, 'ordinary outgoing text')], type: 'notify' })
  assert.deepEqual(processed, ['owner-self', '99999@s.whatsapp.net'])
})
test('message handler passes replies to Gemini with distinct quoted sender roles', async () => {
  const calls = []
  const handler = createMessageHandler({
    sock: { user: { id: 'shadow-lid@lid', phoneNumber: '2349166712534@s.whatsapp.net' }, sendMessage: async () => {} },
    commands: { lookup: () => undefined, sudo: { has: jid => jid === 'requester@s.whatsapp.net' } },
    settings: { get: () => ({}) },
    config: { prefix: '.', ownerNumber: '+2349166712534' },
    seen: new Set(), onAutoDelete: async () => {},
    aiBrain: { parseShadowAddress: value => value.match(/^Shadow[,:]?\s*(.*)$/i)?.[1] ?? null, run: async value => { calls.push(value); return true } }
  })
  const makeReply = (id, participant, quotedParticipant, quotedText) => ({ key: { id, remoteJid: '123-456@g.us', participant }, message: { extendedTextMessage: { text: 'Shadow, what do you think?', contextInfo: { stanzaId: `${id}-quoted`, participant: quotedParticipant, quotedMessage: { conversation: quotedText } } } } })
  await handler({ type: 'notify', messages: [makeReply('reply-other', 'requester@s.whatsapp.net', 'friend@s.whatsapp.net', 'Shadow is stupid'), makeReply('reply-shadow', 'requester@s.whatsapp.net', 'shadow-lid@lid', 'I said the answer was 42.')] })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].quoted.role, 'participant')
  assert.equal(calls[0].quoted.sender, 'friend@s.whatsapp.net')
  assert.equal(calls[1].quoted.role, 'shadow')
  assert.equal(calls[1].quoted.text, 'I said the answer was 42.')
})
test('message handler records ordinary group turns and supplies them to the next addressed follow-up', async () => {
  const transcript = []
  const calls = []
  const handler = createMessageHandler({
    sock: { user: { id: 'shadow-lid@lid' }, sendMessage: async () => {} },
    commands: { lookup: () => undefined, sudo: { has: jid => jid === 'gafar@s.whatsapp.net' } },
    settings: { get: () => ({}) },
    config: { prefix: '.', ownerNumber: '+2349166712534' },
    seen: new Set(), onAutoDelete: async () => {},
    aiBrain: {
      parseShadowAddress: value => value.match(/^Shadow[,:]?\s*(.*)$/i)?.[1] ?? null,
      recordGroupMessage: async value => { const prior = transcript.slice(); transcript.push(value); return prior },
      run: async value => { calls.push(value); return true }
    }
  })
  const groupMessage = (id, participant, pushName, text, contextInfo = undefined) => ({
    key: { id, remoteJid: '123-456@g.us', participant },
    pushName,
    message: { extendedTextMessage: { text, ...(contextInfo ? { contextInfo } : {}) } }
  })
  await handler({ type: 'notify', messages: [
    groupMessage('temi-1', 'temi@s.whatsapp.net', 'Temi', 'Welcome, Gafar. Good to have you here.'),
    groupMessage('gafar-1', 'gafar@s.whatsapp.net', 'Gafar', "Shadow, what's up with him?", { stanzaId: 'quoted-miyamaru', participant: 'miyamaru@s.whatsapp.net', quotedMessage: { conversation: 'I keep arguing with my reflection.' } })
  ] })
  assert.equal(transcript.length, 2)
  assert.deepEqual(calls[0].recentMessages.map(item => [item.speaker, item.sender, item.text]), [['Temi', 'temi@s.whatsapp.net', 'Welcome, Gafar. Good to have you here.']])
  assert.equal(calls[0].speaker, 'Gafar')
  assert.equal(calls[0].quoted.sender, 'miyamaru@s.whatsapp.net')
  assert.equal(calls[0].quoted.text, 'I keep arguing with my reflection.')
})
test('sudo service persists and revokes normalized participant identities', async () => {
  const { createSudoService } = await import('../src/services/sudo.js')
  let value = []
  const service = createSudoService({ get: () => value, update: async fn => { value = await fn(value); return value } })
  await service.add('99999@S.WHATSAPP.NET')
  assert.equal(service.has('99999@s.whatsapp.net'), true)
  await service.remove('99999@s.whatsapp.net')
  assert.equal(service.has('99999@s.whatsapp.net'), false)
})
test('renders a branded categorized menu with dynamic prefix, owner, uptime, and implemented commands', () => {
  const text = renderMenu({ commands: [{ name: 'ping', aliases: [], description: 'Check responsiveness.' }, { name: 'promote', aliases: [], description: 'Promote a participant.', category: 'Group Administration' }], config: { botName: 'Shadow', ownerName: 'Shadow Ace', prefix: '!' }, startedAt: Date.now() - 60000 })
  assert.match(text, /SHADOW COMMAND PANEL/)
  assert.match(text, /Owner\s+: Shadow Ace/)
  assert.match(text, /Prefix\s+: !/)
  assert.match(text, /BOT/)
  assert.match(text, /GROUP/)
  assert.match(text, /!\*𝐏𝐈𝐍𝐆\*/)
  assert.match(text, /!\*𝐏𝐑𝐎𝐌𝐎𝐓𝐄\*/)
  assert.doesNotMatch(text, /Check responsiveness|Promote a participant|owner|group|—/)
})
test('keeps menu and help visually distinct while sharing implemented commands', () => {
  const commands = [{ name: 'ping', aliases: [], description: 'Check responsiveness.' }, { name: 'ytv', aliases: [], description: 'Download public video.' }]
  const menu = renderMenu({ commands, config: { botName: 'Shadow', ownerName: 'Miyamaru', prefix: '.', version: '1.0.0' }, startedAt: Date.now() })
  const help = renderHelp({ commands, config: { botName: 'Shadow', ownerName: 'Miyamaru', prefix: '.', version: '1.0.0' }, startedAt: Date.now() })
  assert.match(menu, /COMMAND PANEL/)
  assert.match(menu, /Commands:\s+2/)
  assert.match(menu, /\.\*𝐘𝐓𝐕\*/)
  assert.match(menu, /\.\*𝐏𝐈𝐍𝐆\*/)
  assert.doesNotMatch(menu, /Download public video|Check responsiveness|—/)
  assert.doesNotMatch(menu, /Welcome to Shadow control center/)
  assert.match(help, /Welcome to Shadow control center/)
  assert.match(help, /General/)
})
test('menu falls back to a text caption when the owner profile picture cannot be retrieved', async () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  const sent = []
  const sock = { user: { id: 'owner@lid' }, profilePictureUrl: async () => { throw new Error('profile unavailable') }, sendMessage: async (...args) => sent.push(args) }
  let replyText = ''
  await registry.lookup('menu').run({ sock, message: { key: { remoteJid: 'chat@s.whatsapp.net' } }, reply: async text => { replyText = text } })
  assert.equal(sent.length, 0)
  assert.match(replyText, /SHADOW/)
  assert.match(replyText, /GENERAL/)
})
test('help renders command details and a useful unknown-command response', async () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  const outputs = []
  const runHelp = args => registry.lookup('help').run({ args, reply: async text => outputs.push(text) })
  await runHelp(['ping'])
  await runHelp(['ytv'])
  await runHelp(['not-a-real-command'])
  assert.match(outputs[0], /\.ping/)
  assert.match(outputs[1], /\.ytv/)
  assert.match(outputs[2], /Unknown command/)
  assert.match(outputs[2], /Use \.help/)
})
test('registers the Phase 2 moderation and diagnostics commands', () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  for (const name of ['mute', 'unmute', 'slowmode', 'clear', 'antidelete', 'stats', 'reload', 'broadcast', 'enablecmd', 'disablecmd']) assert.ok(registry.lookup(name), `${name} should be registered`)
})
test('registers the requested media, group, utility, and QR commands', () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  for (const name of ['sticker', 'toimage', 'tomp3', 'media', 'yta', 'ytv', 'play', 'tiktok', 'insta', 'fb', 'twitter', 'setname', 'setdescription', 'invite', 'revokeinvite', 'joinrequest', 'group', 'weather', 'translate', 'calculate', 'define', 'shortlink', 'qr']) assert.ok(registry.lookup(name), `${name} should be registered`)
})
test('registers all requested anime commands', () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  for (const name of ['anime', 'character', 'seasonal', 'animesong', 'waifu', 'anibattle', 'animequiz', 'recommend']) assert.ok(registry.lookup(name), `${name} should be registered`)
})
test('natural-language registry exposes every real command through one verified command tool', async () => {
  const commands = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => false }, startedAt: Date.now() })
  const registry = createToolRegistry({ commands, sock: { user: { id: 'owner@s.whatsapp.net' }, sendMessage: async () => {} }, message: { key: { remoteJid: 'chat@s.whatsapp.net' } }, owner: true, sender: 'owner@s.whatsapp.net', sudo: commands.sudo })
  const tool = registry.byName.get('run_existing_command')
  assert.ok(tool)
  for (const command of commands.allCommands) assert.ok(tool.parameters.properties.command.enum.includes(command.name), `${command.name} is missing from natural-language access`)
  const result = await tool.execute({ command: 'ping', args: [] })
  assert.equal(result.result.command, 'ping')
})
test('natural-language command tool cannot bypass owner-only authorization', async () => {
  const commands = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => false }, startedAt: Date.now() })
  const tool = createToolRegistry({ commands, sock: { user: { id: 'user@s.whatsapp.net' }, sendMessage: async () => {} }, message: { key: { remoteJid: 'chat@s.whatsapp.net' } }, owner: false, sender: 'user@s.whatsapp.net', sudo: commands.sudo }).byName.get('run_existing_command')
  await assert.rejects(() => tool.execute({ command: 'reload', args: [] }), /owner|authorized/i)
})
test('consequential command confirmation is application-owned and bound to the exact target', async () => {
  const confirmationStore = new Map()
  const settings = { get: () => ({}) }
  const commands = buildCommands({ settings, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => false }, startedAt: Date.now() })
  const sock = { user: { id: 'owner@s.whatsapp.net' }, groupMetadata: async () => ({ participants: [{ id: 'owner@s.whatsapp.net', admin: 'admin' }] }), groupParticipantsUpdate: async () => {}, sendMessage: async () => {} }
  const message = { key: { remoteJid: '123@g.us', participant: 'owner@s.whatsapp.net' }, message: { extendedTextMessage: { contextInfo: { mentionedJid: ['target@s.whatsapp.net'] } } } }
  const tool = createToolRegistry({ commands, sock, message, owner: true, sender: 'owner@s.whatsapp.net', settings, sudo: commands.sudo, confirmationStore, confirmationKey: '123@g.us:owner@s.whatsapp.net' }).byName.get('run_existing_command')
  const first = await tool.execute({ command: 'promote', args: ['@target'], confirmed: true })
  assert.equal(first.result.confirmation_required, true)
  const pending = confirmationStore.get('123@g.us:owner@s.whatsapp.net')
  assert.equal(pending.command, 'promote')
  await assert.rejects(() => tool.execute({ command: 'promote', args: ['@other'], confirmation_token: pending.token }), /exact pending action/i)
  const completed = await tool.execute({ command: 'promote', args: ['@target'], confirmation_token: pending.token })
  assert.equal(completed.result.completed, true)
  assert.equal(confirmationStore.has('123@g.us:owner@s.whatsapp.net'), false)
})
test('command-backed tool preserves quoted-media context and reports the real handler failure', async () => {
  const commands = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => false }, startedAt: Date.now() })
  const tool = createToolRegistry({ commands, sock: { user: { id: 'owner@s.whatsapp.net' }, sendMessage: async () => {} }, message: { key: { remoteJid: 'chat@s.whatsapp.net' }, message: { conversation: 'turn this into a sticker' } }, owner: true, sender: 'owner@s.whatsapp.net', sudo: commands.sudo }).byName.get('run_existing_command')
  await assert.rejects(() => tool.execute({ command: 'sticker', args: [] }), /Reply to an image or video/i)
})
test('command-backed tool enforces group-only and disabled-command policy before handler execution', async () => {
  const groupSettings = { get: () => ({ disabledCommands: ['ping'] }) }
  const commands = buildCommands({ settings: groupSettings, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => true }, startedAt: Date.now() })
  const groupTool = createToolRegistry({ commands, settings: groupSettings, sock: { user: { id: 'sudo@s.whatsapp.net' }, sendMessage: async () => {} }, message: { key: { remoteJid: '123@g.us' } }, owner: false, sender: 'sudo@s.whatsapp.net', sudo: commands.sudo }).byName.get('run_existing_command')
  await assert.rejects(() => groupTool.execute({ command: 'ping', args: [] }), /disabled/i)
  const dmTool = createToolRegistry({ commands, settings: { get: () => ({}) }, sock: { user: { id: 'sudo@s.whatsapp.net' }, sendMessage: async () => {} }, message: { key: { remoteJid: 'chat@s.whatsapp.net' } }, owner: false, sender: 'sudo@s.whatsapp.net', sudo: commands.sudo }).byName.get('run_existing_command')
  await assert.rejects(() => dmTool.execute({ command: 'groupinfo', args: [] }), /group/i)
})
test('parses AnimeThemes video results into opening and ending records', async () => { 
  const originalFetch = global.fetch
  global.fetch = async url => {
    assert.match(String(url), /api\.animethemes\.moe\/search/)
    assert.match(String(url), /q=Naruto/)
    return { ok: true, status: 200, json: async () => ({ search: { videos: [
      { filename: 'Naruto-OP4v2', link: 'https://v.animethemes.moe/Naruto-OP4v2.webm' },
      { filename: 'Naruto-ED7', link: 'https://v.animethemes.moe/Naruto-ED7.webm' }
    ], animethemes: [] } }) }
  }
  try {
    const themes = await animeThemes('Naruto')
    assert.deepEqual(themes.map(item => item.type), ['Opening', 'Ending'])
    assert.equal(themes[0].sequence, '4')
    assert.match(themes[0].url, /^https:\/\/v\.animethemes\.moe\//)
  } finally { global.fetch = originalFetch }
})
test('.animesong sends one matching opening as audio and does not send a theme link', async () => {
  const themes = [
    { title: 'BlackClover-OP3', type: 'Opening', url: 'https://v.animethemes.moe/BlackClover-OP3.webm' },
    { title: 'BlackClover-OP3-NCBD1080', type: 'Opening', url: 'https://v.animethemes.moe/BlackClover-OP3-NCBD1080.webm' },
    { title: 'BlackClover-ED2', type: 'Ending', url: 'https://v.animethemes.moe/BlackClover-ED2.webm' }
  ]
  const chosen = []; const sent = []; const replies = []
  const message = { key: { remoteJid: 'chat@g.us' } }; const sock = { id: 'mock-socket' }
  const downloader = { downloadThemeAudio: async theme => { chosen.push(theme); return { title: theme.title, mode: 'audio' } }, send: async (...args) => { sent.push(args) } }
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), anime: { animeThemes: async query => { assert.equal(query, 'black rover'); return themes } }, downloader })
  await registry.lookup('animesong').run({ sock, message, args: ['black', 'rover'], reply: async text => replies.push(text) })
  assert.equal(chosen.length, 1)
  assert.equal(chosen[0].title, 'BlackClover-OP3')
  assert.equal(sent.length, 1)
  assert.equal(sent[0][1], message.key.remoteJid)
  assert.equal(sent[0][2].mode, 'audio')
  assert.deepEqual(sent[0][3], { quoted: message })
  assert.deepEqual(replies, [])
})
test('.animesong does not expose a search URL when there is no downloadable theme video', async () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), anime: { animeThemes: async () => [{ title: 'Search Naruto', type: 'Opening', url: 'https://animethemes.moe/search?q=Naruto' }] } })
  await assert.rejects(registry.lookup('animesong').run({ sock: {}, message: { key: { remoteJid: 'chat@s.whatsapp.net' } }, args: ['Naruto'] }), /No downloadable opening or ending audio/)
})
test('registers the requested manga, reaction, popularity, and greeting commands without the retired character command', () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  for (const name of ['manga', 'neko', 'animequote', 'animegenre', 'animepopular', 'hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite', 'greet']) assert.ok(registry.lookup(name), `${name} should be registered`)
  const removedCommand = ['set', 'character'].join('')
  assert.equal(registry.lookup(removedCommand), undefined)
})
test('reaction service converts the provider GIF into a validated 512x512 animated WebP sticker and cleans temporary files', async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-reaction-test-'))
  const gifUrl = 'https://frqs54dqeajn.objectstorage.eu-frankfurt-1.oci.customer-oci.com/o/hug_test.gif'
  const expectedSticker = animatedWebpFixture()
  const { fetchImpl, requested } = mockReactionFetch({ defaultGifUrl: gifUrl })
  const ffmpegCalls = []
  const execRunner = async (executable, args, options) => {
    assert.equal(executable, '/fake/ffmpeg')
    assert.equal(options.timeout, 20_000)
    assert.ok(args.includes('libwebp_anim'))
    assert.ok(args.some(argument => argument.includes('yuva420p')))
    assert.equal(args[args.indexOf('-t') + 1], '8')
    assert.equal(args[args.indexOf('-loop') + 1], '0')
    ffmpegCalls.push(args)
    await fs.writeFile(args.at(-1), expectedSticker)
    return { stdout: '', stderr: '' }
  }
  try {
    const service = createReactionService({ fetchImpl, execRunner, ffmpegResolver: async () => '/fake/ffmpeg', tempDirectory, log: { info() {}, warn() {} } })
    const result = await service.loadSticker('hug')
    assert.deepEqual(result, expectedSticker)
    assert.equal(requested.length, 2)
    assert.equal(requested[0].searchParams.get('category'), 'hug')
    assert.equal(requested[1].hostname, 'frqs54dqeajn.objectstorage.eu-frankfurt-1.oci.customer-oci.com')
    assert.equal(ffmpegCalls.length, 1)
    assert.match(ffmpegCalls[0][ffmpegCalls[0].indexOf('-vf') + 1], /pad=512:512/)
    assert.deepEqual(await fs.readdir(tempDirectory), [])
  } finally { await fs.rm(tempDirectory, { recursive: true, force: true }) }
})
test('reaction sticker cache reuses conversions by media URL, expires entries, and returns copies', async () => {
  const gifUrl = 'https://frqs54dqeajn.objectstorage.eu-frankfurt-1.oci.customer-oci.com/o/cache.gif'
  const { fetchImpl, requested } = mockReactionFetch({ defaultGifUrl: gifUrl })
  const sticker = animatedWebpFixture()
  let now = 1000
  let conversions = 0
  const service = createReactionService({
    fetchImpl,
    clock: () => now,
    cacheTtlMs: 100,
    execRunner: async (_executable, args) => { conversions += 1; await fs.writeFile(args.at(-1), sticker); return { stdout: '', stderr: '' } },
    ffmpegResolver: async () => '/fake/ffmpeg',
    log: { info() {}, warn() {} }
  })
  const first = await service.loadSticker('hug')
  first[0] = 0
  const second = await service.loadSticker('slap')
  assert.equal(second.toString('ascii', 0, 4), 'RIFF')
  assert.equal(conversions, 1)
  assert.equal(requested.length, 3, 'second lookup still queries the random category provider but skips the GIF download')
  now += 101
  await service.loadSticker('kiss')
  assert.equal(conversions, 2)
  assert.equal(requested.length, 5, 'expired results are downloaded and converted again')
})
test('reaction sticker service retries smaller profiles when output is too large and enforces the size cap', async () => {
  const gifUrl = 'https://frqs54dqeajn.objectstorage.eu-frankfurt-1.oci.customer-oci.com/o/large.gif'
  const { fetchImpl } = mockReactionFetch({ defaultGifUrl: gifUrl })
  const large = animatedWebpFixture({ frameDataBytes: 300_000 })
  const small = animatedWebpFixture()
  const profiles = []
  const service = createReactionService({ fetchImpl, maxStickerBytes: 200, execRunner: async (_executable, args) => {
    profiles.push(args[args.indexOf('-quality') + 1])
    await fs.writeFile(args.at(-1), profiles.length === 1 ? large : small)
    return { stdout: '', stderr: '' }
  }, ffmpegResolver: async () => '/fake/ffmpeg', log: { info() {}, warn() {} } })
  assert.deepEqual(await service.loadSticker('bonk'), small)
  assert.deepEqual(profiles, ['55', '42'])

  const overLimit = createReactionService({ fetchImpl, maxStickerBytes: 100, execRunner: async (_executable, args) => { await fs.writeFile(args.at(-1), small); return { stdout: '', stderr: '' } }, ffmpegResolver: async () => '/fake/ffmpeg', log: { info() {}, warn() {} } })
  await assert.rejects(overLimit.loadSticker('pat'), /500 KB size limit/)
})
test('reaction sticker service rejects untrusted URLs, invalid GIFs, and invalid or overlong animations', async () => {
  const apiUrl = 'https://animegifs-enkidu.koyeb.app/v3/api/?category=hug'
  let fetchCount = 0
  const untrusted = createReactionService({ fetchImpl: async () => { fetchCount += 1; return reactionResponse(Buffer.from(JSON.stringify({ gif: 'https://example.com/unsafe.gif' })), 'application/json', apiUrl) }, log: { info() {}, warn() {} } })
  await assert.rejects(untrusted.loadSticker('hug'), /untrusted media URL/)
  assert.equal(fetchCount, 1)

  const gifUrl = 'https://frqs54dqeajn.objectstorage.eu-frankfurt-1.oci.customer-oci.com/o/bad.gif'
  const { fetchImpl } = mockReactionFetch({ defaultGifUrl: gifUrl, gifBytes: Buffer.from('not a GIF') })
  const invalidGif = createReactionService({ fetchImpl, log: { info() {}, warn() {} } })
  await assert.rejects(invalidGif.loadSticker('hug'), /invalid GIF data/)

  const longWebp = animatedWebpFixture({ durations: [6000, 5000] })
  const longAnimation = createReactionService({ fetchImpl: mockReactionFetch({ defaultGifUrl: gifUrl }).fetchImpl, execRunner: async (_executable, args) => { await fs.writeFile(args.at(-1), longWebp); return { stdout: '', stderr: '' } }, ffmpegResolver: async () => '/fake/ffmpeg', log: { info() {}, warn() {} } })
  await assert.rejects(longAnimation.loadSticker('pout'), /valid animated 512×512 WebP/)
})
test('reaction service rejects media URLs outside the verified provider host before downloading them', async () => {
  for (const gif of [
    'https://example.com/untrusted.gif',
    'https://frqs54dqeajn.objectstorage.eu-frankfurt-1.oci.customer-oci.com:8443/o/untrusted.gif'
  ]) {
    let fetchCount = 0
    const response = reactionResponse(Buffer.from(JSON.stringify({ gif })), 'application/json', 'https://animegifs-enkidu.koyeb.app/v3/api/?category=hug')
    const service = createReactionService({ fetchImpl: async () => { fetchCount += 1; return response }, log: { info() {}, warn() {} } })
    await assert.rejects(service.loadSticker('hug'), /untrusted media URL/)
    assert.equal(fetchCount, 1)
  }
})
test('all seven standard reaction commands send animated WhatsApp sticker payloads and preserve their text labels', async () => {
  const sent = []
  const replies = []
  const calls = []
  const message = { key: { remoteJid: '123@g.us' } }
  const sticker = animatedWebpFixture()
  const registry = buildCommands({
    settings: { get: () => ({}) },
    warnings: { get: () => ({}) },
    sudo: { list: () => [], add: async () => {}, remove: async () => {} },
    startedAt: Date.now(),
    reactions: { loadSticker: async action => { calls.push(action); return sticker } }
  })
  const sock = { sendMessage: async (...args) => sent.push(args) }
  for (const action of REACTION_ACTIONS) await registry.lookup(action).run({ sock, message, reply: async text => replies.push(text) })
  assert.deepEqual(calls, REACTION_ACTIONS)
  assert.equal(sent.length, REACTION_ACTIONS.length)
  assert.deepEqual(replies, REACTION_ACTIONS.map(action => `${action[0].toUpperCase()}${action.slice(1)} reaction`))
  for (const [index, [jid, payload, options]] of sent.entries()) {
    assert.equal(jid, message.key.remoteJid)
    assert.deepEqual(payload, { sticker, isAnimated: true })
    assert.deepEqual(options, { quoted: message })
    assert.equal('video' in payload || 'gifPlayback' in payload || 'caption' in payload, false)
    assert.equal(replies[index], `${REACTION_ACTIONS[index][0].toUpperCase()}${REACTION_ACTIONS[index].slice(1)} reaction`)
  }
})
test('.hmph sends a random tsundere line alongside an animated pout sticker', async () => {
  const events = []
  const actions = []
  const message = { key: { remoteJid: '123@g.us' } }
  const sticker = animatedWebpFixture()
  const text = TSUNDERE_LINES[9]
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), reactions: { loadSticker: async action => { actions.push(action); return sticker } }, tsundere: { randomLine: () => text } })
  const sock = { sendMessage: async (...args) => events.push({ type: 'sticker', args }) }
  await registry.lookup('hmph').run({ sock, message, reply: async value => events.push({ type: 'text', value }) })
  assert.deepEqual(actions, ['pout'])
  assert.deepEqual(events, [
    { type: 'sticker', args: [message.key.remoteJid, { sticker, isAnimated: true }, { quoted: message }] },
    { type: 'text', value: text }
  ])
})
test('reaction commands fall back to their text if retrieval/conversion or sticker sending fails', async () => {
  const message = { key: { remoteJid: '123@g.us' } }
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), reactions: { loadSticker: async () => { throw new Error('conversion failed') } } })
  const replies = []
  let sends = 0
  await registry.lookup('slap').run({ sock: { sendMessage: async () => { sends += 1 } }, message, reply: async text => replies.push(text) })
  assert.equal(sends, 0)
  assert.deepEqual(replies, ['Slap reaction'])

  const text = TSUNDERE_LINES[14]
  const hmphRegistry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), reactions: { loadSticker: async () => animatedWebpFixture() }, tsundere: { randomLine: () => text } })
  const fallback = []
  await hmphRegistry.lookup('hmph').run({ sock: { sendMessage: async () => { throw new Error('Baileys rejected sticker') } }, message, reply: async value => fallback.push(value) })
  assert.deepEqual(fallback, [text])
})
test('.hmph is registered in generated help and the Anime menu as a sticker reaction', () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  const appConfig = { prefix: '.', botName: 'SHADOW', ownerName: 'Miyamaru', version: '1.0.0' }
  const help = renderHelp({ commands: registry.allCommands, config: appConfig, startedAt: Date.now() })
  const menu = renderMenu({ commands: registry.allCommands, config: appConfig, startedAt: Date.now() })
  assert.ok(registry.allCommands.some(command => command.name === 'hmph'))
  assert.match(help, /\.hmph\s+·\s+Send a playful tsundere line with an animated anime sticker\./)
  assert.ok(menu.includes('.*𝐇𝐌𝐏𝐇*'))
})
test('.greet remains a group-only prefix command without character state', async () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  const message = { key: { remoteJid: '123-456@g.us' } }
  const outputs = []
  await registry.lookup('greet').run({ message, args: [], reply: async text => outputs.push(text) })
  await registry.lookup('greet').run({ message, args: ['the', 'new', 'members'], reply: async text => outputs.push(text) })
  assert.match(outputs[0], /Welcome everyone/)
  assert.match(outputs[1], /Welcome the new members/)
  assert.equal(registry.lookup('greet').groupOnly, true)
})
test('parses anime battle names around VS safely', () => { assert.deepEqual(parseBattleArgs('Gojo VS Sukuna'), ['Gojo', 'Sukuna']); assert.throws(() => parseBattleArgs('Gojo'), /Usage/) })
test('isolates anime quiz sessions and scores answers', () => {
  let time = 1000
  const quiz = createQuizService({ clock: () => time })
  const first = quiz.start('chat-a', 'user-a')
  assert.equal(first.options.length, 4)
  const result = quiz.answer('chat-a', 'user-a', first.answer)
  assert.equal(result.correct, true)
  assert.throws(() => quiz.answer('chat-b', 'user-a', 1), /No active quiz/)
  time = 301001
  assert.throws(() => quiz.answer('chat-a', 'user-a', 1), /No active quiz/)
})
test('validates supported public downloader URLs and rejects unsafe or unsupported URLs', () => {
  assert.equal(validateMediaUrl('https://youtu.be/abc123'), 'https://youtu.be/abc123')
  assert.equal(validateMediaUrl('https://www.tiktok.com/@user/video/1'), 'https://www.tiktok.com/@user/video/1')
  assert.throws(() => validateMediaUrl('http://youtu.be/abc123'), /HTTPS/)
  assert.throws(() => validateMediaUrl('https://example.com/video'), /not supported/)
  assert.equal(validateAnimeThemeUrl('https://v.animethemes.moe/BlackClover-OP3.webm'), 'https://v.animethemes.moe/BlackClover-OP3.webm')
  assert.throws(() => validateAnimeThemeUrl('http://v.animethemes.moe/BlackClover-OP3.webm'), /HTTPS/)
  assert.throws(() => validateAnimeThemeUrl('https://v.animethemes.moe.example/BlackClover-OP3.webm'), /direct videos/)
  assert.throws(() => validateAnimeThemeUrl('https://animethemes.moe/search?q=Black+Clover'), /direct videos|supported video file/)
  assert.throws(() => validateMediaUrl('https://v.animethemes.moe/BlackClover-OP3.webm'), /not supported/)
})
test('formats downloader size limits for yt-dlp instead of using an invalid B suffix', () => {
  assert.equal(formatMaxFileSize(52_428_800), '50M')
  assert.equal(formatMaxFileSize(2 * 1024 * 1024 * 1024), '2G')
  assert.throws(() => formatMaxFileSize(0), /positive/)
})
test('explains actual/configured download size limits and quality-specific next steps', () => {
  const videoHd = formatSizeLimitMessage(55 * 1024 * 1024, 50 * 1024 * 1024, 'hd', 'video')
  assert.match(videoHd, /55 MiB.*50 MiB/)
  assert.match(videoHd, /Retry without `hd` to request SD/)
  assert.match(videoHd, /maximum is 100 MiB/)
  const videoSd = formatSizeLimitMessage(undefined, 50 * 1024 * 1024, 'sd', 'video')
  assert.match(videoSd, /media may exceed Shadow’s 50 MiB/)
  assert.doesNotMatch(videoSd, /0\.0 MiB/)
  const audioHd = formatSizeLimitMessage(undefined, 50 * 1024 * 1024, 'hd', 'audio')
  assert.match(audioHd, /standard 128 kbps audio/)
})
test('requests SD video by default, keeps the configured size cap, and matches video MIME types', () => {
  const args = buildVideoArgs(52_428_800)
  const format = args[args.indexOf('-f') + 1]
  assert.equal(args.includes('--recode-video'), false)
  assert.match(format, /ext=mp4/)
  assert.match(format, /height<=480/)
  assert.doesNotMatch(format, /height>=720/)
  assert.doesNotMatch(format, /\/bv\*\+ba\/b$/)
  assert.equal(args[args.indexOf('--concurrent-fragments') + 1], '4')
  assert.equal(args[args.indexOf('--max-filesize') + 1], '50M')
  assert.equal(videoMimeType('.mp4'), 'video/mp4')
  assert.equal(videoMimeType('.webm'), 'video/webm')
})
test('requests HD video only when explicitly asked and never falls back across quality tiers', () => {
  const args = buildVideoArgs(52_428_800, 'hd')
  const format = args[args.indexOf('-f') + 1]
  assert.match(format, /height>=720/)
  assert.match(format, /height<=1080/)
  assert.doesNotMatch(format, /height<=480/)
  assert.doesNotMatch(format, /\/bv\*\+ba\/b$/)
  assert.throws(() => buildVideoArgs(52_428_800, 'uhd'), /Quality must be SD or HD/)
})
test('requests audio-only sources with standard quality by default and higher bitrate only on HD request', () => {
  const args = buildAudioArgs(52_428_800)
  const hdArgs = buildAudioArgs(52_428_800, 'hd')
  assert.match(args[args.indexOf('-f') + 1], /^ba\[/)
  assert.equal(args[args.indexOf('--audio-format') + 1], 'mp3')
  assert.equal(args[args.indexOf('--audio-quality') + 1], '128K')
  assert.equal(hdArgs[hdArgs.indexOf('--audio-quality') + 1], '320K')
  assert.equal(args[args.indexOf('--concurrent-fragments') + 1], '4')
})
test('all pasted-URL downloader commands default to SD and accept an explicit HD option', async () => {
  const calls = []
  const downloader = { download: async options => { calls.push(options); return { file: '', dir: '' } }, send: async () => {} }
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), downloader })
  const message = { key: { remoteJid: 'chat@g.us' } }
  const sock = {}
  const commands = [
    ['yta', 'https://www.youtube.com/watch?v=audio', 'audio'],
    ['ytv', 'https://www.youtube.com/watch?v=video', 'video'],
    ['tiktok', 'https://www.tiktok.com/@user/video/1', 'video'],
    ['insta', 'https://www.instagram.com/reel/abc/', 'video'],
    ['fb', 'https://www.facebook.com/watch?v=1', 'video'],
    ['twitter', 'https://x.com/user/status/1', 'video']
  ]
  for (const [name, url, mode] of commands) {
    await registry.lookup(name).run({ sock, message, args: [url], reply: async () => {} })
    assert.deepEqual(calls.at(-1), { url, mode, quality: 'sd' }, `${name} should request SD by default`)
    await registry.lookup(name).run({ sock, message, args: [url, 'HD'], reply: async () => {} })
    assert.deepEqual(calls.at(-1), { url, mode, quality: 'hd' }, `${name} should accept an explicit HD option`)
  }
})
test('.play keeps search separate, accepts pasted URLs, and applies HD only to a download', async () => {
  const calls = []; const searches = []; const selections = []
  const downloader = {
    download: async options => { calls.push(options); return { file: '', dir: '' } },
    search: async (query, chat, sender) => { searches.push({ query, chat, sender }); return [{ index: 1, title: 'Found Song', uploader: 'Artist', duration: '3:00' }] },
    select: (chat, sender, number) => { selections.push({ chat, sender, number }); return { url: 'https://youtu.be/selected' } },
    send: async () => {}
  }
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), downloader })
  const message = { key: { remoteJid: 'chat@g.us', participant: 'user@s.whatsapp.net' } }
  const sock = { user: { id: 'bot@s.whatsapp.net' } }
  await registry.lookup('play').run({ sock, message, args: ['2', 'many', 'songs'], reply: async () => {} })
  assert.equal(searches[0].query, '2 many songs')
  assert.equal(calls.length, 0)
  await registry.lookup('play').run({ sock, message, args: ['https://youtu.be/pasted'], reply: async () => {} })
  assert.deepEqual(calls.at(-1), { url: 'https://youtu.be/pasted', mode: 'audio', quality: 'sd' })
  await registry.lookup('play').run({ sock, message, args: ['1', 'hd'], reply: async () => {} })
  assert.deepEqual(selections[0], { chat: 'chat@g.us', sender: 'user@s.whatsapp.net', number: 1 })
  assert.deepEqual(calls.at(-1), { url: 'https://youtu.be/selected', mode: 'audio', quality: 'hd' })
  assert.equal(searches.length, 1)
})
test('reports unavailable SD/HD formats without silently falling across quality tiers', async () => {
  const formats = []
  const fakeExec = async (_file, args) => {
    if (args.includes('--version')) return { stdout: '2026.01\n', stderr: '' }
    formats.push(args[args.indexOf('-f') + 1])
    const error = new Error('yt-dlp failed')
    error.stderr = 'ERROR: [youtube] Requested format is not available.'
    throw error
  }
  const downloader = createDownloader({ config: { ytdlpPath: 'yt-dlp', downloaderMaxBytes: 50 * 1024 * 1024, downloaderTimeoutMs: 30_000, downloaderConcurrency: 1 }, execRunner: fakeExec })
  await assert.rejects(downloader.download({ url: 'https://youtu.be/no-sd' }), /No SD \(up to 480p\) video.*did not switch quality automatically/)
  await assert.rejects(downloader.download({ url: 'https://youtu.be/no-hd', quality: 'hd' }), /No HD \(720p–1080p\).*did not switch quality automatically/)
  assert.match(formats[0], /height<=480/)
  assert.match(formats[1], /height>=720/)
})
test('surfaces mocked platform failures from the existing yt-dlp provider without a fallback provider', async () => {
  const failedHosts = []
  const fakeExec = async (_file, args) => {
    if (args.includes('--version')) return { stdout: '2026.01\n', stderr: '' }
    const host = new URL(args.find(value => /^https:\/\//i.test(value))).hostname
    failedHosts.push(host)
    const error = new Error('provider request failed')
    error.stderr = `ERROR: [${host}] HTTP Error 403: Forbidden`
    throw error
  }
  const downloader = createDownloader({ config: { ytdlpPath: 'yt-dlp', downloaderMaxBytes: 50 * 1024 * 1024, downloaderTimeoutMs: 30_000, downloaderConcurrency: 1 }, execRunner: fakeExec })
  const urls = [
    'https://www.youtube.com/watch?v=1',
    'https://www.tiktok.com/@user/video/1',
    'https://www.instagram.com/reel/1/',
    'https://www.facebook.com/watch?v=1',
    'https://x.com/user/status/1'
  ]
  for (const url of urls) await assert.rejects(downloader.download({ url }), /Downloader failed: ERROR: .*HTTP Error 403: Forbidden/)
  assert.equal(failedHosts.length, urls.length)
})
test('ping sends the requested one-line response in private and group chats', async () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  for (const jid of ['chat@s.whatsapp.net', '123-456@g.us']) {
    const sent = []
    const sock = { sendMessage: async (...args) => { sent.push(args); return { key: { id: 'pong-1' } } } }
    const message = { key: { id: 'request-1', remoteJid: jid } }
    await registry.lookup('ping').run({ sock, message, receivedAt: 0 })
    assert.equal(sent.length, 1)
    assert.equal(sent[0][0], jid)
    assert.match(sent[0][1].text, /^Pong! You think you can match my speed\? ⚡: \d+ms$/)
  }
})
test('ping latency uses rounded high-resolution elapsed milliseconds', () => {
  assert.equal(measuredPingLatencyMs(1000.25, 1001.25), 1)
  assert.equal(measuredPingLatencyMs(1000.25, 1000.75), 1)
  assert.equal(measuredPingLatencyMs(1000.25, 1000.1), 0)
  assert.equal(measuredPingLatencyMs(Number.NaN, 1001), 0)
})
test('play selection downloads audio rather than a video payload', async () => {
  let requestedMode = ''
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), downloader: { select: () => ({ url: 'https://youtu.be/fixture' }), download: async options => { requestedMode = options.mode; return { file: '', dir: '' } }, send: async () => {} } })
  await registry.lookup('play').run({ sock: { user: { id: 'user@s.whatsapp.net' } }, message: { key: { remoteJid: 'chat@s.whatsapp.net' } }, args: ['1'], reply: async () => {} })
  assert.equal(requestedMode, 'audio')
})
test('play search sessions are scoped to the requesting chat and sender', async () => {
  const requests = []
  const fakeExec = async (_file, args) => { requests.push(args); return args.includes('--version') ? { stdout: '2026.01\n', stderr: '' } : { stdout: JSON.stringify({ entries: [{ id: 'abc', url: 'https://youtu.be/abc', title: 'Night Changes', uploader: 'Artist', duration: 200 }] }), stderr: '' } }
  const downloader = createDownloader({ config: { ytdlpPath: 'yt-dlp', downloaderMaxBytes: 50_000_000, downloaderTimeoutMs: 30_000, downloaderConcurrency: 1 }, execRunner: fakeExec })
  const results = await downloader.search('Night Changes', 'chat@g.us', 'user@s.whatsapp.net'); assert.equal(results[0].title, 'Night Changes'); assert.equal(downloader.select('chat@g.us', 'user@s.whatsapp.net', 1).url, 'https://youtu.be/abc'); assert.throws(() => downloader.select('chat@g.us', 'other@s.whatsapp.net', 1), /expired/)
  const searchArgs = requests.find(args => args.includes('--dump-single-json'))
  assert.ok(searchArgs.includes('--simulate'))
  assert.ok(searchArgs.includes('ytsearch5:Night Changes'))
  assert.equal(searchArgs.includes('--max-filesize'), false)
  await assert.rejects(downloader.search('x'.repeat(121), 'chat@g.us', 'user@s.whatsapp.net'), /120 characters or fewer/)
})
test('calculates arithmetic with safe precedence, decimal, unary, and exponent handling', () => {
  assert.equal(calculate('2+3*(4-1)'), 11)
  assert.equal(calculate('0.1 + 0.2'), 0.3)
  assert.equal(calculate('.5 + 5.'), 5.5)
  assert.equal(calculate('-2^2'), -4)
  assert.equal(calculate('(-2)^2'), 4)
  assert.equal(calculate('2^-2'), 0.25)
  assert.equal(calculate('2^3^2'), 512)
  assert.throws(() => calculate('process.exit()'), /numeric expression/)
})
test('rejects malformed calculator syntax, adjacent values, and zero divisors', () => {
  for (const expression of ['2(3)', '1 2', '1..2', '()', '2+', '1+)']) assert.throws(() => calculate(expression), /Malformed expression|Unbalanced parentheses/)
  assert.throws(() => calculate('1/0'), /Division by zero/)
  assert.throws(() => calculate('1%0'), /Modulo by zero/)
})
test('.quote returns the exact requested wording from its local implementation', async () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  let output = ''
  await registry.lookup('quote').run({ reply: async text => { output = text } })
  assert.equal(output, "A winner is someone who has failed enough to succeed but didn't fail to stop")
})
test('builds an automatic English translation request from a replied message', () => {
  assert.deepEqual(buildTranslationRequest({ args: [], rawArgs: '', quotedText: 'Bonjour tout le monde' }), { target: 'en', text: 'Bonjour tout le monde', fromReply: true })
})
test('builds a custom-language request from a reply and accepts language names', () => {
  assert.deepEqual(buildTranslationRequest({ args: ['French'], rawArgs: 'French', quotedText: 'Hello world' }), { target: 'fr', text: 'Hello world', fromReply: true })
})
test('translate command uses quoted captions and separates the original from the result', async () => {
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async url => { calls += 1; if (calls === 1) { assert.match(String(url), /translate\.googleapis\.com/); return { ok: true, json: async () => [null, null, 'fr'] } }; assert.match(String(url), /langpair=fr%7Cen/); return { ok: true, json: async () => ({ responseData: { translatedText: 'Hello world' } }) } }
  try {
    let output = ''
    await registry.lookup('translate').run({ args: [], rawArgs: '', message: { key: { remoteJid: 'chat@s.whatsapp.net' }, message: { extendedTextMessage: { contextInfo: { stanzaId: 'q1', participant: 'user@s.whatsapp.net', quotedMessage: { imageMessage: { caption: 'Bonjour tout le monde' } } } } } }, reply: async text => { output = text } })
    assert.match(output, /Original message:\nBonjour tout le monde/)
    assert.match(output, /Translation \(en\):\nHello world/)
    assert.equal(calls, 2)
  } finally { global.fetch = originalFetch }
})
test('detects Japanese before sending a translation request to MyMemory', async () => {
  const originalFetch = global.fetch; const calls = []
  global.fetch = async url => { calls.push(String(url)); return calls.length === 1 ? { ok: true, json: async () => [null, null, 'ja'] } : { ok: true, json: async () => ({ responseData: { translatedText: 'I like cats.' } }) } }
  try { const { translate } = await import('../src/services/webTools.js'); assert.equal(await translate('english', 'ねこが好きです。'), 'I like cats.'); assert.match(calls[1], /langpair=ja%7Cen/) } finally { global.fetch = originalFetch }
})
test('rejects translate input with neither text nor a usable reply', () => {
  assert.throws(() => buildTranslationRequest({ args: [], rawArgs: '', quotedText: '' }), /Usage: \.translate/)
  assert.throws(() => buildTranslationRequest({ args: ['French'], rawArgs: 'French', quotedText: '' }), /Reply to a message/)
})
test('falls back to Datamuse when the primary dictionary provider is unavailable', async () => {
  const originalFetch = global.fetch; const urls = []
  global.fetch = async url => { urls.push(String(url)); if (urls.length === 1) return { ok: false, status: 530, json: async () => ({}) }; return { ok: true, json: async () => [{ word: 'ineffable', defs: ['adj\tBeyond expression in words; unspeakable.'] }] } }
  try { assert.equal(await define('ineffable'), 'ineffable\nadj: Beyond expression in words; unspeakable.'); assert.match(urls[0], /dictionaryapi\.dev/); assert.match(urls[1], /api\.datamuse\.com/) } finally { global.fetch = originalFetch }
})
test('resolves an executable ffmpeg from the Node process and validates it with -version', async () => {
  const resolved = await resolveFfmpeg()
  assert.ok(resolved)
  assert.match(resolved.toLowerCase(), /ffmpeg/)
})
test('removes muted messages before command dispatch', async () => {
  let executed = false
  const sent = []
  const base = { commands: { lookup: () => ({ name: 'ping', aliases: [], run: async () => { executed = true } }), sudo: { has: () => true } }, settings: { get: () => ({ mutedParticipants: ['99999@s.whatsapp.net'], slowmodeSeconds: 0, disabledCommands: [] }) }, config: { prefix: '.', ownerNumber: '2349166712534' }, seen: new Set(), onAutoDelete: async () => {}, metrics: {} }
  const sock = { user: { id: 'bot@lid' }, groupMetadata: async () => ({ participants: [{ id: 'bot@lid', admin: 'admin' }] }), sendMessage: async (...args) => sent.push(args) }
  await createMessageHandler({ ...base, sock })({ messages: [{ key: { id: 'muted-1', remoteJid: '123-456@g.us', participant: '99999@s.whatsapp.net' }, message: { conversation: '.ping' } }], type: 'notify' })
  assert.equal(executed, false)
  assert.equal(sent[0][1].delete.id, 'muted-1')
})
test('blocks a disabled group command before dispatch', async () => {
  let executed = false
  const sent = []
  const base = { commands: { lookup: () => ({ name: 'ping', aliases: [], run: async () => { executed = true } }), sudo: { has: () => true } }, settings: { get: () => ({ mutedParticipants: [], slowmodeSeconds: 0, disabledCommands: ['ping'] }) }, config: { prefix: '.', ownerNumber: '2349166712534' }, seen: new Set(), onAutoDelete: async () => {}, metrics: {} }
  const sock = { user: { id: 'bot@lid' }, sendMessage: async (...args) => sent.push(args) }
  await createMessageHandler({ ...base, sock })({ messages: [{ key: { id: 'disabled-1', remoteJid: '123-456@g.us', participant: '99999@s.whatsapp.net' }, message: { conversation: '.ping' } }], type: 'notify' })
  assert.equal(executed, false)
  assert.match(sent[0][1].text, /disabled in this group/)
})
test('silently ignores commands from users who are not authorized', async () => {
  const sent = []
  const base = { commands: { lookup: () => ({ name: 'ping', aliases: [], run: async () => { throw new Error('must not execute') } }), sudo: { has: () => false } }, settings: { get: () => ({ mutedParticipants: [], slowmodeSeconds: 0, disabledCommands: [] }) }, config: { prefix: '.', ownerNumber: '2349166712534' }, seen: new Set(), onAutoDelete: async () => {}, metrics: {} }
  const sock = { user: { id: 'bot@lid' }, sendMessage: async (...args) => sent.push(args) }
  await createMessageHandler({ ...base, sock })({ messages: [{ key: { id: 'unauthorized-1', remoteJid: '123-456@g.us', participant: '11111@s.whatsapp.net' }, message: { conversation: '.ping' } }], type: 'notify' })
  assert.equal(sent.length, 0)
})
test('keeps explicitly approved command guidance visible to the user', async () => {
  const sent = []; const logs = []
  const message = { key: { id: 'safe-error-1', remoteJid: 'chat@s.whatsapp.net' }, message: { conversation: '.test' } }
  const commands = { lookup: () => ({ name: 'test', aliases: [], run: async () => { throw new UserFacingError('Usage: .test value') } }), sudo: { has: () => true } }
  const sock = { user: { id: 'bot@lid' }, sendMessage: async (...args) => sent.push(args) }
  await createMessageHandler({ sock, commands, settings: { get: () => ({}) }, config: { prefix: '.', ownerNumber: '2349166712534' }, seen: new Set(), onAutoDelete: async () => {}, metrics: {}, log: { warn: (...args) => logs.push(args) } })({ messages: [message], type: 'notify' })
  assert.equal(sent[0][1].text, 'Usage: .test value')
  assert.equal(logs.length, 1)
})
test('real calculator validation remains actionable through command dispatch', async () => {
  const sent = []
  const registry = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], has: () => true, add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  const command = registry.lookup('calculate')
  const sock = { user: { id: 'bot@lid' }, sendMessage: async (...args) => sent.push(args) }
  await createMessageHandler({ sock, commands: { lookup: () => command, sudo: { has: () => true } }, settings: { get: () => ({}) }, config: { prefix: '.', ownerNumber: '2349166712534' }, seen: new Set(), onAutoDelete: async () => {}, metrics: {}, log: { warn: () => {} } })({ messages: [{ key: { id: 'calculate-error-1', remoteJid: 'chat@s.whatsapp.net' }, message: { conversation: '.calculate 1/0' } }], type: 'notify' })
  assert.equal(sent[0][1].text, 'Division by zero is not allowed.')
})
test('hides unexpected error details from chat and redacts secrets in private diagnostics', async () => {
  const sent = []; const logs = []
  const message = { key: { id: 'unexpected-error-1', remoteJid: 'chat@s.whatsapp.net' }, message: { conversation: '.test' } }
  const internal = new Error('Provider failure https://alice:password123@example.test/path?api_key=secret123 Bearer bearer-secret')
  const commands = { lookup: () => ({ name: 'test', aliases: [], run: async () => { throw internal } }), sudo: { has: () => true } }
  const sock = { user: { id: 'bot@lid' }, sendMessage: async (...args) => sent.push(args) }
  await createMessageHandler({ sock, commands, settings: { get: () => ({}) }, config: { prefix: '.', ownerNumber: '2349166712534' }, seen: new Set(), onAutoDelete: async () => {}, metrics: {}, log: { warn: (...args) => logs.push(args) } })({ messages: [message], type: 'notify' })
  assert.equal(sent[0][1].text, GENERIC_FAILURE_MESSAGE)
  assert.match(logs[0][0].err.message, /Provider failure/)
  assert.match(logs[0][0].err.stack, /at /)
  const serialized = JSON.stringify(logs[0])
  for (const secret of ['password123', 'secret123', 'bearer-secret']) assert.equal(serialized.includes(secret), false)
  assert.match(serialized, /\[REDACTED\]/)
})
test('fatal process failures log safely, stop reconnect eligibility, close the socket, and exit nonzero once', () => {
  let socketError; let exitCode; let exitCalled; let timerCallback; let scheduledDelay; let unrefCalled = false; let shuttingDown = false
  const logs = []
  const handler = createFatalProcessErrorHandler({
    logger: { fatal: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    getSocket: () => ({ end: error => { socketError = error } }),
    markShuttingDown: () => { shuttingDown = true },
    setExitCode: code => { exitCode = code },
    exit: code => { exitCalled = code },
    schedule: (callback, delay) => { timerCallback = callback; scheduledDelay = delay; return { unref: () => { unrefCalled = true } } },
    graceMs: 750
  })
  assert.equal(handler('Uncaught exception', new Error('Fatal bearer secret-token')), true)
  assert.equal(handler('Unhandled promise rejection', new Error('second failure')), false)
  assert.equal(shuttingDown, true)
  assert.equal(exitCode, 1)
  assert.equal(socketError.message, 'Fatal process error')
  assert.equal(scheduledDelay, 750)
  assert.equal(unrefCalled, true)
  assert.equal(logs.length, 1)
  assert.equal(JSON.stringify(logs[0]).includes('secret-token'), false)
  timerCallback()
  assert.equal(exitCalled, 1)
})
test('wires message metrics and does not send goodbye messages for promotions', async () => {
  const registered = {}; const sent = []; const metrics = { messagesSeen: 0, commandsExecuted: 0, deniedCommands: 0, moderationActions: 0, errors: 0 }
  const sock = { user: { id: 'bot@lid' }, ev: { on: (event, handler) => { registered[event] = handler } }, groupMetadata: async () => ({ subject: 'Test', participants: [] }), sendMessage: async (...args) => sent.push(args) }
  attachHandlers({ sock, commands: { lookup: () => undefined, sudo: { has: () => false } }, settings: { get: () => ({ welcome: true, goodbye: true }) }, config: { prefix: '.', ownerNumber: '2349166712534', welcomeDefault: 'Welcome {user}', goodbyeDefault: 'Goodbye {user}' }, seen: new Set(), metrics })
  await registered['messages.upsert']({ type: 'notify', messages: [{ key: { id: 'metric-1', remoteJid: 'chat@s.whatsapp.net', participant: 'user@s.whatsapp.net' }, message: { conversation: '.unknown' } }] })
  await registered['group-participants.update']({ id: '123-456@g.us', participants: ['user@s.whatsapp.net'], action: 'promote' })
  assert.equal(metrics.messagesSeen, 1)
  assert.equal(sent.length, 0)
})
test('caches and recovers a deleted text message', async () => {
  const cache = createMessageCache({ ttlMs: 60_000 }); const original = { key: { id: 'deleted-1', remoteJid: '123-456@g.us', participant: 'user@s.whatsapp.net' }, pushName: 'Justin', message: { conversation: 'secret text' } }
  cache.remember(original); assert.equal(cache.take(original.key), original)
  const sent = []; const result = await recoverDeletedMessage({ sock: { sendMessage: async (...args) => sent.push(args) }, original, destination: '123-456@g.us' })
  assert.equal(result.restored, true); assert.match(sent[0][1].text, /Deleted message detected/); assert.match(sent[1][1].text, /Justin : secret text/); assert.match(sent[1][1].text, /Shadow sees all/); assert.match(sent[1][1].text, /\*\*Recovered message:\*\* secret text/)
})
test('anti-delete toggle persists and deleted events recover cached messages only when enabled', async () => {
  const registered = {}; const sent = []; const metrics = { moderationActions: 0 }; let policy = { antiDelete: false }
  const sock = { user: { id: 'bot@s.whatsapp.net' }, ev: { on: (event, handler) => { registered[event] = handler } }, groupMetadata: async () => ({ participants: [] }), sendMessage: async (...args) => sent.push(args) }
  const settings = { get: () => policy, set: async (_jid, patch) => { policy = { ...policy, ...patch } } }
  const commands = buildCommands({ settings, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now() })
  attachHandlers({ sock, commands, settings, config: { prefix: '.', ownerNumber: '2349166712534', antiDeleteLogJid: '' }, seen: new Set(), metrics })
  const source = { key: { id: 'deleted-2', remoteJid: '123-456@g.us', participant: 'user@s.whatsapp.net' }, message: { conversation: 'recover this' } }
  await registered['messages.upsert']({ type: 'notify', messages: [source] }); await registered['messages.delete']({ keys: [source.key] }); assert.equal(sent.length, 0)
  policy.antiDelete = true; await registered['messages.upsert']({ type: 'notify', messages: [{ ...source, key: { ...source.key, id: 'deleted-3' } }] }); await registered['messages.delete']({ keys: [{ ...source.key, id: 'deleted-3' }] }); assert.equal(sent.length, 2); assert.equal(metrics.moderationActions, 1)
})
test('handles Baileys rc14 revoke updates emitted through messages.update', async () => {
  const registered = {}; const sent = []; const metrics = { moderationActions: 0 }; const policy = { antiDelete: true }
  const sock = { user: { id: 'bot@s.whatsapp.net' }, ev: { on: (event, handler) => { registered[event] = handler } }, sendMessage: async (...args) => sent.push(args) }
  const settings = { get: () => policy }; attachHandlers({ sock, commands: { lookup: () => undefined, sudo: { has: () => false } }, settings, config: { prefix: '.', ownerNumber: '2349166712534', antiDeleteLogJid: '' }, seen: new Set(), metrics })
  const original = { key: { id: 'revoke-1', remoteJid: '123-456@g.us', participant: 'user@s.whatsapp.net' }, message: { conversation: 'rc14 revoke' } }
  await registered['messages.upsert']({ type: 'notify', messages: [original] })
  await registered['messages.update']([{ key: original.key, update: { message: null, messageStubType: 1, key: { id: 'protocol-1', remoteJid: '123-456@g.us' } } }])
  assert.equal(sent.length, 2); assert.match(sent[1][1].text, /rc14 revoke/); assert.equal(metrics.moderationActions, 1)
})
