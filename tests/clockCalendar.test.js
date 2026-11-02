import test from 'node:test'
import assert from 'node:assert/strict'
import { createClockCalendarService, formatClock, parseCalendarDate, resolveTimeZone } from '../src/services/clockCalendar.js'

function memoryStore(initial = []) {
  let value = initial
  return { get: () => value, async update(fn) { value = await fn(value); return value }, async flush() {} }
}

test('formats the clock in the configured timezone', () => {
  const value = formatClock(new Date('2026-10-31T23:30:00.000Z'), 'UTC')
  assert.match(value, /Saturday, 31 October 2026/)
  assert.match(value, /23:30:00 \(UTC\)$/)
})

test('resolves country and city names for requested clock locations', () => {
  assert.equal(resolveTimeZone('Japan'), 'Asia/Tokyo')
  assert.match(formatClock(new Date('2026-10-31T23:30:00.000Z'), 'Japan'), /Sunday, 1 November 2026 at 08:30:00 \(Asia\/Tokyo\)$/)
})

test('parses future calendar times in a named timezone', () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z')
  const parsed = parseCalendarDate('tomorrow 5pm', { now: () => now, timeZone: 'UTC' })
  assert.equal(new Date(parsed.timestamp).toISOString(), '2026-11-01T17:00:00.000Z')
})

test('calendar events are private to their owner and can be cancelled by short id', async () => {
  const calendar = createClockCalendarService({ store: memoryStore(), timeZone: 'UTC', now: () => Date.parse('2026-10-31T12:00:00.000Z') })
  const event = await calendar.add({ ownerKey: 'alice@s.whatsapp.net', title: 'Call', when: 'tomorrow 5pm' })
  assert.equal(calendar.list({ ownerKey: 'bob@s.whatsapp.net' }).length, 0)
  assert.match(calendar.list({ ownerKey: 'alice@s.whatsapp.net' })[0], new RegExp(event.id.slice(0, 8)))
  const removed = await calendar.remove({ ownerKey: 'alice@s.whatsapp.net', id: event.id.slice(0, 8) })
  assert.equal(removed.title, 'Call')
  assert.deepEqual(calendar.list({ ownerKey: 'alice@s.whatsapp.net' }), [])
})
