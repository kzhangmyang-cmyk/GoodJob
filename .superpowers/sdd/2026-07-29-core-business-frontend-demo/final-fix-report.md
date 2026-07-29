# Core Business Frontend Demo — Final Fix Report

- Date: 2026-07-30
- Branch: `codex/marketing-system-frontend`
- Base: `9537d28bc423fc79fa0897e0a670422da27fed93`
- Implementation commit: `1162de21` (`fix: harden frontend demo workflows`)
- Status: **passed (Playwright); in-app browser unavailable**
- Delivery: committed locally; not pushed

## Scope

This wave resolves all six final review findings without changing the backend,
production authentication, real platform integrations, or dependency graph.

## Finding 1 — Customer/conversation relationship idempotency

Resolved by:

- adding reciprocal `customerId` values to the four seeded linked conversations;
- normalizing legacy persisted data that only has the customer-to-conversation side;
- rejecting duplicate or conflicting relationship graphs during persisted-state validation;
- checking both sides of the relationship before a conversation is transferred;
- selecting the existing customer instead of creating another customer or activity;
- avoiding persistence and notification work when a repeated transfer makes no change.

Coverage verifies that the default graph is reciprocal, an existing customer is
selected, customer/activity counts stay unchanged, and a repeated transfer
leaves the serialized local-storage value byte-for-byte unchanged.

## Finding 2 — Terminal opportunity semantics

Resolved by:

- limiting ordinary stage changes to `new`, `qualified`, `quoted`, and
  `negotiating`;
- preventing won/lost opportunities from being moved back to an active stage;
- enforcing probability `100` for won and `0` plus a legal loss reason for lost;
- clearing stale loss reasons when closing as won;
- rejecting invalid terminal mutations in both update and persistence paths;
- removing won/lost from ordinary stage controls and disabling drag on terminal
  cards;
- routing a drag to won through the close-won action;
- rejecting a drag to lost with guidance to choose a reason in the close form;
- adding an explicit empty `请选择流失原因` option.

Coverage verifies an ordinary move to quoted, rejection of an unreasoned lost
drag, close-won probability `100`, and a separate won drag with probability
`100`.

## Finding 3 — Persisted-state validation and rendering safety

Resolved by:

- applying strict allowlists to platform, intent, mode, sender, customer
  group/status, opportunity stage, activity kind, task priority/module, and loss
  reason fields;
- enforcing finite/ranged numeric values and valid ISO timestamps;
- validating unique IDs, selected-ID existence, cross-entity relations, platform
  consistency, task relations, and terminal opportunity invariants;
- falling back to the trusted seed if a persisted payload violates the schema;
- rendering persisted enum-derived values through controlled mappings and
  escaping dynamic dashboard and conversation content.

Coverage writes a malicious payload directly to local storage, reloads the app,
asserts seed recovery, and confirms the raw payload is absent from rendered shell
HTML. Focused tests also cover invalid probability and broken relationships.

## Finding 4 — Dashboard deep links

Resolved by:

- giving priority-customer and task rows explicit entity type/ID attributes;
- validating the type, destination module, and entity existence before
  navigating;
- selecting the matching conversation, customer, or opportunity before the
  destination view is rendered;
- treating invalid, missing, or mismatched deep links as safe no-ops.

Coverage verifies the Wang conversation inspector, the office opportunity
inspector, and a deliberately mismatched deep link that does not navigate.

## Finding 5 — Acquisition demo honesty and unified state

Resolved by:

- relabeling acquisition actions, statuses, summaries, scripts, advice, and
  timeline copy as demo/simulated behavior;
- replacing the old DOM-only private-domain sync with the unified `DemoStore`
  transfer path;
- selecting the active acquisition row's platform, choosing the matching demo
  conversation, transferring/selecting its customer, and navigating to the
  private-domain view;
- keeping unsupported platforms on the acquisition page and displaying the
  explicit message `演示版暂未接入`.

No backend endpoint, real social-platform API, production authentication, or new
dependency was introduced.

## Finding 6 — Reset of transient UI state

Resolved by:

- resetting dashboard period, conversation filters, private-domain
  group/intent/platform/search/batch/form state, and conversion form state;
- closing all open dialogs and clearing drag state before resetting store data;
- dispatching a dedicated demo-reset event for replica-dashboard-owned state;
- clearing replica-created rows and restoring order, scope, filters, search,
  tools, timeline, groups, task form/modal, and selected workflow state.

Coverage sets a month period, unread filter, priority group, batch checkbox, and
open opportunity form, then verifies reset returns to today/all/all, five
conversations, four customers, no checked boxes, no open opportunity form, and
no created `86k` opportunity.

## TDD evidence

### RED

Focused store/render assertions were added first and failed for the intended
behaviors:

- missing default reciprocal link;
- no legacy relationship normalization;
- generic stage mutation allowed a terminal escape;
- malicious persisted customer name survived validation;
- dashboard rows lacked typed entity attributes.

The focused Playwright journey was then extended before implementation. Its
failures exposed the acquisition view's missing demo disclosure, the
conversation inspector's missing selected name, and the corrected seeded
relationship changing the expected transfer control.

### GREEN

After the implementation, the focused store/render test and the expanded
Playwright journey passed. The browser test also asserts that there are no
console or page errors and that the 390 px viewport has exactly 390 px of
document width.

## Verification

All commands below were run from `/tmp/goodjob-publish.rL22DN` unless noted.

### Focused store/render self-test

```sh
PATH=/Users/adminmima0000/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
node --import ./frontend/node_modules/tsx/dist/loader.mjs \
frontend/src/demo/demo-store.self-test.ts
```

Result: exit `0`.

### Full frontend self-test

```sh
PATH=/Users/adminmima0000/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
node --import ./frontend/node_modules/tsx/dist/loader.mjs frontend/src/self-test.ts
```

Result:

```json
{
  "ok": true,
  "checked": 107
}
```

### TypeScript

```sh
PATH=/Users/adminmima0000/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
node frontend/node_modules/typescript/bin/tsc -b frontend
```

Result: exit `0`, no diagnostics.

### Production build

```sh
PATH=/Users/adminmima0000/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
node frontend/node_modules/vite/bin/vite.js build frontend
```

Result: exit `0`; Vite `6.4.3`; 638 modules transformed; built in 2.55 s.
The existing large-chunk warning remains.

### Focused browser journey

Run from `frontend/`:

```sh
PATH=/Users/adminmima0000/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH \
npx playwright test tests/crm.spec.ts --grep "core frontend demo journey"
```

Result: `1 passed (12.3s)`; Chromium journey duration 10.0 s.

### Visual review

The Playwright journey regenerated and each image was inspected:

- `tmp/design-qa/demo-dashboard-1460x1000.png`
- `tmp/design-qa/demo-conversations-1460x1000.png`
- `tmp/design-qa/demo-private-domain-1460x1000.png`
- `tmp/design-qa/demo-conversion-1460x1000.png`
- `tmp/design-qa/demo-core-mobile-390x844.png`

Result: desktop views remain coherent, terminal conversion controls and the
explicit loss-reason placeholder are visible, and the 390 px mobile layout is
single-column without horizontal overflow. The in-app browser was unavailable,
so the exact final review status is **passed (Playwright); in-app browser
unavailable**.

## Files changed

- `design-qa.md`
- `frontend/index.html`
- `frontend/src/demo/demo-app.ts`
- `frontend/src/demo/demo-conversations-view.ts`
- `frontend/src/demo/demo-conversion-view.ts`
- `frontend/src/demo/demo-dashboard-view.ts`
- `frontend/src/demo/demo-private-domain-view.ts`
- `frontend/src/demo/demo-router.ts`
- `frontend/src/demo/demo-seed.ts`
- `frontend/src/demo/demo-store.self-test.ts`
- `frontend/src/demo/demo-store.ts`
- `frontend/src/replica-dashboard.ts`
- `frontend/tests/crm.spec.ts`
- `营销系统前端设计.md`
- `.superpowers/sdd/2026-07-29-core-business-frontend-demo/final-fix-report.md`

## Remaining concerns

- The in-app browser was unavailable; browser confidence comes from the
  Playwright Chromium journey and screenshot inspection.
- Vite still reports the pre-existing large-chunk warning for the main bundle.
- Acquisition remains intentionally simulated; unsupported platforms have an
  explicit no-op message and no real synchronization occurs.
- Dependency/security-audit scope was unchanged in this wave.
