const $ = (sel) => document.querySelector(sel);

const state = {
  thinkingTimer: null,
  stepTimer: null,
  busy: false,
};

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
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function openAssistant() {
  const panel = $("#assistantPanel");
  panel.classList.add("open");
  focusAssistant();
  setTimeout(() => $("#askInput")?.focus(), 80);
}

function closeAssistantMobile() {
  $("#assistantPanel").classList.remove("open");
}

function focusAssistant() {
  const panel = $("#assistantPanel");
  // Ensure chat is in view (desktop sticky already visible; mobile opens drawer)
  if (window.innerWidth <= 1100) {
    panel.classList.add("open");
  }
  const log = $("#chatLog");
  log.scrollTop = log.scrollHeight;
  // On desktop, soft-scroll page so sticky panel stays in attention if user was deep below
  panel.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

function scrollChatToBottom(smooth = true) {
  const log = $("#chatLog");
  log.scrollTo({
    top: log.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
}

async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    const pill = $("#healthPill");
    if (j.infinisynapse_configured) {
      pill.textContent = "InfiniSynapse 已连接";
      pill.classList.add("ok");
    } else {
      pill.textContent = "分析服务未配置";
      pill.classList.add("bad");
    }
  } catch {
    const pill = $("#healthPill");
    pill.textContent = "服务异常";
    pill.classList.add("bad");
  }
}

function renderKpis(kpis) {
  $("#kpiRow").innerHTML = kpis
    .map((k) => {
      const d = fmtDelta(k.change_pct);
      const val = k.unit === "¥" ? fmtMoney(k.value) : String(k.value);
      return `<div class="kpi">
        <div class="label">${k.label}</div>
        <div class="value">${val}</div>
        <div class="delta ${d.cls}">环比 ${d.text}</div>
      </div>`;
    })
    .join("");
}

function renderTrend(trend) {
  const max = Math.max(...trend.map((t) => t.gmv), 1);
  $("#trendChart").innerHTML = trend
    .map((t) => {
      const h = Math.max(6, Math.round((t.gmv / max) * 130));
      return `<div class="bar" style="height:${h}px" data-tip="${t.date} ${fmtMoney(t.gmv)}"></div>`;
    })
    .join("");
}

function renderLists(dash) {
  $("#topSkuList").innerHTML = dash.top_skus
    .map(
      (s) =>
        `<li><span class="name">${s.sku}<br><span class="muted">${s.category}</span></span><span class="val">${fmtMoney(s.gmv)}</span></li>`
    )
    .join("");

  const stores = dash.stores
    .map((s) => `<li><span class="name">${s.store}</span><span class="val">${fmtMoney(s.gmv)}</span></li>`)
    .join("");
  const ch = dash.channels
    .slice(0, 4)
    .map((s) => `<li><span class="name">${s.channel}</span><span class="val">${fmtMoney(s.gmv)}</span></li>`)
    .join("");
  $("#storeList").innerHTML = stores + ch;
}

function renderSentinels(items) {
  const box = $("#sentinelList");
  $("#sentinelCount").textContent = String(items.length);
  if (!items.length) {
    box.innerHTML = `<div class="sentinel low"><p>当前未发现高优异常，经营相对平稳。</p></div>`;
    return;
  }
  box.innerHTML = items
    .map((s) => {
      const evidence = encodeURIComponent(JSON.stringify(s.evidence || {}, null, 2));
      const title = encodeURIComponent(s.title || "证据链");
      const ask = encodeURIComponent(`请深入解释：${s.title}。给出可能原因与今天可执行的行动。`);
      return `<article class="sentinel ${s.severity}">
        <div><span class="sev ${s.severity}">${s.severity}</span><span class="muted">${s.type}</span></div>
        <h3>${s.title}</h3>
        <p>${s.summary}</p>
        <div class="sentinel-ops">
          <button type="button" class="btn-mini" data-evidence="${evidence}" data-title="${title}">查看证据链</button>
          <button type="button" class="btn-mini primary" data-ask="${ask}">追问 AI</button>
        </div>
      </article>`;
    })
    .join("");

  box.querySelectorAll("[data-evidence]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showEvidence(
        decodeURIComponent(btn.getAttribute("data-title")),
        decodeURIComponent(btn.getAttribute("data-evidence"))
      );
    });
  });
  box.querySelectorAll("[data-ask]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = decodeURIComponent(btn.getAttribute("data-ask"));
      openAssistant();
      ask(q);
    });
  });
}

function renderActions(items) {
  $("#actionList").innerHTML = items
    .map(
      (a) => `<article class="action">
        <div><span class="sev ${a.severity}">${a.severity}</span><span class="muted">${a.context}</span></div>
        <h3>${a.title}</h3>
        <p>${a.detail}</p>
      </article>`
    )
    .join("");
}

function showEvidence(title, evidenceText) {
  $("#evidenceTitle").textContent = title;
  try {
    const obj = JSON.parse(evidenceText);
    $("#evidenceBody").textContent = JSON.stringify(obj, null, 2);
  } catch {
    $("#evidenceBody").textContent = evidenceText;
  }
  $("#evidenceMask").hidden = false;
  $("#evidenceDrawer").hidden = false;
  $("#evidenceDrawer").setAttribute("aria-hidden", "false");
}

function hideEvidence() {
  $("#evidenceMask").hidden = true;
  $("#evidenceDrawer").hidden = true;
  $("#evidenceDrawer").setAttribute("aria-hidden", "true");
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
  scrollChatToBottom(true);
  return div;
}

function addTypingBubble() {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = "bubble bot typing";
  div.id = "typingBubble";
  div.innerHTML = `<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>正在整理回答…</span>`;
  log.appendChild(div);
  scrollChatToBottom(true);
  return div;
}

function removeTypingBubble() {
  $("#typingBubble")?.remove();
}

function setBusy(busy, deep = false) {
  state.busy = busy;
  const btn = $("#askBtn");
  const label = btn.querySelector(".send-label");
  const spinner = btn.querySelector(".send-spinner");
  const dot = $("#assistantDot");
  btn.disabled = busy;
  if (label) label.hidden = busy;
  if (spinner) spinner.hidden = !busy;
  if (busy) {
    if (label) label.textContent = deep ? "分析中" : "发送";
    dot.classList.add("busy");
  } else {
    if (label) {
      label.hidden = false;
      label.textContent = "发送";
    }
    if (spinner) spinner.hidden = true;
    dot.classList.remove("busy");
  }
}

function startThinkingOverlay() {
  const overlay = $("#thinkingOverlay");
  if (!overlay) return;
  // Only show during an explicit deep-analysis request — never on page load.
  overlay.hidden = false;
  const steps = [...$("#thinkingSteps").querySelectorAll("li")];
  steps.forEach((li, i) => {
    li.classList.toggle("active", i === 0);
    li.classList.remove("done");
  });
  $("#thinkingTitle").textContent = "正在深度分析";
  $("#thinkingDesc").textContent = "连接 InfiniSynapse · 准备经营数据";
  const bar = $("#thinkingBar");
  bar.style.animation = "none";
  // restart animation
  void bar.offsetWidth;
  bar.style.animation = "progressMove 1.2s ease-in-out infinite, progressGrow 12s linear forwards";

  let idx = 0;
  const descs = [
    "启用数据源与知识库",
    "建立事件流 GET /api/ai/events",
    "创建分析任务 POST /api/ai/message",
    "上传订单 / 库存 / 知识库文件",
    "汇总洞察与行动建议",
  ];
  clearInterval(state.stepTimer);
  state.stepTimer = setInterval(() => {
    if (idx < steps.length) {
      steps[idx].classList.remove("active");
      steps[idx].classList.add("done");
    }
    idx += 1;
    if (idx < steps.length) {
      steps[idx].classList.add("active");
      $("#thinkingDesc").textContent = descs[idx] || "分析进行中…";
    }
  }, 2200);
}

function stopThinkingOverlay() {
  clearInterval(state.stepTimer);
  state.stepTimer = null;
  $("#thinkingOverlay").hidden = true;
}

async function ask(question) {
  const q = (question || "").trim();
  if (!q || state.busy) return;

  openAssistant();
  focusAssistant();

  const useInfini = $("#useInfini").checked;
  addBubble("user", q);
  setBusy(true, useInfini);
  addTypingBubble();
  if (useInfini) startThinkingOverlay();

  try {
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, use_infini: useInfini, timeout_sec: 150 }),
    });
    const j = await r.json();
    removeTypingBubble();
    stopThinkingOverlay();

    const sourceLabel =
      {
        infinisynapse: "InfiniSynapse 深度分析",
        local: "本地经营引擎",
        local_fallback: "本地经营引擎（回退）",
      }[j.source] || j.source;
    const meta = [sourceLabel, j.elapsed_sec != null ? `${j.elapsed_sec}s` : null]
      .filter(Boolean)
      .join(" · ");
    addBubble("bot", j.answer || j.error || "暂无结果", meta);
    focusAssistant();
    scrollChatToBottom(true);
    if (j.source === "infinisynapse") toast("深度分析完成");
  } catch (e) {
    removeTypingBubble();
    stopThinkingOverlay();
    addBubble("bot", "请求失败：" + e.message);
    focusAssistant();
  } finally {
    setBusy(false);
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
  $("#periodLabel").textContent = `${dash.period.current}  vs 上期`;
  $("#dataMeta").textContent =
    `品牌：${dash.brand}\n` +
    `数据区间：${dash.data_stats.date_range}\n` +
    `订单 ${dash.data_stats.order_rows} 行 · 库存 ${dash.data_stats.inventory_rows} 行\n` +
    `对比周期：${dash.period.current}\n` +
    `上期：${dash.period.previous}`;

  addBubble(
    "bot",
    "你好，我是掌柜参谋。\n左侧可看经营异常与今日行动；点「查看证据链」核对数据依据，点「追问 AI」我会在这里直接回答，无需翻到页面底部。"
  );
}

/* Events */
$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#askInput");
  const q = input.value;
  input.value = "";
  ask(q);
});

$("#askInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#askForm").requestSubmit();
  }
});

$("#chipRow").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-q]");
  if (!btn) return;
  ask(btn.getAttribute("data-q"));
});

$("#openChatBtn")?.addEventListener("click", openAssistant);
$("#heroAskBtn")?.addEventListener("click", () => {
  openAssistant();
  $("#askInput").focus();
});
$("#fabChat")?.addEventListener("click", openAssistant);
$("#closeChatMobile")?.addEventListener("click", closeAssistantMobile);
$("#closeEvidence")?.addEventListener("click", hideEvidence);
$("#evidenceMask")?.addEventListener("click", hideEvidence);

boot().catch((e) => {
  console.error(e);
  toast("页面初始化失败：" + e.message);
});
