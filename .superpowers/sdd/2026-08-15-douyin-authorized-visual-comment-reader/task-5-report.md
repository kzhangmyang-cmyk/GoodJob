# Task 5 report — bounded MV3 Douyin visual reader

## Outcome

The external GoodJob frontend now builds an unpacked Manifest V3 extension that reads only visible top-level Douyin comment cards after an explicit GoodJob authorization and an explicit popup tab choice. It preserves the existing deep-green, warm-white, cool-gray popup style and uses native controls without a new UI library or image asset.

Frontend commits:

- `fc378c3` — `feat: add bounded douyin visual reader extension`
- `1732163` — `fix: harden douyin visual reader lifecycle`

The frontend worktree remains clean except for the user's pre-existing untracked `package-lock.json`, which was not read, modified, staged, deleted, or committed.

## Implemented safety boundary

- Exact permissions: `activeTab`, `scripting`, `storage`, and `offscreen`; exact host permission: `https://www.douyin.com/*`.
- Development GoodJob match defaults only to `http://127.0.0.1:5191/*`; release builds require explicit HTTPS `GOODJOB_APP_ORIGINS` and reject wildcard or broad origins.
- Popup candidates are never auto-selected. Confirmation binds tab ID, window ID, and canonical video URL, focuses and activates the target, then revalidates it before script injection.
- Closing the popup does not abort. Explicit stop, user input, bound-tab close/navigation, same-window tab replacement, or real focus departure causes safe takeover; background activation in another window does not.
- Extraction reads only owned visible `innerText`, exact ARIA labels, public time/count text, explicit public comment IDs, and literal card-owned public profile links. It does not read images, styles, scripts, framework internals, cache/storage, nested reply bodies, cookies, or network responses.
- Login, captcha, security verification, selector drift, advertising cards, ambiguous exact-name buttons, and non-canonical source URLs fail closed.
- Missing public comment IDs use a full SHA-256 of canonical visible facts. Card index and geometry are excluded, so movement stays stable while replacement text changes the key.
- The extension protocol matches the Task 4 2000-character visible-text limit and its identity, count, viewport, bounds, confidence, timestamp, and reader-version constraints. Task 5 emits only DOM/ARIA observations with `redactedCrop: null`.
- One absolute session deadline bounds extract, DOM stability, batch send, ACK wait, retry delay, and programmatic scroll. ACK loss and transport rejection replay the exact retained batch and batch ID; the service worker clears pending state only after content confirms the matching ACK.
- Terminal delivery has bounded per-attempt timeouts and exact-event retries. User takeover stops new page actions immediately and does not deadlock terminal delivery behind a pending batch.
- `chrome.storage.session` stores only the closed session/tab/window/source/budget/usage/artifact-mode/nonce-hash/status state. Raw nonce, body text, profile data, batch payloads, images, cookies, and authentication material are absent from storage and logs.
- A service-worker restart clears residual authority before notifying surviving GoodJob and Douyin content scripts. GoodJob can report `visual_reader_session_expired` only with its existing in-memory nonce; Douyin stops any retained reader or pending batch. There is no silent orphan continuation.
- Manifest generation and bundle audit are separate commands. The audit is read-only and rejects a tampered manifest without repairing it. Extension output lives in `dist-visual-reader/douyin-visual-reader`, so the main Vite build cannot erase it.

## TDD and verification evidence

Review RED cases reproduced a permanently blocked extractor, a lost ACK with only one send, a bounds-dependent missing-ID key, a 2001-character protocol mismatch, missing tab/window revalidation, absent restart recovery, a check command that regenerated tampered evidence, and the main build deleting extension output. A final RED also reproduced a permanently hung terminal runtime send.

Fresh final verification in the frontend worktree:

- `npm run test:visual-reader`: PASS, nine focused groups plus the aggregate extension self-test;
- `npm run test`: PASS, 125 checks;
- `npm run test:types`: PASS;
- `npm run verify:visual-reader-build-order`: PASS for extension build/audit, main build, and final read-only extension audit;
- `git diff --check`: PASS.

The only build message was the existing Vite chunk-size warning. Tests used fixed local HTML fixtures and fake runtime/state transports. No real Douyin request was made, no Chrome Web Store publication was claimed, and Task 6 screenshot, crop, OCR, and vision work was not started.
