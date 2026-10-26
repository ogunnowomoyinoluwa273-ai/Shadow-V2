import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bool = (v, fallback = false) => v == null ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())
const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback

export const config = Object.freeze({
  root,
  botName: process.env.BOT_NAME?.trim() || 'Shadow',
  prefix: process.env.BOT_PREFIX?.trim() || '.',
  ownerName: process.env.OWNER_NAME?.trim() || 'Not configured',
  ownerNumber: process.env.OWNER_NUMBER?.replace(/\D/g, '') || '',
  ownerLid: process.env.OWNER_LID?.trim() || '',
  version: process.env.BOT_VERSION?.trim() || '1.0.0',
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  welcomeDefault: process.env.WELCOME_DEFAULT || 'Welcome {user} to {group}! You are member {count}.',
  goodbyeDefault: process.env.GOODBYE_DEFAULT || 'Goodbye {user} from {group}.',
  pairingNumber: process.env.PAIRING_NUMBER?.replace(/\D/g, '') || '',
  authDir: path.resolve(root, process.env.AUTH_DIR || './data/auth'),
  settingsFile: path.resolve(root, process.env.SETTINGS_FILE || './data/group-settings.json'),
  warningsFile: path.resolve(root, process.env.WARNINGS_FILE || './data/warnings.json'),
  sudoFile: path.resolve(root, process.env.SUDO_FILE || './data/sudo.json'),
  memoryFile: path.resolve(root, process.env.MEMORY_FILE || './data/memories.json'),
  historyFile: path.resolve(root, process.env.HISTORY_FILE || './data/conversation-history.json'),
  historyMaxTurns: Math.max(2, Math.min(number(process.env.HISTORY_MAX_TURNS, 6), 20)),
  maxTagall: Math.max(1, Math.min(number(process.env.MAX_TAGALL, 100), 1024)),
  antiLinkDefault: bool(process.env.ANTILINK_DEFAULT, false),
  antiDeleteLogJid: process.env.ANTIDELETE_LOG_JID?.trim() || '',
  ytdlpPath: process.env.YTDLP_PATH?.trim() || '',
  downloaderTimeoutMs: Math.max(30_000, Math.min(number(process.env.DOWNLOADER_TIMEOUT_MS, 180_000), 600_000)),
  downloaderMaxBytes: Math.max(1_000_000, Math.min(number(process.env.DOWNLOADER_MAX_BYTES, 50 * 1024 * 1024), 100 * 1024 * 1024)),
  downloaderConcurrency: Math.max(1, Math.min(number(process.env.DOWNLOADER_CONCURRENCY, 1), 3)),
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
  geminiFastModel: process.env.GEMINI_FAST_MODEL?.trim() || 'gemini-3.5-flash-lite',
  imageModel: process.env.IMAGE_MODEL?.trim() || 'gemini-nano-banana-2.1',
  imageTimeoutMs: Number(process.env.IMAGE_TIMEOUT_MS || 45000),
  geminiThinkingLevel: ['low', 'medium', 'high'].includes(process.env.GEMINI_THINKING_LEVEL?.trim()) ? process.env.GEMINI_THINKING_LEVEL.trim() : 'low',
  geminiTimeoutMs: Math.max(10_000, Math.min(number(process.env.GEMINI_TIMEOUT_MS, 20_000), 120_000)),
  geminiToolTimeoutMs: Math.max(20_000, Math.min(number(process.env.GEMINI_TOOL_TIMEOUT_MS, 60_000), 180_000)),
  geminiToolExecutionTimeoutMs: Math.max(5_000, Math.min(number(process.env.GEMINI_TOOL_EXECUTION_TIMEOUT_MS, 15_000), 60_000)),
  broadcastGroups: (process.env.BROADCAST_GROUPS || '').split(',').map(value => value.trim()).filter(value => /^\d+-\d+@g\.us$/.test(value)).slice(0, 10)
})

export function validateConfig() {
  if (!config.prefix || config.prefix.length > 3) throw new Error('BOT_PREFIX must be 1-3 characters')
  if (!config.botName) throw new Error('BOT_NAME is required')
}
