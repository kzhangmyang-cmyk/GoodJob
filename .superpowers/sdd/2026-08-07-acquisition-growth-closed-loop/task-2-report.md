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

## 独立审查第 1 轮修复

状态：6 个 Important 已全部修复；审查 ledger 中两个 Minor 按要求未处理。

1. 在任何 CRM 副作用前持久化 owner/team/candidate 作用域的 handoff operation，固化 processing key hash、canonical request hash、服务端 intelligence 快照、阶段与目标资源；同 key 修改 dueAt、mode 或 customer 均返回 409。
2. operation 按 `reserved → lead_ready → customer_ready → activity_ready → todo_ready → completed` 持久推进。恢复时先检查 `Lead.convertedCustomerId`，同租户 Customer 已存在则复用，并从缺失 Activity/Todo/Handoff 的阶段继续。
3. `link_existing` 只更新 `nextReminder` 并创建 Activity/Todo/Handoff，不改已有 Customer 的 amount、grade、stage、health 等主档字段。
4. 为部署前已 `converted_to_lead` 的旧 Lead 创建服务端专用、确定 ID 的 `acquisition_private_domain_handoff_snapshot` 来源事件；快照内容由 reservation 固化，后续财务记录变化不会改写最终 handoff。
5. OpenAPI handoff POST 200 响应声明可选 `Idempotency-Replayed: true` header，并加入合同断言。
6. 真实私域 controller 增加 `deactivate()` generation guard；demo-app 在离开模块或切换显式 demo 时停用 controller，慢请求完成后不再覆盖共享 host。

修复提交：

- 后端：`1c2eac8` (`fix(acquisition): harden CRM handoff recovery`)
- 前端：本报告所在提交 (`fix(private-domain): guard inactive runtime renders`)

第 1 轮验证证据：

- 后端目标集：51/51 passed；`npm run build` 通过。
- 前端自测：125 checks passed。
- Playwright：5/5 passed，新增覆盖 open→leave 与 open→demo 两种慢请求竞态。
- 前端 `pnpm build` 通过；仅有既有 Vite 大 chunk 警告。
- 两仓库 `git diff --check` 通过，既有脏改动未暂存、未提交。

## 独立审查第 2 轮修复

状态：已修复 Important 的刷新恢复缺陷。

问题根因：未完成 operation 只固化了请求 hash、阶段和目标资源，没有固化
完整规范化请求。页面刷新会重新生成默认 `dueAt`，从而形成不同指纹并被
服务端判定为冲突；服务端也无法向新 controller 实例返回原始继续参数。

修复内容：

1. reservation 新增完整规范化请求快照，包含 operation/decision、mode、
   existing customer target 以及 follow-up title/dueAt/priority；MySQL operation
   表新增 `request_json` 并完成读写映射。
2. 未完成 operation 的所有恢复都使用持久化原请求。相同规范化请求允许用
   刷新后生成的新幂等键继续；不同 title、dueAt、mode 或 customer target
   无论是否换 key 均返回 409，不会静默改写 reservation。
3. GET handoff status 在未完成时返回 `inProgress` 阶段与原请求；HTTP 公共
   投影及 OpenAPI 200 union 同步发布该恢复合同。
4. 前端加载候选时保留 pending status；“继续完成私域交接”会用原 mode、
   target、title、dueAt、priority 恢复对话框。恢复参数锁定不可编辑，提交
   强制使用服务端快照，避免刷新默认值或新 decision version 产生重复资源。
5. Customer-stage 与 Todo-stage 故障回归分别以新 service/controller 恢复，
   验证原 title/dueAt/target、原 intelligence，以及仅一套 Lead/Customer/
   Activity/Todo/Handoff；变更请求继续保持冲突。

RED 证据：

- 后端 GET 未完成 operation 最初返回
  `ACQUISITION_HANDOFF_NOT_FOUND`；实现 pending status 后转绿。
- 相同原请求换新 key 恢复最初返回
  `ACQUISITION_HANDOFF_ALREADY_IN_PROGRESS`；改为按规范化请求判定后转绿。
- OpenAPI 回归最初因 GET 200 没有 completed/pending `oneOf` 而失败。
- 前端刷新恢复测试最初得到 `handoffDialog: null`，而非原 link target、标题
  与时间；controller 支持 pending status 后转绿。

最终验证（均为提交前重新完整运行）：

- 后端任务目标集：51/51 passed，0 failed。
- 后端 `npm run build`：通过。
- 前端 `pnpm test`：125 checks passed。
- 前端 `pnpm build`：通过；仅有既有 Vite 大 chunk 警告。
- 前端 `pnpm test:e2e`：5/5 passed。
- staged diff check：通过；两仓库既有无关脏文件均未暂存。

修复提交：

- 后端：`5adba2f` (`fix(acquisition): resume handoffs from original request`)
- 前端：本报告所在提交 (`fix(acquisition): restore pending CRM handoffs`)
