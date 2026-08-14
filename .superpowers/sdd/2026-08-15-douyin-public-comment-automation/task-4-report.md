# Task 4 Report: 评论证据、主体聚合与确定性需求信号

## Status and commit

- Status: complete
- Base: `0ca58cdd4d2dd18040ccfb2a617cc2df47579240`
- Commit: the task commit containing this report, message
  `feat: aggregate douyin comment demand signals`
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

### GREEN

Required focused command:

```text
npm exec --workspace backend -- tsx --test \
  src/acquisition-douyin-comment-ingestion-test.ts \
  src/acquisition-domain-test.ts \
  src/acquisition-public-identity-resolver-test.ts \
  src/acquisition-candidate-research-test.ts
```

Result: 42/42 passed.

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
- `backend/src/acquisition-public-identity-resolver.ts`
- `backend/src/acquisition-public-identity-resolver-test.ts`
- `backend/src/acquisition-candidate-research-test.ts`
- `contracts/json-schema/discovery-evidence.v1.schema.json`
- `contracts/json-schema/individual-demand-signal.v1.schema.json`
- `contracts/test/schema-registry.test.mjs`
- `contracts/README.md`

## Documentation audit

`contracts/README.md` now documents the exact public-event provenance and the
three unresolved actor-key classes. The current Douyin automation design and
implementation plan already describe this event/evidence/aggregation boundary,
so no historical plan rewrite was needed in Task 4.

## Concerns and final state

- The Task 2 JSON Schema/OpenAPI 3.0 `contains` incompatibility must be resolved
  before treating the full acquisition suite as green.
- The two Pi runtime `MODEL_TOOL_DEFINITION_INVALID` failures remain separate
  pre-existing regressions.
- Expected final worktree state after the enclosing commit: clean.
