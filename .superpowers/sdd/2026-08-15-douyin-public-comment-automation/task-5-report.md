# Task 5 报告：把评论富化接入搜索和用户链接的真实 Run

## 结果

- 搜索分片在严格验证搜索结果后，先从证据 provenance 提取可解析的抖音视频 URL，运行有界公开顶层评论富化，再合并去重 candidate IDs 并进入原有资格 pipeline。
- content-fetch Run 依次保存原页证据、评论事件/需求证据/待核验候选，再进入原有候选 pipeline。用户显式提交的单独抖音链接即使没有 Run，也使用固定上限 `1 视频 / 30 评论 / 3 页`执行；其他无 Run 后台工作不会自动扩展采集。
- memory/MySQL composition 共用同一个固定注入的 public provider、comment event repository 和 Task 4 ingestion service。计划信任边界只接受 `experimental_public_sample + content_fetch + active + credentialVersion=1` 的无凭证快照，且 connectionId 必须非空。
- 处理遵守 max videos/comments/pages、Run 剩余 requests/results 预算和 `AbortSignal`。单视频 429、受限或无公开评论不会丢失其他视频的已接受成果，局部失败映射为 `partial_success`。策略关闭、非抖音视频或预算为零时安全 no-op。
- content-fetch schema/OpenAPI/响应一致性/MySQL JSON 恢复/生成前端类型已同步 `commentSampleSummary` 和 `partial_success`。旧记录缺少 summary 时恢复为 `null`；MySQL 旧 status CHECK 在 schema ensure 时升级。

## TDD 证据

- 搜索纵向链路 RED：`0/1`，失败于 enrichment 未在 candidate pipeline 前执行；实现后 enrichment/search focused 为 `16/16`。
- 单独 content-fetch RED：`0/1`，失败于无 Run 链接未持久评论事件/证据/候选；GREEN 后通过。
- Run content-fetch shard RED：`0/1`，失败于评论候选未进入原有 pipeline；GREEN 后 discovery 组合套件 `26/26`。
- Application tracer RED：`0/1`，provider calls 为空；GREEN 后 memory runtime 的 search/content-fetch 双路径均触达同一 enrichment 组合，并保存 `1 event / 1 evidence / 1 strong candidate`。
- 计划 public-provider 快照 RED：`0/1`，合法无凭证快照被 503 拒绝；GREEN 后正向和 provider/kind/status/version/connectionId 负向矩阵通过。
- MySQL JSON/status CHECK RED：分别 `0/1`；GREEN 后 `13/13`。
- sampled 计数与 ingestion 内部错误边界 RED：`0/2`；GREEN 后 `2/2`。
- contract summary RED：`0/1`；生成类型 stale gate RED；同步 schema/样例/OpenAPI/生成物后 GREEN。

## 验证

- Task 5 focused：`55/55`。
- `acquisition-application-test.ts`：`26/26`；新增双路 tracer 用 focused pattern 自然退出，`2/2`。
- MySQL discovery repository：`13/13`。
- contracts schema/examples：`66/66`；drift：`17/17`；backend OpenAPI/响应一致性：`28/28`；generated check 通过。
- `npm run check:acquisition-contracts`：通过，其中 frontend `184/184`，Baota `75/75`。
- backend build 和 frontend build：通过；frontend 仅保留已有 Vite chunk-size warning。
- Full acquisition：`757 tests / 755 pass / 2 fail`。命令使用 `NODE_ENV=test TZ=UTC ... node --import tsx --test --test-concurrency=1 --test-force-exit backend/src/model-config... backend/src/acquisition-*-test.ts`；唯一失败为已知 Pi 基线 `acquisition-pi-gateway-runtime-test.ts` 和 `acquisition-pi-runtime-factory-test.ts`，两者均为 `MODEL_TOOL_DEFINITION_INVALID`。
- `git diff --check`：通过。

## 安全与文档

- 未复制或接入 cv-cat/DouYin_Spider 的 Cookie、逆向签名、指纹伪装、私信或互动代码；执行端只使用固定注入的无凭证公开样本 provider。
- `contracts/README.md`、当前 design 与执行 plan 已改为真实搜索/content-fetch/单链接语义；BrowserAct/视觉读取段落保持不变。
