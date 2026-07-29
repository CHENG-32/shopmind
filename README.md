# 掌柜参谋 ShopMind

面向小微餐饮 / 零售门店的 **AI 经营分析控制台**。  
连接订单、库存、日报与业务知识，本地引擎即时产出经营看板 / 异常哨兵 / 行动清单；**深度分析由 InfiniSynapse Agent 驱动**——建立 SSE 事件通道、上传经营文件后由 Agent 交叉推理，结论与 task_id 全程可核验。

**仓库：** https://github.com/CHENG-32/shopmind

---

## 产品简介

小微老板有订单表、库存表，却没有分析师。ShopMind 把「查数 → 归因 → 决策」收成一条产品路径：

1. **总览驾驶舱**：KPI 环比 + 迷你趋势、30 日趋势四指标切换（GMV/订单/毛利/客单价）、渠道与会员双环形图、门店对比（含环比）、品类结构、时段热力与高峰识别、SKU 毛利率榜  
2. **经营健康度**：环比 / 哨兵 / 退款综合百分制评分与扣分因子拆解（仪表盘视图）  
3. **异常哨兵**：主动扫描销量下滑、断货风险、优惠侵蚀、退款异常，按严重度筛选  
4. **证据链**：每条异常绑定指标口径、关键数字与样本明细，结论可核对  
5. **未来 7 日预估**：近 4 周周总量衰减加权 × 本周实际折中，给出区间与方法说明  
6. **数据画像**：数据集数值列均值与极值、类别列 Top 值一览  
7. **行动清单**：将洞察落成「今天补什么货、推什么活动、收哪类券」  
8. **AI 参谋**：自然语言追问，**深度分析 = InfiniSynapse Agent（SSE 流式回传）**；经营速览 = 本地引擎  
9. **数据资产**：分析所用经营文件全量可查，即深度分析时上传给 Agent 的资料  
10. **分析历史**：深度分析逐条留档（引擎、耗时、task_id），随时回看复用  
11. **集成自检（API）**：`POST /api/integration/check` 一键真实调用 InfiniSynapse 回传资源清单（评审核对用 API，页面不展示）

示例数据为虚构品牌「星野手作茶」三门店近 90 天经营数据，用于完整体验产品闭环。

---

## 账户体系（游客 / 登录）

| 能力 | 游客 | 登录后 |
|------|------|--------|
| 总览 / 哨兵 / 行动 / 数据资产 / 集成说明 | ✅ | ✅ |
| 经营速览问答（本地引擎） | ✅ | ✅ |
| **深度分析（调用 InfiniSynapse）** | 🔒 引导登录 | ✅ |
| 集成自检（真实调用 InfiniSynapse） | 🔒 | ✅ |
| 分析历史 | 🔒 | ✅ |

- 注册 / 登录：邮箱 + 密码（scrypt 哈希），HMAC-SHA256 签名令牌，7 天有效，密钥仅存服务端文件  
- 游客界面与登录态基本一致；触发核心功能时弹出登录框，**登录成功后自动继续原操作**  
- 历史记录与用户绑定；用户库为本地 SQLite（`data/users.db`，git 已忽略）

---

## 技术架构

```
浏览器 SPA（static/，哈希路由 6 视图 + 暗色极光 Hero + 零依赖 SVG 图表）
    ↓ HTTP / SSE
ShopMind 后端 (FastAPI)
    ├─ auth.py        scrypt 密码 + HMAC 令牌，require_user 守护核心接口
    ├─ db.py          SQLite：users / analyses
    ├─ analytics.py   本地经营引擎 → 看板 / 哨兵 / 行动 / 证据链 / 数据资产
    └─ InfiniSynapseClient
           ├─ GET  /ai_database/list + POST /ai_database/enabled
           ├─ GET  /ai_rag_sdk + POST /ai_rag_sdk/enabled
           ├─ GET  /ai/events?connId=        （SSE 事件通道）
           ├─ POST /ai/message               （type=newTask）
           ├─ POST /tools/taskUpload/:taskId （上传 CSV / MD）
           └─ stream_analysis()              （进度事件 → 前端 SSE 实时呈现）
```

| 模块 | 路径 |
|------|------|
| Web 服务与 API | `app/main.py` |
| 认证（密码 / 令牌 / 依赖注入） | `app/auth.py` |
| SQLite 持久化（用户 / 历史） | `app/db.py` |
| 经营分析 / 哨兵 / 证据链 / 数据资产 | `app/analytics.py` |
| InfiniSynapse 客户端 + 流式桥接 | `app/infinisynapse.py` |
| 前端（路由 / 图表 / 流式问答） | `static/` |
| 冒烟测试 | `tests/smoke_test.py` |
| 示例数据与知识库 | `data/` |

---

## InfiniSynapse 集成说明

- **Base URL（国内）**：`https://app.infinisynapse.cn/api`
- **鉴权**：服务端 `Authorization: Bearer <API Key>`，`x-lang: zh_CN`（密钥仅服务端持有，前端不可见）
- **主链路**：启用数据源 / 知识库 → SSE 通道 → `newTask` → 上传 `orders.csv / inventory.csv / daily_summary.csv / knowledge_base.md` → 消费 `completion_result`；出现 `upload_file_to_sandbox` 时补传并以 `askResponse` 继续
- **流式强化**：后端把 Agent 的进度（初始化 → 任务创建 → 文件上传 → 结论分段输出）转成事件流，经 `POST /api/ask/stream` 实时推送前端，用户可见完整推理过程
- **业务接口**：`POST /api/ask`（同步）/ `POST /api/ask/stream`（SSE），均需登录，响应含 `task_id` 可在平台核对调用
- **集成自检**：`GET /api/integration`（公开说明）、`POST /api/integration/check`（登录后真实调用）

---

## API 一览

| 接口 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/health` | 公开 | 引擎配置与版本 |
| `GET /api/dashboard` `/api/sentinels` `/api/briefing` | 公开 | 经营看板 / 哨兵 / 简报 |
| `GET /api/datasets` `/api/datasets/{key}` | 公开 | 数据资产与分页预览 |
| `POST /api/ask`（`use_infini=false`） | 公开 | 本地经营速览 |
| `POST /api/auth/register` `/api/auth/login` `/api/auth/me` | 公开 | 账户体系 |
| `POST /api/ask`（`use_infini=true`） | **登录** | InfiniSynapse 深度分析（同步） |
| `POST /api/ask/stream` | **登录** | InfiniSynapse 深度分析（SSE 流式） |
| `POST /api/integration/check` | **登录** | 真实集成自检 |
| `GET /api/history` `/api/history/{id}` | **登录** | 分析历史 |

未登录调用核心接口返回 `401 { code: "auth_required" }`。

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

## 测试

```bash
python3 tests/smoke_test.py          # 冒烟：公开接口 / 401 拦截 / 注册登录（约 10 秒）
python3 tests/smoke_test.py --deep   # 追加：真实 InfiniSynapse 深度分析端到端（数分钟）
```

---

## 目录结构

```
shopmind/
├── app/
│   ├── main.py            # FastAPI 路由与权限模型
│   ├── auth.py            # scrypt 密码 + HMAC 令牌
│   ├── db.py              # SQLite：users / analyses
│   ├── analytics.py       # 本地经营引擎 + 数据资产
│   ├── infinisynapse.py   # InfiniSynapse SSE 客户端 + 流式桥接
│   └── config.py
├── data/                  # 示例经营数据 / 知识库 / 用户库(运行时生成)
├── static/                # index.html / styles.css / app.js / charts.js
├── docs/SUBMISSION.md
├── tests/smoke_test.py
├── requirements.txt
├── run.py
└── README.md
```
