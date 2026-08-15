# Task 1 report — authorized visual reader contracts

## Status

Task 1 is complete and is included in
`feat: define authorized visual reader contracts`. No Task 2 browser-extension
work and no Task 3 visual-reader service/router work is included.

## RED evidence

The tests were written before the schemas and routes.

```text
npm run test:contracts
# tests 73
# pass 64
# fail 9
```

The failures were the intended missing-contract failures: absent observation
and session schemas, absent visual OpenAPI components/routes, and absent Run
Presentation visual projection. One test fixture initially threw while reading
the absent schema; it was corrected so RED remained a product assertion rather
than a test error before implementation began.

After the static contract was green, the production parity gate exposed one
additional expected RED:

```text
npm run test:contract-drift --workspace backend
# tests 17
# pass 16
# fail 1
GET /api/v1/acquisition/runs/{id}/presentation
```

The only drift was the optional `authorizedVisualReader` projection missing
from the existing runtime Run Presentation builder.

## Delivered contracts

- Added strict normalized `DouyinVisualCommentObservationV1` and client-only
  observation submission contracts for visible top-level Douyin comments.
- Added the closed visual session, limits, usage, terminal outcome, stable
  errors, create/batch/complete/abort, redacted WebP crop, and opaque-rectangle
  proof contracts.
- Published the six versioned `/api/v1/acquisition/...` static routes using
  existing acquisition auth, CSRF, idempotency, response, and error-envelope
  conventions. The artifact GET exposes only `image/webp` binary plus exact
  private no-store, nosniff, and restrictive CSP headers.
- Added the optional backward-compatible Run Presentation
  `authorizedVisualReader` projection while preserving the required existing
  seven public-comment automation steps.
- Synchronized only that optional projection into the production OpenAPI
  builder. The six not-yet-implemented runtime routes remain unmounted and are
  deferred to Task 3.
- Regenerated the committed frontend acquisition types and documented the
  current contract-only status in `contracts/README.md`.

## Closed boundary decisions

- Creation accepts only `{ runId, artifactUploadEnabled }`; Plan,
  PlanVersion, platform, coverage, clocks, expiry, and effective limits are
  server-derived.
- `dom | accessibility | ocr | vision` is the complete method enum. `vision`
  is reserved but not enabled.
- Source URLs are exact Douyin HTTPS video URLs with a non-zero numeric ID and
  no query/fragment. Public profile URLs, `secUid`, comment IDs, confidences,
  bounds, text, batches, crops, decoded bytes, and counters are independently
  closed and bounded.
- Standard Draft 2020-12 schemas do not use `$data` or custom keywords.
  Task 3 must enforce URL/video ID, profile/`secUid`, and route/session sibling
  equality before persistence.
- Presentation visual steps use exactly five array slots and one closed step
  schema whose ID is one of the fixed five values. OpenAPI 3.0 cannot express
  tuple order without unsupported `prefixItems`; Task 7 must enforce fixed
  order, uniqueness, and one occurrence of every ID from persisted facts.
- Client submissions reject server-owned IDs/hashes and unknown exfiltration
  fields. No Cookie, signing, fingerprint, proxy, captcha, HTML/DOM dump,
  full-page screenshot, private interaction, publishing, or CRM-write ability
  exists in these contracts.

## GREEN verification

Fresh task verification:

```text
node --test contracts/test/schema-registry.test.mjs contracts/test/openapi.test.mjs
# tests 33
# pass 33

npm run test:contracts
# tests 73
# pass 73

npm run generate:frontend-contract-types
# exit 0

npm run check:generated-acquisition-types
# exit 0

npm run test:contract-drift --workspace backend
# tests 17
# pass 17

npm run build --workspace backend
# exit 0
```

All tests are local contract fixtures; none contacts Douyin.

## Remaining risks and next owners

- These are release contracts, not an available runtime visual reader. Task 3
  owns service validation, repository transactions, artifact decoding/pixel
  proof validation, authorization, expiry/budget enforcement, and route mount.
- Task 7 owns the persisted Run Presentation projection and exact five-step
  order/uniqueness invariant.
- `vision` stays disabled pending an explicit connector and data-transfer
  review.
- No product README/PRD was changed because the feature is not implemented or
  user-operable yet. The current contract README, execution plan, controller
  brief, report, and ledger were synchronized.
