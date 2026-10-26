import os from 'node:os'
import QRCode from 'qrcode'
import { config } from '../config.js'
import { extractText, formatDuration, getQuoted } from '../utils/message.js'
import { requireAdmin, requireGroup, botIsAdmin, resolveTarget, ownerJids, messageSender, isOwner } from '../utils/permissions.js'
import { participantId, participantMention, sameJid } from '../utils/jid.js'
import { calculate } from '../services/calculator.js'
import { buildTranslationRequest, define, shorten, translate, weather } from '../services/webTools.js'
import { downloadQuotedMedia, toImage, toMp3, toSticker } from '../services/media.js'
import { animeByGenre, characterById, compareCharacters, createQuizService, parseBattleArgs, popularAnime, randomAnimeQuote, randomWaifu, recommendAnime, searchAnime, searchCharacter, searchManga, seasonalAnime, animeThemes } from '../services/anime.js'
import { measuredPingLatencyMs } from '../services/ping.js'
import { validateAnimeThemeUrl } from '../services/downloader.js'
import { UserFacingError } from '../utils/errors.js'
import { createTsundereService } from '../services/tsundere.js'

const quoteText = "A winner is someone who has failed enough to succeed but didn't fail to stop"
const usage = name => `Usage: ${config.prefix}${name}`
const isDownloadableTheme = item => {
  if (!item || !['Opening', 'Ending'].includes(item.type)) return false
  try { validateAnimeThemeUrl(item.url); return true } catch { return false }
}
const categoryOrder = ['General', 'Group Administration', 'Security & Moderation', 'Welcome & Warnings', 'Owner Tools']
const panelCategoryOrder = ['General', 'Utility', 'Downloaders', 'Media', 'Anime', 'Group', 'Bot', 'Owner', 'Sudo']
const categoryFor = name => {
  if (['addsudo', 'delsudo', 'sudos'].includes(name)) return 'Owner Tools'
  if (['tagall', 'hidetag', 'delete', 'kick', 'promote', 'demote', 'group', 'setname', 'setdescription', 'invite', 'revokeinvite', 'joinrequest', 'greet'].includes(name)) return 'Group Administration'
  if (['antilink', 'antidelete', 'warn', 'warnings', 'resetwarnings', 'mute', 'unmute', 'slowmode', 'clear'].includes(name)) return 'Security & Moderation'
  if (['setwelcome', 'setgoodbye', 'setrules'].includes(name)) return 'Welcome & Warnings'
  if (['stats', 'reload', 'broadcast'].includes(name)) return 'Owner Tools'
  if (['anime', 'searchanime', 'manga', 'character', 'seasonal', 'animesong', 'waifu', 'neko', 'animequote', 'animegenre', 'animepopular', 'anibattle', 'animequiz', 'recommend', 'hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite', 'hmph'].includes(name)) return 'General'
  if (['enablecmd', 'disablecmd'].includes(name)) return 'Group Administration'
  return 'General'
}
function targetOrThrow(message, args) { const target = resolveTarget(message, args); if (!target) throw new UserFacingError('Mention or provide one valid participant target.'); return target }
function adminCommand(name, aliases, run, description) { return { name, aliases, description, category: categoryFor(name), groupOnly: true, run } }
function parseDownloadQuality(args) {
  const values = [...args]
  const option = String(values.at(-1) || '').toLowerCase()
  const quality = option === 'hd' ? 'hd' : 'sd'
  if (option === 'hd' || option === 'sd') values.pop()
  return { values, quality }
}
function downloadQualityLabel(mode, quality) {
  if (mode === 'audio') return quality === 'hd' ? '320 kbps MP3 audio (source quality varies)' : 'standard 128 kbps MP3 audio'
  return quality === 'hd' ? 'HD video (720p–1080p)' : 'SD video (up to 480p)'
}
async function sendReactionSticker({ reactionService, sock, message, reply, action, text }) {
  const responseText = text || `${action[0].toUpperCase()}${action.slice(1)} reaction`
  let sticker
  try { sticker = await reactionService.loadSticker(action) } catch { await reply(responseText); return }
  try { await sock.sendMessage(message.key.remoteJid, { sticker, isAnimated: true }, { quoted: message }) } catch { await reply(responseText); return }
  await reply(responseText)
}

function panelCategoryFor(command) {
  if (['addsudo', 'delsudo', 'sudos'].includes(command.name)) return 'Sudo'
  if (command.ownerOnly) return 'Owner'
  if (['yta', 'ytv', 'play', 'tiktok', 'insta', 'fb', 'twitter'].includes(command.name)) return 'Downloaders'
  if (['sticker', 'toimage', 'tomp3', 'media'].includes(command.name)) return 'Media'
  if (['weather', 'translate', 'calculate', 'define', 'shortlink', 'qr'].includes(command.name)) return 'Utility'
  if (['anime', 'searchanime', 'manga', 'character', 'seasonal', 'animesong', 'waifu', 'neko', 'animequote', 'animegenre', 'animepopular', 'anibattle', 'animequiz', 'recommend', 'hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite', 'hmph'].includes(command.name)) return 'Anime'
  if (['groupinfo', 'admins', 'rules', 'tagall', 'hidetag', 'delete', 'kick', 'promote', 'demote', 'group', 'setname', 'setdescription', 'invite', 'revokeinvite', 'joinrequest', 'greet', 'setwelcome', 'setgoodbye', 'setrules', 'warnings', 'warn', 'resetwarnings', 'mute', 'unmute', 'slowmode', 'clear', 'antilink', 'antidelete', 'enablecmd', 'disablecmd'].includes(command.name)) return 'Group'
  if (['stats', 'reload', 'broadcast'].includes(command.name)) return 'Owner'
  if (['info', 'runtime', 'alive', 'ping', 'menu', 'help'].includes(command.name)) return 'Bot'
  return 'General'
}

const boldAlphabet = Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter, index) => [letter, String.fromCodePoint(0x1D400 + index)]))
const boldDigits = Object.fromEntries('0123456789'.split('').map((digit, index) => [digit, String.fromCodePoint(0x1D7CE + index)]))
function boldCommandName(name) { return String(name).toUpperCase().split('').map(character => boldAlphabet[character] || boldDigits[character] || character).join('') }
function formatPanelEntry(command, prefix) { return `┃  ${prefix}*${boldCommandName(command.name)}*` }

export function renderMenu({ commands, config: appConfig = config, startedAt = Date.now(), now = new Date() }) {
  const sections = panelCategoryOrder.map(category => {
    const entries = commands.filter(command => panelCategoryFor(command) === category)
    if (!entries.length) return ''
    return [`╭─〔 ${category.toUpperCase()} 〕`, ...entries.map(command => formatPanelEntry(command, appConfig.prefix)), '╰────────────────'].join('\n')
  }).filter(Boolean)
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' })
  return [
    '╭━━━━━━━━━━━━━━━━━━━━╮',
    `┃  ✦ ${appConfig.botName.toUpperCase()} COMMAND PANEL  ✦`,
    '╰━━━━━━━━━━━━━━━━━━━━╯',
    `◈ Owner   : ${appConfig.ownerName}`,
    `◈ Time    : ${time} · ${day}`,
    `◈ Commands: ${commands.length}`,
    `◈ Version : ${appConfig.version || '1.0.0'}`,
    `◈ Uptime  : ${formatDuration((Date.now() - startedAt) / 1000)}`,
    `◈ Prefix  : ${appConfig.prefix}`,
    '',
    `Type ${appConfig.prefix}help <command> for details.`,
    '',
    ...sections,
    '',
    `╰─ ${appConfig.botName} · secure automation ─╯`
  ].join('\n')
}

export function renderHelp({ commands, config: appConfig = config, startedAt = Date.now() }) {
  const sections = categoryOrder.map(category => {
    const entries = commands.filter(command => (command.category || categoryFor(command.name)) === category)
    if (!entries.length) return ''
    return [`╭─「 ${category} 」`, ...entries.map(command => `│ ${appConfig.prefix}${command.name}  ·  ${command.description.replace(/^Owner-only:\s*/i, '')}`), '╰──────────────'].join('\n')
  }).filter(Boolean)
  return [
    `╔════════════════════╗`,
    `║   ✦ ${appConfig.botName.toUpperCase()} ✦   ║`,
    `╚════════════════════╝`,
    `👤 Owner  : ${appConfig.ownerName}`,
    `🟢 Status : Online  ·  ${formatDuration((Date.now() - startedAt) / 1000)}`,
    `⚡ Prefix : ${appConfig.prefix}`,
    '',
    'Welcome to Shadow control center.',
    `Type ${appConfig.prefix}help <command> for command details.`,
    '',
    ...sections,
    '',
    `© ${appConfig.botName}  ·  Secure automation`
  ].join('\n')
}

export function buildCommands({ settings, warnings, sudo, startedAt, metrics = {}, reload = async () => {}, downloader, reactions = null, anime = null, quiz = null, tsundere = null }) {
  const reactionService = reactions || { loadSticker: async () => { throw new Error('Reaction sticker service is not configured.') } }
  const tsundereService = tsundere || createTsundereService()
  const animeApi = anime || { animeByGenre, characterById, compareCharacters, parseBattleArgs, popularAnime, randomAnimeQuote, randomWaifu, recommendAnime, searchAnime, searchCharacter, searchManga, seasonalAnime, animeThemes }
  const animeQuiz = quiz || createQuizService()
  const general = [
    { name: 'aimodel', aliases: [], description: 'Owner/sudo: show the configured AI model.', category: 'Owner Tools', async run({ sock, message, args, reply }) { const sender = messageSender(message, sock); if (!isOwner(sender, config) && !sudo.has(sender)) throw new UserFacingError('Only the owner or an authorized sudo user can view AI model settings.'); const option = String(args[0] || 'status').toLowerCase(); if (option !== 'status') throw new UserFacingError(`${usage('aimodel [status]')}`); await reply(`Configured AI provider: Google Gemini\nConversation model: ${config.geminiFastModel}\nTool-enabled model: ${config.geminiModel}`) } },
    { name: 'addsudo', aliases: [], description: 'Owner-only: authorize a participant.', ownerOnly: true, category: 'Owner Tools', async run({ message, args, reply }) { const target = targetOrThrow(message, args); await sudo.add(target); await reply(`${participantMention(target)} is now authorized to use bot commands.`) } },
    { name: 'delsudo', aliases: [], description: 'Owner-only: revoke participant access.', ownerOnly: true, category: 'Owner Tools', async run({ message, args, reply }) { const target = targetOrThrow(message, args); await sudo.remove(target); await reply(`${participantMention(target)} is no longer authorized to use bot commands.`) } },
    { name: 'sudos', aliases: [], description: 'Owner-only: list authorized users.', ownerOnly: true, category: 'Owner Tools', async run({ reply }) { const entries = sudo.list(); await reply(entries.length ? `Authorized users:\n${entries.map((jid, index) => `${index + 1}. ${participantMention(jid)} (${jid})`).join('\n')}` : 'No sudo users configured.') } },
    { name: 'stats', aliases: [], description: 'Owner-only: show runtime diagnostics.', ownerOnly: true, category: 'Owner Tools', async run({ reply }) { await reply(`Shadow diagnostics\nUptime: ${formatDuration((Date.now() - startedAt) / 1000)}\nMessages seen: ${metrics.messagesSeen || 0}\nCommands executed: ${metrics.commandsExecuted || 0}\nDenied commands: ${metrics.deniedCommands || 0}\nModeration actions: ${metrics.moderationActions || 0}\nErrors: ${metrics.errors || 0}`) } },
    { name: 'reload', aliases: [], description: 'Owner-only: reload local JSON settings.', ownerOnly: true, category: 'Owner Tools', async run({ reply }) { await reload(); await reply('Local settings, warnings, and sudo data reloaded.') } },
    { name: 'broadcast', aliases: [], description: 'Owner-only: guarded configured-group broadcast.', ownerOnly: true, category: 'Owner Tools', async run({ sock, args, reply }) { if (args[0] !== 'CONFIRM') throw new UserFacingError(`${usage('broadcast CONFIRM message')}`); const text = args.slice(1).join(' ').trim(); if (!text) throw new UserFacingError(`${usage('broadcast CONFIRM message')}`); if (!config.broadcastGroups.length) throw new UserFacingError('Broadcast is disabled: configure BROADCAST_GROUPS first.'); for (const jid of config.broadcastGroups) await sock.sendMessage(jid, { text }); await reply(`Broadcast sent to ${config.broadcastGroups.length} configured group(s).`) } },
    { name: 'sticker', aliases: [], description: 'Convert a replied image or video into a sticker.', async run({ sock, message }) { const quoted = getQuoted(message); if (!quoted) throw new UserFacingError('Reply to an image or video with .sticker.'); const media = await downloadQuotedMedia(quoted, sock); await sock.sendMessage(message.key.remoteJid, { sticker: await toSticker(media) }, { quoted: message }) } },
    { name: 'toimage', aliases: [], description: 'Convert a replied sticker into an image.', async run({ sock, message }) { const quoted = getQuoted(message); if (!quoted) throw new UserFacingError('Reply to a sticker with .toimage.'); const media = await downloadQuotedMedia(quoted, sock); if (media.type !== 'stickerMessage') throw new UserFacingError('Reply to a sticker with .toimage.'); await sock.sendMessage(message.key.remoteJid, { image: await toImage(media), mimetype: 'image/png' }, { quoted: message }) } },
    { name: 'tomp3', aliases: [], description: 'Convert replied audio or video to MP3.', async run({ sock, message }) { const quoted = getQuoted(message); if (!quoted) throw new UserFacingError('Reply to audio or video with .tomp3.'); const media = await downloadQuotedMedia(quoted, sock); await sock.sendMessage(message.key.remoteJid, { audio: await toMp3(media), mimetype: 'audio/mpeg', fileName: 'shadow-audio.mp3' }, { quoted: message }) } },
    { name: 'media', aliases: [], description: 'Re-send replied media in its original type.', async run({ sock, message }) { const quoted = getQuoted(message); if (!quoted) throw new UserFacingError('Reply to media with .media.'); const media = await downloadQuotedMedia(quoted, sock); const content = media.type === 'imageMessage' ? { image: media.buffer, mimetype: media.mimetype } : media.type === 'videoMessage' ? { video: media.buffer, mimetype: media.mimetype } : media.type === 'audioMessage' ? { audio: media.buffer, mimetype: media.mimetype } : media.type === 'stickerMessage' ? { sticker: media.buffer } : { document: media.buffer, mimetype: media.mimetype, fileName: media.fileName }; await sock.sendMessage(message.key.remoteJid, content, { quoted: message }) } },
    { name: 'weather', aliases: [], description: 'Look up current weather for a city.', async run({ args, reply }) { await reply(await weather(args.join(' '))) } },
    { name: 'anime', aliases: [], description: 'Search anime titles, metadata, ratings, and synopsis.', async run({ sock, message, args, reply }) { const data = await animeApi.searchAnime(args.join(' ')); if (!data.results.length) return reply('No anime matched that title.'); const caption = data.results.map((item, index) => `${index + 1}. ${item.title}\n${item.type || 'Anime'} · ${item.year || 'Year unknown'} · ${item.episodes ?? '?'} eps · Score ${item.score ?? '?'}\n${item.genres.join(', ') || 'Genres unavailable'}\n${item.synopsis || 'Synopsis unavailable'}\n${item.url || ''}`).join('\n\n'); const first = data.results[0]; try { if (first.imageUrl) return await sock.sendMessage(message.key.remoteJid, { image: { url: first.imageUrl }, caption }, { quoted: message }) } catch {} await reply(caption) } },
    { name: 'manga', aliases: [], description: 'Search manga titles, chapters, ratings, and synopsis.', async run({ args, reply }) { const results = await animeApi.searchManga(args.join(' ')); await reply(results.length ? results.map((item, index) => `${index + 1}. ${item.title}\n${item.format || 'Manga'} · ${item.year || 'Year unknown'} · ${item.chapters ?? '?'} chapters · Score ${item.score ?? '?'}\n${item.genres.join(', ') || 'Genres unavailable'}\n${item.synopsis || 'Synopsis unavailable'}\n${item.url || ''}`).join('\n\n') : 'No manga matched that title.') } },
    { name: 'character', aliases: [], description: 'Search anime characters and their available profiles.', async run({ sock, message, args, reply }) { const data = await animeApi.searchCharacter(args.join(' ')); if (!data.results.length) return reply('No character matched that name.'); if (data.results.length > 1) return reply(`Character matches:\n${data.results.map((item, index) => `${index + 1}. ${item.name}${item.anime.length ? ` — ${item.anime.join(', ')}` : ''}`).join('\n')}\nUse the exact character name for a focused result.`); const item = data.results[0]; const caption = `${item.name}\n${item.anime.length ? `Series: ${item.anime.join(', ')}\n` : ''}${item.about || 'Biography unavailable.'}\n${item.url || ''}`; try { if (item.imageUrl) return await sock.sendMessage(message.key.remoteJid, { image: { url: item.imageUrl }, caption }, { quoted: message }) } catch {} await reply(caption) } },
    { name: 'seasonal', aliases: [], description: 'Show a limited list of anime airing this season.', async run({ args, reply }) { const page = args[0] || 1; const data = await animeApi.seasonalAnime(page); await reply(data.results.length ? `Current seasonal anime (page ${page}):\n\n${data.results.map((item, index) => `${index + 1}. ${item.title} · ${item.score ?? '?'}\n${item.status || 'Status unavailable'} · ${item.episodes ?? '?'} eps\n${item.url || ''}`).join('\n\n')}` : 'No seasonal anime was returned for that page.') } },
    { name: 'animesong', aliases: [], description: 'Download a matching anime opening or ending as MP3.', async run({ sock, message, args }) { const query = args.join(' ').trim(); if (!query) throw new UserFacingError(`${usage('animesong anime title')}`); const themes = await animeApi.animeThemes(query); const theme = themes.find(item => item.type === 'Opening' && isDownloadableTheme(item)) || themes.find(item => item.type === 'Ending' && isDownloadableTheme(item)); if (!theme) throw new UserFacingError('No downloadable opening or ending audio was found for that anime.'); if (!downloader?.downloadThemeAudio || !downloader.send) throw new UserFacingError('Anime theme audio downloads are not configured.'); const result = await downloader.downloadThemeAudio(theme); await downloader.send(sock, message.key.remoteJid, result, { quoted: message }) } },
    { name: 'waifu', aliases: [], description: 'Send a random safe anime character image.', async run({ sock, message, reply }) { const item = await animeApi.randomWaifu(); const caption = `${item.name}\nSFW random anime character\n${item.source}`; try { await sock.sendMessage(message.key.remoteJid, { image: { url: item.imageUrl }, caption }, { quoted: message }) } catch { await reply(caption) } } },
    { name: 'neko', aliases: [], description: 'Send a random safe anime image.', async run({ sock, message, reply }) { const item = await animeApi.randomWaifu(); const caption = `Random neko image\nSFW source\n${item.source}`; try { await sock.sendMessage(message.key.remoteJid, { image: { url: item.imageUrl }, caption }, { quoted: message }) } catch { await reply(caption) } } },
    { name: 'animequote', aliases: [], description: 'Return a short anime-inspired quote.', async run({ reply }) { await reply(animeApi.randomAnimeQuote()) } },
    { name: 'animegenre', aliases: [], description: 'List popular anime from a genre.', async run({ args, reply }) { const results = await animeApi.animeByGenre(args.join(' ')); await reply(results.length ? `Popular ${args.join(' ')} anime:\n\n${results.map((item, index) => `${index + 1}. ${item.title} · Score ${item.score ?? '?'}\n${item.url || ''}`).join('\n')}` : 'No anime was found for that genre.') } },
    { name: 'animepopular', aliases: [], description: 'Show currently popular anime.', async run({ reply }) { const results = await animeApi.popularAnime(); await reply(results.length ? `Popular anime:\n\n${results.map((item, index) => `${index + 1}. ${item.title} · Score ${item.score ?? '?'}\n${item.url || ''}`).join('\n')}` : 'Popular anime was not available.') } },
    ...['hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite'].map(name => ({ name, aliases: [], description: `Send an animated ${name} reaction sticker.`, async run({ sock, message, reply }) { await sendReactionSticker({ reactionService, sock, message, reply, action: name }) } })),
    { name: 'hmph', aliases: [], description: 'Send a playful tsundere line with an animated anime sticker.', async run({ sock, message, reply }) { const text = tsundereService.randomLine(); await sendReactionSticker({ reactionService, sock, message, reply, action: 'pout', text }) } },
    { name: 'anibattle', aliases: [], description: 'Compare two characters with a transparent database-based result.', async run({ rawArgs, reply }) { const [left, right] = animeApi.parseBattleArgs(rawArgs); const result = await animeApi.compareCharacters(left, right); await reply(`⚔️ ${result.first.name} vs ${result.second.name}\n\nAdvantage: ${result.winner}\nBasis: ${result.basis}\n\nThis is a subjective database comparison, not confirmed canon power scaling.`) } },
    { name: 'animequiz', aliases: [], description: 'Start or answer a lightweight anime trivia quiz.', async run({ sock, message, args, reply }) { const chat = message.key.remoteJid; const sender = message.key.participant || sock.user?.id || 'unknown'; if (!args.length) { const question = animeQuiz.start(chat, sender); return reply(`Anime quiz started!\n\n${question.question}\n${question.options.map((option, index) => `${index + 1}. ${option}`).join('\n')}\n\nAnswer with ${config.prefix}animequiz 1-4.`) } const result = animeQuiz.answer(chat, sender, args[0]); if (result.done) return reply(`${result.correct ? 'Correct!' : `Not quite. Correct answer: ${result.answer}`}\n\nFinal score: ${result.score}/${result.total}`); await reply(`${result.correct ? 'Correct!' : `Not quite. Correct answer: ${result.answer}`}\n\n${result.question.question}\n${result.question.options.map((option, index) => `${index + 1}. ${option}`).join('\n')}`) } },
    { name: 'recommend', aliases: [], description: 'Recommend anime by genre, mood, or title.', async run({ args, reply }) { const results = await animeApi.recommendAnime(args.join(' ')); await reply(results.length ? `Anime recommendations:\n\n${results.map((item, index) => `${index + 1}. ${item.title}\n${item.genres.join(', ') || 'Genres unavailable'} · Score ${item.score ?? '?'}\n${item.synopsis || 'Synopsis unavailable'}\n${item.url || ''}`).join('\n\n')}` : 'No recommendations were found.') } },
    { name: 'translate', aliases: [], description: 'Translate text or a replied message into English or another language.', async run({ args, rawArgs, message, reply }) { const quoted = getQuoted(message); const request = buildTranslationRequest({ args, rawArgs, quotedText: quoted ? extractText(quoted) : '' }); const result = await translate(request.target, request.text); if (request.fromReply) await reply(`Original message:\n${request.text}\n\nTranslation (${request.target}):\n${result}`); else await reply(result) } },
    { name: 'calculate', aliases: [], description: 'Evaluate a safe arithmetic expression.', async run({ rawArgs, reply }) { await reply(`Result: ${calculate(rawArgs)}`) } },
    { name: 'define', aliases: [], description: 'Look up an English word definition.', async run({ args, reply }) { await reply(await define(args.join(' '))) } },
    { name: 'shortlink', aliases: [], description: 'Create a short HTTP(S) link.', async run({ args, reply }) { await reply(await shorten(args[0])) } },
    { name: 'qr', aliases: [], description: 'Create a QR code image from text.', async run({ sock, message, rawArgs }) { if (!rawArgs) throw new UserFacingError(`${usage('qr text')}`); const image = await QRCode.toBuffer(rawArgs, { width: 512, margin: 2 }); await sock.sendMessage(message.key.remoteJid, { image, caption: 'Generated by Shadow.' }, { quoted: message }) } },
    { name: 'yta', aliases: [], description: 'Download public YouTube audio. Standard 128 kbps MP3 by default; add `hd` for 320 kbps MP3 output (source quality varies).', async run({ sock, message, args, reply }) {
      if (!downloader) throw new UserFacingError('Downloader is not configured.')
      const { values, quality } = parseDownloadQuality(args)
      if (values.length !== 1 || !values[0]) throw new UserFacingError(`${usage('yta YouTube URL [hd]')}`)
      await reply(`⏳ Downloading ${downloadQualityLabel('audio', quality)}...`)
      const result = await downloader.download({ url: values[0], mode: 'audio', quality })
      await downloader.send(sock, message.key.remoteJid, result, { quoted: message })
    } },
    { name: 'ytv', aliases: [], description: 'Download public YouTube video. SD (up to 480p) by default; add `hd` for 720p–1080p.', async run({ sock, message, args, reply }) {
      if (!downloader) throw new UserFacingError('Downloader is not configured.')
      const { values, quality } = parseDownloadQuality(args)
      if (values.length !== 1 || !values[0]) throw new UserFacingError(`${usage('ytv YouTube URL [hd]')}`)
      await reply(`⏳ Downloading ${downloadQualityLabel('video', quality)}...`)
      const result = await downloader.download({ url: values[0], mode: 'video', quality })
      await downloader.send(sock, message.key.remoteJid, result, { quoted: message })
    } },
    { name: 'play', aliases: [], description: 'Search YouTube or paste a public media URL for audio; add `hd` for 320 kbps MP3 output (source quality varies).', async run({ sock, message, args, reply }) {
      if (!downloader) throw new UserFacingError('Downloader is not configured.')
      const chat = message.key.remoteJid
      const sender = message.key.participant || sock.user?.id || 'unknown'
      const first = String(args[0] || '')
      const lastOption = String(args.at(-1) || '').toLowerCase()
      const hasOnlySelectionArgs = args.length === 1 || (args.length === 2 && ['sd', 'hd'].includes(lastOption))
      const isSelection = /^\d+$/.test(first) && hasOnlySelectionArgs
      const isUrl = /^https?:\/\//i.test(first)
      if (isSelection || isUrl) {
        const { values, quality } = parseDownloadQuality(args)
        if (values.length !== 1) throw new UserFacingError(`${usage(isSelection ? 'play result number [hd]' : 'play media URL [hd]')}`)
        const url = isSelection ? downloader.select(chat, sender, Number(values[0])).url : values[0]
        await reply(`⏳ Downloading ${downloadQualityLabel('audio', quality)}...`)
        const result = await downloader.download({ url, mode: 'audio', quality })
        await downloader.send(sock, chat, result, { quoted: message })
        return
      }
      const query = args.join(' ').trim()
      if (!query) throw new UserFacingError(`${usage('play song name | play public URL [hd] | play result number [hd]')}`)
      const results = await downloader.search(query, chat, sender)
      await reply(`Search results for: ${query}\n\n${results.map(item => `${item.index}. ${item.title}\n   ${item.uploader}${item.duration ? ` · ${item.duration}` : ''}`).join('\n')}\n\nReply with ${config.prefix}play 1-${results.length} [hd] to download a result. Only the requesting user can select it, and the list expires in 5 minutes. Pasted public URLs download directly as audio.`)
    } },
    ...['tiktok', 'insta', 'fb', 'twitter'].map(name => ({ name, aliases: [], description: `Download supported public ${name === 'insta' ? 'Instagram' : name === 'fb' ? 'Facebook' : name === 'twitter' ? 'X/Twitter' : 'TikTok'} video. SD (up to 480p) by default; add hd for 720p–1080p.`, async run({ sock, message, args, reply }) {
      if (!downloader) throw new UserFacingError('Downloader is not configured.')
      const { values, quality } = parseDownloadQuality(args)
      if (values.length !== 1 || !values[0]) throw new UserFacingError(`${usage(`${name} URL [hd]`)}`)
      await reply(`⏳ Downloading ${downloadQualityLabel('video', quality)}...`)
      const result = await downloader.download({ url: values[0], mode: 'video', quality })
      await downloader.send(sock, message.key.remoteJid, result, { quoted: message })
    } })),
    { name: 'ping', aliases: [], description: 'Measure bot-side response time in milliseconds.', async run({ sock, message, receivedAt }) { const latency = measuredPingLatencyMs(receivedAt); await sock.sendMessage(message.key.remoteJid, { text: `Pong! You think you can match my speed? ⚡: ${latency}ms` }) } },
    { name: 'alive', aliases: [], description: 'Show online status and uptime.', async run({ reply }) { await reply(`Online. Uptime: ${formatDuration((Date.now() - startedAt) / 1000)}`) } },
    { name: 'runtime', aliases: [], description: 'Show readable process uptime.', async run({ reply }) { await reply(formatDuration((Date.now() - startedAt) / 1000)) } },
    { name: 'info', aliases: [], description: 'Show bot and runtime information.', async run({ reply }) { await reply(`${config.botName} v${config.version}\nNode ${process.version}\nPlatform ${process.platform}/${os.arch()}\nUptime ${formatDuration((Date.now() - startedAt) / 1000)}`) } },
    { name: 'owner', aliases: [], description: 'Show configured owner details.', async run({ reply }) { await reply(`Owner: ${config.ownerName}${config.ownerNumber ? `\nContact: +${config.ownerNumber}` : ''}`) } },
    { name: 'menu', aliases: [], description: 'Display the premium command center.', async run({ sock, message, reply }) {
      const caption = renderMenu({ commands: allCommands, config, startedAt })
      try {
        const ownerJid = ownerJids(config)[0] || sock.user?.id
        const pictureUrl = ownerJid && await sock.profilePictureUrl(ownerJid, 'image', 5000)
        if (pictureUrl) { await sock.sendMessage(message.key.remoteJid, { image: { url: pictureUrl }, caption }, { quoted: message }); return }
      } catch {}
      await reply(caption)
    } },
    { name: 'help', aliases: [], description: 'Show the control center or command details.', async run({ reply, args }) { const requested = (args[0] || '').toLowerCase(); const cmd = allCommands.find(x => x.name === requested || x.aliases.includes(requested)); if (requested && !cmd) return reply(`Unknown command: ${config.prefix}${requested}\nUse ${config.prefix}help to view the available commands.`); await reply(cmd ? `✦ ${config.prefix}${cmd.name}\n${cmd.description}\nCategory: ${cmd.category || categoryFor(cmd.name)}\nUsage: ${config.prefix}${cmd.name}${cmd.groupOnly ? ' (group)' : ''}${cmd.ownerOnly ? '\nAccess: owner only' : ''}` : renderHelp({ commands: allCommands, config, startedAt })) } },
    { name: 'quote', aliases: [], description: 'Return the configured local quote.', async run({ reply }) { await reply(quoteText) } },
    { name: 'groupinfo', aliases: [], description: 'Show current group metadata.', groupOnly: true, async run({ sock, message, reply }) { const m = await requireGroup(sock, message); await reply(`Group: ${m.subject || 'Unknown'}\nDescription: ${m.desc || 'Not available'}\nParticipants: ${m.participants?.length ?? 0}\nCreated: ${m.creation ? new Date(m.creation * 1000).toISOString() : 'Unknown'}`) } },
    { name: 'admins', aliases: [], description: 'List group administrators.', groupOnly: true, async run({ sock, message, reply }) { const m = await requireGroup(sock, message); const admins = (m.participants || []).filter(p => p.admin).map(p => participantMention(participantId(p))); await reply(admins.length ? `Admins:\n${admins.join('\n')}` : 'No administrator metadata available.') } },
    { name: 'rules', aliases: [], description: 'Show the group rules.', groupOnly: true, async run({ message, reply }) { await reply(settings.get(message.key.remoteJid).rules) } },
    { name: 'support', aliases: [], description: 'Show configured support contact.', async run({ reply }) { await reply(process.env.SUPPORT_CONTACT?.trim() || 'Support contact is not configured.') } }
  ]
  const admin = [
    adminCommand('tagall', [], async ({ sock, message, args, reply }) => { const m = await requireAdmin(sock, message, config); const ids = (m.participants || []).map(participantId).filter(Boolean).filter(id => !sameJid(id, sock.user?.id)).slice(0, config.maxTagall); if (!ids.length) throw new UserFacingError('No participants available to tag.'); await sock.sendMessage(message.key.remoteJid, { text: args.join(' ') || 'Attention everyone.', mentions: ids }); await reply(`Tagged ${ids.length} participant(s).`) }, 'Mention participants with an optional message.'),
    adminCommand('hidetag', [], async ({ sock, message, args }) => { const m = await requireAdmin(sock, message); const ids = (m.participants || []).map(participantId).filter(Boolean).slice(0, config.maxTagall); await sock.sendMessage(message.key.remoteJid, { text: args.join(' ') || 'Attention.', mentions: ids }) }, 'Mention participants without a visible list.'),
    adminCommand('antilink', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const mode = args[0]?.toLowerCase(); if (!['on', 'off'].includes(mode)) throw new UserFacingError(`${usage('antilink on|off')}`); await settings.set(message.key.remoteJid, { antiLink: mode === 'on' }); await reply(`Anti-link is now ${mode}.`) }, 'Enable or disable invitation-link protection.'),
    adminCommand('antidelete', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const mode = args[0]?.toLowerCase(); if (!['on', 'off'].includes(mode)) throw new UserFacingError(`${usage('antidelete on|off')}`); await settings.set(message.key.remoteJid, { antiDelete: mode === 'on' }); await reply(`Anti-delete is now ${mode}. Shadow will notify the group and recover recent deleted messages while enabled.`) }, 'Notify and recover recent deleted group messages.'),
    adminCommand('mute', [], async ({ sock, message, args, reply }) => { const metadata = await requireAdmin(sock, message, config); if (!botIsAdmin(metadata, sock)) throw new UserFacingError('The bot must be a group administrator.'); const target = targetOrThrow(message, args); if (sameJid(target, sock.user?.id)) throw new UserFacingError('The bot cannot mute itself.'); const current = settings.get(message.key.remoteJid).mutedParticipants || []; if (!current.some(item => sameJid(item, target))) await settings.set(message.key.remoteJid, { mutedParticipants: [...current, target] }); await reply(`${participantMention(target)} is muted. Their messages will be removed while mute is active.`) }, 'Mute a participant through bot-enforced moderation.'),
    adminCommand('unmute', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const target = targetOrThrow(message, args); const current = settings.get(message.key.remoteJid).mutedParticipants || []; await settings.set(message.key.remoteJid, { mutedParticipants: current.filter(item => !sameJid(item, target)) }); await reply(`${participantMention(target)} is unmuted.`) }, 'Remove a participant mute.'),
    adminCommand('slowmode', [], async ({ sock, message, args, reply }) => { const metadata = await requireAdmin(sock, message, config); if (!botIsAdmin(metadata, sock)) throw new UserFacingError('The bot must be a group administrator.'); const seconds = Number(args[0]); if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) throw new UserFacingError(`${usage('slowmode seconds')}; use 0 to disable.`); await settings.set(message.key.remoteJid, { slowmodeSeconds: seconds }); await reply(seconds ? `Slowmode is now ${seconds} seconds per participant.` : 'Slowmode disabled.') }, 'Set bot-enforced per-participant slowmode.'),
    adminCommand('delete', [], async ({ sock, message, reply }) => { await requireAdmin(sock, message, config); const quoted = getQuoted(message); if (!quoted) throw new UserFacingError('Reply to a message to delete it.'); await sock.sendMessage(message.key.remoteJid, { delete: quoted.key }); await reply('Message deleted.') }, 'Delete a replied-to message.'),
    adminCommand('clear', [], async ({ sock, message, reply }) => { await requireAdmin(sock, message, config); const quoted = getQuoted(message); if (!quoted) throw new UserFacingError('For safety, reply to exactly one message with .clear.'); await sock.sendMessage(message.key.remoteJid, { delete: quoted.key }); await reply('The replied-to message was cleared. Bulk clearing is intentionally disabled.') }, 'Safely clear one replied-to message; bulk deletion is disabled.'),
    adminCommand('disablecmd', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const name = args[0]?.toLowerCase(); const target = allCommands.find(command => command.name === name); if (!target || ['enablecmd', 'disablecmd'].includes(name)) throw new UserFacingError('Choose an existing command other than the command-control commands.'); const disabled = new Set(settings.get(message.key.remoteJid).disabledCommands || []); disabled.add(name); await settings.set(message.key.remoteJid, { disabledCommands: [...disabled] }); await reply(`${config.prefix}${name} is disabled in this group.`) }, 'Disable one command in this group.'),
    adminCommand('enablecmd', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const name = args[0]?.toLowerCase(); const disabled = settings.get(message.key.remoteJid).disabledCommands || []; await settings.set(message.key.remoteJid, { disabledCommands: disabled.filter(item => item !== name) }); await reply(`${config.prefix}${name || 'command'} is enabled in this group.`) }, 'Re-enable a command in this group.'),
    adminCommand('setname', [], async ({ sock, message, args, reply }) => { const metadata = await requireAdmin(sock, message, config); if (!botIsAdmin(metadata, sock)) throw new UserFacingError('The bot must be a group administrator.'); const subject = args.join(' ').trim(); if (!subject || subject.length > 100) throw new UserFacingError(`${usage('setname New Group Name')}`); await sock.groupUpdateSubject(message.key.remoteJid, subject); await reply(`Group name updated to: ${subject}`) }, 'Change the group subject.'),
    adminCommand('setdescription', [], async ({ sock, message, args, reply }) => { const metadata = await requireAdmin(sock, message, config); if (!botIsAdmin(metadata, sock)) throw new UserFacingError('The bot must be a group administrator.'); const description = args.join(' ').trim(); if (description.length > 2000) throw new UserFacingError('The group description is too long.'); await sock.groupUpdateDescription(message.key.remoteJid, description); await reply('Group description updated.') }, 'Change the group description.'),
    adminCommand('invite', [], async ({ sock, message, reply }) => { const metadata = await requireAdmin(sock, message, config); if (!botIsAdmin(metadata, sock)) throw new UserFacingError('The bot must be a group administrator.'); const code = await sock.groupInviteCode(message.key.remoteJid); if (!code) throw new UserFacingError('WhatsApp did not return an invite code.'); await reply(`Group invite link:\nhttps://chat.whatsapp.com/${code}`) }, 'Get the group invite link.'),
    adminCommand('revokeinvite', [], async ({ sock, message, reply }) => { const metadata = await requireAdmin(sock, message, config); if (!botIsAdmin(metadata, sock)) throw new UserFacingError('The bot must be a group administrator.'); const code = await sock.groupRevokeInvite(message.key.remoteJid); if (!code) throw new UserFacingError('WhatsApp did not return a replacement invite code.'); await reply(`Old invite revoked. New group invite link:\nhttps://chat.whatsapp.com/${code}`) }, 'Revoke the old invite link and return a new one.'),
    adminCommand('joinrequest', [], async ({ sock, message, args, reply }) => { const metadata = await requireAdmin(sock, message, config); if (!botIsAdmin(metadata, sock)) throw new UserFacingError('The bot must be a group administrator.'); const action = args[0]?.toLowerCase(); if (!['approve', 'reject'].includes(action)) throw new UserFacingError(`${usage('joinrequest approve|reject')}`); const requests = await sock.groupRequestParticipantsList(message.key.remoteJid); const targets = requests.map(request => request.jid || request.id || request.requester).filter(Boolean); if (!targets.length) return reply('There are no pending join requests.'); const results = await sock.groupRequestParticipantsUpdate(message.key.remoteJid, targets, action); await reply(`${action === 'approve' ? 'Approved' : 'Rejected'} ${results.length} join request(s).`) }, 'Approve or reject all pending join requests.'),
    ...['kick', 'promote', 'demote'].map(action => adminCommand(action, [], async ({ sock, message, args, reply }) => { const m = await requireAdmin(sock, message, config); if (!botIsAdmin(m, sock)) throw new UserFacingError('The bot must be a group administrator.'); const target = targetOrThrow(message, args); if (sameJid(target, sock.user?.id)) throw new UserFacingError('The bot cannot target itself.'); await sock.groupParticipantsUpdate(message.key.remoteJid, [target], action === 'kick' ? 'remove' : action); await reply(`${action} succeeded for ${participantMention(target)}.`) }, `${action[0].toUpperCase()}${action.slice(1)} a participant.`)),
    adminCommand('group', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); if (!botIsAdmin(await sock.groupMetadata(message.key.remoteJid), sock)) throw new UserFacingError('The bot must be a group administrator.'); const mode = args[0]?.toLowerCase(); if (mode === 'link') { const code = await sock.groupInviteCode(message.key.remoteJid); if (!code) throw new UserFacingError('WhatsApp did not return an invite code.'); return reply(`Group invite link:\nhttps://chat.whatsapp.com/${code}`) } if (!['open', 'close'].includes(mode)) throw new UserFacingError(`${usage('group open|close|link')}`); await sock.groupSettingUpdate(message.key.remoteJid, mode === 'close' ? 'announcement' : 'not_announcement'); await reply(`Group is now ${mode}.`) }, 'Open, close, or show the group link.'),
    adminCommand('setwelcome', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const mode = args[0]?.toLowerCase(); if (!['on', 'off'].includes(mode)) throw new UserFacingError(`${usage('setwelcome on|off')}`); await settings.set(message.key.remoteJid, { welcome: mode === 'on' }); await reply(`Welcome messages are now ${mode}.`) }, 'Enable or disable welcome messages.'),
    { name: 'greet', aliases: [], description: 'Send a simple group greeting.', category: 'Group Administration', groupOnly: true, async run({ args, reply }) { const audience = args.join(' ').trim(); await reply(audience ? `Welcome ${audience}! Stay strong and enjoy the adventure.` : 'Welcome everyone! Stay strong and enjoy the adventure.') } },
    adminCommand('setgoodbye', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const mode = args[0]?.toLowerCase(); if (!['on', 'off'].includes(mode)) throw new UserFacingError(`${usage('setgoodbye on|off')}`); await settings.set(message.key.remoteJid, { goodbye: mode === 'on' }); await reply(`Goodbye messages are now ${mode}.`) }, 'Enable or disable goodbye messages.'),
    adminCommand('setrules', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); if (!args.length) throw new UserFacingError(usage('setrules text')); await settings.set(message.key.remoteJid, { rules: args.join(' ').slice(0, 2000) }); await reply('Group rules updated.') }, 'Configure group rules.'),
    adminCommand('warn', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const target = targetOrThrow(message, args); if (sameJid(target, messageSender(message, sock)) || sameJid(target, sock.user?.id)) throw new UserFacingError('The sender and bot cannot be warned.'); const reason = args.filter(a => !/^@\S+$/.test(a)).join(' ').trim().slice(0, 500) || 'No reason provided'; await warnings.update(all => { const key = `${message.key.remoteJid}:${target}`; return { ...all, [key]: { count: Math.min((all[key]?.count || 0) + 1, 10), lastReason: reason, updatedAt: new Date().toISOString() } } }); const record = warnings.get()[`${message.key.remoteJid}:${target}`]; await reply(`${participantMention(target)} warned (${record.count}/10). Reason: ${reason}`) }, 'Issue a capped warning with a cleaned reason.'),
    { name: 'warnings', aliases: [], description: 'Show warning count.', category: 'Security & Moderation', groupOnly: true, async run({ sock, message, args, reply }) { await requireGroup(sock, message); const target = targetOrThrow(message, args); await reply(`${participantMention(target)} has ${(warnings.get()[`${message.key.remoteJid}:${target}`]?.count || 0)} warning(s).`) } },
    adminCommand('resetwarnings', [], async ({ sock, message, args, reply }) => { await requireAdmin(sock, message, config); const target = targetOrThrow(message, args); await warnings.update(all => { const next = { ...all }; delete next[`${message.key.remoteJid}:${target}`]; return next }); await reply('Warnings reset.') }, 'Reset a participant warning count.')
  ]
  const allCommands = [...general, ...admin]
  return { allCommands, sudo, lookup(name) { return allCommands.find(c => c.name === name || c.aliases.includes(name)) } }
}
