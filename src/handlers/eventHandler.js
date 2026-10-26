import { createMessageHandler } from './messageHandler.js'
import { renderTemplate } from '../services/welcome.js'
import { participantId, isGroupJid, sameJid } from '../utils/jid.js'
import { getSender } from '../utils/message.js'
import { isAdmin } from '../utils/permissions.js'
import { logger } from '../utils/logger.js'
import { errorLogDetails } from '../utils/errors.js'
import { createMessageCache, recoverDeletedMessage } from '../services/antiDelete.js'

export function attachHandlers({ sock, commands, settings, config, seen, aiBrain = null, reactions = null, metrics = {} }) {
  const messageCache = createMessageCache()
  const onAutoDelete = async message => { try {
    const jid = message.key.remoteJid; if (!isGroupJid(jid)) return
    const metadata = await sock.groupMetadata(jid); const sender = getSender(message)
    if (isAdmin(metadata, sender) || sameJid(sender, sock.user?.id)) return
    await sock.sendMessage(jid, { delete: message.key }); await sock.sendMessage(jid, { text: 'A prohibited link was removed.' })
  } catch (error) { logger.warn({ err: errorLogDetails(error) }, 'Could not remove prohibited link') } }
  const handleMessages = createMessageHandler({ sock, commands, settings, config, seen, onAutoDelete, aiBrain, reactions, metrics })
  sock.ev.on('messages.upsert', async event => {
    for (const message of event.messages || []) messageCache.remember(message)
    await handleMessages(event)
  })
  const handleDeletedKeys = async keys => {
    for (const key of keys) {
      try {
        const jid = key?.remoteJid
        if (!isGroupJid(jid) || !settings.get(jid).antiDelete) continue
        const original = messageCache.take({ ...key, remoteJid: jid })
        if (!original) { await sock.sendMessage(jid, { text: 'A message was deleted, but Shadow no longer has a recoverable copy.' }); continue }
        const result = await recoverDeletedMessage({ sock, original, destination: jid, logDestination: config.antiDeleteLogJid })
        if (typeof metrics.moderationActions === 'number') metrics.moderationActions += 1
        logger.info({ groupId: jid, sender: result.sender, type: result.type, restored: result.restored }, 'Anti-delete recovery completed')
      } catch (error) { logger.warn({ err: errorLogDetails(error) }, 'Anti-delete recovery failed') }
    }
  }
  sock.ev.on('messages.delete', async event => handleDeletedKeys(event?.keys || (event?.key ? [event.key] : [])))
  sock.ev.on('messages.update', async updates => {
    for (const item of updates || []) {
      const update = item?.update || {}
      if (update.message !== null || update.messageStubType == null) continue
      // Baileys v7 places the revoked message key on the outer update item;
      // update.key is the protocol/revoke envelope key.
      await handleDeletedKeys([item.key || update.key].filter(Boolean))
    }
  })
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    try {
      const eventKey = `${id}:${action}:${(participants || []).map(participantId).sort().join(',')}`
      if (seen.has(`participant:${eventKey}`)) return
      seen.add(`participant:${eventKey}`)
      const group = await sock.groupMetadata(id); const current = settings.get(id); if (!current.welcome && !current.goodbye) return
      if (!['add', 'remove'].includes(action)) return
      const entering = action === 'add'; const template = entering ? config.welcomeDefault : config.goodbyeDefault; if (!(entering ? current.welcome : current.goodbye)) return
      for (const participant of participants || []) { const user = participantId({ id: participant }); await sock.sendMessage(id, { text: renderTemplate(template, { user, group: group.subject, count: group.participants?.length }) , mentions: [user] }) }
    } catch (error) { logger.warn({ err: errorLogDetails(error), groupId: id }, 'Participant update handling failed') }
  })
}
