import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import { logger } from '../utils/logger.js'
import { config } from '../config.js'
import { errorLogDetails } from '../utils/errors.js'

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
  const sock = makeWASocket({ auth: state, browser: Browsers.ubuntu(config.botName), logger, markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { logger.info('Scan the QR code below with WhatsApp > Linked devices'); qrcode.generate(qr, { small: true }) }
    if (connection === 'open') { logger.info({ jid: sock.user?.id }, 'WhatsApp connection open'); onSocket(sock); return }
    if (connection !== 'close') return
    const status = new Boom(lastDisconnect?.error)?.output?.statusCode
    const permanent = status === DisconnectReason.loggedOut || status === DisconnectReason.forbidden || status === DisconnectReason.badSession
    logger.warn({ status, permanent }, 'WhatsApp connection closed')
    await onClosed({ permanent, status })
  })
  if (!state.creds.registered && config.pairingNumber) {
    try {
      const code = await sock.requestPairingCode(config.pairingNumber)
      if (process.stdout.isTTY) process.stdout.write(`\nOne-time WhatsApp pairing code: ${code}\nEnter it on your phone and keep it private.\n`)
      else logger.info('Pairing code generated but not printed to non-interactive output; use QR login or run in a private terminal.')
    } catch (error) { logger.error({ err: errorLogDetails(error) }, 'Pairing code request failed') }
  }
  return sock
}
