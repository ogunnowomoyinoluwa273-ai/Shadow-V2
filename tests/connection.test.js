import test from 'node:test'
import assert from 'node:assert/strict'
import { makeSafeAuthState } from '../src/connection/connect.js'
import { attachHandlers } from '../src/handlers/eventHandler.js'

test('rc14 device-list state is read as volatile and never written, while Signal keys pass through', async () => {
  const calls = []
  const state = { creds: { registered: true }, keys: { get: async (type, ids) => { calls.push(['get', type, ids]); return { [ids[0]]: 'session-value' } }, set: async data => calls.push(['set', data]) } }
  const safe = makeSafeAuthState(state, { debug: () => {} })
  assert.deepEqual(await safe.keys.get('device-list', ['234']), {})
  assert.deepEqual(await safe.keys.get('session', ['234.0']), { '234.0': 'session-value' })
  await safe.keys.set({ 'device-list': { '234': ['0'] }, session: { '234.0': 'session-value' }, 'sender-key': { 'group::user': 'key' } })
  assert.deepEqual(calls.at(-1), ['set', { session: { '234.0': 'session-value' }, 'sender-key': { 'group::user': 'key' } }])
})

test('decrypted private and group upserts reach the real message handler once', async () => {
  const registered = {}; const received = []
  const sock = { user: { id: 'bot@lid' }, ev: { on: (event, handler) => { registered[event] = handler } }, sendMessage: async () => {} }
  const aiBrain = { parseShadowAddress: () => null }
  const commands = { lookup: () => undefined, sudo: { has: () => false } }
  attachHandlers({ sock, commands, settings: { get: () => ({}) }, config: { prefix: '.', ownerNumber: '2349166712534' }, seen: new Set(), aiBrain, metrics: {}, log: { debug: () => {}, warn: () => {} } })
  const original = registered['messages.upsert']
  registered['messages.upsert'] = async event => { received.push(...event.messages); return original(event) }
  await registered['messages.upsert']({ type: 'notify', messages: [
    { key: { id: 'private-1', remoteJid: '234@s.whatsapp.net', participant: '234@s.whatsapp.net' }, message: { conversation: 'Shadow hello' } },
    { key: { id: 'group-1', remoteJid: '120@g.us', participant: '234@lid', participantAlt: '234@s.whatsapp.net' }, message: { conversation: 'Shadow hello group' } }
  ] })
  assert.equal(received.length, 2)
})
