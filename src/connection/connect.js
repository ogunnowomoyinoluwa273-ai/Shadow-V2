import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { logger } from '../utils/logger.js'
import { config } from '../config.js'
import { markBotMessages } from '../services/botMark.js'
import { errorLogDetails } from '../utils/errors.js'

let pairingCodeRequested = false

export function makeSafeAuthState(state, log = logger) {
  const original = state.keys
  return {
    ...state,
    keys: {
      ...original,
      async get(type, ids) {
        if (type === 'device-list') {
          log.debug?.({ requested: ids?.length || 0 }, 'Bypassing persisted Baileys device-list migration state')
          return {}
        }
        return original.get(type, ids)
      },
      async set(data) {
        const safe = { ...data }
        if (Object.prototype.hasOwnProperty.call(safe, 'device-list')) {
          log.debug?.({ entries: Object.keys(safe['device-list'] || {}).length }, 'Ignoring Baileys device-list persistence; preserving Signal auth keys')
          delete safe['device-list']
        }
        if (Object.keys(safe).length) await original.set(safe)
      }
    }
  }
}

export async function startConnection({ onSocket, onClosed }) {
  const { state: rawState, saveCreds } = await useMultiFileAuthState(config.authDir)
  const state = makeSafeAuthState(rawState, logger)
  // Pairing-code registration expects a canonical browser label; a custom label can make WhatsApp reject companion_hello.
  const sock = markBotMessages(makeWASocket({ auth: state, browser: Browsers.ubuntu('Chrome'), logger, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false }), { emoji: config.botMessageReaction, logger })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !sock.authState.creds.registered && !pairingCodeRequested) {
      const phoneNumber = String(process.env.PAIRING_NUMBER || '').replace(/\D/g, '')
      if (!phoneNumber) {
        logger.error('PAIRING_NUMBER is required to pair this unregistered WhatsApp account.')
      } else {
        pairingCodeRequested = true
        try {
          const code = await sock.requestPairingCode(phoneNumber)
          console.log(`\n========== SHADOW WHATSAPP PAIRING CODE ==========\n${code}\nEnter this code in WhatsApp > Linked devices. Keep it private.\n===================================================\n`)
        } catch (error) {
          pairingCodeRequested = false
          logger.error({ err: errorLogDetails(error) }, 'Pairing code request failed')
        }
      }
    }
    if (connection === 'open') { logger.info({ jid: sock.user?.id }, 'WhatsApp connection open'); onSocket(sock); return }
    if (connection !== 'close') return
    const status = new Boom(lastDisconnect?.error)?.output?.statusCode
    const permanent = status === DisconnectReason.loggedOut || status === DisconnectReason.forbidden || status === DisconnectReason.badSession
    logger.warn({ status, permanent }, 'WhatsApp connection closed')
    await onClosed({ permanent, status })
  })
  return sock
}
