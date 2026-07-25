"""本地经营分析：看板、异常哨兵、证据链、行动卡片。

即时可演示，不依赖远端时延；自然语言深度分析走 InfiniSynapse。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from .config import DATA_DIR


def _pct(curr: float, prev: float) -> float | None:
    if prev == 0:
        return None if curr == 0 else 100.0
    return round((curr - prev) / abs(prev) * 100, 1)


@dataclass
class ShopData:
    orders: pd.DataFrame
    inventory: pd.DataFrame
    daily: pd.DataFrame
    knowledge: str

def load_demo_data(data_dir: Path | None = None) -> ShopData:
    root = data_dir or DATA_DIR
    orders = pd.read_csv(root / "orders.csv")
    inventory = pd.read_csv(root / "inventory.csv")
    daily = pd.read_csv(root / "daily_summary.csv")
    knowledge = (root / "knowledge_base.md").read_text(encoding="utf-8")

    orders["order_time"] = pd.to_datetime(orders["order_time"])
    orders["biz_date"] = orders["order_time"].dt.date.astype(str)
    daily["biz_date"] = daily["biz_date"].astype(str)
    # 有效成交（非退款）
    orders["is_refund"] = orders["is_refund"].astype(int)
    return ShopData(orders=orders, inventory=inventory, daily=daily, knowledge=knowledge)


def _valid_orders(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["is_refund"] == 0].copy()


def period_metrics(orders: pd.DataFrame) -> dict[str, float]:
    if orders.empty:
        return {
            "gmv": 0.0,
            "orders": 0,
            "qty": 0,
            "cost": 0.0,
            "discount": 0.0,
            "gross_profit": 0.0,
            "aov": 0.0,
            "refunds": 0,
        }
    gmv = float(orders["pay_amount"].sum())
    cost = float(orders["cost_amount"].sum())
    n = int(len(orders))
    return {
        "gmv": round(gmv, 2),
        "orders": n,
        "qty": int(orders["quantity"].sum()),
        "cost": round(cost, 2),
        "discount": round(float(orders["discount_amount"].sum()), 2),
        "gross_profit": round(gmv - cost, 2),
        "aov": round(gmv / n, 2) if n else 0.0,
        "refunds": 0,
    }


def build_dashboard(data: ShopData) -> dict[str, Any]:
    orders = _valid_orders(data.orders)
    max_date = pd.to_datetime(orders["biz_date"]).max()
    last7_start = (max_date - pd.Timedelta(days=6)).date().isoformat()
    prev7_start = (max_date - pd.Timedelta(days=13)).date().isoformat()
    prev7_end = (max_date - pd.Timedelta(days=7)).date().isoformat()
    max_s = max_date.date().isoformat()

    cur = orders[(orders["biz_date"] >= last7_start) & (orders["biz_date"] <= max_s)]
    prev = orders[(orders["biz_date"] >= prev7_start) & (orders["biz_date"] <= prev7_end)]
    cur_m = period_metrics(cur)
    prev_m = period_metrics(prev)

    # 日趋势（最近 30 天）
    daily = data.daily.sort_values("biz_date")
    daily_tail = daily.tail(30)
    trend = [
        {
            "date": r.biz_date,
            "gmv": float(r.gmv),
            "orders": int(r.order_count),
            "aov": float(r.aov),
            "gross_profit": float(r.gross_profit),
        }
        for r in daily_tail.itertuples()
    ]

    # Top SKU last 7d
    sku = (
        cur.groupby(["sku_name", "category"], as_index=False)
        .agg(gmv=("pay_amount", "sum"), qty=("quantity", "sum"), orders=("order_id", "count"))
        .sort_values("gmv", ascending=False)
    )
    top_skus = [
        {
            "sku": r.sku_name,
            "category": r.category,
            "gmv": round(float(r.gmv), 2),
            "qty": int(r.qty),
            "orders": int(r.orders),
        }
        for r in sku.head(8).itertuples()
    ]

    # store split
    store = (
        cur.groupby("store_name", as_index=False)
        .agg(gmv=("pay_amount", "sum"), orders=("order_id", "count"))
        .sort_values("gmv", ascending=False)
    )
    stores = [
        {"store": r.store_name, "gmv": round(float(r.gmv), 2), "orders": int(r.orders)}
        for r in store.itertuples()
    ]

    # channel
    ch = (
        cur.groupby("channel", as_index=False)
        .agg(gmv=("pay_amount", "sum"), orders=("order_id", "count"))
        .sort_values("gmv", ascending=False)
    )
    channels = [
        {"channel": r.channel, "gmv": round(float(r.gmv), 2), "orders": int(r.orders)}
        for r in ch.itertuples()
    ]

    kpis = []
    for key, label, unit in [
        ("gmv", "近7日 GMV", "¥"),
        ("orders", "近7日订单", ""),
        ("aov", "客单价", "¥"),
        ("gross_profit", "毛利粗算", "¥"),
    ]:
        c = cur_m[key]
        p = prev_m[key]
        kpis.append(
            {
                "key": key,
                "label": label,
                "value": c,
                "prev": p,
                "change_pct": _pct(float(c), float(p)),
                "unit": unit,
            }
        )

    return {
        "brand": "星野手作茶",
        "period": {
            "current": f"{last7_start} ~ {max_s}",
            "previous": f"{prev7_start} ~ {prev7_end}",
            "as_of": max_s,
        },
        "kpis": kpis,
        "trend": trend,
        "top_skus": top_skus,
        "stores": stores,
        "channels": channels,
        "data_stats": {
            "order_rows": int(len(data.orders)),
            "inventory_rows": int(len(data.inventory)),
            "daily_rows": int(len(data.daily)),
            "date_range": f"{data.orders['biz_date'].min()} ~ {data.orders['biz_date'].max()}",
        },
    }


def build_sentinels(data: ShopData) -> list[dict[str, Any]]:
    """异常哨兵：销量下滑 / 断货风险 / 退款与折扣异常。"""
    orders = _valid_orders(data.orders)
    max_date = pd.to_datetime(orders["biz_date"]).max()
    last7_start = (max_date - pd.Timedelta(days=6)).date().isoformat()
    prev7_start = (max_date - pd.Timedelta(days=13)).date().isoformat()
    prev7_end = (max_date - pd.Timedelta(days=7)).date().isoformat()
    max_s = max_date.date().isoformat()

    cur = orders[(orders["biz_date"] >= last7_start) & (orders["biz_date"] <= max_s)]
    prev = orders[(orders["biz_date"] >= prev7_start) & (orders["biz_date"] <= prev7_end)]

    sentinels: list[dict[str, Any]] = []

    # 1) SKU x store 销量下滑
    def agg(df: pd.DataFrame) -> pd.DataFrame:
        return (
            df.groupby(["store_name", "sku_name", "category"], as_index=False)
            .agg(qty=("quantity", "sum"), gmv=("pay_amount", "sum"), orders=("order_id", "count"))
        )

    c = agg(cur).rename(columns={"qty": "qty_c", "gmv": "gmv_c", "orders": "orders_c"})
    p = agg(prev).rename(columns={"qty": "qty_p", "gmv": "gmv_p", "orders": "orders_p"})
    m = c.merge(p, on=["store_name", "sku_name", "category"], how="outer").fillna(0)
    m["qty_change_pct"] = m.apply(
        lambda r: _pct(float(r.qty_c), float(r.qty_p)) if r.qty_p >= 8 else None, axis=1
    )
    drops = m[(m["qty_change_pct"].notna()) & (m["qty_change_pct"] <= -20)].sort_values(
        "qty_change_pct"
    )
    for r in drops.head(3).itertuples():
        evidence_rows = (
            cur[(cur["store_name"] == r.store_name) & (cur["sku_name"] == r.sku_name)]
            .sort_values("order_time", ascending=False)
            .head(5)[
                ["order_id", "order_time", "store_name", "sku_name", "quantity", "pay_amount", "channel"]
            ]
        )
        sentinels.append(
            {
                "id": f"drop-{r.store_name}-{r.sku_name}",
                "type": "sales_drop",
                "severity": "high" if r.qty_change_pct <= -30 else "medium",
                "title": f"{r.sku_name} 在{r.store_name}近7日销量下滑 {r.qty_change_pct}%",
                "summary": (
                    f"销量 {int(r.qty_p)} → {int(r.qty_c)} 杯，"
                    f"GMV ¥{r.gmv_p:.0f} → ¥{r.gmv_c:.0f}。"
                    f"品类：{r.category}。"
                ),
                "evidence": {
                    "metric": "quantity_wow",
                    "formula": "近7日销量 / 再前7日销量 - 1",
                    "current_qty": int(r.qty_c),
                    "previous_qty": int(r.qty_p),
                    "change_pct": r.qty_change_pct,
                    "store": r.store_name,
                    "sku": r.sku_name,
                    "sample_orders": evidence_rows.assign(
                        order_time=evidence_rows["order_time"].astype(str)
                    ).to_dict(orient="records"),
                },
                "actions": [
                    {
                        "title": "检查原料与出品稳定性",
                        "detail": f"排查{r.store_name}的{r.sku_name}是否缺料、出餐慢或差评增多。",
                    },
                    {
                        "title": "定向召回活动",
                        "detail": f"对近30天买过{r.sku_name}的会员推「第二杯半价」或组合套餐。",
                    },
                ],
            }
        )

    # 2) 库存风险
    inv = data.inventory.copy()
    inv["risk"] = inv["stock_qty"] < inv["safety_stock"]
    inv["cover_hint"] = inv.apply(
        lambda r: "紧急" if r.stock_qty < r.safety_stock * 0.5 else ("预警" if r.risk else "正常"),
        axis=1,
    )
    risks = inv[inv["risk"]].sort_values("stock_qty")
    for r in risks.head(3).itertuples():
        # 近7日日均销量估可售天数
        sku_cur = cur[(cur["store_name"] == r.store_name) & (cur["sku_name"] == r.sku_name)]
        daily_avg = float(sku_cur["quantity"].sum()) / 7.0 if len(sku_cur) else 0.0
        days_left = round(r.stock_qty / daily_avg, 1) if daily_avg > 0 else None
        sentinels.append(
            {
                "id": f"stock-{r.store_name}-{r.sku_name}",
                "type": "stockout_risk",
                "severity": "high" if (days_left is not None and days_left < 2) or r.stock_qty < r.safety_stock * 0.5 else "medium",
                "title": f"{r.sku_name} 在{r.store_name}库存低于安全线",
                "summary": (
                    f"当前库存 {int(r.stock_qty)}，安全库存 {int(r.safety_stock)}。"
                    + (f"按近7日均销约可售 {days_left} 天。" if days_left is not None else "近7日几乎无销量，请人工确认。")
                ),
                "evidence": {
                    "metric": "stock_vs_safety",
                    "formula": "stock_qty < safety_stock",
                    "stock_qty": int(r.stock_qty),
                    "safety_stock": int(r.safety_stock),
                    "daily_avg_qty_7d": round(daily_avg, 2),
                    "days_of_cover": days_left,
                    "store": r.store_name,
                    "sku": r.sku_name,
                    "unit_cost": float(r.unit_cost),
                    "unit_price": float(r.unit_price),
                },
                "actions": [
                    {
                        "title": "今日补货",
                        "detail": f"建议补至安全库存以上（至少 {int(r.safety_stock + max(daily_avg, 1) * 3)} 杯原料对应量）。",
                    },
                    {
                        "title": "临时限售/替品",
                        "detail": "若无法当日到货，小程序与美团先隐藏该 SKU，推荐同品类替品。",
                    },
                ],
            }
        )

    # 3) 折扣/营销成本抬升
    cur_disc = float(cur["discount_amount"].sum())
    prev_disc = float(prev["discount_amount"].sum())
    cur_gmv = float(cur["pay_amount"].sum()) or 1.0
    prev_gmv = float(prev["pay_amount"].sum()) or 1.0
    cur_rate = cur_disc / cur_gmv
    prev_rate = prev_disc / prev_gmv
    if cur_rate > prev_rate * 1.15 and cur_disc > 100:
        sentinels.append(
            {
                "id": "discount-rise",
                "type": "discount_pressure",
                "severity": "medium",
                "title": "近7日优惠力度抬升，侵蚀毛利",
                "summary": (
                    f"优惠金额 ¥{cur_disc:.0f}（占 GMV {cur_rate*100:.1f}%），"
                    f"对比上期 ¥{prev_disc:.0f}（{prev_rate*100:.1f}%）。"
                ),
                "evidence": {
                    "metric": "discount_rate",
                    "formula": "sum(discount_amount) / sum(pay_amount)",
                    "current_discount": round(cur_disc, 2),
                    "previous_discount": round(prev_disc, 2),
                    "current_rate_pct": round(cur_rate * 100, 2),
                    "previous_rate_pct": round(prev_rate * 100, 2),
                },
                "actions": [
                    {
                        "title": "收紧低效券",
                        "detail": "暂停对金卡以外用户的无门槛券，改为指定时段/指定 SKU 券。",
                    },
                    {
                        "title": "核算券后毛利",
                        "detail": "按渠道拆分券后毛利，保留高转化渠道，砍掉只拉低价单的渠道投放。",
                    },
                ],
            }
        )

    # 4) 退款
    all_orders = data.orders
    cur_all = all_orders[(all_orders["biz_date"] >= last7_start) & (all_orders["biz_date"] <= max_s)]
    prev_all = all_orders[(all_orders["biz_date"] >= prev7_start) & (all_orders["biz_date"] <= prev7_end)]
    cur_ref = int(cur_all["is_refund"].sum())
    prev_ref = int(prev_all["is_refund"].sum())
    if cur_ref >= max(3, prev_ref + 2):
        top_ref = (
            cur_all[cur_all["is_refund"] == 1]
            .groupby(["store_name", "sku_name"], as_index=False)
            .size()
            .sort_values("size", ascending=False)
            .head(3)
        )
        sentinels.append(
            {
                "id": "refund-up",
                "type": "refund_spike",
                "severity": "medium",
                "title": f"近7日退款 {cur_ref} 单，高于上期 {prev_ref} 单",
                "summary": "退款抬升可能来自配送超时、糖度做错或原料异味，建议按门店排查。",
                "evidence": {
                    "metric": "refund_count",
                    "current": cur_ref,
                    "previous": prev_ref,
                    "top": [
                        {"store": r.store_name, "sku": r.sku_name, "count": int(r.size)}
                        for r in top_ref.itertuples()
                    ],
                },
                "actions": [
                    {"title": "门店质检抽查", "detail": "对退款 Top 门店做 1 天出品抽检与配送时效复核。"},
                ],
            }
        )

    # severity order
    order = {"high": 0, "medium": 1, "low": 2}
    sentinels.sort(key=lambda x: order.get(x["severity"], 9))
    return sentinels


def build_action_board(sentinels: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for s in sentinels:
        for a in s.get("actions") or []:
            actions.append(
                {
                    "from_sentinel": s["id"],
                    "severity": s["severity"],
                    "title": a["title"],
                    "detail": a["detail"],
                    "context": s["title"],
                }
            )
            if len(actions) >= limit:
                return actions
    if not actions:
        actions = [
            {
                "from_sentinel": "none",
                "severity": "low",
                "title": "保持日报巡检",
                "detail": "今日无高优异常，建议关注周末备货与会员复购。",
                "context": "经营平稳",
            }
        ]
    return actions


def build_briefing(data: ShopData) -> dict[str, Any]:
    dash = build_dashboard(data)
    sentinels = build_sentinels(data)
    actions = build_action_board(sentinels)
    lines = [
        f"【{dash['brand']} · 经营日报】数据截至 {dash['period']['as_of']}",
        f"对比周期：{dash['period']['current']} vs {dash['period']['previous']}",
    ]
    for k in dash["kpis"]:
        ch = k["change_pct"]
        arrow = "持平" if ch is None else (f"↑{ch}%" if ch > 0 else f"↓{abs(ch)}%")
        prefix = k["unit"]
        lines.append(f"- {k['label']}：{prefix}{k['value']}（环比 {arrow}）")
    lines.append(f"异常哨兵：{len(sentinels)} 条；待办行动：{len(actions)} 条。")
    if sentinels:
        lines.append("优先关注：")
        for s in sentinels[:3]:
            lines.append(f"  · [{s['severity']}] {s['title']}")
    return {
        "title": "今日经营简报",
        "markdown": "\n".join(lines),
        "dashboard": dash,
        "sentinels": sentinels,
        "actions": actions,
    }
