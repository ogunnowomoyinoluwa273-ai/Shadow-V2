# Project Status

## Current state

The project is a modular Node.js WhatsApp bot using exactly `@whiskeysockets/baileys@7.0.0-rc14`, Node.js 20+, and ES modules.

Completed and tested in the sandbox:

- QR authentication, credential persistence, reconnect handling, and graceful shutdown.
- General and group-management command architecture.
- Owner commands from the linked WhatsApp account using Baileys `fromMe` messages.
- LID/PN/device-suffixed JID handling for owner and bot-admin checks.
- Persistent sudo authorization with `.addsudo`, `.delsudo`, and `.sudos`.
- Anti-link, welcome/goodbye, warnings, group settings, and duplicate-message safeguards.
- Windows packaging and handoff guidance.
- Reusable `secure-baileys-bot` Manus skill created separately under `/home/ubuntu/skills/secure-baileys-bot/`.
- Phase 1 command audit completed in the sandbox. Shared reply/context handling, metrics wiring, participant-event filtering, document captions, wrapped media detection, calculator no-space parsing, translation source detection, dictionary fallback handling, FFmpeg resolution, anti-delete recovery, and downloader command guards were checked and repaired where needed.

## Latest verified results

- Exact installed Baileys version: `7.0.0-rc14`.
- Automated tests: 41 passed.
- JavaScript syntax checks: passed.
- Skill validation: passed.

## Current phase

Phase 1 audit complete in the sandbox; live Windows provider validation remains. Anti-delete is implemented as a per-group opt-in feature with bounded in-memory recovery and optional log forwarding. The rc14 revoke handler now selects the outer deleted-message key rather than the protocol envelope key. Downloader phase is implemented around yt-dlp with guarded public URL support and expiring `.play` sessions. Windows Node-side yt-dlp resolution is verified from the active Shadow project and resolves the WinGet executable at `C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`; no `YTDLP_PATH` override is currently required. Fixed yt-dlp size-limit formatting to send `50M`, fixed video output to prefer MP4, added FFprobe-backed final stream validation plus conditional H.264/AAC MP4 and MP3 conversion, and optimized source selection with audio-only downloads, a 720p video cap, bounded fragment concurrency/retries, and timeouts. `.play` numbered selections now correctly use the audio path. `.menu` is now a Shadow-branded command directory with live command count, date/time, version, uptime, prefix, category headings, and only implemented commands rendered as prefix plus Unicode-bold uppercase names; `.help` remains the separate descriptive Shadow control center. Generated MP4/MP3 fixtures passed the end-to-end downloader path. `.ping` now sends one concise same-line response in the format `Pong! You think you can match my speed? ⚡: Nms`, where `N` is dynamically measured with high-resolution `performance.now()` from message receipt to immediately before the single send; no separate acknowledgement message is sent. Live platform downloads and live menu rendering remain to be retested. Phase 2 code is present but was not expanded during this audit. Unauthorized recognized commands are silently ignored. Translation detects the source language before calling MyMemory. FFmpeg detection is validated from Node with an explicit override and Windows locator fallback. Deployment to an always-on VPS or server must wait until local and live validation are complete.

## Pending work

1. Copy the audited package into the active Windows project while preserving `.env`, `data/auth`, and local JSON state.
2. Windows Node-side yt-dlp access is verified. Run the updated test suite, verify `ffmpeg -version`, and retry the downloader commands. Set `YTDLP_PATH` only if PATH lookup later fails; restart Shadow after PATH changes.
3. Live-test `.yta`, `.ytv`, `.play` selection/expiry/ownership, each social URL command, `.antidelete on|off`, deletion recovery, optional `ANTIDELETE_LOG_JID`, reply-based translation, media replies, group-admin commands, warnings, settings, and owner diagnostics in a test group/chat.
4. Record any live-only WhatsApp/API errors before adding more features or AI integration.
5. If 24/7 operation is required, deploy to an always-on host using the existing auth session securely.

## Next action

Install the audited package on Windows, preserve local credentials/state, run `npm test`, and perform the live command checks documented in `PHASE_1_VALIDATION.md` plus the current commands documented in `README.md`.
