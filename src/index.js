import fs from 'node:fs/promises'
import { config, validateConfig } from './config.js'
import { createJsonStore } from './services/jsonStore.js'
import { createGroupSettings } from './services/groupSettings.js'
import { createSudoService } from './services/sudo.js'
import { createMemoryService } from './services/memory.js'
import { buildCommands } from './commands/registry.js'
import { startConnection } from './connection/connect.js'
import { attachHandlers } from './handlers/eventHandler.js'
import { createDownloader } from './services/downloader.js'
import { createReactionService } from './services/reactions.js'
import { createGeminiBrain } from './services/aiBrain.js'
import { createImageGenerationService } from './services/imageGeneration.js'
import { createPersistentContextStore } from './services/conversationHistory.js'
import { logger } from './utils/logger.js'
import { errorLogDetails } from './utils/errors.js'
import { createFatalProcessErrorHandler } from './utils/processSafety.js'
validateConfig()
await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 })
const settingsStore = await createJsonStore(config.settingsFile)
const warningStore = await createJsonStore(config.warningsFile)
const sudoStore = await createJsonStore(config.sudoFile, [])
const memoryStore = await createJsonStore(config.memoryFile, {})
const historyStore = await createJsonStore(config.historyFile, {})
const settings = createGroupSettings(settingsStore, config)
const sudo = createSudoService(sudoStore)
const memory = createMemoryService(memoryStore)
const metrics = { messagesSeen: 0, commandsExecuted: 0, deniedCommands: 0, moderationActions: 0, errors: 0 }
const persistentContext = createPersistentContextStore(historyStore, { maxTurns: config.historyMaxTurns })
const reload = async () => { await settingsStore.reload(); await warningStore.reload(); await sudoStore.reload(); await memoryStore.reload(); await historyStore.reload() }
const startedAt = Date.now(); const downloader = createDownloader({ config }); const reactions = createReactionService(); const imageGenerator = createImageGenerationService({ model: config.imageModel, timeoutMs: config.imageTimeoutMs }); const commands = buildCommands({ settings, warnings: warningStore, sudo, startedAt, metrics, reload, downloader, reactions }); const aiBrain = createGeminiBrain({ config, sudo, memory, imageGenerator, historyStore: persistentContext, commands, settings }); const seen = new Set()
let currentSocket; let shuttingDown = false; let reconnecting = false; let connectionGeneration = 0; let reconnectTimer
async function connect() {
  const generation = ++connectionGeneration
  currentSocket = await startConnection({
    onSocket: sock => {
      if (shuttingDown || generation !== connectionGeneration) { logger.warn({ generation, currentGeneration: connectionGeneration }, 'Ignoring superseded WhatsApp socket'); try { sock.end?.(new Error('superseded socket')) } catch {}; return }
      attachHandlers({ sock, commands, settings, config, seen, aiBrain, reactions, metrics }); reconnecting = false
    },
    onClosed: async ({ permanent }) => {
      if (shuttingDown || permanent || generation !== connectionGeneration || reconnecting) return
      reconnecting = true
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => { if (shuttingDown || generation !== connectionGeneration) return; connect().catch(error => { logger.error({ err: errorLogDetails(error) }, 'Reconnect attempt failed'); reconnecting = false }) }, 3000)
    }
  })
}
async function shutdown(signal) { if (shuttingDown) return; shuttingDown = true; clearTimeout(reconnectTimer); logger.info({ signal }, 'Shutting down'); try { await aiBrain.flush() } catch (error) { logger.error({ err: errorLogDetails(error) }, 'Could not flush conversation history before shutdown') }; try { currentSocket?.end?.(new Error('Process shutdown')) } catch {}; process.exit(0) }
const handleFatalProcessError = createFatalProcessErrorHandler({ logger, getSocket: () => currentSocket, markShuttingDown: () => { shuttingDown = true; reconnecting = false } })
process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', reason => handleFatalProcessError('Unhandled promise rejection', reason))
process.on('uncaughtException', error => handleFatalProcessError('Uncaught exception', error))
logger.info({ bot: config.botName, prefix: config.prefix }, 'Starting secure WhatsApp bot')
await connect()
