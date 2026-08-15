# Task 6 报告：真实自动化时间线、高潜评论与 OpenAPI

## 结果

- `AcquisitionRunPresentation` 固定返回七个自动化步骤：发现视频链接、解析作品 ID、读取公开评论、标准化平台事件、聚合主体信号、资格研判和刷新展示。状态、起止时间、耗时、处理数量与错误均从 Run shard、comment fetch attempt、committed event link 和当前资格决定派生；没有使用本地时钟模拟进度。
- Run summary 增加已发现视频、已采样评论、有效需求信号、未核验主体和高潜强信号五项。计数由 memory/MySQL repository 的租户级 Run 聚合得到，不受最新评论 50 条展示窗口截断。
- `commentSignals` 独立返回最多 50 条最新评论事实，保留平台事件、原文、互动计数、IP 标签、来源 URL、规则意向、置信度、身份研判和 Evidence ID，不返回头像，也不改变候选事件的签名 cursor。
- comment intent 仅对已持久 immutable event text 使用 Task 4 的确定性规则分类器；身份状态与资格使用当前 Domain snapshot。未核验强信号标记为 `needs_research`，不冒充已核验客户。
- 高意向统计统一为 S/A 且 qualification 无 hard gate、候选非 `do_not_contact`。memory 与 MySQL 聚合规则一致；资格尚未完成的已持久事件仍可见，研判步骤在终态 Run 中显示 `partial_success + model_output_invalid`。
- 时间线覆盖 `public_sample_unavailable`、`access_restricted`、`rate_limited`、`video_id_unresolved`、`source_payload_invalid`、`no_public_comments` 和 `model_output_invalid`。有成功评论与空视频时仍为 succeeded；部分 429 保留成功结果并显示 partial_success；全部受限显示 failed。
- application 的 memory/MySQL composition 把 Task 5 已有同一 `douyinCommentEvents` repository 注入 presentation。公开 JSON Schema、runtime OpenAPI、响应一致性、生成前端类型均已同步；仅更新旧测试/demo fixture 以满足新必填 DTO，未实现 Task 7 组件或交互。

## TDD 证据

- 首组 RED：`npm exec --workspace backend -- tsx --test src/acquisition-run-presentation-test.ts` 得到 `11 tests / 5 pass / 6 fail`。首个失败为 `automationSteps` 不存在导致 `Cannot read properties of undefined (reading 'map')`；其余失败对应 running、全受限、no-public、旧 Run、summary 和 comment signal 缺口。
- 高意向门禁 RED：现有 S/A 统计仍包含 explicit rejection 与 `do_not_contact`，实际 `highIntent=3`，期望为 1；memory/MySQL 使用同一 hard-gate 条件后 GREEN。
- OpenAPI response RED：nullable `errorCode` 最初只有字符串 enum，真实 null 响应被七个步骤逐项拒绝；把 null 纳入严格 enum 后 response conformance GREEN。
- 合同总门禁第一次运行在生成类型后的四个旧 frontend test/demo fixture 编译失败；只补齐新 DTO 字段后 frontend build 与 `184/184` 测试 GREEN，没有新增前端展示逻辑。

## 验证

- Task 6 focused + affected repository/MySQL/OpenAPI：`103 tests / 103 pass`。
- Presentation focused：`17 tests / 17 pass`（含 8 个状态/错误子用例；Node 总计按 TAP 为 17）。
- Contracts：`66/66`；contract drift：`17/17`；OpenAPI/响应一致性：`28/28`；security GREEN；generated type check GREEN。
- `npm run check:acquisition-contracts`：最终通过；frontend `184/184`，Baota package `2/2`。
- Backend TypeScript build、frontend build 通过；仅有既有 Vite chunk-size warning。
- `git diff --check`：通过。
- Full acquisition：`799 tests / 797 pass / 2 fail`。精确命令：

  ```bash
  NODE_ENV=test TZ=UTC JWT_SECRET=goodjob-acquisition-test-secret-at-least-32-characters ACQUISITION_MASTER_SECRET=goodjob-acquisition-master-test-secret-at-least-32-bytes node --import tsx --test --test-concurrency=1 --test-force-exit src/model-config-migration-test.ts src/model-provider-endpoint-registry-test.ts src/model-official-connection-profile-test.ts src/model-connection-idempotency-test.ts src/model-connection-service-test.ts src/model-pending-appends-test.ts src/model-gateway-test.ts src/model-runtime-integration-test.ts src/provider-connection-version-test.ts src/acquisition-*-test.ts
  ```

- 两项失败仅为已确认基线：`acquisition-pi-gateway-runtime-test.ts` 与 `acquisition-pi-runtime-factory-test.ts`，均为 `MODEL_TOOL_DEFINITION_INVALID`。Task 6、新 schema、MySQL 聚合与 presentation 测试没有失败。

## 安全与文档

- 未复制或接入 cv-cat/DouYin_Spider 的 Cookie、逆向签名、指纹伪装、私信或互动代码；数据仍来自固定注入、无凭证的公开评论样本 Provider。
- `contracts/README.md`、当前 design 和执行 plan 已同步真实七步投影、独立评论窗口、全量 summary、高意向硬门禁与错误规则；BrowserAct/OCR 视觉读取章节保持不变。
