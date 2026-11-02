import { bareNumber, isGroupJid, normalizeJid, participantId, participantIds, sameJid } from './jid.js'
import { getMentions } from './message.js'
import { UserFacingError } from './errors.js'

export function ownerJids(config) { return [config.ownerNumber ? `${bareNumber(config.ownerNumber)}@s.whatsapp.net` : '', config.ownerLid].filter(Boolean) }
export function isOwner(sender, config) { return ownerJids(config).some(jid => sameJid(sender, jid)) }
export function messageSender(message, sock) {
  if (message?.key?.fromMe) return sock?.user?.id || sock?.user?.phoneNumber || message.key.participant || message.key.remoteJid || ''
  return message?.key?.participant || message?.key?.remoteJid || ''
}
export function authenticatedAccountIsOwner(sock, config) {
  const identities = [sock?.user?.id, sock?.user?.phoneNumber].filter(Boolean)
  return identities.some(identity => isOwner(identity, config))
}
// Every identity WhatsApp gives for who sent a message. Group chats and DMs can present the same person as a phone-number JID or as a LID,
// and the saved owner/sudo entry may be in the other form, so access checks must consider all of them (never the group's own JID).
export function messageIdentities(message, sock) {
  const key = message?.key || {}
  const ids = key.fromMe ? [messageSender(message, sock)] : [key.participant, key.participantAlt, key.participantPn, key.remoteJid, key.remoteJidAlt]
  return [...new Set(ids.filter(id => typeof id === 'string' && id && id !== 'status@broadcast' && !isGroupJid(id)))]
}
export function senderIsSudo(sudo, message, sock) { return messageIdentities(message, sock).some(identity => Boolean(sudo?.has?.(identity))) }
export function isOwnerMessage(message, sock, config) {
  // Baileys v7 may expose the linked account as a LID while OWNER_NUMBER is a PN.
  // `fromMe` is emitted by the authenticated socket and is therefore the reliable
  // owner signal for commands sent from the linked WhatsApp account.
  return isOwner(messageSender(message, sock), config) || Boolean(message?.key?.fromMe) || (message?.key?.fromMe && authenticatedAccountIsOwner(sock, config)) || messageIdentities(message, sock).some(identity => isOwner(identity, config))
}
export function isAdmin(metadata, jid) { const p = metadata?.participants?.find(x => participantIds(x).some(candidate => sameJid(candidate, jid))); return Boolean(p?.admin === 'admin' || p?.admin === 'superadmin') }
export function botIdentityJids(sock) { return [sock?.user?.id, sock?.user?.lid, sock?.user?.phoneNumber].filter(Boolean) }
export async function requireGroup(sock, message) { const jid = message?.key?.remoteJid; if (!isGroupJid(jid)) throw new UserFacingError('This command can only be used in a group.') ; return sock.groupMetadata(jid) }
export async function requireAdmin(sock, message, config, { ownerAllowed = true } = {}) { const metadata = await requireGroup(sock, message); const sender = messageSender(message, sock); if (ownerAllowed && isOwnerMessage(message, sock, config)) return metadata; if (!isAdmin(metadata, sender)) throw new UserFacingError('Group administrators or the configured owner only.'); return metadata }
export function botIsAdmin(metadata, sock) { return botIdentityJids(sock).some(identity => isAdmin(metadata, identity)) }
export function resolveTarget(message, args = []) { const mentions = getMentions(message); return mentions[0] || args.find(x => /^\d{5,}@/.test(x)) || null }
