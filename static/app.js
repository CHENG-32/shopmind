const $ = (sel) => document.querySelector(sel);

function fmtMoney(v) {
  const n = Number(v) || 0;
  return "¥" + n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function fmtDelta(pct) {
  if (pct === null || pct === undefined) return { text: "持平", cls: "flat" };
  if (pct > 0) return { text: `↑ ${pct}%`, cls: "up" };
  if (pct < 0) return { text: `↓ ${Math.abs(pct)}%`, cls: "down" };
  return { text: "持平", cls: "flat" };
}

function toast(msg) {
  const el = $("#toast");
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    const pill = $("#healthPill");
    if (j.infinisynapse_configured) {
      pill.textContent = "InfiniSynapse 已配置";
      pill.classList.add("ok");
    } else {
      pill.textContent = "未配置 API Key";
      pill.classList.add("bad");
    }
  } catch {
    const pill = $("#healthPill");
    pill.textContent = "服务异常";
    pill.classList.add("bad");
  }
}

function renderKpis(kpis) {
  const row = $("#kpiRow");
  row.innerHTML = kpis.map((k) => {
    const d = fmtDelta(k.change_pct);
    const val = k.unit === "¥" ? fmtMoney(k.value) : String(k.value);
    return `<div class="kpi">
      <div class="label">${k.label}</div>
      <div class="value">${val}</div>
      <div class="delta ${d.cls}">环比 ${d.text}</div>
    </div>`;
  }).join("");
}

function renderTrend(trend) {
  const max = Math.max(...trend.map((t) => t.gmv), 1);
  const el = $("#trendChart");
  el.innerHTML = trend.map((t) => {
    const h = Math.max(6, Math.round((t.gmv / max) * 140));
    return `<div class="bar" style="height:${h}px" data-tip="${t.date} ${fmtMoney(t.gmv)}"></div>`;
  }).join("");
}

function renderLists(dash) {
  $("#topSkuList").innerHTML = dash.top_skus.map((s) =>
    `<li><span class="name">${s.sku}<br><span class="muted">${s.category}</span></span><span class="val">${fmtMoney(s.gmv)}</span></li>`
  ).join("");

  const stores = dash.stores.map((s) =>
    `<li><span class="name">${s.store}</span><span class="val">${fmtMoney(s.gmv)}</span></li>`
  ).join("");
  const ch = dash.channels.slice(0, 4).map((s) =>
    `<li><span class="name">${s.channel}</span><span class="val">${fmtMoney(s.gmv)}</span></li>`
  ).join("");
  $("#storeList").innerHTML = stores + ch;
}

function renderSentinels(items) {
  const box = $("#sentinelList");
  if (!items.length) {
    box.innerHTML = `<div class="sentinel low"><p>暂无异常，经营平稳。</p></div>`;
    return;
  }
  box.innerHTML = items.map((s) => `
    <article class="sentinel ${s.severity}">
      <div><span class="badge ${s.severity}">${s.severity}</span><span class="muted">${s.type}</span></div>
      <h3>${s.title}</h3>
      <p>${s.summary}</p>
      <div class="ops">
        <button class="btn" data-evidence='${JSON.stringify(s.evidence).replace(/'/g, "&#39;")}' data-title="${s.title.replace(/"/g, "&quot;")}">查看证据链</button>
        <button class="btn primary" data-ask="${encodeURIComponent("请深入解释：" + s.title + "。给出原因假设与行动。")}">追问 AI</button>
      </div>
    </article>
  `).join("");

  box.querySelectorAll("[data-evidence]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const title = btn.getAttribute("data-title");
      const evidence = btn.getAttribute("data-evidence");
      showEvidence(title, evidence);
    });
  });
  box.querySelectorAll("[data-ask]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = decodeURIComponent(btn.getAttribute("data-ask"));
      $("#askInput").value = q;
      ask(q);
    });
  });
}

function renderActions(items) {
  $("#actionList").innerHTML = items.map((a) => `
    <article class="action">
      <div><span class="badge ${a.severity}">${a.severity}</span><span class="muted">${a.context}</span></div>
      <h3>${a.title}</h3>
      <p>${a.detail}</p>
    </article>
  `).join("");
}

function showEvidence(title, evidenceRaw) {
  const panel = $("#evidencePanel");
  panel.hidden = false;
  let obj;
  try { obj = JSON.parse(evidenceRaw); } catch { obj = evidenceRaw; }
  $("#evidenceBody").textContent = `${title}\n\n` + JSON.stringify(obj, null, 2);
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function addBubble(role, text, meta = "") {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.textContent = text;
  if (meta) {
    const m = document.createElement("span");
    m.className = "meta";
    m.textContent = meta;
    div.appendChild(m);
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function ask(question) {
  const q = (question || "").trim();
  if (!q) return;
  const useInfini = $("#useInfini").checked;
  addBubble("user", q);
  const btn = $("#askBtn");
  btn.disabled = true;
  btn.textContent = useInfini ? "深度分析中…" : "分析中…";
  addBubble("bot", useInfini ? "正在结合经营数据做深度分析，通常需要约 30～120 秒…" : "正在计算经营指标…");

  try {
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, use_infini: useInfini, timeout_sec: 150 }),
    });
    const j = await r.json();
    // remove last waiting bubble
    const log = $("#chatLog");
    if (log.lastChild && log.lastChild.classList.contains("bot")) {
      log.removeChild(log.lastChild);
    }
    const sourceLabel = {
      infinisynapse: "深度分析",
      local: "本地分析",
      local_fallback: "本地分析（回退）",
    }[j.source] || j.source;
    const meta = [
      sourceLabel,
      j.elapsed_sec != null ? `${j.elapsed_sec}s` : null,
    ].filter(Boolean).join(" · ");
    addBubble("bot", j.answer || j.error || "无结果", meta);
    if (j.source === "infinisynapse") toast("深度分析完成");
  } catch (e) {
    addBubble("bot", "请求失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "分析";
  }
}

async function boot() {
  loadHealth();
  const [dash, brief] = await Promise.all([
    fetch("/api/dashboard").then((r) => r.json()),
    fetch("/api/briefing").then((r) => r.json()),
  ]);

  renderKpis(dash.kpis);
  renderTrend(dash.trend);
  renderLists(dash);
  renderSentinels(brief.sentinels || []);
  renderActions(brief.actions || []);
  $("#periodLabel").textContent = dash.period.current + " vs 上期";
  $("#dataMeta").textContent =
    `品牌：${dash.brand}\n` +
    `数据区间：${dash.data_stats.date_range}\n` +
    `订单 ${dash.data_stats.order_rows} 行 · 库存 ${dash.data_stats.inventory_rows} 行\n` +
    `对比：${dash.period.current}\n` +
    `vs ${dash.period.previous}`;

  addBubble(
    "bot",
    "你好，我是掌柜参谋。先看左侧异常与行动，需要时点「查看证据链」核对数据；也可以直接问我经营问题。"
  );
}

$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#askInput").value;
  $("#askInput").value = "";
  ask(q);
});

$("#chipRow").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-q]");
  if (!btn) return;
  ask(btn.getAttribute("data-q"));
});

$("#closeEvidence").addEventListener("click", () => {
  $("#evidencePanel").hidden = true;
});

boot().catch((e) => {
  console.error(e);
  toast("初始化失败：" + e.message);
});
