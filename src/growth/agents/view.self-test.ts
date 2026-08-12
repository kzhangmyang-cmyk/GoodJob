import { strict as assert } from "node:assert";
import {
  BUSINESS_AGENT_TEAM,
  businessAgentById
} from "./agents";
import { parseAgentsHash } from "./entry";
import {
  renderAgentDetail,
  renderAgentsOverview
} from "./view";

assert.equal(BUSINESS_AGENT_TEAM.length, 6);
assert.equal(businessAgentById("profit")?.name, "利润分析");
assert.equal(businessAgentById("missing"), null);

assert.deepEqual(parseAgentsHash("#growth/agents"), { view: "overview" });
assert.deepEqual(parseAgentsHash("#growth/agents/profit"), {
  view: "detail",
  agentId: "profit"
});
assert.equal(parseAgentsHash("#growth/advisor"), null);

const overview = renderAgentsOverview();
assert.equal(overview.includes("AI 经营顾问团队"), true);
assert.equal(overview.includes("利润分析"), true);
assert.equal(overview.includes("data-agent-id=\"cashflow\""), true);
assert.equal(overview.includes("生成经营诊断报告"), true);
assert.equal(overview.includes("<script>"), false);

const detail = renderAgentDetail("profit");
assert.equal(detail.includes("找出钱到底赚在哪"), true);
assert.equal(detail.includes("哪个产品是假利润？"), true);
assert.equal(detail.includes("data-agents-form=\"ask\""), true);
assert.equal(detail.includes("管理会计 · 贡献毛利"), true);
assert.equal(detail.includes("<script>"), false);

assert.equal(renderAgentDetail("unknown-agent").includes("未知智能体"), true);
