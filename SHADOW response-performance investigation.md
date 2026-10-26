# SHADOW response-performance investigation

## What caused the duplicate/interim message

The exact text `One sec—I’m still putting together a reply.` came from a seven-second `setTimeout` in `src/services/aiBrain.js`, inside `runInternal`. It sent a separate WhatsApp text whenever any Gemini response was still pending, including ordinary no-tools chat. `sendReply` later sent the actual model answer, which produced the observed two-message sequence. That timer and all unsolicited text progress messages have been removed. The thinking reaction remains asynchronous. The ordinary reply path now sends one final text, and its delayed-response regression asserts exactly one text after an 8.15-second mocked provider delay.

## Request timeout and the 32.8-second request

The attached runtime configuration selects `gemini-3.5-flash-lite` for no-tools requests and sets `GEMINI_TIMEOUT_MS` to **45,000 ms**. `config.js` maps that to `config.geminiTimeoutMs`; `aiBrain.js` uses that value for `requestTimeoutMs` when `wantsTools` is false. The earlier hard-coded 8-second cap has already been removed. Thus the user's **32,823 ms** provider call completed within its configured 45-second deadline; it was not supposed to time out at eight seconds.

At the configured deadline, `timedGeminiRequest` rejects and calls `AbortController.abort()`. Its signal is passed as `fetch_options.signal` to the Google GenAI SDK, whose installed source combines that signal with the per-attempt signal and passes it to `fetch`. The successful 32.8-second request did not reach the 45-second deadline, so it was not aborted. The existing mock timeout test checks that the signal is aborted when the configured deadline expires; the live success tests did not wait for or induce an abort.

There is one application-level `interactions.create` call for a bare greeting: greeting intent disables tools; no function call is returned; the tool loop exits without a second model request. There is no application fallback or queued retry in this path. The message handler's `seen` set deduplicates repeated delivery of the same WhatsApp message ID.

The installed Google SDK does have internal retry behavior for eligible transient HTTP/network failures (up to four retries, with a 30-second retry elapsed-time setting). The earlier 32.8-second aggregate log did not record HTTP attempt counts, so it cannot rule out a retry on that particular call. The current equivalent live app-path probe instrumented HTTP attempts and observed exactly one **HTTP 200** attempt; no retry occurred on that probe.

## Live timing and root cause

One authenticated test used the attached `.env` only in process memory and called the actual `createGeminiBrain` bare-`Shadow` path with the configured model and request settings. It did not extract or print the key, touch the `.env`, open WhatsApp auth/session files, or connect a WhatsApp session. Results:

- Model: `gemini-3.5-flash-lite`; `wantsTools: false`; configured no-tools timeout: **45,000 ms**.
- Request preparation: **5 ms**.
- One HTTP attempt returned **200**; fetch elapsed: **24,135 ms**.
- Full Gemini SDK request elapsed: **24,167 ms**.
- Thinking reaction send: **33 ms** in a mock socket; WhatsApp reply send: **0 ms** in a mock socket.
- Total `createGeminiBrain.run`: **24,173 ms**; one user-facing text was sent.

The mock socket means the 33 ms/0 ms values are not real WhatsApp timings. The user's separate live trace measured preparation at **41 ms**, reaction at **869 ms**, Gemini at **32,823 ms**, reply send at **405 ms**, and total delivery at **33,282 ms**. The reaction is launched asynchronously and is not awaited before the Gemini call. The provider is the dominant critical-path delay in that trace. The live probe's one successful HTTP attempt and 24.1-second provider wait show that this is not necessarily a retry or a second app request; response latency varies materially between calls. The previous direct minimal prompt test also returned HTTP 200 in **17,125 ms**.

Google lists `gemini-3.5-flash-lite` as stable and supports it in the Interactions API. The installed SDK is `@google/genai` **2.31.0**. There is no evidence of an invalid model or unsupported endpoint. No model switch, prompt change, or timeout reduction was made. A healthy response under ten seconds cannot be promised based on these live timings: two authenticated tests took 17.1 and 24.2 seconds, while the user's other call took 32.8 seconds.

## Changes and validation

The only functional change in this update is removing unsolicited text progress messages; the non-blocking reaction and existing configured request timeout remain. No timeout, model, generation configuration, prompt, memory semantics, permissions, or commands were changed in this update.

Regression coverage verifies no interim text and exactly one final text after a delayed mocked reply, configured-timeout cancellation, API/network failure classification, greetings, ordinary conversation, commands, and quoted follow-ups. The final full suite passed **139 tests, 0 failed** in **9,015 ms**; `npm run check`, syntax checks for the modified AI/history services, and a source scan for the removed filler all passed. The live timing above is distinct from mocked tests and does not include an actual WhatsApp send or persistent-history disk write.

## Follow-up: NVIDIA provider removal

The NVIDIA-backed DeepSeek route, model-selection router, `.aimodel` switching flow, and its credential access have now been removed from application source. `.aimodel` remains as an authorized status-only command and reports the configured Gemini conversation and tool-enabled models. Startup no longer loads or updates the old model-selection JSON file; that file and `.env` were left untouched, and no replacement provider was added. Following this cleanup, the full suite passed **135 tests, 0 failed** in **8,755 ms**; package checks and syntax checks passed.

## References

[1]: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite "Gemini 3.5 Flash-Lite model page"
[2]: https://ai.google.dev/gemini-api/docs/interactions-overview "Gemini Interactions API overview"
