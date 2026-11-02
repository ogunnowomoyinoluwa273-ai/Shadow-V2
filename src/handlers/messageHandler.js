import { performance } from 'node:perf_hooks'
import { extractText, getMentions, getQuotedMessageInfo, parseCommand } from '../utils/message.js'
import { isGroupJid, sameJid } from '../utils/jid.js'
import { authenticatedAccountIsOwner, botIdentityJids, botIsAdmin, isOwner, isOwnerMessage, messageIdentities, messageSender, senderIsSudo } from '../utils/permissions.js'
import { logger } from '../utils/logger.js'
import { errorLogDetails, GENERIC_FAILURE_MESSAGE, UserFacingError } from '../utils/errors.js'
import { detectProhibitedLink } from '../services/antiLink.js'
import { createNlRouter } from '../services/nlCommands.js'

export function classifyQuotedSender(quoted, sock, config) {
  if (!quoted) return 'unknown'
  if (quoted.fromMe || quoted.sender && botIdentityJids(sock).some(identity => sameJid(identity, quoted.sender))) return 'shadow'
  if (quoted.sender && isOwner(quoted.sender, config)) return 'owner'
  return quoted.sender ? 'participant' : 'unknown'
}

// Age of a message in ms from its WhatsApp timestamp (seconds, number or Long-like), or null when it has none.
function messageAgeMs(message, now = Date.now()) {
  const raw = message?.messageTimestamp
  const seconds = raw && typeof raw === 'object' ? (typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw.low)) : Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? now - seconds * 1000 : null
}

export function createMessageHandler({ sock, commands, settings, config, seen, onAutoDelete, aiBrain = null, reactions = null, nlRouter = null, metrics = {}, log = logger }) {
  // Natural-language commands ("Shadow, tag everyone"): decides which existing command to run; the dispatcher below still runs it.
  const naturalRouter = nlRouter || (config?.naturalCommands === false ? null : createNlRouter({ commands }))
  const lastMessageAt = new Map()
  let staleIgnored = 0; let staleLoggedAt = 0; let oldestStaleMs = 0
  const count = key => { if (typeof metrics[key] === 'number') metrics[key] += 1 }
  const recordConversation = async ({ jid, message, sender, speaker, owner, text }) => {
    const record = aiBrain?.recordConversationMessage || aiBrain?.recordGroupMessage
    if (!record) return []
    const quoted = getQuotedMessageInfo(message)
    if (quoted) quoted.role = classifyQuotedSender(quoted, sock, config)
    return await record({ jid, message, sender, speaker, role: owner ? 'owner' : 'participant', text, quoted, mentions: getMentions(message) })
  }
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
        // Anything sent while Shadow was offline arrives as a burst after reconnecting. That is history, not a request:
        // never run commands, AI or moderation on it, and only keep it as context if it is recent enough to matter.
        const maxAgeMs = (Number(config.maxMessageAgeSeconds) || 0) * 1000
        const ageMs = maxAgeMs ? messageAgeMs(message) : null
        if (ageMs !== null && ageMs > maxAgeMs) {
          staleIgnored += 1; oldestStaleMs = Math.max(oldestStaleMs, ageMs)
          if (Date.now() - staleLoggedAt > 20_000) { staleLoggedAt = Date.now(); (log.info || log.debug)?.call(log, { skipped: staleIgnored, oldestMinutes: Math.round(oldestStaleMs / 60_000) }, 'Skipping messages that were sent while Shadow was offline') }
          if (ageMs <= (Number(config.chatContextTtlMs) || 0)) await recordConversation({ jid, message, sender, speaker: message.pushName || message.verifiedBizName || (owner ? 'You' : sender), owner, text })
          continue
        }
        if (group && !message.key?.fromMe && !owner) {
          const policy = settings.get(jid); const muted = (policy.mutedParticipants || []).some(target => sameJid(target, sender))
          if (muted) { await removeMessage(message, 'This participant is currently muted.'); continue }
          const seconds = Number(policy.slowmodeSeconds) || 0; const key = `${jid}:${sender}`; const previous = lastMessageAt.get(key) || 0; const now = Date.now()
          if (seconds > 0 && previous && now - previous < seconds * 1000) { await removeMessage(message, `Slowmode is active. Please wait ${Math.ceil((seconds * 1000 - (now - previous)) / 1000)}s.`); continue }
          lastMessageAt.set(key, now)
        }
        const recentMessages = await recordConversation({ jid, message, sender, speaker: message.pushName || message.verifiedBizName || (owner ? 'You' : sender), owner, text })
        let nlText = null; let commandMessage = message
        const addressedPrompt = aiBrain?.parseShadowAddress ? aiBrain.parseShadowAddress(text) : (naturalRouter ? naturalRouter.parseAddress(text) : null)
        if (naturalRouter && addressedPrompt !== null && (owner || senderIsSudo(commands.sudo, message, sock))) {
          // True when the normal pipeline below would refuse this command anyway, so Shadow does not ask for confirmation first.
          const wouldBeRefused = command => !command || (command.ownerOnly ? !owner : !(owner || senderIsSudo(commands.sudo, message, sock))) || Boolean(command.groupOnly && !group) || Boolean(group && (settings.get(jid).disabledCommands || []).includes(command.name) && !owner && !['enablecmd', 'disablecmd'].includes(command.name))
          const outcome = naturalRouter.handle({ prompt: addressedPrompt, message, sender, jid, prefix: config.prefix, precheck: wouldBeRefused })
          if (outcome?.type === 'reply') { const sent = await sock.sendMessage(jid, { text: outcome.text }, { quoted: message }); await aiBrain?.recordShadowReply?.(jid, message, outcome.text, sent); continue }
          if (outcome?.type === 'command') { nlText = outcome.text; commandMessage = outcome.message || message; log.debug?.({ routed: outcome.text }, 'Natural-language request routed to an existing command') }
        }
        if (nlText === null && aiBrain && aiBrain.parseShadowAddress?.(text) !== null) {
          const aiOwner = Boolean(message.key?.fromMe && authenticatedAccountIsOwner(sock, config)) || messageIdentities(message, sock).some(identity => isOwner(identity, config))
          const quoted = getQuotedMessageInfo(message)
          if (quoted) quoted.role = classifyQuotedSender(quoted, sock, config)
          const handled = await aiBrain.run({ text, message, sock, sender, senderIds: messageIdentities(message, sock), speaker: message.pushName || message.verifiedBizName || sender, owner: aiOwner, reactions, quoted, recentMessages })
          log.debug?.({ elapsedMs: Math.round(performance.now() - receivedAt) }, 'Message-to-reply processing completed')
          if (handled) { if (!aiOwner && !senderIsSudo(commands.sudo, message, sock)) count('deniedCommands'); continue }
        }
        const parsed = parseCommand((nlText ?? text).trim(), config.prefix); if (!parsed) continue
        if (group && detectProhibitedLink(text, settings.get(jid)) && !message.key?.fromMe) await onAutoDelete(message)
        const command = commands.lookup(parsed.command); if (!command) continue
        const authorized = owner || senderIsSudo(commands.sudo, message, sock);
        if (command.ownerOnly ? !owner : !authorized) { count('deniedCommands'); continue }
        const disabled = group ? (settings.get(jid).disabledCommands || []) : []
        if (disabled.includes(command.name) && !owner && !['enablecmd', 'disablecmd'].includes(command.name)) { count('deniedCommands'); await sock.sendMessage(jid, { text: `This command is disabled in this group: ${config.prefix}${command.name}` }, { quoted: message }); continue }
        if (command.groupOnly && !group) { await sock.sendMessage(jid, { text: 'This command can only be used in a group.' }); continue }
        const reply = async replyText => { const sent = await sock.sendMessage(jid, { text: replyText }, { quoted: message }); await aiBrain?.recordShadowReply?.(jid, message, replyText, sent); return sent }
        await command.run({ sock, message: commandMessage, args: parsed.args, rawArgs: parsed.rawArgs, reply, metrics, receivedAt })
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
