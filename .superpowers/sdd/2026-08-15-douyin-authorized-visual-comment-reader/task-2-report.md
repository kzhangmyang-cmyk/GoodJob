# Task 2 report — authorized visual observation persistence

## Status

Task 2 is complete. The base implementation is included in
`feat: persist authorized visual observations`; review round 1 hardens the
same internal boundary under `fix: harden visual observation persistence`.
The task adds only storage, cryptography, expiry cleanup, runtime validation,
and application composition. It does not mount Task 3 HTTP routes or add
Cookie, signature, fingerprint, private-message, interaction, captcha, proxy,
or real Douyin traffic behavior.

## RED evidence

Memory repository and artifact crypto tests were written before production
modules. The first required run failed only because both modules were absent:

```text
npm exec --workspace backend -- tsx --test \
  src/acquisition-visual-reader-sessions-test.ts \
  src/acquisition-visual-artifact-crypto-test.ts
# tests 2
# pass 0
# fail 2
# ERR_MODULE_NOT_FOUND: acquisition-visual-reader-sessions.js
# ERR_MODULE_NOT_FOUND: acquisition-visual-artifact-crypto.js
```

After that wave reached 14/14 GREEN, MySQL, expiry, and application lifecycle
tests were added before their modules/wiring:

```text
npm exec --workspace backend -- tsx --test \
  src/acquisition-visual-reader-mysql-repository-test.ts \
  src/acquisition-visual-artifact-expiry-sweeper-test.ts \
  src/acquisition-application-test.ts
# tests 3
# pass 0
# fail 3
# ERR_MODULE_NOT_FOUND: acquisition-visual-reader-mysql-repository.js
# ERR_MODULE_NOT_FOUND: acquisition-visual-artifact-expiry-sweeper.js
```

Two later tenant/expiry mutations supplied focused regression REDs before
their fixes:

```text
memory repository derives budgets from only the selected tenant
# tests 10; pass 9; fail 1
# VISUAL_READER_BUDGET_EXHAUSTED

memory/MySQL repository persists the derived expired terminal outcome
# tests 17; pass 14; fail 2; skip 1
# both implementations returned VISUAL_READER_SESSION_EXPIRED
```

Review round 1 verified all eight Important findings against the implementation
and supplied a real RED before each production correction:

```text
1. schema release 0/null/query-error plus append/complete rollback failure
   # MySQL suite: pass 5, fail 5, skip 1
   # release failures did not reject; rollback failures destroyed 0 connections

2. durable expiry through get/append/complete in memory and MySQL
   # combined suite: pass 21, fail 6, skip 1
   # every clock-reversal check found status created instead of expired

3. complete Task 1 normalized observation validation
   # focused: fail 1
   # Missing expected exception: top-level additional property

4. public validator parity and terminal outcome validation
   # focused: fail 2
   # invalid scope and closed outcome shape were accepted/misclassified

5. fail-closed MySQL row parsing
   # focused: fail 3
   # session JSON, observation scope, and artifact scope contradictions passed

6. OCR accounting
   # focused: fail 1
   # maxOcrCalls=0 accepted a new OCR observation with zero reported calls

7. expiry sweeper synchronous/reporter failure containment
   # focused: fail 3
   # sync now, sync repository, and reporter exceptions escaped

8. artifact duplicate mapping
   # focused: fail 1
   # expected ARTIFACT_CONFLICT; received OBSERVATION_CONFLICT
```

## Delivered storage and invariants

- Added one shared internal repository port backed by serialized immutable
  memory state or MySQL transactions. Session creation and completion are
  exact/idempotent; appends enforce active state, session expiry, video,
  per-video, scroll, and OCR budgets.
- Every public memory/MySQL method shares closed scope, identifier, batch,
  outcome, usage, and session validation. Normalized observations enforce every
  Task 1 top-level and nested field constraint while leaving URL-video and
  profile-secUid sibling equality to Task 3.
- A newly accepted OCR observation consumes at least one OCR call; explicit
  higher call usage is retained, while duplicate replay consumes nothing.
- Scoped observation idempotency binds tenant, session, URL, viewport hash,
  canonical card-bounds hash, and text hash. Every client key is permanently
  bound to its first immutable input. Duplicate replay does not increment
  usage.
- Whole memory batches swap state only after complete validation. MySQL locks
  the scoped session row and commits client binding, canonical observations,
  encrypted artifact rows, and server-derived usage in one transaction.
- get, append, or complete atomically persists the first expiry transition.
  Terminal timestamps are deterministically `expiresAt`, the transition is
  committed before an expiry error is returned, and clock reversal cannot
  revive a session.
- The fixed MySQL tables are
  `acquisition_visual_reader_sessions`,
  `acquisition_visual_comment_observations`, and
  `acquisition_visual_reader_artifacts`. Every resource PK, unique lookup,
  index used by tenant reads, and FK-equivalent relationship carries
  `owner_id + team_id`.
- Artifact inputs accept only already-validated in-memory `image/webp` bytes.
  The repository independently verifies the exact byte length and SHA-256,
  enforces bounded metadata and at most 30-day retention, and never accepts a
  URL, path, caller ciphertext, IV, tag, key, or storage field.
- Visual artifact keys use a dedicated versioned HKDF-SHA256 salt/info over
  the validated acquisition master secret. AES-256-GCM uses a fresh 12-byte
  IV and canonical AAD binding envelope/key/algorithm versions, owner, team,
  session, observation, artifact, media type, hash, and byte length.
- MySQL receives only ciphertext, IV, tag, versions, and non-sensitive
  metadata. Tests inspect every `ArrayBufferView` SQL value and prove the
  plaintext WebP byte sequence is absent. JSON rows and denormalized columns
  are parsed from `unknown`, cross-checked, and fail with one stable integrity
  error if contradictory.
- Schema migration uses the shared acquisition named-lock lifecycle. Failed
  acquisition/release and failed transaction rollback poison and destroy the
  connection; only reusable sessions return to the pool. Artifact insert
  duplicate errors map at the exact insert boundary.
- Expired artifacts are unreadable immediately, even before physical
  deletion. The application-owned sweeper runs immediately, schedules an
  unref'd interval, deletes at most 100 rows, reports only a stable code and
  attempted count, contains synchronous clock/repository exceptions, isolates
  reporter failures, and has bounded/idempotent close semantics.
- The acquisition runtime exposes the exact composed visual repository for
  later internal composition. Memory/MySQL selection, explicit repository
  injection, schema-before-sweeper ordering, and pool/sweeper shutdown are
  covered without mounting a route.

## Verification

Latest review-round gates before the final commit:

```text
npm exec --workspace backend -- tsx --test \
  src/acquisition-visual-reader-sessions-test.ts \
  src/acquisition-visual-reader-mysql-repository-test.ts \
  src/acquisition-visual-artifact-crypto-test.ts \
  src/acquisition-visual-artifact-expiry-sweeper-test.ts
# tests 47
# pass 46
# fail 0
# skip 1

npm exec --workspace backend -- tsx --test \
  --test-name-pattern='mysql acquisition application owns schema setup|memory acquisition application preserves injected visual' \
  src/acquisition-application-test.ts
# tests 2
# pass 2

npm exec --workspace backend -- tsx --test src/acquisition-application-test.ts
# all 27 individual subtests emitted ok
# command completed after one bounded continuation; captured output had no TAP footer

npm exec --workspace backend -- tsx --test \
  src/acquisition-master-secret-test.ts
# tests 3
# pass 3

npm run test:security --workspace backend
# ok: true

npm run build --workspace backend
# exit 0

git diff --check
# exit 0
```

`MYSQL_TEST_ADMIN_URL` was absent, so the real-MySQL contract matrix remained
a conditional skip. When configured, that test creates a random isolated
database, installs the visual schema, runs the same memory/MySQL
create/append/replay/list/artifact/complete/durable-expiry contract, and drops
the database in `finally`. Stateful SQL parity still exercised schema setup,
scoped queries, row locking, commit/rollback/poison paths, concurrent duplicate
convergence, ciphertext-only storage, deterministic reads, expiry, and bounded
deletion. No test contacted Douyin.

One exploratory combined invocation ran `security-test.ts` through the Node
test runner without the repository script's required environment and failed
closed on the weak/missing acquisition startup secret. The authoritative
repository command shown above supplied the expected environment and passed;
the failed invocation is not counted as a GREEN gate.

## Documentation boundary

No README, OpenAPI, public schema, generated type, product interaction, or API
documentation changed. Task 2 is internal persistence only. The current plan,
Task 2 brief/report, and SDD ledger contain the storage and lifecycle truth;
Task 3 remains the owner of validation service, artifact pixel proof, auth,
CSRF, HTTP responses, and route mount.
