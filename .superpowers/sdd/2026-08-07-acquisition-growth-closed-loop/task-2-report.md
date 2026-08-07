# Task 2 交付报告：候选交接 CRM / 私域

## 状态

已完成。新版 5189 UI 中，获客候选在人工批准后可创建或关联 CRM 客户，并创建一条同时关联 Lead 与 Customer 的首次跟进 Todo；完成态可恢复并进入真实私域客户页查看客户活动和关联待办。

## 实现摘要

- 新增服务端 `AcquisitionCustomerHandoff`、服务端资格/财务不可变快照、POST/GET 交接接口与 OpenAPI 合同。
- 复用候选转 Lead 端口，支持已有 Lead、已有 Customer 的阶段恢复；Customer/Activity/Todo/Handoff 在 MySQL 通用持久化事务中原子落库。
- 对 owner/team/candidate 作用域执行租户隔离、当前批准版本与硬门禁校验；请求体不接受任何 AI 评分或财务字段。
- 实现同键同请求重放、同键异请求冲突、不同键已完成不重复，以及确定性的首次 Todo trigger key。
- S 级映射为 Customer A 级，同时在 handoff 中保留原始 S；仅 CNY 写入 Customer.amount，外币关联已有客户时保留其原金额。
- 新版候选详情加入交接 CTA、创建/关联模式、首次跟进时间、失败保留与刷新恢复；sessionStorage 只保存请求指纹到幂等键的映射并在成功后移除。
- 新增真实私域运行时，读取 `/api/customers?scope=mine` 与 `/api/todos`；演示客户页仅在显式 demo 模式启用。
- 成功态的“查看客户”和“查看待办”进入真实私域客户页，展示后端客户、活动、Lead 与关联 Todo。

## 提交

- 后端 `GoodJob-1.09`：`686f13f` (`feat(acquisition): hand off approved candidates to CRM`)
- 前端 `GoodJob-marketing-system-frontend`：本报告所在提交 (`feat(acquisition): complete CRM private-domain handoff UI`)

## 验证

- 后端任务目标集：51 tests passed（handoff、Lead conversion、v1 router、OpenAPI、contract drift）。
- 后端构建：`npm run build` 通过。
- 前端自测：125 checks passed。
- 前端 E2E：Playwright 5 tests passed，覆盖批准候选交接、幂等/CSRF 请求、成功资源以及真实私域客户/活动/Todo 展示。
- 前端构建：`pnpm build` 通过（仅保留既有 Vite 大 chunk 警告）。

## 说明

- 后端全量历史 `test:acquisition` 套件曾运行到 72 项且 0 fail，因总时长超过本次有界验证窗口主动终止；上述 51 项任务目标集与构建均完整退出为 0。
- 两个仓库中原有、与本任务无关的工作区改动均未暂存或提交。
