import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCommands } from '../src/commands/registry.js'

function setup() {
  const commands = buildCommands({
    settings: { get: () => ({}) },
    warnings: { get: () => ({}), update: async fn => fn({}) },
    sudo: { has: () => true, list: () => [], add: async () => {}, remove: async () => {} },
    startedAt: Date.now(),
    downloader: {}
  })
  return commands.lookup('aimodel')
}

test('.aimodel reports the configured Gemini models only', async () => {
  const command = setup()
  const replies = []
  await command.run({
    sock: {},
    message: { key: { remoteJid: 'owner@s.whatsapp.net' } },
    args: [],
    reply: async text => replies.push(text)
  })
  assert.match(replies[0], /Configured AI provider: Google Gemini/)
  assert.match(replies[0], /Conversation model:/)
  assert.match(replies[0], /Tool-enabled model:/)
  assert.doesNotMatch(replies[0], /NVIDIA|DeepSeek/i)
})

test('.aimodel no longer accepts a model-switch selection', async () => {
  const command = setup()
  await assert.rejects(() => command.run({
    sock: {},
    message: { key: { remoteJid: 'owner@s.whatsapp.net' } },
    args: ['2'],
    reply: async () => {}
  }), /aimodel \[status\]/)
})
