import test from 'node:test'
import assert from 'node:assert/strict'
import { searchLyrics, formatLyricsResults } from '../src/services/lyrics.js'
import { UserFacingError } from '../src/utils/errors.js'

const contact = 'https://github.com/ogunnowomoyinoluwa273-ai/Shadow-V2'
const response = (status, data, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: name => headers[name.toLowerCase()] || null }, json: async () => data })

test('LRCLIB lookup sends a bounded metadata query and client identity, discards lyric text, and returns Genius links', async () => {
  let requestedUrl; let requestedOptions
  const matches = await searchLyrics('Blinding Lights - The Weeknd', { contact, fetchImpl: async (url, options) => {
    requestedUrl = url; requestedOptions = options
    return response(200, [{ trackName: 'Blinding Lights', artistName: 'The Weeknd', albumName: 'After Hours', plainLyrics: 'COPYRIGHTED SECRET LYRICS', syncedLyrics: '[00:01] COPYRIGHTED SECRET LYRICS' }])
  } })
  assert.equal(requestedUrl.origin, 'https://lrclib.net')
  assert.equal(requestedUrl.pathname, '/api/search')
  assert.equal(requestedUrl.searchParams.get('track_name'), 'Blinding Lights')
  assert.equal(requestedUrl.searchParams.get('artist_name'), 'The Weeknd')
  assert.equal(requestedUrl.searchParams.get('q'), null, 'title and artist are sent as separate fields, not one keyword string')
  assert.match(requestedOptions.headers['user-agent'], new RegExp(contact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(requestedOptions.headers.accept, 'application/json')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0], { title: 'Blinding Lights', artist: 'The Weeknd', url: 'https://genius.com/search?q=Blinding%20Lights%20The%20Weeknd' })
  assert.doesNotMatch(JSON.stringify(matches), /COPYRIGHTED SECRET LYRICS/)
  assert.match(formatLyricsResults(matches), /licensed lyrics\/search result/)
  assert.doesNotMatch(formatLyricsResults(matches), /COPYRIGHTED SECRET LYRICS/)
})

test('multiple distinct LRCLIB matches are preserved for user clarification, and duplicates are removed', async () => {
  const matches = await searchLyrics('Home', { contact, fetchImpl: async () => response(200, [
    { trackName: 'Home', artistName: 'Artist A', plainLyrics: 'hidden' },
    { trackName: 'Home', artistName: 'Artist A', plainLyrics: 'hidden' },
    { trackName: 'Home', artistName: 'Artist B', syncedLyrics: 'hidden' }
  ]) })
  assert.equal(matches.length, 2)
  assert.match(formatLyricsResults(matches), /Which one did you mean\?/)
  assert.match(formatLyricsResults(matches), /Home — Artist A/)
  assert.match(formatLyricsResults(matches), /Home — Artist B/)
  assert.doesNotMatch(formatLyricsResults(matches), /hidden/)
})

test('empty results render a useful retry example', async () => {
  const matches = await searchLyrics('unmatched title', { contact, fetchImpl: async () => response(200, []) })
  assert.deepEqual(matches, [])
  assert.match(formatLyricsResults(matches), /couldn’t find a matching song/i)
  assert.match(formatLyricsResults(matches), /\.lyrics/)
})

test('provider errors are distinguished and never reported as successful matches', async t => {
  const cases = [
    [429, {}, /rate-limited/i],
    [502, {}, /HTTP 502/],
    [200, null, /unexpected response/i]
  ]
  for (const [status, data, message] of cases) await t.test(`HTTP ${status}`, async () => {
    await assert.rejects(searchLyrics('Song Artist', { contact, fetchImpl: async () => response(status, data) }), error => error instanceof UserFacingError && message.test(error.userMessage))
  })
})

test('bad queries, missing contact, and network errors fail clearly without calling through', async () => {
  let calls = 0
  await assert.rejects(searchLyrics(' ', { contact, fetchImpl: async () => { calls++; return response(200, []) } }), /Usage:/)
  await assert.rejects(searchLyrics('Song', { fetchImpl: async () => { calls++; return response(200, []) } }), /not configured/i)
  await assert.rejects(searchLyrics('Song', { contact, fetchImpl: async () => { throw new Error('offline') } }), /could not connect/i)
  assert.equal(calls, 0)
})
