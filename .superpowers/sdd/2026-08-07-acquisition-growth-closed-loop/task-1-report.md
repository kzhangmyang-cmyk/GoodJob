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
