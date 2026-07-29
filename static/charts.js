/* ShopMind · 轻量 SVG 图表库（零依赖）
 * 面积趋势 / 环形占比 / 横向条形 / 迷你折线 / 时段热力
 */
(function () {
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtDate(s) {
    const d = String(s);
    return d.length >= 10 ? d.slice(5) : d;
  }

  /* ---------- 面积趋势图 ---------- */
  function area(node, points, opts = {}) {
    const W = 760, H = opts.height || 240;
    const P = { l: 44, r: 14, t: 18, b: 26 };
    clear(node);
    node.classList.add("chart-host");

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "chart-svg" }, node);
    const gid = "g" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {}, svg);
    const lg = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": opts.color || "#4f46e5", "stop-opacity": 0.32 }, lg);
    el("stop", { offset: "100%", "stop-color": opts.color || "#4f46e5", "stop-opacity": 0.02 }, lg);

    const vals = points.map((p) => p.value);
    const max = Math.max(...vals) * 1.08 || 1;
    const min = Math.min(...vals, 0);
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const x = (i) => P.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v) => P.t + ih - ((v - min) / (max - min || 1)) * ih;

    // grid lines
    const gy = el("g", { class: "chart-grid" }, svg);
    for (let i = 0; i <= 3; i++) {
      const yy = P.t + (ih / 3) * i;
      el("line", { x1: P.l, x2: W - P.r, y1: yy, y2: yy }, gy);
      const valText = ((max - min) * (1 - i / 3) + min) || 0;
      const t = el("text", { x: P.l - 8, y: yy + 4, "text-anchor": "end", class: "chart-y" }, gy);
      t.textContent = opts.fmtY ? opts.fmtY(valText) : Math.round(valText).toLocaleString("zh-CN");
    }
    // x labels (sparse)
    const step = Math.ceil(points.length / 6);
    points.forEach((p, i) => {
      if (i % step !== 0 && i !== points.length - 1) return;
      const t = el("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "chart-x" }, svg);
      t.textContent = fmtDate(p.date);
    });

    // smooth path (catmull-rom → bezier)
    const pts = points.map((p, i) => [x(i), y(p.value)]);
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }

    const fillPath = el("path", {
      d: `${d} L ${pts[pts.length - 1][0].toFixed(1)} ${P.t + ih} L ${pts[0][0].toFixed(1)} ${P.t + ih} Z`,
      fill: `url(#${gid})`,
      class: "chart-area-fill",
    }, svg);

    const line = el("path", { d, fill: "none", stroke: opts.color || "#4f46e5", "stroke-width": 2.4, "stroke-linecap": "round", class: "chart-area-line" }, svg);

    // hover
    const hoverG = el("g", { visibility: "hidden" }, svg);
    const vLine = el("line", { y1: P.t, y2: P.t + ih, class: "chart-cross" }, hoverG);
    const dot = el("circle", { r: 4.5, fill: opts.color || "#4f46e5", stroke: "#fff", "stroke-width": 2 }, hoverG);

    const tips = el("g", {}, hoverG);
    const tipBg = el("rect", { rx: 8, class: "chart-tip-bg" }, tips);
    const tipText1 = el("text", { class: "chart-tip-t1" }, tips);
    const tipText2 = el("text", { class: "chart-tip-t2" }, tips);

    svg.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * W;
      let idx = Math.round(((sx - P.l) / iw) * (points.length - 1));
      idx = Math.max(0, Math.min(points.length - 1, idx));
      const [px, py] = pts[idx];
      hoverG.setAttribute("visibility", "visible");
      vLine.setAttribute("x1", px); vLine.setAttribute("x2", px);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      const label1 = points[idx].date;
      const label2 = (opts.fmtTip ? opts.fmtTip(points[idx].value) : String(points[idx].value));
      tipText1.textContent = label1;
      tipText2.textContent = label2;
      const w = Math.max(tipText1.getComputedTextLength?.() || 40, tipText2.getComputedTextLength?.() || 40) + 20;
      let tx = px + 10; if (tx + w > W - P.r) tx = px - w - 10;
      tipBg.setAttribute("x", tx); tipBg.setAttribute("y", Math.max(P.t, py - 46));
      tipBg.setAttribute("width", w); tipBg.setAttribute("height", 38);
      tipText1.setAttribute("x", tx + 10); tipText1.setAttribute("y", Math.max(P.t, py - 46) + 15);
      tipText2.setAttribute("x", tx + 10); tipText2.setAttribute("y", Math.max(P.t, py - 46) + 31);
    });
    svg.addEventListener("mouseleave", () => hoverG.setAttribute("visibility", "hidden"));

    // draw animation
    requestAnimationFrame(() => {
      try {
        const len = line.getTotalLength();
        line.style.strokeDasharray = len;
        line.style.strokeDashoffset = len;
        line.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.6,0,.2,1)";
        fillPath.style.opacity = 0;
        fillPath.style.transition = "opacity .6s ease .5s";
        requestAnimationFrame(() => {
          line.style.strokeDashoffset = 0;
          fillPath.style.opacity = 1;
        });
      } catch (_) { /* noop */ }
    });
  }

  /* ---------- 环形图 ---------- */
  const PALETTE = ["#0d9488", "#5ec4b0", "#6fb1d6", "#e2a052", "#a8b8a0", "#cf8f88", "#8fa3bf", "#a3b86b"];

  function donut(node, items, opts = {}) {
    clear(node);
    node.classList.add("donut-host");
    const size = opts.size || 200;
    const R = 74, C = 2 * Math.PI * R, sw = 22;
    const total = items.reduce((a, b) => a + b.value, 0) || 1;
    const svg = el("svg", { viewBox: "0 0 200 200", class: "donut-svg" }, node);

    let acc = 0;
    items.forEach((it, i) => {
      const frac = it.value / total;
      const seg = el("circle", {
        cx: 100, cy: 100, r: R, fill: "none",
        stroke: it.color || PALETTE[i % PALETTE.length],
        "stroke-width": sw,
        "stroke-dasharray": `${Math.max(frac * C - 2.5, 0.5)} ${C}`,
        "stroke-dashoffset": -acc * C + C * 0.25,
        "stroke-linecap": "butt",
        class: "donut-seg",
      }, svg);
      const tip = document.createElementNS(NS, "title");
      tip.textContent = `${it.label} ${opts.fmt ? opts.fmt(it.value) : it.value}`;
      seg.appendChild(tip);
      acc += frac;
    });

    const cGroup = el("g", { class: "donut-center" }, svg);
    const t1 = el("text", { x: 100, y: 96, "text-anchor": "middle", class: "donut-t1" }, cGroup);
    t1.textContent = opts.centerTitle || "";
    const t2 = el("text", { x: 100, y: 120, "text-anchor": "middle", class: "donut-t2" }, cGroup);
    t2.textContent = opts.centerValue || "";
    node.style.maxWidth = size + "px";
  }

  function legend(node, items, opts = {}) {
    node.innerHTML = items.map((it, i) => {
      const color = it.color || PALETTE[i % PALETTE.length];
      const pct = it.share != null ? `${it.share}%` : "";
      return `<li>
        <span class="lg-dot" style="background:${color}"></span>
        <span class="lg-name">${it.label}</span>
        <span class="lg-pct">${pct}</span>
        <span class="lg-val">${opts.fmt ? opts.fmt(it.value) : it.value}</span>
      </li>`;
    }).join("");
  }

  /* ---------- 横向条形 ---------- */
  function hbars(node, items, opts = {}) {
    const max = Math.max(...items.map((i) => i.value), 1);
    node.innerHTML = items.map((it, i) => `
      <div class="hbar-row">
        <div class="hbar-label" title="${it.label}">${it.label}</div>
        <div class="hbar-track">
          <div class="hbar-fill" style="width:0%" data-w="${(it.value / max * 100).toFixed(1)}" data-c="${it.color || PALETTE[i % PALETTE.length]}"></div>
        </div>
        <div class="hbar-val">${opts.fmt ? opts.fmt(it.value) : it.value}</div>
        ${it.sub ? `<div class="hbar-sub">${it.sub}</div>` : ""}
      </div>`).join("");
    requestAnimationFrame(() => {
      node.querySelectorAll(".hbar-fill").forEach((f) => {
        f.style.background = f.dataset.c;
        requestAnimationFrame(() => { f.style.width = f.dataset.w + "%"; });
      });
    });
  }

  /* ---------- 迷你折线 ---------- */
  function spark(node, values, opts = {}) {
    clear(node);
    const W = 120, H = opts.height || 36, P = 3;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "spark-svg" }, node);
    const max = Math.max(...values), min = Math.min(...values);
    const x = (i) => P + (values.length <= 1 ? (W - 2 * P) / 2 : (i / (values.length - 1)) * (W - 2 * P));
    const y = (v) => P + (H - 2 * P) - ((v - min) / (max - min || 1)) * (H - 2 * P);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    el("polyline", {
      points: pts, fill: "none",
      stroke: opts.color || "#4f46e5", "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }, svg);
    const last = values.length - 1;
    el("circle", { cx: x(last), cy: y(values[last]), r: 2.6, fill: opts.color || "#4f46e5" }, svg);
  }

  /* ---------- 健康度仪表 ---------- */
  function gauge(node, value, opts = {}) {
    clear(node);
    const v = Math.max(0, Math.min(100, value));
    const R = 84, CX = 110, CY = 104;
    const svg = el("svg", { viewBox: "0 0 220 120", class: "gauge-svg" }, node);
    // 背景弧（240°：从 150° 到 390°）
    const arc = (r, startDeg, endDeg) => {
      const p1 = [CX + r * Math.cos((startDeg * Math.PI) / 180), CY + r * Math.sin((startDeg * Math.PI) / 180)];
      const p2 = [CX + r * Math.cos((endDeg * Math.PI) / 180), CY + r * Math.sin((endDeg * Math.PI) / 180)];
      const large = endDeg - startDeg > 180 ? 1 : 0;
      return `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A ${r} ${r} 0 ${large} 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    };
    const START = 150, END = 390;
    el("path", { d: arc(R, START, END), fill: "none", stroke: "#e8ede4", "stroke-width": 14, "stroke-linecap": "round" }, svg);
    const gid = "gg" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {}, svg);
    const lg = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": opts.c1 || "#0f766e" }, lg);
    el("stop", { offset: "100%", "stop-color": opts.c2 || "#5ec4b0" }, lg);
    const valEnd = START + (END - START) * (v / 100);
    const valPath = el("path", {
      d: arc(R, START, valEnd), fill: "none", stroke: `url(#${gid})`,
      "stroke-width": 14, "stroke-linecap": "round", class: "gauge-val",
    }, svg);
    // 中心文字
    const t1 = el("text", { x: CX, y: CY - 6, "text-anchor": "middle", class: "gauge-num" }, svg);
    t1.textContent = v;
    const t2 = el("text", { x: CX, y: CY + 15, "text-anchor": "middle", class: "gauge-label" }, svg);
    t2.textContent = opts.label || "";
    // 动画
    requestAnimationFrame(() => {
      try {
        const len = valPath.getTotalLength();
        valPath.style.strokeDasharray = len;
        valPath.style.strokeDashoffset = len;
        valPath.style.transition = "stroke-dashoffset 1.2s cubic-bezier(.5,0,.2,1)";
        requestAnimationFrame(() => { valPath.style.strokeDashoffset = 0; });
      } catch (_) { /* noop */ }
    });
  }

  /* ---------- 时段热力 ---------- */
  function heat(node, hourly, opts = {}) {
    const max = Math.max(...hourly, 1);
    let html = '<div class="heat-grid">';
    hourly.forEach((v, h) => {
      const a = Math.pow(v / max, 0.6);
      html += `<div class="heat-cell" style="--a:${a.toFixed(2)};animation-delay:${(h * 26).toFixed(0)}ms" title="${h}:00 · ${v} 单"><i></i><span>${h % 3 === 0 ? h : ""}</span></div>`;
    });
    html += "</div>";
    node.innerHTML = html;
  }

  window.smCharts = { area, donut, legend, hbars, spark, heat, gauge, PALETTE };
})();
