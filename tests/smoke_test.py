#!/usr/bin/env python3
"""ShopMind 冒烟测试：公开接口 / 权限模型 / 认证流程。

用法：BASE=http://127.0.0.1:8080 python3 tests/smoke_test.py
深度分析端到端（真实 InfiniSynapse 调用，慢）用 --deep 开启。
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.getenv("BASE", "http://127.0.0.1:8080").rstrip("/")
DEEP = "--deep" in sys.argv

passed: list[str] = []
failed: list[str] = []


def req(method: str, path: str, body=None, token=None, raw=False):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            payload = resp.read()
            if raw:
                return resp.status, payload
            return resp.status, json.loads(payload.decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}


def check(name: str, cond: bool, extra: str = ""):
    if cond:
        passed.append(name)
        print(f"  ✔ {name}")
    else:
        failed.append(f"{name} {extra}")
        print(f"  ✘ {name} {extra}")


def main() -> int:
    print(f"BASE = {BASE}\n== 1. 公开接口 ==")
    st, j = req("GET", "/api/health")
    check("health", st == 200 and j.get("ok") and j.get("infinisynapse_configured"))

    st, j = req("GET", "/api/dashboard")
    check("dashboard", st == 200 and len(j.get("kpis", [])) == 4 and len(j.get("trend", [])) >= 30)
    check("dashboard.charts", bool(j.get("store_compare")) and bool(j.get("categories")) and 24 == len(j.get("hourly", [])))

    st, j = req("GET", "/api/sentinels")
    check("sentinels", st == 200 and len(j.get("items", [])) >= 1)

    st, j = req("GET", "/api/briefing")
    check("briefing", st == 200 and "markdown" in j and len(j.get("actions", [])) >= 1)

    st, j = req("GET", "/api/datasets")
    check("datasets.list", st == 200 and len(j.get("items", [])) == 4)
    st, j = req("GET", "/api/datasets/orders?page=1&size=10")
    check("datasets.orders", st == 200 and len(j.get("rows", [])) == 10 and j.get("total", 0) > 3000)
    st, j = req("GET", "/api/datasets/knowledge")
    check("datasets.knowledge", st == 200 and j.get("kind") == "markdown" and "星野" in j.get("content", ""))

    st, j = req("GET", "/api/integration")
    check("integration.public", st == 200 and len(j.get("integration", {}).get("flow", [])) == 6)

    print("\n== 2. 未登录拦截核心功能（401） ==")
    st, j = req("POST", "/api/ask", {"question": "最近哪家店下滑？", "use_infini": True})
    check("ask.deep.guest → 401", st == 401, f"got {st}")
    st, _ = req("POST", "/api/ask/stream", {"question": "x问题", "use_infini": True})
    check("ask.stream.guest → 401", st == 401, f"got {st}")
    st, _ = req("POST", "/api/integration/check")
    check("integration.check.guest → 401", st == 401, f"got {st}")
    st, _ = req("GET", "/api/history")
    check("history.guest → 401", st == 401, f"got {st}")

    print("\n== 3. 本地速览（游客可用） ==")
    st, j = req("POST", "/api/ask", {"question": "有哪些断货风险？", "use_infini": False})
    check("ask.quick.guest", st == 200 and j.get("source") == "local" and "库存" in j.get("answer", ""))

    print("\n== 4. 注册 / 登录 ==")
    email = f"smoke{int(time.time())}@example.com"
    st, j = req("POST", "/api/auth/register", {"name": "冒烟测试员", "email": email, "password": "pass1234"})
    check("register", st == 200 and j.get("token") and j.get("user", {}).get("email") == email, f"got {st} {j}")
    token = j.get("token", "")

    st, j = req("POST", "/api/auth/register", {"name": "重复注册", "email": email, "password": "pass1234"})
    check("register.duplicate → 409", st == 409, f"got {st}")
    st, j = req("POST", "/api/auth/register", {"name": "坏邮箱", "email": "not-an-email", "password": "pass1234"})
    check("register.bad_email → 400", st == 400, f"got {st}")

    st, j = req("POST", "/api/auth/login", {"email": email, "password": "wrong-pass"})
    check("login.wrong → 401", st == 401, f"got {st}")
    st, j = req("POST", "/api/auth/login", {"email": email, "password": "pass1234"})
    check("login", st == 200 and j.get("token"), f"got {st}")
    token = j.get("token", token)

    st, j = req("GET", "/api/auth/me", token=token)
    check("me", st == 200 and j.get("user", {}).get("name") == "冒烟测试员")
    st, j = req("GET", "/api/auth/me", token="bad.token")
    check("me.bad_token → user null", st == 200 and j.get("user") is None)

    print("\n== 5. 登录后的核心接口 ==")
    st, j = req("GET", "/api/history", token=token)
    check("history.empty", st == 200 and j.get("items") == [])

    print("== 5.1 集成自检（真实调用 InfiniSynapse /ai_database + /ai_rag_sdk） ==")
    st, j = req("POST", "/api/integration/check", token=token)
    check("integration.check", st == 200 and j.get("status") == "ok",
          f"got {st} {str(j)[:120]}")
    print(f"     databases={len(j.get('resources', {}).get('databases', []))} rags={len(j.get('resources', {}).get('rags', []))}")

    if DEEP:
        print("\n== 6. 深度分析端到端（SSE 流式，真实 Agent，可能耗时数分钟） ==")
        status, raw = req("POST", "/api/ask/stream",
                          {"question": "最近一周经营情况怎么样？给出异常与行动建议", "use_infini": True, "timeout_sec": 240},
                          token=token, raw=True)
        text = raw.decode("utf-8")
        stages = text.count("event: stage")
        has_done = "event: done" in text
        ok_answer = '"ok": true' in text and '"answer": ""' not in text
        check("stream.sse", status == 200 and has_done and stages >= 3, f"stages={stages} done={has_done}")
        check("stream.answer", ok_answer)

        st, j = req("GET", "/api/history", token=token)
        check("history.saved", st == 200 and len(j.get("items", [])) >= 1)
        if j.get("items"):
            hid = j["items"][0]["id"]
            st, j2 = req("GET", f"/api/history/{hid}", token=token)
            check("history.detail", st == 200 and len(j2.get("answer", "")) > 30)
            st, j2 = req("GET", f"/api/history/{hid}")  # 无 token
            check("history.detail.guest → 401", st == 401)

    print("\n== 7. 静态资源 ==")
    st, raw = req("GET", "/", raw=True)
    check("index.html", st == 200 and b"ShopMind" in raw)
    for asset in ["/static/app.js", "/static/styles.css", "/static/charts.js"]:
        st, raw = req("GET", asset, raw=True)
        check(f"asset {asset}", st == 200 and len(raw) > 5000)

    print(f"\n{'=' * 40}\n通过 {len(passed)} · 失败 {len(failed)}")
    for f in failed:
        print("  FAIL:", f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
