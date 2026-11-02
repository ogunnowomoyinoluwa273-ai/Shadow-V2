import fs from 'node:fs/promises'
import { normalizeHistoryKey } from './conversationHistory.js'
import { normalizeMemoryKey } from './memory.js'

// Older versions filed memory and conversations under keys that included the linked-device number
// ("...:28@s.whatsapp.net") or the chat as well as the person. Re-linking WhatsApp changes that
// number, which silently orphaned everything. These helpers merge such records onto stable keys.
// They never delete content: records are merged, de-duplicated and re-filed, and running them
// again is a no-op.

const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

// Copies a data file next to itself once, before the first migration touches it. Never overwrites.
export async function backupOnce(file, suffix = '.pre-memory-fix.bak') {
  const target = `${file}${suffix}`
  try { await fs.access(target); return false } catch { /* no backup yet */ }
  try { await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL); return true } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EEXIST') return false
    throw error
  }
}

export async function migrateHistoryKeys(store, { maxTurns = 20 } = {}) {
  const current = store.get()
  if (!isObject(current)) return { changed: false, merged: 0 }
  const legacy = Object.keys(current).filter(key => !key.startsWith('chat:') && normalizeHistoryKey(key) !== key)
  if (!legacy.length) return { changed: false, merged: 0 }
  await store.update(all => {
    const next = { ...all }
    const groups = new Map()
    for (const key of Object.keys(next)) {
      if (key.startsWith('chat:')) continue
      const target = normalizeHistoryKey(key)
      if (!groups.has(target)) groups.set(target, [])
      groups.get(target).push(key)
    }
    for (const [target, keys] of groups) {
      if (keys.length === 1 && keys[0] === target) continue
      const records = keys.map(key => next[key]).filter(record => isObject(record) && Array.isArray(record.turns)).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
      if (!records.length) continue
      next[target] = { turns: records.flatMap(record => record.turns).slice(-maxTurns), updatedAt: Math.max(...records.map(record => Number(record.updatedAt) || 0)) }
      for (const key of keys) if (key !== target) delete next[key]
    }
    return next
  })
  return { changed: true, merged: legacy.length }
}

export async function migrateMemoryKeys(store, { maxPerUser = 100 } = {}) {
  const current = store.get()
  if (!isObject(current)) return { changed: false, moved: 0 }
  const legacy = Object.keys(current).filter(key => normalizeMemoryKey(key) !== key)
  if (!legacy.length) return { changed: false, moved: 0 }
  await store.update(all => {
    const next = { ...all }
    const touched = new Set()
    for (const key of legacy) {
      const target = normalizeMemoryKey(key)
      const items = Array.isArray(next[key]) ? next[key].filter(item => item && typeof item.text === 'string') : []
      next[target] = [...(Array.isArray(next[target]) ? next[target] : []), ...items]
      touched.add(target)
      if (target !== key) delete next[key]
    }
    for (const target of touched) {
      const seen = new Set()
      next[target] = next[target]
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
        .filter(item => { const id = item.id || item.text; if (seen.has(id)) return false; seen.add(id); return true })
        .slice(-maxPerUser)
    }
    return next
  })
  return { changed: true, moved: legacy.length }
}
