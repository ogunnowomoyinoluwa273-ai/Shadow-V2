# Baileys rc14 session audit

## Evidence

The installed dependency is `@whiskeysockets/baileys@7.0.0-rc14`, resolved exactly in `package-lock.json`. Its installed `Signal/libsignal.js` reads `device-list` inside `migrateSession()` before PN-to-LID session migration. Its installed `Socket/messages-recv.js` stores PN/LID mappings and calls `migrateSession()` before entering the message-processing mutex.

The supplied failures contain the corresponding LID/PN pairs, repeated identity-change notices, transaction rollbacks, and `GroupCipher.decrypt()` failures with `No session found to decrypt message`. This matches the rc14 device-list migration failure mode documented in Baileys issue #2548, but the installed package source was checked directly rather than treating the issue workaround as authority.

The normal SHADOW startup path creates one socket and attaches one handler set per open socket. Its reconnect path had no generation guard, so a late close event from a superseded socket could schedule another connection. That was a secondary session-conflict risk, not the primary evidence in the supplied logs.

## Minimal fix

`src/connection/connect.js` wraps the multi-file auth state. Reads of `device-list` return an empty result and writes to that category are dropped. Existing files are not removed. All other auth categories, including `session`, `sender-key`, `identity-key`, `pre-key`, and app-state keys, pass through unchanged.

`src/index.js` adds a connection-generation guard and clears pending reconnect timers. Late events from an old socket are ignored, preventing overlapping sockets from sharing the same auth directory.

This does not suppress decryption errors, reset authentication, regenerate keys, or change the Baileys dependency.

## Verification

The complete suite was run against the modified working source and passed 112 tests with zero failures. New coverage verifies volatile device-list behavior, preservation of Signal-key writes, and private/group decrypted-message delivery into the real message handler.

## Sources

- Baileys release notes: https://github.com/WhiskeySockets/Baileys/releases
- Baileys issue #2548: https://github.com/WhiskeySockets/Baileys/issues/2548
- Baileys issue #2491: https://github.com/WhiskeySockets/Baileys/issues/2491
