# Technical Notes

## Runtime and dependency

- Runtime: Node.js 20 or later.
- Module system: ES modules via `"type": "module"`.
- Required library: `@whiskeysockets/baileys@7.0.0-rc14`.
- Important v7 changes: ESM, LID-aware identities, `id`/`lid`/`phoneNumber` contact fields, and explicit QR handling through `connection.update`.

## Architecture

- `src/index.js`: startup, JSON stores, command registry, lifecycle, signals.
- `src/config.js`: environment parsing and normalized paths.
- `src/connection/connect.js`: `useMultiFileAuthState`, `creds.update`, QR, reconnect, permanent logout handling.
- `src/handlers/messageHandler.js`: text extraction, prefix parsing, deduplication, self-command handling, authorization gate.
- `src/handlers/eventHandler.js`: message and participant-update listeners, anti-link deletion, welcome/goodbye handling.
- `src/commands/registry.js`: general, group, moderation, and owner-only sudo commands.
- `src/utils/permissions.js`: owner, sender, group-admin, and bot-admin checks.
- `src/utils/jid.js`: normalized JID comparison, device suffix removal, participant identity candidates.
- `src/services/jsonStore.js`: local JSON persistence.
- `src/services/sudo.js`: normalized persistent sudo JID allowlist.

Phase 2 adds bot-enforced `mutedParticipants`, `slowmodeSeconds`, and `disabledCommands` to per-group settings. The message handler applies these policies before command dispatch and only deletes messages when the bot is an administrator. `.clear` deletes one replied-to message; bulk deletion is intentionally disabled.
- `src/services/groupSettings.js`: per-group anti-link, welcome, goodbye, rules, and support settings.

## Authentication and data safety

- Auth state is stored under `data/auth` or the configured `AUTH_DIR`.
- Group settings, warnings, and sudo data are local JSON files under `data/`.
- Never commit, print, upload, or casually replace auth/session files.
- `.env`, `data/auth/`, and JSON state are excluded by `.gitignore`.
- A person with the auth directory may be able to control the linked WhatsApp account.

## Configuration

`.env.example` documents `BOT_NAME`, `BOT_PREFIX`, `OWNER_NAME`, `OWNER_NUMBER`, logging, welcome/goodbye defaults, auth path, settings path, warning path, sudo path, and tag limits. The owner number is configuration only; for linked-account self commands, Baileys `fromMe` is the reliable signal.

## Permission model

- `fromMe` explicit commands are treated as authenticated owner commands.
- Non-self owner matching uses normalized configured owner PN.
- Sudo entries are normalized exact JIDs and are managed only by the owner.
- Group administration requires a group admin sender or owner authorization.
- WhatsApp operations also require the bot account itself to have the relevant group privilege.
- Bot-admin checks compare socket `id`, `lid`, and `phoneNumber` against participant `id`, `lid`, `phoneNumber`, and device-normalized variants.

## Commands of note

- `.addsudo @user`: persist authorization.
- `.delsudo @user`: revoke authorization.
- `.sudos`: list authorized identities.
- `.promote`, `.demote`, `.kick`, `.group`, `.delete`: require authorization and actual bot privileges.
- `.mute`, `.unmute`, `.slowmode`, `.clear`: moderation policies requiring group authorization and, where deletion/settings changes are involved, bot administrator status.
- `.stats`, `.reload`, `.broadcast`: owner-only diagnostics and guarded operations. Broadcast requires `CONFIRM` and explicit `BROADCAST_GROUPS` entries capped at ten groups.
- `.disablecmd`, `.enablecmd`: per-group command controls persisted in group settings.

The next command batch adds `.sticker`, `.toimage`, `.tomp3`, `.media`, `.setname`, `.setdescription`, `.invite`, `.revokeinvite`, `.joinrequest`, `.group link`, `.weather`, `.translate`, `.calculate`, `.define`, `.shortlink`, and `.qr`. Media conversion uses Baileys `downloadMediaMessage` and the system `ffmpeg` executable. QR images use the pinned `qrcode` npm package. Web utilities use public endpoints and can fail or be rate-limited; `.calculate` uses a restricted parser rather than JavaScript evaluation.

FFmpeg resolution is performed by the Node process itself with a `-version` preflight, not by a sticker library. The resolver checks `FFMPEG_PATH` first, then the platform executable name (`ffmpeg.exe` on Windows), and on Windows also asks `where.exe` and `cmd.exe` for an absolute executable path before retrying. It resets its cached result after a failed lookup. If FFmpeg was installed or added to PATH while Shadow was already running, restart Shadow so Node inherits the current environment; alternatively set `FFMPEG_PATH` in `.env` to the full `ffmpeg.exe` path.

## Phase 1 audit decisions

- `getContext()` scans the unwrapped WhatsApp message content for `contextInfo`, rather than assuming every reply or mention is an `extendedTextMessage`. This supports replies and mentions attached to image, video, document, ephemeral, and view-once messages.
- `extractText()` supports conversation text, extended text, image/video captions, and document captions. Unsupported media without captions is intentionally not treated as translatable text.
- `resolveTarget()` and media type detection reuse the shared context/unwrapping helpers so moderation and media commands handle the same WhatsApp message shapes consistently.
- `calculate()` strips whitespace and uses a restricted parser; no unrestricted JavaScript evaluation is used. Inputs remain length- and character-limited.
- `.translate` detects the source language before calling MyMemory because MyMemory rejects `langpair=auto|target`; target names are normalized to ISO codes.
- `.define` uses Dictionary API as the primary provider and Datamuse as a fallback. Provider errors, including HTTP 530, no longer immediately become a bot failure when the fallback has a definition.
- Anti-delete uses `src/services/antiDelete.js`: a bounded in-memory cache keyed by Baileys message ID, with a 24-hour TTL and a 2,000-entry cap. Baileys rc14 emits normal Delete for Everyone revocations through `messages.update` with `update.messageStubType`; the outer update item's `key` is the deleted message key, while `update.key` is the revoke protocol envelope key. Shadow handles that path as well as `messages.delete`. Text is resent directly; media is downloaded and resent when Baileys can still retrieve it. `ANTIDELETE_LOG_JID` optionally receives a notice and recovered copy. This is intentionally best-effort: it cannot recover messages received before startup, expired entries, or unavailable media.
- Recovered text is sent without mention metadata to avoid resend failures from unusual participant identities. Its format is `<pushName> : <text>`, followed by the Shadow tagline and `**Recovered message:** <text>`.
- Downloader phase uses the official `yt-dlp` executable through `src/services/downloader.js` and Node `execFile`, never a shell. It validates HTTPS URLs against YouTube, TikTok, Instagram, Facebook, and X/Twitter hostnames, uses a 50 MB default file cap, a three-minute timeout, one concurrent job, temporary directories with cleanup, FFprobe final-stream validation, and safe media payload selection for WhatsApp. `.play` uses `ytsearch5`, stores at most five results per chat/sender for five minutes, and prevents other users from selecting the session. Audio requests audio-only sources; video requests compatible sources up to 720p, with bounded fragment concurrency/retries and conditional H.264/AAC MP4 conversion.
- `YTDLP_PATH`, `FFPROBE_PATH`, `DOWNLOADER_TIMEOUT_MS`, `DOWNLOADER_MAX_BYTES`, and `DOWNLOADER_CONCURRENCY` are optional environment settings. The official yt-dlp README documents standalone Windows binaries and format/audio behavior; its installation wiki documents the official release and package-manager routes. Windows Node-side access was verified from the active Shadow project: `createDownloader({ config }).resolveExecutable()` resolved `C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`. No override is currently required; live platform downloads remain pending.
- Research sources: [yt-dlp README](https://github.com/yt-dlp/yt-dlp) and [yt-dlp installation wiki](https://github.com/yt-dlp/yt-dlp/wiki/Installation). These are the basis for the executable setup and FFmpeg requirement documented in `README.md`.
- Runtime metrics are passed from event registration into message handling. Participant welcome/goodbye messages are limited to `add` and `remove`; promotions and demotions do not produce departure messages. `.ping` uses `node:perf_hooks` `performance.now()` and measures elapsed bot-side handling time from message receipt to immediately before the single outgoing send, then includes that dynamic value on the same Pong line. A true WhatsApp delivery acknowledgement cannot be known before that same message is sent without a second send/edit.
- `.menu` and `.help` are intentionally separate renderers in `src/commands/registry.js`, but both consume the returned `allCommands` registry. `.menu` is the decorative command panel with live count, time/day, version, uptime, prefix, and access labels; `.help` is the readable Shadow control center. `.help <command>` resolves only registered commands and gives a helpful response for unknown names.
- The menu directory intentionally omits descriptions and permission labels. Each registered command is rendered as `<configured-prefix>*<Unicode-bold-uppercase-name>*`; `.help` remains the place for descriptions, usage, categories, and access details.

The audit was validated with mocked/unit tests and syntax checks. Live WhatsApp group operations, media downloads, and the Windows runtime still require testing in the user's active project.

## Verification commands

From the project directory:

```bash
npm install
npm ls @whiskeysockets/baileys --depth=0
npm test
npm start
```

On Windows, run PowerShell from the folder containing `package.json`. Preserve `data\auth` when applying source updates. Live WhatsApp tests must be reported separately from mocked tests.
