# Real Search Providers — Implementation Report

Date: 2026-07-23
Branch: `feature/ai-acquisition-agent-design`

## Scope

Added exactly three customer-BYOK Web search adapters to the existing provider
contract, runtime, encrypted connection, catalog, and UI-facing provider metadata
flow:

1. `baidu_ai_search`
   - `POST https://qianfan.baidubce.com/v2/ai_search/web_search`
   - `X-Appbuilder-Authorization: Bearer <customer key>`
   - Baidu Search v2, Web-only results, `safe_search: true`
2. `tencent_web_search`
   - `POST https://api.wsa.cloud.tencent.com/SearchPro`
   - `Authorization: Bearer <customer key>`
   - Mode 0 with supported `Cnt` values 10/20
3. `tavily`
   - `POST https://api.tavily.com/search`
   - `Authorization: Bearer <customer key>`
   - Basic/general search without answer or raw-page content

All three adapters are exported through `LEAD_PROVIDERS`. Consequently they are
included by `createDefaultProviderCatalog()` and use the existing personal
connection API, encrypted credential storage, provider runtime, network
allowlist, request ledger, and UI catalog semantics without a parallel secret
path.

## Data and provenance behavior

- The adapters use only provider-returned indexed title, URL, snippet/content,
  date, site, score, rank, and request ID.
- They do not fetch result pages and do not describe indexed snippets as
  complete page content.
- Every valid record is a `discovery_page`.
- The true result URL is retained as `sourceUrl`.
- Rank and source-specific provenance are retained in `evidenceSummary`.
- Provider request IDs are retained in `providerRecordId`, together with result
  rank/ID, and contain no credentials.
- Malformed individual results are skipped with `invalidCount` and warnings.
- Malformed top-level responses fail closed as `PROVIDER_SCHEMA_CHANGED`.
- Tavily credit usage is mapped to the shared `ProviderUsage` shape.

## Security behavior

- API keys are sent only in the documented authorization header.
- No environment/global key fallback was added.
- No key is placed in a query string, record ID, warning, or evidence field.
- Each provider has a strict HTTPS host/path/method allowlist.
- Credential-bearing cross-host redirects remain blocked by the shared HTTP
  client.
- Health checks issue a minimal real search request and validate its schema;
  they do not return a synthetic success.

## TDD evidence

RED:

```text
$ npm run test:provider:web-search --workspace backend
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../backend/src/web-search-providers.js'
exit code 1
```

The test intentionally referenced the not-yet-created adapter module.

GREEN:

```text
$ npm run test:provider:web-search --workspace backend
Real web search provider tests passed
exit code 0
```

Fixture coverage includes:

- exact URL, method, authorization header, and JSON body;
- result parsing, source URL, rank/request provenance, and usage;
- invalid per-result records and malformed top-level responses;
- 401/403, 429, 432 quota, and 5xx normalization;
- outbound host/path policy enforcement;
- minimal real health requests;
- `LEAD_PROVIDERS` and generated catalog visibility.

Regression checks:

```text
$ npm run test:providers --workspace backend
Provider runtime contract tests passed

$ npm run test:provider:sec-edgar --workspace backend
SEC EDGAR provider tests passed

$ npm run test:provider:public-sources --workspace backend
{ "ok": true, "executableSources": 11, "assistedSources": 7 }
```

## Official references

- Baidu Qianfan AI Search:
  <https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5>
- Tencent Cloud Web Search API-key mode:
  <https://cloud.tencent.com/document/product/1806/130615>
- Tavily Search:
  <https://docs.tavily.com/documentation/api-reference/endpoint/search>

## Release gate

No live request was made because no customer API keys were supplied. Before a
production release, run one search and one health check per provider with a
customer-owned test key, verify quota display, inspect provider-side request
logs by request ID, and confirm current commercial terms and regional
availability.

The full backend build was attempted during development. At that instant it was
blocked by an unrelated, concurrently edited uncommitted file
`backend/src/model-runtime-integration-test.ts` (a `string | undefined`
type error). The search-provider-specific TypeScript errors found in that run
were corrected; a clean build must be rerun after the concurrent model-gateway
work settles.
