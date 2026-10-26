# SHADOW command and provider inventory

**Audit date:** 2026-10-23. **Source root reviewed:** `/tmp/shadow-anime-resume/project`, represented by `/tmp/shadow-plugin-audit-source.txt`. **Method:** static inspection of the supplied source snapshot and grouped audit notes. No source code, runtime behavior, or dependencies were changed; this inventory and the README audit summary are documentation updates.

## Scope and limitations

The inventory records every command in the statically assembled registry, including generated registrations and owner/group-only entries. The registry contains **84 canonical commands**. Every registration in the snapshot explicitly has `aliases: []`; therefore this inventory records no aliases. Names below include the configured command prefix `.` for readability; the registry stores the canonical name without the prefix and the prefix is configurable.

This is not a runtime/security certification. The snapshot omits `.env`, authentication state, `node_modules`, and local runtime JSON; no tests, live WhatsApp calls, provider/API requests, executable checks, or dependency installation were performed. Consequently effective configuration, deployed identity/data, permissions, external-provider availability/schema/terms, package advisories/currentness, and actual command outcomes remain unverified. Code observations describe the snapshot only. Evidence is cited by exact source-file path under the stated source root. The audit bundle’s line offsets were not retained as source line numbers. Replacement options are architectural boundaries, not recommendations to migrate or claims of drop-in compatibility.

## Inventory notation

Each record gives: **Modules** (exact paths); **Dependencies/providers**; **Functionality**; **Limitations/access**; **Connections**; **Replacement options**; and **Evidence** (source-file paths). Shared mechanics are still stated in each record where material and are expanded in the maps below. “No external provider” means none is visible in the reviewed implementation, not that all transitive network behavior was independently checked.

## 1. Sudo storage and owner diagnostics (6)

### `.addsudo` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/sudo.js`; `src/services/jsonStore.js`; `src/config.js`; `src/index.js`; `src/utils/jid.js`; `src/utils/permissions.js`.
- **Dependencies/providers:** Node `fs/promises`/`path` local JSON via `SUDO_FILE` (default `./data/sudo.json`); shared `createSudoService`; Baileys supplies message/mention context, not a remote authorization service.
- **Functionality:** Owner-only. Resolve first mention or JID-like argument, normalize, add if absent, persist, confirm authorization.
- **Limitations/access:** Target must be mention or token matching `^\d{5,}@`; bare phone number is rejected. Duplicate normalized identity is idempotent. Not group-only. Sudo permits ordinary commands, not owner-only commands. No visible list cap/audit history.
- **Connections:** Shares the singleton store/service with `.delsudo` and `.sudos`; handler checks owner-or-sudo for ordinary commands and owner for owner-only commands; `.reload` reloads that same store.
- **Replacement options:** Swap JSON persistence behind the `list/has/add/remove` service contract, preserving normalization/idempotency and config. A handler/auth replacement must retain owner versus sudo distinctions.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/services/sudo.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/config.js`; `src/index.js`; `src/services/jsonStore.js`.

### `.delsudo` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/sudo.js`; `src/services/jsonStore.js`; `src/config.js`; `src/index.js`; `src/utils/jid.js`; `src/utils/permissions.js`.
- **Dependencies/providers:** Same local JSON sudo store/service and Baileys message context as `.addsudo`; no external authorization provider.
- **Functionality:** Owner-only. Resolves and normalizes a mentioned/JID-like target, removes matching normalized entries, persists, and confirms revocation; removing an absent identity is harmless.
- **Limitations/access:** Target resolution requires a mention or `^\d{5,}@`-like token; missing target is rejected, but no explicit rejection of an empty normalized value is described. Not group-only; sudo users cannot invoke this owner-only management command. No list cap/audit history visible.
- **Connections:** Mutates the same list checked by handler `sudo.has`; `.reload` can replace in-memory state from file.
- **Replacement options:** Replace shared persistence behind `list/has/add/remove`; preserve normalized matching, immediate revocation, owner-only policy, and distinction between owner and sudo.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/services/sudo.js`; `src/handlers/messageHandler.js`; `src/config.js`; `src/index.js`; `src/services/jsonStore.js`.

### `.sudos` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/sudo.js`; `src/services/jsonStore.js`; `src/config.js`; `src/index.js`; `src/utils/jid.js`; `src/utils/permissions.js`.
- **Dependencies/providers:** Reads the shared in-memory list loaded from local JSON (`SUDO_FILE`, default `./data/sudo.json`); Baileys is only the reply transport.
- **Functionality:** Owner-only numbered list of authorized entries, formatted as mention plus raw JID; empty array yields “No sudo users configured.”
- **Limitations/access:** No pagination, cap, or JID redaction; list is current in-memory state, not a freshness check. Not group-only. Service returns `[]` for non-array data.
- **Connections:** Reads the same store changed by `.addsudo`/`.delsudo` and refreshed by `.reload`; listed users remain unable to run owner-only commands.
- **Replacement options:** Replace backing store while preserving `list()` and shared auth semantics; add paging/redaction only as an explicit behavior change.
- **Evidence:** `src/commands/registry.js`; `src/services/sudo.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/config.js`; `src/index.js`; `src/services/jsonStore.js`.

### `.stats` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/index.js`; `src/utils/message.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Injected in-process metrics object; local `formatDuration`; Baileys reply transport; no external telemetry provider.
- **Functionality:** Owner-only diagnostic reply with uptime and `messagesSeen`, `commandsExecuted`, `deniedCommands`, `moderationActions`, `errors`.
- **Limitations/access:** Counters initialize at zero per process and are not durable. Messages are counted before command filtering; executed count follows successful command run; denial/error scopes follow dispatcher catches. Uptime is process-relative. Not live-tested.
- **Connections:** Metrics initialized in `src/index.js`, incremented in message handler; independent of JSON stores and broadcast recipient config.
- **Replacement options:** Replace the registry callback for display or injected metrics producer/contract for instrumentation; persistent telemetry requires a broader provider change.
- **Evidence:** `src/commands/registry.js`; `src/index.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`; `src/connection/connect.js`.

### `.reload` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/index.js`; `src/services/jsonStore.js`; `src/services/groupSettings.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Injected callback reloads local JSON settings, warnings, and sudo stores using Node filesystem APIs; Baileys reply transport; no remote database.
- **Functionality:** Owner-only sequentially reloads the three stores and replies with completion.
- **Limitations/access:** Does not reload frozen config/environment, auth state, socket, metrics, or other process state. Not transactional: earlier stores may reload before a later failure; errors propagate to handler. Not group-only.
- **Connections:** Reloads the same stores used by group settings, warnings, and sudo commands.
- **Replacement options:** Change callback/store implementations at `src/index.js` or command response at registry; explicitly define refreshed datasets and failure semantics.
- **Evidence:** `src/commands/registry.js`; `src/index.js`; `src/services/jsonStore.js`; `src/services/groupSettings.js`; `src/handlers/messageHandler.js`.

### `.broadcast` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/config.js`; `src/handlers/messageHandler.js`; `src/index.js`; `src/connection/connect.js`.
- **Dependencies/providers:** `BROADCAST_GROUPS` process configuration; Baileys `sock.sendMessage`; no broadcast database/service.
- **Functionality:** Owner-only; requires exact case-sensitive first token `CONFIRM`, nonempty remaining text, and configured recipients; sends sequentially then reports target count.
- **Limitations/access:** Config parser retains numeric-numeric `@g.us` strings, silently drops invalid entries, caps 10 and does not deduplicate. No group existence/membership check, throttling, size cap, per-recipient confirmation, retry, or partial delivery summary. Failure stops loop and suppresses success reply.
- **Connections:** Recipient list is independent of current chat/settings; same socket and owner-only dispatch as other owner tools.
- **Replacement options:** Replace command send/confirmation policy or configuration parsing/recipient source. A different transport must implement send and preserve dispatch authorization.
- **Evidence:** `src/commands/registry.js`; `src/config.js`; `src/handlers/messageHandler.js`; `src/index.js`; `src/connection/connect.js`.

## 2. Quoted media conversions (4)

### `.sticker` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.
- **Dependencies/providers:** Baileys quoted-media download/send and reupload callback; local FFmpeg with `libwebp`; Node `fs/promises`, `os`, `path`, `child_process`, `util`; no remote converter.
- **Functionality:** Converts quoted media to WebP sticker, 512×512 aspect-fit/padded white, removes audio, sends quoted to command.
- **Limitations/access:** Requires quote. No command type check although helper accepts image/video/audio/sticker/document; converter treats only video as MP4 and other types as PNG. FFmpeg/libwebp required; no visible byte/duration/timeout cap. General owner/sudo dispatch applies; not group-only.
- **Connections:** Shares `downloadQuotedMedia`, `mediaType`, conversion and FFmpeg resolution with `.toimage`/`.tomp3`; `.media` shares downloader.
- **Replacement options:** Replace `toSticker`/conversion helper while preserving downloaded-media and byte-buffer contract; Baileys transport replacement affects all four.
- **Evidence:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.

### `.toimage` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.
- **Dependencies/providers:** Baileys quoted-media APIs/send; local FFmpeg WebP-to-PNG; Node temp-file/process modules; no remote conversion provider.
- **Functionality:** Requires quoted stickerMessage, converts via `toImage`, sends PNG image. Helper passes imageMessage if directly called; sticker conversion emits first frame.
- **Limitations/access:** Command rejects all but stickerMessage; animated sticker becomes one frame. FFmpeg needed; no explicit size/time cap. Not group-only; common owner/sudo dispatch applies.
- **Connections:** Shares media download/conversion infrastructure with `.sticker`/`.tomp3`; helper image passthrough is unreachable through this command guard.
- **Replacement options:** Replace helper or registry run block; preserve returned bytes and quoted response; shared Baileys boundary affects all media commands.
- **Evidence:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.

### `.tomp3` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.
- **Dependencies/providers:** Baileys download/send; local FFmpeg with `libmp3lame` at 128k; Node temp-file/process APIs; no remote converter.
- **Functionality:** Downloads quoted media, transcodes to MP3, sends `audio/mpeg` as `shadow-audio.mp3`.
- **Limitations/access:** Description says audio/video but no type guard; helper treats audioMessage as OGG and all others as MP4, so unsupported sources may fail. Requires FFmpeg/libmp3lame; no visible input/timeout cap. Not group-only; owner/sudo dispatch applies.
- **Connections:** Shares download and FFmpeg path with `.sticker`/`.toimage`; output uses same Baileys send pipeline.
- **Replacement options:** Replace `toMp3` or command body, preserving byte buffer and audio payload contract; conversion can change independently of Baileys retrieval/send.
- **Evidence:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.

### `.media` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.
- **Dependencies/providers:** Baileys quoted-media download/reupload/send; Node buffer/media utilities; no FFmpeg or external conversion service.
- **Functionality:** Resends quoted image, video, audio, sticker, or document in original-type payload with MIME/name metadata where available.
- **Limitations/access:** Only those five media message types accepted; missing MIME/name default to `application/octet-stream`/`shadow-media`; no visible size cap. No conversion.
- **Connections:** Shares quote extraction/download with other three media commands; unique as passthrough.
- **Replacement options:** Change registry payload selection or shared downloader metadata; transport changes affect all four.
- **Evidence:** `src/commands/registry.js`; `src/services/media.js`; `src/utils/message.js`; `package.json`.

## 3. Download pipeline and platform registrations (7)

Shared implementation is `src/services/downloader.js`, created once in `src/index.js`; it invokes external `yt-dlp`, uses `src/services/media.js` for FFmpeg/FFprobe discovery, validates URLs, normalizes/checks output, queues work, and sends via Baileys. Each row states the platform/mode distinction.

### `.yta` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** External `yt-dlp` and YouTube extractor/network; FFmpeg/FFprobe; Baileys delivery. Binaries are not package.json dependencies; no YouTube API client/key shown.
- **Functionality:** URL argument, audio mode, best audio extracted to MP3 128K, then sent to chat.
- **Limitations/access:** HTTPS/host allowlist; no playlists; default max 50 MiB (clamped 1–100), timeout 180s (30–600), concurrency 1 (1–3); URL only, not search. Live extractor support unknown. Owner/sudo dispatcher.
- **Connections:** Shared downloader queue/validation/send/temp cleanup with `.ytv`, `.play`, `.tiktok`, `.insta`, `.fb`, `.twitter`.
- **Replacement options:** Swap provider behind `download({url,mode:'audio'})`, retaining result/send contract and validation/normalization as desired.
- **Evidence:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.

### `.ytv` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** External `yt-dlp` YouTube extraction; FFmpeg/FFprobe; Baileys send; no platform API client.
- **Functionality:** URL-based video download, normalized to MP4/H.264 with optional AAC, then sent.
- **Limitations/access:** HTTPS/allowlist, no playlist; preferred selectors up to 720p but final best-format fallbacks are uncapped. Shared 50 MiB default / 100 MiB max, 180s default / 600s max, concurrency 1–3. No live check.
- **Connections:** Same central downloader and transport as six other downloader commands.
- **Replacement options:** Replace `download({url,mode:'video'})` provider while retaining validator, normalizer, result shape, or explicitly revise these shared safeguards.
- **Evidence:** `src/commands/registry.js`; `src/services/downloader.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.

### `.play` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** `yt-dlp` `ytsearch5:` YouTube search/download; FFmpeg/FFprobe; Baileys send; no separate search API.
- **Functionality:** Search up to five, show numbered results; requester selects numeric result to download audio. Session keyed by chat+sender; one-use, five-minute TTL.
- **Limitations/access:** Selection must be in range, same chat/sender, within TTL. Selection is consumed before download; failed download requires new search. Lazy expiration/no visible periodic map sweep. Shared download limits apply.
- **Connections:** Shares downloader pipeline with six commands; adds select/session methods not used by URL-only peers.
- **Replacement options:** Replace `search/select/download` behind interface, preserving result fields and per-chat/sender selection policy, or swap yt-dlp adapter only.
- **Evidence:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/downloader.js`; `src/config.js`; `src/handlers/messageHandler.js`.

### `.tiktok` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Shared `yt-dlp` external extractor, FFmpeg/FFprobe, Baileys; no TikTok-specific client/API module.
- **Functionality:** URL argument passed to shared video downloader and sent.
- **Limitations/access:** HTTPS and allowlisted TikTok host/subdomain; shared no-playlist/size/time/concurrency settings. Post types, redirects, geographic/access restrictions and current extractor support unverified.
- **Connections:** Generated from same mapped registration as `.insta`, `.fb`, `.twitter`; shared downloader internals.
- **Replacement options:** Add/swap platform extractor behind common `download` result shape, retaining URL and output checks if required.
- **Evidence:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/handlers/messageHandler.js`.

### `.insta` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Shared external `yt-dlp`; FFmpeg/FFprobe; Baileys; no Instagram API adapter.
- **Functionality:** Instagram URL through shared video-mode pipeline; recognized image/video sent accordingly, other normalized output may use document fallback.
- **Limitations/access:** HTTPS/Instagram accepted host/subdomains; no explicit short-link host listed. Shared playlist/size/time/concurrency constraints. Login-required content, redirects, and current extractor support unknown.
- **Connections:** Same generated handler and common downloader/transport as other social registrations.
- **Replacement options:** Add Instagram adapter beneath common downloader result contract; keep output probing/size checks or deliberately revise.
- **Evidence:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/handlers/messageHandler.js`.

### `.fb` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Shared external `yt-dlp` extraction for Facebook; FFmpeg/FFprobe; Baileys; no Facebook API client.
- **Functionality:** URL passed to video-mode pipeline and sent; no Facebook-specific command logic.
- **Limitations/access:** HTTPS allowlist includes Facebook and `fb.watch`; shared no-playlist and resource bounds. Login, redirect, region, and live extractor support unverified.
- **Connections:** Same shared provider/normalization/send path as six downloader peers.
- **Replacement options:** Facebook-specific adapter behind shared `download` contract; preserve allowlist and output-size validation if maintaining current policy.
- **Evidence:** `src/commands/registry.js`; `src/services/downloader.js`; `src/config.js`; `src/handlers/messageHandler.js`.

### `.twitter` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Shared external `yt-dlp` X/Twitter extractor; FFmpeg/FFprobe; Baileys; no X API client shown.
- **Functionality:** X/Twitter URL passed to video-mode pipeline and delivered through common sender.
- **Limitations/access:** HTTPS allowlist names twitter.com and x.com variants; shared resource bounds and playlist disabling. No credentials passed explicitly; post support/current access unknown.
- **Connections:** Generated in same mapped group as TikTok/Instagram/Facebook; common downloader stack.
- **Replacement options:** Replace/add X adapter behind `download`, preserving common result/output safeguards and send contract.
- **Evidence:** `src/commands/registry.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/handlers/messageHandler.js`.

**Shared pipeline note:** Initial URL host validation does not establish a network-level destination allowlist for redirects/media hosts. Post-transfer size validation is not a hard pre-transfer disk/network cap; yt-dlp also gets rounded max-size configuration. External binary installation/version and platform support were not verified.

## 4. Anime catalog and metadata (7)

### `.anime` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`; `src/index.js`.
- **Dependencies/providers:** AniList GraphQL primary; Jikan REST fallback; Node fetch/AbortController; pino logger; Baileys image/text reply.
- **Functionality:** Title search returns up to five title/type/year/episodes/score/genres/synopsis/URL records; attempts first result image, falls back to text.
- **Limitations/access:** Cleaned/truncated to 80 chars, minimum 2; AniList 5 results excluding adult; Jikan fallback 5, SFW, score-descending. Timeouts 5s/2.5s; normalized-query cache 60s. No live API verification.
- **Connections:** `animeApi.searchAnime`, default service with injectable replacement; Jikan fallback only for this catalog path.
- **Replacement options:** Replace `searchAnime`/provider adapters preserving `{provider,results}` and normalized fields, or inject compatible `anime` to `buildCommands`.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`.

### `.manga` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`; `src/index.js`.
- **Dependencies/providers:** AniList GraphQL only; native fetch/AbortController; pino; Baileys text reply.
- **Functionality:** Title search displays up to five manga title/format/year/chapters/score/genres/synopsis/URL entries.
- **Limitations/access:** Input cleaned/truncated to 80 chars, minimum 2; first page/five, excludes adult, relevance/popularity ordering, 5s timeout, 60s cache. No Jikan fallback; provider errors propagate. No live call.
- **Connections:** `animeApi.searchManga`; shared AniList/cache/normalization infrastructure.
- **Replacement options:** Replace `searchManga`/`normalizeManga` or inject compatible method retaining fields consumed by registry.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`.

### `.character` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`; `src/index.js`.
- **Dependencies/providers:** AniList GraphQL primary and Jikan REST fallback; native fetch/AbortController; pino; Baileys image/text delivery.
- **Functionality:** Character name search; no match message, multiple-match list, or single profile summary/image.
- **Limitations/access:** Clean/truncate 80 chars, min 2; up to five each; 5s/2.5s timeouts; cache 60s; biography ≤700 chars and ≤5 series titles. Although `characterById` is exposed, handler only searches; it does not fetch a focused detail endpoint. No live API check.
- **Connections:** `animeApi.searchCharacter`; exported `characterById` has no visible registered command consumer.
- **Replacement options:** Replace provider/normalizer retaining `id,name,anime,about,imageUrl,url`; a true detail workflow also changes handler.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`.

### `.seasonal` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`; `src/index.js`.
- **Dependencies/providers:** AniList GraphQL primary; Jikan `/v4/seasons/now` fallback; native fetch/Date; pino; Baileys text reply.
- **Functionality:** Lists current-season titles with score/status/episodes/URL, paged output.
- **Limitations/access:** Page clamped 1–5, 10 results/page; season derived from UTC; cache 120s. Heading echoes raw argument, not clamped page. Jikan fallback requests its own “now” season rather than computed AniList season/year. No live API test.
- **Connections:** `animeApi.seasonalAnime` shares anime normalization/cache and fallback logic.
- **Replacement options:** Replace `seasonalAnime` preserving `{provider,results}` and normalized fields; explicitly retain or revise page/UTC semantics.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`.

### `.animegenre` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`; `src/index.js`.
- **Dependencies/providers:** AniList GraphQL only; native fetch/AbortController; pino; Baileys text reply.
- **Functionality:** Lists popular titles for the supplied genre with score and URL.
- **Limitations/access:** Joined input cleaned/truncated 40 chars; empty rejected; first page/eight, popularity order, excludes adult; 5s timeout. No genre alias mapping/catalog validation, pagination, or Jikan fallback.
- **Connections:** `animeApi.animeByGenre`; shared AniList utility, not cache-wrapped per review.
- **Replacement options:** Replace `animeByGenre` with a compatible array of `{title,score,url}`, or inject a compatible method; mapping/validation would be new behavior.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`.

### `.animepopular` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`; `src/index.js`.
- **Dependencies/providers:** AniList GraphQL only; native fetch/AbortController; pino; Baileys text reply.
- **Functionality:** Shows popular anime titles, scores, URLs; empty list gets unavailable message.
- **Limitations/access:** Fixed first page/eight, adult excluded, popularity descending, 5s timeout; no arguments, fallback, or per-function cache wrapper. “Currently popular” is AniList sort semantics, not independently verified real-time ranking.
- **Connections:** `animeApi.popularAnime`; shared AniList transport/normalization.
- **Replacement options:** Replace `popularAnime` or inject compatible normalized array; pagination/fallback requires explicit implementation.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`.

### `.recommend` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/utils/logger.js`; `src/index.js`.
- **Dependencies/providers:** No recommender endpoint; delegates to AniList anime search and Jikan fallback via `searchAnime`; native fetch/AbortController; pino.
- **Functionality:** Maps selected mood/genre tokens or treats input as title search; returns up to five titles with genres/score/synopsis/URL.
- **Limitations/access:** Input cleaned to 120 chars, nonempty; recognized tokens action/fantasy/romance/comedy/relaxing/calm/energetic/something; delegated search further caps 80 chars/min 2 and uses 60s cache. Search-based, not independent recommendation logic; unknown moods become query text.
- **Connections:** `recommendAnime` delegates to `searchAnime`; injectable anime seam.
- **Replacement options:** Replace recommendation strategy while preserving result fields, or replace search provider; handler accepts injected anime methods.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`.

## 5. Anime theme audio (1)

### `.animesong` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`; `src/utils/logger.js`.
- **Dependencies/providers:** AnimeThemes search API `https://api.animethemes.moe/search/`; validated direct media only on `v.animethemes.moe`; external `yt-dlp`, FFmpeg/FFprobe; Baileys audio send; Node fetch/child process/temp-file modules.
- **Functionality:** Searches title, selects first valid Opening, else first valid Ending; downloads/converts MP3 at 128 kbps and sends quoted audio.
- **Limitations/access:** Query trimmed, ≤80 chars, min 2. API asks up to 10 and returns up to 8 candidates. URLs must be HTTPS, exact allowed host, no credentials/port, media extension webm/mp4/m4v/mkv. Shared 50 MiB default (1–100 MiB), 180s (30–600s), concurrency 1–3. API-error search fallback and non-video search links fail download validation; filename classification heuristically treats non-ED as Opening. No live check.
- **Connections:** Shares anime provider with catalog functions and downloader queue/FFmpeg with seven download commands; URL validated twice; `downloader.send` uses Baileys.
- **Replacement options:** Replace `animeThemes()` and/or `downloadThemeAudio()` behind candidate/audio result contracts. A provider swap must retain or deliberately change URL restrictions, size/time checks, output validation, cleanup.
- **Evidence:** `src/commands/registry.js`; `src/commands/registry.js`; `src/services/anime.js`; `src/services/downloader.js`; `src/services/media.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

## 6. Shared anime images and reactions (9)

### `.waifu` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** `nekos.best` `/api/v2/neko` through `randomWaifu`; global fetch, 5s timeout, HTTPS result URL; Baileys image send.
- **Functionality:** Sends returned image with generic name, “SFW” label and source; send failure falls back to text.
- **Limitations/access:** No arguments, cache/retry, content-byte/type/moderation check; HTTPS alone does not establish safe content. Common owner/sudo gate and group disablement; not group-only.
- **Connections:** Same `randomWaifu()` provider and endpoint as `.neko`; injected anime provider.
- **Replacement options:** Replace shared `randomWaifu`/`IMAGE_API` for both commands or make independent provider handler; preserve explicit safety policy and HTTPS validation.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.neko` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Same `nekos.best` `/api/v2/neko`, fetch/5s timeout, HTTPS URL, Baileys image transport as `.waifu`.
- **Functionality:** Calls `randomWaifu` and sends with fixed neko/SFW caption; send failure returns caption text.
- **Limitations/access:** No separate neko endpoint in default wiring; same absent content validation/cache/retry and unverified safety claim. Owner/sudo and group-disable policy; no group-only flag.
- **Connections:** Shares identical provider/data path with `.waifu`; caption is principal difference.
- **Replacement options:** Replace shared provider for both or add separate injected method for neko; preserve safety/timeout handling.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`; `package.json`.

### Reaction command family `.hug`, `.slap`, `.kiss`, `.pat`, `.bonk`, `.cry`, `.bite` — each aliases `[]`, each separately registered by a generated map
- **Modules (each):** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; `src/index.js` injects the service.
- **Dependencies/providers (each):** `MarcoSa-2000/animegifs` API using the fixed category action; native Node `fetch`; exact allowlisted API and OCI object-storage hosts; installed FFmpeg `libwebp_anim`; Baileys 7.0.0-rc14 animated-sticker send.
- **Functionality (each):** Calls injected `reactions.loadSticker(action)`, downloads the provider GIF through fixed HTTPS-host allowlists, converts it to animated WebP, then sends `{sticker, isAnimated: true}` with the title-cased reaction label as companion text. This is a sticker message, not a GIF/video message or a call to WhatsApp's built-in GIF picker.
- **Limitations (each):** No arguments or automatic provider fallback. GIF input is capped at 12 MiB; sticker output is exactly 512 × 512, at most 500,000 bytes, and limited to 8 seconds (below WhatsApp's 10-second maximum) [28] [29]. API/GIF/FFmpeg timeouts are 10/15/20 seconds per conversion profile, with up to three size-optimization profiles. Converted WebP buffers are cached in memory for up to 24 hours, at most 32 entries and 8 MiB total. The wrapper's MIT license does not license hosted GIF assets. Provider GIF bytes and authenticated WhatsApp delivery remain unverified.
- **Connections (each):** All seven share one provider service, host/signature checks, timeout/size limits, FFmpeg conversion, bounded WebP cache, and Baileys sticker payload. `.hmph` reuses the same service with `pout`; reaction media remains separate from `randomWaifu()` in `src/services/anime.js`.
- **Replacement options (each):** Replace the implementation behind the injected `reactions.loadSticker(action)` seam to affect the reaction family without changing catalog or unrelated anime commands; preserve action allowlisting, remote-host checks, bounded animated-WebP output, cache behavior, and Baileys-compatible sticker content.
- **Evidence, per command:** Generated registrations in `src/commands/registry.js`; runtime injection in `src/index.js`; service/provider behavior in `src/services/reactions.js`; dispatch in `src/handlers/messageHandler.js`; installed Baileys rc14 sticker fields in `node_modules/@whiskeysockets/baileys/lib/Types/Message.d.ts:142-143` and sticker message classification in `node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js:928-929`; wrapper source and license in references [23]-[25], provider responses in [26]-[27], WhatsApp limits in [28]-[29].

## 7. Local anime features (3)

### `.animequote` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`; `src/index.js`.
- **Dependencies/providers:** Four hardcoded strings and `Math.random`; Baileys reply; no external provider.
- **Functionality:** Returns one random anime-inspired quote; ignores arguments.
- **Limitations/access:** Four-item fixed bank, no attribution/provenance established; general owner/sudo dispatch and group-disable policy; not group-only.
- **Connections:** Registry calls injected `animeApi.randomAnimeQuote`; local service implementation.
- **Replacement options:** Replace quote bank/function preserving string return; network provider would be a new boundary.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`; `src/index.js`.

### `.anibattle` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`; `src/index.js`; `src/utils/logger.js`.
- **Dependencies/providers:** Character search via AniList primary/Jikan fallback; fetch/AbortController; pino; Baileys reply.
- **Functionality:** Parses `vs`/`vs.`, concurrently searches both names, compares first hits by database favorites, reports winner/tie and disclaimer.
- **Limitations/access:** Query 80 chars/min 2; uses first of up to five results with no disambiguation; missing favorites=0; cache 60s; popularity is not combat/canon power. Common owner/sudo dispatch.
- **Connections:** `compareCharacters` calls shared `searchCharacter`; shares its cache/providers.
- **Replacement options:** Replace parser, search adapter or comparison function; preserve `{first,second,winner,basis}` and display contract or update registry.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`.

### `.animequiz` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`; `src/index.js`.
- **Dependencies/providers:** Five fixed local questions; in-memory `Map`, `Date.now`; Baileys reply; no external API/database.
- **Functionality:** Starts/replaces chat+sender session, presents multiple choice; numbered answers score three questions, report correctness/final score.
- **Limitations/access:** Five bank questions, session three; start index is current map size modulo bank, not random. Answers only first arg integer 1–4. Five-minute TTL checked on answer; no periodic cleanup/cap; memory lost on restart. Sender fallback can merge unknown identities. Owner/sudo dispatch.
- **Connections:** Default `createQuizService()` built once per `buildCommands`, injectable `quiz`; does not use anime provider cache.
- **Replacement options:** Replace bank/service retaining `start(chat,sender)` and `answer(chat,sender,value)` plus registry result fields; persistence requires explicit design.
- **Evidence:** `src/commands/registry.js`; `src/services/anime.js`; `src/handlers/messageHandler.js`; `src/index.js`.

## 8. Web-service utilities (4)

### `.weather` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/webTools.js`.
- **Dependencies/providers:** Node fetch; wttr.in JSON endpoint `https://wttr.in/{city}?format=j1`; shared helper sets Shadow UA, 10s timeout, rejects non-2xx.
- **Functionality:** Returns current condition, resolved area/city, Celsius/feels-like, humidity, wind km/h.
- **Limitations/access:** City nonempty, ≤80 chars; first current condition/nearest area only. Network/JSON errors propagate; provider coverage/live status unknown. Not group-only; general owner/sudo dispatch.
- **Connections:** Registry calls shared webTools service; helper is shared with definition/translation.
- **Replacement options:** Replace `weather(city)` provider/formatter in webTools, keeping reply-ready string or update registry.
- **Evidence:** `src/commands/registry.js`; `src/services/webTools.js`; `package.json`.

### `.translate` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/webTools.js`; `src/utils/message.js`.
- **Dependencies/providers:** Google Translate GTX-style direct fetch for auto-detection; MyMemory REST translation; native fetch/AbortSignal, 10s timeouts, shared UA helper for translation, Baileys reply.
- **Functionality:** Target language plus text or quoted text/caption; quote-only defaults English. Detects language, short-circuits same-language, else translates; quote case includes original and target label.
- **Limitations/access:** Target code regex 2–5 letters with optional hyphenated subcode; language-name map is limited but other syntactic codes accepted without provider validation. Text 1–1000 chars; quote extraction supports conversation, extended text, image/video/document captions. Provider policy, quality, quota unknown. Sends input text to external endpoints.
- **Connections:** `buildTranslationRequest`, detection, translation in shared webTools; getQuoted/extractText in message utils.
- **Replacement options:** Replace detection/translation adapters preserving `translate(language,text)` and language normalization/request contracts; quote parsing is separate.
- **Evidence:** `src/commands/registry.js`; `src/services/webTools.js`; `src/utils/message.js`; `package.json`.

### `.define` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/webTools.js`.
- **Dependencies/providers:** DictionaryAPI primary, Datamuse fallback; native fetch/shared JSON helper, Shadow UA and 10s timeout; no dictionary npm client.
- **Functionality:** English term, first primary entry/meaning/definition; fallback first Datamuse definition and part of speech.
- **Limitations/access:** Lowercase word-like regex: leading a-z, then up to 60 letters/apostrophes/hyphens. Only first result/definition. Provider errors/unusable responses swallowed; generic unavailable message conflates failure and unknown term. Live service unknown.
- **Connections:** One of shared webTools functions using common JSON helper.
- **Replacement options:** Replace `define(word)` preserving reply-ready result/error contract; provider response extraction must be adapted.
- **Evidence:** `src/commands/registry.js`; `src/services/webTools.js`; `package.json`.

### `.shortlink` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/webTools.js`.
- **Dependencies/providers:** Native URL/fetch; is.gd `https://is.gd/create.php?format=simple&url=...`; 10s timeout; direct plain-text fetch, no shared UA.
- **Functionality:** First argument parsed as URL, original trimmed URL sent to is.gd; returns trimmed provider response.
- **Limitations/access:** Requires absolute HTTP(S); no host allowlist, credential ban, or URL length cap. Only `args[0]`, not joined input. Response must be successful and begin HTTP(S). External provider receives submitted URL; availability/privacy unknown.
- **Connections:** Same webTools module, but uses direct fetch rather than common JSON helper.
- **Replacement options:** Replace `shorten(url)` preserving returned short URL string and HTTP(S) policy; credentialed provider needs adapted response handling.
- **Evidence:** `src/commands/registry.js`; `src/services/webTools.js`; `package.json`.

## 9. Local calculation, QR, and latency (3)

### `.calculate` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/calculator.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`; `src/index.js`; `src/connection/connect.js`.
- **Dependencies/providers:** In-house JavaScript evaluator (`Number`, arithmetic operators), no external arithmetic package/provider; Baileys reply transport.
- **Functionality:** Evaluates `+ - * / % ^` and parentheses; returns numeric result rounded to 12 decimals.
- **Limitations/access:** Whitespace-stripped limit 200 chars, allowed arithmetic characters only, rejects divide by zero, malformed/unbalanced/nonfinite. Unary minus handled by zero insertion; unary plus unsupported. Adjacent operands/implicit multiplication may be misinterpreted (example `1(2)` can return first value). No tests/live run. General owner/sudo dispatch.
- **Connections:** Registry passes `rawArgs`; shared parser/handler and Baileys reply.
- **Replacement options:** Replace exported synchronous `calculate(expression)` parser, preserve string-to-result contract; dependency addition would be an explicit project change.
- **Evidence:** `src/commands/registry.js`; `src/services/calculator.js`; `src/utils/message.js`; `src/handlers/messageHandler.js`; `src/index.js`; `src/connection/connect.js`; `package.json`.

### `.qr` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/utils/message.js`; `src/handlers/messageHandler.js`; `src/index.js`; `package.json`; no dedicated QR service.
- **Dependencies/providers:** Local `qrcode` package, `QRCode.toBuffer(rawArgs,{width:512,margin:2})`; Baileys sends image; no remote QR API. Separate `qrcode-terminal` is used for login QR, not this command.
- **Functionality:** Encodes remaining trimmed command text to QR image and sends caption “Generated by Shadow.” quoting source message.
- **Limitations/access:** Empty input rejected; no explicit payload length/type guard, format/error policy; failures use generic handler. General owner/sudo dispatch; no group-only flag.
- **Connections:** In-registry encoder and shared Baileys delivery; distinct from connection-login QR.
- **Replacement options:** Replace `toBuffer` call/package while preserving image buffer and send contract; transport need not change.
- **Evidence:** `src/commands/registry.js`; `src/utils/message.js`; `src/handlers/messageHandler.js`; `src/index.js`; `package.json`; lock root `1033-1035`; `src/connection/connect.js`.

### `.ping` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/ping.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Node `node:perf_hooks` monotonic `performance.now()`; Baileys socket sends response; no external latency provider.
- **Functionality:** Calculates rounded elapsed time from handler-captured `receivedAt` and sends Pong response.
- **Limitations/access:** Bot-side processing time from handler start to just before `sendMessage`, not network RTT or delivery time; invalid values become zero and result clamps ≥0. Common owner/sudo and disabled-command gate.
- **Connections:** Handler captures timestamp and passes to registry; helper is pure elapsed-time calculation.
- **Replacement options:** Replace registration/helper for local timing; end-to-end measurement requires changing handler and socket acknowledgment contract.
- **Evidence:** `src/commands/registry.js`; `src/services/ping.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`; `package.json`.

## 10. Status, identity, help, and local responses (8)

### `.alive` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`; `src/config.js`.
- **Dependencies/providers:** `Date.now`, captured process start, `formatDuration`, Baileys reply; no health provider.
- **Functionality:** “Online. Uptime: …” from process start.
- **Limitations/access:** Fixed Online label is not socket health; no args. Common owner/sudo authorization; no group-only flag.
- **Connections:** Shares `startedAt`/formatter with `.runtime`, `.info`, `.menu`, `.help`.
- **Replacement options:** Replace callback; true connection status needs connection-layer signal.
- **Evidence:** `src/commands/registry.js`; `src/commands/registry.js`; `src/utils/message.js`; `src/handlers/messageHandler.js`.

### `.runtime` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`.
- **Dependencies/providers:** `Date.now`, process-start timestamp and local formatter; Baileys reply.
- **Functionality:** Displays process-relative uptime only.
- **Limitations/access:** Not system or WhatsApp connection uptime; no args; owner/sudo dispatch, no group-only flag.
- **Connections:** Shares process-start and duration formatter with status/menu/help commands.
- **Replacement options:** Replace callback; system/connection uptime requires new data source.
- **Evidence:** `src/commands/registry.js`; `src/utils/message.js`; `src/handlers/messageHandler.js`.

### `.info` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`; `src/config.js`.
- **Dependencies/providers:** Node `os.arch`, `process.version/platform`, config bot name/version, process clock; Baileys reply.
- **Functionality:** Configured bot name/version, Node version, platform/architecture, uptime.
- **Limitations/access:** Static configuration/runtime process details, not host/container identity beyond fields; owner/sudo gate, no group-only flag. Env/runtime values not supplied.
- **Connections:** Shares config and uptime with `.alive`/`.runtime`.
- **Replacement options:** Change callback for presentation; config source changes belong in `src/config.js`.
- **Evidence:** `src/commands/registry.js`; `src/config.js`; `src/utils/message.js`; `src/handlers/messageHandler.js`.

### `.owner` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/config.js`.
- **Dependencies/providers:** Configured `ownerName`/digit-sanitized `ownerNumber`; Baileys reply; no contact lookup.
- **Functionality:** Displays owner name and optional `+digits` contact line.
- **Limitations/access:** Static/unverified identity; contact number visible to authorized caller; default name “Not configured”; owner/sudo dispatch, no group-only flag.
- **Connections:** Config owner number also feeds authorization/JID creation; command only presents config values.
- **Replacement options:** Change presentation or config source; a contact card/provider is new functionality.
- **Evidence:** `src/commands/registry.js`; `src/config.js`; `src/handlers/messageHandler.js`.

### `.menu` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`; `src/config.js`; `src/utils/permissions.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Local `renderMenu`, registry inventory, config, clock/Intl; Baileys `profilePictureUrl` and `sendMessage`, text fallback.
- **Functionality:** Categorized panel with bot/owner, time/day, command count, version, uptime, prefix; best-effort owner/bot profile image caption.
- **Limitations/access:** No args; timezone unspecified; names not aliases/details; photo failures swallowed then text. Owner/sudo gate. No live rendering check.
- **Connections:** Uses `allCommands`, category/render functions and owner JID/socket identity candidates; menu photo path is the only remote lookup here.
- **Replacement options:** Replace callback/renderers/category logic; avatar source needs a new provider.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/connection/connect.js`; `src/handlers/messageHandler.js`.

### `.help` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/message.js`; `src/config.js`.
- **Dependencies/providers:** Local registry names/descriptions/categories/renderers/config and duration; Baileys reply; no external help service.
- **Functionality:** Full categorized catalog or canonical/alias lookup for first argument; shows description/category/group-only and owner-only markers; unknown name response.
- **Limitations/access:** First argument only. All current alias arrays empty. Catalog can show entries caller cannot use; Online label is static. Owner/sudo gate.
- **Connections:** Uses same `allCommands`/lookup entries as dispatch and menu.
- **Replacement options:** Change callback or shared render/category functions; keep registry records aligned with lookup/menu.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`.

### `.quote` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** One fixed local string constant; Baileys reply; no quote API.
- **Functionality:** Returns `A winner is someone who has failed enough to succeed but didn't fail to stop` exactly.
- **Limitations/access:** No args/source attribution; owner/sudo dispatch, not group-only.
- **Connections:** Constant and callback colocated in registry.
- **Replacement options:** Edit the local constant; a remote feed would be a separate provider change.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`.

### `.support` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/config.js`.
- **Dependencies/providers:** `process.env.SUPPORT_CONTACT` read directly, fallback literal; Baileys reply; no ticketing/contact API.
- **Functionality:** Returns trimmed support contact or “Support contact is not configured.”
- **Limitations/access:** No validation, formatting, or verification; actual env value omitted. Owner/sudo dispatch, not group-only.
- **Connections:** Reads environment directly; config object does not declare this field.
- **Replacement options:** Change callback or centralize env setting in config; actual support integration is new scope.
- **Evidence:** `src/commands/registry.js`; `src/config.js`; `src/handlers/messageHandler.js`.

## 11. Read-only group information (3)

### `.groupinfo` — aliases `[]`; group-only
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `sock.groupMetadata` and `sendMessage`; no separate service.
- **Functionality:** Reports subject, description, participant count, creation time (Unix seconds formatted ISO), with fallbacks.
- **Limitations/access:** Dispatcher requires owner/sudo and group-only; no group-admin check in handler. Metadata shape/availability unverified.
- **Connections:** Uses `requireGroup`, `isGroupJid`, shared Baileys socket and reply pipeline.
- **Replacement options:** Adapt group metadata provider/output fields while retaining group restriction and access policy.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/connection/connect.js`.

### `.admins` — aliases `[]`; group-only
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupMetadata`/`sendMessage`; participant ID/mention helpers.
- **Functionality:** Filters participants with truthy `admin`, formats ID/JID as mention; empty result message.
- **Limitations/access:** Group-only, but not explicit admin check; dispatcher owner/sudo applies. Reads only `id || jid`, assuming truthy `admin`; alternate fields may not resolve. Live metadata unverified.
- **Connections:** Same group metadata path as `.groupinfo`; `participantId` and `participantMention` render results.
- **Replacement options:** Normalize provider admin flags and IDs into stable participant IDs, preserving access rules.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.

### `.rules` — aliases `[]`; group-only
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/jid.js`; `src/index.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Local group settings (`rules`) via JSON store; Baileys for reply only; no external rules provider.
- **Functionality:** Replies with per-group rules or default respect/topic/WhatsApp text.
- **Limitations/access:** Group-only dispatcher restriction; handler does not itself call `requireGroup` or require admin. Owner/sudo dispatcher and group-disabled checks. Stored values omitted, not live WhatsApp policy.
- **Connections:** Reads same group setting written by `.setrules`; settings store shared with all group controls.
- **Replacement options:** Replace persistence behind `get/set` while preserving group-JID mapping/default and reader/writer coordination.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/index.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`.

## 12. Participant tagging and admin actions (5)

### `.tagall` — aliases `[]`; generated by admin helper; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`; `src/config.js`.
- **Dependencies/providers:** Baileys `groupMetadata` and `sendMessage(mentions)`; `MAX_TAGALL` config default 100, clamp 1–1024; JID utilities.
- **Functionality:** Gets participants, removes bot `sock.user.id`, caps IDs, sends supplied/default “Attention everyone.” with mentions and count confirmation.
- **Limitations/access:** Caller must pass dispatcher owner/sudo then `requireAdmin` (owner or group admin); cap does not prove WhatsApp mention limits. Uses `participantId` rather than broader `participantIds`; bot identity exclusion is only sock.user.id. Empty list errors.
- **Connections:** Shared admin helper/metadata/mention transport with `.hidetag`; normal dispatcher performs authorization and group-only gate.
- **Replacement options:** Replace selection/cap/payload or provider adapter; preserve group authorization, mention semantics and configurable cap.
- **Evidence:** `src/commands/registry.js`; `src/config.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`; `package.json`.

### `.hidetag` — aliases `[]`; generated; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`; `src/config.js`.
- **Dependencies/providers:** Baileys group metadata/mention send; same maxTagall config and participantId helper.
- **Functionality:** Sends supplied/default “Attention.” with capped participant mention list; no separate confirmation.
- **Limitations/access:** Owner/group-admin and bot/dispatch checks as configured. Unlike tagall does not exclude bot; proceeds with empty mentions. Cap default 100, clamp 1–1024. Actual hidden/quiet mention behavior unknown.
- **Connections:** Same admin helper and transport as tagall; uses narrower participant ID extraction.
- **Replacement options:** Replace mention payload/identity normalization only with equivalent group mention capability; retain access checks and cap semantics.
- **Evidence:** `src/commands/registry.js`; `src/config.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.

### `.kick` — aliases `[]`; generated shared admin-action map; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupMetadata`, `groupParticipantsUpdate(...,'remove')`; mention and JID helpers.
- **Functionality:** Resolves one target from first mention/JID-like argument, checks caller and bot admin and bot-self target, removes target, replies success.
- **Limitations/access:** One target; target not validated as current member/full JID; self guard compares sock.user.id; update result not inspected before success. Provider may reject. Caller owner/group-admin and bot-admin required.
- **Connections:** Same mapped action handler as promote/demote; dispatcher adds owner/sudo/group gates.
- **Replacement options:** Replace group participant operation adapter while preserving caller/bot permission, target and self safeguards; inspect provider per-target results.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.

### `.promote` — aliases `[]`; generated shared admin-action map; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupMetadata`, `groupParticipantsUpdate(...,'promote')`; shared identity/permission helpers.
- **Functionality:** Validates caller and bot admin, resolves one target, blocks bot self-target, promotes and replies after await.
- **Limitations/access:** No precheck target membership/eligibility/already-admin; resolver only pattern-matches numeric JID prefix. Result ignored; provider enforcement not verified. One target at a time.
- **Connections:** Same mapped callback as kick/demote; common message handler and Baileys transport.
- **Replacement options:** Swap promote provider where equivalent role API exists; preserve authorization/target safeguards and interpret explicit results.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.

### `.demote` — aliases `[]`; generated shared admin-action map; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupMetadata`, `groupParticipantsUpdate(...,'demote')`; shared identity/permission helpers.
- **Functionality:** Validates caller/bot admin, resolves one target, prevents bot self-target, demotes and replies.
- **Limitations/access:** One target; no membership/admin precheck; target pattern not full identity validation; self guard uses sock.user.id; result object ignored. Live operation unknown.
- **Connections:** Same mapped handler as kick/promote, common authorization and reply path.
- **Replacement options:** Replace demote operation/provider adapter with equivalent group-role support; preserve safeguards and inspect provider result.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.

## 13. Group settings, invitation and metadata actions (6)

### `.group` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupSettingUpdate` for open/close and `groupInviteCode` for link; no other provider.
- **Functionality:** Exact case-normalized modes open/close/link; updates announcement mode or returns `chat.whatsapp.com` invite URL.
- **Limitations/access:** Group context, `requireAdmin`, bot must be admin for all modes; falsey invite code error. No live API check.
- **Connections:** Shares invite-code API with `.invite`; does not revoke; common group-admin dispatch.
- **Replacement options:** Group-admin adapter with `setGroupMode/getInviteCode`, equivalent metadata/access checks and Baileys transport replacement if needed.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/connection/connect.js`; `package.json`.

### `.setname` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupUpdateSubject`, `groupMetadata`, reply transport.
- **Functionality:** Sets group subject to joined arguments and confirms.
- **Limitations/access:** Group; caller admin/configured owner; bot admin. Trimmed subject 1–100 characters; remote policy/limits unknown.
- **Connections:** Mutates remote WhatsApp group subject, not local settings.
- **Replacement options:** Provider operation `updateSubject(jid,subject)` plus permission metadata adapter; retain local validation.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/connection/connect.js`; `package.json`.

### `.setdescription` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupUpdateDescription` and group metadata, reply transport.
- **Functionality:** Sets group description from joined args; confirms.
- **Limitations/access:** Group; caller admin/owner and bot admin. Empty string permitted; >2,000 chars rejected. Empty-clearing semantics and remote limit unknown.
- **Connections:** Remote WhatsApp group mutation, separate from local group-settings JSON.
- **Replacement options:** Provider `updateDescription(jid,text)`, retaining validation/empty semantics and authorization.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/connection/connect.js`; `package.json`.

### `.invite` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupInviteCode`; command constructs WhatsApp invite URL; reply via socket.
- **Functionality:** Returns current group invitation link.
- **Limitations/access:** Requires caller admin/owner and bot admin; no code is error. Link disclosed in chat without confirmation/expiry logic; live link validity unknown.
- **Connections:** Same invite-code mechanism as `.group link`; `.revokeinvite` mutates it.
- **Replacement options:** `getInviteCode(jid)` provider boundary; maintain authorization and choose explicit disclosure policy.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/connection/connect.js`; `package.json`.

### `.revokeinvite` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupRevokeInvite`, returns replacement code; reply through socket.
- **Functionality:** Revokes current invite, returns replacement URL if response has a code.
- **Limitations/access:** Group caller admin/owner and bot admin. Missing replacement code is reported after revoke; no rollback/audit. Actual invalidation/atomicity unverified.
- **Connections:** Destructive companion to `.invite`/`.group link`; remote state only.
- **Replacement options:** Adapter should expose revoke-and-return semantics and handle remote-success/missing-code state explicitly.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/connection/connect.js`; `package.json`.

### `.joinrequest` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys `groupRequestParticipantsList` and `groupRequestParticipantsUpdate`; no separate request service.
- **Functionality:** Approve/reject (case-normalized) every returned pending request, extracting `jid || id || requester`; reports returned result count.
- **Limitations/access:** Requires group, caller admin/owner and bot admin. All-at-once, no confirmation/per-person selection/batch or partial reporting. Unrecognized identity fields silently omitted; provider result shape unverified.
- **Connections:** Shared group/admin socket, no local pending state; independent of invite-code operations.
- **Replacement options:** Provider adapter for list/update requests; map identity/result shapes, preserve authorization, consider explicit batch/partial behavior.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/connection/connect.js`; `package.json`.

## 14. Automatic anti-link and anti-delete controls (2)

### `.antilink` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/antiLink.js`; `src/handlers/eventHandler.js`; `src/services/groupSettings.js`; `src/config.js`; `src/utils/message.js`; `src/utils/permissions.js`; `src/services/jsonStore.js`.
- **Dependencies/providers:** Local regex detection and JSON group settings; Baileys `groupMetadata`/delete/send; no external moderation service. `ANTILINK_DEFAULT` config; `antiLinkAllUrls` defaults false.
- **Functionality:** `on|off` toggles per-group `antiLink`; message/event flow attempts deletion and notice for matching WhatsApp invite/wa.me links, optionally generic HTTP(S) URLs when flag is true.
- **Limitations/access:** Group-admin/configured-owner command. Critical source finding: detector is called only after `parseCommand` succeeds, so ordinary non-command text is skipped. Text extraction limited to conversation, extended text and image/video/document captions; regex does not catch bare links. Generic URL mode defaults false and this command does not toggle it. Admin/bot messages are excluded by event handler; delete depends on live bot privilege.
- **Connections:** The flag is consumed in shared `messageHandler`; deletion/notice in eventHandler; per-group settings JSON and Baileys socket.
- **Replacement options:** Detector alone is insufficient; replace/adapt detection call and moderation callback in messageHandler/eventHandler, retaining toggle, group settings, authorization and socket delete semantics.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/antiLink.js`; `src/handlers/eventHandler.js`; `src/services/groupSettings.js`; `src/config.js`; `src/utils/message.js`; `src/utils/permissions.js`; `package.json`.

### `.antidelete` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/eventHandler.js`; `src/services/antiDelete.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/config.js`; `src/utils/message.js`; `src/utils/permissions.js`; `src/services/jsonStore.js`; `src/index.js`.
- **Dependencies/providers:** Baileys upsert/delete/update listeners, `downloadMediaMessage`, `getContentType`, send; local in-memory `Map` cache; JSON per-group setting; optional `ANTIDELETE_LOG_JID`. No separate SaaS.
- **Functionality:** `on|off` controls group flag. Listener caches incoming messages; deletion/revocation events look up copy, notify group and repost recoverable text/supported media; optionally sends log copy to configured JID.
- **Limitations/access:** Group-admin/configured-owner command. Cache default 2,000, TTL 24h, in-memory/non-persistent; restart, expiry, eviction/missed events lose copy. Media types image/video/audio/sticker/document; media failures swallowed. Text extraction limited. Cache keyed only by message id (possible cross-chat collision). `handleDeletedKeys` uses undefined `event?.jid` fallback for keys without remoteJid. Event shape, deletion and download behavior not live-tested.
- **Connections:** Command only toggles setting; recovery is in eventHandler/service and active listeners remain independent of command callback. Same settings JSON and Baileys socket.
- **Replacement options:** Replace event/cache/recovery path in eventHandler and antiDelete service with Baileys/event/media adapter; retain command toggle, group scope, retention, log destination and repost semantics.
- **Evidence:** `src/commands/registry.js`; `src/handlers/eventHandler.js`; `src/services/antiDelete.js`; `src/services/groupSettings.js`; `src/config.js`; `src/utils/message.js`; `src/utils/permissions.js`; `src/index.js`; `package.json`.

## 15. Message enforcement and deletion (5)

### `.mute` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/handlers/eventHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/utils/message.js`; `src/index.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys group metadata and delete/send; local settings JSON (`SETTINGS_FILE`, default `./data/group-settings.json`); JID helpers; no moderation SaaS.
- **Functionality:** Adds mention/JID target to per-group `mutedParticipants`; shared handler removes matching text messages and posts notice if bot can moderate.
- **Limitations/access:** Caller group admin/owner; bot must be admin to set and enforce; cannot mute bot. Target not validated as participant. Enforcement only notify/append group messages with extractable text, excluding owner/self; metadata/admin failure means no delete. Local bot policy, not native WhatsApp mute.
- **Connections:** `.unmute` changes same setting; messageHandler enforcement; shares delete helper/metrics with slowmode.
- **Replacement options:** Replacing command alone does not replace enforcement; coordinate registry and handler, preserve group scoping, JID identity, permissions and notices. Store adapter change affects all group settings.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/handlers/eventHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/index.js`; `src/connection/connect.js`.

### `.unmute` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/utils/message.js`; `src/index.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys metadata/reply; local group JSON settings; no external moderation provider.
- **Functionality:** Removes target from current group `mutedParticipants`, reports unmuted; future handler checks no longer match.
- **Limitations/access:** Caller group admin/owner, target must resolve from mention/JID-like text. No bot-admin check needed for local update; does not restore deleted content or alter native WhatsApp rights. Enforcement remains text-only and bot-admin-dependent.
- **Connections:** Shared record with `.mute` and handler; same JSON settings provider.
- **Replacement options:** Must coordinate with `.mute` and handler if changing representation; preserve group authorization, targeting and shared settings semantics.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/index.js`; `src/connection/connect.js`.

### `.slowmode` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/handlers/eventHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/utils/message.js`; `src/index.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys metadata/delete/send; per-group seconds in local JSON; in-memory per-group/sender time map; no external moderation service.
- **Functionality:** Sets interval 0–3600 seconds; shared handler deletes too-early text messages and posts wait notice.
- **Limitations/access:** Caller and bot group-admin checks to configure; enforcement also bot-admin gated. Applies only notify/append group messages with extractable text; other admins not exempt; owner/fromMe excluded. Timing map lost on restart; first violation does not advance timestamp. Delete failures/live rate behavior unknown.
- **Connections:** Shares message enforcement/delete helper and action counter with mute; settings service shared.
- **Replacement options:** Must replace command and handler timing branch for changed behavior; durable timing requires separate persistence/expiry policy; shared store migration impacts group settings.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/index.js`; `src/connection/connect.js`.

### `.delete` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/message.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys group metadata and `sendMessage({delete: quoted.key})`; no external provider.
- **Functionality:** Requires quoted message, submits deletion of its reconstructed key, then replies “Message deleted.”
- **Limitations/access:** Group admin/owner and quote required. No bot-admin precheck, age/authorship/eligibility validation. Success response only means awaited call resolved; actual delete unverified.
- **Connections:** Same payload family as `.clear` and automatic moderation, but not same bot-admin precheck/metrics helper.
- **Replacement options:** Replace callback or deletion transport while preserving quote parsing, authorization and single-message behavior; automatic moderation is a separate callsite.
- **Evidence:** `src/commands/registry.js`; `src/utils/message.js`; `src/utils/permissions.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.

### `.clear` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/message.js`; `src/utils/permissions.js`; `src/utils/jid.js`; `src/handlers/messageHandler.js`; `src/index.js`; `src/connection/connect.js`.
- **Dependencies/providers:** Baileys group metadata and quoted-key delete send; no external provider.
- **Functionality:** Deletes exactly one replied-to message and confirms; bulk deletion explicitly disabled.
- **Limitations/access:** Group admin/owner and quote required. No bot-admin precheck, age/ownership validation or bulk path. Live WhatsApp deletion eligibility unknown.
- **Connections:** Shares Baileys delete payload and quote utility with `.delete`, but separate handler call from automatic moderation.
- **Replacement options:** Preserve the one-message safety boundary and authorization; provider migration needs delete API. Bulk deletion would be deliberate behavior change.
- **Evidence:** `src/commands/registry.js`; `src/utils/message.js`; `src/utils/permissions.js`; `src/handlers/messageHandler.js`; `src/connection/connect.js`.

## 16. Warning records (3)

### `.warn` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/index.js`; `src/config.js`; `src/services/jsonStore.js`.
- **Dependencies/providers:** Local JSON `WARNINGS_FILE` default `./data/warnings.json`; Node fs/path; Baileys metadata/reply; no warning SaaS.
- **Functionality:** Writes group+target key, increments count to max 10, sets reason (remove mention tokens, default text, ≤500 chars) and ISO `updatedAt`, responds with count/reason.
- **Limitations/access:** Group admin/owner and owner/sudo dispatch; rejects sender/bot targets; target not verified as group member. Uses raw `${groupJid}:${target}` key without normalization. No escalation/punishment or history beyond latest reason/time.
- **Connections:** Shares warningStore with `.warnings`, `.resetwarnings`, and `.reload`.
- **Replacement options:** Replace callback or extract warning service; storage change must migrate same key/schema and coordinate all three commands/reload.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/index.js`; `src/config.js`; `src/services/jsonStore.js`.

### `.warnings` — aliases `[]`; group-only
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/index.js`; `src/config.js`; `src/services/jsonStore.js`.
- **Dependencies/providers:** Reads shared local warning JSON; Baileys `requireGroup` metadata and reply; no external provider.
- **Functionality:** Looks up exact group+target key and replies with count, default 0; does not mutate.
- **Limitations/access:** Group-only; calls `requireGroup`, not `requireAdmin`; dispatcher still requires owner/sudo, so any such user can query absent a separate admin gate. No member validation or key normalization; only count revealed.
- **Connections:** Reads records written by `.warn`, removed by `.resetwarnings`, refreshed by `.reload`.
- **Replacement options:** Coordinate backend with sibling warning commands; preserve key semantics and zero-for-missing behavior/access model.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/index.js`; `src/config.js`; `src/services/jsonStore.js`.

### `.resetwarnings` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/utils/jid.js`; `src/index.js`; `src/config.js`; `src/services/jsonStore.js`.
- **Dependencies/providers:** Deletes exact record from same local warnings JSON; Baileys metadata/reply; no external provider.
- **Functionality:** Clones top-level warning object, removes group+target property, persists, replies “Warnings reset.” even if absent.
- **Limitations/access:** Group admin/owner plus dispatch owner/sudo; target not checked as group member; exact raw key. No confirmation/audit trail/schema validation.
- **Connections:** Shares store/key with `.warn` and `.warnings`, and `.reload`.
- **Replacement options:** Change callback/backend only in coordination with sibling commands; preserve/migrate key and schema.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/utils/message.js`; `src/index.js`; `src/config.js`; `src/services/jsonStore.js`.

**Shared warning-store risk:** `createJsonStore.update` reads/modifies/writes whole JSON without visible queue/atomic replacement or schema validation; concurrent updates can race or a write may be incomplete. This is code-visible risk, not verified runtime failure.

## 17. Welcome, goodbye, greeting and group labels (4)

### `.setwelcome` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/config.js`; `src/handlers/eventHandler.js`; `src/services/welcome.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Local group JSON settings; config welcome default; Baileys participant events/group metadata/send; local template renderer.
- **Functionality:** `on|off` per-group toggle; participant add event sends rendered default template with user/group/count and mention.
- **Limitations/access:** Group admin/owner; only toggle, no per-group template editing. Setting default false. Event delivery depends on event/provider response. Event handler may fetch metadata before determining relevant action/individual flag; catches/logs errors.
- **Connections:** Same listener/settings/template as `.setgoodbye`; settings shared with other group controls.
- **Replacement options:** Replace command plus corresponding flag consumption in event listener; changing shared listener/render affects both welcome/goodbye.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/config.js`; `src/handlers/eventHandler.js`; `src/services/welcome.js`; `src/handlers/messageHandler.js`.

### `.setgoodbye` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/config.js`; `src/handlers/eventHandler.js`; `src/services/welcome.js`; `src/handlers/messageHandler.js`.
- **Dependencies/providers:** Local JSON group settings; config goodbye default; Baileys participant events/metadata/send; local renderer.
- **Functionality:** `on|off` flag; participant remove event sends rendered goodbye template and mention.
- **Limitations/access:** Group admin/owner; no command to edit template. Default false; event delivery and metadata provider unverified. Shared listener may make unnecessary metadata requests; errors logged.
- **Connections:** Same listener, renderer, settings file and defaults area as `.setwelcome`.
- **Replacement options:** Replace callback plus corresponding event listener flag; replacing shared render affects both commands.
- **Evidence:** `src/commands/registry.js`; `src/utils/permissions.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/config.js`; `src/handlers/eventHandler.js`; `src/services/welcome.js`; `src/handlers/messageHandler.js`.

### `.greet` — aliases `[]`; group-only
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`.
- **Dependencies/providers:** Local command handler and Baileys common reply; natural-language greetings use the injected Gemini brain.
- **Functionality:** Prefix form sends a concise group greeting, optionally addressed to supplied text. Natural-language `Shadow, greet` requests are generated by Gemini with group/private audience context and no unrelated tools.
- **Limitations/access:** Group-only for the prefix command; normal owner/sudo dispatch authorization applies. Natural-language use remains owner/sudo-only.
- **Connections:** Shares the command registry and AI message handler; no character setting is required.
- **Evidence:** `src/commands/registry.js`; `src/services/aiBrain.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`.

### `.setrules` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`; `src/config.js`; `src/index.js`.
- **Dependencies/providers:** Group settings JSON, `SETTINGS_FILE` default `./data/group-settings.json`; Baileys group metadata/reply; no external rules service.
- **Functionality:** Joins arguments, truncates to 2,000 JS code units, writes current group `rules`, confirms; `.rules` reads it. Default is respectful/topic/WhatsApp rules text.
- **Limitations/access:** Group-only, `requireAdmin` (group admin or configured owner); sudo alone insufficient. Nonempty args required; whitespace reconstructed with single spaces; no trim/content validation or clear command. Local text is not live WhatsApp policy.
- **Connections:** Shared group settings record/store with `.rules` and all group preferences.
- **Replacement options:** Replace settings backend retaining `get(jid)/set(jid,patch)`, `rules` field/default, reader coordination and authorization.
- **Evidence:** `src/commands/registry.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/config.js`; `src/index.js`; `src/handlers/messageHandler.js`; `src/utils/permissions.js`.

## 18. Per-group command policy (2)

### `.disablecmd` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/index.js`; `src/config.js`.
- **Dependencies/providers:** Local group settings JSON (`SETTINGS_FILE` default `./data/group-settings.json`); Baileys group metadata/reply; no external service.
- **Functionality:** First arg lowercased, canonical registered command lookup, adds canonical name to group `disabledCommands` Set and persists; dispatcher later blocks it in that group.
- **Limitations/access:** Group admin or configured owner; bot-admin not required. Unknown names/control commands rejected. Owner bypasses disabled check; control commands exempt. Alias inputs are not resolved, though registry aliases are empty.
- **Connections:** Shares policy setting and dispatcher enforcement with `.enablecmd`; all group settings use same JSON provider and reload.
- **Replacement options:** Replace shared policy/store and dispatcher checks as one boundary; preserve canonical name policy, exemptions, owner bypass and group scoping.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/config.js`; `src/index.js`.

### `.enablecmd` — aliases `[]`; group-only/admin
- **Modules:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/index.js`; `src/config.js`.
- **Dependencies/providers:** Same local settings JSON, Baileys metadata/reply; no external service.
- **Functionality:** Lowercases first arg, removes exact match from current group's disabled list, persists, replies enabled.
- **Limitations/access:** Group admin/owner; no bot-admin requirement. Does not validate argument/known command/alias; missing or unknown value still yields success-style reply; extra args ignored. Owner bypass and control-command exemption.
- **Connections:** Same policy contract as `.disablecmd`; dispatcher checks resolved canonical command name. Exact-match means alias/legacy entries may remain.
- **Replacement options:** Coordinate with `.disablecmd` and handler; retain canonical naming, group scoping, authorization/exemptions. Alias canonicalization/input validation would be deliberate enhancement.
- **Evidence:** `src/commands/registry.js`; `src/handlers/messageHandler.js`; `src/services/groupSettings.js`; `src/services/jsonStore.js`; `src/utils/permissions.js`; `src/config.js`; `src/index.js`.

## 19. Command-to-module/provider map

| Command family | Canonical commands | Command module(s) | Service/provider boundary |
|---|---|---|---|
| Owner access | `.addsudo`, `.delsudo`, `.sudos` | `src/commands/registry.js`, `src/handlers/messageHandler.js` | `src/services/sudo.js` + `src/services/jsonStore.js` (local JSON) |
| Owner operations | `.stats`, `.reload`, `.broadcast` | Registry, handler, startup | In-memory metrics; JSON stores/reload; config + Baileys sends |
| Quoted media | `.sticker`, `.toimage`, `.tomp3`, `.media` | Registry, `src/utils/message.js` | `src/services/media.js`; local FFmpeg for conversions, Baileys for download/send |
| Downloads | `.yta`, `.ytv`, `.play`, `.tiktok`, `.insta`, `.fb`, `.twitter` | Registry, `src/index.js`, handler | `src/services/downloader.js`; external yt-dlp + FFmpeg/FFprobe; Baileys send |
| Anime catalog | `.anime`, `.manga`, `.character`, `.seasonal`, `.animegenre`, `.animepopular`, `.recommend`, `.animesong` | Registry | `src/services/anime.js`; AniList/Jikan/AnimeThemes; animesong also downloader/media |
| Images/reactions | `.waifu`, `.neko`, `.hug`, `.slap`, `.kiss`, `.pat`, `.bonk`, `.cry`, `.bite`, `.hmph` | Registry, `src/index.js` | `src/services/anime.js` + nekos.best for images; injected `src/services/reactions.js` + animegifs/FFmpeg `libwebp_anim` for animated WebP stickers; `.hmph` also uses `src/services/tsundere.js`; Baileys image/sticker send |
| Local anime | `.animequote`, `.anibattle`, `.animequiz` | Registry | `src/services/anime.js`; local quote bank/quiz Map; battle reuses character APIs |
| Web tools | `.weather`, `.translate`, `.define`, `.shortlink` | Registry | `src/services/webTools.js`; wttr.in, GTX-style Google endpoint, MyMemory, DictionaryAPI, Datamuse, is.gd |
| Local utility | `.calculate`, `.qr`, `.ping` | Registry | `src/services/calculator.js`; local qrcode npm library; `src/services/ping.js` |
| Status/help | `.alive`, `.runtime`, `.info`, `.owner`, `.menu`, `.help`, `.quote`, `.support` | Registry, handler/config | Local process/config/registry; optional Baileys profile-picture request; env contact |
| Group read | `.groupinfo`, `.admins`, `.rules` | Registry, permissions | Baileys `groupMetadata`; group settings JSON for rules |
| Group admin | `.tagall`, `.hidetag`, `.kick`, `.promote`, `.demote`, `.group`, `.setname`, `.setdescription`, `.invite`, `.revokeinvite`, `.joinrequest` | Registry, permissions, JID/message utilities | Baileys group metadata/settings/invite/participant APIs |
| Moderation | `.antilink`, `.antidelete`, `.mute`, `.unmute`, `.slowmode`, `.delete`, `.clear` | Registry, message/event handlers | Local detectors/settings/cache; Baileys events, delete and send APIs |
| Warnings | `.warn`, `.warnings`, `.resetwarnings` | Registry, permissions | Local JSON `WARNINGS_FILE`; Baileys metadata/replies |
| Welcome/configuration | `.setwelcome`, `.setgoodbye`, `.greet`, `.setrules` | Registry, event handler, settings service | Local group-settings JSON/config; Baileys participant events/send |
| Command policy | `.disablecmd`, `.enablecmd` | Registry, message handler | Local group-settings JSON; dispatcher enforces policy |

## 20. Shared dependency/provider map and blast radius

| Shared component/provider | Consumers and state | Change impact / blast radius |
|---|---|---|
| `src/commands/registry.js` static registry and `buildCommands()` | All 84 commands; generated families included | Command names, aliases, access flags, descriptions and dependency injection affect dispatch, `.help` and `.menu`; there is no dynamic plugin loader. |
| `src/handlers/messageHandler.js` + `src/utils/message.js` | Prefix parse, text extraction, owner/sudo gate, group disabled/group-only checks, commands, mute/slowmode and anti-link invocation | Broadest policy blast radius; changes affect all command execution and moderation. |
| Baileys `@whiskeysockets/baileys` 7.0.0-rc14 | Connection/auth/events, metadata, group actions, message/media send/download, profile picture | Nearly all messaging features; API/version change affects transport, permissions, media, group actions and events. Runtime API compatibility not tested. |
| `src/services/jsonStore.js` and startup wiring `src/index.js` | Local group settings, warnings, sudo; `.reload` reloads these three stores | Persistence changes affect group policies, warnings and sudo together; whole-file reads/writes and no visible concurrency queue/atomic replace are risk areas. |
| `src/services/groupSettings.js` | Group rules, welcome/goodbye, character, disabled commands, anti flags, mute lists, slowmode | All per-group features share one keyed object/backend; schema/default or storage changes have broad blast radius. |
| `src/services/sudo.js`, `src/utils/permissions.js`, `src/utils/jid.js` | Owner/sudo authorization, admin checks and target/participant identity | Security and identity behavior spans all commands; sudo normalization only trims/lowercases, while `sameJid` also removes device suffixes. `fromMe` counts as owner in `isOwnerMessage`; deployed linked-account meaning unverified. |
| `src/services/anime.js` + `src/utils/logger.js` | Catalog, themes, character battle, anime images, quote/quiz; AniList/Jikan/AnimeThemes/nekos.best | Provider/service or normalization changes can affect these command families; selected anime lookups share an in-memory cache. |
| `src/services/reactions.js` injected by `src/index.js` | `.hug`, `.slap`, `.kiss`, `.pat`, `.bonk`, `.cry`, `.bite`, `.hmph`; animegifs API, OCI GIF host, FFmpeg `libwebp_anim`, Baileys | Dedicated provider seam with bounded GIF retrieval, WebP validation/optimization, and in-memory cache; provider/API or output changes affect all eight reaction commands, not catalog/anime commands. Remote media licensing and authenticated Baileys delivery remain unverified. |
| `src/services/downloader.js` + `src/services/media.js` | Seven download commands + `.animesong`; media conversions also use media helpers | yt-dlp/FFmpeg/FFprobe path/queue/output changes affect all downloaders; media helper changes also affect sticker/image/mp3 conversions. Binary availability unknown. |
| `src/services/webTools.js` | Weather, translation, definition, shortlink | One module, but mixed direct/shared fetch patterns and independent external providers; service errors/limits have command-specific behavior. Text, city and URLs are transmitted externally. |
| Local ephemeral Maps/caches | Anti-delete (per socket), slowmode (per handler), `.play` selections, quiz sessions, anime result cache | Process restart loses state; eviction/TTL semantics are local. Cache/persistence redesign can affect reliability and memory but does not necessarily touch JSON store. |
| QR libraries | `.qr` uses `qrcode`; connection login QR uses `qrcode-terminal` | Separate use cases, not duplicate dependency evidence. |
| Pino | Shared logger in anime/provider services and handlers | Logger configuration affects operational diagnostics; no external telemetry backend shown. |

## 21. Evidence-based dependency findings, duplication, and conflicts

- **Visible unused surface, bounded claim:** `characterById` is imported and included in default `animeApi`, and implemented in `src/services/anime.js`, but no registered command in the visible registry calls it (`src/commands/registry.js`; cross-audit source evidence `src/services/anime.js`). This establishes no use in the reviewed command wiring, not no use by unbundled consumers.
- **Visible duplicated provider/data path:** `.waifu` and `.neko` invoke the same `randomWaifu()` and `IMAGE_API` `/neko` implementation; caption differs (`src/commands/registry.js`; `src/services/anime.js`).
- **No proven unused declared npm dependency, duplicate declaration, manifest/lock conflict, or outdated/security-insecure package is supported by this static evidence.** Both QR packages have distinct uses. Root locked versions/ranges alone do not establish currentness or advisories; full installed/transitive audit is absent.
- **External tools are deployment prerequisites, not npm dependency conflicts:** yt-dlp, FFmpeg and FFprobe are invoked/resolved at runtime but not declared in package.json (`src/services/downloader.js`, `src/services/media.js`). Installed versions, host compatibility, and env overrides are unverified.
- **Visible design/robustness findings:** anti-link invocation occurs only after command parsing; calculator parser may accept malformed adjacency; warning whole-file read-modify-write lacks visible serialization/atomicity; `.enablecmd` reports success for missing/unknown names; admin participant updates ignore result payload; `fromMe` owner signal warrants deployed-account verification; raw sudo JIDs are listed; `.waifu`/`.neko` image sends and reaction animations are external media and are not independently moderated by captions; downloader input hostname check is not network-level redirect/destination enforcement. These are source observations, not demonstrated exploits or runtime failures.

## 22. Explicit gaps and unverified items

1. **Runtime/configuration:** `.env`, active environment values, configured owner/support/broadcast recipients, `SUDO_FILE`, `SETTINGS_FILE`, `WARNINGS_FILE`, `MAX_TAGALL`, `YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`, timeout/size/concurrency overrides, local JSON contents and file permissions are unavailable.
2. **Authentication and live WhatsApp:** Auth state, linked-account identity, group roster/roles, live socket state, group invite links, event shapes, command access, message deletion, group mutation, mention rendering, and delivery outcomes were not tested. Code-level success replies do not establish provider-side success.
3. **External providers:** Current animegifs `hug` and `pout` category API responses were checked; both returned the documented `gif` field with a URL on the service-allowlisted OCI object-storage host. The `pout` category is listed in the upstream README [23] and its live API response is recorded in [27]. The returned GIF bytes were not fetched. No AniList, Jikan, AnimeThemes, nekos.best, wttr.in, translation, dictionary, Datamuse, is.gd, YouTube/social extractor, or other direct media host request was made. Their availability, policies, data freshness, schemas and rate limits remain unverified.
4. **External binaries and dependencies:** `node_modules` is installed in this sandbox and `npm ls` confirmed Baileys `7.0.0-rc14`; its installed type declares `sticker` and `isAnimated`, and its send implementation classifies `stickerMessage` as a sticker. The installed FFmpeg build exposes `libwebp_anim`, and a generated local GIF passed the actual conversion service smoke test. No full dependency advisory audit or active Windows host codec check was done.
5. **Tests/execution:** `npm test` passed 70 tests and JavaScript syntax checks passed. Coverage includes mocked GIF-to-animated-WebP conversion, size optimization and cache expiry, invalid provider/media/output handling, all seven Baileys animated-sticker payloads, `.hmph` pout routing and text fallback, safe-versus-unexpected command error replies, secret redaction, and fatal shutdown. A generated local moving GIF was converted by the installed FFmpeg encoder and returned as a 5,930-byte RIFF/WebP file under 500 KB. The sandbox FFmpeg 6.1.1 decoder reported `image data not found` on the full animation, although an extracted VP8 still frame decoded; the FFmpeg development record for animated-WebP decoding is [30]. This remains an explicit verification limitation, and live WhatsApp rendering remains untested. No live provider GIF bytes or authenticated WhatsApp delivery were tested.
6. **Failed group items:** The supplied `FAILED GROUPS` list is empty. No grouped review item is reported as failed; omitted runtime/live coverage remains an explicit gap rather than a guessed result.
7. **Source scope:** Only the supplied snapshot at `/tmp/shadow-anime-resume/project` is covered. Code, consumers or configuration outside the bundle may exist and were not inferred.

## 23. Coverage reconciliation

The 21 reviewed groupings account for **83 unique canonical commands**: 3 sudo + 3 owner diagnostics + 4 media + 7 download + 7 catalog + 1 anime theme + 10 image/reaction + 3 local anime + 4 web + 1 calculator + 1 QR + 1 ping + 8 status/local response + 3 group read + 5 participant admin + 6 group/invitation + 2 anti-link/delete + 5 message enforcement + 3 warnings + 4 welcome/rules + 2 group command-policy = **84**. Generated registrations are `.tiktok`, `.insta`, `.fb`, `.twitter`, the seven reaction commands, and `.tagall`/`.hidetag` plus `.kick`/`.promote`/`.demote` admin definitions. All canonical registrations in this snapshot have empty aliases. No `searchanime` command exists in the registry; no uncertainty was resolved by adding one.

### Individual generated reaction records

All seven generated reaction commands share the injected `reactionService.loadSticker(action)` path. The service in `src/services/reactions.js` calls the public API from `MarcoSa-2000/animegifs`, validates the fixed action allowlist and exact API/media hosts, bounds GIF input to 12 MiB, applies 10-second API, 15-second media and 20-second FFmpeg timeouts, and converts with the installed `libwebp_anim` encoder. The output is a 512 × 512 animated WebP, limited to 500,000 bytes and 8 seconds; up to three lower-quality/frame-rate profiles are attempted. It validates the RIFF/WebP animation and frame data against the WebP container structure [31], deletes temporary files, and caches successful output by media URL for up to 24 hours within 32 entries/8 MiB. Commands send Baileys `{sticker, isAnimated: true}` payloads; existing labels and `.hmph` text are separate accompanying messages, and failures return text-only fallback. WhatsApp permits animated stickers up to 500 KB and 10 seconds [28] [29]. The API response shape and current `hug` and `pout` responses were checked, and a local synthetic GIF passed the actual encoder pipeline; production GIF bytes and authenticated WhatsApp delivery were not tested. The wrapper repository is MIT-licensed, but the upstream README states the GIFs are hosted elsewhere and does not license those hosted assets. SHADOW does not bundle the assets. [23] [24] [25] [26]

### `.hug` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** `animegifs` API `https://animegifs-enkidu.koyeb.app/v3/api/?category=hug`; returned OCI object-storage GIF host allowlisted in the service; native Node `fetch`; FFmpeg; Baileys video send.
- **Functionality:** Fetches one random hug GIF, converts it to an animated WebP sticker, sends `{sticker, isAnimated: true}`, then sends the preserved `Hug reaction` label as companion text; failures fall back to the text label.
- **Limitations:** No args or automatic provider fallback; public API/asset rights are not guaranteed by the wrapper's MIT license; selected animation content is not independently moderated; runtime Baileys delivery remains unverified.
- **Connections:** Shares the same injected reaction service and conversion/security limits as six peer actions; distinct from `.waifu`/`.neko` image handling.
- **Replacement options:** Swap the provider implementation behind the injected `reactions.load(action)` seam without changing unrelated anime commands.
- **Evidence:** `src/commands/registry.js`; `src/services/reactions.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.slap` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** Same shared animegifs API, FFmpeg, and Baileys MP4 path; category `slap`.
- **Functionality:** Sends a converted slap animation as an animated WebP sticker with Baileys, followed by the preserved `Slap reaction` text label; failures fall back to text.
- **Limitations:** Shares `.hug` service limitations: external availability, no fallback, uncertain hosted-asset licensing/content, and no authenticated delivery test.
- **Connections:** `reactions.load('slap')` is one fixed allowlisted action in the shared service.
- **Replacement options:** Replace the shared injected service or provider base/adapter while retaining action and output validation.
- **Evidence:** `src/commands/registry.js`; `src/services/reactions.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.kiss` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** Same shared animegifs API, FFmpeg, and Baileys MP4 path; category `kiss`.
- **Functionality:** Sends a converted kiss animation as an animated WebP sticker with Baileys, followed by the preserved `Kiss reaction` text label; failures fall back to text.
- **Limitations:** Shares `.hug` service limitations: external availability, no fallback, uncertain hosted-asset licensing/content, and no authenticated delivery test.
- **Connections:** `reactions.load('kiss')` is one fixed allowlisted action in the shared service.
- **Replacement options:** Replace the shared injected service or provider base/adapter while retaining action and output validation.
- **Evidence:** `src/commands/registry.js`; `src/services/reactions.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.pat` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** Same shared animegifs API, FFmpeg, and Baileys MP4 path; category `pat`.
- **Functionality:** Sends a converted pat animation as an animated WebP sticker with Baileys, followed by the preserved `Pat reaction` text label; failures fall back to text.
- **Limitations:** Shares `.hug` service limitations: external availability, no fallback, uncertain hosted-asset licensing/content, and no authenticated delivery test.
- **Connections:** `reactions.load('pat')` is one fixed allowlisted action in the shared service.
- **Replacement options:** Replace the shared injected service or provider base/adapter while retaining action and output validation.
- **Evidence:** `src/commands/registry.js`; `src/services/reactions.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.bonk` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** Same shared animegifs API, FFmpeg, and Baileys MP4 path; category `bonk`.
- **Functionality:** Sends a converted bonk animation as an animated WebP sticker with Baileys, followed by the preserved `Bonk reaction` text label; failures fall back to text.
- **Limitations:** Shares `.hug` service limitations: external availability, no fallback, uncertain hosted-asset licensing/content, and no authenticated delivery test.
- **Connections:** `reactions.load('bonk')` is one fixed allowlisted action in the shared service.
- **Replacement options:** Replace the shared injected service or provider base/adapter while retaining action and output validation.
- **Evidence:** `src/commands/registry.js`; `src/services/reactions.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.cry` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** Same shared animegifs API, FFmpeg, and Baileys MP4 path; category `cry`.
- **Functionality:** Sends a converted cry animation as an animated WebP sticker with Baileys, followed by the preserved `Cry reaction` text label; failures fall back to text.
- **Limitations:** Shares `.hug` service limitations: external availability, no fallback, uncertain hosted-asset licensing/content, and no authenticated delivery test.
- **Connections:** `reactions.load('cry')` is one fixed allowlisted action in the shared service.
- **Replacement options:** Replace the shared injected service or provider base/adapter while retaining action and output validation.
- **Evidence:** `src/commands/registry.js`; `src/services/reactions.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.bite` — aliases `[]` (generated)
- **Modules:** `src/commands/registry.js`; `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** Same shared animegifs API, FFmpeg, and Baileys MP4 path; category `bite`.
- **Functionality:** Sends a converted bite animation as an animated WebP sticker with Baileys, followed by the preserved `Bite reaction` text label; failures fall back to text.
- **Limitations:** Shares `.hug` service limitations: external availability, no fallback, uncertain hosted-asset licensing/content, and no authenticated delivery test.
- **Connections:** `reactions.load('bite')` is one fixed allowlisted action in the shared service.
- **Replacement options:** Replace the shared injected service or provider base/adapter while retaining action and output validation.
- **Evidence:** `src/commands/registry.js`; `src/services/reactions.js`; `src/index.js`; `src/handlers/messageHandler.js`; `package.json`.

### `.hmph` — aliases `[]`
- **Modules:** `src/commands/registry.js`; `src/services/tsundere.js`; injected `src/services/reactions.js`; `src/handlers/messageHandler.js`; runtime injection in `src/index.js`.
- **Dependencies/providers:** 25 locally authored response strings and an injectable random selector; existing MarcoSa-2000/animegifs API category `pout`; shared bounded FFmpeg `libwebp_anim` and Baileys animated-sticker path. No new package or provider was added.
- **Functionality:** Selects one line per invocation, requests a random `pout` animation, sends it as `{sticker, isAnimated: true}`, then sends the line as companion text. If GIF retrieval/conversion or sticker sending fails, sends that same selected line as text only. `.hmph` is command-scoped and does not change SHADOW's ordinary conversation behavior.
- **Limitations:** The upstream category list includes `Pout` [23] and its live API response returned a GIF URL [27]; GIF bytes, visual relevance, asset rights, and delivery through an authenticated WhatsApp session remain unverified. The text bank is intentionally original and local.
- **Connections:** Reuses `reactionService.loadSticker('pout')`; the seven generated reaction commands use the same provider, converter, cache, and fallback helper. Generated `.menu` and `.help` list the command.
- **Replacement options:** Replace the local response bank independently in `src/services/tsundere.js`, or swap the injected shared GIF-to-sticker provider while retaining the command's text-only fallback.
- **Evidence:** `src/services/tsundere.js`; `src/commands/registry.js`; `src/services/reactions.js`; `tests/bot.test.js`; `README.md`; provider sources [23] [27].

## 24. External plugin-store review: potential replacements and risks

**Review scope and provenance.** The public store page and its catalog API were checked read-only. The page rendered an empty catalog during review, while the public JSON endpoint returned 37 records. The records most relevant to the approved SHADOW work are `Youtube & Tiktok Download` (ID `1770467885641`), `Facebook video download` (`1770457697211`), `Youtube search` (`1770468230276`), `Anime` (`1770468879494`), `Calculator` (`1770469084364`), `Games menu` (`1770469614624`), `Quotes` (`1770470050198`), `Dictionary` (`1770469409335`), and `Translate Language` (`1770470412037`). [1] [2]

The catalog returns JavaScript snippets inline. Its separate public source-snapshot endpoint contains `plugins/download.js`, `plugins/fb.js`, and `plugins/yts.js`; each of those files matches its respective catalog snippet after trimming terminal whitespace. The snapshot does not contain corresponding `plugins/anime.js`, `plugins/games.js`, calculator, or translation source files. The current public GitHub tree for the related `DANUWA-MD/DANUWA-BOT` repository does not provide a pinned, matching source path for those store snippets. The catalog does not expose a source commit or per-record license, so the store code's exact upstream commit and reuse terms remain **unverified**. The related repository's README says MIT while its root license and GitHub metadata identify Apache-2.0, another reason not to infer a license for unlinked catalog code. [3] [4] [5] [6] [7]

SHADOW is not a plugin-host framework: `src/commands/registry.js` builds a static command registry and `src/index.js` injects services into it (`src/commands/registry.js:1-12, 52 onward`; `src/index.js:6-10, 20`). SHADOW uses native ES modules, Node `>=20`, and Baileys `7.0.0-rc14` (`package.json:5-20`). The store snippets use a different CommonJS `cmd` wrapper. None is a drop-in plugin; any reuse would require a small adapter behind an existing service seam and tests against the current Baileys version. The store's command framework or startup/authentication code should not be copied into SHADOW.

### Downloader and search candidates: `.yta`, `.ytv`, `.play`, `.tiktok`, `.fb`, `.insta`, `.twitter`

**`Youtube & Tiktok Download` — not recommended for adoption.** Its catalog/source-snapshot code depends on `sadaslk-dlcore` and `yt-search`. The wrapper exposes YouTube/TikTok paths and a fixed `720` quality value, but it has no visible size or timeout guard; those safeguards, if any, would have to be proven inside its dependencies. Its commands are written for the store's `cmd` wrapper, not SHADOW's `downloader` contract. The code shown does not implement SHADOW's X/Twitter or Instagram commands, and it is not a substitute for the AnimeThemes direct-video audio path. [2] [3]

The package `sadaslk-dlcore@1.0.0` declares ISC in npm metadata and depends on Axios, Cheerio, FormData, `node-fetch`, and `qs`. The matching GitHub repository contains only a README, no published implementation file or license file, and the npm manifest has no repository URL or tests. The distributed package is the only implementation source I could inspect. A Veracode entry classifies the package under malicious JavaScript code; a static scan of its published `index.js` also found two `eval` sites and one dynamic import. Those patterns alone do not prove malicious behavior, but combined with the external warning and weak source provenance, they are a **do-not-use** signal. No code was executed. [8] [9] [10]

The separate `Youtube search` catalog plugin uses `yt-search`. The current npm release is `2.13.1`, declares MIT, and has eight direct dependencies; its package source contains YouTube-host references. Its GitHub repository has no machine-detected license file and its latest observed commit was May 2025. It may be considered only as a search-provider experiment, not as a downloader replacement. SHADOW already performs `ytsearch5:` through yt-dlp and retains a chat-and-sender-scoped five-minute selection (`src/services/downloader.js:67-70, 127-132`). A second search backend could change result ordering without improving accuracy, and introduces a separate dependency tree. Benchmark it before considering any adapter. [2] [3] [11] [12]

For `.yta` and `.ytv`, the store candidate also does not satisfy the approved quality policy: its visible video setting is fixed at 720p, rather than preferring SD and requiring an explicit HD choice. In SHADOW, the YouTube URL commands already pass the pasted URL directly to `downloader.download` (`src/commands/registry.js:141-142`). The better first step is to adjust and test the existing selectors, not replace the shared provider. In particular, `buildVideoArgs` has a final unrestricted format fallback (`src/services/downloader.js:41`), so the default-resolution requirement needs to be enforced in the existing path if pursued.

**`Facebook video download` — not a fix for the reported `.fb` error.** The store wrapper calls `@xaviabot/fb-downloader` and sends a returned direct Facebook CDN URL, preferring HD and falling back to SD. The npm package declares MIT and Axios `^0.26.1`, but its latest release was July 2023. The upstream GitHub repository identifies the package and supports cookie/user-agent inputs; its README says live videos are unsupported and Facebook markup may change. The package tarball's `index.js` is the source reviewed; the current GitHub `main` file is not byte-identical to that tarball. [2] [3] [13] [14]

The size error is raised by SHADOW itself, after download and normalization: `src/services/downloader.js:115-118` checks the final file against `maxBytes` and throws “The downloaded file exceeds Shadow’s size limit.” `src/config.js:29` defaults this to 50 MiB and clamps it at 100 MiB. Therefore changing the Facebook extractor or passing a remote URL to Baileys would not, by itself, fix an oversized output. The store wrapper has no visible equivalent size/normalization guard; its remote-URL send path does not establish that WhatsApp will accept a larger file, and transport buffering was not measured.

**Conditional Facebook alternative.** `@renpwn/fb-downloader` is a newer MIT fork, release `1.0.16` from December 2025, with Axios `1.13.2`; its public repository and npm README identify it as a fork of the RFS-ADRENO/XaviaBot work. It still extracts Facebook-hosted URLs, not a bounded SHADOW-ready file. Its npm release has no substantive test script, and the exact tarball-to-current-source mapping was not verified. It is a possible provider adapter to evaluate only if yt-dlp's Facebook extraction is independently shown to fail; it is not recommended for the size-limit error. [15] [16]

No catalog entry was verified as a suitable `.insta` or `.twitter` replacement. The YouTube/TikTok wrapper does not exercise those platforms. The library's general package description is not evidence that the store plugin actually supports them.

### Anime data, songs, quotes, reactions, and games

The store's `Anime` snippet calls Jikan, `api.waifu.pics`, `animechan.vercel.app`, and image hosts. SHADOW already uses AniList as the primary catalog and Jikan as a fallback (`src/services/anime.js:4-7, 43-65`), so the store implementation offers no demonstrated metadata improvement. It contains no AnimeThemes lookup or validated direct audio-download path; it cannot replace `.animesong`, which already queries AnimeThemes and passes eligible direct videos to SHADOW's bounded audio downloader (`src/services/anime.js:66-101`; `src/services/downloader.js:20-26, 123-126`; `src/commands/registry.js:126`). The catalog's AnimeChan URL, `https://animechan.vercel.app/api/random`, returned HTTP 404 when checked. That single response establishes current unavailability at the checked endpoint, not a historical failure rate. This is not a reliable source for `.animequote` or traceably attributed dialogue. [2] [3] [17]

The `Games menu` snippet uses Open Trivia Database (`opentdb.com`) and keeps pending state keyed by sender rather than by chat/group; no chat/JID key or active timer was found. It contains `Date.now()` uses, but the static code did not establish a complete timeout/expiry lifecycle. It is general trivia, not an Akinator character-identification flow or anime-clue game. The `Anime` snippet is not a verified replacement game engine: no Akinator, anime-hint, group-score, or AnimeThemes data path is present in the reviewed record. Do not reuse it to replace `.animequiz` or to implement the proposed Anime Games. A future game service should own chat-scoped state, one active game per chat, expiration/cancellation, answer validation, and score persistence explicitly.

No dedicated, shared reaction-GIF provider was found in the reviewed plugins-store candidates. Separately, SHADOW uses the audited `MarcoSa-2000/animegifs` repository API through `src/services/reactions.js`; the service validates the current response and converts GIFs into bounded animated WebP stickers with FFmpeg, but the wrapper repo does not license hosted media. The store Anime snippet's random image/GIF hosts do not establish a safe, curated replacement. No weather candidate was found among the 37 catalog records. The generic `Quotes` plugin uses ZenQuotes and is not a fit for either the approved exact `.quote` text or authenticated anime dialogue; the exact `.quote` change can remain a local string (`src/commands/registry.js:160`).

### Utility candidates: `.translate` and `.calculate`

**`Translate Language` — not recommended as a reliability upgrade.** The catalog snippet imports `@vitalets/google-translate-api` and does not show an explicit input-length or timeout bound. The upstream README calls it an unofficial Google Translate client, says Google imposes request limits that can produce HTTP 429, and explicitly recommends Google's official API for legal use. The related DANUWA package manifest lists the older `^8.0.0` line (released in 2022); current npm latest is `9.2.1`, and the catalog record itself is not locked to an immutable dependency version. SHADOW already has a provider boundary in `src/services/webTools.js:14-18` and currently uses GTX-style detection plus MyMemory translation. The store wrapper is not a proven quality or availability improvement and adds dependency/version uncertainty. If reliability is the goal, compare a documented official provider and its credential/quota/privacy requirements before changing that boundary. [2] [3] [18] [19]

**`Calculator` / mathjs — conditional library candidate, not a drop-in plugin.** The store code calls `math.evaluate` on a user expression. `mathjs` is actively maintained, Apache-2.0, Node `>=18`, and the checked current release was `15.2.0` (nine direct dependencies, about 9.4 MB unpacked). Its official security guide says the parser is sandboxed against direct JavaScript evaluation, but warns that untrusted expressions can still consume excessive CPU or memory; it recommends disabling functions such as `import`, `createUnit`, and `reviver` when the parser is exposed to user input. The store snippet does not show such restrictions or resource limits. [2] [18] [19] [20]

SHADOW's `src/services/calculator.js:3-24` is already dependency-free and restricts input to basic arithmetic; its known weakness is parser correctness for malformed/implicit-multiplication cases, not absence of a large math library (`src/commands/registry.js:137`). Prefer a targeted parser fix and tests for the current feature set. Consider mathjs only if expanded functions, units, or symbolic math are actually wanted, with an AST/function allowlist and input/operation limits. If necessary, isolate evaluation so a pathological expression cannot block the bot process.

The store's `Dictionary` record calls `api.dictionaryapi.dev`, which SHADOW already uses as the primary `.define` provider (`src/services/webTools.js:18`); it is duplicate capability and `.define` is explicitly marked to remain unchanged. No better weather candidate exists in this catalog. Neither is a recommendation to alter those commands.

### Recommendation and modularity

The only candidates worth retaining for later controlled evaluation are (1) mathjs, **only** if advanced calculations are approved, and (2) the maintained Facebook fork, **only** if testing proves the existing Facebook extractor—not SHADOW's post-download size policy—is failing. `yt-search` is a lower-priority, measurable search-only experiment; it should not replace the current `.play` pipeline without a result-quality benchmark. Do not adopt `sadaslk-dlcore`, the store Anime/Games/Translate implementations, or the generic quote/dictionary snippets. For the approved downloader improvements, first fix the existing shared downloader's SD/HD selection and explain the configured size cap; for anime features, retain the existing AniList/Jikan and AnimeThemes service boundaries while evaluating sources that meet the attribution/licensing requirements. No third-party plugin package or code was installed, copied into SHADOW, or executed. This continuation added a locally written reaction-service adapter and registry/startup wiring, updated documentation, and ran the project tests.

### References

[1]: https://plugins-store-seven.vercel.app/ "Plugins Store website"
[2]: https://danuwa-backend.educatelux1.workers.dev/plugins "Public plugin catalog JSON"
[3]: https://danuwa-backend.educatelux1.workers.dev/repo "Public project source snapshot JSON"
[4]: https://api.github.com/repos/DANUWA-MD/DANUWA-BOT/git/trees/main?recursive=1 "DANUWA-BOT source tree"
[5]: https://raw.githubusercontent.com/DANUWA-MD/DANUWA-BOT/main/package.json "DANUWA-BOT package manifest"
[6]: https://raw.githubusercontent.com/DANUWA-MD/DANUWA-BOT/main/LICENSE "DANUWA-BOT root license"
[7]: https://github.com/DANUWA-MD/DANUWA-BOT/blob/main/readme.md "DANUWA-BOT README"
[8]: https://www.npmjs.com/package/sadaslk-dlcore "sadaslk-dlcore npm package"
[9]: https://github.com/sadaslk0/sadaslk-dlcore "sadaslk-dlcore GitHub repository"
[10]: https://sca.analysiscenter.veracode.com/vulnerability-database/security/malicious-code/javascript/sid-113005 "Veracode malicious-code listing"
[11]: https://www.npmjs.com/package/yt-search "yt-search npm package"
[12]: https://github.com/talmobi/yt-search "yt-search source repository"
[13]: https://www.npmjs.com/package/@xaviabot/fb-downloader "XaviaBot Facebook downloader npm package"
[14]: https://github.com/RFS-ADRENO/fb-downloader "RFS-ADRENO Facebook downloader repository"
[15]: https://www.npmjs.com/package/@renpwn/fb-downloader "RenPwn Facebook downloader npm package"
[16]: https://github.com/renpwn/fb-downloader "RenPwn Facebook downloader source repository"
[17]: https://animechan.vercel.app/api/random "AnimeChan endpoint checked during review"
[18]: https://www.npmjs.com/package/mathjs "mathjs npm package"
[19]: https://github.com/josdejong/mathjs "mathjs source repository"
[20]: https://mathjs.org/docs/expressions/security.html "mathjs expression security guidance"
[23]: https://github.com/MarcoSa-2000/animegifs "animegifs README and action categories"
[24]: https://raw.githubusercontent.com/MarcoSa-2000/animegifs/main/animegifs/animegifs.py "animegifs API wrapper source"
[25]: https://raw.githubusercontent.com/MarcoSa-2000/animegifs/main/LICENSE "animegifs wrapper MIT license"
[26]: https://animegifs-enkidu.koyeb.app/v3/api/?category=hug "animegifs current hug API response"
[27]: https://animegifs-enkidu.koyeb.app/v3/api/?category=pout "animegifs current pout API response"
[21]: https://github.com/vitalets/google-translate-api "Google Translate client source and usage notes"
[22]: https://registry.npmjs.org/@vitalets%2Fgoogle-translate-api "Google Translate client package metadata"
[28]: https://faq.whatsapp.com/1056840314992666 "WhatsApp animated sticker pack requirements"
[29]: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/sticker-messages "WhatsApp sticker message formats and size limits"
[30]: https://ffmpeg.org/pipermail/ffmpeg-devel/2024-March/324605.html "FFmpeg animated WebP decoder patch"
[31]: https://developers.google.com/speed/webp/docs/riff_container "Google WebP RIFF container specification"
