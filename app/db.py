"""SQLite 持久化：用户账户与 AI 深度分析历史。

使用标准库 sqlite3，零额外依赖。数据文件默认放在 data/users.db。
"""
from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

_DB_PATH: Path | None = None
_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source TEXT NOT NULL,
    task_id TEXT,
    elapsed_sec REAL,
    created_at REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id, created_at DESC);
"""


def init_db(path: Path) -> None:
    global _DB_PATH
    _DB_PATH = path
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def _connect() -> sqlite3.Connection:
    if _DB_PATH is None:
        raise RuntimeError("db not initialised")
    conn = sqlite3.connect(str(_DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ---------------- users ----------------

def create_user(name: str, email: str, pass_hash: str, salt: str) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:12]
    now = time.time()
    with _LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO users (id, name, email, pass_hash, salt, created_at) VALUES (?,?,?,?,?,?)",
            (uid, name, email.lower(), pass_hash, salt, now),
        )
    return {"id": uid, "name": name, "email": email.lower(), "created_at": now}


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with _LOCK, _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
    return dict(row) if row else None


def get_user_by_id(uid: str) -> dict[str, Any] | None:
    with _LOCK, _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return dict(row) if row else None


def public_user(u: dict[str, Any]) -> dict[str, Any]:
    return {"id": u["id"], "name": u["name"], "email": u["email"]}


# ---------------- analysis history ----------------

def save_analysis(
    user_id: str,
    question: str,
    answer: str,
    source: str,
    task_id: str | None = None,
    elapsed_sec: float | None = None,
) -> dict[str, Any]:
    aid = uuid.uuid4().hex[:12]
    now = time.time()
    with _LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO analyses (id, user_id, question, answer, source, task_id, elapsed_sec, created_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (aid, user_id, question, answer, source, task_id, elapsed_sec, now),
        )
    return {"id": aid, "created_at": now}


def list_analyses(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with _LOCK, _connect() as conn:
        rows = conn.execute(
            "SELECT id, question, source, task_id, elapsed_sec, created_at,"
            " substr(answer, 1, 220) AS excerpt FROM analyses"
            " WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_analysis(user_id: str, analysis_id: str) -> dict[str, Any] | None:
    with _LOCK, _connect() as conn:
        row = conn.execute(
            "SELECT * FROM analyses WHERE id = ? AND user_id = ?",
            (analysis_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def count_analyses(user_id: str) -> int:
    with _LOCK, _connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM analyses WHERE user_id = ?", (user_id,)
        ).fetchone()
    return int(row["c"]) if row else 0
