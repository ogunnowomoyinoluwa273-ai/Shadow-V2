import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../src/services/jsonStore.js'
import { createMemoryService } from '../src/services/memory.js'
import { createToolRegistry } from '../src/services/aiBrain.js'

test('persistent memory saves, recalls, deletes, and isolates users', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-memory-'))
  const file = path.join(dir, 'memories.json')
  try {
    const store = await createJsonStore(file, {})
    const memory = createMemoryService(store)
    const saved = await memory.remember('Alice@S.whatsapp.net', 'I prefer short answers.')
    await memory.remember('Bob@s.whatsapp.net', 'I like detailed answers.')
    assert.equal(memory.recall('alice@s.whatsapp.net', 'short').length, 1)
    assert.equal(memory.recall('alice@s.whatsapp.net', 'detailed').length, 0)
    assert.equal(await memory.forget('alice@s.whatsapp.net', saved.id), true)
    assert.equal(memory.recall('alice@s.whatsapp.net').length, 0)
    const reloaded = createMemoryService(await createJsonStore(file, {}))
    assert.equal(reloaded.recall('bob@s.whatsapp.net').length, 1)
    await reloaded.clear('bob@s.whatsapp.net')
    assert.equal(reloaded.recall('bob@s.whatsapp.net').length, 0)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('a verified sender recalls memory across different chats after restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-cross-chat-'))
  const file = path.join(dir, 'memories.json')
  try {
    const first = createMemoryService(await createJsonStore(file, {}))
    await first.remember('2349166712534:7@s.whatsapp.net', 'My favourite colour is blue.')
    const restarted = createMemoryService(await createJsonStore(file, {}))
    assert.equal(restarted.recall('2349166712534@s.whatsapp.net', "What's my favorite color?")[0].text, 'My favourite colour is blue.')
    assert.equal(restarted.recall('other@s.whatsapp.net', 'favorite color').length, 0)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('failed memory persistence is reported as a failure, not a successful save', async () => {
  const memory = createMemoryService({ get: () => ({}), update: async () => { throw new Error('disk unavailable') } })
  await assert.rejects(() => memory.remember('user@s.whatsapp.net', 'My color is blue'), /disk unavailable/)
})

test('group chats cannot expose or save private memory through memory tools', async () => {
  const memory = { remember: async () => { throw new Error('should not write') }, recall: () => [{ text: 'private' }], forget: async () => true, clear: async () => {} }
  const registry = createToolRegistry({ memory, memoryUserKey: 'participant@s.whatsapp.net', memoryAllowed: false })
  await assert.rejects(() => registry.byName.get('recall_memories').execute({ query: 'private' }), /disabled in group chats/)
  await assert.rejects(() => registry.byName.get('remember').execute({ text: 'secret' }), /disabled in group chats/)
})

test('the same sender owns memory across private chats and multiple groups', async () => {
  const state = {}
  const store = { get: () => state, update: async fn => Object.assign(state, await fn(state)) }
  const memory = createMemoryService(store)
  await memory.remember('user@s.whatsapp.net', 'My project codename is Shadow.')
  assert.equal(memory.recall('user@s.whatsapp.net', 'project codename').length, 1)
  assert.equal(memory.recall('user:2@s.whatsapp.net', 'project codename').length, 1)
  assert.equal(memory.recall('other@s.whatsapp.net', 'project codename').length, 0)
})
