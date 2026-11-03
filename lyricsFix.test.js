import test from 'node:test'
import assert from 'node:assert/strict'
import { searchLyrics, formatLyricsResults } from '../src/services/lyrics.js'
import { createNlRouter } from '../src/services/nlCommands.js'
import { buildCommands } from '../src/commands/registry.js'
import { createMessageHandler } from '../src/handlers/messageHandler.js'
import { createGroupSettings } from '../src/services/groupSettings.js'
import { createSudoService } from '../src/services/sudo.js'
import { createGeminiBrain } from '../src/services/aiBrain.js'
import { config } from '../src/config.js'

const contact = 'https://example.org/bot'
const reply = data => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => data })
const fail = status => ({ status, ok: false, headers: { get: () => null }, json: async () => ({}) })
const track = (trackName, artistName, extra = {}) => ({ trackName, artistName, albumName: 'Album', plainLyrics: 'PLACEHOLDER LYRIC TEXT', ...extra })

// Fake LRCLIB: answers by the documented parameters (q, track_name, artist_name) and records every request.
function provider(rows) {
  const requests = []
  const fetchImpl = async url => {
    const p = Object.fromEntries(url.searchParams.entries()); requests.push(p)
    const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const out = rows.filter(row => {
      if (p.track_name || p.artist_name) return (!p.track_name || norm(row.trackName).includes(norm(p.track_name))) && (!p.artist_name || norm(row.artistName).includes(norm(p.artist_name)))
      return p.q.toLowerCase().split(/\s+/).every(word => `${norm(row.trackName)} ${norm(row.artistName)}`.includes(word))
    })
    return reply(out)
  }
  return { requests, fetchImpl }
}
const run = (query, rows) => { const p = provider(rows); return searchLyrics(query, { contact, fetchImpl: p.fetchImpl }).then(matches => ({ matches, requests: p.requests })) }

test('"title by artist" is searched with separate title and artist fields', async () => {
  const { matches, requests } = await run('Contigo by BoyWithUke', [track('Contigo', 'BoyWithUke')])
  assert.deepEqual(requests[0], { track_name: 'Contigo', artist_name: 'BoyWithUke' })
  assert.deepEqual(matches.map(item => `${item.title} — ${item.artist}`), ['Contigo — BoyWithUke'])
})

test('"title - artist" is searched with separate title and artist fields', async () => {
  const { requests } = await run('Contigo - BoyWithUke', [track('Contigo', 'BoyWithUke')])
  assert.deepEqual(requests[0], { track_name: 'Contigo', artist_name: 'BoyWithUke' })
})

test('a title on its own is a plain keyword search', async () => {
  const { requests } = await run('Contigo', [track('Contigo', 'BoyWithUke')])
  assert.deepEqual(requests, [{ q: 'Contigo' }])
})

test('if the structured search finds nothing, it falls back to a keyword search without the word "by"', async () => {
  const rows = [track('Contigo', 'BoyWithUke')]
  const requests = []
  const fetchImpl = async url => { const p = Object.fromEntries(url.searchParams.entries()); requests.push(p); return reply(p.q === 'Contigo BoyWithUke' ? rows : []) }
  const matches = await searchLyrics('Contigo by BoyWithUke', { contact, fetchImpl })
  assert.equal(matches.length, 1)
  assert.deepEqual(requests.map(p => p.q || 'structured'), ['structured', 'Contigo BoyWithUke'])
})

test('titles that contain "by" still work, with or without an artist', async () => {
  const rows = [track('Stand By Me', 'Ben E. King'), track('Stand By Me', 'Oasis')]
  const withArtist = await run('Stand By Me by Ben E. King', rows)
  assert.deepEqual(withArtist.requests[0], { track_name: 'Stand By Me', artist_name: 'Ben E. King' })
  assert.deepEqual(withArtist.matches.map(item => item.artist), ['Ben E. King'])
  const noArtist = await run('Stand By Me', rows)
  assert.equal(noArtist.matches.length, 2, 'two different artists, so it must ask which one')
})

test('an exact title-and-artist match wins over covers, remixes and other artists', async () => {
  const rows = [track('Contigo (Remix)', 'Someone Else'), track('Contigo', 'Other Artist'), track('Contigo', 'BoyWithUke'), track('Contigo - Live', 'BoyWithUke')]
  const { matches } = await run('Contigo - BoyWithUke', rows)
  assert.deepEqual(matches.map(item => `${item.title} — ${item.artist}`), ['Contigo — BoyWithUke'])
  assert.doesNotMatch(formatLyricsResults(matches), /Which one did you mean/)
})

test('case and accents do not break an exact match', async () => {
  const { matches } = await run('halo - beyonce', [track('Halo', 'Beyoncé')])
  assert.deepEqual(matches.map(item => item.artist), ['Beyoncé'])
})

test('a title shared by several artists asks which one; a unique exact title does not', async () => {
  const shared = await run('Contigo', [track('Contigo', 'BoyWithUke'), track('Contigo', 'Tini')])
  assert.equal(shared.matches.length, 2); assert.match(formatLyricsResults(shared.matches), /Which one did you mean/)
  const unique = await run('Contigo', [track('Contigo', 'BoyWithUke'), track('Contigo Y Sin Ti', 'Someone')])
  assert.deepEqual(unique.matches.map(item => item.artist), ['BoyWithUke'])
})

test('a wrong artist is never answered with a confident single result', async () => {
  const { matches } = await run('Contigo by Nobody Famous', [track('Contigo', 'BoyWithUke'), track('Contigo', 'Tini')])
  assert.ok(matches.length !== 1 || matches[0].artist !== 'BoyWithUke' || false, 'must not silently pick one artist for a different artist')
  assert.match(formatLyricsResults(matches), /Which one did you mean|couldn’t find/)
})

test('no lyric text ever leaves the service, and at most three provider calls are made', async () => {
  const { matches, requests } = await run('Contigo by Nobody Famous', [track('Contigo', 'BoyWithUke', { syncedLyrics: '[00:01] PLACEHOLDER SYNCED' })])
  assert.doesNotMatch(JSON.stringify(matches) + formatLyricsResults(matches), /PLACEHOLDER/)
  assert.ok(requests.length <= 3, `made ${requests.length} calls`)
})

test('a failure on the first call is reported; a failure after a good answer is ignored', async () => {
  await assert.rejects(searchLyrics('Contigo by BoyWithUke', { contact, fetchImpl: async () => fail(503) }), /HTTP 503/)
  let n = 0
  const matches = await searchLyrics('Contigo by Someone', { contact, fetchImpl: async () => { n += 1; if (n === 1) return reply([track('Contigo', 'BoyWithUke')]); throw new Error('offline') } })
  assert.ok(Array.isArray(matches))
})

// ---- natural language ---------------------------------------------------------------------------------------------------
const commands = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], has: () => false }, startedAt: Date.now(), metrics: {}, downloader: null, reactions: null })
const router = createNlRouter({ commands })

test('every spoken form from the request reaches the lyrics command with the song text', () => {
  const cases = [['give me the lyrics to Contigo by BoyWithUke.', 'Contigo by BoyWithUke'], ['what are the lyrics of Contigo by BoyWithUke?', 'Contigo by BoyWithUke'], ['find the lyrics for Contigo by BoyWithUke', 'Contigo by BoyWithUke'], ['search for the lyrics of Contigo', 'Contigo'], ['what does Contigo say?', 'Contigo'], ['what are the words to Contigo', 'Contigo'], ['lyrics to Contigo', 'Contigo']]
  for (const [say, expected] of cases) {
    const decision = router.interpret(say, {})
    assert.equal(decision.kind, 'command', say); assert.equal(decision.name, 'lyrics', say); assert.equal(decision.args.join(' '), expected, say)
  }
})

test('"what does ... say" is only a lyrics request when it names a song, not a person, a reply or a thing', () => {
  for (const say of ['what does he say?', 'what does she say', 'what does that say?', 'what does it say', 'what does the message say?', 'what does the sign say', 'what does everyone say']) assert.notEqual(router.interpret(say, {}).name, 'lyrics', say)
  assert.notEqual(router.interpret('what does Contigo say?', { hasQuote: true, quoted: { text: 'x' } }).name, 'lyrics', 'with a replied-to message it is about that message')
})

test('asking for lyrics without naming a song asks which song', () => {
  const decision = router.interpret('give me the lyrics', {})
  assert.equal(decision.kind, 'ask'); assert.match(decision.text, /Which song/)
})

// ---- the whole path, through the real handler ----------------------------------------------------------------------------
test('through the real handler: a spoken request finds the song and never replies with lyric text', async () => {
  const store = initial => ({ data: initial, get() { return this.data }, async update(fn) { const next = await fn(this.data); if (next !== undefined) this.data = next }, async flush() {} })
  const p = provider([track('Contigo', 'BoyWithUke')])
  const cfg = { ...config, ownerNumber: '2349166712534', ownerLid: '', prefix: '.' }
  const sudo = createSudoService(store(['777000111@lid'])); const settings = createGroupSettings(store({}), cfg)
  const real = buildCommands({ settings, warnings: store({}), sudo, startedAt: Date.now(), metrics: {}, downloader: null, reactions: null, lyricsLookup: query => searchLyrics(query, { contact, fetchImpl: p.fetchImpl }) })
  const sent = []
  const sock = { user: { id: '2348000000000:5@s.whatsapp.net' }, sendMessage: async (jid, content) => { sent.push(content?.text); return { key: { id: 'x' } } }, groupMetadata: async () => ({ participants: [] }) }
  const handle = createMessageHandler({ sock, commands: real, settings, config: cfg, seen: new Set(), onAutoDelete: async () => {}, aiBrain: null, metrics: {}, log: { debug() {}, warn() {}, info() {} } })
  let n = 0
  for (const text of ['Shadow, give me the lyrics to Contigo by BoyWithUke.', 'Shadow, what does Contigo say?', '.lyrics Contigo - BoyWithUke']) {
    await handle({ type: 'notify', messages: [{ key: { id: `m${++n}`, remoteJid: '777000111@lid', fromMe: false }, message: { conversation: text } }] })
  }
  assert.equal(sent.length, 3)
  for (const text of sent) { assert.match(text, /Song match: Contigo — BoyWithUke/); assert.doesNotMatch(text, /PLACEHOLDER/) }
})

// ---- the AI must not improvise lyrics -----------------------------------------------------------------------------------
test('the AI is told never to write or reconstruct lyrics and to point to .lyrics instead', async () => {
  const requests = []
  const client = { interactions: { create: async request => { requests.push(request); return { output_text: 'ok', steps: [] } } } }
  const brain = createGeminiBrain({ client, config: { geminiModel: 'm', geminiFastModel: 'f', geminiTimeoutMs: 1000 }, sudo: { has: () => true }, logger: { debug() {}, warn() {}, error() {} } })
  await brain.run({ text: 'Shadow, hello there', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'a1' } }, sock: { sendMessage: async () => ({ key: { id: 'x' } }) }, sender: 'chat@s.whatsapp.net', owner: true })
  assert.match(requests[0].system_instruction, /song lyrics/i)
  assert.match(requests[0].system_instruction, /\.lyrics/)
})
