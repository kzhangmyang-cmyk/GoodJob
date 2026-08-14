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

该版本不会连接抖音、小红书、快手、微信或微博，也不会执行真实营销任务。

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
