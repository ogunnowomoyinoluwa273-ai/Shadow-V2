import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiBrain, createContextStore, roastIntensity } from '../src/services/aiBrain.js'

test('roast intensity distinguishes ordinary, light, sharp, savage, and serious exchanges', () => {
  assert.equal(roastIntensity('What is the weather?'), 'none')
  assert.equal(roastIntensity('Give me a playful comeback'), 'light')
  assert.equal(roastIntensity('Fuck you, Shadow'), 'light')
  assert.equal(roastIntensity('Go savage. No mercy.'), 'savage')
  assert.equal(roastIntensity("I'm genuinely upset, please help me"), 'none')
})

test('repeated banter escalates without changing serious-topic handling', () => {
  const history = [{ role: 'user', content: 'roast me' }, { role: 'model', content: 'comeback' }, { role: 'user', content: 'banter harder' }]
  assert.equal(roastIntensity('try another comeback', history), 'sharp')
  assert.equal(roastIntensity('I am seriously hurt by this', history), 'none')
})

test('actual request carries roast guidance and the full conversation context', async () => {
  const requests = []
  const brain = createGeminiBrain({ client: { interactions: { create: async request => { requests.push(request); return { output_text: 'That comeback was about your argument, not you.', steps: [] } } } }, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, context: createContextStore(), sudo: { has: () => true } })
  const message = { key: { remoteJid: 'chat@s.whatsapp.net', id: 'roast-1' } }; const sock = { sendMessage: async () => {} }
  await brain.run({ text: 'Shadow, roast my terrible argument', message, sock, sender: 'user@s.whatsapp.net' })
  assert.match(requests[0].system_instruction, /original, context-specific comeback/i)
  assert.match(requests[0].system_instruction, /protected or sensitive traits/i)
  assert.match(requests[0].input, /roast my terrible argument/i)
})

test('serious follow-up tells the model to stop roasting', async () => {
  const requests = []
  const brain = createGeminiBrain({ client: { interactions: { create: async request => { requests.push(request); return { output_text: 'I am listening.', steps: [] } } } }, config: { ownerName: 'Miyamaru', geminiFastModel: 'test', geminiTimeoutMs: 1000 }, context: createContextStore(), sudo: { has: () => true } })
  const message = { key: { remoteJid: 'chat-2@s.whatsapp.net', id: 'serious-1' } }; const sock = { sendMessage: async () => {} }
  await brain.run({ text: 'Shadow, I am genuinely upset. Please help me seriously.', message, sock, sender: 'user@s.whatsapp.net' })
  assert.match(requests[0].system_instruction, /serious or ordinary exchange/i)
  assert.match(requests[0].system_instruction, /do not force a joke or roast/i)
})
