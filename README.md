# 掌柜参谋 ShopMind

面向小微餐饮 / 零售门店的 **AI 经营分析应用**。  
连接订单、库存与业务知识，自动完成经营日报、异常发现与行动建议；自然语言追问由 **InfiniSynapse** 完成深度分析。

**仓库：** https://github.com/CHENG-32/shopmind

---

## 产品简介

小微老板往往有订单表、库存表，却缺少分析师。ShopMind 把「查数 → 归因 → 决策」收成一条产品路径：

1. **经营看板**：近 7 日 GMV、订单量、客单价、毛利及环比，30 日趋势，Top SKU / 门店 / 渠道  
2. **异常哨兵**：主动扫描销量下滑、断货风险、优惠力度抬升、退款异常  
3. **证据链**：每条异常绑定指标口径、关键数字与样本明细，结论可核对  
4. **行动清单**：将洞察落成「今天补什么货、推什么活动、收哪类券」  
5. **自然语言分析**：服务端调用 InfiniSynapse Server API，上传经营文件与知识库后由 Agent 作答  

示例数据为虚构品牌「星野手作茶」三门店近 90 天经营数据，用于完整体验产品闭环。

---

## 功能亮点

| 能力 | 说明 |
|------|------|
| 异常哨兵 | 系统主动发现问题，而不是等用户先想好问题再查 |
| 证据链 | 指标公式 + 样本订单 / 库存字段，降低黑盒感 |
| 行动卡片 | 洞察直接对应可执行动作 |
| 双引擎 | 本地经营引擎即时出看板与哨兵；InfiniSynapse Agent 负责深度 NL 分析 |

---

## 技术架构

```
浏览器 UI (static/)
    ↓ HTTP
ShopMind 后端 (FastAPI)
    ├─ 本地经营引擎 analytics.py  → 看板 / 哨兵 / 行动 / 证据链
    └─ InfiniSynapseClient
           ├─ 启用数据源 & 知识库
           ├─ SSE  GET /api/ai/events
           ├─ POST /api/ai/message  (newTask)
           └─ POST /api/tools/taskUpload/:taskId  (上传 CSV / MD)
```

| 模块 | 路径 |
|------|------|
| Web 服务与 API | `app/main.py` |
| 经营分析 / 哨兵 / 证据链 | `app/analytics.py` |
| InfiniSynapse 客户端 | `app/infinisynapse.py` |
| 示例数据与知识库 | `data/` |
| 前端 | `static/` |

---

## InfiniSynapse 集成说明

- **Base URL（国内）**：`https://app.infinisynapse.cn/api`
- **鉴权**：服务端 `Authorization: Bearer <API Key>`，`x-lang: zh_CN`（密钥仅存服务端）
- **主链路**  
  1. `GET /ai_database/list` + `POST /ai_database/enabled`  
  2. `GET /ai_rag_sdk` + `POST /ai_rag_sdk/enabled`  
  3. `GET /ai/events?connId=` 建立 SSE  
  4. `POST /ai/message`，`type=newTask`  
  5. `POST /tools/taskUpload/:taskId` 上传 `orders.csv` / `inventory.csv` / `daily_summary.csv` / `knowledge_base.md`  
  6. 消费 SSE `completion_result` 作为分析答复  
  7. 若出现 `upload_file_to_sandbox`，补传文件并以 `askResponse` 继续  
- **业务接口**：`POST /api/ask`（`use_infini=true` 走 Agent；响应含 `task_id` 可在平台核对调用）  
- **集成自检**：`GET /api/integration`

---

## 本地运行

```bash
git clone https://github.com/CHENG-32/shopmind.git
cd shopmind
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 填写 INFINISYNAPSE_API_KEY
python run.py          # http://127.0.0.1:8080
```

主要接口：`GET /api/dashboard`、`GET /api/briefing`、`POST /api/ask`、`GET /api/health`。

---

## 目录结构

```
shopmind/
├── app/
│   ├── main.py
│   ├── analytics.py
│   ├── infinisynapse.py
│   └── config.py
├── data/
├── static/
├── docs/
├── requirements.txt
├── run.py
└── README.md
```
