# GoodJob 自动营销系统前端

当前仓库分支仅保留已确认的前端演示版本，不包含后端服务。

## 当前范围

- 多模块自动营销系统桌面端布局
- 获客中心、社媒对话、私域客户池与成交工作台等演示模块
- 智能体与自动工作流均为前端模拟展示
- 深色玻璃质感 UI、荧光绿色强调色与可滑动项目卡片
- Mac 与 Windows 桌面端界面演示

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://127.0.0.1:5188/#acquisition`，点击登录按钮即可进入前端演示系统。

## 验证

```bash
npm test
npm run test:e2e
npm run build
```

演示模块不会直接连接抖音、小红书、快手、微信或微博，也不会代表用户执行营销动作。

## 抖音公开获客任务

当同源后端提供获客 API 时，`#acquisition` 的真实任务弹窗支持创建、批准和启动
抖音公开获客计划。可选择启用受控的“公开评论样本”：该能力只采集一级公开样本，
默认上限为每次 10 个视频、每个视频 30 条评论、最多 3 页，并不表示全量评论。
运行详情只展示服务端返回的自动化步骤、计数和公开需求信号；访问受限或无可用公开
评论样本不会被解释为“没有客户”。公开评论主体仍需经过既有核验和人工审核流程。

只有当前计划版本仍是已批准版本、最新运行绑定该版本、公开评论样本已启用，
且运行处于排队或运行中的抖音任务，才可在详情中主动创建 120 秒的授权视觉读取
会话。网页只通过短时、同页面的结构化通道接收当前抖音
标签页中已显示的一级评论，并由网页使用现有同源登录态和 CSRF 保护写入
`POST /api/v1/acquisition/visual-reader-sessions` 及其会话子路由。网页不接受
浏览器读取器直接声明的“完成”作为业务事实，观察必须先由服务端持久化。
已保存的遮挡制品只通过
`GET /api/v1/acquisition/visual-reader-artifacts/:artifactId` 按当前登录范围读取。

制品上传默认开启，仅允许上传已遮挡的单张评论卡 WebP；关闭后仅提交
DOM 或可访问性文字观察，浏览器读取器不应进入 OCR。该通道不读取或上传
Cookie、完整页面截图或浏览器配置，也不执行私信、点赞、评论、关注或验证码处理。

### 安装未打包的只读扩展

```bash
npm run test:visual-reader
npm run build:visual-reader
npm run verify:visual-reader-build-order
```

在 Chrome 的扩展程序页面开启开发者模式，选择“加载已解压的扩展程序”，目录为
`dist-visual-reader/douyin-visual-reader`。该目录与主站 `dist` 分离，运行主站构建不会
删除扩展制品；`npm run check:visual-reader-bundle` 只审计已有制品，不会重写 manifest。
开发构建只允许连接
`http://127.0.0.1:5191/*`；发布构建必须显式设置以逗号分隔的 HTTPS
`GOODJOB_APP_ORIGINS`，并设置 `VISUAL_READER_RELEASE=1`，否则构建会失败。
开发环境即使提供 `GOODJOB_APP_ORIGINS` 也只接受这一精确 local origin；空值回退到它，
任何其他 origin、路径或多 origin 都会被拒绝。
审计会将完整 manifest 与当前模板和构建 origin 深度比对，包含 CSP、可选权限、内容脚本
的 matches/js/run_at/world/all_frames，以及 background、action 和 web-accessible resources；
任何额外、缺失或篡改字段都会被拒绝，检查命令不会修复制品。

使用时先在 GoodJob 运行详情中创建短时授权会话，再打开扩展弹窗，明确选择一个
`https://www.douyin.com/video/<id>` 标签页并点击“开始只读读取”。关闭弹窗不会停止；
点击“停止”、离开已绑定的可见抖音标签页，或用户在抖音页面滚动、点击、按键时会
安全停止。已绑定标签页即使以相同 canonical URL 重载、Chrome 在 loading 时未提供 URL、
或该 tab 被替换，也会立即安全停止；其他窗口的标签页活动不会误停。扩展后台进程若在
读取中重启，会清除残留授权并通知仍存活的网页和抖音内容脚本以
`partial_success + visual_reader_session_expired` 失败关闭，不会静默续读或把它记为用户
接管，也不会把原始 nonce 写入存储。当前扩展只读取
页面已显示的
一级评论文字、公开时间、公开计数和卡内公开主页链接，最多程序滚动 5 次；不读取
Cookie、脚本数据、头像地址、二级回复正文或页面内部状态，不执行任何写入或互动。
总会话时限中的最后一小段（时限的 20%，最多 1 秒、至少 1ms）专供终态投递；DOM 读取、
批次、ACK 和滚动会在较早的 work deadline 停止。预算用尽时会在该 deadline 触发点
幂等排队 terminal。合法 start 到达时若 work window 已为空或到期，会在创建 DOM adapter、
解析页面 source、创建 reader 或安装接管监听器之前同步进入终态投递；首次 deadline 判断和
发送发起使用同一同步决策。因此总时限仅 1ms 时仍会在初始化前发起一次，若排队时总时限
已经到达则不会发起；重试和 timeout 都不会越过总时限。

完整 DOM/ARIA 正文不运行 OCR。只有服务端授权的 `artifactUploadEnabled=true`
会话中，已绑定且当前可见的抖音标签页出现正文缺失或截断时，后台才会在
OCR 预算内调用 `captureVisibleTab`。截图前、截图后、offscreen 返回后以及异步 WebP
逐像素验证完成、放行 content 前都会用不可变的
session/tab/window/generation owner 重新授权；停止或接管会抢占等待队列、清理 offscreen
正在处理的 raw 资源，并拒绝已结束 generation 的迟到消息。原始 PNG 只通过 service worker 到
offscreen document 的临时内存消息，crop/redaction 后即清理；encoder scratch 也注册在该
generation 的可抢占清理域内，不写入 storage、IndexedDB、日志或错误载荷。
offscreen pipeline 将评论卡夹到视口，以 crop pixel 坐标遮挡头像和文字/公开元数据
矩形外的每个像素；固定遮挡色为 `[17,61,51,255]`，允许面积不超过 80%。
遮挡后 WebP 使用 lossless candidate，并在本地解码后逐字节对比；任何色偏或超过
256 KiB 都直接拒绝。每个批次最多 5 张 crop。
service worker 在放行前还会按授权 request 重新推导 crop 尺寸与 proof geometry，真实解码
WebP，并逐像素验证 alpha、头像及允许区域外的固定遮挡色；只信任 payload 自述字段不足以通过。

OCR 固定使用扩展内的 `tesseract.js 7.0.0`、`tesseract.js-core 7.0.0` 和
`chi_sim+eng` 语言资产，不使用 CDN、远程脚本、持久缓存或动态代码。语言包
只在构建期从 pinned `best_int` gzip 解压；扩展运行时只读本地未压缩
`.traineddata`，不包含 Node `Buffer` 兼容分支。每会话
惰性创建一个 worker，初始化和单次识别各有 20 秒上限，空闲 30 秒或会话结束时立即
terminate；晚到的 worker 也会立即销毁。OCR 输入会把时间与点赞/回复等公开元数据再次遮挡，
只能从正文矩形内的词边界按顺序重建文字。识别结果不能生成
评论 ID、主页地址或 secUid；低召回、低置信或 DOM/OCR 冲突仅作人工复核证据，
截断 DOM 在 OCR 空、失败或无效时仍以低置信观察保留，不拼接补全文字或金额。
每条提交和服务端归一化观察都分别保留 required-nullable `domTextHash` / `ocrTextHash`；
它们是来源证明，不替代服务端独立生成的 `textHash`。扩展 CSP 精确为
`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`；`ocr-assets.json` 记录所有本地
worker/core/WASM/语言文件的版本、字节数和 SHA-256。当前未压缩扩展约 29 MiB，
构建强制小于 80 MiB。

当前实现只经过合成 fixture、本地 OCR 和扩展构建审计，不代表已在真实抖音页面完成
兼容性验证或已发布到 Chrome 应用商店。

## Growth 真实模式（Real Mode）

仓库钉住了后端 Growth 合同发布（`contracts/pinned/`，当前 1.0.3），
`src/growth/` 提供独立增长工作区：

- `#growth/advisor` 增长参谋今日视图与受控建议
- `#growth/agents` 六位员工肖像业务顾问团队、经营诊断报告与单 Agent 工作台
- `#growth/catalog` 产品目录 / 套餐 / 定价策略
- `#growth/quotes` 报价工作台
- `#growth/finance` 成本、财务事实与 Excel 导入
- `#growth/roi` 预计与已关账实际 ROI

进入真实模式前，前端会调用 `GET /api/v1/growth/bootstrap` 做合同门禁：
合同大版本或哈希与钉住 manifest 不一致时显示
`contract_mismatch` 不可用状态；未选择具体工作区时显示
`workspace_selection_required`。所有页面能力（feature）与敏感字段
（`pricing.sensitive.read` 等 capability）均由服务端 bootstrap 投影决定，
演示模式不会发起任何 Growth API 请求。

Growth API 与主应用共用同源 Cookie 登录态和 `gj_csrf` CSRF Cookie。
未登录时可保留 `#growth/...` 目标路由；用户登录或恢复有效会话后，前端会
自动重新执行 bootstrap，不会跳回 `#acquisition`。Growth 工作区显示时会
隐藏旧演示壳层，避免两套页面同时出现。

业务顾问中心支持在浏览器本地读取 `xls / xlsx` 资产负债表与利润表，
再将结构化报表数据交给现有 Growth API 生成诊断；文件上传与解析界面不代表
仓库内包含报表存储或后端服务。

## 验证（Growth 门禁）

```bash
pnpm run contract:check
pnpm run test:types
pnpm test
pnpm run test:e2e
pnpm build
git diff --check
```
