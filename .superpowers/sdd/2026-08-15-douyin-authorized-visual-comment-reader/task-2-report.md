# Task 2 report — authorized visual observation persistence

## Status

Task 2 is complete and is included in
`feat: persist authorized visual observations`. It adds only internal storage,
cryptography, expiry cleanup, and application composition. It does not mount
the Task 3 HTTP routes or add Cookie, signature, fingerprint, private-message,
interaction, captcha, proxy, or real Douyin traffic behavior.

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

## Delivered storage and invariants

- Added one shared internal repository port backed by serialized immutable
  memory state or MySQL transactions. Session creation and completion are
  exact/idempotent; appends enforce active state, session expiry, video,
  per-video, scroll, and OCR budgets.
- Scoped observation idempotency binds tenant, session, URL, viewport hash,
  canonical card-bounds hash, and text hash. Every client key is permanently
  bound to its first immutable input. Duplicate replay does not increment
  usage.
- Whole memory batches swap state only after complete validation. MySQL locks
  the scoped session row and commits client binding, canonical observations,
  encrypted artifact rows, and server-derived usage in one transaction.
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
  metadata. Tests inspect captured SQL values and prove the plaintext WebP
  byte sequence is absent.
- Expired artifacts are unreadable immediately, even before physical
  deletion. The application-owned sweeper runs immediately, schedules an
  unref'd interval, deletes at most 100 rows, reports only a stable code and
  attempted count, and has bounded/idempotent close semantics.
- The acquisition runtime exposes the exact composed visual repository for
  later internal composition. Memory/MySQL selection, explicit repository
  injection, schema-before-sweeper ordering, and pool/sweeper shutdown are
  covered without mounting a route.

## Verification

Fresh final gates:

```text
npm exec --workspace backend -- tsx --test \
  src/acquisition-visual-reader-sessions-test.ts \
  src/acquisition-visual-reader-mysql-repository-test.ts \
  src/acquisition-visual-artifact-crypto-test.ts \
  src/acquisition-visual-artifact-expiry-sweeper-test.ts
# tests 25
# pass 24
# fail 0
# skip 1

npm exec --workspace backend -- tsx --test \
  src/acquisition-application-test.ts
# tests 27
# pass 27

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

`MYSQL_TEST_ADMIN_URL` was absent, so the conditional real-MySQL test was not
run. Stateful SQL parity tests still exercised schema setup, scoped queries,
session row locking, transaction commit/rollback, concurrent duplicate
convergence, ciphertext-only storage, deterministic reads, expiry, and
bounded deletion. No test contacted Douyin.

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
