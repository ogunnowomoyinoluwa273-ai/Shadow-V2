import { UserFacingError } from '../utils/errors.js'

const API = 'https://lrclib.net/api/search'
const MAX_QUERY = 120
const MAX_RESULTS = 5
const REQUEST_TIMEOUT_MS = 8_000

function cleanMetadata(value, maxLength) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) : ''
}

function asGeniusSearch(title, artist) {
  const query = [title, artist].filter(Boolean).join(' ')
  return `https://genius.com/search?q=${encodeURIComponent(query)}`
}

export async function searchLyrics(query, { contact, fetchImpl = globalThis.fetch } = {}) {
  const term = String(query || '').trim().replace(/\s+/g, ' ')
  if (!term || term.length > MAX_QUERY) throw new UserFacingError('Usage: .lyrics song title and artist (up to 120 characters).')
  const clientContact = String(contact || '').trim()
  if (!clientContact || /[\r\n]/.test(clientContact)) {
    throw new UserFacingError('Lyrics search is not configured yet. Set LRCLIB_CLIENT_CONTACT to the public project URL or a contact email.')
  }
  if (typeof fetchImpl !== 'function') throw new UserFacingError('Lyrics search is unavailable in this runtime.')

  const url = new URL(API)
  url.searchParams.set('q', term)
  let response
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': `SHADOW WhatsApp Bot/1.0 (${clientContact})`
      },
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
  const unique = new Map()
  for (const item of data) {
    const title = cleanMetadata(item?.trackName, 160)
    const artist = cleanMetadata(item?.artistName, 160)
    if (!title || !artist) continue
    const key = `${title.toLocaleLowerCase()}\u0000${artist.toLocaleLowerCase()}`
    if (!unique.has(key)) unique.set(key, { title, artist, url: asGeniusSearch(title, artist) })
    if (unique.size >= MAX_RESULTS) break
  }
  return [...unique.values()]
}

export function formatLyricsResults(matches) {
  if (!matches.length) return 'I couldn’t find a matching song. Try the title plus artist, for example: .lyrics Blinding Lights The Weeknd'
  if (matches.length === 1) {
    const { title, artist, url } = matches[0]
    return `Song match: ${title} — ${artist}\nI can’t send full copyrighted lyrics, but you can view the licensed lyrics/search result here: ${url}`
  }
  return `I found a few possible songs. Which one did you mean?\n${matches.map((item, index) => `${index + 1}. ${item.title} — ${item.artist}\n${item.url}`).join('\n')}\nReply with the exact title and artist. I can’t send full copyrighted lyrics.`
}
