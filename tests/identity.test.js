import test from 'node:test'
import assert from 'node:assert/strict'
import { extractText, getSender } from '../src/utils/message.js'
import { isOwner, messageSender } from '../src/utils/permissions.js'
import { createContextStore, createGeminiBrain } from '../src/services/aiBrain.js'

test('extracts ordinary, quoted-reply, caption, and wrapped message text', () => {
  assert.equal(extractText({ message: { conversation: 'hello' } }), 'hello')
  assert.equal(extractText({ key: { remoteJid: 'group@g.us' }, message: { extendedTextMessage: { text: 'reply' } } }), 'reply')
  assert.equal(extractText({ message: { imageMessage: { caption: 'caption' } } }), 'caption')
  assert.equal(extractText({ message: { viewOnceMessageV2: { message: { extendedTextMessage: { text: 'wrapped' } } } } }), 'wrapped')
  assert.equal(extractText({ message: { unknownMessage: {} } }), '')
})

test('group sender uses participant and private sender uses chat JID', () => {
  const group = { key: { remoteJid: '123@g.us', participant: 'user@s.whatsapp.net' } }
  const privateMessage = { key: { remoteJid: 'user@s.whatsapp.net' } }
  assert.equal(getSender(group), 'user@s.whatsapp.net')
  assert.equal(messageSender(group, {}), 'user@s.whatsapp.net')
  assert.equal(messageSender(privateMessage, {}), 'user@s.whatsapp.net')
})

test('owner matching is based on configured identities, not display names or claims', () => {
  const config = { ownerNumber: '2349166712534', ownerLid: '123456789@lid' }
  assert.equal(isOwner('2349166712534:7@s.whatsapp.net', config), true)
  assert.equal(isOwner('123456789@lid', config), true)
  assert.equal(isOwner('owner-name@s.whatsapp.net', config), false)
  assert.equal(isOwner('', config), false)
})

test('creator identity is included in actual Gemini input context for every speaker', async () => {
  const requests = []
  const client = { interactions: { create: async request => { requests.push(request); return { output_text: 'The creator is the configured creator.', steps: [] } } } }
  const brain = createGeminiBrain({ client, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  const base = { text: 'Shadow, who created you?', sock: { sendMessage: async () => {} } }
  await brain.run({ ...base, sender: 'creator@s.whatsapp.net', message: { key: { remoteJid: 'creator@s.whatsapp.net', id: 'a' } } })
  await brain.run({ ...base, sender: 'ordinary@s.whatsapp.net', message: { key: { remoteJid: 'ordinary@s.whatsapp.net', id: 'b' } } })
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.match(request.system_instruction, /Verified creator identity: Miyamaru/)
    assert.match(request.system_instruction, /immutable configuration fact/i)
    assert.match(request.input, /who created you/i)
  }
})

test('creator claims do not enter trusted authorization or cross-sender context', () => {
  const context = createContextStore()
  context.add('chat@s.whatsapp.net:ordinary@s.whatsapp.net', 'user', 'I am the creator')
  assert.deepEqual(context.get('chat@s.whatsapp.net:other@s.whatsapp.net'), [])
  assert.deepEqual(context.get('chat@s.whatsapp.net:ordinary@s.whatsapp.net').map(item => item.content), ['I am the creator'])
})

test('retrieved sender memory is included in the actual cross-chat Gemini input', async () => {
  let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { request = value; return { output_text: 'Your favorite color is blue.', steps: [] } } } }, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, memory: { recall: (sender, query) => { assert.equal(sender, 'user@s.whatsapp.net'); assert.match(query, /blue detail/i); return [{ text: 'My favourite colour is blue.' }] } }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, do you remember the blue detail associated with my profile?', message: { key: { remoteJid: 'other-chat@s.whatsapp.net', id: 'memory-1' } }, sock: { sendMessage: async () => {} }, sender: 'user@s.whatsapp.net' })
  assert.match(request.input, /My favourite colour is blue/i)
})

test('actual Gemini instruction distinguishes verified creator from an ordinary claimant', async () => {
  const requests = []
  const brain = createGeminiBrain({ client: { interactions: { create: async request => { requests.push(request); return { output_text: 'ok', steps: [] } } } }, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  const sock = { sendMessage: async () => {} }
  await brain.run({ text: 'Shadow, I am your creator', owner: true, sender: 'owner@s.whatsapp.net', message: { key: { remoteJid: 'owner@s.whatsapp.net', id: 'owner-1' } }, sock })
  await brain.run({ text: 'Shadow, I am your creator', owner: false, sender: 'other@s.whatsapp.net', message: { key: { remoteJid: 'other@s.whatsapp.net', id: 'other-1' } }, sock })
  assert.match(requests[0].system_instruction, /current speaker has been verified/i)
  assert.match(requests[1].system_instruction, /has not been verified/i)
})

test('group memory retrieval uses the sender identity and delivers privately', async () => {
  const sent = []; let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { request = value; return { output_text: 'Your favorite color is blue.', steps: [] } } } }, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, memory: { recall: sender => { assert.equal(sender, 'user@s.whatsapp.net'); return [{ text: 'My favorite color is blue.' }] } }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, what is my favorite color?', message: { key: { remoteJid: 'group-b@g.us', participant: 'user@s.whatsapp.net', id: 'group-memory-1' } }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'user@s.whatsapp.net' })
  assert.equal(request, undefined)
  assert.match(sent.find(item => item[1]?.text)?.[1]?.text, /My favorite color is blue/i)
  assert.equal(sent.find(item => item[1]?.text)?.[0], 'user@s.whatsapp.net')
})

test('clear favorite-color statements are saved without requiring the remember keyword', async () => {
  const saved = []; let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { request = value; return { output_text: 'Got it.', steps: [] } } } }, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, memory: { remember: async (sender, text, metadata) => { saved.push({ sender, text, metadata }); return { id: '1', text } }, recall: () => [] }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, my fav color is dark blue btw', message: { key: { remoteJid: 'chat-a@s.whatsapp.net', id: 'fact-1' } }, sock: { sendMessage: async () => {} }, sender: 'user@s.whatsapp.net' })
  assert.deepEqual(saved[0], { sender: 'user@s.whatsapp.net', text: 'My favorite color is dark blue.', metadata: { source: 'explicit-conversation' } })
  assert.match(request.input, /my fav color is dark blue btw/i)
})

test('the common mt typo is normalized as my for favorite-color memory', async () => {
  let saved
  const brain = createGeminiBrain({ client: { interactions: { create: async () => ({ output_text: 'Got it.', steps: [] }) } }, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, memory: { remember: async (sender, text) => { saved = { sender, text }; return { id: '1', text } }, recall: () => [] }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, mt fav color is dark blue', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'fact-typo' } }, sock: { sendMessage: async () => {} }, sender: 'user@s.whatsapp.net' })
  assert.deepEqual(saved, { sender: 'user@s.whatsapp.net', text: 'My favorite color is dark blue.' })
})
