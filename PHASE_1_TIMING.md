# Phase 1: command-intent and timing instrumentation

## Scope

This phase narrows natural-language command routing so descriptions no longer contribute arbitrary keywords to intent matching. Exact command names and aliases still route, and selected imperative/request forms and known paraphrases remain supported. Generic action words are no longer matched against recent chat history; the existing narrow `hd` follow-up behavior is retained. No personality/system prompt, model selection/configuration, memory behavior, permission policy, command implementation, or history persistence semantics were changed. This phase does not optimize persistence or add concurrency.

## Measurements available

The runtime emits duration-only debug events for:

- `Message-to-reply processing completed`: elapsed from handler receipt of the message through the AI handler's completion (milliseconds).
- `Conversation history queue wait completed`: per-chat queue wait before a queued history operation begins (milliseconds).
- `Conversation history write completed`: elapsed time for the queued operation, including its store update wait/write (milliseconds).
- `Gemini provider request completed`: elapsed time for each individual Gemini interactions API request, including follow-up requests after tools; failures/timeouts also produce a duration event.
- `Tool execution completed`: elapsed time for each individual tool execution, including failures/timeouts (milliseconds).
- `WhatsApp reply send completed`: elapsed time for the reply send call (milliseconds).

These added measurements do not log message contents, tool arguments/results, phone numbers/JIDs, or message IDs. They use the application's existing debug logger, so availability depends on debug logging being enabled. Durations are rounded to integer milliseconds. Other pre-existing operational logs have not been changed.

No live Gemini provider request was made during validation. The observed Gemini timing events in tests came from mocked clients and are not representative of provider/network latency.

## Validation

- Targeted command-intent/AI regressions: **11 passed, 0 failed**.
- Full test suite (`npm test`): **135 passed, 0 failed**.
- Syntax/package checks (`npm run check`, plus `node --check` for `src/services/conversationHistory.js` and `src/services/aiBrain.js`): **passed**.
