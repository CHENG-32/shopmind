# 掌柜参谋 ShopMind · 作品说明

## 应用名称

掌柜参谋 ShopMind（v2 · 门店经营 AI 分析控制台）

## 应用简介与使用场景

面向个体户与小微餐饮 / 茶饮门店的 AI 经营数据分析应用。系统内置「星野手作茶」三门店近 90 天订单、库存、日报数据与业务知识库（品类术语、指标口径）。

核心能力：

1. **总览驾驶舱**：KPI 环比、30 日 GMV 趋势、渠道环形图、门店 / 品类对比、时段热力  
2. **异常哨兵**：自动识别销量下滑、断货风险、优惠侵蚀、退款异常，证据链可核对  
3. **行动清单**：洞察落成今日可执行动作（补货、召回、限券等）  
4. **AI 参谋**：自然语言追问；深度分析由 **InfiniSynapse Agent** 执行，SSE 流式展示全过程  
5. **数据资产**：订单 / 库存 / 日报 / 知识库全量可查，即上传给 Agent 的资料  
6. **分析历史**：每次深度分析留档（结论、耗时、task_id），随时回看复用  
7. **账户体系**：游客可浏览全部非核心页面与本地速览问答；**调用 InfiniSynapse 的核心功能（深度分析 / 集成自检 API / 分析历史）必须登录**，触发时引导登录并在登录后自动继续；token 失效自动清理并回到游客态，状态始终一致

目标用户无需 SQL 或复杂 BI，即可完成「查数—归因—决策」全流程。

## 代码仓库

https://github.com/CHENG-32/shopmind

## InfiniSynapse API 集成说明

- **Base**：`https://app.infinisynapse.cn/api`  
- **鉴权**：服务端 `Authorization: Bearer <API Key>`（密钥仅服务端持有）  
- **主链路**：  
  - 启用数据源 / 知识库：`/ai_database/list|enabled`、`/ai_rag_sdk|enabled`  
  - SSE：`GET /ai/events?connId=`  
  - 任务：`POST /ai/message`（`type=newTask`）  
  - 上传：`POST /tools/taskUpload/:taskId`（orders.csv / inventory.csv / daily_summary.csv / knowledge_base.md）  
  - 消费 `completion_result`；`upload_file_to_sandbox` 时补传并 `askResponse` 继续  
- **流式强化**：`app/infinisynapse.py :: stream_analysis` 将 Agent 进度转为事件流，经 `POST /api/ask/stream` 实时推送前端  
- **业务接口**：`POST /api/ask`、`POST /api/ask/stream`（登录后调用，含 `task_id` 可核验）  
- **自检**：`GET /api/integration`（公开）、`POST /api/integration/check`（登录，真实调用）  
- **测试**：`tests/smoke_test.py`（含 `--deep` 真实 Agent 端到端）
