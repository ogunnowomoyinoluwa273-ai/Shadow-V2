import { randomUUID } from 'node:crypto'

const MAX_TITLE = 160
const MAX_EVENTS = 200
const TIME_ZONE_ALIASES = {
  japan: 'Asia/Tokyo', tokyo: 'Asia/Tokyo', nigeria: 'Africa/Lagos', lagos: 'Africa/Lagos',
  uk: 'Europe/London', 'united kingdom': 'Europe/London', london: 'Europe/London', utc: 'UTC', gmt: 'UTC',
  usa: 'America/New_York', 'united states': 'America/New_York', 'new york': 'America/New_York',
  california: 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles', india: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', china: 'Asia/Shanghai', beijing: 'Asia/Shanghai',
  singapore: 'Asia/Singapore', australia: 'Australia/Sydney', sydney: 'Australia/Sydney',
  germany: 'Europe/Berlin', berlin: 'Europe/Berlin', france: 'Europe/Paris', paris: 'Europe/Paris',
  brazil: 'America/Sao_Paulo', 'south africa': 'Africa/Johannesburg', johannesburg: 'Africa/Johannesburg'
}

function partsFor(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  return Object.fromEntries(formatter.formatToParts(date).filter(item => item.type !== 'literal').map(item => [item.type, item.value]))
}

function safeTimeZone(value, fallback = 'UTC') {
  const candidate = String(value || fallback).trim() || fallback
  try { new Intl.DateTimeFormat('en', { timeZone: candidate }).format(); return candidate } catch { return fallback }
}

export function resolveTimeZone(value, fallback = 'UTC') {
  const raw = String(value || '').trim().toLowerCase()
  return safeTimeZone(TIME_ZONE_ALIASES[raw] || value, fallback)
}

function zonedLocalToUtc(year, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const p = partsFor(new Date(wall), timeZone)
  const observed = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return wall - (observed - wall)
}

export function parseCalendarDate(input, { now = Date.now, timeZone = 'UTC' } = {}) {
  const raw = String(input || '').trim().replace(/\s+/, ' ')
  if (!raw) throw new Error('Provide a date and time, for example: 2026-11-01 17:30 or tomorrow 5pm.')
  const zone = resolveTimeZone(timeZone)
  const current = partsFor(new Date(now()), zone)
  let datePart = ''; let timePart = ''
  let match = raw.match(/^(today|tomorrow)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (match) {
    const base = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day) + (match[1].toLowerCase() === 'tomorrow' ? 1 : 0)))
    const bp = partsFor(base, zone)
    datePart = `${bp.year}-${bp.month}-${bp.day}`; timePart = `${match[2]}:${match[3] || '00'}${match[4] || ''}`
  } else {
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i)
    if (!match) throw new Error('Use YYYY-MM-DD HH:mm, YYYY-MM-DD, today 5pm, or tomorrow 09:30.')
    datePart = `${match[1]}-${match[2]}-${match[3]}`; timePart = match[4] ? `${match[4]}:${match[5] || '00'}${match[6] || ''}` : '09:00'
  }
  const [year, month, day] = datePart.split('-').map(Number)
  const tm = timePart.match(/^(\d{1,2}):([0-5]\d)\s*(am|pm)?$/i)
  if (!tm || month < 1 || month > 12 || day < 1 || day > 31) throw new Error('Invalid date or time.')
  let hour = Number(tm[1]); const minute = Number(tm[2]); const meridiem = tm[3]?.toLowerCase()
  if (meridiem) { if (hour < 1 || hour > 12) throw new Error('Invalid 12-hour time.'); if (meridiem === 'pm' && hour !== 12) hour += 12; if (meridiem === 'am' && hour === 12) hour = 0 } else if (hour > 23) throw new Error('Invalid 24-hour time.')
  const timestamp = zonedLocalToUtc(year, month, day, hour, minute, zone)
  if (!Number.isFinite(timestamp) || new Date(timestamp).getTime() <= now()) throw new Error('That time is in the past. Choose a future time.')
  return { timestamp, timeZone: zone }
}

export function formatClock(now = new Date(), timeZone = 'UTC') {
  const zone = resolveTimeZone(timeZone)
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'full', timeStyle: 'medium' }).format(now) + ` (${zone})`
}

export function createClockCalendarService({ store, timeZone = 'UTC', now = () => Date.now() } = {}) {
  if (!store) throw new Error('Calendar store is required.')
  const zone = resolveTimeZone(timeZone)
  const owner = value => String(value || '').trim().slice(0, 180)
  const listFor = key => (Array.isArray(store.get()) ? store.get() : []).filter(item => item?.ownerKey === key).sort((a, b) => a.at - b.at)
  const formatEvent = event => `${event.id.slice(0, 8)} · ${new Intl.DateTimeFormat('en-GB', { timeZone: event.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.at))} · ${event.title}`
  return {
    timeZone: zone,
    now: ({ timeZone = zone } = {}) => { const resolved = resolveTimeZone(timeZone, zone); return formatClock(new Date(now()), resolved) },
    date: ({ timeZone = zone } = {}) => { const resolved = resolveTimeZone(timeZone, zone); return `${new Intl.DateTimeFormat('en-GB', { timeZone: resolved, dateStyle: 'full' }).format(new Date(now()))} (${resolved})` },
    async add({ ownerKey, title, when, chatJid = '' }) {
      const key = owner(ownerKey); const cleanTitle = String(title || '').trim().slice(0, MAX_TITLE)
      if (!key || !cleanTitle) throw new Error('A title is required.')
      const parsed = parseCalendarDate(when, { now, timeZone: zone })
      const event = { id: randomUUID(), ownerKey: key, title: cleanTitle, at: parsed.timestamp, timeZone: parsed.timeZone, chatJid: String(chatJid || '').slice(0, 120), createdAt: now() }
      await store.update(items => [...(Array.isArray(items) ? items : []).filter(item => item?.at > now() - 86_400_000).slice(-(MAX_EVENTS - 1)), event])
      return event
    },
    list({ ownerKey, includePast = false } = {}) { const events = listFor(owner(ownerKey)); return (includePast ? events : events.filter(item => item.at > now())).map(formatEvent) },
    listDetailed({ ownerKey, includePast = false } = {}) { const events = listFor(owner(ownerKey)); return includePast ? events : events.filter(item => item.at > now()) },
    async remove({ ownerKey, id }) {
      const key = owner(ownerKey); const wanted = String(id || '').trim().toLowerCase(); let removed = null
      await store.update(items => (Array.isArray(items) ? items : []).filter(item => { const match = item?.ownerKey === key && (item.id === id || item.id.toLowerCase().startsWith(wanted)); if (match) removed = item; return !match }))
      if (!removed) throw new Error('No matching calendar event was found.')
      return removed
    },
    async flush() { await store.flush?.() }
  }
}
