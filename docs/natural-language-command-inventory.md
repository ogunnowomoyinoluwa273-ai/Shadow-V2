# Natural-language command inventory and audit status

## Current implementation

The existing `run_existing_command` tool was retained. Its command enum is generated from `commands.allCommands`, so the canonical registered commands are not silently omitted from the Gemini schema. The application invokes the existing `command.run()` handler with the current `sock`, `message`, quoted-message context, mapped `args`, `rawArgs`, and reply callback.

Routing no longer depends on a manually maintained list of command names. It derives intent terms from each registered command’s canonical name, aliases, and description, and combines those terms with a small generic action-request detector. This keeps specialized tools (calculation, weather, anime search, memory, and sticker tools) available while independently exposing `run_existing_command` whenever the registry indicates an action or a recent command-context follow-up. Adding a registered command therefore adds its routing terms automatically.

The current canonical inventory is:

`aimodel`, `addsudo`, `delsudo`, `sudos`, `stats`, `reload`, `broadcast`, `sticker`, `toimage`, `tomp3`, `media`, `weather`, `anime`, `manga`, `character`, `seasonal`, `animesong`, `waifu`, `neko`, `animequote`, `animegenre`, `animepopular`, `hmph`, `anibattle`, `animequiz`, `recommend`, `translate`, `calculate`, `define`, `shortlink`, `qr`, `yta`, `ytv`, `play`, `tiktok`, `insta`, `fb`, `twitter`, `ping`, `alive`, `runtime`, `info`, `owner`, `menu`, `help`, `quote`, `groupinfo`, `admins`, `rules`, `support`, `greet`, `tagall`, `hidetag`, `delete`, `kick`, `promote`, `demote`, `group`, `setname`, `setdescription`, `invite`, `revokeinvite`, `joinrequest`, `setwelcome`, `setgoodbye`, `setrules`, `warn`, `warnings`, `resetwarnings`, `mute`, `unmute`, `slowmode`, `clear`, `antilink`, `antidelete`, `enablecmd`, and `disablecmd`.

Every item above is verified to be present in the generated command enum and to have a callable existing handler. Existing prefix dispatch remains unchanged; this integration is additive.

## Verified execution behavior

The automated tests execute and verify the following real handlers and policies:

- `ping`: arguments and handler execution through `run_existing_command`.
- `promote`: group context, participant target mapping, administrator context, and application-owned confirmation.
- `sticker`: quoted-media context is passed to the existing handler and its missing-reply failure is reported rather than converted into a false success.
- `groupinfo`: group-only rejection in a direct chat.
- `reload`: owner-only rejection for an unprivileged sender.
- `ping` in a group: disabled-command rejection through the active settings store.
- The generated schema: every registered command appears in the canonical enum.
- Routing: less-obvious phrases such as changing a group description, approving a join request, comparing characters, shortening a link, and follow-up download wording select the existing-command path.
- Routing: every command in the actual `commands.allCommands` registry is exercised by name and must expose `run_existing_command`; natural paraphrases and a follow-up such as `hd` after a YouTube-download request are also tested.

The broader existing test suite separately covers the underlying command handlers, media parsing, downloader validation, anime services, moderation behavior, and authorization utilities. Provider-backed and stateful commands are not falsely described as live-integrated merely because their names appear in the enum.

## Confirmation enforcement

Gemini cannot authorize a consequential action by returning `confirmed: true`; that field is no longer part of the tool schema and is ignored if an untrusted model sends it anyway. For consequential commands (`kick`, `promote`, `demote`, `delete`, `revokeinvite`, `broadcast`, sudo changes, `clear`, and `resetwarnings`), the application stores the exact canonical command and mapped target arguments in a short-lived pending-confirmation record keyed by verified sender and chat.

The first tool call never executes the action. SHADOW reports the exact action and target for confirmation. Only a subsequent literal confirmation such as `yes`, `confirm`, `do it`, or `go ahead` from the same verified sender and chat causes the application to replay the stored action with its private confirmation token. A model-generated token, a changed target, an expired record, a different sender, or a different chat cannot execute it.

The original handler still enforces owner/sudo, group-only, administrator, target, and disabled-command checks. Missing targets are rejected before a confirmation record is created.

## Routing limitations and unsupported claims

Natural-language routing is registry-derived and conversation-context-assisted, not a semantic proof that every possible paraphrase will select the desired command. The generic action detector intentionally avoids ordinary greetings and casual chat, but unusual wording that contains neither an action request nor a registered command/description term may remain ordinary conversation. When a phrase is ambiguous, lacks required arguments, refers to an unavailable provider, or requires live group state, the safe behavior is clarification or the existing handler’s error.

The following paths require live validation in the user’s WhatsApp environment and are therefore not claimed as fully verified here: external YouTube/TikTok/Instagram/Facebook/Twitter downloads; QR/image generation delivery; anime and weather provider responses; live group membership, invite, moderation, and join-request mutations; persistent settings changes; and commands whose result depends on configured environment variables or remote APIs.

No command is intentionally excluded from the schema or registry-derived routing tests. “Covered” means routing, schema exposure, safe dispatch, and handler invocation plumbing are implemented; it does not mean every external side effect has been proven against a live account in this sandbox.
