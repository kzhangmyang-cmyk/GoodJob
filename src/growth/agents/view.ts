import {
  BUSINESS_AGENT_TEAM,
  businessAgentById,
  type BusinessAgent
} from "./agents";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function agentCard(agent: BusinessAgent): string {
  const capabilities = agent.capabilities
    .map((item) => `<span class="agent-capability">${escapeHtml(item)}</span>`)
    .join("");
  const status = agent.dataReady
    ? '<span class="agent-status agent-status-ready">数据就绪</span>'
    : '<span class="agent-status">待配置</span>';
  return `<article class="agent-card" data-agent-id="${escapeHtml(agent.id)}"
    style="--agent-accent:${agent.accent}">
    <header>
      <span class="agent-avatar" aria-hidden="true">${escapeHtml(agent.name.slice(0, 1))}</span>
      <div>
        <h3>${escapeHtml(agent.name)}</h3>
        <p>${escapeHtml(agent.title)}</p>
      </div>
      ${status}
    </header>
    <p class="agent-summary">${escapeHtml(agent.summary)}</p>
    <div class="agent-capabilities">${capabilities}</div>
    <footer>
      <span>知识库：${escapeHtml(agent.knowledgeBase)}</span>
      <a href="#growth/agents/${escapeHtml(agent.id)}">进入工作台</a>
    </footer>
  </article>`;
}

export function renderAgentsOverview(): string {
  const cards = BUSINESS_AGENT_TEAM.map(agentCard).join("");
  return `<section class="growth-panel agents-home">
    <header class="agents-hero">
      <div>
        <h2>AI 经营顾问团队</h2>
        <p>没有请 CFO 的老板，也能拥有一支虚拟经营管理团队。</p>
      </div>
      <button type="button" class="agents-primary"
        data-agents-action="generate-report">生成经营诊断报告</button>
    </header>
    <div class="agents-grid">${cards}</div>
  </section>`;
}

export function renderAgentDetail(agentId: string): string {
  const agent = businessAgentById(agentId);
  if (!agent) {
    return `<section class="growth-panel"><p class="growth-error">
      未知智能体：${escapeHtml(agentId)}</p></section>`;
  }
  const capabilities = agent.capabilities
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  return `<section class="growth-panel agent-workbench">
    <a href="#growth/agents" class="agents-back">← 返回团队</a>
    <header style="--agent-accent:${agent.accent}">
      <span class="agent-avatar" aria-hidden="true">${escapeHtml(agent.name.slice(0, 1))}</span>
      <div>
        <h2>${escapeHtml(agent.name)}</h2>
        <p>${escapeHtml(agent.title)}</p>
      </div>
      <span class="agent-status ${agent.dataReady ? "agent-status-ready" : ""}">
        ${agent.dataReady ? "数据就绪" : "待配置"}
      </span>
    </header>
    <div class="agent-workbench-grid">
      <aside class="agent-info">
        <h3>职责</h3>
        <p>${escapeHtml(agent.summary)}</p>
        <h3>能力</h3>
        <ul>${capabilities}</ul>
        <h3>专属知识库</h3>
        <p>${escapeHtml(agent.knowledgeBase)}</p>
      </aside>
      <section class="agent-chat">
        <h3>向 ${escapeHtml(agent.name)} 提问</h3>
        <form data-agents-form="ask">
          <label for="agents-ask-input">例如：${escapeHtml(agentPromptExample(agent.id))}</label>
          <div class="agents-ask-row">
            <input id="agents-ask-input" name="question"
              placeholder="输入你的经营问题…" />
            <button type="submit">分析</button>
          </div>
        </form>
        <div class="agent-conclusion" data-agents-output>
          <p class="agent-conclusion-empty">输入问题后，这里会给出带来源引用的分析结论。</p>
        </div>
      </section>
      <aside class="agent-actions">
        <h3>可执行动作</h3>
        <button type="button" data-agents-action="create-todo">生成跟进待办</button>
        <button type="button" data-agents-action="open-report">查看经营诊断报告</button>
        <button type="button" data-agents-action="open-data">补充经营数据</button>
      </aside>
    </div>
  </section>`;
}

function agentPromptExample(id: string): string {
  switch (id) {
    case "profit":
      return "哪个产品是假利润？";
    case "cashflow":
      return "未来 30 天现金够不够？";
    case "cost":
      return "本月材料成本率为什么从 35% 涨到 42%？";
    case "tax":
      return "有哪些税务健康风险？";
    case "finance":
      return "公司财务健康吗？哪里在恶化？";
    default:
      return "今天最该先改什么？";
  }
}
