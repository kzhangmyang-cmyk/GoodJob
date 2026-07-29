import { createSeedDemoState } from "./demo-seed";
import type {
  ConversationMode,
  DemoActivity,
  DemoCustomer,
  DemoState,
  OpportunityStage
} from "./demo-types";

const STORAGE_KEY = "goodjob.frontend-demo.v1";
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

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
  sendAgentReply(conversationId: string): void;
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

function browserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isValidState(value: unknown): value is DemoState {
  if (!isRecord(value) || value.version !== 1) return false;
  return typeof value.selectedConversationId === "string"
    && typeof value.selectedCustomerId === "string"
    && typeof value.selectedOpportunityId === "string"
    && Array.isArray(value.conversations)
    && value.conversations.every(isConversation)
    && Array.isArray(value.customers)
    && value.customers.every(isCustomer)
    && Array.isArray(value.opportunities)
    && value.opportunities.every(isOpportunity)
    && Array.isArray(value.activities)
    && value.activities.every(isActivity)
    && Array.isArray(value.tasks)
    && value.tasks.every(isTask)
    && isSettings(value.demoSettings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isConversation(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.customerId === undefined || typeof value.customerId === "string")
    && typeof value.customerName === "string"
    && typeof value.platform === "string"
    && typeof value.intent === "string"
    && typeof value.unread === "number"
    && typeof value.mode === "string"
    && typeof value.needSummary === "string"
    && typeof value.risk === "string"
    && isStringArray(value.tags)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage)
    && typeof value.updatedAt === "string";
}

function isMessage(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.sender === "string"
    && typeof value.body === "string"
    && typeof value.sentAt === "string"
    && value.simulated === true;
}

function isCustomer(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.conversationId === "string"
    && typeof value.name === "string"
    && typeof value.platform === "string"
    && typeof value.intent === "string"
    && typeof value.group === "string"
    && isStringArray(value.tags)
    && typeof value.owner === "string"
    && typeof value.needSummary === "string"
    && typeof value.lastContactAt === "string"
    && typeof value.nextFollowUpAt === "string"
    && typeof value.status === "string";
}

function isOpportunity(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.customerId === "string"
    && typeof value.title === "string"
    && typeof value.amount === "number"
    && typeof value.probability === "number"
    && typeof value.stage === "string"
    && typeof value.source === "string"
    && typeof value.nextAction === "string"
    && (value.quoteAmount === undefined || typeof value.quoteAmount === "number")
    && (value.quoteSentAt === undefined || typeof value.quoteSentAt === "string")
    && (value.lossReason === undefined || typeof value.lossReason === "string")
    && typeof value.updatedAt === "string";
}

function isActivity(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.kind === "string"
    && typeof value.title === "string"
    && typeof value.detail === "string"
    && typeof value.createdAt === "string";
}

function isTask(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.priority === "string"
    && typeof value.module === "string"
    && typeof value.relatedId === "string"
    && typeof value.done === "boolean"
    && (value.dueAt === undefined || typeof value.dueAt === "string")
    && (value.createdAt === undefined || typeof value.createdAt === "string");
}

function isSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { agents: agentSettings, scripts: scriptSettings } = value;
  if (!isRecord(agentSettings) || !isRecord(scriptSettings)) return false;
  const agentNames = ["获客识别智能体", "社媒沟通智能体", "客户跟进智能体"];
  const platforms = ["抖音", "小红书", "快手", "微信", "微博"];
  return agentNames.every((name) => typeof agentSettings[name] === "boolean")
    && platforms.every((platform) => typeof scriptSettings[platform] === "boolean");
}

export function normalizeIsoDateTime(value: string): string | null {
  const candidate = value.trim();
  const match = ISO_DATE_TIME_PATTERN.exec(candidate);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;

  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function createDemoStore(options: DemoStoreOptions = {}): DemoStore {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Set<(state: DemoState) => void>();
  let state = loadInitialState(storage);

  function loadInitialState(candidateStorage: StorageLike | null): DemoState {
    if (!candidateStorage) return createSeedDemoState();
    try {
      const raw = candidateStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isValidState(parsed)) return parsed;
      }
    } catch {
      // Invalid or unavailable browser storage falls back to the deterministic demo.
    }
    const seed = createSeedDemoState();
    try {
      candidateStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    } catch {
      // Keep the in-memory demo state when storage cannot be written.
    }
    return seed;
  }

  function save(nextState: DemoState): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    } catch {
      // A full or unavailable localStorage must not break the demo interaction.
    }
  }

  function activity(nextState: DemoState, kind: DemoActivity["kind"], title: string, detail: string): DemoState {
    return {
      ...nextState,
      activities: [...nextState.activities, {
        id: `activity-${nextState.activities.length + 1}`,
        kind,
        title,
        detail,
        createdAt: now()
      }]
    };
  }

  function commit(update: (current: DemoState) => DemoState | null): void {
    const nextState = update(state);
    if (!nextState) return;
    state = nextState;
    save(state);
    listeners.forEach((listener) => listener(state));
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectConversation(id) {
      commit((current) => {
        const conversation = current.conversations.find((item) => item.id === id);
        if (!conversation) return null;
        const selectionChanged = current.selectedConversationId !== id;
        const unreadChanged = conversation.unread !== 0;
        if (!selectionChanged && !unreadChanged) return null;
        const next = {
          ...current,
          selectedConversationId: id,
          conversations: current.conversations.map((item) => item.id === id ? { ...item, unread: 0 } : item)
        };
        return activity(next, "message", "查看社媒对话", `已打开${conversation.customerName}的${conversation.platform}会话。`);
      });
    },
    selectCustomer(id) {
      commit((current) => {
        const customer = current.customers.find((item) => item.id === id);
        if (!customer || current.selectedCustomerId === id) return null;
        return activity({ ...current, selectedCustomerId: id }, "follow-up", "查看私域客户", `已打开${customer.name}的客户档案。`);
      });
    },
    selectOpportunity(id) {
      commit((current) => {
        const opportunity = current.opportunities.find((item) => item.id === id);
        if (!opportunity || current.selectedOpportunityId === id) return null;
        return activity({ ...current, selectedOpportunityId: id }, "stage", "查看成交商机", `已打开${opportunity.title}商机。`);
      });
    },
    sendMessage(conversationId, body) {
      const text = body.trim();
      if (!text) return;
      commit((current) => {
        const conversation = current.conversations.find((item) => item.id === conversationId);
        if (!conversation) return null;
        const sentAt = now();
        const message = { id: `message-${current.conversations.reduce((count, item) => count + item.messages.length, 0) + 1}`, sender: "operator" as const, body: text, sentAt, simulated: true as const };
        const next = {
          ...current,
          conversations: current.conversations.map((item) => item.id === conversationId ? { ...item, unread: 0, messages: [...item.messages, message], updatedAt: sentAt } : item)
        };
        return activity(next, "message", "发送社媒消息", `已向${conversation.customerName}发送消息：${text}`);
      });
    },
    sendAgentReply(conversationId) {
      commit((current) => {
        const conversation = current.conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.mode !== "agent") return null;
        const sentAt = now();
        const message = {
          id: `message-${current.conversations.reduce((count, item) => count + item.messages.length, 0) + 1}`,
          sender: "agent" as const,
          body: "已收到您的问题，我先为您整理适合的演示方案，稍后继续为您说明。",
          sentAt,
          simulated: true as const
        };
        const next = {
          ...current,
          conversations: current.conversations.map((item) => item.id === conversationId
            ? { ...item, messages: [...item.messages, message], updatedAt: sentAt }
            : item)
        };
        return activity(next, "message", "智能体回复社媒消息", `已向${conversation.customerName}发送演示自动回复。`);
      });
    },
    setConversationMode(conversationId, mode) {
      commit((current) => {
        const conversation = current.conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.mode === mode) return null;
        const next = {
          ...current,
          conversations: current.conversations.map((item) => item.id === conversationId ? { ...item, mode, updatedAt: now() } : item)
        };
        return activity(next, "stage", "更新对话模式", `${conversation.customerName}的会话已切换为${mode}。`);
      });
    },
    addConversationTag(conversationId, tag) {
      const text = tag.trim();
      if (!text) return;
      commit((current) => {
        const conversation = current.conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.tags.includes(text)) return null;
        const next = {
          ...current,
          conversations: current.conversations.map((item) => item.id === conversationId ? { ...item, tags: [...item.tags, text], updatedAt: now() } : item)
        };
        return activity(next, "message", "添加对话标签", `已为${conversation.customerName}添加“${text}”。`);
      });
    },
    addCustomerTag(customerId, tag) {
      const text = tag.trim();
      if (!text) return;
      commit((current) => {
        const customer = current.customers.find((item) => item.id === customerId);
        if (!customer || customer.tags.includes(text)) return null;
        const next = { ...current, customers: current.customers.map((item) => item.id === customerId ? { ...item, tags: [...item.tags, text] } : item) };
        return activity(next, "follow-up", "添加客户标签", `已为${customer.name}添加“${text}”。`);
      });
    },
    transferConversationToPrivate(conversationId) {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) return "";
      if (conversation.customerId) return conversation.customerId;
      const customerId = `customer-${conversationId.replace(/^conversation-/, "")}`;
      commit((current) => {
        const currentConversation = current.conversations.find((item) => item.id === conversationId);
        if (!currentConversation) return null;
        if (currentConversation.customerId) return null;
        const createdAt = now();
        const customer: DemoCustomer = {
          id: customerId,
          conversationId,
          name: currentConversation.customerName,
          platform: currentConversation.platform,
          intent: currentConversation.intent,
          group: "待跟进",
          tags: [...currentConversation.tags],
          owner: "待分配",
          needSummary: currentConversation.needSummary,
          lastContactAt: createdAt,
          nextFollowUpAt: createdAt,
          status: "待跟进"
        };
        const next = {
          ...current,
          selectedCustomerId: customerId,
          conversations: current.conversations.map((item) => item.id === conversationId ? { ...item, customerId } : item),
          customers: [...current.customers, customer]
        };
        return activity(next, "transfer", "转入私域客户", `${customer.name}已从${customer.platform}会话转入私域。`);
      });
      return customerId;
    },
    updateCustomer(customerId, patch) {
      commit((current) => {
        const customer = current.customers.find((item) => item.id === customerId);
        if (!customer || Object.keys(patch).length === 0) return null;
        const next = { ...current, customers: current.customers.map((item) => item.id === customerId ? { ...item, ...patch } : item) };
        return activity(next, "follow-up", "更新客户信息", `已更新${customer.name}的跟进信息。`);
      });
    },
    createFollowUp(customerId, note, dueAt) {
      const text = note.trim();
      const normalizedDueAt = normalizeIsoDateTime(dueAt);
      if (!text || !normalizedDueAt) return;
      commit((current) => {
        const customer = current.customers.find((item) => item.id === customerId);
        if (!customer) return null;
        const createdAt = now();
        const task = { id: `task-follow-up-${current.tasks.length + 1}`, title: text, priority: "中" as const, module: "private-domain" as const, relatedId: customerId, done: false, dueAt: normalizedDueAt, createdAt };
        const next = {
          ...current,
          customers: current.customers.map((item) => item.id === customerId ? { ...item, nextFollowUpAt: normalizedDueAt } : item),
          tasks: [...current.tasks, task]
        };
        return activity(next, "follow-up", "创建跟进", `${customer.name}：${text}`);
      });
    },
    simulateOutreach(customerIds) {
      const ids = new Set(customerIds);
      const targets = state.customers.filter((customer) => ids.has(customer.id));
      if (targets.length === 0) return;
      commit((current) => {
        const sentAt = now();
        const targetIds = new Set(current.customers.filter((customer) => ids.has(customer.id)).map((customer) => customer.id));
        if (targetIds.size === 0) return null;
        let messageNumber = current.conversations.reduce((count, item) => count + item.messages.length, 0);
        const conversations = current.conversations.map((conversation) => {
          const matchingCustomer = current.customers.find((customer) => targetIds.has(customer.id)
            && (conversation.customerId === customer.id || conversation.id === customer.conversationId));
          if (!matchingCustomer) return conversation;
          messageNumber += 1;
          const message = { id: `message-${messageNumber}`, sender: "agent" as const, body: "您好，想了解一下您目前的项目进展，方便继续为您提供方案支持吗？", sentAt, simulated: true as const };
          return { ...conversation, messages: [...conversation.messages, message], updatedAt: sentAt };
        });
        const next = {
          ...current,
          conversations,
          customers: current.customers.map((customer) => targetIds.has(customer.id)
            ? { ...customer, group: "待跟进" as const, status: "待跟进" as const, lastContactAt: sentAt }
            : customer)
        };
        return activity(next, "message", "执行批量触达", `已向${targetIds.size}位私域客户发送模拟触达。`);
      });
    },
    createOpportunity(customerId, input) {
      const title = input.title.trim();
      if (!title) return "";
      const customer = state.customers.find((item) => item.id === customerId);
      if (!customer) return "";
      const opportunityId = `opportunity-${currentIdPart(customerId)}-${state.opportunities.length + 1}`;
      commit((current) => {
        const currentCustomer = current.customers.find((item) => item.id === customerId);
        if (!currentCustomer) return null;
        const createdAt = now();
        const opportunity = {
          id: opportunityId, customerId, title, amount: input.amount, probability: 30, stage: "new" as const,
          source: currentCustomer.platform, nextAction: "确认需求与预算", updatedAt: createdAt
        };
        const next: DemoState = {
          ...current,
          selectedOpportunityId: opportunityId,
          customers: current.customers.map((item) => item.id === customerId ? { ...item, group: "已创建商机" as const, status: "已有商机" as const } : item),
          opportunities: [...current.opportunities, opportunity]
        };
        return activity(next, "opportunity", "创建商机", `已为${currentCustomer.name}创建${title}商机。`);
      });
      return opportunityId;
    },
    moveOpportunity(opportunityId, stage) {
      commit((current) => {
        const opportunity = current.opportunities.find((item) => item.id === opportunityId);
        if (!opportunity || opportunity.stage === stage) return null;
        const next = { ...current, opportunities: current.opportunities.map((item) => item.id === opportunityId ? { ...item, stage, updatedAt: now() } : item) };
        return activity(next, "stage", "移动商机阶段", `${opportunity.title}已进入${stage}阶段。`);
      });
    },
    createQuote(opportunityId, amount) {
      commit((current) => {
        const opportunity = current.opportunities.find((item) => item.id === opportunityId);
        if (!opportunity) return null;
        const next: DemoState = { ...current, opportunities: current.opportunities.map((item) => item.id === opportunityId ? { ...item, quoteAmount: amount, stage: "quoted" as const, updatedAt: now() } : item) };
        return activity(next, "quote", "创建报价", `已为${opportunity.title}创建¥${amount}报价。`);
      });
    },
    markQuoteSent(opportunityId) {
      commit((current) => {
        const opportunity = current.opportunities.find((item) => item.id === opportunityId);
        if (!opportunity) return null;
        const sentAt = now();
        const next = { ...current, opportunities: current.opportunities.map((item) => item.id === opportunityId ? { ...item, quoteSentAt: sentAt, updatedAt: sentAt } : item) };
        return activity(next, "quote", "发送报价", `${opportunity.title}报价已发送。`);
      });
    },
    updateOpportunity(opportunityId, patch) {
      commit((current) => {
        const opportunity = current.opportunities.find((item) => item.id === opportunityId);
        if (!opportunity || Object.keys(patch).length === 0) return null;
        const next = { ...current, opportunities: current.opportunities.map((item) => item.id === opportunityId ? { ...item, ...patch, updatedAt: now() } : item) };
        return activity(next, "opportunity", "更新商机", `已更新${opportunity.title}的成交信息。`);
      });
    },
    closeOpportunity(opportunityId, result, reason) {
      commit((current) => {
        const opportunity = current.opportunities.find((item) => item.id === opportunityId);
        if (!opportunity) return null;
        const lossReason = reason?.trim();
        const next = {
          ...current,
          opportunities: current.opportunities.map((item) => item.id === opportunityId ? {
            ...item,
            stage: result,
            probability: result === "won" ? 100 : 0,
            ...(result === "lost" && lossReason ? { lossReason } : {}),
            updatedAt: now()
          } : item)
        };
        return activity(next, "stage", "关闭商机", `${opportunity.title}已${result === "won" ? "赢单" : "丢单"}。`);
      });
    },
    toggleAgent(name) {
      commit((current) => {
        const next = { ...current, demoSettings: { ...current.demoSettings, agents: { ...current.demoSettings.agents, [name]: !current.demoSettings.agents[name] } } };
        return activity(next, "stage", "更新智能体设置", `${name}已${next.demoSettings.agents[name] ? "启用" : "停用"}。`);
      });
    },
    toggleScript(platform) {
      commit((current) => {
        const next = { ...current, demoSettings: { ...current.demoSettings, scripts: { ...current.demoSettings.scripts, [platform]: !current.demoSettings.scripts[platform] } } };
        return activity(next, "stage", "更新平台话术", `${platform}话术已${next.demoSettings.scripts[platform] ? "启用" : "停用"}。`);
      });
    },
    reset() {
      commit(() => activity(createSeedDemoState(), "stage", "重置演示数据", "已恢复初始演示数据。"));
    }
  };
}

function currentIdPart(id: string): string {
  return id.replace(/^(customer|conversation)-/, "");
}
