# SHADOW identity audit

## Root cause

The creator identity was not present in the Gemini system instruction. `src/services/aiBrain.js` supplied personality and tool rules, but it did not supply the configured creator name as a trusted fact. As a result, a creator question was left to model inference from conversation context, allowing a normal user’s claim or a hallucinated identity to be returned. This did not mean that the authorization code accepted the user as owner; creator recognition in the generated answer and command authorization were separate paths.

The active request path is:

`src/handlers/eventHandler.js` → `src/handlers/messageHandler.js` → `parseShadowAddress()` / `messageSender()` → `createGeminiBrain().run()` → Gemini `system_instruction` and `input`.

AI conversation history is keyed as `remoteJid:sender`, so private chats and group participants have separate in-memory histories. Persistent memory is keyed by the same supplied user key when the tool registry is created. No memory or Gemini response grants authorization.

## Confirmed fixes

- Every Gemini and DeepSeek conversational request now includes the configured creator name as an immutable trusted identity fact.
- The instruction explicitly rejects display names, claims, conversation history, and memory as proof of ownership.
- `OWNER_LID` is supported alongside the normalized `OWNER_NUMBER` for Baileys installations that expose a LID.
- Baileys `viewOnceMessageV2`, `viewOnceMessageV2Extension`, edited, ephemeral, and document-caption wrappers are unwrapped before text/caption extraction.
- Existing owner/sudo authorization remains deterministic and independent of the model response.
- The active AI context remains scoped by chat and sender.

## Possible issues requiring local verification

- If `OWNER_NAME` is missing or stale, Shadow will faithfully report the configured fallback or stale value. Update the local `.env`; do not ask Gemini to change it.
- If a deployment exposes an owner LID, set `OWNER_LID` to the exact configured LID. Do not use a profile/display name.
- WhatsApp/Baileys payloads can vary by version. The new wrapper tests cover the supported forms, but an unrecognized future wrapper should be added to `unwrapMessage()` rather than bypassing identity checks.

## Tests

The final packaged source was installed cleanly with `npm ci --ignore-scripts` and tested with `npm test`.

Result: **94 passed, 0 failed, 0 cancelled, 0 skipped**.

The identity tests verify creator answers use the actual system/request payload, group participant extraction, private-chat sender extraction, device JID normalization, LID matching, malformed sender safety, and cross-sender context isolation.
