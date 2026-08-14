# Task 4 Report: 评论证据、主体聚合与确定性需求信号

## Status and commit

- Status: complete, including review round 1 fixes
- Base: `0ca58cdd4d2dd18040ccfb2a617cc2df47579240`
- Commit: the task commit containing this report, message
  `feat: aggregate douyin comment demand signals`
- Review round 1 commit: the follow-up commit containing this report, message
  `fix: harden douyin comment signal ingestion`
- Scope: backend and acquisition contracts only; no frontend or Task 5+
  orchestration changes

## Delivered behavior

- Added `AcquisitionDouyinCommentIngestionService.ingestSample` as a narrow,
  dependency-injected pipeline from bounded public top-level comment samples to
  immutable events/observations, exact public-event evidence, individual demand
  signals, candidates, and Run links.
- Added deterministic, bounded `classifyDouyinCommentIntent` output for strong,
  potential, noise, and negative bands. Negative/no-contact rules override
  positive terms; standalone `多少钱` remains potential; compound
  procurement, supplier, budget, quantity, timing, delivery, cooperation, and
  trial evidence is required for strong signals.
- Preserved bounded original public comment text while hashing normalized text.
  Noise persists as event/evidence without a candidate. Negative evidence
  creates/attaches a signal with stable suppression codes.
- Added the closed `platform_public_event` evidence provenance and restricted it
  to `individual_signal` plus `public_content` in TypeScript, domain validation,
  and JSON Schema.
- Added stable Douyin actor aggregation semantics:
  - strict `douyin:sec_uid:*` dedupe across videos and Runs while remaining
    `needs_research` for video-only evidence;
  - normalized `douyin:handle:*` temporary dedupe that never aliases secUid;
  - `unmergeable:douyin:comment:*` isolation for identity-less comments;
  - owner/team isolation and fail-closed non-Douyin or malformed contexts.
- Kept existing adapter-generated public actor hashes source-bound and fixed the
  stale candidate-research fixture with the same stable non-adapter
  `public:linkedin:alice` key on both sides.
- Did not copy or integrate Cookie, reverse-signature, browser-fingerprint,
  private-message, interaction, proxy, CAPTCHA, or platform-write code.

## Review round 1 fixes

- Added the internal `mergeIndividualDemandSignal` Domain command. Existing
  individual candidates now retain identity-bearing profile fields while later
  evidence merges bounded/deduplicated summaries, advances buying stage only by
  the explicit five-stage rank, and keeps a stable union of negative codes.
  Exact replay does not increment the candidate version or duplicate audit
  events. New evidence retains the existing approval/rejection invalidation
  semantics.
- Made `douyin-comment-content-version-v1` the deterministic evidence artifact.
  The provider page hash remains on the exact observation; evidence for one
  `eventId + textHash` is byte-equivalent across later page artifacts. Changed
  content creates another evidence version, while actor/source fields always
  come from the stored immutable event.
- Documented and tested the event → evidence → candidate → link sequence as a
  restartable idempotent saga rather than a cross-repository atomic transaction.
  Failure injection after event, evidence, and candidate proves exact retry
  leaves one event/content evidence/candidate/link and one visible Run fact.
- Prevalidates all scope, nullable Run context, source/video, page metadata,
  provider literals, reply-body literal, digests, bounds, and all comment
  records before the first mutation. Malformed comment records remain isolated
  and count as invalid; malformed page/context inputs fail with zero mutation.
- Restored v1 compatibility for `negativeSignals`: the schema no longer narrows
  legacy arrays by count, uniqueness, or item length. The deterministic comment
  classifier keeps its own internal code bounds.

## TDD evidence

### RED

- Resolver golden tests initially passed 6/8 and failed the two new stable-key
  invariants because secUid/handle fallback still included the video URL.
- The existing candidate-research focused run passed 5/6 and reproduced the
  stale fabricated source-bound adapter hash failure (`needs_research` instead
  of `resolved`).
- Domain evidence tests passed 22/23 and the schema registry passed 19/20 before
  `platform_public_event` existed.
- The ingestion suite first failed with `ERR_MODULE_NOT_FOUND`; after the first
  implementation pass, four vertical tests failed on overlong child
  idempotency keys, proving the real domain boundary was exercised.
- Follow-up RED cycles caught malformed actor fields being accepted, secUid
  digit runs being mistaken for phone material, original whitespace/punctuation
  being normalized away, and a later observation conflicting with the existing
  immutable evidence artifact.
- Review round 1 command:

  ```text
  NODE_ENV=test TZ=UTC npm exec --workspace backend -- node --import tsx \
    --test --test-concurrency=1 \
    src/acquisition-douyin-comment-ingestion-test.ts
  ```

  Result: 6/9 passed, 3 failed. The failures were the expected old behavior:
  the stage remained `solution_research` instead of `purchase_ready`, changed
  content used a transient actor and produced another candidate, and malformed
  Provider/context input was accepted instead of failing before mutation.
- The v1 compatibility regression was also run against the narrowed schema:

  ```text
  node --test --test-name-pattern \
    "individual demand signals bound profile fields without narrowing v1 negative signals" \
    contracts/test/schema-registry.test.mjs
  ```

  Result: 0/1 passed. AJV reported all three intended incompatibilities:
  `maxItems`, item `maxLength`, and `uniqueItems`.

### GREEN

Required focused command:

```text
npm exec --workspace backend -- tsx --test \
  src/acquisition-douyin-comment-ingestion-test.ts \
  src/acquisition-domain-test.ts \
  src/acquisition-public-identity-resolver-test.ts \
  src/acquisition-candidate-research-test.ts
```

Result: 48/48 passed.

Contracts:

```text
npm run test:contracts
```

Result: 65/65 passed.

Build:

```text
npm run build --workspace backend
```

Result: passed (`tsc -p tsconfig.json`).

`git diff --check` also passed.

## Broader regression observation

The optional full command was run exactly as follows:

```text
npm run test:acquisition --workspace backend
```

Result: 670 passed / 33 failed. These failures are outside Task 4 and were not
hidden or expanded into this task:

1. The first failure is
   `Cannot safely represent JSON Schema keyword in OpenAPI 3.0: contains`.
   Task 2's `acquisition-plan.v1.schema.json` provider binding uses `contains`,
   while `convertJsonSchema202012ToOpenApi30` explicitly rejects it. This causes
   the OpenAPI/middleware/provider-version cascade.
2. `acquisition-pi-gateway-runtime-test.ts` and
   `acquisition-pi-runtime-factory-test.ts` separately fail with the existing
   `MODEL_TOOL_DEFINITION_INVALID` condition.

Task 4's new classifier, ingestion, domain, resolver, candidate-research, and
contract tests all pass inside their required focused gates.

## Files

- `backend/src/acquisition-douyin-comment-ingestion.ts`
- `backend/src/acquisition-douyin-comment-ingestion-test.ts`
- `backend/src/acquisition-domain.ts`
- `backend/src/acquisition-domain-service.ts`
- `backend/src/acquisition-domain-test.ts`
- `backend/src/acquisition-individual-signal-ingestion.ts`
- `backend/src/acquisition-public-identity-resolver.ts`
- `backend/src/acquisition-public-identity-resolver-test.ts`
- `backend/src/acquisition-candidate-research-test.ts`
- `contracts/json-schema/discovery-evidence.v1.schema.json`
- `contracts/json-schema/individual-demand-signal.v1.schema.json`
- `contracts/test/schema-registry.test.mjs`
- `contracts/README.md`
- `docs/superpowers/plans/2026-08-15-douyin-public-comment-automation.md`

## Documentation audit

`contracts/README.md` now documents the exact public-event provenance, three
unresolved actor-key classes, deterministic content-version artifact, signal
merge rules, and restartable saga. The current Douyin automation design and
implementation plan text was synchronized with those content-version,
actor-source, merge, and retry guarantees. The design file also contains
parent-owned, concurrently written BrowserAct/authorized-browser discovery
design. Per coordination, the whole design file remains unstaged for the
separate design commit, with the Task 4 paragraphs preserved in that working
copy. No frontend documentation was changed because review round 1 does not
change the Task 5+ presentation contract.

## Concerns and final state

- The Task 2 JSON Schema/OpenAPI 3.0 `contains` incompatibility must be resolved
  before treating the full acquisition suite as green.
- The two Pi runtime `MODEL_TOOL_DEFINITION_INVALID` failures remain separate
  pre-existing regressions.
- Expected final Task 4 paths after the enclosing commit: clean. The worktree
  intentionally retains only the coordinated, unstaged design-file changes for
  the separate parent-owned BrowserAct/design commit.
