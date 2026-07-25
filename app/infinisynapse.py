"""InfiniSynapse Server API 客户端。

对接文档（Vibe Coding Guide / Server API Reference）：
- Base: https://app.infinisynapse.cn/api
- Auth: Authorization: Bearer <API Key>
- 主流程: SSE /ai/events + POST /ai/message (newTask)
- 资料: POST /tools/taskUpload/:taskId
- 数据源: /ai_database/*  知识库: /ai_rag_sdk/*
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import httpx

logger = logging.getLogger("shopmind.infinisynapse")


class InfiniSynapseClient:
    def __init__(self, api_key: str, base_url: str = "https://app.infinisynapse.cn/api"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "x-lang": "zh_CN",
        }

    def _client(self, timeout: float = 60.0) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers=self._headers,
            timeout=timeout,
            follow_redirects=True,
        )

    def list_databases(self) -> list[dict[str, Any]]:
        with self._client() as c:
            r = c.get(
                "/ai_database/list",
                params={"page": 1, "pageSize": 50, "source": "all"},
            )
            r.raise_for_status()
            data = r.json()
            return (data.get("data") or {}).get("items") or []

    def enable_databases(self, ids: list[str], enabled: int = 1) -> dict[str, Any]:
        if not ids:
            return {}
        with self._client() as c:
            r = c.post("/ai_database/enabled", json={"ids": ids, "enabled": enabled})
            r.raise_for_status()
            return r.json()

    def list_rags(self) -> list[dict[str, Any]]:
        with self._client() as c:
            r = c.get(
                "/ai_rag_sdk",
                params={"page": 1, "pageSize": 50, "source": "all"},
            )
            r.raise_for_status()
            data = r.json()
            return (data.get("data") or {}).get("items") or []

    def enable_rags(self, ids: list[str], enabled: int = 1) -> dict[str, Any]:
        if not ids:
            return {}
        with self._client() as c:
            r = c.post("/ai_rag_sdk/enabled", json={"ids": ids, "enabled": enabled})
            r.raise_for_status()
            return r.json()

    def prepare_context(self) -> dict[str, Any]:
        """newTask 前启用可用数据源/知识库（官方要求）。"""
        dbs = self.list_databases()
        rags = self.list_rags()
        db_ids = [d["id"] for d in dbs if d.get("id")]
        rag_ids = [r["id"] for r in rags if r.get("id")]
        if db_ids:
            self.enable_databases(db_ids, 1)
        if rag_ids:
            self.enable_rags(rag_ids, 1)
        return {
            "databases": [
                {
                    "id": d.get("id"),
                    "name": d.get("name"),
                    "nickname": d.get("nickname"),
                    "type": d.get("type"),
                    "enabled": d.get("enabled"),
                }
                for d in dbs
            ],
            "rags": [
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "nickname": r.get("nickname"),
                    "enabled": r.get("enabled"),
                }
                for r in rags
            ],
        }

    def upload_task_files(
        self,
        task_id: str,
        files: list[Path],
        subdir: str = "upload_documents",
    ) -> list[dict[str, Any]]:
        results = []
        with self._client(timeout=120.0) as c:
            for fp in files:
                if not fp.exists():
                    continue
                with fp.open("rb") as f:
                    r = c.post(
                        f"/tools/taskUpload/{task_id}",
                        params={"subdir": subdir, "naming": "original"},
                        files={"file": (fp.name, f, "application/octet-stream")},
                    )
                results.append(
                    {
                        "file": fp.name,
                        "status": r.status_code,
                        "body": _safe_json(r),
                    }
                )
        return results

    def run_analysis(
        self,
        prompt: str,
        files: list[Path] | None = None,
        timeout_sec: int = 180,
        on_event: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        """完整分析：准备资源 → SSE → newTask → 上传文件 → 收集 completion。"""
        if not self.api_key:
            return {
                "ok": False,
                "error": "未配置 INFINISYNAPSE_API_KEY",
                "answer": "",
                "task_id": None,
            }

        context = self.prepare_context()
        conn_id = str(uuid.uuid4())
        task_id: str | None = None
        answer_parts: list[str] = []
        final_answer = ""
        events_count = 0
        uploaded = False
        error: str | None = None
        started = time.time()

        files = files or []

        try:
            with self._client(timeout=timeout_sec + 30) as c:
                # 1) 打开 SSE
                with c.stream(
                    "GET",
                    "/ai/events",
                    params={"connId": conn_id},
                    headers={**self._headers, "Accept": "text/event-stream"},
                ) as sse:
                    # 2) 发送 newTask
                    body = {
                        "type": "newTask",
                        "connId": conn_id,
                        "text": prompt,
                        "chatSettings": {"mode": "act"},
                        "autoApprovalSettings": {
                            "enableAutoApproval": True,
                            "enableNotifications": True,
                            "enableWebSearch": False,
                            "enableBrowser": False,
                        },
                    }
                    msg = c.post(
                        "/ai/message",
                        headers={**self._headers, "Content-Type": "application/json"},
                        json=body,
                    )
                    if msg.status_code not in (200, 201):
                        return {
                            "ok": False,
                            "error": f"newTask failed: {msg.status_code} {msg.text[:300]}",
                            "answer": "",
                            "task_id": None,
                            "context": context,
                            "conn_id": conn_id,
                        }

                    event_name = None
                    data_buf: list[str] = []

                    for line in sse.iter_lines():
                        if time.time() - started > timeout_sec:
                            error = f"分析超时（>{timeout_sec}s）"
                            break
                        if line is None:
                            continue
                        if line.startswith("event:"):
                            event_name = line[6:].strip()
                            continue
                        if line.startswith("data:"):
                            data_buf.append(line[5:].lstrip())
                            continue
                        if line != "":
                            continue

                        # empty line → dispatch
                        if not event_name or not data_buf:
                            event_name = None
                            data_buf = []
                            continue

                        raw = "\n".join(data_buf)
                        data_buf = []
                        events_count += 1
                        try:
                            payload = json.loads(raw) if raw not in ("ping",) else {"raw": raw}
                        except json.JSONDecodeError:
                            payload = {"raw": raw}

                        if on_event:
                            try:
                                on_event(event_name, payload if isinstance(payload, dict) else {})
                            except Exception:
                                pass

                        if isinstance(payload, dict) and payload.get("taskId"):
                            task_id = str(payload["taskId"])

                        # 拿到 taskId 后立刻上传经营数据
                        if task_id and files and not uploaded:
                            uploaded = True
                            try:
                                self.upload_task_files(task_id, files)
                            except Exception as e:
                                logger.exception("upload failed")
                                error = f"文件上传失败: {e}"

                        msg_obj = payload.get("message") if isinstance(payload, dict) else None
                        if isinstance(msg_obj, dict):
                            say = msg_obj.get("say")
                            text = msg_obj.get("text") or ""
                            partial = bool(msg_obj.get("partial"))
                            if say == "completion_result" and text:
                                if partial:
                                    answer_parts.append(text)
                                else:
                                    final_answer = text
                            # 部分场景最终文本在 say=text 且较长
                            if say == "text" and text and len(text) > 80 and "task>" not in text:
                                # 保留候选
                                if not final_answer:
                                    answer_parts.append(text)

                            ask = msg_obj.get("ask")
                            if ask == "upload_file_to_sandbox" and task_id and files:
                                try:
                                    self.upload_task_files(task_id, files)
                                    # 告知 agent 已上传
                                    c.post(
                                        "/ai/message",
                                        headers={
                                            **self._headers,
                                            "Content-Type": "application/json",
                                        },
                                        json={
                                            "type": "askResponse",
                                            "askResponse": "messageResponse",
                                            "taskId": task_id,
                                            "text": "已上传 orders.csv / inventory.csv / daily_summary.csv / knowledge_base.md 到 upload_documents，请继续分析。",
                                            "connId": conn_id,
                                        },
                                    )
                                except Exception as e:
                                    logger.exception("ask upload handle failed: %s", e)

                        if event_name == "notification" and isinstance(payload, dict):
                            title = str(payload.get("title") or "")
                            if "Completed" in title or "完成" in title:
                                if not final_answer and answer_parts:
                                    final_answer = max(answer_parts, key=len)
                                break

                        if final_answer and not (
                            isinstance(msg_obj, dict) and msg_obj.get("partial")
                        ):
                            # 再等一小段看是否有更完整结果；这里直接结束以控制时延
                            if say == "completion_result":
                                break

                        event_name = None

        except httpx.HTTPError as e:
            error = f"HTTP 错误: {e}"
            logger.exception("run_analysis http error")
        except Exception as e:
            error = f"分析异常: {e}"
            logger.exception("run_analysis error")

        if not final_answer and answer_parts:
            final_answer = max(answer_parts, key=len)

        ok = bool(final_answer) and not (error and not final_answer)
        return {
            "ok": ok or bool(final_answer),
            "answer": final_answer,
            "task_id": task_id,
            "conn_id": conn_id,
            "events_count": events_count,
            "elapsed_sec": round(time.time() - started, 1),
            "context": context,
            "error": error,
            "uploaded": uploaded,
        }


def _safe_json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except Exception:
        return r.text[:300]


def build_shopmind_prompt(user_question: str, local_brief: str) -> str:
    return f"""你是「掌柜参谋 ShopMind」的 AI 经营分析师，服务对象是不会写 SQL 的小微餐饮老板。

【本地已计算的经营简报（可作参考，请结合上传数据核验或深化）】
{local_brief}

【数据位置】
任务工作区 upload_documents/ 下有：
- orders.csv：近约 90 天订单明细（门店/SKU/渠道/会员/实付/成本/是否退款）
- inventory.csv：当前库存与安全库存
- daily_summary.csv：日报汇总
- knowledge_base.md：业务术语与指标口径（星野手作茶）

【用户问题】
{user_question}

【输出要求】
1. 用中文，面向老板，少用黑话；必要时解释指标。
2. 结论必须尽量带「证据」：涉及的门店/SKU/时间范围/关键数字。
3. 最后给出 2～4 条今天可执行的行动建议。
4. 不要输出大段代码；如需计算请直接给结果。
5. 若文件尚未可见，先查看工作区再分析。
"""
