# Persistent memory audit

## Confirmed root cause

The live AI request path keyed both recent conversation history and persistent memory with `${remoteJid}:${sender}`. Recent history should be chat-specific, but personal memory should be owned by the verified sender. Therefore, a fact saved in Chat A was stored under Chat A's key and was not found when the same sender asked in Chat B.

A second retrieval issue made natural questions such as “What’s my favorite color?” too strict: the old lookup required every query token to occur in the saved sentence, including interrogative words that are not part of the fact.

## Fix

- Persistent memory keys now normalize the verified sender identity independently of chat identity and remove Baileys device suffixes.
- Recent conversational history remains keyed by chat plus sender.
- Relevant private memories are looked up using the sender key and included in the actual Gemini request input.
- Common interrogatives and spelling variants such as `favourite`/`favorite` and `colour`/`color` are normalized for lookup.
- Personal memory tools are disabled in group chats to avoid private-memory leakage.
- JSON persistence now uses a serialized atomic temporary-file write followed by rename.
- Failed writes still propagate as errors; Shadow does not claim success when storage fails.

No schema migration is required for new installations. Existing memory files created with the old chat-plus-sender keys may need a one-time migration or re-saving because the old owner cannot always be inferred safely from the key. The implementation deliberately does not merge ambiguous old records automatically.

## Tests

The complete packaged source was installed with `npm ci --ignore-scripts` and executed with `npm test`.

Result: **98 passed, 0 failed, 0 cancelled, 0 skipped**.

Coverage includes distinct chats with the same sender, restart persistence, other-user isolation, group privacy, deletion, failed writes, actual Gemini request memory context, and separate recent-history scope.
