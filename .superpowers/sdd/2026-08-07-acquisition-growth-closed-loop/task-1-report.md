# Task 1 report — AI 增长参谋生成完整抖音获客方案

## 改动

- 新增 `plan-draft-workflow.ts`：以服务器绑定的 Copilot 会话生成 `plan_draft`，复用会话/任务元数据，稳定幂等键、指数退避、120 秒超时及 `AbortSignal` 取消。`sessionStorage` 仅保存 session/task/model/prompt/幂等键元数据，不保存 API Key 或计划正文。
- 扩展 `task-creation-api.ts`：创建绑定模型会话、提交 `plan_draft` 任务、读取任务；严格检查完整草稿，拒绝 `modelSnapshotRef`。
- 新增安全预览组件：完整呈现 ICP 五组信息、所有 provider 连接、组织/个人通道、全部查询、逐项与总预算、停止条件；所有外部文本 HTML 转义。
- 创建弹窗默认 AI 模式：一句话 → 生成/重新生成 → 完整预览 → 人工批准 → 既有 `createPlan → approvePlan → createRun`。模型、搜索连接、语义目标变更、关闭、切换和重新生成都会取消并清除旧草稿。手动模式保持既有字段和校验。
- 新增 self-test 与 Playwright 场景，后者验证两个 provider、四条 query 的草稿未被压扁，且提交正文没有 `modelSnapshotRef`。

## 红绿证据

- RED：新增 `plan-draft-workflow.self-test.ts` 和 `plan-draft-view.self-test.ts` 后运行，因生产模块不存在报 `ERR_MODULE_NOT_FOUND`。
- RED：新增 Copilot API 断言后运行 `task-creation-api.self-test.ts`，报 `api.createCopilotSession is not a function`。
- RED：新增 controller 可提交状态断言后运行，报缺少 `isPlanDraftSubmissionReady` 导出。
- RED：新增畸形服务器草稿断言后运行，报 `Missing expected rejection`，证明原检查不够严格。
- GREEN：分别实现后，定向 self-test、TypeScript 和 Playwright AI 创建场景均通过；最终全量命令见下。

## 最终命令与结果

```text
pnpm test
# PASS — checked: 125

pnpm run build
# PASS — tsc -b + vite build 完成

pnpm run test:e2e
# PASS — 5/5 Playwright tests

git diff --check
# PASS — 无输出
```

## 自审

- [x] AI 默认，手动创建仍经原 `buildDouyinPlanInput` 与原工作流。
- [x] Copilot session 只提交 `connectionId`，消息固定 `plan_draft` / `douyin`；从未发送客户端 `modelSnapshotRef`。
- [x] 完整草稿未经客户端压扁，端到端断言为 2 provider / 4 operations。
- [x] 外部预览文本统一 HTML 转义；状态文案使用 `textContent`。
- [x] 会话存储不含 API Key 或计划正文；旧轮询均可取消。
- [x] 未修改后端。
- [x] `pnpm-workspace.yaml` 是已有用户改动，未修改也不会暂存或提交。

## 风险

- 构建成功但 Vite 仍报告既有大主 bundle（约 1.53 MB）警告；本任务未做代码分包。
- Playwright 使用契约形状的路由夹具验证；真实部署仍依赖后端 Copilot/plan_draft 服务可用与认证会话正常。

## 第 1 轮审查修复

### 改动

- 重写 `plan-draft-workflow.ts` 的持久化模型：可复用 session 与 pending task 分开保存；先保存各自幂等键再发请求。完成、失败或取消只删除 task，保留 session；`clear()` 现在只取消，不会破坏恢复元数据。
- Copilot session POST、task POST 和 poll GET 均接收并转发 `AbortSignal`。120 秒（或配置值）从第一条请求前开始计时；每个异步边界后都重新检查取消和超时，错误文案使用配置的秒数。
- 控制器增加 generation token，并在草稿失效、模式/连接/目标变化、关闭和重新生成时清空批准 checkbox，阻止旧请求复活旧草稿或覆盖新状态。
- 草稿校验补充连接、通道、唯一 ID、operation→connection、模型连接及预算守恒关系。预览显示 provider + connectionId，逐项费用和总预算带币种。

### 红绿与覆盖证据

- RED：会话复用 self-test 在旧实现上得到 `2 !== 1`；预览 self-test 缺少 `连接 a`；新增 Playwright 在目标编辑后仍检测到批准 checkbox 被勾选。
- GREEN：新增/扩展的 `plan-draft-workflow.self-test.ts` 覆盖 session/task/poll 三阶段取消、120 秒起点、pending task 恢复、会话复用、session/task 模糊网络失败稳定幂等键、失败/取消终态、退避 1s/2s、可配置超时。API self-test 覆盖重复/未启用连接、未知连接、关闭通道、重复 operation、预算不守恒和模型不匹配。Playwright 覆盖草稿失效后批准复位。

### 最终命令与结果

```text
pnpm test
# PASS — checked: 125

pnpm run build
# PASS — tsc -b + vite build 完成

pnpm run test:e2e
# PASS — 5/5 Playwright tests

git diff --check
# PASS — 无输出
```

`pnpm-workspace.yaml` 仍是用户既有未提交改动，未触碰、未暂存。

## 第 2 轮审查修复

### 改动与红绿证据

- RED：新增 deadline self-test 后，旧工作流断言“首个 POST 前必须注册 deadline timer”失败（`0 !== 1`）；新增 task POST 立即成功但模型不匹配的断言，旧实现未做所选模型校验。
- GREEN：工作流现在在第一条请求前注册全生命周期 deadline timer；deadline 主动 abort 同一请求信号，并通过请求包装器在底层 promise 不自行完成时立即以配置超时错误退出。用户取消仍返回 `AbortError`，deadline 返回超时错误。
- 新增可控 timer self-test：首个 session POST 和 poll GET 各自使用不自行 resolve 的 promise，deadline 触发后验证 signal 已 abort 且拒绝消息为配置的 `2 秒`。
- `createPlanDraftTask()` 增加期望模型连接参数，直接返回 `succeeded + planDraft` 时与轮询结果一样调用严格模型一致性校验；self-test 验证不匹配被拒绝。

### 最终命令与结果

```text
pnpm test
# PASS — checked: 125

pnpm run build
# PASS — tsc -b + vite build 完成

pnpm run test:e2e
# PASS — 5/5 Playwright tests

git diff --check
# PASS — 无输出
```
