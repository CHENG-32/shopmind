# 掌柜参谋 ShopMind

> InfiniSynapse × CSDN **Vibe Coding 泛数据分析应用开发大赛** 参赛作品  
> 面向小微餐饮/零售老板的 **AI 经营参谋**：自然语言问数 · 异常哨兵 · 证据链 · 可执行行动

---

## 一句话介绍（可直接用于报名）

**掌柜参谋 ShopMind** 是一款基于 InfiniSynapse 的泛数据分析 Web 应用。用户加载订单、库存等经营数据后，系统自动生成经营日报与异常哨兵；每条洞察附带数据证据链，并给出今日可执行行动。自然语言追问由服务端调用 InfiniSynapse Server API（SSE 事件流 + newTask + 任务文件上传）完成深度分析，让不会 SQL 的老板也能完成「查数—归因—决策」全流程。

---

## 作品要求对照

| 比赛要求 | 本作品 |
|---------|--------|
| 集成 InfiniSynapse Server API | ✅ `app/infinisynapse.py`，Bearer API Key，可在平台查调用日志 |
| 可运行应用（非脚本/Notebook） | ✅ FastAPI Web 应用 + 前端页面 |
| 公网可访问 / 可部署 | ✅ 见下方部署说明 |
| 明确使用场景 | ✅ 小微餐饮/茶饮门店经营分析 |
| 泛数据分析 | ✅ 多表数据 + 知识库术语 + NL 分析 + 洞察与行动 |

---

## 快速启动

```bash
cd shopmind
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 配置 API Key（已可用 .env；勿把真实 Key 提交到公开仓库）
cp .env.example .env
# 编辑 .env：INFINISYNAPSE_API_KEY=sk-xxxx

python run.py
# 浏览器打开 http://127.0.0.1:8080
```

### 评委 3 分钟演示路径

1. 打开首页 → 查看 **4 张 KPI** 与 **经营趋势**
2. 在 **异常哨兵** 点击「查看证据链」
3. 点击快捷问题或输入：「最近一周哪个品类下滑最明显？」
4. 勾选「调用 InfiniSynapse」获得 Agent 深度分析（关闭则本地秒回，保证演示稳定）

---

## 架构

```
浏览器 UI (static/)
    ↓ HTTP
ShopMind 后端 (FastAPI)
    ├─ 本地经营引擎 analytics.py  → 看板 / 哨兵 / 行动 / 证据链
    └─ InfiniSynapseClient
           ├─ 启用数据源 & 知识库
           ├─ SSE  GET /api/ai/events
           ├─ POST /api/ai/message  (newTask)
           └─ POST /api/tools/taskUpload/:taskId  (上传 CSV/MD)
```

---

## InfiniSynapse 集成说明（提交材料）

### 认证与地址

- **Base URL（国内）**：`https://app.infinisynapse.cn/api`
- **请求头**：`Authorization: Bearer <API Key>`，`x-lang: zh_CN`
- **API Key 仅保存在服务端**（环境变量 / `.env`），前端不接触密钥

### 调用流程

1. `GET /ai_database/list` + `POST /ai_database/enabled`  
2. `GET /ai_rag_sdk` + `POST /ai_rag_sdk/enabled`  
   （官方要求：newTask 前必须 list + enabled，否则 Agent 看不到资源）
3. `GET /ai/events?connId=<uuid>` 建立 SSE
4. `POST /ai/message`，`type=newTask`，携带经营分析 prompt
5. 取得 `taskId` 后 `POST /tools/taskUpload/:taskId` 上传：
   - `orders.csv` / `inventory.csv` / `daily_summary.csv` / `knowledge_base.md`
6. 消费 SSE 中 `completion_result` 作为对用户的分析答复
7. 若 Agent 发出 `upload_file_to_sandbox`，再次上传并用 `askResponse` 继续

### 代码入口

- 客户端：`app/infinisynapse.py` → `InfiniSynapseClient.run_analysis`
- HTTP 接口：`POST /api/ask`（`use_infini=true`）
- 集成自检：`GET /api/integration`

### 可核验性

所有分析任务会在 InfiniSynapse 控制台留下任务与 API 调用记录；响应中返回 `task_id` 便于评委对照。

---

## 目录结构

```
shopmind/
├── app/
│   ├── main.py              # FastAPI 路由
│   ├── analytics.py         # 本地经营分析 / 哨兵 / 证据链
│   ├── infinisynapse.py     # Server API 客户端
│   └── config.py
├── data/                    # 星野手作茶 Demo 数据
├── static/                  # 前端
├── docs/SUBMISSION.md       # 报名文案与提交清单
├── requirements.txt
├── run.py
└── README.md
```

---

## 部署到公网（推荐）

任选其一，保证评委能打开 URL：

### A. 云主机 + 进程守护

```bash
pip install -r requirements.txt
# 设置环境变量后
nohup python run.py > shopmind.log 2>&1 &
# 用 Nginx 反代 80/443 → 8080，或直接暴露 8080
```

### B. Docker（可选自行补充）

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
ENV HOST=0.0.0.0 PORT=8080
CMD ["python", "run.py"]
```

### C. 内网穿透临时演示

```bash
# 本机先 python run.py
npx localtunnel --port 8080
# 或使用 cloudflared / cpolar 等
```

---

## 创新点（写给评委）

1. **异常哨兵**：不是「等用户想问题」，而是主动扫销量下滑、断货、优惠侵蚀、退款抬升  
2. **证据链**：每条异常绑定指标公式、样本订单/库存字段，降低黑盒感  
3. **行动卡片**：洞察直接落到「今天做什么」  
4. **双引擎**：本地引擎保证秒开演示；InfiniSynapse Agent 负责深度 NL 分析，符合「真正集成 API」  

---

## 许可证与声明

- Demo 数据为虚构品牌「星野手作茶」，仅用于比赛演示  
- InfiniSynapse 为主办方平台，本作品按官方 Server API 集成  
- 请妥善保管 API Key，不要提交到公开 Git 仓库  
