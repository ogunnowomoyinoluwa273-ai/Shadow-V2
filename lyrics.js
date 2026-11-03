import { UserFacingError } from '../utils/errors.js'

const API = 'https://lrclib.net/api/search'
const MAX_QUERY = 120
const MAX_RESULTS = 5
const MAX_CALLS = 3
const REQUEST_TIMEOUT_MS = 8_000

function cleanMetadata(value, maxLength) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) : ''
}

function asGeniusSearch(title, artist) {
  const query = [title, artist].filter(Boolean).join(' ')
  return `https://genius.com/search?q=${encodeURIComponent(query)}`
}

// Lower-case, strip accents, brackets and punctuation so "Beyoncé - Halo (Remastered)" compares equal to "beyonce halo".
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

// "Title - Artist" and "Title by Artist" become separate fields. A title may itself contain "by" ("Stand By Me"), so a
// title-only reading is always kept as an alternative and the results decide which reading is right.
export function parseLyricsQuery(term) {
  const dash = term.split(/\s+[-–—]\s+/).map(part => part.trim()).filter(Boolean)
  if (dash.length >= 2) {
    const title = dash.slice(0, -1).join(' - '); const artist = dash.at(-1)
    return { wants: [{ title, artist }], plain: `${title} ${artist}`, structured: { title, artist } }
  }
  const spots = [...term.matchAll(/\s+by\s+/gi)]
  const wants = []
  let structured = null
  if (spots.length) {
    const spot = spots.at(-1)
    const title = term.slice(0, spot.index).trim(); const artist = term.slice(spot.index + spot[0].length).trim()
    if (title && artist) { wants.push({ title, artist }); structured = { title, artist } }
  }
  wants.push({ title: term, artist: '' })
  return { wants, plain: term.replace(/\s+by\s+/gi, ' '), structured }
}

async function fetchMatches(params, { clientContact, fetchImpl }) {
  const url = new URL(API)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  let response
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': `SHADOW WhatsApp Bot/1.0 (${clientContact})` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new UserFacingError('Lyrics search timed out. No result was returned; please try again later.')
    }
    throw new UserFacingError('Lyrics search could not connect to LRCLIB. No result was returned; please try again later.')
  }
  if (response.status === 429) throw new UserFacingError('Lyrics search is temporarily rate-limited. Please try again later.')
  if (!response.ok) throw new UserFacingError(`Lyrics search is temporarily unavailable (LRCLIB HTTP ${response.status}). No result was returned.`)
  let data
  try { data = await response.json() } catch { throw new UserFacingError('LRCLIB returned an unreadable response. No result was returned.') }
  if (!Array.isArray(data)) throw new UserFacingError('LRCLIB returned an unexpected response. No result was returned.')
  // Deliberately read only song metadata. Never retain or expose plainLyrics/syncedLyrics.
  const out = []
  for (const item of data) {
    const title = cleanMetadata(item?.trackName, 160); const artist = cleanMetadata(item?.artistName, 160)
    if (title && artist) out.push({ title, artist })
  }
  return out
}

// How well a result matches what was asked for: exact title + exact artist is 20, exact title is 10, partial overlaps score less.
function scoreResult(item, want) {
  const title = normalize(item.title); const artist = normalize(item.artist)
  const wantTitle = normalize(want.title); const wantArtist = normalize(want.artist)
  if (!wantTitle) return 0
  let score = 0
  if (title === wantTitle) score += 10; else if (title.includes(wantTitle) || wantTitle.includes(title)) score += 3
  if (wantArtist) { if (artist === wantArtist) score += 10; else if (artist.includes(wantArtist) || wantArtist.includes(artist)) score += 5 }
  return score
}

function choose(pool, wants) {
  const scored = pool.map(item => ({ item, score: Math.max(...wants.map(want => scoreResult(item, want))) })).filter(entry => entry.score > 0)
  if (!scored.length) return { exact: false, list: [] }
  const best = Math.max(...scored.map(entry => entry.score))
  if (best >= 20) return { exact: true, list: scored.filter(entry => entry.score === best).map(entry => entry.item) }
  // No exact title-and-artist match. Prefer exact titles (the user can then pick the artist); otherwise the closest few.
  const exactTitles = scored.filter(entry => entry.score >= 10)
  const pick = exactTitles.length ? exactTitles : scored
  return { exact: false, list: pick.sort((a, b) => b.score - a.score).map(entry => entry.item) }
}

export async function searchLyrics(query, { contact, fetchImpl = globalThis.fetch } = {}) {
  const term = String(query || '').trim().replace(/\s+/g, ' ')
  if (!term || term.length > MAX_QUERY) throw new UserFacingError('Usage: .lyrics song title and artist (up to 120 characters).')
  const clientContact = String(contact || '').trim()
  if (!clientContact || /[\r\n]/.test(clientContact)) {
    throw new UserFacingError('Lyrics search is not configured yet. Set LRCLIB_CLIENT_CONTACT to the public project URL or a contact email.')
  }
  if (typeof fetchImpl !== 'function') throw new UserFacingError('Lyrics search is unavailable in this runtime.')

  const { wants, plain, structured } = parseLyricsQuery(term)
  // Most precise request first; stop as soon as an exact title-and-artist match is found.
  const attempts = []
  if (structured) attempts.push({ track_name: structured.title, artist_name: structured.artist })
  attempts.push({ q: plain })
  if (term !== plain) attempts.push({ q: term })

  const pool = new Map(); let succeeded = false; let decision = { exact: false, list: [] }
  for (const params of attempts.slice(0, MAX_CALLS)) {
    let found
    try { found = await fetchMatches(params, { clientContact, fetchImpl }) } catch (error) { if (succeeded) break; throw error }
    succeeded = true
    for (const item of found) { const key = `${normalize(item.title)}\u0000${normalize(item.artist)}`; if (!pool.has(key)) pool.set(key, item) }
    decision = choose([...pool.values()], wants)
    if (decision.exact) break
  }
  return decision.list.slice(0, MAX_RESULTS).map(item => ({ ...item, url: asGeniusSearch(item.title, item.artist) }))
}

export function formatLyricsResults(matches) {
  if (!matches.length) return 'I couldn’t find a matching song. Try the title plus artist, for example: .lyrics Blinding Lights The Weeknd'
  if (matches.length === 1) {
    const { title, artist, url } = matches[0]
    return `Song match: ${title} — ${artist}\nI can’t send full copyrighted lyrics, but you can view the licensed lyrics/search result here: ${url}`
  }
  return `I found a few possible songs. Which one did you mean?\n${matches.map((item, index) => `${index + 1}. ${item.title} — ${item.artist}\n${item.url}`).join('\n')}\nReply with the exact title and artist. I can’t send full copyrighted lyrics.`
}
