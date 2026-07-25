# 掌柜参谋 ShopMind · 作品说明

## 应用名称

掌柜参谋 ShopMind

## 应用简介与使用场景

面向个体户与小微餐饮 / 茶饮门店的 AI 经营数据分析应用。系统内置「星野手作茶」三门店近 90 天订单、库存与日报数据，并附带业务知识库（品类术语、指标口径）。

核心能力：

1. **经营看板**：近 7 日 GMV / 订单 / 客单价 / 毛利及环比，30 日趋势，Top SKU 与门店渠道分布  
2. **异常哨兵**：自动识别销量下滑、断货风险、优惠力度抬升、退款异常  
3. **证据链**：每条异常展示计算口径与样本数据  
4. **行动清单**：将洞察落成今日可执行动作（补货、召回、限券等）  
5. **自然语言分析**：服务端调用 InfiniSynapse Server API，上传经营文件后由 Agent 作答  

目标用户无需 SQL 或复杂 BI，即可完成「查数—归因—决策」全流程。

## 代码仓库

https://github.com/CHENG-32/shopmind

## InfiniSynapse API 集成说明

- **Base**：`https://app.infinisynapse.cn/api`  
- **鉴权**：服务端 `Authorization: Bearer <API Key>`  
- **主链路**：  
  - 启用数据源 / 知识库：`/ai_database/*`、`/ai_rag_sdk/*`  
  - SSE：`GET /ai/events?connId=`  
  - 任务：`POST /ai/message`（`type=newTask`）  
  - 上传：`POST /tools/taskUpload/:taskId`  
- **实现**：`app/infinisynapse.py`  
- **自检**：`GET /api/integration`  
- **业务**：`POST /api/ask`（`use_infini=true` 走完整 Agent 流程，响应含 `task_id`）  
