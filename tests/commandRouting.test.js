import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiBrain, createToolRegistry, shouldExposeCommandTool } from '../src/services/aiBrain.js'

const OWNER = '2349166712534@s.whatsapp.net'
const calls = []
const record = name => async () => { calls.push(name) }
const commandList = [
  { name: 'aimodel', aliases: [], description: 'Owner/sudo: show the configured AI model.', ownerOnly: false, run: record('aimodel') },
  { name: 'setdescription', aliases: [], description: 'Change the group description.', groupOnly: true, run: record('setdescription') },
  { name: 'groupinfo', aliases: [], description: 'Show group information.', groupOnly: true, run: record('groupinfo') },
  { name: 'menu', aliases: ['help'], description: 'Show the command menu.', run: record('menu') },
  { name: 'sticker', aliases: [], description: 'Convert a replied-to image or video to a sticker.', run: record('sticker') },
  { name: 'weather', aliases: [], description: 'Show the weather for a place.', run: record('weather') }
]
const commands = { allCommands: commandList, lookup: name => commandList.find(command => command.name === name || (command.aliases || []).includes(name)) || null }
const silent = { debug() {}, warn() {}, error() {} }

test('ordinary requests that merely start with "give / tell / find / show" no longer expose the command tool', () => {
  for (const prompt of ['give me the lyrics for contigo by boywithuke', 'tell me a joke about Lagos traffic', 'give me a recipe for jollof rice', 'find me a good name for a kitten', 'show me how a rainbow forms']) {
    assert.equal(shouldExposeCommandTool(prompt, { commands }), false, prompt)
  }
})

test('real command-style requests still expose the command tool', () => {
  for (const prompt of ['show me the ai model', 'change our group description', 'show group info', 'show me the menu', 'make this a sticker', 'help']) {
    assert.equal(shouldExposeCommandTool(prompt, { commands }), true, prompt)
  }
})

function registryFor(prompt, remoteJid = 'chat@s.whatsapp.net') {
  return createToolRegistry({ sock: { sendMessage: async () => ({}) }, message: { key: { remoteJid, id: 'm1' } }, commands, owner: true, sender: OWNER, prompt, confirmationStore: new Map(), confirmationKey: 'k' })
}

test('the command tool refuses a command that has nothing to do with the request', async () => {
  calls.length = 0
  const tool = registryFor('give me the lyrics for contigo by boywithuke').byName.get('run_existing_command')
  assert.ok(tool, 'tool exists in the registry')
  await assert.rejects(() => tool.execute({ command: 'aimodel', args: [] }), /does not match|no existing command/i)
  assert.deepEqual(calls, [], 'the unrelated command must not run')
})

test('the command tool still runs a command that the request is clearly about', async () => {
  calls.length = 0
  const tool = registryFor('show me the ai model').byName.get('run_existing_command')
  await tool.execute({ command: 'aimodel', args: [] })
  assert.deepEqual(calls, ['aimodel'])
})

test('Gemini is not even offered the command tool for a lyrics request, and the fast model answers it', async () => {
  const requests = []
  const client = { interactions: { create: async request => { requests.push(request); return { output_text: 'Here is what I can say about that song.', steps: [] } } } }
  const brain = createGeminiBrain({ client, commands, logger: silent, config: { geminiFastModel: 'fast-test', geminiModel: 'main-test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  const sent = []
  await brain.run({ text: 'Shadow, give me the lyrics for contigo by boywithuke', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'lyr-1' } }, sock: { sendMessage: async (jid, content) => { sent.push(content?.text); return { key: { id: 'x' } } } }, sender: OWNER, owner: true })
  assert.equal(requests.length, 1)
  assert.ok(!JSON.stringify(requests[0]).includes('run_existing_command'))
  assert.equal(requests[0].model, 'fast-test', 'no tools needed, so the quick model is used')
  assert.ok(sent.some(text => /what I can say/.test(text)))
  assert.ok(!sent.some(text => /Usage:/.test(text)), 'a command usage error must never be the answer')
})
