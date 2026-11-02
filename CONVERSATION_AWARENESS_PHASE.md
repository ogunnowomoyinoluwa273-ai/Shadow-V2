# SHADOW Conversation Awareness — Phase 1

## Scope

This phase adds passive, chat-local conversation capture and selective context retrieval to the existing WhatsApp handler and Gemini brain. It does not change SHADOW's personality prompt, model selection, command implementations, authorization rules, memory semantics, or reply behavior for unaddressed conversation. Existing commands and natural-language command routing remain in place.

## Behavior

- Text-bearing messages in private chats and groups are recorded without triggering an AI reply. Existing stale-message, mute, and slow-mode handling remains in effect; recent offline messages may be retained as context but are not executed as requests. Media without extracted text is not transcribed or captured by this phase.
- Each record contains the WhatsApp chat key, sender identity, display name when available, role, message time, text, quoted-message identity/text, reply relation, and mention identities. Shadow's sent replies are recorded too.
- Private and group conversations use distinct chat keys. A private transcript is only loaded for that same private chat. Context is assembled after the existing AI permission gate; message capture does not grant permission to invoke tools or commands.
- At an addressed request, the brain selects a small relevant excerpt instead of appending the full transcript: at most 6 messages for private follow-ups and 10 for groups, bounded to approximately 6,000 characters including metadata. Quotes and their nearby turns receive priority. Group requests use the recent group discussion; private history is added only for contextual/follow-up requests. Greetings stay on the existing no-tools/lightweight route and do not receive a transcript dump.
- Clear names, direct quotes, and a uniquely supported prior reference can be resolved. If a pronoun points to multiple plausible participants, SHADOW asks who the user means instead of choosing arbitrarily.
- Old overflow is retained as an extractive recap: selected message excerpts, not a generated paraphrase. No extra Gemini call is made to summarize history.

## Bounds and persistence

Defaults in `src/config.js` are 3 hours of recent chat context, 80 stored messages per chat, at most 500 chats, and 14 days for extractive recap entries. Existing environment settings can override these defaults; no `.env` was read or changed. Message text, quoted text, and names are length-limited in storage; retrieved context has a separate request budget.

Recent chat records are cached and written in coalesced batches (40 ms by default). Pending chat writes and the in-memory transcript cache are capped by the configured chat bound. Personal user/model turns are available immediately from an in-memory cache and are persisted asynchronously; they no longer hold a completed reply open. The existing reload command now flushes history, reloads the JSON file, and invalidates both context caches. The graceful shutdown path calls `aiBrain.flush()` so pending personal and chat-history writes are drained before normal exit. Abrupt termination while writes are in flight can still lose those not-yet-durable updates.

The existing JSON history file remains the backing store. No separate database, new provider, or background service was introduced.

## Privacy and security

This phase does not add transcript, quote, or mention text to timing/debug logs; existing command-routing log behavior is unchanged. Each private chat is keyed separately from other private chats and groups; group context is shared only within that group. Authorization still occurs before model/tool execution, and conversation excerpts are explicitly treated as evidence rather than instructions or permission grants. Only text extracted by the current message utility is captured; no media transcription or OCR was added.

## Validation and measured performance

- Targeted conversation-awareness, AI, handler, persistence, and memory-continuity tests passed.
- Full suite: **480 passed, 0 failed**, in **8.575 seconds** (`npm test`). This includes the existing command-routing, permission, and general bot regressions.
- `npm run check` and `node --check` for the modified AI brain, context store/retrieval code, handler, and new test file passed.
- Synthetic delayed-storage benchmark (not a production disk measurement): recording **24 messages took 2.21 ms**, performed **0 writes before flush**, retained the configured **16-message test cap**, then persisted the batch with one mocked **80 ms** write (flush took **81.45 ms**).
- Mocked reply-path benchmark (Gemini response immediate; personal history writes each delayed **80 ms**): SHADOW returned the reply in **7.37 ms**, and the separate history drain took **79.79 ms**. This demonstrates that history persistence no longer holds that mocked reply path open; it does not measure real Gemini latency.
- No live Gemini request or live WhatsApp delivery was performed for this phase. Provider/network response time and real deployment latency are therefore **not measured** and cannot be inferred from these mocked timings.

## Limitations

The recap is extractive rather than semantic, so it preserves selected statements but does not condense an old discussion into a newly reasoned narrative. Reference resolution is intentionally conservative and may request clarification when identities are missing, duplicated, or not mentioned clearly. Messages with no text extracted by the current parser are outside this phase. Real provider/network latency remains outside the control of context retrieval and was not tested here.
