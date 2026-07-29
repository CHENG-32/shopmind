"""掌柜参谋 ShopMind · FastAPI 入口。

权限模型：
- 游客可浏览全部非核心页面/接口（看板、哨兵、行动、数据资产、本地速览问答）
- 核心功能（调用 InfiniSynapse 的深度分析、集成自检、分析历史）必须登录
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth as auth_mod
from . import db
from .analytics import (
    build_briefing,
    build_dashboard,
    build_sentinels,
    dataset_profile,
    list_datasets,
    load_demo_data,
    preview_dataset,
)
from .config import DATA_DIR, STATIC_DIR, get_settings
from .infinisynapse import InfiniSynapseClient, build_shopmind_prompt, stream_analysis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("shopmind")

app = FastAPI(
    title="掌柜参谋 ShopMind",
    description="基于 InfiniSynapse 的小微商家经营数据分析应用",
    version="2.0.0",
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 持久化初始化
db.init_db(DATA_DIR / "users.db")
auth_mod.init_auth(DATA_DIR / ".secret_key")

_DATA = None


def get_data():
    global _DATA
    if _DATA is None:
        _DATA = load_demo_data(DATA_DIR)
    return _DATA


# --------------------------- schemas ---------------------------

class AskRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000, description="自然语言经营问题")
    use_infini: bool = Field(True, description="是否调用 InfiniSynapse Agent（需登录）")
    timeout_sec: int | None = Field(None, ge=30, le=1200)


class AskResponse(BaseModel):
    ok: bool
    source: str
    answer: str
    local_brief: str | None = None
    task_id: str | None = None
    elapsed_sec: float | None = None
    error: str | None = None
    integration: dict[str, Any] | None = None
    history_id: str | None = None


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=24)
    email: str = Field(..., min_length=5, max_length=120)
    password: str = Field(..., min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: str
    password: str


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _token_payload(user: dict[str, Any]) -> dict[str, Any]:
    return {"user": db.public_user(db.get_user_by_id(user["id"]) or user), "token": auth_mod.issue_token(user)}


# --------------------------- pages ---------------------------

@app.get("/", response_class=HTMLResponse)
def index():
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse("<h1>ShopMind</h1><p>static/index.html missing</p>")
    return FileResponse(index_path)


# --------------------------- auth ---------------------------

@app.post("/api/auth/register")
def api_register(body: RegisterRequest):
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    name = body.name.strip()
    if db.get_user_by_email(email):
        raise HTTPException(409, "该邮箱已注册，请直接登录")
    pass_hash, salt = auth_mod.hash_password(body.password)
    user = db.create_user(name, email, pass_hash, salt)
    logger.info("user registered: %s", email)
    return _token_payload(user)


@app.post("/api/auth/login")
def api_login(body: LoginRequest):
    user = db.get_user_by_email(body.email.strip().lower())
    if not user or not auth_mod.verify_password(body.password, user["salt"], user["pass_hash"]):
        raise HTTPException(401, "邮箱或密码不正确")
    return _token_payload(user)


@app.get("/api/auth/me")
def api_me(user: dict[str, Any] | None = Depends(auth_mod.current_user)):
    return {"user": user}


# --------------------------- public business APIs ---------------------------

@app.get("/api/health")
def health():
    s = get_settings()
    return {
        "ok": True,
        "app": "ShopMind",
        "version": app.version,
        "infinisynapse_configured": bool(s.infinisynapse_api_key),
        "base_url": s.infinisynapse_base_url,
        "auth_required_for": ["deep_analysis", "integration_check", "history"],
    }


@app.get("/api/dashboard")
def api_dashboard():
    return build_dashboard(get_data())


@app.get("/api/sentinels")
def api_sentinels():
    return {"items": build_sentinels(get_data())}


@app.get("/api/briefing")
def api_briefing():
    return build_briefing(get_data())


@app.get("/api/datasets")
def api_datasets():
    return {"items": list_datasets(DATA_DIR)}


@app.get("/api/datasets/{key}")
def api_dataset_preview(key: str, page: int = 1, size: int = 15):
    try:
        return preview_dataset(key, page=page, size=size, data_dir=DATA_DIR)
    except KeyError:
        raise HTTPException(404, "未知数据集")


@app.get("/api/datasets/{key}/profile")
def api_dataset_profile(key: str):
    try:
        return dataset_profile(key, data_dir=DATA_DIR)
    except KeyError:
        raise HTTPException(404, "该数据集不支持画像")


# --------------------------- InfiniSynapse integration ---------------------------

_INTEGRATION_FLOW = [
    "GET /ai_database/list + POST /ai_database/enabled  启用数据源",
    "GET /ai_rag_sdk + POST /ai_rag_sdk/enabled  启用知识库",
    "GET /ai/events?connId=...  建立 SSE 事件通道",
    "POST /ai/message  type=newTask  创建分析任务",
    "POST /tools/taskUpload/:taskId  上传经营 CSV / 知识库",
    "消费 SSE completion_result，流式回传分析结论",
]


@app.get("/api/integration")
def api_integration():
    """集成说明（静态清单，不消耗 InfiniSynapse 调用，游客可看）。"""
    s = get_settings()
    return {
        "product": "掌柜参谋 ShopMind",
        "configured": bool(s.infinisynapse_api_key),
        "integration": {
            "auth": "Authorization: Bearer <INFINISYNAPSE_API_KEY>（仅服务端）",
            "base_url": s.infinisynapse_base_url,
            "flow": _INTEGRATION_FLOW,
            "code_entry": "app/infinisynapse.py :: InfiniSynapseClient.run_analysis",
            "live_check": "POST /api/integration/check（需登录，真实调用 InfiniSynapse）",
        },
        "demo_data": ["orders.csv", "inventory.csv", "daily_summary.csv", "knowledge_base.md"],
    }


@app.post("/api/integration/check")
def api_integration_check(user: dict[str, Any] = Depends(auth_mod.require_user)):
    """真实调用 InfiniSynapse：列出并启用数据源 / 知识库（核心功能，需登录）。"""
    s = get_settings()
    if not s.infinisynapse_api_key:
        raise HTTPException(503, "未配置 INFINISYNAPSE_API_KEY")
    client = InfiniSynapseClient(s.infinisynapse_api_key, s.infinisynapse_base_url)
    try:
        ctx = client.prepare_context()
    except Exception as e:
        logger.exception("integration check failed")
        return {
            "status": "error",
            "error": str(e),
            "by": user["email"],
            "resources": {"databases": [], "rags": []},
        }
    return {
        "status": "ok",
        "by": user["email"],
        "resources": {
            "databases": ctx.get("databases", []),
            "rags": ctx.get("rags", []),
        },
    }


# --------------------------- ask (core) ---------------------------

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
    parts.append("> 登录后可开启 InfiniSynapse 深度分析，由 Agent 结合全量数据与知识库作答。")
    return "\n".join(parts)


def _infini_files() -> list[Path]:
    return [
        DATA_DIR / "orders.csv",
        DATA_DIR / "inventory.csv",
        DATA_DIR / "daily_summary.csv",
        DATA_DIR / "knowledge_base.md",
    ]


def _make_client() -> InfiniSynapseClient:
    s = get_settings()
    if not s.infinisynapse_api_key:
        raise HTTPException(503, "服务端未配置 INFINISYNAPSE_API_KEY")
    return InfiniSynapseClient(s.infinisynapse_api_key, s.infinisynapse_base_url)


@app.post("/api/ask", response_model=AskResponse)
def api_ask(body: AskRequest, user: dict[str, Any] | None = Depends(auth_mod.current_user)):
    data = get_data()
    briefing = build_briefing(data)
    local_md = briefing["markdown"]
    local_answer = _local_answer(body.question, briefing)

    if not body.use_infini:
        # 本地速览：非核心，游客可用
        return AskResponse(ok=True, source="local", answer=local_answer, local_brief=local_md)

    # ---- 核心功能：调用 InfiniSynapse，必须登录 ----
    if not user:
        raise HTTPException(
            status_code=401,
            detail={"code": "auth_required", "message": "深度分析将调用 InfiniSynapse Agent，请先登录"},
        )

    client = _make_client()
    s = get_settings()
    prompt = build_shopmind_prompt(body.question, local_md)
    timeout = body.timeout_sec or s.analysis_timeout_sec

    try:
        result = client.run_analysis(prompt, files=_infini_files(), timeout_sec=timeout)
    except Exception as e:
        logger.exception("ask failed")
        return AskResponse(
            ok=True,
            source="local_fallback",
            answer=local_answer + f"\n\n> InfiniSynapse 调用异常：{e}，已回落本地分析。",
            local_brief=local_md,
            error=str(e),
        )

    history_id = None
    base = {
        "local_brief": local_md,
        "task_id": result.get("task_id"),
        "elapsed_sec": result.get("elapsed_sec"),
        "integration": {
            "conn_id": result.get("conn_id"),
            "events_count": result.get("events_count"),
            "uploaded": result.get("uploaded"),
            "context": result.get("context"),
        },
    }

    if result.get("answer"):
        saved = db.save_analysis(
            user["id"], body.question, result["answer"], "infinisynapse",
            task_id=result.get("task_id"), elapsed_sec=result.get("elapsed_sec"),
        )
        history_id = saved["id"]
        return AskResponse(ok=True, source="infinisynapse", answer=result["answer"],
                           history_id=history_id, error=result.get("error"), **base)

    return AskResponse(
        ok=True,
        source="local_fallback",
        answer=local_answer
        + "\n\n> InfiniSynapse 未在时限内返回完整结论，已展示本地经营引擎结果。可在平台任务日志中核验 API 调用。",
        error=result.get("error") or "empty answer",
        **base,
    )


@app.post("/api/ask/stream")
def api_ask_stream(body: AskRequest, user: dict[str, Any] = Depends(auth_mod.require_user)):
    """核心功能：SSE 流式深度分析（实时推送 InfiniSynapse 进度与结论）。"""
    data = get_data()
    briefing = build_briefing(data)
    prompt = build_shopmind_prompt(body.question, briefing["markdown"])
    s = get_settings()
    timeout = body.timeout_sec or s.analysis_timeout_sec

    try:
        client = _make_client()
    except HTTPException as e:
        def err_gen():
            yield f"event: stage\ndata: {json.dumps({'stage': 'error', 'text': str(e.detail)})}\n\n"
            yield f"event: done\ndata: {json.dumps({'ok': False, 'error': str(e.detail), 'answer': ''})}\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")

    uid = user["id"]

    def gen():
        final: dict[str, Any] = {}
        for kind, payload in stream_analysis(client, prompt, files=_infini_files(), timeout_sec=timeout):
            if kind == "done":
                final = payload
                if payload.get("answer"):
                    saved = db.save_analysis(
                        uid, body.question, payload["answer"], "infinisynapse",
                        task_id=payload.get("task_id"), elapsed_sec=payload.get("elapsed_sec"),
                    )
                    payload["history_id"] = saved["id"]
                payload.pop("context", None)
                yield f"event: done\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            else:
                yield f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --------------------------- history (login required) ---------------------------

@app.get("/api/history")
def api_history(user: dict[str, Any] = Depends(auth_mod.require_user)):
    return {
        "items": db.list_analyses(user["id"]),
        "total": db.count_analyses(user["id"]),
    }


@app.get("/api/history/{analysis_id}")
def api_history_detail(analysis_id: str, user: dict[str, Any] = Depends(auth_mod.require_user)):
    item = db.get_analysis(user["id"], analysis_id)
    if not item:
        raise HTTPException(404, "记录不存在")
    return item


def create_app() -> FastAPI:
    return app


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("app.main:app", host=s.host, port=s.port, reload=False)
