# Conversation persistence audit

## Confirmed causes

1. `src/services/aiBrain.js` used `createContextStore()`, which was an in-memory `Map`. Restarting Node discarded all recent conversation turns.
2. Recent history was not written to disk, so shutdown could not recover it.
3. Personal memory had a separate issue: it used the chat-plus-sender key instead of the verified sender key. That is fixed independently in `memory.js`.
4. Creator recognition lacked a trusted creator fact in the AI system instruction. That is fixed independently in `aiBrain.js`.

## Fix and schema

Conversation history is stored in `HISTORY_FILE`, defaulting to `data/conversation-history.json`. The top-level object is keyed by `chatJid:normalizedSenderJid`, with values shaped like:

```json
{
  "turns": [
    { "role": "user", "content": "..." },
    { "role": "model", "content": "..." }
  ],
  "updatedAt": 1790000000000
}
```

History is bounded by `HISTORY_MAX_TURNS` (default 6, maximum 20) and the existing 30-minute context TTL. Group participants remain separate because the participant JID is part of the key. Personal memory does not use this key; it uses the normalized verified sender identity.

Writes are serialized per conversation, persisted through the existing JSON store, and written atomically via a temporary file followed by rename. Malformed turns are ignored. `SIGINT` and `SIGTERM` wait for active AI work and queued history writes before closing the socket and exiting.

No automatic migration merges old in-memory history because there was no durable conversation-history file to migrate safely. Existing personal-memory records with ambiguous old chat-based keys are not merged automatically either.

## Verification

The packaged source was installed with `npm ci --ignore-scripts` and tested with `npm test`.

Result: **101 passed, 0 failed, 0 cancelled, 0 skipped**.

Tests cover recreation after restart, actual Gemini request payload history, bounded and malformed history, concurrent serialized updates, cross-chat personal memory, creator identity, sender isolation, failed writes, and existing commands/model routing.

A local automated benchmark was not added because provider latency depends on the user's network and Gemini service. The local complete suite completed in approximately 0.76 seconds; this measures local code and mocked providers, not live WhatsApp or Gemini latency.
