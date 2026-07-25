#!/usr/bin/env python3
"""启动掌柜参谋 ShopMind。"""
from __future__ import annotations

import uvicorn

from app.config import get_settings


def main() -> None:
    s = get_settings()
    print(f"ShopMind starting on http://{s.host}:{s.port}")
    print(f"InfiniSynapse: {'configured' if s.infinisynapse_api_key else 'MISSING KEY'}")
    uvicorn.run("app.main:app", host=s.host, port=s.port, reload=False)


if __name__ == "__main__":
    main()
