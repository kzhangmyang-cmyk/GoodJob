# AI Acquisition v1 contracts

This workspace is the normative, executable boundary for the AI acquisition
agent. JSON Schemas use Draft 2020-12 and OpenAPI describes authenticated
`/api/v1` operations.

## Single-source workflow

During migration, every published operation must remain semantically equal to
the production builder in `backend/src/acquisition-openapi.ts`. The repository
gate compares the dereferenced production and static operation surfaces; a
static contract change is not complete while that parity check is red.

After `npm run check:acquisition-contracts` is green, the static OpenAPI 3.1
document in `openapi/ai-acquisition.v1.yaml` is the release and frontend-type
generation contract. Start release-contract changes there, regenerate the
committed frontend transport types with
`npm run generate:frontend-contract-types`, update the production builder and
runtime routes in the same change, and keep the repository gate green. Run
`npm run check:generated-acquisition-types` to detect stale or absent generated
output without modifying repository files.

The platform connection, capability, generic event envelope, Douyin comment
event, action-policy, and action-receipt components are schema reservations
only. They have no published routes until their implementations land in Issues
#06, #07, and #10. `DouyinCommentEvent` is the strict concrete payload behind
the generic envelope references for an `experimental_public_sample` provider;
its coverage is `public_top_level_sample`, it contains no avatar, and it does
not represent complete comment coverage. Runtime response-body validation is
also outside this migration and remains a future hardening step; the current
gate validates release schemas, builder parity, generated output, the frontend
consumer, and the packaged production start path.

Acquisition plans may optionally version a `douyinPublicCommentSample` policy.
Legacy plans without it remain valid and sampling is disabled by absence. An
enabled policy requires `targetPlatform: douyin` and is bounded to 20 videos,
100 comments per video, and 5 pages per video. It must also version at least one
active `content_fetch` provider connection whose provider ID is exactly
`experimental_public_sample`; runtime execution must apply the stricter of
these plan values and its server limits. Plan create, update, and revision
request contracts expose the same four-field policy; create requests enforce
the provider binding directly, while mutations are validated after merging
with the current plan.

Public Douyin comments enter the acquisition domain as immutable comment
events and `DiscoveryEvidence` with `platform_public_event` provenance. That
provenance is closed to the public source URL, platform comment ID, provider
version, and `public_top_level_sample` coverage; it is valid only for an
`individual_signal` with `public_content` access. Candidate aggregation treats
`douyin:sec_uid:*` as a stable public key that still needs identity research,
uses normalized `douyin:handle:*` only as a temporary key, and isolates
identity-less comments with `unmergeable:douyin:comment:*`. None of these keys
asserts a verified customer identity.

Each provider capture keeps the real provider-page `rawArtifactHash` on its
immutable observation. The event repository also persists the first exact,
bounded public text, observation ID, page artifact hash, publication context,
and public actor/source context for every `eventId + textHash` content version.
Discovery evidence is built from that persisted first version: its
`sourceSnippet` preserves the exact bounded public text and its
`rawArtifactHash` references the real first provider-page artifact. Later page
artifacts for the same event/text hash therefore produce byte-equivalent
evidence while each observation remains traceable to its own provider page.
Candidate identity facts always come from the stored immutable event.

Comment ingestion combines a durable restartable saga with a shared completion
unit of work. The event repository first atomically stores the event,
observation, content version, and pending saga. Evidence, Domain idempotency,
candidate/audit state, candidate-directory entry, Run link, and committed saga
then complete together: memory compositions use coordinated serialized
snapshots and MySQL compositions use one connection and one database
transaction across Domain, event, and directory repositories. A completion
failure restores every successful projection to its prior state while retaining
the pending saga for a restart-safe recovery sweeper; callers do not need to
replay the ingestion request. Pending work is excluded from successful Run
projections.
An exact retry resumes from deterministic step identities. Later signals for an
existing individual candidate append evidence, merge bounded deduplicated
demand summaries, advance buying stage only by its explicit order, and retain a
stable union of negative signal codes without overwriting identity facts.

Recovery persists only stable non-PII error codes. Diagnostic callbacks receive
a bounded envelope containing the recovery stage, attempt, and irreversible
saga hash, never the source error, comment, actor identifier, source URL,
message, or stack. MySQL startup applies schema before the first sweep; legacy
saga columns are discovered through `information_schema.columns` and migrated
with fixed allowlisted `ALTER TABLE` statements. Advisory-lock cleanup requires
`RELEASE_LOCK` to return exactly `1`; any cleanup error poisons and destroys the
session instead of returning it to the pool.

Run `npm run check:acquisition-contracts` from the repository root before
changing any producer or consumer.

Only backwards-compatible optional fields may be added to v1 artifacts.
