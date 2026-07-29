/* 掌柜参谋 ShopMind · 前端主逻辑
 * 多视图路由 / 账户认证 / SVG 图表 / InfiniSynapse SSE 流式问答
 */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  token: localStorage.getItem("sm_token") || null,
  user: null,
  mode: "deep",
  busy: false,
  pendingAfterAuth: null,
  dashboard: null,
  briefing: null,
  inited: {},
  sentinelFilter: "all",
  dataset: { key: null, page: 1, size: 12 },
  historyDetail: null,
  stream: { reader: null, timer: null, started: 0 },
};

/* ---------------- utils ---------------- */

function fmtMoney(v) {
  const n = Number(v) || 0;
  return "¥" + n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}
function fmtK(v) {
  const n = Number(v) || 0;
  return n >= 1000 ? "¥" + (n / 1000).toFixed(1) + "k" : "¥" + Math.round(n);
}
function fmtDelta(pct) {
  if (pct === null || pct === undefined) return { text: "持平", cls: "flat" };
  if (pct > 0) return { text: `↑ ${pct}%`, cls: "up" };
  if (pct < 0) return { text: `↓ ${Math.abs(pct)}%`, cls: "down" };
  return { text: "持平", cls: "flat" };
}
function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false });
}

function toast(msg) {
  const el = $("#toast");
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3000);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function countUp(elm, target, opts = {}) {
  const dur = opts.duration || 900;
  const fmt = opts.fmt || ((v) => Math.round(v).toLocaleString("zh-CN"));
  const t0 = performance.now();
  const start = 0;
  function tick(t) {
    const p = Math.min((t - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    elm.textContent = fmt(start + (target - start) * e);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * 轻量 Markdown → HTML：先转义原始 HTML，再还原有意结构。
 */
function renderMarkdown(src) {
  if (src == null) return "";
  let text = String(src).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return "";

  const stash = [];
  const put = (html) => {
    const key = `\u0000MD${stash.length}\u0000`;
    stash.push(html);
    return key;
  };

  text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    put(`<pre class="md-code"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`));

  text = escapeHtml(text);
  text = text.replace(/\u0000MD(\d+)\u0000/g, (_, i) => stash[Number(i)]);

  text = text.replace(/`([^`\n]+)`/g, (_, code) => `<code class="md-inline">${code}</code>`);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label, url) => `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  text = text.replace(/^(?:-{3,}|\*{3,})\s*$/gm, '<hr class="md-hr" />');
  text = text.replace(/^&gt;\s?(.*)$/gm, '<div class="md-quote-line">$1</div>');
  text = text.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  text = text.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  text = text.replace(/(^|\n)((?:\|.+\|\n?)+)/g, (match, lead, block) => {
    const rows = block.trim().split("\n").filter(Boolean);
    if (rows.length < 2) return match;
    const isSep = (row) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row.trim());
    const parseRow = (row) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    let header = parseRow(rows[0]);
    let bodyStart = 1;
    if (rows[1] && isSep(rows[1])) bodyStart = 2; else { header = null; bodyStart = 0; }
    let html = '<div class="md-table-wrap"><table class="md-table">';
    if (header) html += "<thead><tr>" + header.map((c) => `<th>${c}</th>`).join("") + "</tr></thead>";
    html += "<tbody>";
    for (let i = bodyStart; i < rows.length; i++) {
      if (isSep(rows[i])) continue;
      html += "<tr>" + parseRow(rows[i]).map((c) => `<td>${c}</td>`).join("") + "</tr>";
    }
    return lead + html + "</tbody></table></div>\n";
  });

  const lines = text.split("\n");
  const out = [];
  let listType = null, listBuf = [];
  const flush = () => {
    if (!listType) return;
    out.push(`<${listType} class="md-list">` + listBuf.map((li) => `<li>${li}</li>`).join("") + `</${listType}>`);
    listType = null; listBuf = [];
  };
  for (const line of lines) {
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ul) { if (listType && listType !== "ul") flush(); listType = "ul"; listBuf.push(ul[1]); continue; }
    if (ol) { if (listType && listType !== "ol") flush(); listType = "ol"; listBuf.push(ol[1]); continue; }
    flush(); out.push(line);
  }
  flush();
  text = out.join("\n");

  text = text.replace(/(?:<div class="md-quote-line">[\s\S]*?<\/div>\n?)+/g, (block) => {
    const inner = block.replace(/<div class="md-quote-line">/g, "").replace(/<\/div>\n?/g, "\n").trim().replace(/\n/g, "<br />");
    return `<blockquote class="md-quote">${inner}</blockquote>\n`;
  });

  return text.split(/\n{2,}/).map((b) => {
    const t = b.trim();
    if (!t) return "";
    if (/^<\/?(h[1-6]|ul|ol|pre|table|blockquote|hr|div|p)\b/i.test(t)) return t;
    return `<p>${t.replace(/\n/g, "<br />")}</p>`;
  }).filter(Boolean).join("\n");
}

/* ---------------- API ---------------- */

async function api(path, { method = "GET", body = null, auth = true } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth && state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const resp = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  let data = null;
  try { data = await resp.json(); } catch (_) { /* empty */ }
  if (!resp.ok) {
    const detail = data && data.detail;
    const msg = typeof detail === "string" ? detail : (detail && detail.message) || `请求失败 (${resp.status})`;
    const err = new Error(msg);
    err.status = resp.status;
    err.code = detail && detail.code;
    // 持有 token 却被拒 → 登录态已失效（过期/服务端密钥轮换），立即清理保持一致
    if (resp.status === 401 && state.token) clearAuth();
    throw err;
  }
  return data;
}

function isAuthError(err) {
  return err && (err.status === 401 || err.code === "auth_required");
}

function clearAuth() {
  if (!state.user && !state.token) return;
  state.user = null;
  state.token = null;
  localStorage.removeItem("sm_token");
  applyAuthState();
  toast("登录状态已失效，请重新登录");
}

/* ---------------- 路由 ---------------- */

const ROUTES = ["/", "/sentinels", "/actions", "/console", "/data", "/history"];

function currentRoute() {
  const h = location.hash.replace(/^#/, "") || "/";
  return ROUTES.includes(h) ? h : "/";
}

function navigate(route) {
  location.hash = "#" + route;
}

const VIEW_INIT = {
  "/": initOverview,
  "/sentinels": initSentinels,
  "/actions": initActions,
  "/console": initConsole,
  "/data": initData,
  "/history": initHistory,
};

function route() {
  const r = currentRoute();
  $$(".top-nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === r));
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === r));
  $("#topNav").classList.remove("mobile-open");
  window.scrollTo({ top: 0, behavior: "instant" });
  const init = VIEW_INIT[r];
  if (init) init();
  // re-run reveal animation
  $$(`#view-${r === "/" ? "overview" : r.slice(1)} .reveal`).forEach((el, i) => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    el.style.animationDelay = `${Math.min(i * 0.07, 0.4)}s`;
  });
}

window.addEventListener("hashchange", route);

/* ---------------- 认证 ---------------- */

function openAuth(mode = "login", reason = "", resume = null) {
  state.pendingAfterAuth = resume;
  if (reason) $("#authReason").textContent = reason;
  else $("#authReason").textContent = "登录后解锁 InfiniSynapse 深度分析";
  switchAuthTab(mode);
  $("#authMask").hidden = false;
  setTimeout(() => $(mode === "login" ? "#loginEmail" : "#regName")?.focus(), 60);
}

function closeAuth() {
  $("#authMask").hidden = true;
  state.pendingAfterAuth = null;
  $("#loginError").hidden = true;
  $("#regError").hidden = true;
}

function switchAuthTab(mode) {
  const login = mode === "login";
  $("#tabLogin").classList.toggle("active", login);
  $("#tabRegister").classList.toggle("active", !login);
  $("#loginForm").hidden = !login;
  $("#registerForm").hidden = login;
}

function authError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
  const modal = el.closest(".modal");
  modal.classList.remove("shake");
  void modal.offsetWidth;
  modal.classList.add("shake");
}

async function afterAuthSuccess({ user, token }) {
  state.user = user;
  state.token = token;
  localStorage.setItem("sm_token", token);
  applyAuthState();
  closeAuth();
  toast(`欢迎回来，${user.name}`);
  const resume = state.pendingAfterAuth;
  state.pendingAfterAuth = null;
  if (typeof resume === "function") resume();
}

function applyAuthState() {
  const logged = !!state.user;
  $("#authOpenBtn").hidden = logged;
  $("#userChip").hidden = !logged;
  if (logged) {
    $("#userName").textContent = state.user.name;
    $("#userEmail").textContent = state.user.email;
    $("#userAvatar").textContent = (state.user.name || "掌").slice(0, 1);
  }
  // 控制台锁提示：游客且处于深度模式时展示
  updateConsoleLock();
  // 历史页锁
  if (currentRoute() === "/history") initHistory(true);
}

function updateConsoleLock() {
  const locked = !state.user && state.mode === "deep";
  $("#consoleLock").hidden = !locked;
  const deepBtn = $("#modeDeep");
  deepBtn.classList.toggle("locked", !state.user);
  deepBtn.innerHTML = state.user
    ? '深度分析 <span class="et-badge">InfiniSynapse</span>'
    : '深度分析 <span class="et-badge">需登录</span>';
}

async function silentAuthCheck() {
  if (!state.token) { applyAuthState(); return; }
  try {
    const j = await api("/api/auth/me");
    if (j.user) { state.user = j.user; applyAuthState(); return; }
  } catch (_) { /* ignore */ }
  state.token = null;
  localStorage.removeItem("sm_token");
  applyAuthState();
}

/* ---------------- 认证事件绑定 ---------------- */

function bindAuth() {
  $("#authOpenBtn").addEventListener("click", () => openAuth("login"));
  $("#authClose").addEventListener("click", closeAuth);
  $("#authMask").addEventListener("click", (e) => { if (e.target === $("#authMask")) closeAuth(); });
  $("#tabLogin").addEventListener("click", () => switchAuthTab("login"));
  $("#tabRegister").addEventListener("click", () => switchAuthTab("register"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#authMask").hidden) closeAuth();
      if (!$("#evidenceDrawer").hidden) hideEvidence();
      if (!$("#historyMask").hidden) $("#historyMask").hidden = true;
    }
  });

  $("#logoutBtn").addEventListener("click", () => {
    state.user = null;
    state.token = null;
    localStorage.removeItem("sm_token");
    applyAuthState();
    toast("已退出登录");
  });

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginSubmit");
    btn.disabled = true;
    try {
      await afterAuthSuccess(await api("/api/auth/login", {
        method: "POST", auth: false,
        body: { email: $("#loginEmail").value.trim(), password: $("#loginPassword").value },
      }));
    } catch (err) {
      authError($("#loginError"), err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#regSubmit");
    const name = $("#regName").value.trim();
    const password = $("#regPassword").value;
    if (name.length < 2) return authError($("#regError"), "称呼至少 2 个字符");
    if (password.length < 6) return authError($("#regError"), "密码至少 6 位");
    btn.disabled = true;
    try {
      await afterAuthSuccess(await api("/api/auth/register", {
        method: "POST", auth: false,
        body: { name, email: $("#regEmail").value.trim(), password },
      }));
    } catch (err) {
      authError($("#regError"), err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------------- 总览 ---------------- */

async function initOverview() {
  if (state.inited["/"]) return;
  state.inited["/"] = true;
  try {
    const [dash, brief] = await Promise.all([api("/api/dashboard"), api("/api/briefing")]);
    state.dashboard = dash;
    state.briefing = brief;
    renderOverview();
  } catch (e) {
    toast("看板数据加载失败：" + e.message);
    state.inited["/"] = false;
  }
}

const METRICS = {
  gmv: { label: "GMV", color: "#0d9488", fmt: (v) => fmtK(v), tip: (v) => "GMV " + fmtMoney(v), total: (arr) => "合计 " + fmtK(arr.reduce((a, t) => a + t.value, 0)) },
  orders: { label: "订单量", color: "#6fb1d6", fmt: (v) => Math.round(v) + " 单", tip: (v) => Math.round(v) + " 单", total: (arr) => "合计 " + Math.round(arr.reduce((a, t) => a + t.value, 0)).toLocaleString("zh-CN") + " 单" },
  gross_profit: { label: "毛利", color: "#de9b4b", fmt: (v) => fmtK(v), tip: (v) => "毛利 " + fmtMoney(v), total: (arr) => "合计 " + fmtK(arr.reduce((a, t) => a + t.value, 0)) },
  aov: { label: "客单价", color: "#cf8f88", fmt: (v) => "¥" + v.toFixed(1), tip: (v) => "客单价 ¥" + v.toFixed(1), total: (arr) => "均值 ¥" + (arr.reduce((a, t) => a + t.value, 0) / arr.length).toFixed(1) },
};

function renderTrend(metric) {
  const dash = state.dashboard;
  const m = METRICS[metric];
  const points = dash.trend.map((t) => ({ date: t.date, value: t[metric] }));
  window.smCharts.area($("#trendChart"), points, { color: m.color, fmtY: m.fmt, fmtTip: m.tip });
  $("#trendTotal").textContent = `30日·${m.label} ${m.total(points)}`;
  state.metric = metric;
}

function renderOverview() {
  const dash = state.dashboard;
  const brief = state.briefing;
  if (!dash) return;

  // KPI
  const sparks = (dash.spark7 || []).map((s) => s.gmv);
  $("#kpiRow").innerHTML = "";
  dash.kpis.forEach((k, i) => {
    const d = fmtDelta(k.change_pct);
    const card = document.createElement("div");
    card.className = "kpi";
    card.innerHTML = `
      <div class="kpi-top"><span class="label">${k.label}</span><span class="delta ${d.cls}">环比 ${d.text}</span></div>
      <div class="value">—</div>
      <div class="kpi-foot"><span class="muted">上期 ${k.unit === "¥" ? fmtMoney(k.prev) : k.prev}</span><span class="kpi-spark"></span></div>`;
    $("#kpiRow").appendChild(card);
    const valEl = card.querySelector(".value");
    const target = Number(k.value) || 0;
    countUp(valEl, target, {
      fmt: (v) => k.unit === "¥" ? "¥" + Math.round(v).toLocaleString("zh-CN") : String(Math.round(v)),
    });
    if (sparks.length >= 2) {
      window.smCharts.spark(card.querySelector(".kpi-spark"), sparks,
        { color: k.change_pct != null && k.change_pct < 0 ? "#cf5b50" : "#0d9488" });
    }
  });

  // 简报
  $("#briefPeriod").textContent = dash.period.as_of;
  $("#briefBody").innerHTML = renderMarkdown(brief.markdown);
  $("#briefSentinelCount").textContent = `哨兵 ${brief.sentinels.length} 条 · 行动 ${brief.actions.length} 条`;

  // 趋势（默认 GMV，可切换）
  renderTrend(state.metric || "gmv");
  $("#peakHours").textContent = (dash.peak_hours || []).length
    ? `下单高峰 ${dash.peak_hours.map((h) => h + ":00").join(" / ")}`
    : "";

  // 渠道 donut
  const ch = dash.channels.map((c) => ({ label: c.channel, value: c.gmv, share: c.share }));
  window.smCharts.donut($("#channelDonut"), ch, {
    centerTitle: "近7日", centerValue: fmtK(ch.reduce((a, b) => a + b.value, 0)),
  });
  window.smCharts.legend($("#channelLegend"), ch, { fmt: fmtMoney });

  // 会员结构
  const mem = (dash.members || []).map((m2) => ({ label: m2.level, value: m2.gmv, share: m2.share }));
  window.smCharts.donut($("#memberDonut"), mem, {
    centerTitle: "近7日", centerValue: fmtK(mem.reduce((a, b) => a + b.value, 0)),
  });
  window.smCharts.legend($("#memberLegend"), mem, { fmt: fmtMoney });
  $("#memberInsight").textContent =
    `金卡/银卡贡献 ${dash.loyal_member_share}% GMV，新客与非会员占 ${dash.new_member_share}% —— ` +
    (dash.loyal_member_share >= 35 ? "老客基本盘稳固，可加大新客转化。" : "复购盘偏薄，建议会员召回与储值激励。");

  // 健康度
  const h = dash.health || {};
  const gradeCls = h.grade_cls || "watch";
  const gaugeColors = {
    excellent: ["#0f766e", "#5ec4b0"], good: ["#0d9488", "#6fb1d6"],
    watch: ["#de9b4b", "#ecc084"], alert: ["#cf5b50", "#e09088"],
  }[gradeCls] || ["#0d9488", "#6fb1d6"];
  window.smCharts.gauge($("#healthGauge"), h.score || 0, { label: h.grade || "—", c1: gaugeColors[0], c2: gaugeColors[1] });
  const gradeEl = $("#healthGrade");
  gradeEl.textContent = `${h.grade || "—"} · ${h.score || 0} 分`;
  gradeEl.className = "grade-badge " + gradeCls;
  $("#healthFactors").innerHTML = (h.factors || []).map((f) => `
    <li class="factor ${f.impact < 0 ? "neg" : "pos"}">
      <span class="f-imp">${f.impact > 0 ? "+" + f.impact : f.impact === 0 ? "±0" : f.impact}</span>
      <span class="f-label">${escapeHtml(f.label)}</span>
    </li>`).join("");

  // 未来 7 日预估
  const fc = dash.forecast || {};
  countUp($("#forecastValue"), fc.pred_gmv || 0, { fmt: (v) => "¥" + Math.round(v).toLocaleString("zh-CN") });
  $("#forecastMethod").textContent = fc.method || "";
  $("#forecastRange").textContent = `区间 ¥${(fc.range?.[0] || 0).toLocaleString("zh-CN")} ~ ¥${(fc.range?.[1] || 0).toLocaleString("zh-CN")}`;
  const vs = fc.vs_last7_pct;
  $("#forecastMeta").innerHTML = [
    `日均约 <b>¥${(fc.daily_avg || 0).toLocaleString("zh-CN")}</b>`,
    vs != null ? `对比本周 <b class="${vs >= 0 ? "up-t" : "down-t"}">${vs >= 0 ? "+" : ""}${vs}%</b>` : "",
  ].filter(Boolean).join("<i class='fc-sep'></i>");

  // 门店对比（含环比）
  window.smCharts.hbars($("#storeBars"),
    (dash.store_compare || []).map((s) => ({
      label: s.store.replace("星野茶·", ""),
      value: s.gmv,
      sub: `订单 ${s.orders} · 毛利 ${fmtMoney(s.gross_profit)} · 环比 ${s.wow_pct == null ? "持平" : (s.wow_pct > 0 ? "+" : "") + s.wow_pct + "%"}`,
    })),
    { fmt: fmtK });

  // 品类
  window.smCharts.hbars($("#catBars"),
    (dash.categories || []).map((c, i) => ({ label: c.category, value: c.gmv })),
    { fmt: (v) => fmtK(v) });

  // SKU（含毛利率徽章）
  $("#skuCount").textContent = `Top ${dash.top_skus.length}`;
  $("#topSkuList").innerHTML = dash.top_skus.map((s, i) => `
    <li>
      <span class="sku-rank">${i + 1}</span>
      <span class="sku-name"><b>${escapeHtml(s.sku)}</b><span>${escapeHtml(s.category)} · 销量 ${s.qty}</span></span>
      <span class="sku-val"><b>${fmtMoney(s.gmv)}</b><span>${s.orders} 单 · 毛利 ${fmtMoney(s.gross_profit)} <i class="margin-tag">${s.margin_pct}%</i></span></span>
    </li>`).join("");

  // 时段热力
  window.smCharts.heat($("#hourHeat"), dash.hourly || []);

  // 哨兵播报（单条轮播）
  initTicker((brief.sentinels || []).map((s) => s.title));

  // Hero 数据数字大屏
  const hs = $("#heroStats");
  if (hs) {
    const days = dash.data_stats.daily_rows || 90;
    hs.innerHTML = `
      <li><b>${(dash.stores || []).length}</b><span>门店</span></li>
      <li><b>${(dash.data_stats.order_rows / 1000).toFixed(1)}k</b><span>订单数据</span></li>
      <li><b>${days}</b><span>经营天数</span></li>
      <li><b>${brief.sentinels.length}</b><span>在岗哨兵</span></li>`;
  }
}

/* ---------------- 哨兵播报（单条轮播） ---------------- */

const tickerState = { items: [], idx: 0, timer: null, rolling: true };

function initTicker(items) {
  clearInterval(tickerState.timer);
  tickerState.items = items;
  tickerState.idx = 0;
  const strip = $("#tickerStrip");
  if (!items.length) { strip.hidden = true; return; }
  strip.hidden = false;
  showTickerItem(0, false);
  tickerState.timer = setInterval(() => {
    if (tickerState.rolling && document.visibilityState === "visible") {
      showTickerItem((tickerState.idx + 1) % tickerState.items.length, true);
    }
  }, 5200);
}

function showTickerItem(idx, _animate) {
  // 无动画静默切换：避免任何闪烁感知
  tickerState.idx = idx;
  $("#tickerCurrent").textContent = tickerState.items[idx];
  $("#tickerCount").textContent = `${idx + 1} / ${tickerState.items.length}`;
}

function bindTicker() {
  $("#tickerPrev").addEventListener("click", () => {
    if (!tickerState.items.length) return;
    showTickerItem((tickerState.idx - 1 + tickerState.items.length) % tickerState.items.length, true);
  });
  $("#tickerNext").addEventListener("click", () => {
    if (!tickerState.items.length) return;
    showTickerItem((tickerState.idx + 1) % tickerState.items.length, true);
  });
  const flip = $("#tickerFlip");
  flip.addEventListener("mouseenter", () => { tickerState.rolling = false; });
  flip.addEventListener("mouseleave", () => { tickerState.rolling = true; });
  flip.addEventListener("click", () => navigate("/sentinels"));
  // 指标切换
  $("#metricTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-m]");
    if (!btn) return;
    $$("#metricTabs button").forEach((b) => b.classList.toggle("active", b === btn));
    renderTrend(btn.dataset.m);
  });
}

/* ---------------- 异常哨兵 ---------------- */

async function initSentinels() {
  if (!state.briefing) {
    try { state.briefing = await api("/api/briefing"); }
    catch (e) { toast("哨兵数据加载失败：" + e.message); return; }
  }
  renderSentinels();
}

function evidenceKvHtml(ev) {
  if (!ev) return "";
  const pairs = [];
  const push = (label, v) => {
    if (v !== undefined && v !== null && v !== "") pairs.push(`<span>${label} ${v}</span>`);
  };
  push("口径", ev.metric);
  push("当前", ev.current_qty ?? ev.stock_qty ?? ev.current);
  push("上期", ev.previous_qty ?? ev.previous);
  push("变化", ev.change_pct != null ? ev.change_pct + "%" : undefined);
  push("安全线", ev.safety_stock);
  push("可售天数", ev.days_of_cover);
  push("优惠率", ev.current_rate_pct != null ? ev.current_rate_pct + "%" : undefined);
  if (!pairs.length) return "";
  return `<div class="ev-kv">${pairs.slice(0, 6).join("")}</div>`;
}

function renderSentinels() {
  const items = (state.briefing.sentinels || []).filter(
    (s) => state.sentinelFilter === "all" || s.severity === state.sentinelFilter);
  const box = $("#sentinelList");
  if (!items.length) {
    box.innerHTML = `<div class="empty-note">该筛选下暂无异常——经营相对平稳。</div>`;
    return;
  }
  box.innerHTML = items.map((s, idx) => `
    <article class="sentinel ${s.severity}">
      <div class="sentinel-top">
        <span class="sev ${s.severity}">${{ high: "高优", medium: "关注", low: "提示" }[s.severity] || s.severity}</span>
        <span class="s-type">${escapeHtml({ sales_drop: "销量下滑", stockout_risk: "断货风险", discount_pressure: "优惠侵蚀", refund_spike: "退款异常" }[s.type] || s.type)}</span>
      </div>
      <h3>${escapeHtml(s.title)}</h3>
      <p>${escapeHtml(s.summary)}</p>
      ${evidenceKvHtml(s.evidence)}
      <div class="sentinel-ops">
        <button type="button" class="btn-mini" data-idx="${idx}" data-op="evidence">查看证据链</button>
        <button type="button" class="btn-mini primary" data-idx="${idx}" data-op="ask">
          <svg viewBox="0 0 24 24" class="ic"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg>
          AI 追问
        </button>
      </div>
    </article>`).join("");

  box.querySelectorAll("button[data-op]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = items[Number(btn.dataset.idx)];
      if (btn.dataset.op === "evidence") showEvidence(s.title, s.evidence || {});
      else {
        navigate("/console");
        ask(`请深入解释这条异常：「${s.title}」。${s.summary} 给出可能原因与今天可执行的行动。`);
      }
    });
  });
}

function bindSentinelFilter() {
  $("#sentinelFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-f]");
    if (!btn) return;
    $$("#sentinelFilter button").forEach((b) => b.classList.toggle("active", b === btn));
    state.sentinelFilter = btn.dataset.f;
    renderSentinels();
  });
}

/* ---------------- 行动清单 ---------------- */

async function initActions() {
  if (!state.briefing) {
    try { state.briefing = await api("/api/briefing"); }
    catch (e) { toast("行动数据加载失败：" + e.message); return; }
  }
  const items = state.briefing.actions || [];
  $("#actionList").innerHTML = items.map((a, i) => `
    <article class="action">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="action-no">${String(i + 1).padStart(2, "0")}</span>
        <span class="sev ${a.severity}">${{ high: "高优", medium: "关注", low: "提示" }[a.severity] || a.severity}</span>
      </div>
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.detail)}</p>
      <div class="action-src">来源：${escapeHtml(a.context || "经营巡检")}</div>
    </article>`).join("");
}

/* ---------------- 证据抽屉 ---------------- */

function showEvidence(title, evidence) {
  $("#evidenceTitle").textContent = title;
  const kv = [];
  const map = { metric: "指标", formula: "口径公式", current_qty: "当前销量", previous_qty: "上期销量",
    change_pct: "变化 %", stock_qty: "当前库存", safety_stock: "安全库存", daily_avg_qty_7d: "7日均销",
    days_of_cover: "可售天数", store: "门店", sku: "SKU", current: "当前", previous: "上期" };
  for (const [k, label] of Object.entries(map)) {
    if (evidence[k] !== undefined && typeof evidence[k] !== "object")
      kv.push(`<div class="ekv"><span>${label}</span><b>${escapeHtml(evidence[k])}</b></div>`);
  }
  $("#evidenceKv").innerHTML = kv.join("");
  $("#evidenceBody").textContent = JSON.stringify(evidence, null, 2);
  $("#evidenceMask").hidden = false;
  $("#evidenceDrawer").hidden = false;
}
function hideEvidence() {
  $("#evidenceMask").hidden = true;
  $("#evidenceDrawer").hidden = true;
}

/* ---------------- AI 参谋 ---------------- */

function initConsole() {
  updateConsoleLock();
  if (state.inited["/console"]) return;
  state.inited["/console"] = true;
  addBubble("bot",
    "你好，我是掌柜参谋 AI。**左侧可以切换两种引擎：**\n\n" +
    "- **深度分析**：调用 InfiniSynapse Agent，读取订单/库存/日报/知识库后交叉推理，约 1～3 分钟出结论（需登录）\n" +
    "- **经营速览**：本地引擎即时回答，游客可用\n\n" +
    "右侧有快捷提问，也可以直接输入你的问题。");
}

function addBubble(role, text, metaHtml = "") {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  if (role === "bot") {
    const body = document.createElement("div");
    body.className = "md-body";
    body.innerHTML = renderMarkdown(text);
    div.appendChild(body);
  } else {
    div.textContent = text;
  }
  if (metaHtml) {
    const m = document.createElement("div");
    m.className = "meta";
    m.innerHTML = metaHtml;
    div.appendChild(m);
  }
  log.appendChild(div);
  log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  return div;
}

function addTypingBubble() {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = "bubble bot typing";
  div.id = "typingBubble";
  div.innerHTML = `<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>正在整理回答…</span>`;
  log.appendChild(div);
  log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
}

function setMode(mode) {
  state.mode = mode;
  $("#modeDeep").classList.toggle("active", mode === "deep");
  $("#modeQuick").classList.toggle("active", mode === "quick");
  $("#askHint").textContent = mode === "deep"
    ? "深度分析会建立 SSE 通道、上传经营数据并由 Agent 交叉推理，通常需要 1～3 分钟，结论可在 InfiniSynapse 平台核验。"
    : "经营速览由本地引擎即时回答，适合快速确认异常与行动；需要深度归因时请切换至深度分析（需登录）。";
  updateConsoleLock();
}

function setBusy(busy) {
  state.busy = busy;
  const btn = $("#askBtn");
  btn.disabled = busy;
  btn.classList.toggle("busy", busy);
  btn.querySelector(".send-label").textContent = busy ? "分析中" : "发送";
  $("#assistantDot").classList.toggle("busy", busy);
}

function ask(question) {
  const q = (question || "").trim();
  if (!q || state.busy) return;
  if (state.mode === "deep") askDeep(q);
  else askQuick(q);
}

/* ---- 本地速览（游客可用） ---- */
async function askQuick(q) {
  addBubble("user", q);
  setBusy(true);
  addTypingBubble();
  try {
    const j = await api("/api/ask", { method: "POST", body: { question: q, use_infini: false } });
    $("#typingBubble")?.remove();
    const meta = `<span class="m-tag local">经营速览</span><span>本地引擎 · 即时</span>`;
    addBubble("bot", j.answer || "暂时没有可用结论。", meta);
  } catch (e) {
    $("#typingBubble")?.remove();
    addBubble("bot", "速览暂时失败，请稍后再试。");
  } finally {
    setBusy(false);
  }
}

/* ---- InfiniSynapse 深度分析（需登录，SSE 流式） ---- */

const STAGE_LABEL = {
  prepare: "初始化", context_ready: "资源就绪", connecting: "建立通道", connected: "通道已连接",
  task_created: "任务已创建", uploading: "上传数据", uploaded: "数据已送达",
  agent_thinking: "Agent 推理中", heartbeat: "分析进行中", error: "异常",
};

function askDeep(q) {
  if (!state.user) {
    openAuth("login", "深度分析将真实调用 InfiniSynapse Agent，请先登录", () => askDeep(q));
    return;
  }
  addBubble("user", q);
  setBusy(true);
  startStreamPanel();

  const liveBubble = addBubble("bot", "", "");
  liveBubble.classList.add("streaming");
  const liveBody = liveBubble.querySelector(".md-body");
  liveBody.innerHTML = '<span class="muted">等待 Agent 输出…</span>';
  let best = "";
  let liveRenderAt = 0;
  let lastRenderedLen = 0;
  const chatLog = $("#chatLog");

  function renderLive() {
    liveBody.innerHTML = renderMarkdown(best) + '<span class="cursor"></span>';
    // 仅当用户本来就在底部附近时才跟随，且即时定位，避免平滑滚动动画叠加造成抖动
    if (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 160) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }

  (async () => {
    let resp;
    try {
      resp = await fetch("/api/ask/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${state.token}`,
        },
        body: JSON.stringify({ question: q, use_infini: true, timeout_sec: 1000 }),
      });
    } catch (e) {
      finishStreamError("网络异常，无法建立分析通道");
      return;
    }

    if (resp.status === 401) {
      finishStreamError("登录状态已失效");
      liveBubble.remove();
      clearAuth();
      openAuth("login", "登录状态已失效，请重新登录后继续深度分析", () => askDeep(q));
      return;
    }
    if (!resp.ok || !resp.body) {
      finishStreamError(`服务异常 (${resp.status})`);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const handleEvent = (name, data) => {
      let payload = {};
      try { payload = JSON.parse(data); } catch (_) { return; }
      if (name === "stage") {
        if (payload.stage === "answer_chunk") {
          const t = payload.text || "";
          if (t.length > best.length) best = t;
          const now = performance.now();
          // 400ms 节流 + 明显增量才重渲染，彻底消除逐字重排导致的闪动
          if (best.length - lastRenderedLen >= 24 && now - liveRenderAt > 400) {
            liveRenderAt = now;
            lastRenderedLen = best.length;
            renderLive();
          }
          setStreamStatus("Agent 正在输出结论…");
          return;
        }
        if (payload.stage === "heartbeat") { setStreamStatus(payload.text || "分析进行中…"); return; }
        addStreamStep(payload.stage, payload.text);
        if (payload.text) setStreamStatus(payload.text);
      } else if (name === "done") {
        finishStream(payload, liveBubble, liveBody, best, q);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const rawEvent = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        let name = "message";
        const dataLines = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (dataLines.length) handleEvent(name, dataLines.join("\n"));
      }
    }
    if (!state.streamDone) finishStreamError("连接中断，未收到完整结论");
  })();
}

function startStreamPanel() {
  state.streamDone = false;
  $("#streamPanel").hidden = false;
  $("#streamSteps").innerHTML = "";
  $("#streamTitle").textContent = "InfiniSynapse 分析中";
  setStreamStatus("正在初始化…");
  state.stream.started = Date.now();
  clearInterval(state.stream.timer);
  state.stream.timer = setInterval(() => {
    $("#streamElapsed").textContent = Math.round((Date.now() - state.stream.started) / 1000) + "s";
  }, 1000);
}

function setStreamStatus(t) { $("#streamStatus").textContent = t; }

function addStreamStep(stage, text) {
  const li = document.createElement("li");
  li.innerHTML = `<b>${escapeHtml(STAGE_LABEL[stage] || stage)}</b><span>${escapeHtml(text || "")}</span>`;
  $("#streamSteps").appendChild(li);
  $("#streamSteps").scrollTop = $("#streamSteps").scrollHeight;
}

function stopStreamTimer() {
  clearInterval(state.stream.timer);
  state.stream.timer = null;
}

function finishStream(payload, bubble, body, best, question) {
  state.streamDone = true;
  stopStreamTimer();
  bubble.classList.remove("streaming");
  const answer = payload.answer || best;
  body.innerHTML = renderMarkdown(answer || "Agent 本次未返回完整结论。");
  const elapsed = payload.elapsed_sec != null ? `${payload.elapsed_sec}s` :
    Math.round((Date.now() - state.stream.started) / 1000) + "s";
  const meta = bubble.querySelector(".meta") || (() => {
    const m = document.createElement("div"); m.className = "meta"; bubble.appendChild(m); return m;
  })();
  meta.innerHTML = [
    `<span class="m-tag">InfiniSynapse 深度分析</span>`,
    elapsed ? `<span>${elapsed}</span>` : "",
    payload.task_id ? `<span class="m-task">task_id: ${escapeHtml(payload.task_id)}</span>` : "",
    payload.error ? `<span>注：${escapeHtml(String(payload.error).slice(0, 60))}</span>` : "",
  ].filter(Boolean).join("");
  if (answer) {
    addStreamStep("done", "分析完成，结论已生成");
    setStreamStatus("完成");
    $("#streamTitle").textContent = "分析完成";
    toast("深度分析完成");
  } else {
    setStreamStatus("未获得完整结论");
  }
  setBusy(false);
  const chatLog = $("#chatLog");
  if (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 220) {
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function finishStreamError(msg) {
  state.streamDone = true;
  stopStreamTimer();
  $("#typingBubble")?.remove();
  setStreamStatus(msg);
  $("#streamTitle").textContent = "分析中断";
  addBubble("bot", `${msg}。可稍后重试，或切换到「经营速览」。`,
    `<span class="m-tag local">中断</span>`);
  setBusy(false);
}

function bindConsole() {
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
  $("#modeDeep").addEventListener("click", () => setMode("deep"));
  $("#modeQuick").addEventListener("click", () => setMode("quick"));
  $("#consoleLoginBtn").addEventListener("click", () =>
    openAuth("login", "登录后即可使用 InfiniSynapse 深度分析"));
  $("#chipCol").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-q]");
    if (btn) ask(btn.dataset.q);
  });
}

/* ---------------- 数据资产 ---------------- */

async function initData() {
  if (state.inited["/data"]) return;
  state.inited["/data"] = true;
  try {
    const j = await api("/api/datasets");
    renderDatasetCards(j.items || []);
  } catch (e) {
    toast("数据集加载失败：" + e.message);
    state.inited["/data"] = false;
  }
}

function renderDatasetCards(items) {
  $("#datasetCards").innerHTML = "";
  items.forEach((d) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dataset-card";
    btn.innerHTML = `
      <span class="ds-file">${escapeHtml(d.file)}</span>
      <h3>${escapeHtml(d.title)}</h3>
      <p>${escapeHtml(d.desc)}</p>
      <span class="ds-rows">${d.rows != null ? d.rows.toLocaleString("zh-CN") + " 行" : "Markdown"}</span>`;
    btn.addEventListener("click", () => {
      $$(".dataset-card").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      state.dataset.key = d.key;
      state.dataset.page = 1;
      loadDataset();
    });
    $("#datasetCards").appendChild(btn);
  });
}

async function loadDataset() {
  const { key, page, size } = state.dataset;
  if (!key) return;
  $("#datasetViewer").hidden = false;
  $("#datasetTableWrap").innerHTML = '<div class="skeleton sk-chart"></div>';
  try {
    const j = await api(`/api/datasets/${key}?page=${page}&size=${size}`);
    $("#datasetTitle").textContent = j.title;
    $("#datasetRows").textContent = j.kind === "table" ? `${j.total} 行 · 第 ${j.page}/${j.pages} 页` : "知识库";
    if (j.kind === "markdown") {
      $("#datasetDesc").textContent = "随任务一并上传给 Agent 的业务知识";
      $("#datasetTableWrap").innerHTML = `<div class="kb-view md-body">${renderMarkdown(j.content)}</div>`;
      $("#datasetPager").innerHTML = "";
      renderProfileChips(null);
    } else {
      const meta = { orders: "订单明细（近 90 天）", inventory: "库存水位", daily: "按日汇总" };
      $("#datasetDesc").textContent = meta[j.key] || "";
      const head = j.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
      const body = j.rows.map((r) => "<tr>" + j.columns.map((c) => {
        let v = r[c];
        let cls = "";
        if (c === "is_refund" && (v === 1 || v === "1")) { v = "退款"; cls = "refund-yes"; }
        return `<td class="${cls}">${v == null ? "" : escapeHtml(v)}</td>`;
      }).join("") + "</tr>").join("");
      $("#datasetTableWrap").innerHTML =
        `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
      $("#datasetPager").innerHTML = `
        <button type="button" id="pgPrev" ${j.page <= 1 ? "disabled" : ""}>上一页</button>
        <span class="pg-info">${j.page} / ${j.pages}</span>
        <button type="button" id="pgNext" ${j.page >= j.pages ? "disabled" : ""}>下一页</button>`;
      $("#pgPrev")?.addEventListener("click", () => { state.dataset.page--; loadDataset(); });
      $("#pgNext")?.addEventListener("click", () => { state.dataset.page++; loadDataset(); });
      loadProfileChips(j.key);
    }
  } catch (e) {
    $("#datasetTableWrap").innerHTML = `<div class="empty-note">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

async function loadProfileChips(key) {
  try {
    const p = await api(`/api/datasets/${key}/profile`);
    renderProfileChips(p);
  } catch (_) { renderProfileChips(null); }
}

function renderProfileChips(profile) {
  const chips = $("#profileChips");
  if (!chips) return;
  if (!profile) { chips.innerHTML = ""; return; }
  const numCols = profile.columns.filter((c) => c.kind === "num").slice(0, 6);
  const catCols = profile.columns.filter((c) => c.kind === "cat" && c.unique > 1 && c.unique <= 60).slice(0, 3);
  chips.innerHTML =
    numCols.map((c) => `
      <div class="pf-chip">
        <b>${escapeHtml(c.name)}</b>
        <span>均值 ${c.avg} · ${c.min} ~ ${c.max}</span>
      </div>`).join("") +
    catCols.map((c) => `
      <div class="pf-chip cat">
        <b>${escapeHtml(c.name)} <i>${c.unique} 类</i></b>
        <span>${c.top.slice(0, 2).map((t) => escapeHtml(t.v) + "×" + t.n).join(" · ")}</span>
      </div>`).join("");
}

/* ---------------- 分析历史 ---------------- */

async function initHistory(force = false) {
  if (!state.user) {
    $("#historyLock").hidden = false;
    $("#historyList").innerHTML = "";
    return;
  }
  $("#historyLock").hidden = true;
  if (state.inited["/history"] && !force) return;
  state.inited["/history"] = true;
  $("#historyList").innerHTML = '<div class="skeleton sk-line"></div><div class="skeleton sk-line"></div>';
  try {
    const j = await api("/api/history");
    renderHistory(j.items || [], j.total || 0);
  } catch (e) {
    if (isAuthError(e)) {
      clearAuth();
      $("#historyLock").hidden = false;
      $("#historyList").innerHTML = "";
      state.inited["/history"] = false;
    } else {
      $("#historyList").innerHTML = `<div class="empty-note">加载失败：${escapeHtml(e.message)}</div>`;
    }
  }
}

function renderHistory(items, total) {
  if (!items.length) {
    $("#historyList").innerHTML = `<div class="empty-note">还没有深度分析记录。去「AI 参谋」发起第一次深度分析吧。</div>`;
    return;
  }
  $("#historyList").innerHTML = items.map((it) => `
    <div class="history-item" data-id="${it.id}">
      <div class="h-q">${escapeHtml(it.question)}</div>
      <div class="h-ex">${escapeHtml(it.excerpt || "")}</div>
      <div class="h-meta">
        <span>${fmtTime(it.created_at)}</span>
        ${it.elapsed_sec != null ? `<span>耗时 ${it.elapsed_sec}s</span>` : ""}
        ${it.task_id ? `<span>task_id：<b>${escapeHtml(it.task_id)}</b></span>` : ""}
      </div>
    </div>`).join("");
  $$("#historyList .history-item").forEach((el) => {
    el.addEventListener("click", () => openHistoryDetail(el.dataset.id));
  });
}

async function openHistoryDetail(id) {
  try {
    const it = await api(`/api/history/${id}`);
    state.historyDetail = it;
    $("#historyQ").textContent = it.question;
    $("#historyMeta").innerHTML = [
      `<span>${fmtTime(it.created_at)}</span>`,
      `<span>引擎 <b>InfiniSynapse</b></span>`,
      it.elapsed_sec != null ? `<span>耗时 ${it.elapsed_sec}s</span>` : "",
      it.task_id ? `<span>task_id <b>${escapeHtml(it.task_id)}</b></span>` : "",
    ].join("");
    $("#historyAnswer").innerHTML = renderMarkdown(it.answer);
    $("#historyMask").hidden = false;
  } catch (e) {
    toast("读取失败：" + e.message);
  }
}

function bindHistoryModal() {
  $("#historyClose").addEventListener("click", () => { $("#historyMask").hidden = true; });
  $("#historyMask").addEventListener("click", (e) => { if (e.target === $("#historyMask")) $("#historyMask").hidden = true; });
  $("#historyLoginBtn").addEventListener("click", () => openAuth("login", "登录后查看你的 InfiniSynapse 分析历史"));
  $("#historyCopy").addEventListener("click", async () => {
    if (!state.historyDetail) return;
    try {
      await navigator.clipboard.writeText(state.historyDetail.answer);
      toast("已复制结论");
    } catch (_) { toast("复制失败，请手动选择文本"); }
  });
  $("#historyReask").addEventListener("click", () => {
    $("#historyMask").hidden = true;
    navigate("/console");
    if (state.historyDetail) {
      $("#askInput").value = state.historyDetail.question;
      $("#askInput").focus();
    }
  });
}

/* ---------------- 全局入口 ---------------- */

function bindGlobal() {
  $("#heroAskBtn").addEventListener("click", () => { navigate("/console"); setTimeout(() => $("#askInput").focus(), 250); });
  $("#briefAskBtn").addEventListener("click", () => {
    navigate("/console");
    ask("生成今日经营解读：关键指标表现、主要异常与今天应优先执行的 3 件事。");
  });
  $("#navBurger").addEventListener("click", () => $("#topNav").classList.toggle("mobile-open"));
  $("#closeEvidence").addEventListener("click", hideEvidence);
  $("#evidenceMask").addEventListener("click", hideEvidence);
}

async function loadHealth() {
  const pill = $("#healthPill");
  try {
    const j = await api("/api/health", { auth: false });
    if (j.infinisynapse_configured) {
      pill.textContent = "InfiniSynapse 引擎就绪";
      pill.className = "status-pill ok";
    } else {
      pill.textContent = "引擎未配置";
      pill.className = "status-pill bad";
    }
  } catch (_) {
    pill.textContent = "服务不可用";
    pill.className = "status-pill bad";
  }
}

/* ---------------- 高级特效：逐字 / 3D倾斜 / 追光 / 涟漪 ---------------- */

function splitHeroTitle() {
  const h1 = document.querySelector(".hero h1");
  if (!h1 || h1.dataset.split) return;
  h1.dataset.split = "1";
  const nodes = [...h1.childNodes];
  h1.textContent = "";
  let i = 0;
  const addChars = (text, cls) => {
    for (const ch of text) {
      const s = document.createElement("span");
      s.className = "ch" + (cls ? " " + cls : "");
      s.textContent = ch;
      s.style.setProperty("--d", (i * 0.048).toFixed(3) + "s");
      h1.appendChild(s);
      i++;
    }
  };
  nodes.forEach((n) => {
    if (n.nodeType === 3) addChars(n.textContent);
    else if (n.tagName === "BR") h1.appendChild(document.createElement("br"));
    else if (n.tagName === "EM") addChars(n.textContent, "em-ch");
  });
  // 保险丝：动画被系统偏好/异常打断时，强制字符可见
  setTimeout(() => {
    h1.querySelectorAll(".ch").forEach((s) => { s.style.opacity = "1"; s.style.transform = "none"; });
  }, 2600);
}

function initTilt() {
  const onMove = (el, max, e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", (px * max).toFixed(2) + "deg");
    el.style.setProperty("--rx", (-py * max).toFixed(2) + "deg");
  };
  const reset = (el) => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); };
  const panel = document.querySelector(".hero-panel");
  if (panel) {
    panel.addEventListener("mouseenter", () => panel.classList.add("tilting"));
    panel.addEventListener("mousemove", (e) => onMove(panel, 5, e));
    panel.addEventListener("mouseleave", () => { panel.classList.remove("tilting"); reset(panel); });
  }
  const row = $("#kpiRow");
  if (row) {
    row.addEventListener("mousemove", (e) => {
      const c = e.target.closest(".kpi");
      if (c) { c.classList.add("tilting"); onMove(c, 4, e); }
    });
    row.addEventListener("mouseout", (e) => {
      const c = e.target.closest(".kpi");
      if (c && !c.contains(e.relatedTarget)) { c.classList.remove("tilting"); reset(c); }
    });
  }
}

function initSpotlight() {
  document.addEventListener("mousemove", (e) => {
    const t = e.target.closest ? e.target.closest(".card, .kpi, .hero-panel") : null;
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty("--mx", (e.clientX - r.left).toFixed(1) + "px");
    t.style.setProperty("--my", (e.clientY - r.top).toFixed(1) + "px");
  });
}

function initRipple() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest(".btn-primary, .btn-ghost, .send-btn") : null;
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2.3;
    const s = document.createElement("span");
    s.className = "ripple" + (b.classList.contains("btn-primary") || b.classList.contains("send-btn") ? "" : " ink");
    s.style.width = s.style.height = d + "px";
    s.style.left = (e.clientX - r.left) + "px";
    s.style.top = (e.clientY - r.top) + "px";
    b.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  });
}

/* ---------------- 启动 ---------------- */

async function boot() {
  bindAuth();
  bindConsole();
  bindHistoryModal();
  bindGlobal();
  bindSentinelFilter();
  bindTicker();
  splitHeroTitle();
  initTilt();
  initSpotlight();
  initRipple();
  window.addEventListener("hashchange", () => {
    // 关闭可能打开的移动端导航
    $("#topNav").classList.remove("mobile-open");
  });
  loadHealth();
  await silentAuthCheck();
  route();
}

boot().catch((e) => {
  console.error(e);
  toast("初始化失败：" + e.message);
});
