# 报名 / 提交材料（复制即用）

## 应用名称

掌柜参谋 ShopMind

## 应用简介与使用场景

面向个体户与小微餐饮/茶饮门店的 AI 经营数据分析应用。系统预置「星野手作茶」三门店近 90 天订单、库存与日报数据，并附带业务知识库（品类术语、指标口径）。

核心能力：

1. **经营看板**：近 7 日 GMV / 订单 / 客单价 / 毛利及环比，30 日趋势，Top SKU 与门店渠道分布  
2. **异常哨兵**：自动识别销量下滑、断货风险、优惠力度抬升、退款异常  
3. **证据链**：每条异常展示计算公式与样本数据，避免“黑盒结论”  
4. **行动清单**：把洞察翻译成今日可执行动作（补货、召回、限券等）  
5. **自然语言分析**：服务端调用 InfiniSynapse Server API，上传经营文件后由 Agent 深度作答  

目标用户无需 SQL 或复杂 BI，即可完成「查数—归因—决策」全流程，符合比赛「泛数据分析」主题。

## 作品地址

（部署后填写，例如）

```
http://127.0.0.1:8080 （部署公网后替换）
```

本地验证：`http://127.0.0.1:8080`

## InfiniSynapse API 集成说明

- **Base**：`https://app.infinisynapse.cn/api`  
- **鉴权**：服务端 `Authorization: Bearer <API Key>`  
- **主链路**：  
  - 启用数据源/知识库：`/ai_database/*`、`/ai_rag_sdk/*`  
  - SSE：`GET /ai/events?connId=`  
  - 任务：`POST /ai/message`（`type=newTask`）  
  - 上传：`POST /tools/taskUpload/:taskId`  
- **实现文件**：`app/infinisynapse.py`  
- **自检接口**：`GET /api/integration`（返回当前账号可见数据源与集成步骤）  
- **业务接口**：`POST /api/ask`，`use_infini=true` 时走完整 Agent 流程，响应含 `task_id` 可供后台核验  

## 代码仓库地址（可选）

```
（如推送到 GitHub/Gitee，填写仓库 URL）
```

本地路径：`/home/dh/桌面/work/shopmind`

## 团队信息

- 可个人参赛；若组队在报名页填写成员与分工  

## 截图建议（自行补充）

1. 首页看板 + KPI  
2. 异常哨兵与证据链弹层  
3. InfiniSynapse 分析对话（带 taskId）


## 当前可访问地址

| 环境 | 地址 |
|------|------|
| 本机（已启动） | http://127.0.0.1:8080 |
| 启动命令 | `cd shopmind && python3 run.py` |
| 健康检查 | http://127.0.0.1:8080/api/health |
| 集成自检 | http://127.0.0.1:8080/api/integration |

> **提交前请部署到稳定公网**（云主机 / 容器 / 备案域名）。临时穿透在本机网络环境下不稳定，不建议作为最终提交 URL。

## 联调验证记录（开发机）

- 本地看板 / 哨兵 / 证据链：通过
- `POST /api/ask` `use_infini=false`：通过（本地引擎）
- `POST /api/ask` `use_infini=true`：通过，返回 `source=infinisynapse`，示例 taskId `1784987062063`
- InfiniSynapse 能读取上传的 orders/inventory 并给出生椰拿铁万达店补货建议
