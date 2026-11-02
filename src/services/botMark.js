// Shadow runs on the owner's own WhatsApp account, so his messages look exactly like the owner's.
// This marks every message Shadow sends with a reaction from the same account (default ♠️), which makes
// them recognisable at a glance. The owner's own typed messages do not go through this sender, so they
// never get the mark. The reaction is sent in the background and can never delay or break a reply.

export const DEFAULT_REACTION = '♠️'

// BOT_MESSAGE_REACTION: unset -> spade, empty -> disabled, anything else -> that emoji.
export function reactionFromEnv(value) {
  return value === undefined ? DEFAULT_REACTION : String(value).trim()
}

const NOT_MARKED = ['react', 'delete', 'edit', 'forward', 'pin', 'disappearingMessagesInChat']
const isMarkable = (jid, content, sent) => typeof jid === 'string'
  && !jid.endsWith('@broadcast') && !jid.endsWith('@newsletter')
  && content && typeof content === 'object' && !NOT_MARKED.some(key => key in content)
  && sent?.key?.id && sent.key.fromMe !== false

export function markBotMessages(sock, { emoji = DEFAULT_REACTION, logger = console } = {}) {
  const symbol = String(emoji || '').trim()
  if (!symbol || typeof sock?.sendMessage !== 'function' || sock.botMarkInstalled) return sock
  const send = sock.sendMessage.bind(sock)
  sock.sendMessage = async (jid, content, ...rest) => {
    const sent = await send(jid, content, ...rest)
    if (isMarkable(jid, content, sent)) {
      Promise.resolve().then(() => send(jid, { react: { text: symbol, key: sent.key } })).catch(error => logger.debug?.({ err: String(error?.message || error) }, 'Could not mark Shadow message'))
    }
    return sent
  }
  sock.botMarkInstalled = true
  return sock
}
