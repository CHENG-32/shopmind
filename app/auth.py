"""账户认证：scrypt 密码哈希 + HMAC-SHA256 签名令牌（无第三方依赖）。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import Depends, Header, HTTPException

from . import db

TOKEN_TTL_SEC = 7 * 24 * 3600  # 7 天
_SECRET_FILE: Path | None = None
_secret: bytes | None = None


def init_auth(secret_file: Path) -> None:
    """加载（或在首次启动时生成）服务端签名密钥。"""
    global _SECRET_FILE, _secret
    _SECRET_FILE = secret_file
    if secret_file.exists():
        _secret = bytes.fromhex(secret_file.read_text().strip())
    else:
        _secret = secrets.token_bytes(32)
        secret_file.write_text(_secret.hex())
        try:
            secret_file.chmod(0o600)
        except OSError:
            pass


# ---------------- password ----------------

def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return digest.hex(), salt.hex()


def verify_password(password: str, salt_hex: str, expect_hex: str) -> bool:
    digest, _ = hash_password(password, salt_hex)
    return hmac.compare_digest(digest, expect_hex)


# ---------------- token ----------------

def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def issue_token(user: dict[str, Any]) -> str:
    payload = {
        "uid": user["id"],
        "name": user["name"],
        "exp": int(time.time()) + TOKEN_TTL_SEC,
    }
    raw = _b64u(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    sig = hmac.new(_secret, raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def parse_token(token: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    raw, sig = token.rsplit(".", 1)
    expect = hmac.new(_secret, raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        payload = json.loads(_b64u_decode(raw))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    return payload


# ---------------- fastapi deps ----------------

def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any] | None:
    """可选登录：返回用户公共信息或 None。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    payload = parse_token(authorization.split(None, 1)[1].strip())
    if not payload:
        return None
    user = db.get_user_by_id(payload["uid"])
    return db.public_user(user) if user else None


def require_user(user: dict[str, Any] | None = Depends(current_user)) -> dict[str, Any]:
    """强制登录：核心功能（调用 InfiniSynapse）先过这道门。"""
    if not user:
        raise HTTPException(
            status_code=401,
            detail={"code": "auth_required", "message": "该功能将调用 InfiniSynapse 深度分析，请先登录"},
        )
    return user
