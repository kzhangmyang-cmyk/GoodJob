# Task 3 交付报告：CRM 结果回流、经营绩效与 AI 老板简报

## 状态

已完成。CRM 的持久化 `LeadActivity` / `DealEvent` 现在由后端对账为幂等 Outcome，新版首页真实模式提供后端确定计算的漏斗、分币种金额、数据质量和老板简报事实；Pi 只获得读取经营事实的新工具。

## 实现摘要

- 交接时只从同 owner/team 的真实 `candidate.discovered` 运行事件解析归因，并固化 run/plan/version/hash/shard/operation/connection/provider/decision/evidence 快照；不使用 Copilot sessionId 冒充 runId。
- 对账器从持久化 CRM 源映射 `contacted` / `quoted` / `won` / `lost`，使用 `crm:lead-activity:{id}` 和 `crm:deal-event:{id}` 幂等键。对账失败仅记录诊断，不回滚 CRM；`payment` 不会被当作已核销回款。
- 缺失、无效或跨租户归因会留下持久化诊断并跳过 Outcome。对账不再被固定 500 条旧事件窗口饿饿新事件。
- 新增认证后的只读 `GET /api/v1/acquisition/performance`，强制 ISO 时间与最长 90 天。按候选去重聚合发现、高意向、批准、转 CRM、联系、报价、成交和丢单；零分母 rate 返回 `null`。
- 管道估值、报价额和成交合同额按币种分开，不汇总异币种。成本仅标记为“已记录 API/执行成本”；当前 ROI 固定为 `not_computable`，不展示伪造毛利或实际回款。
- 后端生成带 metricId 和 evidenceRefs 的确定性事实、风险与行动。当前 Pi 模型 schema 升至 v5，用只读 `get_acquisition_performance` 替换 Outcome 写工具，同时保留已签名旧快照的 hash 可验证性。
- 新版前端真实模式四张摘要卡分别显示发现、高意向、转 CRM 和成交；新增时间/平台筛选、刷新、加载/空/未授权/错误状态、证据展开与“生成今日经营简报”。
- 真实请求失败时四张卡片显示不可用，绝不回退演示数字；模型失败时仍保留并显示后端事实层。所有服务端文本在输出到 HTML 前转义。

## 提交

- 后端 `GoodJob-1.09`：`0a6b882` (`feat(acquisition): reconcile CRM outcomes and report performance`)
- 前端 `GoodJob-marketing-system-frontend`：本报告所在提交 (`feat(acquisition): add real performance briefing`)

## 验证

- 后端新增口径目标集：9/9 passed（CRM 对账、真实运行归因、>500 事件无饿饿、绩效聚合、90 天边界和路由认证）。
- 后端 Pi/model、私域交接目标测试通过；OpenAPI 24/24、contract drift 16/16、security 回归和 TypeScript build 全部通过。
- 前端 `pnpm test`：125 checks passed。
- 前端 `pnpm test:e2e`：7/7 passed，其中新增 2 条覆盖真实经营展示、AI 失败保留事实和 API 失败不回退 demo。
- 前端 `pnpm build` 通过（仅有既有 Vite 大 chunk 警告）。
- `http://127.0.0.1:5189/#acquisition` 已由新版入口提供 `replicaAcquisitionPerformance` 经营结果区。
- 生产 OpenAPI 仅发布 GET outcomes/performance，没有浏览器 `POST /api/v1/acquisition/outcomes`。

## 说明

- 完整 acquisition 回归中的 18 个 application 子测试全部通过，但该历史文件的“模型调用永不返回”用例留有悬空 Promise，使 Node test worker 在子测试结束后到达文件级 timeout。本任务的对账和查询服务未引入 timer；上述有界目标集均完整退出为 0。
- 两个仓库中用户原有的无关脏改动均未暂存、未提交。
