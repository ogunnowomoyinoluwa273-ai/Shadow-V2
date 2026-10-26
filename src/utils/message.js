import { getContentType } from '@whiskeysockets/baileys'

export function unwrapMessage(message) {
  let current = message?.message
  const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage']
  while (current) {
    const wrapper = wrappers.find(name => current?.[name]?.message)
    if (!wrapper) break
    current = current[wrapper].message
  }
  return current || {}
}
export function extractText(message) {
  const content = unwrapMessage(message)
  const type = getContentType(content)
  if (type === 'conversation') return content.conversation || ''
  if (type === 'extendedTextMessage') return content.extendedTextMessage?.text || ''
  if (type === 'imageMessage' || type === 'videoMessage' || type === 'documentMessage') return content[type]?.caption || ''
  return ''
}
export function getContext(message) {
  const content = unwrapMessage(message)
  for (const value of Object.values(content)) {
    if (value?.contextInfo) return value.contextInfo
  }
  return {}
}
export function getSender(message) { return message?.key?.participant || message?.key?.remoteJid || '' }
export function getMentions(message) { return getContext(message).mentionedJid || [] }
export function getQuoted(message) {
  const context = getContext(message)
  const quotedMessage = context.quotedMessage
  if (!quotedMessage) return null
  return {
    key: {
      remoteJid: context.remoteJid || message?.key?.remoteJid || '',
      fromMe: Boolean(context.fromMe),
      id: context.stanzaId || '',
      participant: context.participant || ''
    },
    message: quotedMessage
  }
}
export function getQuotedMessageInfo(message) {
  const quoted = getQuoted(message)
  if (!quoted) return null
  const content = unwrapMessage(quoted)
  const type = getContentType(content) || 'unknown'
  const payload = content[type] || {}
  const quotedText = extractText(quoted).trim()
  return {
    message: quoted,
    sender: quoted.key.participant || '',
    stanzaId: quoted.key.id || '',
    fromMe: quoted.key.fromMe,
    type,
    text: quotedText,
    mimetype: typeof payload.mimetype === 'string' ? payload.mimetype : '',
    fileName: typeof payload.fileName === 'string' ? payload.fileName : '',
    hasMedia: ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(type),
    hasCaption: Boolean(quotedText && ['imageMessage', 'videoMessage', 'documentMessage'].includes(type))
  }
}
export function parseCommand(text, prefix) {
  if (!text.startsWith(prefix)) return null
  const body = text.slice(prefix.length).trim()
  if (!body) return null
  const [command, ...args] = body.split(/\s+/)
  return { command: command.toLowerCase(), args, rawArgs: body.slice(command.length).trim() }
}
export function formatDuration(seconds) {
  const s = Math.floor(seconds); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(' ')
}
