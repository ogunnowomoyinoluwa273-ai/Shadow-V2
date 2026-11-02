import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCommands } from '../src/commands/registry.js'
import { NL_CATALOG, createNlRouter, parseAddress } from '../src/services/nlCommands.js'
import { EXAMPLES, QUOTED, T } from './nlExamples.js'

const store = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next }, async flush() {} })
const commands = buildCommands({ settings: { get: () => ({}), set: async () => ({}) }, warnings: store({}), sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => false }, startedAt: Date.now(), metrics: {}, downloader: null, reactions: null })
const router = createNlRouter({ commands })
const ctxFor = opts => ({ mentions: opts.mention ? [opts.mention] : [], quoted: opts.quote ? { participant: opts.quote.participant, text: opts.quote.text } : null, hasQuote: Boolean(opts.quote) })

test('every registered command has an example and every example names a registered command', () => {
  const registered = commands.allCommands.map(command => command.name).sort()
  const covered = EXAMPLES.map(example => example[0]).sort()
  assert.deepEqual(covered, registered)
  assert.equal(new Set(covered).size, registered.length, 'no command is listed twice')
})

test('coverage report: all commands are curated, none rely on name-only fallback, no stale catalog entries', () => {
  const coverage = router.coverage()
  assert.equal(coverage.total, commands.allCommands.length)
  assert.equal(coverage.curated, coverage.total)
  assert.deepEqual(coverage.autoNames, [])
  assert.deepEqual(coverage.orphanCatalog, [])
})

for (const [name, say, opts, expected] of EXAMPLES) {
  test(`"Shadow, ${say}" -> .${name}${expected ? ` ${expected.slice(0, 40)}` : ''}`, () => {
    const decision = router.interpret(say, ctxFor(opts))
    assert.equal(decision.kind, 'command', `expected a command, got ${JSON.stringify(decision)}`)
    assert.equal(decision.name, name)
    assert.equal(decision.args.join(' '), expected)
    assert.equal(decision.text, `.${name}${expected ? ` ${expected}` : ''}`)
  })
}

test('the examples from the request all route to the intended command', () => {
  const asked = [['ping.', 'ping'], ['are you alive?', 'alive'], ['how long have you been running?', 'runtime'], ['show me your commands.', 'menu'], ['tag everyone in this group.', 'tagall'], ['turn on anti-link protection.', 'antilink'], ['send me a random quote.', 'quote'], ['tell me the group rules.', 'rules'], ['who are the admins here?', 'admins'], ['enable anti-link.', 'antilink'], ['disable welcome messages.', 'setwelcome'], ['check your uptime.', 'runtime']]
  for (const [say, name] of asked) assert.equal(router.interpret(say, {}).name, name, say)
  assert.equal(router.interpret('remove this member from the group.', ctxFor({ mention: T })).name, 'kick')
  assert.equal(router.interpret('make this member an admin.', ctxFor({ mention: T })).name, 'promote')
  assert.equal(router.interpret('warn this member.', ctxFor({ quote: QUOTED })).name, 'warn')
})

test('different wordings and polite fillers reach the same command', () => {
  for (const say of ['please could you tell me how long you have been running', 'Hey, can you check the uptime', 'I want you to show me your uptime']) assert.equal(router.interpret(say, {}).name, 'runtime', say)
  for (const say of ['are you online?', 'are you awake', 'you alive?']) assert.equal(router.interpret(say, {}).name, 'alive', say)
  for (const say of ['mention everyone', 'ping everyone', 'tag all members']) assert.equal(router.interpret(say, {}).name, 'tagall', say)
})

test('anti-delete understands common phrasings and does not request redundant confirmation', () => {
  for (const [say, expected] of [['turn on anti-delete', 'on'], ['turn on antidelete', 'on'], ['enable anti-delete', 'on'], ['i want you to activate anti-delete', 'on'], ['stop notifying me about deleted messages', 'off'], ['disable antidelete', 'off'], ['disable anti-delete', 'off']]) {
    const decision = router.handle({ prompt: say, message: { key: { remoteJid: '123@g.us' } }, sender: T, jid: '123@g.us', precheck: () => true })
    assert.equal(decision.type, 'command', say)
    assert.equal(decision.text, `.antidelete ${expected}`)
  }
})

test('the argument comes from a reply when nobody is tagged, and from a phone number in the text', () => {
  assert.equal(router.interpret('kick this guy', { mentions: [], quoted: { participant: T, text: 'x' }, hasQuote: true }).args[0], T)
  assert.equal(router.interpret('mute 2347012345678', {}).args[0], '2347012345678@s.whatsapp.net')
})

test('requests that need a missing argument get a short question instead of a guess', () => {
  const missing = [['kick', 'Who'], ['promote', 'Who'], ['mute', 'Who'], ['warn', 'Who'], ['add sudo', 'Who'], ['rename the group', 'name'], ['change the group description', 'description'], ['turn on anti link', null], ['weather', 'city'], ['translate', 'translate'], ['download tiktok', 'TikTok'], ['make a sticker', 'Reply'], ['delete this message', 'Reply'], ['set slowmode', 'seconds'], ['close or open the group', 'open or close'], ['disable the command', 'Which command']]
  for (const [say, word] of missing) {
    const decision = router.interpret(say, {})
    if (say === 'turn on anti link') { assert.equal(decision.args.join(' '), 'on'); continue }
    assert.equal(decision.kind, 'ask', say)
    if (word) assert.match(decision.text, new RegExp(word, 'i'), say)
  }
  assert.equal(router.interpret('toggle antilink', {}).kind, 'ask', 'on/off not stated')
})

test('ordinary conversation is left for the AI', () => {
  for (const say of ['tell me a joke about kicking', 'what do you think of the rules?', 'how do I kick someone from a group?', 'write a poem about the weather being nice', 'I love this group', 'how are you today?', 'what is the capital of France', 'tell me a story', 'explain how promotions work at a company', 'ping the group admins about the meeting tomorrow evening please', 'why did the bot mute him last week', 'give me info about naruto']) {
    assert.equal(router.interpret(say, {}).kind, 'none', say)
  }
})

test('conflicting requests are disambiguated by specificity, not guessed', () => {
  assert.equal(router.interpret('tag everyone silently', {}).name, 'hidetag')
  assert.equal(router.interpret('mute the group', {}).name, 'group')
  assert.equal(router.interpret('reset his warnings', ctxFor({ mention: T })).name, 'resetwarnings')
  assert.equal(router.interpret('remove this person as admin', ctxFor({ mention: T })).name, 'demote')
  assert.equal(router.interpret('remove this member from the group', ctxFor({ mention: T })).name, 'kick')
  const fake = createNlRouter({ commands: { allCommands: [{ name: 'zapone', aliases: ['zap'] }, { name: 'zaptwo', aliases: ['zap'] }], lookup: () => null } })
  const decision = fake.interpret('zap', {})
  assert.equal(decision.kind, 'ask'); assert.equal(decision.reason, 'ambiguous'); assert.deepEqual(decision.candidates.sort(), ['zapone', 'zaptwo'])
})

test('a command registered later is reachable automatically, and treated as sensitive when it is group-only', () => {
  const list = [...commands.allCommands, { name: 'fooblast', aliases: ['fb2'], description: 'Test only.', groupOnly: true, run: async () => {} }, { name: 'barinfo', aliases: [], description: 'Test only.', run: async () => {} }]
  const extended = createNlRouter({ commands: { allCommands: list, lookup: name => list.find(command => command.name === name) } })
  const group = extended.interpret('fooblast now', {})
  assert.equal(group.name, 'fooblast'); assert.equal(group.sensitive, true); assert.equal(group.curated, false)
  assert.equal(extended.interpret('barinfo', {}).sensitive, false)
  assert.deepEqual(extended.coverage().autoNames.sort(), ['barinfo', 'fooblast'])
})

test('every privileged command is explicitly classified as sensitive or read-only', () => {
  for (const command of commands.allCommands) {
    if (command.groupOnly || command.ownerOnly) assert.equal(typeof NL_CATALOG[command.name]?.sensitive, 'boolean', `${command.name} needs an explicit sensitive flag`)
  }
  const readOnly = ['groupinfo', 'admins', 'rules', 'warnings', 'sudos', 'stats', 'invite', 'greet', 'antidelete']
  for (const name of readOnly) assert.equal(router.isSensitive(commands.lookup(name)), false, name)
  for (const name of ['kick', 'promote', 'demote', 'mute', 'unmute', 'warn', 'resetwarnings', 'tagall', 'hidetag', 'group', 'setname', 'setdescription', 'setrules', 'setwelcome', 'setgoodbye', 'antilink', 'slowmode', 'disablecmd', 'enablecmd', 'revokeinvite', 'joinrequest', 'delete', 'clear', 'addsudo', 'delsudo', 'broadcast', 'reload']) assert.equal(router.isSensitive(commands.lookup(name)), true, name)
})

test('parseAddress understands how Shadow is addressed', () => {
  assert.equal(parseAddress('Shadow, ping.'), 'ping.')
  assert.equal(parseAddress('shadow tag everyone'), 'tag everyone')
  assert.equal(parseAddress('hey shadow: kick him'), 'kick him')
  assert.equal(parseAddress('ping'), null)
  assert.equal(parseAddress('shadowfax is a horse'), null)
})

test('sensitive natural-language commands execute immediately and preserve original message context', () => {
  const timed = createNlRouter({ commands })
  const original = { key: { id: 'orig-1', remoteJid: 'g@g.us' }, message: { extendedTextMessage: { text: 'Shadow, kick him', contextInfo: { mentionedJid: [T] } } } }
  const go = timed.handle({ prompt: 'kick him', message: original, sender: 'a@s.whatsapp.net', jid: 'g@g.us' })
  assert.equal(go.type, 'command'); assert.equal(go.text, `.kick ${T}`); assert.equal(go.message, undefined)
  assert.equal(timed.pendingCount(), 0)
  assert.equal(timed.handle({ prompt: 'yes', message: { key: { id: 'x' } }, sender: 'a@s.whatsapp.net', jid: 'g@g.us' }), null)
})

test('if the normal pipeline would refuse the command anyway, no confirmation is requested', () => {
  const guarded = createNlRouter({ commands })
  const out = guarded.handle({ prompt: 'kick him', message: { key: { id: 'p' }, message: { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: [T] } } } }, sender: 'a@s.whatsapp.net', jid: 'a@s.whatsapp.net', precheck: () => 'group only' })
  assert.equal(out.type, 'command'); assert.equal(guarded.pendingCount(), 0)
})
