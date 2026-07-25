"""掌柜参谋 ShopMind · FastAPI 入口。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .analytics import build_briefing, build_dashboard, build_sentinels, load_demo_data
from .config import DATA_DIR, STATIC_DIR, get_settings
from .infinisynapse import InfiniSynapseClient, build_shopmind_prompt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("shopmind")

app = FastAPI(
    title="掌柜参谋 ShopMind",
    description="基于 InfiniSynapse 的小微商家经营数据分析应用",
    version="1.0.0",
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_DATA = None


def get_data():
    global _DATA
    if _DATA is None:
        _DATA = load_demo_data(DATA_DIR)
    return _DATA


class AskRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000, description="自然语言经营问题")
    use_infini: bool = Field(True, description="是否调用 InfiniSynapse Agent")
    timeout_sec: int | None = Field(None, ge=30, le=300)


class AskResponse(BaseModel):
    ok: bool
    source: str
    answer: str
    local_brief: str | None = None
    task_id: str | None = None
    elapsed_sec: float | None = None
    error: str | None = None
    integration: dict[str, Any] | None = None


@app.get("/", response_class=HTMLResponse)
def index():
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse("<h1>ShopMind</h1><p>static/index.html missing</p>")
    return FileResponse(index_path)


@app.get("/api/health")
def health():
    s = get_settings()
    return {
        "ok": True,
        "app": "ShopMind",
        "infinisynapse_configured": bool(s.infinisynapse_api_key),
        "base_url": s.infinisynapse_base_url,
    }


@app.get("/api/dashboard")
def api_dashboard():
    data = get_data()
    return build_dashboard(data)


@app.get("/api/sentinels")
def api_sentinels():
    data = get_data()
    return {"items": build_sentinels(data)}


@app.get("/api/briefing")
def api_briefing():
    data = get_data()
    return build_briefing(data)


@app.get("/api/integration")
def api_integration():
    """InfiniSynapse 集成状态与资源清单。"""
    s = get_settings()
    client = InfiniSynapseClient(s.infinisynapse_api_key, s.infinisynapse_base_url)
    try:
        ctx = client.prepare_context() if s.infinisynapse_api_key else {"databases": [], "rags": []}
        status = "ok"
        err = None
    except Exception as e:
        ctx = {"databases": [], "rags": []}
        status = "error"
        err = str(e)
    return {
        "product": "掌柜参谋 ShopMind",
        "integration": {
            "auth": "Authorization: Bearer <INFINISYNAPSE_API_KEY>（仅服务端）",
            "base_url": s.infinisynapse_base_url,
            "flow": [
                "GET /ai_database/list + POST /ai_database/enabled",
                "GET /ai_rag_sdk + POST /ai_rag_sdk/enabled",
                "GET /ai/events?connId=... (SSE)",
                "POST /ai/message type=newTask",
                "POST /tools/taskUpload/:taskId 上传经营 CSV/知识库",
                "消费 SSE completion_result 作为分析答复",
            ],
            "code_entry": "app/infinisynapse.py :: InfiniSynapseClient.run_analysis",
        },
        "resources": {
            "databases": [
                {
                    "name": d.get("name"),
                    "nickname": d.get("nickname"),
                    "type": d.get("type"),
                    "enabled": d.get("enabled"),
                }
                for d in (ctx.get("databases") or [])
            ],
            "rags": [
                {
                    "name": r.get("name"),
                    "nickname": r.get("nickname"),
                    "enabled": r.get("enabled"),
                }
                for r in (ctx.get("rags") or [])
            ],
        },
        "status": status,
        "error": err,
        "demo_data": [
            "orders.csv",
            "inventory.csv",
            "daily_summary.csv",
            "knowledge_base.md",
        ],
    }


@app.post("/api/ask", response_model=AskResponse)
def api_ask(body: AskRequest):
    data = get_data()
    briefing = build_briefing(data)
    local_md = briefing["markdown"]

    # 本地兜底答复
    local_answer = _local_answer(body.question, briefing)

    if not body.use_infini:
        return AskResponse(
            ok=True,
            source="local",
            answer=local_answer,
            local_brief=local_md,
        )

    s = get_settings()
    if not s.infinisynapse_api_key:
        return AskResponse(
            ok=True,
            source="local_fallback",
            answer=local_answer + "\n\n> 未配置 InfiniSynapse API Key，已使用本地经营引擎回答。",
            local_brief=local_md,
            error="missing api key",
        )

    client = InfiniSynapseClient(s.infinisynapse_api_key, s.infinisynapse_base_url)
    files = [
        DATA_DIR / "orders.csv",
        DATA_DIR / "inventory.csv",
        DATA_DIR / "daily_summary.csv",
        DATA_DIR / "knowledge_base.md",
    ]
    prompt = build_shopmind_prompt(body.question, local_md)
    timeout = body.timeout_sec or s.analysis_timeout_sec

    try:
        result = client.run_analysis(prompt, files=files, timeout_sec=timeout)
    except Exception as e:
        logger.exception("ask failed")
        return AskResponse(
            ok=True,
            source="local_fallback",
            answer=local_answer + f"\n\n> InfiniSynapse 调用异常：{e}，已回落本地分析。",
            local_brief=local_md,
            error=str(e),
        )

    if result.get("answer"):
        return AskResponse(
            ok=True,
            source="infinisynapse",
            answer=result["answer"],
            local_brief=local_md,
            task_id=result.get("task_id"),
            elapsed_sec=result.get("elapsed_sec"),
            integration={
                "conn_id": result.get("conn_id"),
                "events_count": result.get("events_count"),
                "uploaded": result.get("uploaded"),
                "context": result.get("context"),
            },
            error=result.get("error"),
        )

    # 远端无结果时回落
    return AskResponse(
        ok=True,
        source="local_fallback",
        answer=local_answer
        + "\n\n> InfiniSynapse 未在时限内返回完整结论，已展示本地经营引擎结果。可在 InfiniSynapse 平台任务日志中核验 API 调用。",
        local_brief=local_md,
        task_id=result.get("task_id"),
        elapsed_sec=result.get("elapsed_sec"),
        error=result.get("error") or "empty answer",
        integration={
            "conn_id": result.get("conn_id"),
            "events_count": result.get("events_count"),
            "context": result.get("context"),
        },
    )


def _local_answer(question: str, briefing: dict[str, Any]) -> str:
    q = question.lower()
    parts = [briefing["markdown"], "", "—— 基于本地经营引擎的结构化洞察 ——", ""]
    sentinels = briefing.get("sentinels") or []
    actions = briefing.get("actions") or []

    if any(k in question for k in ["库存", "断货", "补货", "缺货"]):
        stock = [s for s in sentinels if s["type"] == "stockout_risk"]
        if stock:
            parts.append("### 库存风险")
            for s in stock:
                parts.append(f"- **{s['title']}**：{s['summary']}")
                ev = s.get("evidence") or {}
                parts.append(
                    f"  - 证据：库存 {ev.get('stock_qty')} / 安全线 {ev.get('safety_stock')}，"
                    f"可售约 {ev.get('days_of_cover')} 天"
                )
        else:
            parts.append("当前未发现库存低于安全线的 SKU。")
    elif any(k in question for k in ["下滑", "下降", "差", "问题", "异常", "哨兵"]):
        parts.append("### 异常哨兵")
        for s in sentinels[:5]:
            parts.append(f"- **[{s['severity']}] {s['title']}**")
            parts.append(f"  - {s['summary']}")
    elif any(k in question for k in ["建议", "行动", "怎么办", "提升", "怎么做"]):
        parts.append("### 今日行动清单")
        for a in actions:
            parts.append(f"- **{a['title']}**：{a['detail']}（来源：{a['context']}）")
    else:
        parts.append("### 异常与行动摘要")
        for s in sentinels[:3]:
            parts.append(f"- {s['title']}")
        parts.append("")
        parts.append("### 建议行动")
        for a in actions[:3]:
            parts.append(f"- {a['title']}：{a['detail']}")

    parts.append("")
    parts.append(f"> 你的问题：{question}")
    parts.append("> 也可开启 InfiniSynapse 深度分析，由 Agent 结合上传数据与知识库作答。")
    return "\n".join(parts)


def create_app() -> FastAPI:
    return app


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("app.main:app", host=s.host, port=s.port, reload=False)
