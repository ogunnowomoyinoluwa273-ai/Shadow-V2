import { performance } from 'node:perf_hooks'
import { extractText, getQuotedMessageInfo, parseCommand } from '../utils/message.js'
import { isGroupJid, sameJid } from '../utils/jid.js'
import { authenticatedAccountIsOwner, botIdentityJids, botIsAdmin, isOwner, isOwnerMessage, messageSender } from '../utils/permissions.js'
import { logger } from '../utils/logger.js'
import { errorLogDetails, GENERIC_FAILURE_MESSAGE, UserFacingError } from '../utils/errors.js'
import { detectProhibitedLink } from '../services/antiLink.js'

export function classifyQuotedSender(quoted, sock, config) {
  if (!quoted) return 'unknown'
  if (quoted.fromMe || quoted.sender && botIdentityJids(sock).some(identity => sameJid(identity, quoted.sender))) return 'shadow'
  if (quoted.sender && isOwner(quoted.sender, config)) return 'owner'
  return quoted.sender ? 'participant' : 'unknown'
}

export function createMessageHandler({ sock, commands, settings, config, seen, onAutoDelete, aiBrain = null, reactions = null, metrics = {}, log = logger }) {
  const lastMessageAt = new Map()
  const count = key => { if (typeof metrics[key] === 'number') metrics[key] += 1 }
  const canModerate = async jid => { try { return botIsAdmin(await sock.groupMetadata(jid), sock) } catch { return false } }
  const removeMessage = async (message, notice) => { const jid = message.key.remoteJid; if (!await canModerate(jid)) return false; await sock.sendMessage(jid, { delete: message.key }); if (notice) await sock.sendMessage(jid, { text: notice }); count('moderationActions'); return true }

  return async function handle({ messages, type }) {
    if (!['notify', 'append'].includes(type)) return
    for (const message of messages || []) {
      try {
        const receivedAt = performance.now()
        const id = message.key?.id
        if (!id || seen.has(id) || message.key?.remoteJid === 'status@broadcast') continue
        seen.add(id); if (seen.size > 5000) seen.delete(seen.values().next().value); count('messagesSeen')
        log.debug?.({ messageId: id }, 'Message received')
        const jid = message.key?.remoteJid; const text = extractText(message); if (!jid || !text) continue
        const group = isGroupJid(jid); const sender = messageSender(message, sock); const owner = isOwnerMessage(message, sock, config)
        log.debug?.({ messageId: id, group, owner, authorizationElapsedMs: Math.round(performance.now() - receivedAt) }, 'Message authorization completed')
        if (group && !message.key?.fromMe && !owner) {
          const policy = settings.get(jid); const muted = (policy.mutedParticipants || []).some(target => sameJid(target, sender))
          if (muted) { await removeMessage(message, 'This participant is currently muted.'); continue }
          const seconds = Number(policy.slowmodeSeconds) || 0; const key = `${jid}:${sender}`; const previous = lastMessageAt.get(key) || 0; const now = Date.now()
          if (seconds > 0 && previous && now - previous < seconds * 1000) { await removeMessage(message, `Slowmode is active. Please wait ${Math.ceil((seconds * 1000 - (now - previous)) / 1000)}s.`); continue }
          lastMessageAt.set(key, now)
        }
        let recentMessages = []
        if (group && !message.key?.fromMe && aiBrain?.recordGroupMessage) {
          recentMessages = await aiBrain.recordGroupMessage({ jid, message, sender, speaker: message.pushName || message.verifiedBizName || sender, text })
        }
        if (aiBrain && aiBrain.parseShadowAddress?.(text) !== null) {
          const aiOwner = Boolean(message.key?.fromMe && authenticatedAccountIsOwner(sock, config)) || isOwner(sender, config)
          const quoted = getQuotedMessageInfo(message)
          if (quoted) quoted.role = classifyQuotedSender(quoted, sock, config)
          const handled = await aiBrain.run({ text, message, sock, sender, speaker: message.pushName || message.verifiedBizName || sender, owner: aiOwner, reactions, quoted, recentMessages })
          log.debug?.({ elapsedMs: Math.round(performance.now() - receivedAt) }, 'Message-to-reply processing completed')
          if (handled) { if (!aiOwner && !commands.sudo?.has?.(sender)) count('deniedCommands'); continue }
        }
        const parsed = parseCommand(text.trim(), config.prefix); if (!parsed) continue
        if (group && detectProhibitedLink(text, settings.get(jid)) && !message.key?.fromMe) await onAutoDelete(message)
        const command = commands.lookup(parsed.command); if (!command) continue
        const authorized = owner || Boolean(commands.sudo?.has?.(sender));
        if (command.ownerOnly ? !owner : !authorized) { count('deniedCommands'); continue }
        const disabled = group ? (settings.get(jid).disabledCommands || []) : []
        if (disabled.includes(command.name) && !owner && !['enablecmd', 'disablecmd'].includes(command.name)) { count('deniedCommands'); await sock.sendMessage(jid, { text: `This command is disabled in this group: ${config.prefix}${command.name}` }, { quoted: message }); continue }
        if (command.groupOnly && !group) { await sock.sendMessage(jid, { text: 'This command can only be used in a group.' }); continue }
        const reply = replyText => sock.sendMessage(jid, { text: replyText }, { quoted: message })
        await command.run({ sock, message, args: parsed.args, rawArgs: parsed.rawArgs, reply, metrics, receivedAt })
        count('commandsExecuted')
        log.debug?.({ messageId: id, totalElapsedMs: Math.round(performance.now() - receivedAt) }, 'Message response delivered')
      } catch (error) {
        count('errors'); log.warn({ err: errorLogDetails(error), messageId: message.key?.id }, 'Command/message handling failed')
        const text = error instanceof UserFacingError ? error.userMessage : GENERIC_FAILURE_MESSAGE
        try { await sock.sendMessage(message.key.remoteJid, { text }, { quoted: message }) } catch {}
      }
    }
  }
}
