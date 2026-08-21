# AI 经营顾问（business-advisor）

面向 1000 万～5000 万营收民企老板的虚拟经营顾问团队。定位是「让没有请 CFO 的老板也拥有一个 AI 经营管理团队」，输出经营诊断而非单纯财务问答。

## 智能体团队

| id | 角色 | 职责 |
| --- | --- | --- |
| cfo | AI 经营总管 | 综合诊断、健康评分、90 天行动计划 |
| finance | 财务分析 | 三大报表、盈利能力、运营效率、安全能力 |
| profit | 利润分析 | 产品真实利润、客户 ABC、假利润识别、费用对标 |
| cost | 成本分析 | 成本结构、价差/量差、异常科目识别 |
| cashflow | 现金流分析 | 现金预测、应收分析、资金全链条复盘 |
| tax | 税务健康 | 发票、收入确认、成本真实性、个税、股权（只体检不做避税） |

每个智能体带专属知识库（`knowledge.ts`），口径与方法论来自领雁财税/冠琦咨询的真实项目（丰博自动化、金辉酒业、天瑞产业），已按脱敏口径沉淀。

## 金额与比例约定

- 金额一律用整数 minor（元 × 100），避免浮点误差。
- 比例一律用 BPS（万分之一）：`800 bps = 8%`。
- 报表勾稽不平、毛利为负、期末现金为负时抛错拒绝编数，绝不粉饰。

## 指标口径（analysis.ts）

| 指标 | 口径 | 警戒线 |
| --- | --- | --- |
| 毛利率/净利率 | 毛利/收入、净利润/收入 | 净利率 < 5% 高风险，< 8% 关注 |
| ROE / ROA | 净利润/净资产、净利润/总资产 | — |
| 资产负债率 | 总负债/总资产 | > 70% 高风险 |
| 流动比率 / 速动比率 | 流动资产/流动负债；(流动资产-存货)/流动负债 | < 1.5 / < 1.0 高风险 |
| 应收账款周转率 / 天数 | 收入/应收；(应收/收入)×365 | 周转天数 > 90 高风险 |
| 存货周转率 | 营业成本/存货 | < 2 次 关注 |
| 利息保障倍数 | (净利润+所得税+利息)/利息 | < 3 高风险 |
| 收现比 / 净现比 | 经营现金流入/收入；经营净现金流/净利润 | 收现比 < 85% 关注；净现比 < 1 且净利为正 高风险 |
| 现金保障月数 | 期末现金/月均毛利 | — |

## 诊断报告结构（service.ts）

报告 = 健康评分 + 问题清单（全量，按优先级排序）+ 90 天行动计划 + 证据链。

每个问题遵循咨询四段式：**现象（证据）→ 风险（法律/财务/管理）→ 建议（制度+流程）**，并带 `category`（财务/利润/成本/现金流/税务/经营）与 `level`（red/yellow）分级。健康评分从 5000 起步，按上述红线逐项扣分，封顶 10000。

## API

### 同步经营诊断

旧路由挂在 `backend/src/business-advisor-router.ts`，在单个 HTTP 请求中同步计算公式与诊断，不创建可恢复运行：

- `GET /api/v1/business-advisor/agents`：智能体团队与知识库标题
- `POST /api/v1/business-advisor/analyze`：指标 + 产品/客户/现金流/成本/税务分析
- `POST /api/v1/business-advisor/diagnose`：完整经营诊断报告
- `POST /api/v1/business-advisor/statements/parse`：解析标准报表（资产负债表 + 利润表）为引擎输入
- `POST /api/v1/business-advisor/statements/diagnose`：解析报表并直接生成诊断报告
- `POST /api/v1/business-advisor/statements/import`：多 sheet / 集团报表导入，按公司分组返回全部诊断结果

### 冻结财务委员会运行

`POST /api/v1/finance/council-runs` 是独立的异步工作流入口。认证上下文必须具有 `finance.council.run`；workspace、actor 和 capabilities 只取自认证上下文，请求体只能提交币种、数据时点、报表证据与策略版本。

创建运行时，服务先在同一 cutoff 读取 CRM、报价、已验证财务事实与 ROI 权威投影，再把报表、公式输入、数据缺口和敏感字段投影冻结成 run-bound snapshot。Repository 在一个原子 mutation 中提交 `snapshot_frozen` 运行、snapshot 以及连续的 `created` / `snapshot_frozen` 事件；不会在 HTTP 请求中执行模型。`snapshot_frozen` 是可恢复的持久工作事实，内部 relay 会把它投递给幂等 wake sink，失败后按后续 sweep 重试。

同一 `Idempotency-Key` 与同一 canonical 请求精确重放同一个运行；修改请求体返回冲突，不会重复提交 snapshot 或 advisory wake。运行与事件读取始终按认证 workspace 隔离。

HTTP 幂等仓库只保存 domain-separated digest，不保存原始 `Idempotency-Key`。同一创建请求在运行推进到 revision 2 之后仍精确重放当前聚合，不回退或重建 snapshot。持久化 snapshot 与完整事件链在每个读取边界重新校验：业务报表复用唯一 canonical validator，snapshot 会从所属 run 的报表与权威投影重新计算标准报表、公式、缺口、来源引用及 run-bound 身份，并且 record `createdAt` 必须精确等于唯一 `snapshot_frozen` 事件的 `occurredAt`，不能只靠攻击者重新签名通过。报价权威读取先按请求币种过滤，再应用 100 项完整性探针上限；未指定币种的旧 reader 调用保持原行为。

runnable 扫描使用 workspace/run 的 UTF-8 binary-byte 复合游标，Memory 与 MySQL 共用同一全序。relay 对 runnable enumeration、wake sink 与错误 observer 都设置有界 deadline，因此永久不返回的查询或投递不会阻塞 sweep 或应用关闭。公开创建合同只接受 CNY/USD，策略版本 ID 与业务报表文本分别最多包含 255 和 4000 个 Unicode code point，报表数组上限 100 项。公开 run 从 `snapshot_frozen` 开始，内部 revision-1 `created` 状态只存在于事件历史，service 与 router 都不会把它作为 run 响应。

### 五专家可恢复执行

生产模块把官方 active model gateway、五专家 coordinator、确定性冲突图、一轮反驳、lease-fenced worker 与 recovery sweeper 组合成真实异步流程：

`snapshot_frozen -> analyzing -> auditing -> synthesizing`

创建/冻结时会在内部原子持久分析 owner/team，恢复不使用当前切换的 workspace 或模型身份。每次 claim 使用随机 64 位十六进制 token 和递增 attempt；精确到期时刻已算 stale，同 worker reclaim 后的旧 token 也不能写入。专家 result、gap、audit graph、rebuttal reservation/result/disposition 与运行转移都在同一 token + attempt + strict-expiry fence 下提交。

五个 analyze job 与最多五个 rebuttal job 的逻辑 attempt 始终为 `1`；可重试传输失败一次，不增加专家提交轮次。恢复先读已持久的 analyze result、graph 和 rebuttal reservation/completion，不创建第二轮，变更的 replay 会冲突关闭。

`finance` 和 `cashflow` 是硬约束角色，失败或缺失现金硬约束会进入 `not_computable`。`profit|cost|tax` 只有在确定性检查证明不依赖未可用硬约束或动作公式时才可部分继续，并持久仅含闭集 code 的脱敏 gap。缺少税务输入记为 `tax_input_missing`，不伪造税务结论。关闭顺序是 relay、sweeper、worker drain，然后底层资源。

## 报表导入（statement-import.ts）

支持两类标准格式：

- 小企业会计准则（会小企01表）：`资产/行次/期末余额/年初余额` 左右双栏布局，利润表含 `本年累计金额/本季金额`。
- 一般企业会计准则：`资产/行次/期末余额/上年年末余额`，利润表含 `本期金额/本年累计金额`。

解析规则：

- 关键科目从表内行标签匹配（货币资金、应收账款、存货、应付账款、负债合计等），金额统一转整数 minor。
- 多 sheet 导入（`statements/import`）自动识别每个 sheet 是资产负债表还是利润表，按「编制单位」或 sheet 名分组配对；单家公司解析失败不影响其他公司，失败项带错误码返回。
- `其他流动资产`、`非流动资产`、`非流动负债` 优先取报表自带合计行，并做三重勾稽校验：资产合计=流动资产+非流动资产、负债合计=流动+非流动负债、资产=负债+权益（容差 1 元），不平即报 `statement_unbalanced`。
- 期间费用由报表自身勾稽倒推（营业收入-营业成本-净利润-财务费用-所得税费用），保证引擎净利润与报表一致。
- 未提供现金流量表时 `cashFlow` 缺省：现金流预测/收现比/净现比不参与判定，报告用「数据说明」提示；期末现金取资产负债表货币资金。
- 真实亏损企业（负权益、零收入有成本）允许诊断，毛利为负作为红色预警输出，不再拒绝。

## 测试

```bash
npm run test:business-advisor --workspace backend
npm run test:financial-council --workspace backend
npm run test:financial-council:mysql --workspace backend
```

覆盖：金额换算、勾稽校验、指标计算、假利润/客户 ABC/现金流预警、知识库条目、诊断阈值（负债率/应收天数/利息保障/净现比）、两种报表格式解析与勾稽错误。
