# SDD ledger — authorized Douyin visual comment reader

Plan: `docs/superpowers/plans/2026-08-15-douyin-authorized-visual-comment-reader.md`

Backend workspace: `/Users/mac/Documents/新项目/GoodJob-growth/.worktrees/douyin-comment-automation` on `codex/douyin-comment-automation-backend`.

Frontend workspace: `/Users/mac/Documents/外贸/GoodJob-marketing-system-frontend/.worktrees/douyin-comment-automation` on `codex/douyin-comment-automation-frontend`.

Prerequisite public-comment automation Tasks 1–9: complete and independently reviewed through backend commit `3e65d49` and frontend commit `674b0ce`.

User-owned frontend `package-lock.json`: untracked before this plan; do not read, edit, stage, delete, or commit it.

Task 1: started at backend base `3e65d49` — strict contracts for authorized visual sessions, visible comment observations, optional redacted crops, and backward-compatible Run Presentation projection.

Task 1: completed — static Draft 2020-12 schemas, six versioned static OpenAPI routes, generated frontend types, optional Run Presentation visual projection, runtime/static Presentation parity, contract README, controller decision record, and task report. RED was 64/73 with 9 intended missing-contract failures; final gates were contracts 73/73, focused contracts 33/33, acquisition drift 17/17, generated-type check PASS, backend build PASS, and `git diff --check` PASS. The six runtime routes remain unmounted until Task 3; Task 7 owns exact visual-step order/uniqueness. Commit subject: `feat: define authorized visual reader contracts`.
