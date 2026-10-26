# Secure WhatsApp Bot (Baileys 7.0.0-rc14)

A lightweight modular WhatsApp bot using exactly `@whiskeysockets/baileys@7.0.0-rc14`, Node.js 20+, and ES modules. It is intended for a small personal/community deployment, not bulk messaging or mass automation.

## Prerequisites and installation

Install Node.js 20 or later. From this directory:

```bash
cp .env.example .env
npm install
npm test
npm run check
npm start
```

The first start prints a QR code in the terminal. In WhatsApp, open **Settings > Linked devices > Link a device** and scan it. Keep `data/auth/` private: possession of that directory can allow control of the linked WhatsApp account. The optional `PAIRING_NUMBER` setting accepts digits only and uses rc14's `requestPairingCode`; keep the resulting code private.

Set `OWNER_NAME`, `OWNER_NUMBER` (digits with country code, no `+`), `BOT_PREFIX`, and other values in `.env`. Never commit `.env`, `data/auth/`, or JSON state files. The multi-file auth helper is convenient for modest deployments but is not an ideal high-concurrency production database; the connection module isolates it so a stronger persistence layer can replace it later.

## Authorization and commands

Recognized commands are restricted by default. The configured owner is always authorized. Other participants must be added to the persistent sudo allowlist by the owner. Use a participant mention from the owner's account:

```text
.addsudo @user
.delsudo @user
.sudos
```

`.addsudo`, `.delsudo`, and `.sudos` are owner-only. `.delsudo` revokes that participant's bot access immediately and the list is stored in `data/sudo.json`. The owner identity is based on the authenticated Baileys account for `fromMe` messages; it is not possible for an ordinary participant to forge that flag through message text. Group moderation commands still require the sender to be a WhatsApp group administrator, and the bot must have the required group privilege.

Unauthorized recognized commands are intentionally ignored without a reply. This keeps groups quiet and does not reveal whether a command or authorization exists. Denied attempts are counted in `.stats` for the owner.

General commands: `.ping`, `.alive`, `.menu`, `.owner`, `.help [command]`, `.info`, `.runtime`, `.groupinfo`, `.admins`, `.rules`, `.support`, and `.quote`.

Group administration commands: `.tagall [message]`, `.hidetag [message]`, `.antilink on|off`, `.delete` (reply to a message), `.kick @user`, `.promote @user`, `.demote @user`, `.group open|close`, `.setwelcome on|off`, `.setgoodbye on|off`, `.setrules text`, `.warn @user [reason]`, `.warnings @user`, and `.resetwarnings @user`.

Additional group commands are `.setname New Group Name`, `.setdescription Group description`, `.invite`, `.revokeinvite`, `.joinrequest approve|reject`, and `.group link`. These require group-admin authorization and the bot must have the corresponding WhatsApp administrator privilege.

Media commands operate on a replied-to message: `.sticker` converts an image/video, `.toimage` converts a sticker, `.tomp3` converts audio/video, and `.media` re-sends the original media type. Shadow validates FFmpeg by executing it from the Node process with `-version`; it checks `FFMPEG_PATH`, normal Windows `ffmpeg.exe` lookup, and Windows `where.exe`/`cmd.exe` absolute-path discovery. If FFmpeg or PATH was changed while Shadow was running, restart Shadow. You can also set `FFMPEG_PATH` in `.env` to the full path of `ffmpeg.exe`. Failures are reported without crashing the bot.

Anti-delete is disabled by default per group. A group administrator can use `.antidelete on` or `.antidelete off`. While enabled, Shadow keeps a bounded in-memory cache of recent messages for up to 24 hours, detects deletion events, notifies the group, and attempts to resend deleted text and downloadable media. Recovered text uses the sender display name and Shadow format, including `Shadow: ♠️ Shadow sees all...` and a `**Recovered message:**` section. To also send a copy to a private log chat or separate group, set `ANTIDELETE_LOG_JID` in `.env` to a valid WhatsApp JID and restart Shadow. Deleted messages that arrived before Shadow started, expired from the cache, or cannot be downloaded cannot be recovered.

Utility commands are `.weather city`, `.translate language text`, `.calculate expression`, `.define word`, `.shortlink https://example.com`, and `.qr text`. `.translate` also works by replying to text or an image/video caption with `.translate` for automatic source detection and English output, or `.translate French` for French output. Source detection runs before translation, then the existing MyMemory provider receives a valid ISO pair such as `ja|en`; replied translations show the original and translated text separately. `.define` uses Dictionary API first and falls back to Datamuse if the primary service is unavailable. Weather, translation, dictionary, and URL-shortening results use public web services and may be unavailable or rate-limited. `.calculate` uses a restricted arithmetic parser and never evaluates arbitrary JavaScript.

Downloader commands use the official `yt-dlp` executable through Node's argument-safe `execFile`: `.yta YouTube URL`, `.ytv YouTube URL`, `.tiktok URL`, `.insta URL`, `.fb URL`, and `.twitter URL`. `.play search terms` displays up to five results; reply with `.play 1` through `.play 5` to select one. Search sessions are bound to the requesting chat and sender and expire after five minutes. Downloads are limited to 50 MB by default, one concurrent job, and three minutes per provider operation. Public content only is supported; private content, DRM, paywalls, login cookies, and authentication bypasses are not supported.

Install the official standalone `yt-dlp.exe` on Windows and either place it on PATH or set `YTDLP_PATH` in `.env` to its full path. FFmpeg is required for `.yta` and for formats that need merging. Example configuration: `YTDLP_PATH=C:\\Tools\\yt-dlp.exe`, `DOWNLOADER_TIMEOUT_MS=180000`, `DOWNLOADER_MAX_BYTES=52428800`, and `DOWNLOADER_CONCURRENCY=1`. Restart Shadow after installing or changing PATH. This phase was unit-tested with a mocked executable runner; no live platform download is claimed until yt-dlp is installed and each platform is tested on the active Windows copy.

Phase 2 moderation commands include `.mute @user`, `.unmute @user`, `.slowmode seconds` (use `0` to disable), and `.clear` when replying to exactly one message. Mute, slowmode, and clear are bot-enforced and require the bot to be a group administrator. Bulk clearing is intentionally disabled.

Owner diagnostics include `.stats`, `.reload`, and guarded `.broadcast CONFIRM message`. Broadcast is disabled unless `BROADCAST_GROUPS` contains up to ten explicitly configured group JIDs; it never discovers or broadcasts to arbitrary chats. Group administrators can use `.disablecmd command` and `.enablecmd command` to control commands for their group. The owner remains able to use disabled commands.

Administration commands require a group administrator, and the bot must itself be an administrator for participant changes, group settings, or deletion. The configured owner is accepted for administration authorization, but WhatsApp still enforces actual bot privileges. Targets must be mentioned or supplied as valid JIDs. `.tagall` is capped by `MAX_TAGALL` and excludes the bot by default. Anti-link protects WhatsApp invitation links when enabled; ordinary URLs are untouched unless `antiLinkAllUrls` is configured in the settings JSON.

## Recovery and troubleshooting

If WhatsApp logs the account out, stop the bot, remove only `data/auth/` after confirming you no longer need that session, then start again and relink. Do not delete authentication state during ordinary reconnects. If JSON state is corrupted, back it up first, then remove the affected `data/group-settings.json` or `data/warnings.json` and restart. A permanent logout does not enter a reconnect loop.

Welcome and goodbye settings are persisted per group in `data/group-settings.json`; warnings are stored in `data/warnings.json`. Both files are local JSON and should be backed up only with the same access controls as the auth directory. Baileys v7 uses LID-aware identities, so the bot prefers participant `id` values and does not rely on display names or phone-number-only assumptions.

## Limitations

This initial version has no database, dashboard, rate-limit service, or multi-process coordination. Duplicate prevention is process-local. WhatsApp permissions and server-side behavior can still reject an operation; the bot reports the error rather than claiming success. Test with a secondary account and comply with WhatsApp's terms.
