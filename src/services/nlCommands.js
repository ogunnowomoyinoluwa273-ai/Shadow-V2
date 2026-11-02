import { getMentions, getQuotedMessageInfo } from '../utils/message.js'
import { jidWithoutDevice } from '../utils/jid.js'

// Natural-language routing for SHADOW's existing commands ("Shadow, tag everyone" -> .tagall).
//
// Design rules:
//  * This module only DECIDES which registered command to run and with which arguments. It never runs anything itself.
//    The message handler turns the decision into the equivalent dot-command and sends it through the normal dispatcher,
//    so owner / sudo / admin / group-only / disabled-command checks are exactly the ones typed commands already get.
//  * Candidates come from the live command registry (name, aliases) plus the phrasing below. A command that has no entry
//    here is still reachable by its name or alias, and is treated as sensitive if it is group-only or owner-only.
//  * Natural-language commands are dispatched immediately, just like typed dot-commands. The normal dispatcher remains
//    responsible for owner, sudo, admin, group-only, disabled-command, and other authorization checks.

// ---------------------------------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------------------------------

const stem = word => word.length > 4 && word.endsWith('ed') ? word.slice(0, -2) : (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)
const clip = (value, size) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, size)
const FILLER = /^(?:(?:hey|hi|hello|yo|ok|okay|so|now|please|pls|kindly|just|then|and)[\s,]+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like|wish)\s+you\s+to\s+|go\s+ahead\s+and\s+|you\s+should\s+|i\s+(?:want|need|would\s+like)\s+to\s+)?(?:(?:please|pls|kindly|just)[\s,]+)*/i
const INFO_OPENER = /^(?:how\s+(?:do|can|should|would|could)\s+(?:i|we|you)\b|how\s+to\b|why\b|explain\b|what\s+(?:does|do|is)\s+(?:a|an|the)?\s*(?:meaning|difference)\b)/i

export function parseAddress(text) {
  const match = String(text || '').match(/^\s*(?:hey\s+|yo\s+|ok\s+)?shadow\b[\s,:;!.\-]*([\s\S]*)$/i)
  return match ? match[1].trim() : null
}

function tokenize(text) {
  const out = []
  String(text || '').split(/\s+/).filter(Boolean).forEach((word, w) => {
    if (word.startsWith('@')) return
    let base = word.toLowerCase().replace(/[’']/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (!base) return
    const expand = { whats: ['what', 'is'], hows: ['how', 'is'], whos: ['who', 'is'], wheres: ['where', 'is'], thats: ['that', 'is'] }[base]
    const parts = expand || base.split(/[-_/]+/).filter(Boolean)
    for (const part of parts) out.push({ t: stem(part), raw: part, w })
  })
  return out
}
const compilePhrase = phrase => tokenize(phrase).map(token => token.t)

function findPhrase(tokens, phrase, { maxGap = 3, maxStart = 6 } = {}) {
  for (let i = 0; i < tokens.length && i <= maxStart; i += 1) {
    if (tokens[i].t !== phrase[0]) continue
    let at = i; let ok = true
    for (let k = 1; k < phrase.length && ok; k += 1) {
      let found = -1
      for (let j = at + 1; j <= at + 1 + maxGap && j < tokens.length; j += 1) if (tokens[j].t === phrase[k]) { found = j; break }
      if (found < 0) ok = false; else at = found
    }
    if (ok) return { start: i, end: at }
  }
  return null
}

const wordsAfter = (original, wordIndex) => original.split(/\s+/).filter(Boolean).slice(wordIndex + 1).join(' ')
function cleanRemainder(value) {
  let text = String(value || '').trim()
  for (let i = 0; i < 4; i += 1) {
    const next = text.replace(/^(?:to|as|into|in|for|at|of|on|about|called|named|saying|that|says|is|are|me|my|the|a|an|this|these|them|with|using|from|up|like|:|-)(?=$|[\s:,-])[\s:,-]*/i, '')
    if (next === text) break
    text = next
  }
  return text.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim()
}
const trimQuery = value => String(value || '').replace(/[\s.?!,;:]+$/, '').trim()
const firstUrl = value => String(value || '').match(/https?:\/\/[^\s<>"')]+/i)?.[0] || ''

// ---------------------------------------------------------------------------------------------------------------------
// Phrase catalog. `say` are natural ways of asking for the command, `args` selects the argument extractor, `sensitive`
// requires confirmation, `q` allows question forms ("how long have you been running"), `not` vetoes on a word.
// ---------------------------------------------------------------------------------------------------------------------

const c = (args, say, extra = {}) => ({ args, say, ...extra })
export const NL_CATALOG = {
  // Owner tools
  aimodel: c('status', ['ai model', 'which ai model', 'which model', 'what model', 'model status', 'what ai'], { q: true, sensitive: false }),
  addsudo: c('target', ['add sudo', 'make sudo', 'give sudo', 'grant sudo', 'authorize', 'authorise', 'sudo access'], { sensitive: true, ask: 'Who should get sudo access? Tag them or reply to their message.' }),
  delsudo: c('target', ['remove sudo', 'revoke sudo', 'delete sudo', 'take sudo', 'revoke access', 'unauthorize', 'unauthorise'], { sensitive: true, ask: 'Whose sudo access should I remove? Tag them or reply to their message.' }),
  sudos: c('none', ['list sudo', 'show sudo', 'who sudo', 'sudo user', 'sudo list', 'authorized user'], { q: true, sensitive: false }),
  stats: c('none', ['stats', 'statistic', 'diagnostic', 'bot stats'], { q: true, sensitive: false }),
  reload: c('none', ['reload', 'reload settings', 'reload data', 'refresh settings'], { sensitive: true }),
  broadcast: c('broadcast', ['broadcast', 'send broadcast', 'announce to all groups', 'send announcement to groups'], { sensitive: true }),
  // Media
  sticker: c('quote', ['make sticker', 'create sticker', 'turn into sticker', 'convert to sticker', 'convert into sticker', 'sticker'], { ask: 'Reply to the image or video you want as a sticker.' }),
  toimage: c('quote', ['convert sticker to image', 'turn sticker into image', 'sticker to image', 'convert to image', 'turn into image', 'make image', 'to image'], { ask: 'Reply to the sticker you want as an image.' }),
  tomp3: c('quote', ['convert to mp3', 'turn into mp3', 'extract audio', 'make mp3', 'to mp3', 'get audio', 'convert audio to mp3'], { ask: 'Reply to the audio or video you want as MP3.' }),
  media: c('quote', ['resend media', 'send media again', 'resend this', 'media'], { ask: 'Reply to the media you want re-sent.' }),
  // Utility
  weather: c('query', ['weather', 'forecast', 'temperature in'], { q: true, ask: 'Which city should I check the weather for?' }),
  time: c('none', ['what time is it', 'current time', 'local time', 'clock'], { q: true, sensitive: false }),
  date: c('none', ['what date is it', 'todays date', "today's date", 'current date', 'what day is it'], { q: true, sensitive: false }),
  calendar: c('none', ['calendar', 'my events', 'upcoming events', 'upcoming appointments', 'my reminders'], { q: true, sensitive: false }),
  addcalendar: c('query', ['add calendar event', 'add event', 'schedule event', 'schedule a reminder', 'set a reminder', 'remind me'], { ask: 'What should I add, and for what date and time?' }),
  delcalendar: c('query', ['cancel calendar event', 'cancel event', 'cancel reminder', 'delete calendar event', 'remove calendar event'], { ask: 'Which calendar event short id should I cancel?' }),
  calculate: c('calc', ['calculate', 'compute', 'evaluate', 'work out', 'solve'], { q: true, ask: 'What should I calculate?' }),
  define: c('define', ['define', 'definition of', 'meaning of', 'dictionary'], { q: true, ask: 'Which word should I define?' }),
  shortlink: c('url', ['shorten link', 'shorten url', 'short link', 'shorten this', 'shorten', 'make link shorter'], { ask: 'Which link should I shorten?' }),
  qr: c('query', ['qr code', 'make qr', 'generate qr', 'create qr', 'qr'], { ask: 'What should the QR code contain?' }),
  translate: c('translate', ['translate', 'translation', 'how do you say', 'say in'], { q: true }),
  lyrics: c('query', ['find lyrics', 'song lyrics', 'lyrics for', 'lyrics of', 'get lyrics', 'show lyrics', 'what are the lyrics to', 'lyrics'], { q: true, ask: 'Which song? Give me the title and artist.' }),
  // Downloaders
  yta: c('mediaLink', ['download youtube audio', 'youtube audio', 'youtube to mp3', 'yta', 'get youtube audio'], { ask: 'Send me the YouTube link, or reply to a message that contains it.' }),
  ytv: c('mediaLink', ['download youtube video', 'youtube video', 'ytv', 'get youtube video'], { ask: 'Send me the YouTube link, or reply to a message that contains it.' }),
  play: c('play', ['play', 'play song', 'play music', 'play audio'], { ask: 'What should I play? Give me a song name or a link.' }),
  tiktok: c('url', ['download tiktok', 'tiktok video', 'tiktok'], { ask: 'Send me the TikTok link, or reply to a message that contains it.' }),
  insta: c('url', ['download instagram', 'instagram video', 'instagram reel', 'instagram', 'insta'], { ask: 'Send me the Instagram link, or reply to a message that contains it.' }),
  fb: c('url', ['download facebook', 'facebook video', 'facebook', 'fb'], { ask: 'Send me the Facebook link, or reply to a message that contains it.' }),
  twitter: c('url', ['download twitter', 'twitter video', 'download x video', 'tweet video', 'twitter'], { ask: 'Send me the X/Twitter link, or reply to a message that contains it.' }),
  // Anime
  anime: c('query', ['search anime', 'find anime', 'look up anime', 'anime info', 'anime called', 'anime'], { ask: 'Which anime should I look up?' }),
  manga: c('query', ['search manga', 'find manga', 'look up manga', 'manga'], { ask: 'Which manga should I look up?' }),
  character: c('query', ['search character', 'anime character', 'find character', 'who is character', 'character'], { ask: 'Which character should I look up?' }),
  seasonal: c('page', ['seasonal anime', 'anime this season', 'airing this season', 'current season', 'airing now', 'seasonal'], { q: true }),
  animesong: c('query', ['anime song', 'anime opening', 'anime ending', 'anime theme', 'download anime opening'], { ask: 'Which anime song should I get?' }),
  waifu: c('none', ['random waifu', 'send waifu', 'waifu', 'anime girl']),
  neko: c('none', ['random neko', 'send neko', 'neko', 'catgirl', 'random anime image']),
  animequote: c('none', ['anime quote', 'random anime quote', 'quote from anime'], { q: true }),
  animegenre: c('genre', ['anime genre', 'genre', 'list anime genre', 'best anime in', 'top anime in'], { ask: 'Which genre?' }),
  animepopular: c('none', ['popular anime', 'trending anime', 'currently popular', 'top anime'], { q: true }),
  hug: c('targetOpt', ['hug', 'give hug', 'send hug'], { q: true }), slap: c('targetOpt', ['slap'], { q: true }), kiss: c('targetOpt', ['kiss'], { q: true }), pat: c('targetOpt', ['pat', 'headpat'], { q: true }),
  bonk: c('targetOpt', ['bonk'], { q: true }), cry: c('targetOpt', ['cry'], { q: true }), bite: c('targetOpt', ['bite'], { q: true }),
  hmph: c('none', ['hmph', 'be tsundere', 'tsundere line', 'act tsundere', 'say something tsundere']),
  anibattle: c('battle', ['compare', 'who wins', 'battle', 'versus'], { ask: 'Which two characters should I compare?' }),
  animequiz: c('quiz', ['anime quiz', 'start quiz', 'anime trivia', 'trivia', 'quiz me', 'quiz'], { q: true }),
  recommend: c('queryOpt', ['recommend anime', 'recommend', 'suggest anime', 'anime recommendation', 'what should i watch', 'suggest something to watch'], { q: true }),
  // Information
  ping: c('none', ['ping', 'latency', 'response time', 'speed test', 'how fast'], { q: true }),
  alive: c('none', ['alive', 'are you alive', 'are you online', 'are you there', 'are you up', 'are you awake', 'online status'], { q: true }),
  runtime: c('none', ['runtime', 'uptime', 'how long running', 'how long online', 'how long up'], { q: true }),
  info: c('none', ['bot info', 'info', 'information', 'about you', 'about the bot', 'about yourself', 'who are you']),
  owner: c('none', ['owner', 'who own', 'who made you', 'who created you', 'your creator', 'owner details'], { q: true, sensitive: false }),
  menu: c('none', ['menu', 'show menu', 'your command', 'command list', 'list command', 'what can you do', 'command center', 'show command'], { q: true }),
  help: c('cmdOpt', ['help', 'how to use', 'usage of', 'help with', 'how do i use'], { q: true }),
  quote: c('none', ['quote', 'random quote', 'send quote', 'a quote', 'quote of the day', 'inspire me'], { q: true }),
  groupinfo: c('none', ['group info', 'group information', 'about this group', 'group detail', 'group metadata', 'info about the group'], { q: true, sensitive: false }),
  admins: c('none', ['admin', 'who are the admin', 'list admin', 'show admin', 'group admin', 'who is admin'], { q: true, sensitive: false }),
  rules: c('none', ['rule', 'group rule', 'show rule', 'tell me the rule', 'what are the rule', 'read the rule'], { q: true, sensitive: false }),
  support: c('none', ['support', 'support contact', 'contact support'], { q: true }),
  // Group administration
  tagall: c('textOpt', ['tag all', 'tagall', 'tag everyone', 'mention everyone', 'mention all', 'ping everyone', 'call everyone', 'tag everybody', 'tag all member'], { sensitive: true }),
  hidetag: c('textOpt', ['hidetag', 'hide tag', 'hidden tag', 'silently tag', 'tag silently', 'tag everyone silently', 'ping everyone silently', 'invisible tag'], { sensitive: true }),
  delete: c('quote', ['delete this', 'delete message', 'delete that', 'remove this message', 'remove message', 'delete the message'], { sensitive: true, ask: 'Reply to the message you want deleted.' }),
  disablecmd: c('cmdName', ['disable command', 'turn off command', 'block command', 'disable the command'], { sensitive: true, ask: 'Which command should I disable?' }),
  enablecmd: c('cmdName', ['enable command', 'turn on command', 'unblock command', 're enable command', 'allow command', 'enable the command'], { sensitive: true, ask: 'Which command should I enable?' }),
  setname: c('text', ['change group name', 'rename group', 'set group name', 'change the name of the group', 'rename this group', 'set subject', 'change subject'], { sensitive: true, ask: 'What should the new group name be?' }),
  setdescription: c('text', ['change group description', 'set group description', 'update group description', 'set description', 'change description', 'update description'], { sensitive: true, ask: 'What should the new group description say?' }),
  invite: c('none', ['invite link', 'group invite', 'get invite', 'share invite link', 'group link', 'link to the group'], { sensitive: false }),
  revokeinvite: c('none', ['revoke invite', 'reset invite link', 'new invite link', 'revoke link', 'reset group link', 'regenerate invite', 'change invite link'], { sensitive: true }),
  joinrequest: c('joinChoice', ['join request', 'pending request', 'approve request', 'reject request', 'accept request', 'decline request'], { sensitive: true, ask: 'Should I approve or reject the pending join requests?' }),
  kick: c('target', ['kick', 'kick out', 'remove member', 'remove user', 'remove this person', 'remove from group', 'throw out', 'remove him', 'remove her', 'remove them', 'get rid of'], { sensitive: true, not: ['admin'], ask: 'Who should I remove? Tag them or reply to their message.' }),
  promote: c('target', ['promote', 'make admin', 'give admin', 'grant admin', 'admin right', 'add as admin'], { sensitive: true, ask: 'Who should I promote? Tag them or reply to their message.' }),
  demote: c('target', ['demote', 'remove admin', 'revoke admin', 'take admin', 'strip admin', 'dismiss admin'], { sensitive: true, ask: 'Who should I demote? Tag them or reply to their message.' }),
  group: c('groupChoice', ['open group', 'close group', 'lock group', 'unlock group', 'mute group', 'open the chat', 'close the chat', 'reopen group'], { sensitive: true, ask: 'Should I open or close the group?' }),
  greet: c('textOpt', ['greet', 'welcome everyone', 'say hello to', 'say hi to', 'greet everyone', 'greet the group'], { sensitive: false }),
  // Security & moderation
  antilink: c('toggle', ['anti link', 'antilink', 'link protection', 'invite link protection', 'block link', 'link blocker', 'delete link'], { sensitive: true, ask: 'Should anti-link be on or off?' }),
  antidelete: c('toggle', ['anti delete', 'antidelete', 'anti-delete', 'turn on antidelete', 'turn off antidelete', 'enable antidelete', 'disable antidelete', 'recover deleted message', 'deleted message recovery', 'undelete', 'show deleted message', 'delete protection', 'notify me about deleted messages', 'notifying me about deleted messages'], { sensitive: false, ask: 'Should anti-delete be on or off?' }),
  mute: c('target', ['mute', 'silence', 'mute user', 'mute member'], { sensitive: true, ask: 'Who should I mute? Tag them or reply to their message.' }),
  unmute: c('target', ['unmute', 'unsilence', 'allow to speak', 'let talk'], { sensitive: true, ask: 'Who should I unmute? Tag them or reply to their message.' }),
  slowmode: c('seconds', ['slowmode', 'slow mode', 'slow down chat', 'slow the chat', 'limit message'], { sensitive: true, ask: 'How many seconds between messages? (0 turns slowmode off)' }),
  clear: c('quote', ['clear this', 'clear message', 'clear that', 'clear the message'], { sensitive: true, ask: 'Reply to the message you want cleared.' }),
  warn: c('targetReason', ['warn', 'give warning', 'issue warning', 'send a warning to'], { sensitive: true, ask: 'Who should I warn? Tag them or reply to their message.' }),
  warnings: c('target', ['warnings', 'how many warning', 'check warning', 'show warning', 'warning count'], { q: true, sensitive: false, ask: 'Whose warnings should I check? Tag them or reply to their message.' }),
  resetwarnings: c('target', ['reset warning', 'clear warning', 'remove warning', 'wipe warning', 'reset warning count'], { sensitive: true, ask: 'Whose warnings should I reset? Tag them or reply to their message.' }),
  setwelcome: c('toggle', ['welcome message', 'welcome', 'set welcome', 'greeting new member'], { sensitive: true, ask: 'Should welcome messages be on or off?' }),
  setgoodbye: c('toggle', ['goodbye message', 'goodbye', 'farewell', 'leave message', 'set goodbye'], { sensitive: true, ask: 'Should goodbye messages be on or off?' }),
  setrules: c('text', ['set rule', 'change rule', 'update rule', 'set group rule', 'change group rule', 'update group rule', 'new rule'], { sensitive: true, ask: 'What should the new rules say?' })
}

// ---------------------------------------------------------------------------------------------------------------------
// Argument extractors. Each returns { args } or { ask } (a short question when something is missing).
// ---------------------------------------------------------------------------------------------------------------------

const ON_WORDS = /\b(?:turn(?:ed)?\s+(?:it\s+)?on|switch(?:ed)?\s+(?:it\s+)?on|enable[ds]?|activate[ds]?|start|on)\b/i
const OFF_WORDS = /\b(?:turn(?:ed)?\s+(?:it\s+)?off|switch(?:ed)?\s+(?:it\s+)?off|disable[ds]?|deactivate[ds]?|stop|off)\b/i
const WORD_OPS = [[/\bmultiplied by\b|\btimes\b/g, '*'], [/\bdivided by\b|\bover\b/g, '/'], [/\bplus\b/g, '+'], [/\bminus\b/g, '-'], [/[×x](?=\s*\d)/g, '*'], [/÷/g, '/']]

function mathExpression(text) {
  let value = String(text || '').toLowerCase().replace(/[?=]+$/g, '').replace(/,/g, '')
  for (const [pattern, symbol] of WORD_OPS) value = value.replace(pattern, symbol)
  value = value.replace(/\s+/g, ' ').trim()
  return /^[\d\s.+\-*/^()%]+$/.test(value) && /\d/.test(value) && /[+\-*/^%]/.test(value) ? value.replace(/\^/g, '**') : ''
}

function targetFrom(ctx, original) {
  if (ctx.mentions?.[0]) return ctx.mentions[0]
  if (ctx.quoted?.participant) return ctx.quoted.participant
  const digits = original.match(/(?<![\d@])\+?(\d{8,15})(?!\d)/)
  return digits ? `${digits[1]}@s.whatsapp.net` : ''
}

const EXTRACT = {
  none: () => ({ args: [] }),
  status: () => ({ args: ['status'] }),
  quote: (ctx, entry) => ctx.hasQuote ? { args: [] } : { ask: entry.ask || 'Reply to the message you want me to use.' },
  target: (ctx, entry, original) => { const target = targetFrom(ctx, original); return target ? { args: [target] } : { ask: entry.ask || 'Who do you mean? Tag them or reply to their message.' } },
  targetOpt: (ctx, entry, original) => { const target = targetFrom(ctx, original); return { args: target ? [target] : [] } },
  targetReason: (ctx, entry, original, rest) => {
    const target = targetFrom(ctx, original); if (!target) return { ask: entry.ask }
    const reason = cleanRemainder(rest.replace(/@\S+/g, '').replace(/(?<![\d@])\+?\d{8,15}(?!\d)/g, '').replace(/\b(?:this|that|the)\s+(?:member|user|person|guy|girl|one)\b|\b(?:him|her|them|his|member|user|person)\b/gi, '').replace(/^\s*(?:for|because|since)\b\s*/i, '')).replace(/[.!?]+$/, '').trim()
    return { args: [target, ...(reason ? [clip(reason, 120)] : [])] }
  },
  toggle: (ctx, entry, original) => {
    const on = ON_WORDS.test(original); const off = OFF_WORDS.test(original)
    return on !== off ? { args: [on ? 'on' : 'off'] } : { ask: entry.ask }
  },
  groupChoice: (ctx, entry, original) => {
    const open = /\b(?:open|unlock|reopen|allow)\b/i.test(original); const close = /\b(?:close|lock|restrict|shut|mute)\b/i.test(original)
    return open !== close ? { args: [open ? 'open' : 'close'] } : { ask: entry.ask }
  },
  joinChoice: (ctx, entry, original) => {
    const approve = /\b(?:approve|accept|allow|let in)\b/i.test(original); const reject = /\b(?:reject|decline|deny|refuse)\b/i.test(original)
    return approve !== reject ? { args: [approve ? 'approve' : 'reject'] } : { ask: entry.ask }
  },
  seconds: (ctx, entry, original) => {
    if (/\b(?:off|disable|stop|remove|cancel)\b/i.test(original)) return { args: ['0'] }
    const match = original.match(/(\d+)\s*(seconds?|secs?|s\b|minutes?|mins?|m\b)?/i)
    if (!match) return { ask: entry.ask }
    const amount = Number(match[1]) * (/^m/i.test(match[2] || '') ? 60 : 1)
    return { args: [String(amount)] }
  },
  text: (ctx, entry, original, rest) => { const text = cleanRemainder(rest); return text ? { args: [clip(text, 2000)] } : { ask: entry.ask } },
  textOpt: (ctx, entry, original, rest) => {
    const said = rest.match(/(?:\bsay(?:ing)?\b|\bwith\s+(?:the\s+)?message\b|\bmessage\b|:)\s*(.+)$/i)?.[1]
    const text = cleanRemainder(said ?? rest).replace(/[.!?]+$/, '').trim()
    const generic = /^(?:(?:in|to|for)\s+)?(?:this|the|our)?\s*(?:group|chat|everyone|everybody|all|silently|members?)?$/i
    return { args: text && !generic.test(text) ? [clip(text, 500)] : [] }
  },
  query: (ctx, entry, original, rest) => { const text = trimQuery(cleanRemainder(rest)); return text ? { args: [clip(text, 300)] } : { ask: entry.ask } },
  queryOpt: (ctx, entry, original, rest) => { const text = trimQuery(cleanRemainder(rest)); return { args: text ? [clip(text, 300)] : [] } },
  url: (ctx, entry, original) => { const url = firstUrl(original) || firstUrl(ctx.quoted?.text); if (!url) return { ask: entry.ask }; return { args: [url, ...(/\b(?:hd|high\s+quality|1080p|720p)\b/i.test(original) ? ['hd'] : [])] } },
  mediaLink: (ctx, entry, original, rest) => { const url = firstUrl(original) || firstUrl(ctx.quoted?.text); const text = url || trimQuery(cleanRemainder(rest)); if (!text) return { ask: entry.ask }; return { args: [text, ...(/\b(?:hd|high\s+quality|320)\b/i.test(original) ? ['hd'] : [])] } },
  play: (ctx, entry, original, rest) => { const text = firstUrl(original) || trimQuery(cleanRemainder(rest.replace(/\b(?:hd|in high quality)\b/gi, ''))); if (!text) return { ask: entry.ask }; return { args: [text, ...(/\b(?:hd|high\s+quality)\b/i.test(original) ? ['hd'] : [])] } },
  page: (ctx, entry, original) => { const page = original.match(/\bpage\s+(\d{1,2})\b/i)?.[1]; return { args: page ? [page] : [] } },
  genre: (ctx, entry, original, rest) => {
    const named = original.match(/(?:popular|top|best|good)\s+([a-z][a-z-]+)\s+anime|anime\s+genre\s+(?:of\s+)?([a-z][a-z-]+)|(?:best|top|popular)\s+anime\s+in\s+(?:the\s+)?([a-z][a-z -]+)$/i)
    const text = trimQuery(named ? (named[1] || named[2] || named[3]) : cleanRemainder(rest))
    return text ? { args: [clip(text, 40).toLowerCase()] } : { ask: entry.ask }
  },
  battle: (ctx, entry, original, rest) => {
    const parts = trimQuery(cleanRemainder(rest)).split(/\s+(?:and|vs\.?|versus|against|with|or)\s+/i).map(part => part.trim()).filter(Boolean)
    return parts.length >= 2 ? { args: [`${parts[0]} vs ${parts[1]}`] } : { ask: entry.ask }
  },
  quiz: (ctx, entry, original) => { const answer = original.match(/\b(?:my\s+)?answer(?:\s+is)?\s+([a-d])\b/i)?.[1]; return { args: answer ? [answer.toLowerCase()] : [] } },
  calc: (ctx, entry, original, rest) => { const expression = mathExpression(cleanRemainder(rest)) || mathExpression(original.replace(/^.*?\b(?:calculate|compute|evaluate|solve|work out)\b/i, '')); return expression ? { args: [expression] } : { ask: entry.ask } },
  define: (ctx, entry, original, rest) => { const word = original.match(/what(?:'s|s| is| does)\s+(.+?)\s+mean\b/i)?.[1] || trimQuery(cleanRemainder(rest)); return word ? { args: [clip(word.replace(/^["']|["']$/g, ''), 60)] } : { ask: entry.ask } },
  translate: (ctx, entry, original, rest) => {
    const lang = '(?:to|into|in)\\s+([a-z]{2,20})\\s*$'
    const withText = original.match(new RegExp(`translate\\s+(?:the\\s+following\\s+)?["“]?(.+?)["”]?\\s+${lang}`, 'i')) || original.match(new RegExp(`how do you say\\s+["“]?(.+?)["”]?\\s+${lang}`, 'i'))
    if (withText && !/^(?:this|that|it|the message|the text)$/i.test(withText[1].trim())) return { args: [withText[2].toLowerCase(), ...withText[1].trim().split(/\s+/)] }
    const langOnly = original.match(new RegExp(`${lang}`, 'i'))
    if (langOnly && ctx.hasQuote) return { args: [langOnly[1].toLowerCase()] }
    if (ctx.hasQuote) return { args: [] }
    const text = cleanRemainder(rest)
    return text ? { args: ['english', ...text.split(/\s+/)] } : { ask: 'What should I translate, and into which language? You can also reply to a message.' }
  },
  broadcast: (ctx, entry, original, rest) => { const text = cleanRemainder(rest.replace(/^(?:saying|message|that says)\b[:\s]*/i, '')); return text ? { args: ['CONFIRM', clip(text, 1500)] } : { ask: 'What should the broadcast say?' } }
}

// ---------------------------------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------------------------------

const YES = /^(?:yes|yeah|yep|yup|sure|confirm(?:ed)?|do it|go ahead|proceed|ok(?:ay)?|affirmative)\b/i
const NO = /^(?:no|nope|cancel|stop|abort|never\s?mind|don'?t|do not)\b/i
const CONFIRM_TTL_MS = 2 * 60_000

export function contextFromMessage(message) {
  const quoted = getQuotedMessageInfo(message)
  return { mentions: getMentions(message) || [], quoted: quoted ? { participant: quoted.sender || '', text: quoted.text || '' } : null, hasQuote: Boolean(quoted) }
}

export function createNlRouter({ commands, now = () => Date.now() } = {}) {
  const pending = new Map()
  const all = () => commands?.allCommands || []

  function commandNameIn(original, exclude = []) {
    const known = new Map()
    for (const command of all()) for (const name of [command.name, ...(command.aliases || [])]) known.set(String(name).toLowerCase(), command.name)
    return original.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).map(word => known.get(word)).find(name => name && !exclude.includes(name)) || ''
  }
  const entryFor = command => NL_CATALOG[command.name] || { args: 'queryOpt', say: [], auto: true }
  const sensitiveFor = command => {
    const entry = NL_CATALOG[command.name]
    return typeof entry?.sensitive === 'boolean' ? entry.sensitive : Boolean(command.groupOnly || command.ownerOnly)
  }
  const cache = new Map()
  const compiled = command => {
    if (!cache.has(command)) {
      const entry = entryFor(command)
      const phrases = [...new Set([...(entry.say || []), command.name, ...(command.aliases || [])])].map(compilePhrase).filter(phrase => phrase.length)
      cache.set(command, { entry, phrases, not: (entry.not || []).map(stem) })
    }
    return cache.get(command)
  }

  function candidates(clean, tokens) {
    const found = []
    for (const command of all()) {
      const { entry, phrases, not } = compiled(command)
      if (not.some(word => tokens.some(token => token.t === word))) continue
      if (!entry.q && INFO_OPENER.test(clean)) continue
      let best = null
      for (const phrase of phrases) {
        const hit = findPhrase(tokens, phrase, { maxStart: phrase.length > 1 ? 4 : (entry.q ? 3 : 1) })
        if (!hit) continue
        const takesText = !['none', 'status', 'quote', 'targetOpt', 'toggle', 'groupChoice', 'joinChoice'].includes(entry.args)
        const limit = takesText ? 40 : phrase.length + (entry.args === 'targetOpt' ? 6 : 5)
        if (tokens.length > limit) continue
        const score = phrase.length * 10 + (phrase.length === tokens.length ? 5 : 0)
        if (!best || score > best.score || (score === best.score && hit.end > best.hit.end)) best = { command, score, hit }
      }
      if (best) found.push({ ...best, score: best.score - best.hit.start * 0.5 })
    }
    return found
  }

  function specialCandidates(clean) {
    const out = []
    const expression = clean.match(/^(?:what(?:'s|s| is)|how much is)\s+(.+?)\??$/i)?.[1]
    if (expression && mathExpression(expression)) { const command = commands.lookup?.('calculate'); if (command) out.push({ command, score: 70, hit: null, forced: { args: [mathExpression(expression)] } }) }
    const word = clean.match(/^what(?:'s|s| is| does)\s+(.+?)\s+mean\??$/i)?.[1] || clean.match(/^(?:what(?:'s|s| is) the )?(?:meaning|definition) of\s+(.+?)\??$/i)?.[1]
    if (word && word.split(/\s+/).length <= 4) { const command = commands.lookup?.('define'); if (command) out.push({ command, score: 65, hit: null, forced: { args: [clip(word.replace(/^["']|["']$/g, ''), 60)] } }) }
    const genre = clean.match(/\b(?:popular|top|best|good)\s+([a-z][a-z-]+)\s+anime\b/i)
    if (genre && genre[1].length >= 3 && !/^(?:anime|currently|new|the|some|any|this|that|right|now|today|these|those|all|and|for|with|from|about|here|there)$/i.test(genre[1])) { const command = commands.lookup?.('animegenre'); if (command) out.push({ command, score: 55, hit: null, forced: { args: [genre[1].toLowerCase()] } }) }
    return out
  }

  // Pure decision: what should Shadow do with this request? No side effects.
  function interpret(prompt, ctx = {}, { prefix = '.' } = {}) {
    const original = String(prompt || '').replace(FILLER, '').trim()
    if (!original) return { kind: 'none' }
    const tokens = tokenize(original)
    if (!tokens.length || tokens.length > 45) return { kind: 'none' }
    const found = [...specialCandidates(original), ...candidates(original, tokens)].sort((a, b) => b.score - a.score)
    if (!found.length) return { kind: 'none' }
    const top = found[0]
    const tied = found.filter(item => item.score === top.score && item.command !== top.command)
    if (tied.length) {
      const names = [top, ...tied].map(item => `${prefix}${item.command.name}`)
      return { kind: 'ask', reason: 'ambiguous', candidates: [top, ...tied].map(item => item.command.name), text: `Do you mean ${names.slice(0, -1).join(', ')} or ${names.at(-1)}? Say it a little more specifically.` }
    }
    const { command } = top
    const entry = entryFor(command)
    let outcome = top.forced
    if (!outcome && (entry.args === 'cmdName' || entry.args === 'cmdOpt')) {
      const found = commandNameIn(original, entry.args === 'cmdName' ? ['disablecmd', 'enablecmd'] : ['help'])
      outcome = found ? { args: [found] } : (entry.args === 'cmdName' ? { ask: entry.ask } : { args: [] })
    }
    if (!outcome) {
      const rest = top.hit ? wordsAfter(original, tokens[top.hit.end].w) : ''
      outcome = (EXTRACT[entry.args] || EXTRACT.queryOpt)(ctx, entry, original, rest)
    }
    if (outcome.ask) return { kind: 'ask', reason: 'missing', command: command.name, text: outcome.ask }
    const args = outcome.args || []
    return { kind: 'command', name: command.name, args, text: `${prefix}${command.name}${args.length ? ` ${args.join(' ')}` : ''}`, sensitive: sensitiveFor(command), curated: !entry.auto }
  }

  const describe = (decision, command) => {
    const target = decision.args.find(arg => /^\d{5,}@/.test(arg))
    const detail = target ? ` (target @${target.split('@')[0]})` : (decision.args.length ? ` (${clip(decision.args.join(' '), 80)})` : '')
    return `${command?.description?.replace(/\.$/, '') || decision.name}${detail}`
  }

  // Full handling for one addressed message: confirmations, clarification questions, or a command to run.
  function handle({ prompt, message, sender, jid, prefix = '.', precheck = () => null }) {
    const key = `${jid}:${jidWithoutDevice(sender)}`
    const waiting = pending.get(key)
    if (waiting && now() > waiting.expiresAt) pending.delete(key)
    const live = pending.get(key)
    const reply = String(prompt || '').replace(FILLER, '').trim()
    if (live && reply.split(/\s+/).length <= 6) {
      if (YES.test(reply)) { pending.delete(key); return { type: 'command', text: live.text, message: live.message } }
      if (NO.test(reply)) { pending.delete(key); return { type: 'reply', text: 'Cancelled. Nothing was changed.' } }
    }
    const decision = interpret(prompt, contextFromMessage(message), { prefix })
    if (decision.kind === 'ask') return { type: 'reply', text: decision.text }
    if (decision.kind !== 'command') return null
    // Do not add a second confirmation layer here. The normal command dispatcher enforces all permissions and settings.
    return { type: 'command', text: decision.text }
  }

  function coverage() {
    const names = all().map(command => command.name)
    const curated = names.filter(name => NL_CATALOG[name])
    return { total: names.length, curated: curated.length, auto: names.length - curated.length, autoNames: names.filter(name => !NL_CATALOG[name]), orphanCatalog: Object.keys(NL_CATALOG).filter(name => !names.includes(name)) }
  }

  return { interpret, handle, coverage, parseAddress, isSensitive: command => sensitiveFor(command), pendingCount: () => pending.size }
}
