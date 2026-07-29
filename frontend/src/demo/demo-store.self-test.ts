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
