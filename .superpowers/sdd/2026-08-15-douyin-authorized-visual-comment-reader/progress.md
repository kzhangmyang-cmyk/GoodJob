# SDD ledger — authorized Douyin visual comment reader

Plan: `docs/superpowers/plans/2026-08-15-douyin-authorized-visual-comment-reader.md`

Backend workspace: `/Users/mac/Documents/新项目/GoodJob-growth/.worktrees/douyin-comment-automation` on `codex/douyin-comment-automation-backend`.

Frontend workspace: `/Users/mac/Documents/外贸/GoodJob-marketing-system-frontend/.worktrees/douyin-comment-automation` on `codex/douyin-comment-automation-frontend`.

Prerequisite public-comment automation Tasks 1–9: complete and independently reviewed through backend commit `3e65d49` and frontend commit `674b0ce`.

User-owned frontend `package-lock.json`: untracked before this plan; do not read, edit, stage, delete, or commit it.

Task 1: started at backend base `3e65d49` — strict contracts for authorized visual sessions, visible comment observations, optional redacted crops, and backward-compatible Run Presentation projection.

Task 1: complete (commits `6743419`..`3763936`; contracts 78/78, drift 17/17, OpenAPI 28/28, generated types and backend build green; independent review clean after two fix rounds).

Task 2: started at backend base `3763936` — tenant-isolated memory/MySQL sessions and observations, AES-256-GCM redacted artifact envelopes, atomic batch persistence, expiry cleanup, and application lifecycle injection.

Task 2: completed — scoped memory/MySQL visual sessions, canonical immutable observations, permanent client-key bindings, transactionally encrypted redacted WebP artifacts, derived usage/budget state, terminal expiry, immediate unreadability, bounded physical cleanup, and application-owned repository/sweeper lifecycle. RED waves were 0/2 and 0/3 on the intended missing modules; focused regression REDs caught a cross-tenant memory budget leak and missing persisted expiry transition. Final gates were focused storage 24/25 with one conditional real-MySQL skip, application lifecycle 27/27, acquisition master-secret 3/3, security self-test `ok: true`, backend build PASS, and `git diff --check` PASS. `MYSQL_TEST_ADMIN_URL` was absent; stateful SQL parity covered transactions, row locks, rollback, concurrent dedupe, scoped reads, ciphertext-only persistence, and expiry. No README/API docs change was needed because Task 2 adds internal storage only. Commit subject: `feat: persist authorized visual observations`.

Task 1: completed — static Draft 2020-12 schemas, six versioned static OpenAPI routes, generated frontend types, optional Run Presentation visual projection, runtime/static Presentation parity, contract README, controller decision record, and task report. RED was 64/73 with 9 intended missing-contract failures; final gates were contracts 73/73, focused contracts 33/33, acquisition drift 17/17, generated-type check PASS, backend build PASS, and `git diff --check` PASS. The six runtime routes remain unmounted until Task 3; Task 7 owns exact visual-step order/uniqueness. Commit subject: `feat: define authorized visual reader contracts`.

Task 1 review round 1: completed — canonical Base64 pad bits and the 256 KiB boundary are enforced; public identifiers and Douyin user keys start alphanumeric and reject controls/punctuation-only identities; generated visual Session/Observation DTOs no longer require `$defs`; all visual helper names are globally unique while existing Copilot `usage` and digest helpers retain their public names; Run Presentation keeps an inline closed visual summary for drift parity; and the contract-only route reservation exception is explicit. Individual review REDs were 0/1 for each of the five executable findings, with an integration RED of drift 16/17 before the inline Presentation correction. Final review gates: focused contracts 39/39, all contracts 78/78, acquisition drift 17/17, acquisition OpenAPI 28/28, generated-type check PASS, backend build PASS, and `git diff --check` PASS. Commit subject: `fix: harden authorized visual reader contracts`.

Task 1 review round 2: completed — the generated helper regression now walks the complete dependency closure of all 12 public visual aliases and rejects any internal helper outside `visualObservation*` or `visualReader*` plus the named public Observation component. RED was 0/1 on leaked generic `sourceUrl`; the same bug also exposed generic `videoId`, `visibleText`, `extractionMethod`, `readerVersion`, and `capturedAt`. Their constraints now exist once as uniquely prefixed observation `$defs` reused by normalized Observation and Session submission without validation drift. Final gates: focused contracts 39/39, all contracts 78/78, acquisition drift 17/17, acquisition OpenAPI 28/28, generated-type check PASS, backend build PASS, and `git diff --check` PASS. Commit subject: `fix: namespace visual observation leaf contracts`.
