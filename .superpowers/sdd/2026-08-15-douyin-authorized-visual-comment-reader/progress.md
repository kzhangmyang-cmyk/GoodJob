# SDD ledger — authorized Douyin visual comment reader

Plan: `docs/superpowers/plans/2026-08-15-douyin-authorized-visual-comment-reader.md`

Backend workspace: `/Users/mac/Documents/新项目/GoodJob-growth/.worktrees/douyin-comment-automation` on `codex/douyin-comment-automation-backend`.

Frontend workspace: `/Users/mac/Documents/外贸/GoodJob-marketing-system-frontend/.worktrees/douyin-comment-automation` on `codex/douyin-comment-automation-frontend`.

Prerequisite public-comment automation Tasks 1–9: complete and independently reviewed through backend commit `3e65d49` and frontend commit `674b0ce`.

User-owned frontend `package-lock.json`: untracked before this plan; do not read, edit, stage, delete, or commit it.

Task 1: started at backend base `3e65d49` — strict contracts for authorized visual sessions, visible comment observations, optional redacted crops, and backward-compatible Run Presentation projection.

Task 1: completed — static Draft 2020-12 schemas, six versioned static OpenAPI routes, generated frontend types, optional Run Presentation visual projection, runtime/static Presentation parity, contract README, controller decision record, and task report. RED was 64/73 with 9 intended missing-contract failures; final gates were contracts 73/73, focused contracts 33/33, acquisition drift 17/17, generated-type check PASS, backend build PASS, and `git diff --check` PASS. The six runtime routes remain unmounted until Task 3; Task 7 owns exact visual-step order/uniqueness. Commit subject: `feat: define authorized visual reader contracts`.

Task 1 review round 1: completed — canonical Base64 pad bits and the 256 KiB boundary are enforced; public identifiers and Douyin user keys start alphanumeric and reject controls/punctuation-only identities; generated visual Session/Observation DTOs no longer require `$defs`; all visual helper names are globally unique while existing Copilot `usage` and digest helpers retain their public names; Run Presentation keeps an inline closed visual summary for drift parity; and the contract-only route reservation exception is explicit. Individual review REDs were 0/1 for each of the five executable findings, with an integration RED of drift 16/17 before the inline Presentation correction. Final review gates: focused contracts 39/39, all contracts 78/78, acquisition drift 17/17, acquisition OpenAPI 28/28, generated-type check PASS, backend build PASS, and `git diff --check` PASS. Commit subject: `fix: harden authorized visual reader contracts`.
