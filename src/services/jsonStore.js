import fs from 'node:fs/promises'
import path from 'node:path'

export async function createJsonStore(file, initial = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  let data = initial
  let writeQueue = Promise.resolve()
  async function load() { try { data = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; await save() } return data }
  await load()
  async function save(snapshot = data) { const serialized = JSON.stringify(snapshot, null, 2); const temp = `${file}.${process.pid}.tmp`; writeQueue = writeQueue.then(async () => { await fs.writeFile(temp, serialized, { mode: 0o600 }); await fs.rename(temp, file) }); await writeQueue }
  return { get: () => data, async update(fn) { const next = await fn(data); if (next !== undefined) data = next; await save(data); return data }, save, flush: async () => { await writeQueue }, reload: load }
}
