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
```

在 Chrome 的扩展程序页面开启开发者模式，选择“加载已解压的扩展程序”，目录为
`dist/douyin-visual-reader`。开发构建只允许连接
`http://127.0.0.1:5191/*`；发布构建必须显式设置以逗号分隔的 HTTPS
`GOODJOB_APP_ORIGINS`，并设置 `VISUAL_READER_RELEASE=1`，否则构建会失败。

使用时先在 GoodJob 运行详情中创建短时授权会话，再打开扩展弹窗，明确选择一个
`https://www.douyin.com/video/<id>` 标签页并点击“开始只读读取”。弹窗关闭、标签页
切换或用户在抖音页面滚动、点击、按键时会安全停止。当前扩展只读取页面已显示的
一级评论文字、公开时间、公开计数和卡内公开主页链接，最多程序滚动 5 次；不读取
Cookie、脚本数据、头像地址、二级回复正文或页面内部状态，不执行任何写入或互动。

本阶段只提供 DOM/ARIA 读取，所有观察的 `redactedCrop` 均为 `null`。即使会话允许
制品上传，也不会截图或运行 OCR；本地遮挡裁剪与 OCR 仍属于后续开发范围。当前实现
只经过固定 fixture 和本地扩展构建验证，不代表已在真实抖音页面完成兼容性验证或已
发布到 Chrome 应用商店。

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
