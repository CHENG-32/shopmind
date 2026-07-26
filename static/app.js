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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Lightweight Markdown → HTML for AI answers.
 * Escapes raw HTML first, then restores intentional structure
 * (headings, lists, tables, code, emphasis, links).
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

  // Fenced code blocks
  text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
    return put(
      `<pre class="md-code"${langAttr}><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
    );
  });

  // Escape remaining raw HTML
  text = escapeHtml(text);

  // Restore stashed blocks (they are already safe HTML)
  text = text.replace(/\u0000MD(\d+)\u0000/g, (_, i) => stash[Number(i)]);

  // Inline code (after escape so content is safe)
  text = text.replace(/`([^`\n]+)`/g, (_, code) => `<code class="md-inline">${code}</code>`);

  // Images ![alt](url) — only http(s)
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt, url) => {
    return `<img class="md-img" src="${url}" alt="${alt}" loading="lazy" />`;
  });

  // Links [text](url) — only http(s)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    return `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold / italic (order matters; avoid lookbehind for broader browser support)
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/___([^_\n]+)___/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  // Horizontal rules
  text = text.replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "<hr class=\"md-hr\" />");

  // Blockquotes (line-level, then group)
  text = text.replace(/^&gt;\s?(.*)$/gm, '<div class="md-quote-line">$1</div>');

  // Headings
  text = text.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  text = text.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  text = text.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  text = text.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Tables: consecutive lines with |
  text = text.replace(/(^|\n)((?:\|.+\|\n)+)/g, (match, lead, block) => {
    const rows = block.trim().split("\n").filter(Boolean);
    if (rows.length < 2) return match;
    const isSep = (row) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row.trim());
    const parseRow = (row) =>
      row
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());

    let header = parseRow(rows[0]);
    let bodyStart = 1;
    if (rows[1] && isSep(rows[1])) {
      bodyStart = 2;
    } else {
      // No separator — treat first row as body-only simple table
      header = null;
      bodyStart = 0;
    }

    let html = '<div class="md-table-wrap"><table class="md-table">';
    if (header) {
      html += "<thead><tr>" + header.map((c) => `<th>${c}</th>`).join("") + "</tr></thead>";
    }
    html += "<tbody>";
    for (let i = bodyStart; i < rows.length; i++) {
      if (isSep(rows[i])) continue;
      const cells = parseRow(rows[i]);
      html += "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
    }
    html += "</tbody></table></div>";
    return lead + html + "\n";
  });

  // Lists: group consecutive list items
  const lines = text.split("\n");
  const out = [];
  let listType = null; // "ul" | "ol"
  let listBuf = [];

  const flushList = () => {
    if (!listType) return;
    const tag = listType;
    out.push(`<${tag} class="md-list">` + listBuf.map((li) => `<li>${li}</li>`).join("") + `</${tag}>`);
    listType = null;
    listBuf = [];
  };

  for (const line of lines) {
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ul) {
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listBuf.push(ul[1]);
      continue;
    }
    if (ol) {
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listBuf.push(ol[1]);
      continue;
    }
    flushList();
    out.push(line);
  }
  flushList();
  text = out.join("\n");

  // Group quote lines into blockquote
  text = text.replace(/(?:<div class="md-quote-line">[\s\S]*?<\/div>\n?)+/g, (block) => {
    const inner = block
      .replace(/<div class="md-quote-line">/g, "")
      .replace(/<\/div>\n?/g, "\n")
      .trim()
      .replace(/\n/g, "<br />");
    return `<blockquote class="md-quote">${inner}</blockquote>\n`;
  });

  // Paragraphs: split on blank lines; leave block elements alone
  const blocks = text.split(/\n{2,}/);
  text = blocks
    .map((block) => {
      const t = block.trim();
      if (!t) return "";
      if (/^<(h[1-6]|ul|ol|pre|table|blockquote|hr|div|p)\b/i.test(t)) return t;
      // Single-line already-wrapped block
      if (/^<\/?(h[1-6]|ul|ol|pre|table|blockquote|hr|div)/i.test(t)) return t;
      // Keep intentional single newlines as <br>
      return `<p>${t.replace(/\n/g, "<br />")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return text;
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
      pill.textContent = "分析引擎就绪";
      pill.classList.add("ok");
    } else {
      pill.textContent = "分析引擎暂不可用";
      pill.classList.add("bad");
    }
  } catch {
    const pill = $("#healthPill");
    pill.textContent = "服务暂时不可用";
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

  if (role === "bot") {
    // AI answers often arrive as Markdown — render structure, never raw HTML from model.
    const body = document.createElement("div");
    body.className = "md-body";
    body.innerHTML = renderMarkdown(text);
    div.appendChild(body);
  } else {
    // User messages stay plain text (no markdown injection).
    div.textContent = text;
  }

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
  // Progress stays inside the assistant column — never a full-page modal on entry.
  const panel = $("#thinkingInline");
  if (!panel) return;
  panel.hidden = false;
  const steps = [...$("#thinkingSteps").querySelectorAll("li")];
  steps.forEach((li, i) => {
    li.classList.toggle("active", i === 0);
    li.classList.remove("done");
  });
  $("#thinkingTitle").textContent = "正在深度分析";
  $("#thinkingDesc").textContent = "正在整理订单、库存与经营知识…";
  const bar = $("#thinkingBar");
  if (bar) {
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "progressMove 1.2s ease-in-out infinite, progressGrow 12s linear forwards";
  }

  let idx = 0;
  const descs = [
    "正在读取经营数据…",
    "正在理解你的问题…",
    "正在交叉比对门店与品类…",
    "正在定位异常与机会…",
    "正在整理洞察与行动建议…",
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
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function stopThinkingOverlay() {
  clearInterval(state.stepTimer);
  state.stepTimer = null;
  const panel = $("#thinkingInline");
  if (panel) panel.hidden = true;
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
        infinisynapse: "深度分析",
        local: "经营速览",
        local_fallback: "经营速览",
      }[j.source] || "掌柜参谋";
    const meta = [sourceLabel, j.elapsed_sec != null ? `${j.elapsed_sec}s` : null]
      .filter(Boolean)
      .join(" · ");
    addBubble("bot", j.answer || j.error || "暂时没有可用结论，请换个问法再试。", meta);
    focusAssistant();
    scrollChatToBottom(true);
    if (j.source === "infinisynapse") toast("分析完成");
  } catch (e) {
    removeTypingBubble();
    stopThinkingOverlay();
    addBubble("bot", "分析暂时失败，请稍后再试。");
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
    "你好，我是掌柜参谋。\n\n左侧可以查看经营异常与今日行动；点「查看证据链」可核对数据依据。\n\n直接用大白话提问即可，例如「哪家店最近在掉」「今天该先补什么货」。"
  );
  stopThinkingOverlay();
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
