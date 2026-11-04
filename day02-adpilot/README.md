# Day 2 — 投放参谋 AdPilot（广告创意与报表 Agent）
路由 `/d02/`（共享体验码 gate）。给广告公司 / 代运营 / 小品牌投手用的三件事：**创意方案 → A/B 实验矩阵 → 报表解读**，加按客户归档的项目空间。

| 模块 | 本地完成（确定性） | Agent 完成 |
|---|---|---|
| 创意方案 | 渠道字段与字数上限校验（Google 按半角宽度，汉字=2） | 洞察、4 个角度、钩子/标题、15s 分镜、分渠道文案、合规提示 |
| A/B 实验 | 两比例检验样本量（α/功效可选）、每组预算、周期、CSV 导出 | 假设、变量×变体、主/次/护栏指标、实验设计 |
| 报表解读 | CSV/XLSX 解析（自动识别表头行、GBK 回退）、字段别名映射+手动映射、CTR/CVR/CPC/CPM/CPA/ROAS、环比、分计划、鲁棒 z 异常检测、素材疲劳、SVG 图表 | 总结、发现、优化建议（P0-P2）、下周计划 |
| 项目空间 | localStorage 按客户保存；Markdown 导出；打印/PDF 视图 | — |

报表原始行不出浏览器，只把聚合指标发给 Agent。支持的列名：巨量引擎/千川（消耗、展示数、点击数、转化数、成交金额/支付GMV…）、腾讯广告（花费、曝光次数、点击次数、下单量、下单金额）、Meta（Amount spent (USD)、Impressions、Link clicks、Purchases、Purchases conversion value）、Google Ads（Cost、Impr.、Clicks、Conversions、Conv. value）。示例：`samples/sample-qianchuan.csv`、`samples/sample-meta.csv`（模拟数据，含故障日与素材疲劳）。

## 文件
`app.json` · `index.html` `styles.css` `app.js`（UI）· `metrics.js`（指标，浏览器/Node 通用）· `api.py`（`status()`、`stream(payload, emit)`、提示词与 JSON 结构）· `zoowork.py`（stdlib ZooWork 客户端）· `demo.py`（演示输出）· `tests/test_metrics.js`（`node tests/test_metrics.js`）· `tests/shots.py`（playwright 截图）· `shots/`。
`server.py` 新增两个通用路由：`GET /dNN/status`（需体验码，不扣次数）与 `POST /dNN/stream`（SSE，需体验码，每次扣 1 次，body 上限 400KB）。

## 模式
- **真实模式**：设置 `ZOOWORK_API_KEY` → 服务端代理调用 ZooWork，密钥不进浏览器。调用失败自动回退演示数据并在进度中提示。
- **演示模式**：无密钥时所有模块可用，输出带「演示模式/演示数据」标识。

环境变量：`ZOOWORK_API_KEY`（必填，开启真实模式）· `ZOOWORK_BASE_URL`（默认 `https://clawapi.ecap.gsmo.ai/service/v1`）· `ZOOWORK_AGENT_ID`（建议在 Render 设置；不设则首次调用自动创建名为 `adpilot-d02` 的 Agent，ID 缓存在 `data/d02_agent.json`，Render 免费实例重启会丢失并再建一个）。

## ZooWork API — 已核实 vs 推断
来源：`https://zoowork.ai/llms-full.txt`（官方文档全文）、`reports/managed-agent-frontend-auth-design.html`，并于 2026-11-04 用真实密钥端到端跑通。

**已核实（实测成功）**
- Base URL `https://clawapi.ecap.gsmo.ai/service/v1`；鉴权 `Authorization: Bearer <key>`。当前密钥前缀 `zct_`（Work service token；网关按前缀分发 `zwp_live_`=Project key / `zct_`=Work token），`GET /models`、`GET /agents` 均 200。
- 必须带非默认 `User-Agent`：Python-urllib 默认 UA 被 Cloudflare 1010 拦截（403）。
- `POST /agents` `{"resource":{"name","onboarding":false,"labels","tool_policy":{"allow":["read"]}}}` → `agent_id`
- `POST /agents/{id}/start`；`GET /agents/{id}`
- `POST /agents/{id}/sessions` `{}` → `session_id`
- `POST /agents/{id}/sessions/{sid}/events` `{"events":[{"type":"user.message","content":"..."}]}` → `events[0].accepted === true`
- `GET /agents/{id}/sessions/{sid}/events/stream?deltas=agent.message`，`Accept: text/event-stream`：durable 帧 `event: event` + `data: {"event_type", "payload", "seq"...}`；预览帧无 event 行，`{"type":"event_delta","deltaText":全文快照,"replace":true}`（覆盖而非追加）。
- 读取：`agent.assistant` → `payload.message.content[].text`；结束 `run.finished` → `payload.status == "succeeded"`。流在回合结束后不关闭，客户端读到 run.finished 即断开。

**按文档实现、未单独实测**
- `agent.tool`（`phase/toolName`）、`agent.thinking`、`agent.error` 映射为进度步骤（本 Agent 禁用了大部分工具，实测中未出现）。
- 断线续传 `?cursor=`（未实现，单回合 <60s；失败即回退演示）。
- `system_prompt` 只是平台模板版本固定，不能写自定义文本 → 指令与 JSON 结构放在每条 `user.message` 里。

## 本地运行
`PORT=8787 GATE_BOOTSTRAP_CODE=ADPTEST1:24:50 python3 server.py` → http://localhost:8787/d02/ 输入 `ADPTEST1`。
