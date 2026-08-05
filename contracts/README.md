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

The platform connection, capability, event, action-policy, and action-receipt
components are schema reservations only. They have no published routes until
their implementations land in Issues #06, #07, and #10. Runtime response-body
validation is also outside this migration and remains a future hardening step;
the current gate validates release schemas, builder parity, generated output,
the frontend consumer, and the packaged production start path.

Run `npm run check:acquisition-contracts` from the repository root before
changing any producer or consumer.

Only backwards-compatible optional fields may be added to v1 artifacts.
