# AI 全网获客智能体：开发与运维交接

> 适用基线：GoodJob 1.09
>
> API 状态：后端已接入真实应用生命周期
>
> 目标读者：产品负责人、智能体开发者、前后端协作者、部署运维人员

## 1. 产品边界

这套能力是“公开商机发现 + AI 判断 + 人工决策”的获客智能体，不是自动营销外挂。

完整链路为：

```text
自然语言目标
  → ICP 与双通道搜索计划
  → 人工审批
  → 官方搜索 API
  → 原始证据与主体归一
  → 意向/财务价值判断
  → 客户作战卡与连接策略草稿
  → 人工审核
  → CRM 线索
  → 结果反馈
```

系统同时处理两类公开商机：

- **企业通道（organization）**：企业官网、域名、统一社会信用代码、地区、公开采购/招聘/扩张等信号。
- **个人通道（individual）**：公开账号、公开主页、公开需求内容及其购买阶段。只处理公开商务需求，不采集私人聊天、通讯录、非公开朋友圈、家庭住址、轨迹、健康、宗教、金融账户等敏感或私密信息。

没有解析出可靠主体身份的搜索结果会保留为待研究候选，并以
`identityResolved = false` 命中硬门禁；模型不能把模糊搜索结果直接说成已核实客户。

## 2. 运行架构

```text
Express 身份认证
  └─ AcquisitionRuntimeBridge
      └─ createAcquisitionApplication
          ├─ Pi Agent Core（对话与工具编排）
          ├─ Active Model Gateway（9 个官方 BYOK 模型适配）
          ├─ Plan / Run / Shard / Worker（确定性执行内核）
          ├─ Public Search Port（6 个官方搜索连接）
          ├─ Domain Service（证据、候选、评分、审核、转换）
          ├─ Controlled Tool Executor（受控工具与幂等 Ledger）
          └─ Memory 或 MySQL repositories
```

职责严格分离：

- **Pi / 大模型**：理解目标、调用已授权工具、解释证据、输出结构化判断和草稿。
- **GoodJob 确定性内核**：租户隔离、权限、快照、审批、预算、队列、幂等、审计、硬门禁、CRM 写入。
- **人**：审批搜索计划、复核候选、确认连接策略、批准 CRM 转换和实际触达。

Pi 使用 `@earendil-works/pi-agent-core@0.81.1`，不使用其环境变量密钥发现或模型自动路由。模型只能来自当前用户在 GoodJob 中启用并由服务端固化的连接快照。

## 3. 已支持的官方 BYOK 模型

每个用户填写自己的官方 API Key。Key 在服务端加密保存，读取接口只返回掩码；团队成员不能读取彼此的 Key。同一用户可以保存多个连接，但同一时间只启用一个连接。

| Provider ID | 厂商 | 协议 |
|---|---|---|
| `openai` | OpenAI | Responses / Chat Completions |
| `moonshot` | Kimi / 月之暗面 | OpenAI-compatible Chat Completions |
| `minimax` | MiniMax | MiniMax / OpenAI-compatible Chat Completions |
| `zhipu` | 智谱 GLM | OpenAI-compatible Chat Completions |
| `deepseek` | DeepSeek | OpenAI-compatible Chat Completions |
| `qwen` | 阿里云百炼 / 通义千问 | OpenAI-compatible Chat / Responses |
| `doubao` | 火山方舟 / 豆包 | Ark official API |
| `hunyuan` | 腾讯混元 | OpenAI-compatible Chat Completions |
| `qianfan` | 百度千帆 / 文心 | Qianfan official API |

连接管理 API：

```text
GET    /api/v1/ai/endpoint-profiles
GET    /api/v1/ai/connections
POST   /api/v1/ai/connections
GET    /api/v1/ai/connections/:id
PATCH  /api/v1/ai/connections/:id
POST   /api/v1/ai/connections/:id/activate
DELETE /api/v1/ai/connections/:id
GET    /api/v1/ai/calls
GET    /api/v1/ai/calls/:id
```

创建、修改、启用和删除连接时，客户端必须发送唯一的
`Idempotency-Key`。创建连接只能选择服务端登记的官方端点；不能用任意 Base URL 冒充官方厂商。

### 3.1 模型快照语义

智能体任务创建时固化以下信息：

- `connectionId`
- `credentialVersion`
- `provider`、`model`
- `baseUrlFingerprint`
- `capabilitySnapshot` 及其哈希
- `promptVersion`、`schemaVersion`
- 受信 Prompt 和 Tool Schema 的内容哈希

启用其他模型只影响之后新建的任务。API Key 轮换产生新的
`credentialVersion`；运行中任务、恢复和重试仍引用原快照，不能静默切换厂商、模型、Key、Prompt 或 Schema。

## 4. 已支持的真实搜索连接

| Provider ID | 数据源 |
|---|---|
| `baidu_ai_search` | 百度 AI 搜索 |
| `tencent_web_search` | 腾讯联网搜索 |
| `tavily` | Tavily Search |
| `serper` | Serper |
| `brave` | Brave Search |
| `serpapi` | SerpApi |

搜索连接由当前用户通过获客 V1 接口配置和测试：

```text
GET    /api/v1/acquisition/providers
GET    /api/v1/acquisition/provider-connections
POST   /api/v1/acquisition/provider-connections
GET    /api/v1/acquisition/provider-connections/:id
PATCH  /api/v1/acquisition/provider-connections/:id
DELETE /api/v1/acquisition/provider-connections/:id
POST   /api/v1/acquisition/provider-connections/:id/test
```

以上接口只返回连接 ID、厂商、状态和凭据版本等安全投影，不回传 API Key、
密文或内部凭据引用。客户在设置页配置一次官方 Key 后，`search_public_sources`
未指定 `providerConnectionIds` 时会自动使用该客户已启用的全部官方搜索连接；
若客户明确选择了连接，则只使用所选连接。没有可用连接时返回稳定的
`SEARCH_PROVIDER_CONNECTION_REQUIRED`，前端应引导客户进入连接设置页。

搜索 API Key 同样加密保存。`ProviderConnection.credentialVersion` 是服务端维护的单调版本号：

- 新建连接从版本 `1` 开始；
- API Key 或 Base URL 发生变化时版本递增；
- 启用/停用、配额/预算、健康检查结果等运行状态变化不轮换版本；
- 计划固化 `connectionId + providerId + credentialVersion + status`；
- 计划审批时和每个搜索分片真正调用外部 API 前都会重新校验所有权、团队、个人作用域、启用状态和版本；
- 配置已变化的旧计划必须创建新修订并重新审批，不能继续执行。

这种快照阻止“审批时使用 A 数据源配置，执行时悄悄换成 B 配置”。

## 5. 受控 Pi 工具

智能体只有以下业务工具，没有 Bash、文件写入、代码执行、浏览器自动点击、个人微信或自动发送工具：

| 工具 | 用途 |
|---|---|
| `search_public_sources` | 通过已授权官方搜索连接发现公开商机 |
| `get_candidate_evidence` | 读取候选的可信证据 |
| `research_candidate` | 用公开来源补充候选研究 |
| `qualify_candidate` | 生成可解释的意向资格判断 |
| `build_battle_card` | 生成客户作战卡草稿 |
| `estimate_financial_value` | 估算线索财务价值 |
| `draft_connection_strategy` | 生成分角色、分渠道的连接话术草稿 |
| `list_priority_candidates` | 读取当前用户的优先候选清单 |
| `create_review_task` | 创建人工审核任务 |
| `record_outcome` | 在已有审核动作和可信执行凭证后记录结果 |

所有工具参数先经过严格 Schema 校验；调用写入脱敏审计，保存参数/结果哈希、租户、操作者、会话、工具名、状态和时间。模型不能自行写入正式证据，不能伪造触达结果，也不能绕过人工审核转换 CRM。

系统**不实现**：

- 自动加好友、自动私信、自动评论、自动群发；
- 模拟真人频率或规避平台检测；
- 绕过登录、验证码或平台权限；
- 未经人工审核自动转换客户或自动触达；
- 通过模型猜测补全不存在的身份、联系方式、供应商关系或采购需求。

## 6. 计划、证据与人工审核门禁

### 6.1 计划门禁

1. 自然语言目标先形成结构化计划草稿。
2. 前端读取 `ETag`，修改和审批使用 `If-Match`，防止覆盖他人修订。
3. 审批时服务端重新绑定并校验模型快照和所有搜索连接快照。
4. 只有已审批且快照仍可信的版本才能创建 Run。
5. 创建 Run 必须发送 `Idempotency-Key`。
6. Run 被拆成企业/个人搜索分片，可暂停、恢复和取消。

### 6.2 候选硬门禁

资格判断至少校验：

- `hasOriginalSource`：有原始公开来源；
- `identityResolved`：主体身份已解析；
- `notDoNotContact`：不在勿扰状态；
- `noExplicitRejection`：没有明确拒绝；
- `publicDataOnly`：只使用公开、允许的数据；
- `evidenceFresh`：证据未过期；
- `schemaValid`：结构化结果通过 Schema。

作战卡的每个重要结论必须引用候选已有证据。新证据会使原审批失效。CRM 转换只接受：

- 当前状态为 `approved`；
- 审核批准的 `decisionVersion` 与当前判断版本完全一致；
- 所有硬门禁仍通过。

面向普通客户端的直接证据、候选、评分、作战卡和 Outcome 写接口默认返回
`403 direct_domain_write_disabled`。这些权威结果只能由受控任务或明确启用的可信业务集成写入。人工审核和批准后的 CRM 转换仍通过公开 API 完成。

## 7. API 前缀与主要资源

所有获客 API 都要求 GoodJob 登录态，统一位于：

```text
/api/v1/acquisition
```

主要接口：

```text
# 计划与运行
POST   /api/v1/acquisition/plans
GET    /api/v1/acquisition/plans/:id
PATCH  /api/v1/acquisition/plans/:id
POST   /api/v1/acquisition/plans/:id/revisions
POST   /api/v1/acquisition/plans/:id/approval
POST   /api/v1/acquisition/plans/:id/runs
GET    /api/v1/acquisition/runs/:id
GET    /api/v1/acquisition/runs/:id/shards
POST   /api/v1/acquisition/runs/:id/pause
POST   /api/v1/acquisition/runs/:id/resume
POST   /api/v1/acquisition/runs/:id/cancel

# 候选、证据和审核
GET    /api/v1/acquisition/candidates
GET    /api/v1/acquisition/candidates/:id
GET    /api/v1/acquisition/candidates/:id/evidence
GET    /api/v1/acquisition/candidates/:id/qualification
GET    /api/v1/acquisition/candidates/:id/battle-card
GET    /api/v1/acquisition/candidates/:id/reviews
POST   /api/v1/acquisition/candidates/:id/review
POST   /api/v1/acquisition/candidates/:id/convert
GET    /api/v1/acquisition/outcomes
GET    /api/v1/acquisition/audit-events

# AI 增长参谋
POST   /api/v1/acquisition/copilot/sessions
GET    /api/v1/acquisition/copilot/sessions/:id
GET    /api/v1/acquisition/copilot/sessions/:id/messages
POST   /api/v1/acquisition/copilot/sessions/:id/messages
GET    /api/v1/acquisition/copilot/tasks/:id

# 官方数据源与客户 BYOK 连接
GET    /api/v1/acquisition/providers
GET    /api/v1/acquisition/provider-connections
POST   /api/v1/acquisition/provider-connections
GET    /api/v1/acquisition/provider-connections/:id
PATCH  /api/v1/acquisition/provider-connections/:id
DELETE /api/v1/acquisition/provider-connections/:id
POST   /api/v1/acquisition/provider-connections/:id/test

# 受控公开网页抓取
GET    /api/v1/acquisition/content-fetch-operations
POST   /api/v1/acquisition/content-fetch-operations
GET    /api/v1/acquisition/content-fetch-operations/:id

# 客户授权 CSV/XLSX 导入
GET    /api/v1/acquisition/import-operations
POST   /api/v1/acquisition/import-operations
GET    /api/v1/acquisition/import-operations/:id
```

列表接口使用有签名的游标；写接口需要按对应契约提供
`Idempotency-Key` 或 `If-Match`。前端不要自行拼装或修改服务端快照、证据、评分和审计字段。
导入接口接收最大 5 MB 的原始 CSV/XLSX 请求体；文件名、主体通道和列映射通过
查询参数或文档指定的请求头传入，不使用 `multipart/form-data`。公开网页 URL
和文件内容会在持久化前执行安全校验。

## 8. 启动、恢复与关闭

要求 Node.js `>=22.19.0`。

### 8.1 开发环境（内存）

```bash
JWT_SECRET='至少32字符且稳定的开发密钥' \
ACQUISITION_MASTER_SECRET='至少32字符且稳定的获客主密钥' \
CRM_STORE=memory \
npm run dev --workspace backend
```

内存模式只适合本地开发和自动测试；进程退出后获客计划、候选、会话和审计不会保留。

### 8.2 生产环境（MySQL）

至少配置：

```bash
NODE_ENV=production
CRM_STORE=mysql
DATABASE_URL=mysql://user:password@host:3306/goodjob
JWT_SECRET=...
ACQUISITION_MASTER_SECRET=...
PROVIDER_CREDENTIAL_KEY=...
AGENT_JOB_ENCRYPTION_KEY=...
MODEL_CONNECTION_IDEMPOTENCY_SECRET=...
```

所有密钥至少 32 个字符。`MYSQL_URL` 可替代 `DATABASE_URL`。

说明：

- `PROVIDER_CREDENTIAL_KEY`：加密模型/搜索 API Key 和 Provider 缓存；
- `AGENT_JOB_ENCRYPTION_KEY`：加密任务载荷；未单独配置时可复用 Provider 密钥；
- `ACQUISITION_MASTER_SECRET`：派生获客游标、工具审计、动作凭证和 Copilot 幂等密钥；
- `MODEL_CONNECTION_IDEMPOTENCY_SECRET`：模型连接写入幂等哈希；
- `JWT_SECRET`：登录认证；当前获客主密钥缺失时服务端会回退到它，但生产环境应显式设置独立且稳定的 `ACQUISITION_MASTER_SECRET`。

密钥不能随普通部署轮换。轮换前必须制定密文重加密和在途任务处理方案，否则旧凭据、动作凭证或审计校验可能无法读取。

### 8.3 生命周期

服务启动顺序：

1. 校验认证与密钥安全；
2. 初始化 GoodJob Store；
3. 在 MySQL 模式创建/迁移获客表；
4. 创建模型、搜索、领域、工具和 Pi Runtime；
5. 恢复未完成的 Plan execution intents；
6. 恢复被进程中断的 Copilot 任务；
7. 抢占并恢复排队中或租约已过期的网页抓取与文件导入任务；
8. 将 Runtime 安装到已认证的 Express 路由；
9. 启动原有 Prospect worker/scheduler 和 HTTP 服务。

任一步骤失败都会终止启动，不会降级成“页面可用但获客 Runtime 不可用”。收到
`SIGTERM` / `SIGINT` 时先停止接收新的获客任务，等待计划 Worker 和活动 Copilot 任务收尾，再关闭 MySQL Pool 和 GoodJob Store。默认获客 Worker 并发为 `2`，应用级优雅关闭超时为 30 秒。

## 9. Memory 与 MySQL

| 模式 | 用途 | 特性 |
|---|---|---|
| `memory` | 本地开发、单元测试、演示 | 启动快；不持久化；不能多进程共享 |
| `mysql` | 集成、试运行、生产 | 持久化计划、运行、候选、会话、工具 Ledger、审核和审计；支持进程重启恢复 |

生产环境强制使用 MySQL。不要把内存模式的成功演示当成持久化或故障恢复验收。

## 10. 与朋友并行开发的合并边界

建议按 API 合同协作，不共享临时内部对象：

### 智能体/决策负责人维护

- `backend/src/acquisition-*`
- `backend/src/model-providers/*`
- 模型/搜索连接快照与凭据版本语义
- Prompt、Tool Schema、评分与财务价值规则
- 本文档和获客专项测试

### 前端/通用后端负责人维护

- 获客页面、任务进度、候选列表、作战卡、审核台、经营看板；
- 现有 GoodJob CRM 页面和非获客业务路由；
- 通过本文公开 API 接入，不从前端导入后端内部类型或自行重算权威状态。

### 共同遵守

1. 每个功能单独分支和 Pull Request，不直接提交 `main`。
2. 不修改对方正在处理的文件；若必须改共享的 `server.ts`、`types.ts`、
   `mysql-store.ts` 或 API Schema，先在 Issue 中确认字段和迁移。
3. 前端必须保留服务端返回的 `ETag`、游标、任务 ID、decision version 和
   request ID；不得伪造模型/搜索快照。
4. 所有新增写接口都要明确幂等、租户、审批和错误码语义。
5. 合并前运行获客专项测试、TypeScript 编译和双方已有测试。
6. 数据库字段只通过向前兼容迁移增加；不要删除或重命名另一个分支已使用的字段。

## 11. 测试

不依赖 MySQL、不绑定本地 Socket 的确定性专项测试：

```bash
npm run test:acquisition --workspace backend
```

该脚本固定 UTC、单并发执行，并运行模型连接、官方端点、模型 Gateway 以及
`src/acquisition-*-test.ts` 全部获客专项测试。新增获客测试会自动纳入该脚本，
不能靠遗漏测试文件规避回归。

受当前沙箱禁止监听本地 Socket 的限制，以下 HTTP 传输测试没有放入该脚本，必须在允许绑定 loopback 的本机或 CI 单独运行：

```bash
NODE_ENV=test \
JWT_SECRET='goodjob-acquisition-http-test-secret-at-least-32-characters' \
ACQUISITION_MASTER_SECRET='goodjob-acquisition-http-master-at-least-32-bytes' \
node --import tsx --test --test-concurrency=1 \
  src/model-connection-routes-test.ts \
  src/acquisition-plan-router-test.ts \
  src/acquisition-v1-router-test.ts \
  src/acquisition-runtime-bridge-test.ts
```

MySQL 专项测试也不在默认脚本中，需要可丢弃的独立测试数据库后运行，例如：

```text
acquisition-mysql-repositories-test.ts
```

任何测试都不能指向开发者或客户的真实业务数据库。

## 12. 已知运营限制

1. **“全网”不等于无限抓取。** 能发现的范围受搜索厂商索引、API 配额、地区、许可和公开可见性约束；系统不能保证覆盖中国每个平台或取得全部联系方式。
2. **搜索结果不是客户事实。** 未解析身份、缺少原始来源或证据过期的候选会被硬门禁阻断，仍需要研究或人工核验。
3. **外部 API 是至少一次语义。** 工具结果 Ledger 使用租约和 fencing token 防止旧 Worker 覆盖新结果，但进程在外部请求成功、结果落库前崩溃时，搜索厂商仍可能收到重复请求。运营侧应设置预算/配额并依赖请求指纹和审计排查。
4. **MySQL 计划仓库目前偏保守。** 为保证正确性，计划/运行事务使用全局 guard，并会在事务视图中锁定和装载较大的计划运行表；高租户、高并发部署前需要改为租户/聚合级锁和分页读取。
5. **跨仓库事务仍需强化。** 候选领域状态、工具审计、工具幂等和 CRM 转换跨越多个 Repository，目前不应宣传为跨进程、跨服务的全链路 exactly-once。高并发生产部署前应补统一 Unit of Work / Outbox 与故障注入测试。
6. **部署形态当前以单 API Runtime 为安全基线。** 在完成上面的细粒度事务与多节点抢占验证前，不建议横向扩展多个同时写入同一获客计划/候选的 API 实例。
7. **Socket 与真实 MySQL 验收要在 CI 补齐。** 沙箱中的专项脚本只证明进程内逻辑，不替代 HTTP、真实数据库、真实厂商测试环境和灰度配额验证。
8. **连接健康不代表业务质量。** API Key 测试通过只说明端点可访问；搜索质量、证据准确率、模型结构化输出率和转化效果需要按行业持续评估。

## 13. 上线前检查

- [ ] Node.js 版本满足 `>=22.19.0`
- [ ] 生产环境使用 MySQL，备份和恢复演练通过
- [ ] 所有生产密钥独立、稳定且至少 32 字符
- [ ] 9 个模型连接的官方端点校验与能力探测通过
- [ ] 实际使用的搜索连接已测试，预算和配额已设置
- [ ] 计划审批、版本漂移拒绝、暂停/恢复/取消已演练
- [ ] 企业与个人各完成一条“搜索到人工审核”的样例链路
- [ ] 未解析身份、勿扰、明确拒绝、敏感数据和过期证据能被阻断
- [ ] CRM 转换必须依赖人工批准和准确 decision version
- [ ] `npm run test:acquisition --workspace backend` 与 TypeScript 编译通过
- [ ] HTTP Socket 测试和真实 MySQL 专项测试在 CI 通过
- [ ] 已确认系统没有自动外联、自动加好友或模拟真人动作入口
