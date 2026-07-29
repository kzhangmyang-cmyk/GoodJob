# GoodJob Core Business Frontend Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure-frontend, locally persistent demonstration of the GoodJob journey from acquisition through social conversation and private-domain management to opportunity conversion.

**Architecture:** Keep the accepted replica acquisition workspace intact and add a sibling demo workspace controlled by a small module router. A typed demo store owns all conversations, customers, opportunities, activities, tasks, persistence, and reset behavior; focused view modules render each business surface and dispatch state actions back to the store.

**Tech Stack:** TypeScript, Vite, native DOM APIs, CSS, localStorage, Node `assert` self-tests, existing Phosphor icon font.

## Global Constraints

- Frontend only; do not create, modify, or call backend endpoints.
- All messages, agents, scripts, platform accounts, transfers, quotes, orders, payments, and conversions are simulated.
- Preserve the accepted near-black glass workspace, cold white borders, soft inner highlights, fluorescent green primary accent, and Phosphor icon system.
- Keep the existing acquisition center behavior working.
- Persist demo state in `localStorage` under one versioned key and provide a confirmed reset action.
- Every real external capability must visibly say `演示模式` or `演示版暂未接入`.
- Desktop keeps navigation, primary workspace, and inspector visible; 390px layouts must not create document-level horizontal overflow.
- Do not add new runtime dependencies.

---

## File Structure

### New files

- `frontend/src/demo/demo-types.ts` — shared domain types and module identifiers.
- `frontend/src/demo/demo-seed.ts` — deterministic default demo data.
- `frontend/src/demo/demo-store.ts` — state transitions, subscriptions, persistence, and reset.
- `frontend/src/demo/demo-store.self-test.ts` — Node assertions for the cross-module state flow.
- `frontend/src/demo/demo-ui.ts` — HTML escaping, formatting, toast, and DOM helper functions.
- `frontend/src/demo/demo-router.ts` — navigation, acquisition/demo panel switching, and shared header state.
- `frontend/src/demo/demo-dashboard-view.ts` — automatic-marketing overview rendering and navigation actions.
- `frontend/src/demo/demo-conversations-view.ts` — inbox, chat, AI analysis, takeover, and private transfer.
- `frontend/src/demo/demo-private-domain-view.ts` — customer groups, table, detail, follow-up, and opportunity creation.
- `frontend/src/demo/demo-conversion-view.ts` — metrics, six-stage board, quote, win, and loss actions.
- `frontend/src/demo/demo-capabilities-view.ts` — lightweight agent, script, trade-marketing, and settings demos.
- `frontend/src/demo/demo-app.ts` — app composition, store subscription, view lifecycle, and event delegation.
- `frontend/src/demo/demo.css` — all demo-module layout and responsive styling.

### Modified files

- `frontend/index.html` — add acquisition panel markers, demo main/inspector hosts, stable header IDs, and demo assets.
- `frontend/src/replica-dashboard.ts` — hand navigation ownership to `demo-app` while preserving acquisition interactions.
- `frontend/src/self-test.ts` — import demo state assertions and verify new module hosts/assets.
- `frontend/tests/crm.spec.ts` — add navigation and core demo-flow browser coverage.
- `营销系统前端设计.md` — mark the four core modules as implemented when complete.
- `design-qa.md` — record desktop/mobile fidelity and interaction evidence.

---

### Task 1: Typed Demo State and Persistence

**Files:**
- Create: `frontend/src/demo/demo-types.ts`
- Create: `frontend/src/demo/demo-seed.ts`
- Create: `frontend/src/demo/demo-store.ts`
- Create: `frontend/src/demo/demo-store.self-test.ts`
- Modify: `frontend/src/self-test.ts`

**Interfaces:**
- Produces: `DemoState`, `DemoConversation`, `DemoCustomer`, `DemoOpportunity`, `DemoActivity`, `DemoTask`.
- Produces: `createDemoStore(options?: DemoStoreOptions): DemoStore`.
- Produces store methods: `selectConversation`, `sendMessage`, `setConversationMode`, `addConversationTag`, `addCustomerTag`, `transferConversationToPrivate`, `updateCustomer`, `createFollowUp`, `simulateOutreach`, `createOpportunity`, `moveOpportunity`, `createQuote`, `markQuoteSent`, `updateOpportunity`, `closeOpportunity`, `toggleAgent`, `toggleScript`, `reset`.
- Later tasks consume `DemoStore.getState()`, `DemoStore.subscribe(listener)`, and the methods above.

- [ ] **Step 1: Write the failing store assertions**

Create `frontend/src/demo/demo-store.self-test.ts`:

```ts
import { strict as assert } from "node:assert";
import { createDemoStore } from "./demo-store";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key)
};

const store = createDemoStore({ storage, now: () => "2026-07-29T09:00:00.000Z" });
const initial = store.getState();
assert.equal(initial.conversations.length >= 5, true);
assert.equal(initial.customers.length >= 4, true);
assert.equal(initial.opportunities.length >= 3, true);

const conversationId = initial.conversations[0].id;
store.sendMessage(conversationId, "请问您预计什么时候采购？");
assert.equal(store.getState().conversations[0].messages.at(-1)?.body, "请问您预计什么时候采购？");

store.setConversationMode(conversationId, "manual");
assert.equal(store.getState().conversations[0].mode, "manual");
store.addConversationTag(conversationId, "已确认面积");
assert.equal(store.getState().conversations[0].tags.includes("已确认面积"), true);

const customerId = store.transferConversationToPrivate(conversationId);
assert.equal(store.getState().customers.some((item) => item.id === customerId), true);
assert.equal(store.transferConversationToPrivate(conversationId), customerId);

const opportunityId = store.createOpportunity(customerId, {
  title: "办公空间设计合作",
  amount: 86000
});
store.moveOpportunity(opportunityId, "quoted");
store.createQuote(opportunityId, 82000);
store.markQuoteSent(opportunityId);
store.updateOpportunity(opportunityId, {
  probability: 85,
  nextAction: "确认合同细节"
});
store.closeOpportunity(opportunityId, "won");
assert.equal(store.getState().opportunities.find((item) => item.id === opportunityId)?.stage, "won");
assert.equal(store.getState().opportunities.find((item) => item.id === opportunityId)?.quoteSentAt, "2026-07-29T09:00:00.000Z");

store.toggleAgent("社媒沟通智能体");
store.toggleScript("抖音");
assert.equal(store.getState().demoSettings.agents["社媒沟通智能体"], false);
assert.equal(store.getState().demoSettings.scripts["抖音"], false);

const reloaded = createDemoStore({ storage, now: () => "2026-07-29T10:00:00.000Z" });
assert.equal(reloaded.getState().opportunities.some((item) => item.id === opportunityId), true);

reloaded.reset();
assert.equal(reloaded.getState().opportunities.some((item) => item.id === opportunityId), false);
```

Add this import near the top of `frontend/src/self-test.ts`:

```ts
import "./demo/demo-store.self-test";
```

- [ ] **Step 2: Run the self-test and verify it fails**

Run:

```bash
node --import ./frontend/node_modules/tsx/dist/loader.mjs frontend/src/self-test.ts
```

Expected: FAIL with `Cannot find module './demo/demo-store'`.

- [ ] **Step 3: Define the domain types**

Create `frontend/src/demo/demo-types.ts` with these exact unions and primary shapes:

```ts
export type DemoModule =
  | "dashboard"
  | "acquisition"
  | "conversations"
  | "private-domain"
  | "conversion"
  | "agents"
  | "scripts"
  | "trade-marketing"
  | "settings";

export type Platform = "抖音" | "小红书" | "快手" | "微信" | "微博";
export type IntentLevel = "高" | "中" | "低";
export type ConversationMode = "agent" | "manual" | "paused";
export type OpportunityStage = "new" | "qualified" | "quoted" | "negotiating" | "won" | "lost";

export interface DemoMessage {
  id: string;
  sender: "customer" | "agent" | "operator";
  body: string;
  sentAt: string;
  simulated: true;
}

export interface DemoConversation {
  id: string;
  customerId?: string;
  customerName: string;
  platform: Platform;
  intent: IntentLevel;
  unread: number;
  mode: ConversationMode;
  needSummary: string;
  risk: string;
  tags: string[];
  messages: DemoMessage[];
  updatedAt: string;
}

export interface DemoCustomer {
  id: string;
  conversationId: string;
  name: string;
  platform: Platform;
  intent: IntentLevel;
  group: "重点客户" | "待跟进" | "沉默客户" | "已创建商机";
  tags: string[];
  owner: string;
  needSummary: string;
  lastContactAt: string;
  nextFollowUpAt: string;
  status: "跟进中" | "待跟进" | "已沉默" | "已有商机";
}

export interface DemoOpportunity {
  id: string;
  customerId: string;
  title: string;
  amount: number;
  probability: number;
  stage: OpportunityStage;
  source: Platform;
  nextAction: string;
  quoteAmount?: number;
  quoteSentAt?: string;
  lossReason?: string;
  updatedAt: string;
}

export interface DemoActivity {
  id: string;
  kind: "message" | "transfer" | "follow-up" | "opportunity" | "quote" | "stage";
  title: string;
  detail: string;
  createdAt: string;
}

export interface DemoTask {
  id: string;
  title: string;
  priority: "高" | "中" | "低";
  module: DemoModule;
  relatedId: string;
  done: boolean;
}

export interface DemoSettings {
  agents: Record<"获客识别智能体" | "社媒沟通智能体" | "客户跟进智能体", boolean>;
  scripts: Record<Platform, boolean>;
}

export interface DemoState {
  version: 1;
  selectedConversationId: string;
  selectedCustomerId: string;
  selectedOpportunityId: string;
  conversations: DemoConversation[];
  customers: DemoCustomer[];
  opportunities: DemoOpportunity[];
  activities: DemoActivity[];
  tasks: DemoTask[];
  demoSettings: DemoSettings;
}
```

- [ ] **Step 4: Add deterministic seed data**

Create `frontend/src/demo/demo-seed.ts` exporting `createSeedDemoState()`. The first
conversation must be exactly:

```ts
import type { DemoState } from "./demo-types";

export function createSeedDemoState(): DemoState {
  return {
    version: 1,
    selectedConversationId: "conversation-douyin-lin",
    selectedCustomerId: "customer-wechat-zhou",
    selectedOpportunityId: "opportunity-office",
    conversations: [
      {
        id: "conversation-douyin-lin",
        customerName: "林女士",
        platform: "抖音",
        intent: "高",
        unread: 2,
        mode: "agent",
        needSummary: "正在寻找办公室设计服务，关注预算和交付周期。",
        risk: "尚未确认项目面积和所在城市。",
        tags: ["办公室设计", "近期采购"],
        updatedAt: "2026-07-29T08:42:00.000Z",
        messages: [
          { id: "message-1", sender: "customer", body: "我们准备重新设计办公室，想先了解大概费用。", sentAt: "2026-07-29T08:38:00.000Z", simulated: true },
          { id: "message-2", sender: "agent", body: "可以的，请问办公室面积和所在城市方便告知吗？", sentAt: "2026-07-29T08:40:00.000Z", simulated: true }
        ]
      }
    ],
    customers: [/* fixtures listed below */],
    opportunities: [/* fixtures listed below */],
    activities: [/* fixtures listed below */],
    tasks: [/* fixtures listed below */],
    demoSettings: {
      agents: {
        "获客识别智能体": true,
        "社媒沟通智能体": true,
        "客户跟进智能体": true
      },
      scripts: {
        "抖音": true,
        "小红书": true,
        "快手": false,
        "微信": true,
        "微博": false
      }
    }
  };
}
```

Add these deterministic fixtures around the exact first conversation above:

- Conversations:
  - `conversation-douyin-lin` — 抖音 / 林女士 / 高意向 / 智能体运行。
  - `conversation-xhs-chen` — 小红书 / 陈先生 / 中意向 / 人工接管。
  - `conversation-kuaishou-wang` — 快手 / 王女士 / 高意向 / 智能体暂停。
  - `conversation-weibo-zhao` — 微博 / 赵先生 / 低意向 / 智能体运行。
  - `conversation-wechat-li` — 微信 / 李女士 / 中意向 / 智能体运行。
- Private customers:
  - `customer-wechat-zhou` — 周先生 / 微信 / 重点客户 / 跟进中。
  - `customer-douyin-sun` — 孙女士 / 抖音 / 待跟进 / 待跟进。
  - `customer-xhs-gu` — 顾先生 / 小红书 / 已创建商机 / 已有商机。
  - `customer-weibo-he` — 何女士 / 微博 / 沉默客户 / 已沉默。
- Opportunities:
  - `opportunity-office` — 办公空间设计 / `qualified` / `120000` / 概率 `55`。
  - `opportunity-training` — 企业培训年度合作 / `quoted` / `68000` / 概率 `70`。
  - `opportunity-retail` — 零售门店升级 / `negotiating` / `188000` / 概率 `80`。
- Add eight chronological activities spanning message, transfer, follow-up,
  opportunity, quote, and stage kinds.
- Add four incomplete tasks across conversations, private-domain, and conversion,
  including at least one task at each priority.

Every customer and opportunity must reference an existing stable ID, all five
platforms must appear in conversations, and every opportunity stage except `lost`
must be represented either in these fixtures or by the state-transition tests.

- [ ] **Step 5: Implement the store**

Create `frontend/src/demo/demo-store.ts`:

```ts
import { createSeedDemoState } from "./demo-seed";
import type {
  ConversationMode,
  DemoState,
  OpportunityStage
} from "./demo-types";

const STORAGE_KEY = "goodjob.frontend-demo.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DemoStoreOptions {
  storage?: StorageLike | null;
  now?: () => string;
}

export interface DemoStore {
  getState(): DemoState;
  subscribe(listener: (state: DemoState) => void): () => void;
  selectConversation(id: string): void;
  selectCustomer(id: string): void;
  selectOpportunity(id: string): void;
  sendMessage(conversationId: string, body: string): void;
  setConversationMode(conversationId: string, mode: ConversationMode): void;
  addConversationTag(conversationId: string, tag: string): void;
  addCustomerTag(customerId: string, tag: string): void;
  transferConversationToPrivate(conversationId: string): string;
  updateCustomer(customerId: string, patch: Partial<Pick<DemoState["customers"][number], "group" | "status" | "nextFollowUpAt">>): void;
  createFollowUp(customerId: string, note: string, dueAt: string): void;
  simulateOutreach(customerIds: string[]): void;
  createOpportunity(customerId: string, input: { title: string; amount: number }): string;
  moveOpportunity(opportunityId: string, stage: OpportunityStage): void;
  createQuote(opportunityId: string, amount: number): void;
  markQuoteSent(opportunityId: string): void;
  updateOpportunity(opportunityId: string, patch: Partial<Pick<DemoState["opportunities"][number], "amount" | "probability" | "nextAction">>): void;
  closeOpportunity(opportunityId: string, result: "won" | "lost", reason?: string): void;
  toggleAgent(name: keyof DemoState["demoSettings"]["agents"]): void;
  toggleScript(platform: keyof DemoState["demoSettings"]["scripts"]): void;
  reset(): void;
}
```

Implement immutable top-level array updates, append an activity for every mutation,
save after every mutation, and notify subscribers once per mutation. If stored JSON
is invalid or not `version: 1`, replace it with `createSeedDemoState()`.

Use these exact cross-module rules:

- Trim user-entered text; blank messages, tags, follow-up notes, and opportunity
  titles do not mutate state.
- Unknown IDs do not mutate state and do not notify subscribers.
- `selectConversation` clears that conversation's unread count.
- `transferConversationToPrivate` is idempotent: if the conversation already has a
  linked customer, return the existing ID without creating a duplicate.
- A newly transferred customer starts in `待跟进` with status `待跟进`, and the
  conversation receives the new `customerId`.
- `createOpportunity` changes the linked customer to group `已创建商机` and status
  `已有商机`.
- `createQuote` stores the amount and moves the opportunity to `quoted`;
  `markQuoteSent` writes `quoteSentAt`.
- `closeOpportunity(..., "won")` sets probability to `100`; a loss stores the
  selected reason and sets probability to `0`.
- Agent/script toggle state lives only in `demoSettings`.

- [ ] **Step 6: Run self-test and TypeScript**

Run:

```bash
node --import ./frontend/node_modules/tsx/dist/loader.mjs frontend/src/self-test.ts
node frontend/node_modules/typescript/bin/tsc -b frontend
```

Expected: both commands exit `0`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/demo frontend/src/self-test.ts
git commit -m "feat: add frontend demo state store"
```

---

### Task 2: Demo Workspace Shell and Module Router

**Files:**
- Create: `frontend/src/demo/demo-ui.ts`
- Create: `frontend/src/demo/demo-router.ts`
- Create: `frontend/src/demo/demo-app.ts`
- Create: `frontend/src/demo/demo.css`
- Modify: `frontend/index.html`
- Modify: `frontend/src/replica-dashboard.ts`
- Modify: `frontend/src/self-test.ts`

**Interfaces:**
- Consumes: `DemoModule`, `DemoStore`.
- Produces: `createDemoRouter(options): DemoRouter`.
- Produces: `startDemoApp(): void`.
- Later views implement `render(state, host, inspector)` and call `router.navigate(module)`.

- [ ] **Step 1: Add failing static assertions**

Add these required strings to `frontend/src/self-test.ts`:

```ts
"id=\"demoModuleMain\"",
"id=\"demoModuleInspector\"",
"data-replica-module-panel=\"acquisition\"",
"src/demo/demo-app.ts",
"src/demo/demo.css"
```

- [ ] **Step 2: Run self-test and verify it fails**

Run:

```bash
node --import ./frontend/node_modules/tsx/dist/loader.mjs frontend/src/self-test.ts
```

Expected: FAIL with `missing id="demoModuleMain"`.

- [ ] **Step 3: Add stable hosts and acquisition markers**

In `frontend/index.html`:

- Add `id="replicaHeaderTitle"` to the header `<h1>`.
- Add `id="replicaHeaderSubtitle"` to its subtitle.
- Add `data-replica-module-panel="acquisition"` to the current `.replica-main` and `.replica-inspector`.
- Insert these direct siblings after the acquisition inspector:

```html
<main class="replica-demo-main" id="demoModuleMain" hidden aria-live="polite"></main>
<aside class="replica-demo-inspector replica-glass" id="demoModuleInspector" hidden></aside>
```

- Link `/src/demo/demo.css`.
- Load `/src/demo/demo-app.ts` after `/src/replica-dashboard.ts`.

- [ ] **Step 4: Implement shared UI helpers**

Create `frontend/src/demo/demo-ui.ts` exporting:

```ts
export function escapeHtml(value: string): string;
export function formatMoney(value: number): string;
export function formatRelativeTime(iso: string): string;
export function showDemoToast(message: string): void;
export function readInput(root: ParentNode, selector: string): string;
```

`showDemoToast` must reuse `#replicaToast` and prefix simulated actions with `演示：`.

- [ ] **Step 5: Implement the router**

Create `frontend/src/demo/demo-router.ts`:

```ts
import type { DemoModule } from "./demo-types";

export interface DemoRouter {
  current(): DemoModule;
  navigate(module: DemoModule): void;
  subscribe(listener: (module: DemoModule) => void): () => void;
}

export function createDemoRouter(initial: DemoModule = "acquisition"): DemoRouter;
```

`navigate` must:

- Toggle active `[data-replica-view]`.
- Show acquisition main/inspector only for `acquisition`.
- Show `#demoModuleMain` and `#demoModuleInspector` for other modules.
- Update header title, subtitle, search placeholder, and primary action label from a fixed module metadata map.
- Dispatch one subscriber notification.
- Update `location.hash` to the module name and restore a valid module from the hash
  on reload; unknown hashes fall back to `acquisition`.

- [ ] **Step 6: Compose the demo app**

Create `frontend/src/demo/demo-app.ts` that:

- Creates one store and one router.
- Owns one delegated click/change/submit listener on `.replica-shell`.
- Renders the current module on store or router changes.
- Exposes no globals.
- Calls `startDemoApp()` once at module load.

Remove the existing non-acquisition navigation toast branch from `replica-dashboard.ts`; acquisition task interactions remain unchanged.

- [ ] **Step 7: Add base demo CSS**

Create `frontend/src/demo/demo.css` with:

- `.replica-demo-main` at grid column 2, row 2.
- `.replica-demo-inspector` at grid column 3, row 2.
- Shared `.demo-toolbar`, `.demo-panel`, `.demo-metric`, `.demo-list`, `.demo-row`, `.demo-empty`, `.demo-chip`, `.demo-status`, `.demo-primary`.
- The same borders, glass surfaces, radii, typography density, and green accent as `replica-dashboard.css`.
- A `max-width: 900px` rule that stacks main and inspector without document overflow.

- [ ] **Step 8: Run self-test, TypeScript, and build**

Run:

```bash
node --import ./frontend/node_modules/tsx/dist/loader.mjs frontend/src/self-test.ts
node frontend/node_modules/typescript/bin/tsc -b frontend
node frontend/node_modules/vite/bin/vite.js build frontend
```

Expected: all commands exit `0`; Vite may retain only the existing chunk-size warning.

- [ ] **Step 9: Commit**

```bash
git add frontend/index.html frontend/src/demo frontend/src/replica-dashboard.ts frontend/src/self-test.ts
git commit -m "feat: add frontend demo module router"
```

---

### Task 3: Automatic Marketing Overview

**Files:**
- Create: `frontend/src/demo/demo-dashboard-view.ts`
- Modify: `frontend/src/demo/demo-app.ts`
- Modify: `frontend/src/demo/demo.css`
- Modify: `frontend/src/self-test.ts`

**Interfaces:**
- Consumes: `DemoState`, `DemoRouter`.
- Produces:

```ts
export function renderDashboardView(
  state: DemoState,
  main: HTMLElement,
  inspector: HTMLElement
): void;
```

- [ ] **Step 1: Add failing view assertions**

Add:

```ts
"renderDashboardView",
"data-demo-action=\"open-module\"",
"今日业务漏斗",
"最近业务活动"
```

to the `required` list in `frontend/src/self-test.ts`, and add `demo-dashboard-view.ts` to the files read by the self-test.

- [ ] **Step 2: Run self-test and verify it fails**

Expected: FAIL with `missing renderDashboardView`.

- [ ] **Step 3: Render overview metrics and business sections**

Implement `renderDashboardView` with:

- Six metrics: 今日发现、正在沟通、转入私域、新建商机、预计成交、待人工接管.
- A four-step funnel: 发现客户、有效沟通、进入私域、形成商机.
- Three priority customers derived from high-intent conversations/customers.
- Incomplete tasks sorted high to low.
- The latest eight activities.
- `今日 / 本周 / 本月` buttons that switch deterministic frontend-only metric
  multipliers and never request data.
- Inspector showing today’s summary, demo-mode notice, and reset guidance.

Metric and task buttons use:

```html
<button data-demo-action="open-module" data-demo-module="conversations">...</button>
```

- [ ] **Step 4: Wire dashboard navigation**

In `demo-app.ts`, handle `[data-demo-action="open-module"]` by calling `router.navigate` with the button’s `data-demo-module`.

- [ ] **Step 5: Style the overview**

Add a six-column responsive metric rail, open funnel band, priority list, task list, and activity rail. At widths below 1200px use three metric columns; below 700px use two.

- [ ] **Step 6: Verify**

Run self-test, TypeScript, and build. In the browser, click “正在沟通” and verify navigation to `conversations`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/demo frontend/src/self-test.ts
git commit -m "feat: add automatic marketing overview"
```

---

### Task 4: Social Conversation Workbench

**Files:**
- Create: `frontend/src/demo/demo-conversations-view.ts`
- Modify: `frontend/src/demo/demo-app.ts`
- Modify: `frontend/src/demo/demo.css`
- Modify: `frontend/src/demo/demo-store.self-test.ts`

**Interfaces:**
- Consumes: `DemoState`, `DemoStore`.
- Produces:

```ts
export function renderConversationsView(
  state: DemoState,
  main: HTMLElement,
  inspector: HTMLElement
): void;
```

- [ ] **Step 1: Extend failing state tests**

Add assertions:

```ts
store.selectConversation(conversationId);
store.sendMessage(conversationId, "演示消息");
const afterSend = store.getState().conversations.find((item) => item.id === conversationId);
assert.equal(afterSend?.unread, 0);
assert.equal(afterSend?.messages.at(-1)?.sender, "operator");

store.setConversationMode(conversationId, "paused");
assert.equal(store.getState().conversations.find((item) => item.id === conversationId)?.mode, "paused");
```

Run self-test and expect failure until unread/mode behavior is implemented.

- [ ] **Step 2: Implement the three-column workbench**

Render:

- Platform filters and counts.
- `全部 / 未读 / 高意向 / 需人工` filters.
- Conversation rows with platform, latest message, time, unread, and intent.
- Chat header and complete message history.
- Composer with `textarea[name="demo-message"]`.
- Quick reply buttons.
- Inspector with intent, need summary, risk, tags, mode, takeover, and transfer.

Every real-action control shows an `演示模式` label.

- [ ] **Step 3: Wire conversation interactions**

Handle:

- `select-conversation`
- `filter-conversations`
- `quick-reply`
- `send-message`
- `set-conversation-mode`
- `add-conversation-tag`
- `transfer-to-private`

For `send-message`, reject empty text with `请输入演示消息`. After an operator message, append one fixed agent response only when mode is `agent`.
When transfer succeeds, show `演示：客户已转入私域` and provide a button that
navigates directly to the selected customer in `private-domain`.

- [ ] **Step 4: Style the workbench**

Use `grid-template-columns: 260px minmax(380px, 1fr)` inside main, with the existing page inspector as the analysis column. Message bubbles must remain code-native and readable, with green used for operator/selected state only.

- [ ] **Step 5: Verify**

Run tests/build. Browser path:

1. Open 社媒对话.
2. Select 小红书.
3. Send `预算大约是多少？`.
4. Verify the message appears.
5. Switch to 人工接管.
6. Transfer the conversation to private domain.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/demo
git commit -m "feat: add social conversation demo"
```

---

### Task 5: Private-Domain Customer Pool

**Files:**
- Create: `frontend/src/demo/demo-private-domain-view.ts`
- Modify: `frontend/src/demo/demo-app.ts`
- Modify: `frontend/src/demo/demo.css`
- Modify: `frontend/src/demo/demo-store.self-test.ts`

**Interfaces:**
- Consumes: `DemoState`, `DemoStore`.
- Produces:

```ts
export function renderPrivateDomainView(
  state: DemoState,
  main: HTMLElement,
  inspector: HTMLElement
): void;
```

- [ ] **Step 1: Add failing customer transition tests**

```ts
store.selectCustomer(customerId);
store.addCustomerTag(customerId, "预算明确");
store.updateCustomer(customerId, {
  group: "重点客户",
  nextFollowUpAt: "2026-07-30T10:00:00.000Z"
});
store.createFollowUp(customerId, "发送案例与报价范围", "2026-07-30T10:00:00.000Z");
const updated = store.getState().customers.find((item) => item.id === customerId);
assert.equal(updated?.tags.includes("预算明确"), true);
assert.equal(updated?.group, "重点客户");
assert.equal(store.getState().tasks.some((item) => item.relatedId === customerId), true);
```

- [ ] **Step 2: Render groups, customer table, and inspector**

Render:

- Group rail: 全部客户、重点客户、待跟进、沉默客户、已创建商机.
- A “自定义分组” entry marked `演示版暂未接入`.
- Search and intent/source filters.
- Table columns defined in the design spec.
- Selected customer inspector with source, need, chat summary, tags, group, and timeline.
- Buttons: 添加标签、安排跟进、模拟批量触达、创建商机.

- [ ] **Step 3: Wire customer interactions**

Handle:

- `select-customer`
- `filter-customers`
- `add-customer-tag`
- `change-customer-group`
- `create-follow-up`
- `simulate-outreach`
- `open-opportunity-form`
- `create-opportunity`

`simulate-outreach` changes selected customers to `待跟进` and appends one activity; it must show `演示：已模拟触达`.
The table provides checkboxes for batch selection. The batch action is disabled
until at least one customer is selected. Creating an opportunity selects the new
opportunity and navigates to `conversion`.

- [ ] **Step 4: Style table and narrow layout**

Desktop uses group rail + table in main and detail in inspector. Below 900px the group rail becomes a horizontal scroller and table rows become labeled customer cards; no document-level horizontal scroll.

- [ ] **Step 5: Verify**

Run tests/build. Browser path:

1. Open 私域客户池.
2. Select a transferred customer.
3. Add `预算明确`.
4. Create a follow-up.
5. Create an opportunity for `86000`.
6. Verify the customer becomes `已有商机`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/demo
git commit -m "feat: add private-domain customer demo"
```

---

### Task 6: Conversion Workbench

**Files:**
- Create: `frontend/src/demo/demo-conversion-view.ts`
- Modify: `frontend/src/demo/demo-app.ts`
- Modify: `frontend/src/demo/demo.css`
- Modify: `frontend/src/demo/demo-store.self-test.ts`

**Interfaces:**
- Consumes: `DemoState`, `DemoStore`, `OpportunityStage`.
- Produces:

```ts
export function renderConversionView(
  state: DemoState,
  main: HTMLElement,
  inspector: HTMLElement
): void;
```

- [ ] **Step 1: Add failing conversion assertions**

```ts
store.selectOpportunity(opportunityId);
store.moveOpportunity(opportunityId, "negotiating");
store.createQuote(opportunityId, 81800);
let opportunity = store.getState().opportunities.find((item) => item.id === opportunityId);
assert.equal(opportunity?.stage, "negotiating");
assert.equal(opportunity?.quoteAmount, 81800);

store.closeOpportunity(opportunityId, "lost", "预算延期");
opportunity = store.getState().opportunities.find((item) => item.id === opportunityId);
assert.equal(opportunity?.stage, "lost");
assert.equal(opportunity?.lossReason, "预算延期");
```

- [ ] **Step 2: Render metrics and six-stage board**

Render:

- 商机总数、商机总金额、预计成交、待报价、已成交、待回款.
- Columns: 新商机、需求确认、已报价、谈判中、已成交、已流失.
- Opportunity cards with customer, title, amount, probability, source, next action.
- Inspector with requirement summary, quotes, stage controls, and next action.

- [ ] **Step 3: Wire conversion actions**

Handle:

- `select-opportunity`
- `move-opportunity`
- `create-quote`
- `mark-quote-sent`
- `update-probability`
- `close-won`
- `close-lost`

Stage movement is button-based and drag-enhanced. Button movement is the accessibility baseline. `mark-quote-sent` calls `store.markQuoteSent`, and probability changes call `store.updateOpportunity`. Reject quote amounts below `1`; lost requires one of `预算延期 / 需求取消 / 选择其他供应商 / 无法联系`.
Calculate `预计成交` as the sum of `amount × probability`; `待报价` counts
`new` and `qualified`; `待回款` is the won amount and must be labelled
`演示估算`.

- [ ] **Step 4: Style board and inspector**

Use an open horizontal board with six narrow stage lanes; avoid nesting every lane inside a heavy glass card. The board scrolls horizontally inside its own container. Won cards use green edge emphasis; lost cards use neutral gray with a small red status dot.

- [ ] **Step 5: Verify**

Run tests/build. Browser path:

1. Open 成交工作台.
2. Select the newly created `86000` opportunity.
3. Move to 已报价.
4. Create an `82000` quote.
5. Move to 谈判中.
6. Mark simulated成交.
7. Verify overview values update.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/demo
git commit -m "feat: add conversion workbench demo"
```

---

### Task 7: Capability Demo Pages and Reset

**Files:**
- Create: `frontend/src/demo/demo-capabilities-view.ts`
- Modify: `frontend/src/demo/demo-app.ts`
- Modify: `frontend/src/demo/demo.css`
- Modify: `frontend/src/demo/demo-store.self-test.ts`

**Interfaces:**
- Consumes: `DemoModule`, `DemoState`, `DemoStore`.
- Produces:

```ts
export function renderCapabilityDemoView(
  module: "agents" | "scripts" | "trade-marketing" | "settings",
  state: DemoState,
  main: HTMLElement,
  inspector: HTMLElement
): void;
```

- [ ] **Step 1: Add reset persistence assertion**

After mutating the store:

```ts
store.reset();
const resetState = store.getState();
assert.equal(resetState.version, 1);
assert.equal(resetState.conversations[0].id, "conversation-douyin-lin");
assert.equal(memory.has("goodjob.frontend-demo.v1"), true);
```

- [ ] **Step 2: Render four lightweight pages**

Agents:

- 3 agent roles, status, current task, today count, simulated enable/pause.

Scripts:

- 5 platform scripts, schedule, last run, simulated enable/pause.

Trade marketing:

- Module explanation, target-market cards, content localization, email sequence, and trade-lead handoff marked `演示版暂未接入`.

Settings:

- Demo mode explanation.
- Local data count.
- “重置演示数据” button.
- Appearance, notification, and permission rows marked `演示版暂未接入`.

- [ ] **Step 3: Wire simulated toggles and reset**

Agent and script toggles call `store.toggleAgent` and `store.toggleScript`, persist in `demoSettings`, and show `演示：状态已切换`. Reset opens a native `<dialog>` confirmation; confirmation calls `store.reset()` and navigates to dashboard.

- [ ] **Step 4: Verify**

Run tests/build. Toggle one agent and one script, reload, verify no real service claim. Reset demo data and verify default dashboard/customer counts return.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/demo
git commit -m "feat: add capability demo pages"
```

---

### Task 8: End-to-End Coverage, Responsive QA, and Documentation

**Files:**
- Modify: `frontend/tests/crm.spec.ts`
- Modify: `frontend/src/self-test.ts`
- Modify: `营销系统前端设计.md`
- Modify: `design-qa.md`

**Interfaces:**
- Consumes all previous tasks.
- Produces final browser evidence and regression coverage.

- [ ] **Step 1: Add browser flow coverage**

Add a Playwright test named `core frontend demo journey` that:

```ts
await page.goto("/");
await page.getByTitle("社媒对话").click();
await page.locator('[data-conversation-id="conversation-douyin-lin"]').click();
await page.locator('textarea[name="demo-message"]').fill("预算大约是多少？");
await page.getByRole("button", { name: "发送演示消息" }).click();
await page.getByRole("button", { name: "人工接管" }).click();
await page.getByRole("button", { name: "转入私域" }).click();

await page.getByTitle("私域客户池").click();
await page.locator('[data-customer-source="conversation-douyin-lin"]').click();
await page.getByRole("button", { name: "创建商机" }).click();
await page.locator('input[name="opportunity-amount"]').fill("86000");
await page.getByRole("button", { name: "确认创建商机" }).click();

await page.getByTitle("成交工作台").click();
await expect(page.getByText("¥86,000")).toBeVisible();
```

Reset localStorage in `beforeEach` so the test is deterministic.
Use the existing Playwright base URL from this repository; do not add a second
preview server configuration.

- [ ] **Step 2: Run automated checks**

Run:

```bash
node --import ./frontend/node_modules/tsx/dist/loader.mjs frontend/src/self-test.ts
node frontend/node_modules/typescript/bin/tsc -b frontend
node frontend/node_modules/vite/bin/vite.js build frontend
```

Expected: all exit `0`.

Run the focused browser test:

```bash
cd frontend && npx playwright test tests/crm.spec.ts --grep "core frontend demo journey"
```

Expected: PASS.

- [ ] **Step 3: Verify with the in-app browser**

At desktop viewport:

- Click all nine navigation entries.
- Complete the conversation → private customer → opportunity → won flow.
- Reload and verify persistence.
- Reset and verify defaults.
- Confirm no console errors.

At `390 × 844`:

- Open dashboard, conversations, private domain, and conversion.
- Confirm the primary action, selected row, and detail remain usable.
- Confirm `document.documentElement.scrollWidth === 390`.

- [ ] **Step 4: Capture visual evidence**

Capture:

- `tmp/design-qa/demo-dashboard-1460x1000.png`
- `tmp/design-qa/demo-conversations-1460x1000.png`
- `tmp/design-qa/demo-private-domain-1460x1000.png`
- `tmp/design-qa/demo-conversion-1460x1000.png`
- `tmp/design-qa/demo-core-mobile-390x844.png`

Use `view_image` on the accepted reference `/Users/adminmima0000/Downloads/IMG_9242.jpg` and each latest module screenshot. Compare at least:

1. Workspace grid and density.
2. Near-black glass palette.
3. Green selected/primary states.
4. Typography hierarchy.
5. Border, radius, and icon treatment.
6. Responsive continuation.

- [ ] **Step 5: Update documentation**

In `营销系统前端设计.md`, move the four core modules from “待补充内容” to “已完成的前端演示模块” and state that all actions are simulated.

Append a QA section to `design-qa.md` with screenshot paths, copy differences, intentional deviations, interaction results, build results, mobile width, and:

```text
final result: passed
```

- [ ] **Step 6: Final regression and commit**

Run self-test, TypeScript, build, focused Playwright, and browser console check again.

```bash
git add frontend/tests/crm.spec.ts frontend/src/self-test.ts '营销系统前端设计.md' design-qa.md
git commit -m "test: verify core frontend demo journey"
```

Expected: clean working tree and no uncommitted task files.
