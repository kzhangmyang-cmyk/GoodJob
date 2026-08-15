# Task 5 report: bounded Douyin visual reader extension

## Delivered

- Manifest V3 extension with exact `activeTab`, `scripting`, `storage`, and `offscreen` permissions
- Exact Douyin host permission and generated, allowlisted GoodJob content-script origins; the read-only audit deep-compares the complete manifest to its template plus build origins
- Task 4 bridge protocol parity for `probe`, `start`, `acknowledge_batch`, `abort`, `ready`, `observation_batch`, and `terminal`
- Explicit popup selection and confirmation of one canonical Douyin video tab
- Visible, top-level comment extraction using DOM text, ARIA names, public time/count text, literal comment IDs, and literal in-card public profile links
- Fail-closed handling for selector drift, ambiguous read-only buttons, login, captcha, security verification, ads, and nested replies
- Bounded batching, ACK retention, deduplication, at most five programmatic scrolls, two-cycle no-progress stop, duration stop, and user-takeover stop; terminal retries share the same absolute session deadline
- Strict `chrome.storage.session` projection containing only session/tab IDs, limits, usage, artifact flag, nonce hash, and state
- Same-canonical-URL reloads, URL-less `loading` lifecycle updates, and bound-tab replacements fail closed without affecting other tabs or windows
- MV3 restart reports `partial_success` with `visual_reader_session_expired`, so the GoodJob controller uses server completion rather than a user-takeover abort
- Local fixture tests using pinned `linkedom@0.18.13`; production bundle audit rejects linkedom leakage, remote network APIs, source maps, dynamic code, broad origins, and forbidden permissions
- Preserved popup visual language with deep green, warm white, cool gray, native controls, visible focus states, and polite live status

## Safety boundary

The Task 5 extension does not capture screenshots, run OCR, read cookies, inspect images or internal framework state, access browser storage from the Douyin page, call remote APIs, or perform private messages, likes, comments, follows, captcha handling, or other write interactions. Every observation has `redactedCrop: null`. Screenshot cropping and OCR remain Task 6 work.

## Verification

```text
npm run test:visual-reader       PASS
npm run test:types               PASS
npm run build:visual-reader      PASS
npm run check:visual-reader-bundle PASS
npm run test                     PASS (125 checks)
npm run build                    PASS (existing large-chunk warning only)
git diff --check                 PASS
```

The development manifest contains only `http://127.0.0.1:5191/*` for the GoodJob content script. Release rendering fails closed unless `VISUAL_READER_RELEASE=1` is accompanied by explicit HTTPS `GOODJOB_APP_ORIGINS`. The read-only audit rejects any full-manifest drift from the template and rendered origins, including CSP, optional permissions, content-script attributes, background/action, and web-accessible resources.

The final unpacked extension contains seven files and is approximately 64 KB. It has only been validated with fixed fixtures and local extension builds; real Douyin compatibility and Chrome Web Store publication are not claimed.

## Dependency and workspace note

`linkedom 0.18.13` is recorded in `THIRD_PARTY_NOTICES.md` as an unmodified ISC-licensed test-only dependency. The pre-existing untracked `package-lock.json` was not read, modified, staged, deleted, or committed; its size and modification timestamp remained unchanged before and after the no-lock install and all verification commands.
