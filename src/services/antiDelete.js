import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys'
import { extractText, unwrapMessage } from '../utils/message.js'

const mediaTypes = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'])

export function createMessageCache({ maxEntries = 2000, ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const entries = new Map()
  const prune = () => {
    const cutoff = Date.now() - ttlMs
    for (const [id, entry] of entries) if (entry.cachedAt < cutoff) entries.delete(id)
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
  }
  return {
    remember(message) {
      const id = message?.key?.id
      if (!id || !message?.message) return
      entries.set(id, { message, cachedAt: Date.now() }); prune()
    },
    take(key) {
      const id = key?.id
      if (!id) return null
      const entry = entries.get(id); entries.delete(id)
      if (!entry || Date.now() - entry.cachedAt > ttlMs) return null
      return entry.message
    },
    size() { return entries.size }
  }
}

function senderLabel(message) {
  return message?.key?.participant || message?.key?.remoteJid || 'unknown sender'
}

export async function recoverDeletedMessage({ sock, original, destination, logDestination }) {
  const text = extractText(original).trim()
  const sender = senderLabel(original)
  const notice = `Deleted message detected from @${sender.split('@')[0]}.`
  const options = { mentions: sender.includes('@') ? [sender] : [] }
  await sock.sendMessage(destination, { text: notice, ...options })

  const content = unwrapMessage(original)
  const type = getContentType(content)
  let restored = text ? { text: `Recovered deleted message from ${original.pushName || `@${sender.split('@')[0]}`} : ${text}`, ...options } : null
  if (!restored && mediaTypes.has(type)) {
    try {
      const buffer = await downloadMediaMessage(original, 'buffer', {}, { logger: sock.logger, reuploadRequest: sock.updateMediaMessage })
      const item = content[type]
      restored = type === 'imageMessage' ? { image: buffer, caption: `Recovered image from @${sender.split('@')[0]}`, mentions: options.mentions } :
        type === 'videoMessage' ? { video: buffer, caption: `Recovered video from @${sender.split('@')[0]}`, mentions: options.mentions } :
        type === 'audioMessage' ? { audio: buffer, mimetype: item?.mimetype, fileName: item?.fileName || 'recovered-audio' } :
        type === 'stickerMessage' ? { sticker: buffer } :
        { document: buffer, mimetype: item?.mimetype, fileName: item?.fileName || 'recovered-document', caption: `Recovered document from @${sender.split('@')[0]}` }
    } catch {}
  }
  if (restored) await sock.sendMessage(destination, restored)
  if (logDestination && logDestination !== destination) {
    await sock.sendMessage(logDestination, { text: `Anti-delete log\nGroup: ${destination}\n${notice}` , ...options })
    if (restored) await sock.sendMessage(logDestination, restored)
  }
  return { restored: Boolean(restored), sender, type: type || 'text' }
}
