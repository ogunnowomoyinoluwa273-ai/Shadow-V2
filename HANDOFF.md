# Handoff

## Stopping point

Phase 1 audit and repair are complete in the sandbox. All registered commands were audited: owner/diagnostics, media, web utilities, general commands, group metadata, administration, moderation, settings, warnings, welcome/goodbye, anti-delete, and downloader handling. The latest baseline reports 33 passing tests and successful syntax checks. Repairs include shared quoted-context extraction, document captions, wrapped media detection, event metrics wiring, correct promote/demote handling, calculator no-space coverage, translation source detection, Dictionary API fallback handling, Windows FFmpeg discovery, opt-in anti-delete recovery, the Baileys rc14 revoke-event path, and guarded yt-dlp downloader commands. Do not assume the latest archive has been installed or that live WhatsApp/provider behavior has been verified.

## Completed work

- Core modular bot implemented under `src/`.
- Exact dependency pinned to `@whiskeysockets/baileys@7.0.0-rc14`.
- Owner configuration was set in the user's local `.env` during the prior session; do not recreate or print secrets blindly.
- Owner self-command bug fixed by allowing explicit prefixed `fromMe` commands.
- Persistent sudo allowlist added through `src/services/sudo.js` and `data/sudo.json`.
- Command authorization added in `src/handlers/messageHandler.js`.
- `.addsudo`, `.delsudo`, and `.sudos` added in `src/commands/registry.js`.
- Bot-admin identity matching hardened in `src/utils/jid.js` and `src/utils/permissions.js`.
- Phase 2 added `.mute`, `.unmute`, `.slowmode`, safe `.clear`, `.stats`, `.reload`, guarded `.broadcast`, `.disablecmd`, and `.enablecmd`.
- The requested command batch added `.sticker`, `.toimage`, `.tomp3`, `.media`, `.setname`, `.setdescription`, `.invite`, `.revokeinvite`, `.joinrequest`, `.group link`, `.weather`, `.translate`, `.calculate`, `.define`, `.shortlink`, and `.qr`.
- `.translate` now accepts a reply with no text for auto-detected English output, a reply plus a target language name/code, or the existing manual language-plus-text form. Text and image/video captions are supported; unsupported media produces a clean usage/error response.
- Phase 1 fixed the shared `getContext` limitation that previously read context only from `extendedTextMessage`, so quoted image/video/document captions and mentions now work across relevant commands. `resolveTarget` and media detection use the shared unwrapped context path.
- Phase 1 fixed metrics not being passed from `eventHandler` into `messageHandler`; `.stats` now receives runtime counts. Promote/demote participant events no longer trigger goodbye messages.
- `.define` now falls back from Dictionary API to Datamuse when the primary provider returns an outage such as HTTP 530; `ineffable` was verified through the fallback response shape.
- `.antidelete on|off` is an admin-only per-group toggle. Enabled groups cache recent messages in memory for up to 24 hours, notify when a cached message is deleted, and attempt to resend text or downloadable media. `ANTIDELETE_LOG_JID` optionally receives a notice and recovered copy.
- Baileys rc14 emits Delete for Everyone through `messages.update` with a REVOKE stub and the original key nested in `update.key`; this is now handled in addition to `messages.delete`.
- Recovered text now uses the requested branded format: sender display name and original text, `Shadow: ♠️ Shadow sees all...`, and `**Recovered message:** <text>`. The recovery resend omits mentions to avoid failures with unusual participant identities.
- Final live-log diagnosis: `update.key` is the revoke protocol envelope, not the deleted message. The deleted message key is the outer `messages.update` item's `key`; the handler now prioritizes that key, preventing recovery of `type: protocolMessage`.
- Downloader phase added `.yta`, `.ytv`, `.play`, `.tiktok`, `.insta`, `.fb`, and `.twitter` through `src/services/downloader.js`. It uses `execFile`, validates supported HTTPS hosts, applies a 50 MB default limit, three-minute timeout, one-job concurrency, temporary cleanup, and chat/sender-bound five-minute play sessions. The official `yt-dlp.exe` must be installed on Windows or configured with `YTDLP_PATH`.

## Tests and results

The latest sandbox run executed `npm test`: 41 tests passed. Syntax checks passed for all JavaScript files. Translation and dictionary provider calls are mocked in tests, with separate live probes for Japanese translation and Datamuse `ineffable`; anti-delete uses mocked Baileys `messages.update` and deletion events, including branded recovery output. Downloader URL validation and mocked search-session ownership pass. Windows Node-side yt-dlp access was then verified from `C:\Users\User\Downloads\whatsapp-bot-owner-fix\whatsapp-bot`; the resolver found `C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`. No `YTDLP_PATH` override is currently required. The downloader now probes final streams with FFprobe, rejects incomplete output, conditionally converts incompatible video to H.264/AAC MP4 or audio to MP3, requests audio-only sources, caps video selection at 720p, and uses bounded fragment concurrency/retries. `.play` numbered selections now correctly use audio extraction. `.menu` is the compact Shadow command directory with prefix plus Unicode-bold uppercase names and no descriptions; `.help` remains the descriptive synchronized control center. `.ping` now sends exactly one line in the format `Pong! You think you can match my speed? ⚡: Nms`, with `N` measured via high-resolution `performance.now()` from message receipt through bot-side handling immediately before the send; no separate acknowledgement is sent. Generated MP4/MP3 fixtures passed end-to-end through download, probe, payload, and cleanup. Replace the Windows copy with the updated archive and live-test `.menu`, `.help`, `.help ping`, unknown help, `.yta`, `.ytv`, `.play`, and social video commands. The new ping format was verified by sandbox tests, not by a live WhatsApp chat; WhatsApp delivery latency and media playback remain unverified.

## Known limitations

- The bot runs only while its host process is running. Local Windows shutdown stops it.
- 24/7 deployment to a VPS or always-on machine is not completed.
- The active Windows copy may differ from the sandbox code.
- Multi-file auth and JSON stores are suitable for modest use but not high-concurrency production.
- WhatsApp server permissions and identity mappings remain authoritative.

## Next recommended action

1. Install the audited package in the active Windows project while preserving `.env`, `data/auth`, and JSON state.
2. On Windows, run the Node-side `yt-dlp --version` and `ffmpeg -version` checks from the Shadow project folder, verify Baileys rc14, and run the 33-test suite. Set `YTDLP_PATH` only if PATH lookup fails; restart Shadow after PATH changes. If FFmpeg resolution still fails, set `FFMPEG_PATH` in `.env` to the full `ffmpeg.exe` path.
3. Live-test owner commands, sudo grant/revoke, and unauthorized rejection.
4. In a test group/chat, live-test `.yta`, `.ytv`, `.play` result selection and expiry, cross-user selection rejection, each social downloader, `.antidelete on|off`, deleting text/media, optional log forwarding, reply translation, media conversions, group metadata/admin operations, warnings, settings, and diagnostics.
5. Keep `BROADCAST_GROUPS` empty unless explicit guarded broadcasts are required.
6. Record live-only failures before adding AI integration or further features.

## Relevant files

- `src/handlers/messageHandler.js`: message parsing, deduplication, command authorization, self-command handling.
- `src/utils/permissions.js`: owner, sender, group-admin, and bot-admin identity checks.
- `src/utils/jid.js`: LID/PN/device JID normalization.
- `src/commands/registry.js`: command definitions and sudo commands.
- `src/services/sudo.js`: persistent sudo allowlist logic.
- `src/connection/connect.js`: Baileys connection, QR, auth, reconnect lifecycle.
- `tests/bot.test.js`: mocked regression tests.
