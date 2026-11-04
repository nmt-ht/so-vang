(function () {
  const E = window.GoldEngine;
  const RAW = window.__SNAPSHOT__;
  const STANDALONE = window.__STANDALONE__ === true;
  const SITE_URL = 'https://nmt-ht.github.io/so-vang/';
  const $ = (id) => document.getElementById(id);
  const view = $('view');

  const VN_TYPES = { SJL1L10: 'SJC miếng', SJ9999: 'Nhẫn SJC', DOHNL: 'DOJI Hà Nội', PQHN24NTT: 'PNJ 24K', BT9999NTT: 'Bảo Tín 9999' };
  const TABS = ['tong-quan', 'ngay', 'dot', 'du-bao'];
  const RANGES = { vn: [['1T', 30], ['3T', 91], ['6T', 182], ['Tất cả', 0]], world: [['1T', 30], ['3T', 91], ['1N', 365], ['5N', 1826], ['10N', 0]] };
  const LIVE_KEY = 'sovang.live.v1';
  const UI_KEY = 'sovang.ui.v1';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* trình duyệt chặn lưu trữ: app vẫn chạy bình thường */ } },
  };

  const saved = store.get(UI_KEY) || {};
  const state = {
    tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tong-quan',
    market: saved.market === 'world' ? 'world' : 'vn',
    chartUsed: !!saved.chartUsed,
    type: VN_TYPES[saved.type] ? saved.type : 'SJL1L10',
    range: { vn: 182, world: 365 },
    waveRange: { vn: 0, world: 1826 },
    th: 5,
    waveLimit: 12,
    dayLimit: 10,
    day: null,
    horizon: 30,
    rangeFrom: null,
    rangeTo: null,
    scn: null,
    open: {},
    scroll: {},
  };

  // ---------- Dữ liệu ----------
  let live = store.get(LIVE_KEY) || { world: [], fx: [], vn: {}, at: null };
  let ds = null, memo = {};

  function merge(base, add) {
    if (!add || !add.length) return base;
    const m = new Map(base.map((r) => [r[0], r]));
    add.forEach((r) => m.set(r[0], r));
    return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  function rebuild() {
    ds = E.buildDataset({
      world: merge(RAW.world, live.world),
      fx: merge(RAW.fx, live.fx),
      vn: Object.fromEntries(Object.keys(RAW.vn).map((t) => [t, merge(RAW.vn[t], (live.vn || {})[t])])),
    });
    memo = {};
  }
  const cached = (key, fn) => (key in memo ? memo[key] : (memo[key] = fn()));
  const premium = () => cached('prem:' + state.type, () => E.premiumSeries(ds, state.type));

  // Chuỗi đang xem, thống nhất về {d, v}.
  function series(market = state.market) {
    return cached('s:' + market + ':' + state.type, () =>
      market === 'vn' ? ds.vn[state.type].map((r) => ({ d: r.d, v: r.sell, buy: r.buy, sell: r.sell, u: r.u })) : ds.world.map((r) => ({ d: r.d, v: r.p })));
  }

  // ---------- Định dạng ----------
  const num = (x, d = 1) => x.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const minus = (s) => s.replace('-', '−');
  const tr = (v, d = 1) => minus(num(v / 1e6, d));
  const usd = (v, d = 1) => (v < 0 ? '−' : '') + '$' + num(Math.abs(v), d);
  const pct = (x, d = 1) => {
    const r = +x.toFixed(d) || 0; // tránh hiện "−0,0%" khi giá trị làm tròn về 0
    return (r > 0 ? '+' : '') + minus(num(r, d)) + '%';
  };
  const signed = (s, x) => (x > 0 ? '+' : '') + minus(s);
  const fmtDate = (d) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const fmtShort = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
  const WEEKDAY = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const weekday = (d) => WEEKDAY[new Date(E.toTime(d)).getUTCDay()];
  const dirClass = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : 'flat');
  const arrow = (x) => (x > 0 ? '▲' : x < 0 ? '▼' : '■');
  const valFmt = (v, m = state.market) => (m === 'vn' ? tr(v) : usd(v));
  const unit = (m = state.market) => (m === 'vn' ? 'triệu đồng/lượng' : 'USD/oz');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const vnName = () => VN_TYPES[state.type];
  const mktName = (m = state.market) => (m === 'vn' ? vnName() : 'Vàng thế giới');
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const tP = (d) => E.toTime(d);
  const yTick = (m = state.market) => (v) => (m === 'vn' ? num(v / 1e6, 0) : '$' + num(v, 0));

  // ---------- Biểu đồ SVG ----------
  function niceTicks(min, max, count) {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(8));
    return out;
  }
  function thin(pts, maxN) {
    if (pts.length <= maxN) return pts;
    const size = pts.length / (maxN / 2);
    const out = [];
    for (let b = 0; b * size < pts.length; b++) {
      const seg = pts.slice(Math.floor(b * size), Math.floor((b + 1) * size));
      if (!seg.length) continue;
      let lo = seg[0], hi = seg[0];
      seg.forEach((p) => { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; });
      if (lo[0] < hi[0]) out.push(lo, hi); else if (lo === hi) out.push(lo); else out.push(hi, lo);
    }
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }
  function xLabel(t, spanDays) {
    const d = E.toDate(t);
    if (spanDays <= 120) return fmtShort(d);
    // Ghi rõ "T" để không lẫn với dạng ngày/tháng của khoảng ngắn.
    if (spanDays <= 800) return `T${+d.slice(5, 7)}/${d.slice(2, 4)}`;
    return d.slice(0, 4);
  }

  // Gợi ý kéo biểu đồ chỉ hiện đến lần dùng đầu tiên.
  function markChartUsed() {
    if (state.chartUsed) return;
    state.chartUsed = true;
    persist();
    document.querySelectorAll('.chart-hint').forEach((n) => n.remove());
  }

  // Chỉ một biểu đồ giữ con trỏ tại một thời điểm; chạm ra ngoài thì trở về giá trị mới nhất.
  let activeReset = null;
  document.addEventListener('pointerdown', (e) => {
    if (activeReset && !e.target.closest('.chart svg')) { activeReset(); activeReset = null; }
  });

  // o: {series:[{color,pts:[[t,v]],width,dash,area,noDot}], axis:[[t,v]], restIndex, restPrefix, bands, segments, shade, marker, markers,
  //     yFmt, tip(i)->{title,rows:[[nhãn,giá trị,màu]],dots}, height, ariaLabel, zero}
  function drawChart(host, o) {
    host.innerHTML = '';
    const W = Math.max(240, host.clientWidth || 320), H = o.height || 210;
    const m = { l: 4, r: 46, t: 8, b: 22 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const all = o.series.flatMap((s) => s.pts);
    const times = all.map((p) => p[0]);
    let vals = all.map((p) => p[1]);
    (o.bands || []).forEach((b) => b.pts.forEach((p) => { times.push(p[0]); vals.push(p[1], p[2]); }));
    if (o.zero) vals = vals.concat(0);
    if (!times.length) { host.innerHTML = '<p class="note">Không có dữ liệu trong khoảng này.</p>'; return; }
    const t0 = Math.min(...times), t1 = Math.max(...times);
    let y0 = Math.min(...vals), y1 = Math.max(...vals);
    const pad = (y1 - y0 || Math.abs(y1) * 0.02 || 1) * 0.08;
    y0 -= pad; y1 += pad;
    const X = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * pw;
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
    const P = (x) => x.toFixed(1);
    const line = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + P(X(p[0])) + ' ' + P(Y(p[1]))).join('');
    const surface = css('--color-surface');
    const dot = (x, y, color, r = 4.5) => `<circle cx="${P(x)}" cy="${P(y)}" r="${r}" fill="${color}" stroke="${surface}" stroke-width="2"/>`;

    let g = '';
    niceTicks(y0, y1, 4).forEach((v) => {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${P(Y(v))}" y2="${P(Y(v))}" stroke="var(--color-grid)"/>`;
      g += `<text x="${W - m.r + 6}" y="${P(Y(v) + 4)}">${esc(o.yFmt(v))}</text>`;
    });
    if (o.zero) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${P(Y(0))}" y2="${P(Y(0))}" stroke="var(--color-muted)"/>`;
    const spanDays = (t1 - t0) / 864e5;
    const nx = W < 340 ? 2 : 3;
    for (let i = 0; i <= nx; i++) {
      const t = t0 + ((t1 - t0) * i) / nx;
      const anchor = i === 0 ? 'start' : i === nx ? 'end' : 'middle';
      g += `<text x="${P(X(t))}" y="${H - 6}" text-anchor="${anchor}">${xLabel(t, spanDays)}</text>`;
    }
    if (o.shade) {
      const a = Math.max(o.shade.from, t0), b = Math.min(o.shade.to, t1);
      g += `<rect x="${P(X(a))}" y="${m.t}" width="${P(Math.max(1, X(b) - X(a)))}" height="${ph}" fill="var(--color-accent)" opacity="0.12"/>`;
    }
    (o.bands || []).forEach((b) => {
      const up = b.pts.map((p) => P(X(p[0])) + ' ' + P(Y(p[2])));
      const dn = [...b.pts].reverse().map((p) => P(X(p[0])) + ' ' + P(Y(p[1])));
      g += `<path d="M${up.join('L')}L${dn.join('L')}Z" fill="${b.color}" opacity="${b.opacity}"/>`;
    });
    const maxN = Math.round(pw * 1.2);
    o.series.forEach((s) => {
      const pts = thin(s.pts, maxN);
      if (s.area && pts.length) g += `<path d="${line(pts)}L${P(X(pts[pts.length - 1][0]))} ${m.t + ph}L${P(X(pts[0][0]))} ${m.t + ph}Z" fill="${s.color}" opacity="0.1"/>`;
      g += `<path d="${line(pts)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
    });
    (o.segments || []).forEach((s) => { g += `<path d="${line(thin(s.pts, maxN))}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`; });
    if (o.marker != null && o.marker >= t0 && o.marker <= t1) g += `<line x1="${P(X(o.marker))}" x2="${P(X(o.marker))}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--color-accent)" stroke-width="1.5"/>`;
    o.series.forEach((s) => {
      if (s.noDot || !s.pts.length) return;
      const e = s.pts[s.pts.length - 1];
      g += dot(X(e[0]), Y(e[1]), s.color);
    });
    (o.markers || []).forEach((mk) => { if (mk.t >= t0 && mk.t <= t1) g += dot(X(mk.t), Y(mk.v), mk.color); });

    const axis = o.axis || o.series[0].pts;
    const rest = o.restIndex != null ? o.restIndex : axis.length - 1;
    const prefix = o.restPrefix != null ? o.restPrefix : 'Mới nhất · ';

    const readout = document.createElement('div');
    readout.className = 'readout';
    host.appendChild(readout);
    const wrap = document.createElement('div');
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" tabindex="0" aria-label="${esc(o.ariaLabel || '')}">${g}<g class="cross"></g></svg>`;
    const svg = wrap.firstChild;
    host.appendChild(svg);
    const cross = svg.querySelector('.cross');
    if (!state.chartUsed && !document.querySelector('.chart-hint')) {
      const hint = document.createElement('p');
      hint.className = 'note chart-hint';
      hint.textContent = 'Chạm hoặc kéo ngang trên biểu đồ để xem từng ngày.';
      host.appendChild(hint);
    }

    function write(i, atRest) {
      const info = o.tip(i);
      readout.innerHTML = `<div class="readout-title">${atRest ? prefix : ''}${esc(info.title)}</div><div class="readout-rows">${info.rows.map((r) => `<span>${r[2] ? `<i style="background:${r[2]}"></i>` : ''}${esc(r[0])}<b>${esc(r[1])}</b></span>`).join('')}</div>`;
    }
    let cursor = -1, down = false, scrubbing = false, startX = 0, startY = 0;
    function show(i) {
      markChartUsed();
      cursor = Math.max(0, Math.min(axis.length - 1, i));
      const x = X(axis[cursor][0]);
      const info = o.tip(cursor);
      cross.innerHTML = `<line x1="${P(x)}" x2="${P(x)}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--color-muted)" stroke-dasharray="3 3"/>${(info.dots || []).map((d) => dot(x, Y(d.v), d.color)).join('')}`;
      write(cursor, false);
    }
    function reset() { cross.innerHTML = ''; cursor = -1; write(rest, true); }
    function nearest(clientX) {
      const r = svg.getBoundingClientRect();
      const t = t0 + ((((clientX - r.left) / r.width) * W - m.l) / pw) * (t1 - t0);
      let lo = 0, hi = axis.length - 1;
      while (lo < hi) { const c = (lo + hi) >> 1; if (axis[c][0] < t) lo = c + 1; else hi = c; }
      if (lo > 0 && t - axis[lo - 1][0] < axis[lo][0] - t) lo--;
      return lo;
    }
    reset();
    // Với cảm ứng, chỉ đổi số đọc khi chạm hoặc kéo ngang: ngón tay đặt lên biểu đồ để cuộn trang thì không đổi.
    svg.addEventListener('pointerdown', (e) => {
      if (activeReset && activeReset !== reset) { activeReset(); activeReset = null; }
      down = true; startX = e.clientX; startY = e.clientY;
      scrubbing = e.pointerType !== 'touch';
      if (scrubbing) { activeReset = reset; show(nearest(e.clientX)); }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!down && e.pointerType !== 'mouse') return;
      if (down && !scrubbing) {
        const dx = Math.abs(e.clientX - startX), dy = Math.abs(e.clientY - startY);
        if (dx < 6 || dx < dy) return;
        scrubbing = true;
      }
      activeReset = reset; show(nearest(e.clientX));
    });
    svg.addEventListener('pointerup', (e) => {
      if (down && !scrubbing) { activeReset = reset; show(nearest(e.clientX)); }
      down = false; scrubbing = false;
    });
    // Trình duyệt đã nhận thao tác để cuộn trang: trả số đọc về giá mới nhất.
    svg.addEventListener('pointercancel', () => {
      down = false; scrubbing = false;
      if (activeReset === reset) activeReset = null;
      reset();
    });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { down = false; scrubbing = false; reset(); } });
    svg.addEventListener('blur', () => { if (cursor >= 0 && !down) reset(); });
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show((cursor < 0 ? rest : cursor) + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') reset();
    });
  }

  const legend = (items) => `<div class="legend">${items.map((i) => `<span><i class="${i.dash ? 'dash' : ''}${i.swatch ? ' swatch' : ''}" style="background:${i.color};color:${i.color};${i.opacity ? `opacity:${i.opacity}` : ''}"></i>${esc(i.label)}</span>`).join('')}</div>`;

  function windowed(rows, days) {
    if (!days) return rows;
    const start = E.addDays(rows[rows.length - 1].d, -days);
    return rows.filter((r) => r.d >= start);
  }
  const rangeChips = (active, prefix) => `<div class="chips" role="group" aria-label="Khoảng thời gian">${RANGES[state.market].map(([lab, n]) => `<button id="${prefix}-${n}" class="chip" type="button" data-act="${prefix}:${n}" aria-pressed="${active === n}">${lab}</button>`).join('')}</div>`;

  // Mục mở rộng: nhớ trạng thái đóng mở và chỉ vẽ biểu đồ bên trong khi đã mở.
  const fold = (id, title, hint, inner) => `<details class="block" id="${id}"${state.open[id] ? ' open' : ''}><summary>${esc(title)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</summary><div class="stack">${inner}</div></details>`;
  function wireFold(id, onOpen) {
    const el = $(id);
    if (!el) return;
    let drawn = false;
    const draw = () => { if (onOpen && !drawn && el.isConnected) { drawn = true; onOpen(); } };
    if (el.open) draw();
    // Sự kiện toggle đến sau: phần tử có thể đã bị thay vì người dùng vừa đổi màn hình.
    el.addEventListener('toggle', () => { if (!el.isConnected) return; state.open[id] = el.open; if (el.open) draw(); });
  }

  function meter(o) {
    const span = o.high - o.low || 1;
    const at = (v) => Math.max(0, Math.min(100, ((v - o.low) / span) * 100)).toFixed(1);
    return `<div class="meter">
      <div class="meter-head"><span>${esc(o.label)}</span><b>${esc(o.value)}</b></div>
      <div class="meter-track" role="img" aria-label="${esc(`${o.label}: ${o.value}, thấp nhất ${o.lowText}, cao nhất ${o.highText}`)}">
        ${o.mark != null ? `<span class="meter-mark" style="left:${at(o.mark)}%"></span>` : ''}
        <span class="meter-dot" style="left:${at(o.now)}%"></span>
      </div>
      <div class="meter-ends"><span>${esc(o.lowText)}</span><span>${esc(o.highText)}</span></div>
      ${o.note ? `<p class="note">${esc(o.note)}</p>` : ''}
    </div>`;
  }

  // ---------- Tổng quan ----------
  function renderOverview() {
    const m = state.market;
    const rows = series();
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    const prem = premium(), lp = prem[prem.length - 1];
    const ch = last.v - prev.v, chp = (last.v / prev.v - 1) * 100;
    const fxNow = ds.fx[ds.fx.length - 1].v;
    const conv = ds.world[ds.world.length - 1].p * fxNow * E.OZ_PER_LUONG;

    const board = m === 'vn' ? `
      <div class="board-label">${esc(vnName())} · giá bán ra · ${fmtDate(last.d)}</div>
      <div class="price">${tr(last.v)}<small>triệu đồng/lượng</small></div>
      <div class="delta ${dirClass(ch)}">${arrow(ch)} ${signed(tr(Math.abs(ch)), ch)} triệu (${pct(chp)}) so với hôm trước</div>
      <dl class="board-grid">
        <div><dt>Mua vào</dt><dd>${tr(last.buy)} <span>triệu</span></dd></div>
        <div><dt>Chênh mua, bán</dt><dd>${tr(last.sell - last.buy)} <span>triệu</span></dd></div>
      </dl>` : `
      <div class="board-label">Vàng thế giới XAU/USD · ${fmtDate(last.d)}</div>
      <div class="price">${usd(last.v)}<small>/oz</small></div>
      <div class="delta ${dirClass(ch)}">${arrow(ch)} ${signed(usd(Math.abs(ch)), ch)} (${pct(chp)}) so với phiên trước</div>
      <dl class="board-grid">
        <div><dt>Quy đổi ra VND</dt><dd>${tr(conv)} <span>triệu/lượng</span></dd></div>
        <div><dt>USD/VND</dt><dd>${num(fxNow, 0)}</dd></div>
      </dl>`;

    const y = windowed(rows, 365).map((r) => r.v);
    const yHigh = Math.max(...y), yLow = Math.min(...y);
    const pv = prem.map((p) => p.pct), pMean = E.mean(pv), pMin = Math.min(...pv), pMax = Math.max(...pv);
    const pDiff = lp.pct - pMean;
    const pNote = Math.abs(pDiff) < 0.5 ? 'Gần mức trung bình.' : `${pDiff > 0 ? 'Cao hơn' : 'Thấp hơn'} mức trung bình ${num(Math.abs(pDiff), 1)} điểm phần trăm (vạch dọc).`;
    const waves = E.detectWaves(rows.map((r) => ({ d: r.d, p: r.v })), 5);
    const cw = waves[waves.length - 1];

    view.innerHTML = `
      <section class="board">${board}</section>
      <section class="block">
        <h2>Giá đang ở đâu</h2>
        ${meter({ label: `Trong ${m === 'vn' && rows.length < 365 ? rows.length + ' ngày qua' : '12 tháng qua'}`, value: valFmt(last.v) + (m === 'vn' ? ' triệu' : ''), now: last.v, low: yLow, high: yHigh, lowText: `Thấp nhất ${valFmt(yLow)}`, highText: `Cao nhất ${valFmt(yHigh)}`, note: `Cách đỉnh ${pct((last.v / yHigh - 1) * 100)}, cao hơn đáy ${pct((last.v / yLow - 1) * 100)}.` })}
        ${meter({ label: `${vnName()} cao hơn thế giới`, value: pct(lp.pct) + ` (${tr(lp.gap)} triệu)`, now: lp.pct, mark: pMean, low: pMin, high: pMax, lowText: `Thấp nhất ${pct(pMin)}`, highText: `Cao nhất ${pct(pMax)}`, note: pNote })}
        ${cw ? `<div class="fact"><span>Đợt hiện tại</span><b class="pill ${dirClass(cw.dir)}">${arrow(cw.dir)} ${cw.dir > 0 ? 'Tăng' : 'Giảm'} ${pct(cw.pct)}</b><p class="note">Bắt đầu ${fmtDate(cw.from)}, được ${cw.days} ngày.</p></div>` : ''}
      </section>
      <section class="block">
        <h2>${m === 'vn' ? 'So với giá thế giới' : 'Diễn biến giá'}</h2>
        ${rangeChips(state.range[m], 'range')}
        <div class="chart" id="ch-main"></div>
        <div id="lg-main"></div>
        ${m === 'vn' ? '<p class="note">Đơn vị triệu đồng/lượng. Giá thế giới quy đổi theo tỷ giá USD/VND, 1 lượng ≈ 1,2057 oz.</p>' : '<p class="note">Đơn vị USD/oz.</p>'}
      </section>
      ${fold('d-prem', 'Lịch sử chênh lệch', '', `<div class="chart" id="ch-prem"></div><p class="note">Phần trăm ${esc(vnName())} cao hơn giá thế giới quy đổi, ${prem.length} ngày qua.</p>`)}
      ${fold('d-tech', 'Chỉ số kỹ thuật', `RSI ${num(E.rsi(rows.map((r) => r.v))[rows.length - 1], 0)}`, analysisHtml())}
      ${fold('d-src', 'Nguồn dữ liệu', '', sourcesHtml())}`;

    const vis = windowed(rows, state.range[m]);
    if (m === 'vn') {
      const pw = windowed(prem, state.range[m]);
      const sjc = css('--color-sjc'), wc = css('--color-world');
      drawChart($('ch-main'), {
        ariaLabel: `Biểu đồ ${vnName()} và thế giới quy đổi, triệu đồng mỗi lượng. Mới nhất ${tr(last.v)} triệu.`,
        yFmt: yTick('vn'),
        series: [{ color: sjc, pts: pw.map((r) => [tP(r.d), r.sell]) }, { color: wc, pts: pw.map((r) => [tP(r.d), r.conv]) }],
        tip: (i) => ({ title: fmtDate(pw[i].d), rows: [['Bán ra', tr(pw[i].sell), sjc], ['Thế giới', tr(pw[i].conv), wc], ['Cao hơn', pct(pw[i].pct)]], dots: [{ v: pw[i].sell, color: sjc }, { v: pw[i].conv, color: wc }] }),
      });
      $('lg-main').innerHTML = legend([{ label: vnName() + ' bán ra', color: sjc }, { label: 'Thế giới quy đổi', color: wc }]);
    } else {
      const wc = css('--color-world'), mc = css('--color-muted');
      const ma50 = E.sma(rows.map((r) => r.v), 50);
      const offset = rows.length - vis.length;
      drawChart($('ch-main'), {
        ariaLabel: `Biểu đồ giá vàng thế giới, USD mỗi ounce. Mới nhất ${usd(last.v)}.`,
        yFmt: yTick('world'),
        series: [{ color: wc, pts: vis.map((r) => [tP(r.d), r.v]), area: true }, { color: mc, pts: vis.map((r, i) => [tP(r.d), ma50[offset + i]]).filter((p) => p[1] != null), width: 1.5, dash: '4 3', noDot: true }],
        tip: (i) => ({ title: fmtDate(vis[i].d), rows: [['Giá', usd(vis[i].v), wc]].concat(ma50[offset + i] != null ? [['MA50', usd(ma50[offset + i])]] : []), dots: [{ v: vis[i].v, color: wc }] }),
      });
      $('lg-main').innerHTML = legend([{ label: 'XAU/USD', color: wc }, { label: 'Trung bình 50 phiên (MA50)', color: mc, dash: true }]);
    }
    wireFold('d-prem', () => {
      const c = css('--color-sjc');
      drawChart($('ch-prem'), {
        height: 160, ariaLabel: 'Biểu đồ phần trăm chênh lệch giữa giá trong nước và thế giới', yFmt: (v) => num(v, 0) + '%',
        series: [{ color: c, pts: prem.map((r) => [tP(r.d), r.pct]), area: true }],
        tip: (i) => ({ title: fmtDate(prem[i].d), rows: [['Cao hơn', pct(prem[i].pct)], ['Tương đương', tr(prem[i].gap) + ' triệu']], dots: [{ v: prem[i].pct, color: c }] }),
      });
    });
    wireFold('d-tech');
    wireFold('d-src');
  }

  function analysisHtml() {
    const m = state.market, rows = series();
    const v = rows.map((r) => r.v), n = v.length, last = v[n - 1];
    const perYear = m === 'vn' ? 365 : 252;
    const sessions = m === 'vn' ? 'ngày' : 'phiên';
    const ma20 = E.sma(v, 20)[n - 1], ma50 = E.sma(v, 50)[n - 1], rsi = E.rsi(v)[n - 1];
    const vol = E.annualVol(v, 21, perYear);
    const peak = Math.max(...v), peakD = rows[v.lastIndexOf(peak)].d;
    const rsiText = rsi >= 70 ? 'Vùng quá mua: giá đã tăng nhanh trong ngắn hạn' : rsi <= 30 ? 'Vùng quá bán: giá đã giảm nhanh trong ngắn hạn' : 'Vùng trung tính';
    const posText = (a) => `Giá hiện ${last >= a ? 'trên' : 'dưới'} đường này, lệch ${pct((last / a - 1) * 100)}`;
    const row = (k, val, sub) => `<div><dt>${esc(k)}</dt><dd>${val}</dd>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
    return `<dl class="rows">
      ${row(`Trung bình 20 ${sessions}`, valFmt(ma20), posText(ma20))}
      ${row(`Trung bình 50 ${sessions}`, valFmt(ma50), posText(ma50))}
      ${row('RSI 14', num(rsi, 0), rsiText)}
      ${row(`Biến động 21 ${sessions}`, num(vol, 1) + '%/năm', 'Càng cao thì giá dao động càng mạnh')}
      ${row(m === 'vn' ? 'Đỉnh trong dữ liệu' : 'Đỉnh 10 năm', valFmt(peak), `Đạt ngày ${fmtDate(peakD)}, giá hiện cách đỉnh ${pct((last / peak - 1) * 100)}`)}
    </dl>`;
  }

  function sourcesHtml() {
    return `<div class="fine stack">
      <p>Giá vàng Việt Nam và giá giao ngay XAU/USD từ 23/11/2025 lấy từ <a href="https://www.vang.today/en/api" target="_blank" rel="noopener">vang.today</a>. Giá thế giới trước đó là hợp đồng tương lai GC=F trên Yahoo Finance, lệch khoảng ${num(RAW.futuresVsSpotPct || 0.4, 1)}% so với giá giao ngay. Tỷ giá lấy từ Yahoo Finance và open.er-api.com.</p>
      <p>Mỗi ngày lấy mức giá cuối cùng mà nguồn ghi nhận, nên có thể khác giá ở tiệm. Giá thế giới không có thứ bảy, chủ nhật vì thị trường nghỉ.</p>
    </div>`;
  }

  // ---------- Theo ngày ----------
  function renderDay() {
    const rows = series();
    const first = rows[0].d, lastD = rows[rows.length - 1].d;
    if (!state.day || state.day > lastD || state.day < first) state.day = lastD;
    view.innerHTML = `
      <section class="block">
        <h2>Xem theo ngày</h2>
        <div class="day-nav">
          <button id="day-prev" type="button" data-act="daystep:-1" aria-label="Ngày trước">‹</button>
          <input id="day-input" type="date" aria-label="Chọn ngày" min="${first}" max="${lastD}" value="${state.day}">
          <button id="day-next" type="button" data-act="daystep:1" aria-label="Ngày sau">›</button>
        </div>
        <p class="note">Có dữ liệu từ ${fmtDate(first)}.${state.market === 'vn' ? ` Xem xa hơn ở Thế giới, từ ${fmtDate(ds.world[0].d)}.` : ''}</p>
        <button id="day-latest" class="text-btn more-btn" type="button" data-act="day:${lastD}">Về ngày mới nhất</button>
      </section>
      <div id="day-body" class="stack"></div>
      <section class="block">
        <h2>Các ngày gần đây</h2>
        <div id="day-list"></div>
        <button id="day-more" class="text-btn more-btn" type="button" data-act="daymore:1">Xem thêm</button>
      </section>`;
    syncDay();
    renderDayList();
  }

  function dayDetailHtml(d, chartId) {
    const m = state.market, rows = series();
    let idx = rows.findIndex((r) => r.d === d);
    let note = '';
    if (idx < 0) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].d <= d) { idx = i; break; }
      note = `${weekday(d)} thị trường thế giới nghỉ, dùng phiên ${fmtDate(rows[idx].d)}.`;
    }
    const r = rows[idx], pr = rows[idx - 1];
    const ch = pr ? r.v - pr.v : 0, chp = pr ? (r.v / pr.v - 1) * 100 : 0;
    const wAt = E.asOfLookup(ds.world, 'p')(d), fxAt = E.asOfLookup(ds.fx, 'v')(d);
    const inVn = d >= ds.vn.SJL1L10[0].d;
    const vnRows = Object.keys(VN_TYPES).map((t) => {
      const list = ds.vn[t], i = list.findIndex((x) => x.d === d);
      if (i < 0) return '';
      const c = i > 0 ? list[i].sell - list[i - 1].sell : 0;
      return `<tr class="${t === state.type ? 'hl' : ''}"><td>${esc(VN_TYPES[t])}</td><td>${tr(list[i].buy)}</td><td>${tr(list[i].sell)}</td><td class="${dirClass(c)}">${c ? arrow(c) + ' ' + tr(Math.abs(c)) : '■ 0'}</td></tr>`;
    }).join('');
    const p = inVn ? premium().find((x) => x.d === d) : null;

    return {
      idx,
      html: `
      <section class="board">
        <div class="board-label">${esc(mktName())} · ${weekday(d)}, ${fmtDate(d)}</div>
        <div class="price">${m === 'vn' ? tr(r.v) : usd(r.v)}<small>${m === 'vn' ? 'triệu đồng/lượng' : '/oz'}</small></div>
        ${pr ? `<div class="delta ${dirClass(ch)}">${arrow(ch)} ${m === 'vn' ? signed(tr(Math.abs(ch)), ch) + ' triệu' : signed(usd(Math.abs(ch)), ch)} (${pct(chp)}) so với ${m === 'vn' ? 'hôm trước' : 'phiên trước'}</div>` : ''}
        ${note ? `<div class="board-label">${esc(note)}</div>` : ''}
        <dl class="board-grid">
          ${m === 'vn' ? `<div><dt>Mua vào</dt><dd>${tr(r.buy)} <span>triệu</span></dd></div><div><dt>Số lần cập nhật giá</dt><dd>${r.u || '–'} <span>lần</span></dd></div>` : ''}
          <div><dt>Thế giới</dt><dd>${usd(wAt)} <span>/oz</span></dd></div>
          <div><dt>USD/VND</dt><dd>${fxAt ? num(fxAt, 0) : '–'}</dd></div>
          ${p ? `<div><dt>Thế giới quy đổi</dt><dd>${tr(p.conv)} <span>triệu</span></dd></div><div><dt>${esc(vnName())} cao hơn</dt><dd>${pct(p.pct)}</dd></div>` : ''}
        </dl>
      </section>
      <section class="block">
        <h2>Diễn biến quanh ngày này</h2>
        <div class="chart" id="${chartId}"></div>
        <p class="note">Vạch dọc là ngày đang xem. Đơn vị ${unit()}.</p>
      </section>
      ${inVn && vnRows ? `<section class="block"><h2>Bảng giá trong nước</h2><div class="table-scroll"><table><thead><tr><th scope="col">Triệu đồng/lượng</th><th scope="col">Mua</th><th scope="col">Bán</th><th scope="col">Đổi</th></tr></thead><tbody>${vnRows}</tbody></table></div></section>`
        : '<p class="note">Nguồn dữ liệu chưa có giá vàng Việt Nam cho ngày này.</p>'}`,
    };
  }

  function drawDayChart(chartId, idx) {
    const m = state.market, rows = series();
    const r = rows[idx];
    const from = Math.max(0, idx - 30), to = Math.min(rows.length, idx + 31);
    const win = rows.slice(from, to);
    const color = m === 'vn' ? css('--color-sjc') : css('--color-world');
    drawChart($(chartId), {
      height: 170, marker: tP(r.d), restIndex: idx - from, restPrefix: 'Ngày đang xem · ',
      ariaLabel: `Biểu đồ giá quanh ngày ${fmtDate(r.d)}`, yFmt: yTick(),
      series: [{ color, pts: win.map((x) => [tP(x.d), x.v]), noDot: true }],
      markers: [{ t: tP(r.d), v: r.v, color }],
      tip: (i) => ({ title: fmtDate(win[i].d), rows: [['Giá', valFmt(win[i].v), color]], dots: [{ v: win[i].v, color }] }),
    });
  }

  // Cập nhật phần chi tiết tại chỗ. Ô chọn ngày không bị vẽ lại, để bánh xe chọn ngày trên iPhone không tự đóng.
  function syncDay() {
    const rows = series(), d = state.day;
    const body = dayDetailHtml(d, 'ch-day');
    $('day-body').innerHTML = body.html;
    drawDayChart('ch-day', body.idx);
    $('day-prev').disabled = d <= rows[0].d;
    $('day-next').disabled = d >= rows[rows.length - 1].d;
    $('day-latest').hidden = d >= rows[rows.length - 1].d;
    document.querySelectorAll('#day-list .list-btn').forEach((b) => b.setAttribute('aria-current', b.dataset.act === 'dayopen:' + d));
  }

  function renderDayList() {
    const rows = series();
    const n = Math.min(state.dayLimit, rows.length - 1);
    const recent = rows.slice(-n).map((x, i) => {
      const q = rows[rows.length - n + i - 1];
      return { ...x, c: q ? (x.v / q.v - 1) * 100 : 0 };
    }).reverse();
    $('day-list').innerHTML = recent.map((x) => `<button class="list-btn" type="button" data-act="dayopen:${x.d}" aria-current="${x.d === state.day}"><span class="ld">${fmtDate(x.d)}</span><span class="lv">${valFmt(x.v)}</span><span class="pill ${dirClass(x.c)}">${arrow(x.c)} ${pct(x.c)}</span></button>`).join('');
    $('day-more').hidden = state.dayLimit >= rows.length - 1;
  }

  function stepDay(dir) {
    const rows = series();
    let d = state.day;
    if (state.market === 'vn') d = E.addDays(d, dir);
    else {
      const next = dir > 0 ? rows.find((r) => r.d > d) : [...rows].reverse().find((r) => r.d < d);
      if (next) d = next.d;
    }
    if (d < rows[0].d || d > rows[rows.length - 1].d) return;
    state.day = d;
    $('day-input').value = d;
    syncDay();
  }

  // ---------- Theo đợt ----------
  function crossStats(from, to) {
    const out = [];
    const chg = (rows, field) => {
      const a = rows.filter((r) => r.d >= from && r.d <= to);
      return a.length >= 2 ? (a[a.length - 1][field] / a[0][field] - 1) * 100 : null;
    };
    if (state.market === 'world') {
      const v = chg(ds.vn[state.type], 'sell');
      if (v != null) out.push([`${vnName()} cùng kỳ`, pct(v)]);
    } else {
      const v = chg(ds.world, 'p');
      if (v != null) out.push(['Thế giới cùng kỳ', pct(v)]);
    }
    const f = chg(ds.fx, 'v');
    if (f != null) out.push(['USD/VND cùng kỳ', pct(f)]);
    const prem = premium().filter((p) => p.d >= from && p.d <= to);
    if (prem.length >= 2) out.push(['Cao hơn thế giới', `${pct(prem[0].pct)} → ${pct(prem[prem.length - 1].pct)}`]);
    return out;
  }

  function periodRows(rows, from, to) {
    const a = rows.filter((r) => r.d >= from && r.d <= to);
    if (a.length < 2) return null;
    const v = a.map((r) => r.v);
    return {
      from: a[0].d, to: a[a.length - 1].d, days: E.daysBetween(a[0].d, a[a.length - 1].d),
      start: v[0], end: v[v.length - 1], pct: (v[v.length - 1] / v[0] - 1) * 100,
      high: Math.max(...v), low: Math.min(...v), dd: E.maxDrawdown(v),
      vol: E.annualVol(v, v.length, state.market === 'vn' ? 365 : 252),
    };
  }

  function periodHtml(p) {
    const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    return `<dl class="rows">
      ${row('Thay đổi', `<span class="pill ${dirClass(p.pct)}">${arrow(p.pct)} ${pct(p.pct)}</span>`)}
      ${row('Giá đầu, giá cuối', `${valFmt(p.start)} → ${valFmt(p.end)}`)}
      ${row('Thời gian', p.days + ' ngày')}
      ${row('Cao nhất, thấp nhất', `${valFmt(p.high)} · ${valFmt(p.low)}`)}
      ${row('Sụt mạnh nhất từ đỉnh', pct(p.dd))}
      ${p.vol != null ? row('Biến động', num(p.vol, 1) + '%/năm') : ''}
      ${crossStats(p.from, p.to).map((c) => row(c[0], c[1])).join('')}
    </dl>`;
  }

  const allWaves = () => cached('w:' + state.market + state.type + state.th, () => E.detectWaves(series().map((r) => ({ d: r.d, p: r.v })), state.th));

  function renderWaves() {
    const m = state.market, rows = series();
    const waves = allWaves();
    const days = state.waveRange[m];
    const startD = days ? E.addDays(rows[rows.length - 1].d, -days) : rows[0].d;
    const shown = waves.filter((w) => w.to >= startD);
    const sum = E.waveSummary(shown);
    const stat = (s, lab, cls) => (s
      ? `<div><span class="k ${cls}">${arrow(cls === 'up' ? 1 : -1)} ${lab}</span><span class="v">${pct(s.avgPct)}</span><span class="s">Trung bình ${num(s.avgDays, 0)} ngày, ${s.n} đợt</span></div>`
      : `<div><span class="k ${cls}">${arrow(cls === 'up' ? 1 : -1)} ${lab}</span><span class="s">Chưa có đợt nào kết thúc</span></div>`);
    const list = [...shown].reverse().slice(0, state.waveLimit);

    view.innerHTML = `
      <section class="block">
        <h2>Các đợt tăng, giảm của ${esc(mktName())}</h2>
        <p class="note">Một đợt kết thúc khi giá quay đầu quá mức bạn chọn dưới đây.</p>
        <div class="chips" role="group" aria-label="Mức quay đầu để tính là đợt mới">
          ${[[3, 'Nhỏ 3%'], [5, 'Vừa 5%'], [10, 'Lớn 10%']].map(([t, l]) => `<button id="th-${t}" class="chip" type="button" data-act="th:${t}" aria-pressed="${state.th === t}">${l}</button>`).join('')}
        </div>
        ${m === 'world' ? rangeChips(days, 'wrange') : ''}
        <div class="chart" id="ch-wave"></div>
        ${legend([{ label: 'Đợt tăng', color: css('--color-up') }, { label: 'Đợt giảm', color: css('--color-down') }])}
      </section>
      <section class="stat-pair">${stat(sum.up, 'Đợt tăng', 'up')}${stat(sum.down, 'Đợt giảm', 'down')}</section>
      <section class="block">
        <h2>${shown.length} đợt, mới nhất trước</h2>
        <div>${list.map((w) => `<button class="wave-btn" type="button" data-act="wave:${w.from}">
          <span class="pill ${dirClass(w.dir)}" aria-label="${w.dir > 0 ? 'Đợt tăng' : 'Đợt giảm'}">${arrow(w.dir)}</span>
          <span class="wd">${fmtShort(w.from)}/${w.from.slice(2, 4)} → ${fmtShort(w.to)}/${w.to.slice(2, 4)}</span>
          <span class="wp ${dirClass(w.dir)}">${pct(w.pct)}</span>
          <span class="wm">${w.days} ngày · ${valFmt(w.startP)} → ${valFmt(w.endP)}${w.ongoing ? ' · đang diễn ra' : ''}</span>
        </button>`).join('') || '<p class="note">Giá chưa quay đầu đủ mức này trong khoảng đang xem.</p>'}</div>
        ${shown.length > state.waveLimit ? `<button id="wave-more" class="text-btn more-btn" type="button" data-act="wavemore:1">Xem thêm ${Math.min(20, shown.length - state.waveLimit)} đợt</button>` : ''}
      </section>
      ${fold('d-range', 'Tự chọn khoảng ngày', '', `
        <div class="date-pair">
          <label for="range-from">Từ ngày<input id="range-from" type="date" min="${rows[0].d}" max="${rows[rows.length - 1].d}" value="${state.rangeFrom || E.addDays(rows[rows.length - 1].d, -90)}"></label>
          <label for="range-to">Đến ngày<input id="range-to" type="date" min="${rows[0].d}" max="${rows[rows.length - 1].d}" value="${state.rangeTo || rows[rows.length - 1].d}"></label>
        </div>
        <div id="range-result"></div>`)}`;

    const up = css('--color-up'), dn = css('--color-down'), base = css('--color-muted');
    const vis = rows.filter((r) => r.d >= startD);
    drawChart($('ch-wave'), {
      ariaLabel: 'Biểu đồ các đợt tăng giảm giá vàng', yFmt: yTick(),
      series: [{ color: base, pts: vis.map((r) => [tP(r.d), r.v]), width: 1, noDot: true }],
      segments: shown.map((w) => ({
        color: w.dir > 0 ? up : dn,
        pts: rows.slice(w.i0, w.i1 + 1).filter((r) => r.d >= startD).map((r) => [tP(r.d), r.v]),
      })).filter((s) => s.pts.length > 1),
      tip: (i) => {
        const w = waves.find((x) => vis[i].d >= x.from && vis[i].d <= x.to);
        return { title: fmtDate(vis[i].d), rows: [['Giá', valFmt(vis[i].v)]].concat(w ? [[w.dir > 0 ? 'Trong đợt tăng' : 'Trong đợt giảm', pct(w.pct)]] : []), dots: [{ v: vis[i].v, color: w ? (w.dir > 0 ? up : dn) : base }] };
      },
    });
    wireFold('d-range', renderRange);
  }

  function openWave(from) {
    const rows = series();
    const w = allWaves().find((x) => x.from === from);
    if (!w) return;
    openSheet(`Đợt ${w.dir > 0 ? 'tăng' : 'giảm'} ${fmtShort(w.from)} đến ${fmtShort(w.to)}${w.ongoing ? ', đang diễn ra' : ''}`,
      `<div class="chart" id="ch-sheet"></div>${periodHtml(periodRows(rows, w.from, w.to))}`, () => {
        const pad = Math.max(5, Math.round(w.days * 0.25));
        const a = E.addDays(w.from, -pad), b = E.addDays(w.to, pad);
        const vis = rows.filter((r) => r.d >= a && r.d <= b);
        const color = w.dir > 0 ? css('--color-up') : css('--color-down');
        const inWave = rows.filter((r) => r.d >= w.from && r.d <= w.to);
        drawChart($('ch-sheet'), {
          height: 170, ariaLabel: `Biểu đồ đợt từ ${fmtDate(w.from)} đến ${fmtDate(w.to)}`, yFmt: yTick(),
          shade: { from: tP(w.from), to: tP(w.to) },
          restIndex: vis.findIndex((r) => r.d === w.to), restPrefix: 'Cuối đợt · ',
          series: [{ color: css('--color-muted'), pts: vis.map((r) => [tP(r.d), r.v]), width: 1, noDot: true }],
          segments: [{ color, width: 3, pts: inWave.map((r) => [tP(r.d), r.v]) }],
          tip: (i) => ({ title: fmtDate(vis[i].d), rows: [['Giá', valFmt(vis[i].v)]], dots: [{ v: vis[i].v, color }] }),
        });
      });
  }

  function renderRange() {
    const el = $('range-result');
    if (!el) return;
    const a = $('range-from').value, b = $('range-to').value;
    state.rangeFrom = a; state.rangeTo = b;
    if (!a || !b) { el.innerHTML = '<p class="note">Chọn đủ ngày bắt đầu và ngày kết thúc.</p>'; return; }
    if (a >= b) { el.innerHTML = '<p class="note">Ngày bắt đầu cần sớm hơn ngày kết thúc.</p>'; return; }
    const p = periodRows(series(), a, b);
    el.innerHTML = p ? periodHtml(p) : '<p class="note">Khoảng này có ít hơn 2 ngày dữ liệu. Chọn khoảng dài hơn.</p>';
  }

  // ---------- Dự báo ----------
  const fc = () => cached('fc:' + state.market + state.type, () => (state.market === 'vn' ? E.forecastVN(ds, state.type) : E.forecastWorld(ds.world)));
  const bt = () => cached('bt:' + state.market + state.type, () => (state.market === 'vn' ? E.backtestVN(ds, state.type) : E.backtestWorld(ds.world)));

  function verdict(r) {
    if (!r || r.tooFew) return '<span class="pill gold">Chưa đủ</span>';
    if (r.skill >= 3) return '<span class="pill up">Nhỉnh hơn</span>';
    if (r.skill <= -3) return '<span class="pill down">Kém hơn</span>';
    return '<span class="pill gold">Ngang nhau</span>';
  }

  function renderForecast() {
    const m = state.market, rows = series(), F = fc();
    const f = F.find((x) => x.cal === state.horizon) || F[1];
    const lastV = rows[rows.length - 1].v;
    const when = f.cal === 1 ? 'ngày mai' : `sau ${f.cal} ngày, ${fmtDate(f.date)}`;
    const q = (v) => (m === 'vn' ? tr(v) : usd(v, 0));

    let lagLine = '';
    if (m === 'vn') {
      const pr = premium();
      const lastChange = (pr[pr.length - 1].conv / pr[pr.length - 2].conv - 1) * 100;
      const move = Math.abs(lastChange) < 0.05 ? 'gần như đứng giá' : `${lastChange > 0 ? 'tăng' : 'giảm'} ${num(Math.abs(lastChange), 2)}%`;
      lagLine = `<p class="note">Giá thế giới quy đổi hôm nay ${move}. ${esc(vnName())} thường đi theo khoảng ${num((F[0].k || 0) * 100, 0)}% mức thay đổi đó vào hôm sau.</p>`;
    }

    view.innerHTML = `
      <section class="board">
        <div class="board-label">${esc(mktName())} · ${when}</div>
        <div class="price range">${q(f.lo80)} – ${q(f.hi80)}${m === 'vn' ? '<small>triệu/lượng</small>' : ''}</div>
        <div class="delta flat">Khả năng 80% giá nằm trong khoảng này. Giá hiện tại ${q(lastV)}${m === 'vn' ? ' triệu' : ''}.</div>
        <dl class="board-grid">
          <div><dt>Giữa khoảng</dt><dd>${q(f.point)} <span>${pct((f.point / lastV - 1) * 100)}</span></dd></div>
          <div><dt>Khoảng rộng hơn, 95%</dt><dd>${q(f.lo95)} – ${q(f.hi95)}</dd></div>
        </dl>
      </section>
      <section class="block">
        <div class="chips" role="group" aria-label="Kỳ dự báo">
          ${F.map((x) => `<button id="hz-${x.cal}" class="chip" type="button" data-act="hz:${x.cal}" aria-pressed="${x.cal === f.cal}">${x.cal} ngày</button>`).join('')}
        </div>
        <div class="chart" id="ch-fc"></div>
        <div id="lg-fc"></div>
        ${lagLine}
      </section>
      <section class="block" id="bt-block">
        <h2>Mô hình đáng tin đến đâu</h2>
        <p class="note">Đang kiểm tra trên dữ liệu quá khứ…</p>
      </section>
      <section class="block">
        <h2>Tính thử theo kịch bản</h2>
        <div id="scn"></div>
      </section>
      ${fold('d-all', 'Bảng dự báo tất cả các kỳ', '', `<div class="table-scroll"><table>
          <thead><tr><th scope="col">Kỳ</th><th scope="col">Giữa</th><th scope="col">Khoảng 80%</th><th scope="col">Khoảng 95%</th></tr></thead>
          <tbody>${F.map((x) => { const s = (v) => (m === 'vn' ? tr(v) : num(v, 0)); return `<tr class="${x.cal === f.cal ? 'hl' : ''}"><td>${x.cal} ngày</td><td>${s(x.point)}</td><td>${s(x.lo80)}–${s(x.hi80)}</td><td>${s(x.lo95)}–${s(x.hi95)}</td></tr>`; }).join('')}</tbody>
        </table></div><p class="note">Đơn vị ${unit()}.</p>`)}
      <p class="note">Đây là thống kê từ dữ liệu quá khứ, không phải khuyến nghị mua bán. Tin tức và chính sách có thể đưa giá ra ngoài các khoảng trên.</p>`;

    drawForecastChart(f, F);
    renderScenario();
    wireFold('d-all');
    setTimeout(() => { if (state.tab === 'du-bao' && $('bt-block')) renderBacktest(); }, 30);
  }

  function drawForecastChart(f, F) {
    const m = state.market, rows = series();
    const color = m === 'vn' ? css('--color-sjc') : css('--color-world');
    const hist = rows.slice(-Math.max(45, m === 'vn' ? f.cal * 2 : Math.round(f.cal * 1.4)));
    const last = rows[rows.length - 1];
    const anchors = [{ cal: 0, point: last.v, lo80: last.v, hi80: last.v, lo95: last.v, hi95: last.v }, ...F.filter((x) => x.cal <= f.cal)];
    const lerp = (a, b, k, key) => a[key] + (b[key] - a[key]) * k;
    const future = [];
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i], b = anchors[i + 1];
      for (let c = a.cal + 1; c <= b.cal; c++) {
        const k = (c - a.cal) / (b.cal - a.cal);
        const date = E.addDays(last.d, c);
        future.push({ d: date, t: tP(date), point: lerp(a, b, k, 'point'), lo80: lerp(a, b, k, 'lo80'), hi80: lerp(a, b, k, 'hi80'), lo95: lerp(a, b, k, 'lo95'), hi95: lerp(a, b, k, 'hi95') });
      }
    }
    const axis = [...hist.map((r) => [tP(r.d), r.v]), ...future.map((x) => [x.t, x.point])];
    const t0 = tP(last.d);
    drawChart($('ch-fc'), {
      ariaLabel: `Biểu đồ giá lịch sử và khoảng dự báo ${f.cal} ngày`, yFmt: yTick(),
      axis, restIndex: hist.length - 1,
      bands: [
        { pts: [[t0, last.v, last.v], ...future.map((x) => [x.t, x.lo95, x.hi95])], color, opacity: 0.14 },
        { pts: [[t0, last.v, last.v], ...future.map((x) => [x.t, x.lo80, x.hi80])], color, opacity: 0.24 },
      ],
      series: [
        { color, pts: hist.map((r) => [tP(r.d), r.v]), noDot: true },
        { color, pts: [[t0, last.v], ...future.map((x) => [x.t, x.point])], dash: '4 3', width: 1.5 },
      ],
      markers: [{ t: t0, v: last.v, color }],
      tip: (i) => {
        if (i < hist.length) return { title: fmtDate(hist[i].d), rows: [['Giá', valFmt(hist[i].v), color]], dots: [{ v: hist[i].v, color }] };
        const x = future[i - hist.length];
        return { title: `Dự báo · ${fmtDate(x.d)}`, rows: [['Giữa', valFmt(x.point), color], ['Khoảng 80%', `${valFmt(x.lo80)} – ${valFmt(x.hi80)}`]], dots: [{ v: x.point, color }] };
      },
    });
    $('lg-fc').innerHTML = legend([{ label: 'Giá đã có', color }, { label: 'Giữa khoảng', color, dash: true }, { label: 'Khoảng 80%', color, swatch: true, opacity: 0.45 }, { label: 'Khoảng 95%', color, swatch: true, opacity: 0.2 }]);
  }

  function renderBacktest() {
    const m = state.market, R = bt();
    const keys = Object.keys(R);
    const rowsHtml = keys.map((k) => {
      const r = R[k];
      if (r.tooFew) return `<tr><td>${parseInt(k, 10)} ngày</td><td>–</td><td>–</td><td>${verdict(r)}</td></tr>`;
      return `<tr><td>${parseInt(k, 10)} ngày</td><td>${num(m === 'vn' ? r.maeModel : r.maeBlend, 2)}%</td><td>${num(r.maeNaive, 2)}%</td><td>${verdict(r)}</td></tr>`;
    }).join('');
    const d1 = R['1d'], d30 = R['30d'];
    const covers = keys.map((k) => R[k]).filter((r) => !r.tooFew).map((r) => r.cover80);
    const coverLine = covers.length ? `Giá thật nằm trong khoảng 80% ở ${num(Math.min(...covers), 0)}–${num(Math.max(...covers), 0)}% số lần thử.` : '';
    const lede = m === 'vn'
      ? `Hãy dùng khoảng giá, đừng dựa vào con số giữa. Với kỳ dài, mô hình không đoán hướng tốt hơn giả định giá đứng yên. Tín hiệu đáng kể duy nhất là kỳ 1 ngày: ${d1 && d1.dirHit != null ? `đúng hướng <b>${num(d1.dirHit, 0)}%</b> trong ${d1.calls} lần giá thực sự đổi` : 'chưa đủ dữ liệu'}.`
      : `Hãy dùng khoảng giá, đừng dựa vào con số giữa. Ở kỳ 30 ngày, mô hình đúng hướng ${num(d30.dirHit, 0)}%, trong khi giá vốn đã tăng ở ${num(d30.baseUp, 0)}% số lần, nên chưa có năng lực đoán hướng thực sự.`;
    $('bt-block').innerHTML = `
      <h2>Mô hình đáng tin đến đâu</h2>
      <p class="lede">${lede}</p>
      <div class="table-scroll"><table>
        <thead><tr><th scope="col">Kỳ</th><th scope="col">Mô hình<br>lệch</th><th scope="col">Giá đứng<br>yên lệch</th><th scope="col">So sánh</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <p class="note">${coverLine} Kiểm tra trên ${m === 'vn' ? `${series().length} ngày dữ liệu, còn ngắn nên kết quả có thể thay đổi nhiều` : '5 năm gần nhất'}. Mỗi lần thử, mô hình chỉ biết dữ liệu đến thời điểm đó.</p>`;
  }

  function scnDefaults() {
    const prem = premium(), base = prem[prem.length - 1];
    return { w: Math.round(ds.world[ds.world.length - 1].p), fx: Math.round(ds.fx[ds.fx.length - 1].v / 10) * 10, p: Math.round(base.pct * 2) / 2 };
  }
  function renderScenario() {
    const key = ds.sourceDates.vn + state.type;
    if (!state.scn || state.scn.key !== key) state.scn = { key, ...scnDefaults() };
    const s = state.scn, d = scnDefaults();
    const row = (id, label, min, max, step, val, mode) => `<div class="scn-row">
        <label for="${id}-n">${esc(label)}</label>
        <input id="${id}-n" type="number" inputmode="${mode}" min="${min}" max="${max}" step="${step}" value="${val}">
        <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${esc(label)}">
      </div>`;
    $('scn').innerHTML = `<div class="scn">
      ${row('scn-w', 'Giá thế giới, USD/oz', Math.round(d.w * 0.5 / 10) * 10, Math.round(d.w * 1.5 / 10) * 10, 10, s.w, 'numeric')}
      ${row('scn-fx', 'Tỷ giá USD/VND', Math.round(d.fx * 0.9 / 10) * 10, Math.round(d.fx * 1.1 / 10) * 10, 10, s.fx, 'numeric')}
      ${row('scn-p', 'Trong nước cao hơn thế giới, %', 0, 40, 0.5, s.p, 'decimal')}
      <div class="scn-result" aria-live="polite"><span class="s">${esc(vnName())} bán ra ước tính</span><span class="v" id="o-res"></span><span class="s" id="o-diff"></span></div>
      <button id="scn-reset" class="text-btn more-btn" type="button" data-act="scn:reset">Về giá hiện tại</button>
    </div>`;
    updateScenario();
  }
  function updateScenario() {
    const s = state.scn;
    const w = parseFloat($('scn-w-n').value), fx = parseFloat($('scn-fx-n').value), p = parseFloat($('scn-p-n').value);
    if (!(w > 0) || !(fx > 0) || !(p >= 0)) {
      $('o-res').textContent = '–';
      $('o-diff').textContent = 'Nhập đủ ba con số, không để trống.';
      return;
    }
    s.w = w; s.fx = fx; s.p = p;
    const res = w * fx * E.OZ_PER_LUONG * (1 + p / 100);
    const prem = premium(), cur = prem[prem.length - 1].sell;
    const d = res - cur;
    $('o-res').textContent = tr(res) + ' triệu/lượng';
    $('o-diff').textContent = `${d >= 0 ? 'Cao' : 'Thấp'} hơn giá hiện tại ${tr(Math.abs(d))} triệu (${pct((res / cur - 1) * 100)})`;
  }

  // ---------- Tấm trượt chi tiết ----------
  const sheet = $('sheet');
  function openSheet(title, html, after) {
    $('sheet-title').textContent = title;
    $('sheet-body').innerHTML = html;
    $('sheet-body').scrollTop = 0;
    sheet.classList.remove('closing');
    sheet.style.transform = '';
    document.documentElement.classList.add('sheet-open');
    sheet.showModal();
    if (after) after();
  }
  function closeSheet() {
    if (!sheet.open) return;
    const done = () => {
      sheet.close();
      sheet.classList.remove('closing');
      sheet.style.transform = '';
      document.documentElement.classList.remove('sheet-open');
      if (pendingRender) { pendingRender = false; render(); }
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    sheet.style.transform = '';
    sheet.classList.add('closing');
    setTimeout(done, 130);
  }
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  (function dragToClose() {
    const grip = $('sheet-grip');
    let startY = null;
    grip.addEventListener('pointerdown', (e) => { startY = e.clientY; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', (e) => { if (startY != null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`; });
    const end = (e) => {
      if (startY == null) return;
      const moved = e.clientY - startY;
      startY = null;
      if (moved > 80) closeSheet(); else sheet.style.transform = '';
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  })();

  // ---------- Điều phối ----------
  let pendingRender = false;
  function render(keepScroll = true) {
    const focusId = document.activeElement && document.activeElement.id;
    const y = window.scrollY;
    activeReset = null;
    $('mkt-vn').setAttribute('aria-pressed', state.market === 'vn');
    $('mkt-world').setAttribute('aria-pressed', state.market === 'world');
    const sel = $('vn-type');
    sel.hidden = state.market !== 'vn';
    sel.value = state.type;
    $('world-label').hidden = state.market !== 'world';
    TABS.forEach((t) => { const b = $('tab-' + t); if (t === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    ({ 'tong-quan': renderOverview, ngay: renderDay, dot: renderWaves, 'du-bao': renderForecast })[state.tab]();
    updateStatus();
    if (keepScroll) window.scrollTo(0, y);
    const again = focusId && $(focusId);
    if (again && again !== document.activeElement && again.tagName !== 'INPUT') again.focus({ preventScroll: true });
  }

  function persist() { store.set(UI_KEY, { market: state.market, type: state.type, chartUsed: state.chartUsed }); }

  function switchTab(tab) {
    if (tab === state.tab) { window.scrollTo(0, 0); return; } // chạm lại tab đang mở thì về đầu trang, như app iOS
    state.scroll[state.tab] = window.scrollY;
    state.tab = tab;
    try { history.replaceState(null, '', '#' + tab); } catch (err) { location.hash = tab; }
    render(false);
    window.scrollTo(0, state.scroll[tab] || 0);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = b.dataset.act.indexOf(':');
    const act = b.dataset.act.slice(0, i), arg = b.dataset.act.slice(i + 1);
    if (act === 'tab') switchTab(arg);
    else if (act === 'market') {
      if (state.market === arg) return;
      state.market = arg; state.waveLimit = 12; state.day = null; state.rangeFrom = state.rangeTo = null;
      persist(); render();
    } else if (act === 'range') { state.range[state.market] = +arg; render(); }
    else if (act === 'wrange') { state.waveRange[state.market] = +arg; state.waveLimit = 12; render(); }
    else if (act === 'th') { state.th = +arg; state.waveLimit = 12; render(); }
    else if (act === 'wave') openWave(arg);
    else if (act === 'wavemore') { state.waveLimit += 20; render(); }
    else if (act === 'hz') { state.horizon = +arg; render(); }
    else if (act === 'day') { state.day = arg; $('day-input').value = arg; syncDay(); }
    else if (act === 'daystep') stepDay(+arg);
    else if (act === 'daymore') { state.dayLimit += 20; renderDayList(); }
    else if (act === 'dayopen') {
      state.day = arg;
      $('day-input').value = arg;
      syncDay();
      const body = dayDetailHtml(arg, 'ch-sheet');
      openSheet(`${weekday(arg)}, ${fmtDate(arg)}`, body.html, () => drawDayChart('ch-sheet', body.idx));
    } else if (act === 'sheet') closeSheet();
    else if (act === 'scn') { state.scn = null; renderScenario(); }
    else if (act === 'retry') refreshLive(true);
  });

  document.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'vn-type') { state.type = e.target.value; state.waveLimit = 12; persist(); render(); }
    else if (id === 'day-input') { if (e.target.value) { state.day = e.target.value; syncDay(); } }
    else if (id === 'range-from' || id === 'range-to') renderRange();
  });
  document.addEventListener('input', (e) => {
    const id = e.target.id || '';
    if (!id.startsWith('scn-')) return;
    if (id.endsWith('-n')) { const r = $(id.slice(0, -2)); if (e.target.value !== '') r.value = e.target.value; }
    else $(id + '-n').value = e.target.value;
    updateScenario();
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== state.tab) switchTab(h); });

  let resizeTimer, lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return; // cuộn trên iOS làm đổi chiều cao thanh địa chỉ, không cần vẽ lại
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(requestRender, 150);
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => requestRender());

  // Không vẽ lại khi người dùng đang chọn ngày hoặc đang xem tấm trượt.
  function requestRender() {
    const a = document.activeElement;
    if (sheet.open || (a && (a.type === 'date' || a.type === 'number'))) { pendingRender = sheet.open; updateStatus(); return; }
    render();
  }

  // ---------- Trạng thái dữ liệu ----------
  let statusText = '';
  function updateStatus(msg) {
    if (msg !== undefined) statusText = msg;
    const base = `Giá đến ${fmtShort(state.market === 'vn' ? ds.sourceDates.vn : ds.sourceDates.world)}`;
    $('status').textContent = statusText ? `${base} · ${statusText}` : base;
  }
  function setNotice(kind) {
    const el = $('notice');
    const until = fmtDate(ds.sourceDates.vn);
    el.className = 'notice' + (kind === 'error' ? ' error' : '');
    if (kind === 'snapshot') el.innerHTML = `<span>Bản này dừng ở ngày ${until}. Giá mới nhất: <a href="${SITE_URL}" target="_blank" rel="noopener">mở bản cài lên iPhone</a>.</span>`;
    else if (kind === 'error') el.innerHTML = `<span>Không lấy được giá mới. Đang hiện dữ liệu đến ${until}.</span><button id="notice-retry" class="text-btn" type="button" data-act="retry:1">Thử lại</button>`;
    else if (kind === 'stale') el.innerHTML = `<span>Nguồn chưa có giá mới, dữ liệu đang dừng ở ${until}.</span>`;
    el.hidden = !kind;
  }

  async function getJson(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  let refreshing = false;
  async function refreshLive(manual) {
    if (!STANDALONE || refreshing) return;
    if (!manual && live.at && Date.now() - live.at < 5 * 60e3) return;
    refreshing = true;
    const btn = $('refresh');
    btn.disabled = true;
    btn.textContent = 'Đang tải…';
    const lastVn = ds.sourceDates.vn;
    const days = Math.max(3, Math.min(400, E.daysBetween(lastVn, today()) + 3));
    const api = (t) => getJson(`https://www.vang.today/api/prices?type=${t}&days=${days}`);
    const types = Object.keys(RAW.vn);
    const results = await Promise.allSettled([api('XAUUSD'), ...types.map(api), getJson('https://open.er-api.com/v6/latest/USD')]);
    let okCount = 0;
    const lastWorld = ds.world[ds.world.length - 1].p;
    if (results[0].status === 'fulfilled' && results[0].value.success) {
      const add = results[0].value.history
        .map((h) => [h.date, h.prices && h.prices.XAUUSD && h.prices.XAUUSD.buy])
        .filter((r) => r[1] > lastWorld * 0.6 && r[1] < lastWorld * 1.5);
      live.world = merge(live.world || [], add.map((r) => [r[0], Math.round(r[1] * 10) / 10]));
      okCount++;
    }
    types.forEach((t, i) => {
      const res = results[i + 1];
      if (res.status !== 'fulfilled' || !res.value.success) return;
      const prevSell = ds.vn[t][ds.vn[t].length - 1].sell;
      const add = res.value.history
        .map((h) => { const p = h.prices && h.prices[t]; return p ? [h.date, p.buy, p.sell, p.updates] : null; })
        .filter((r) => r && r[2] > prevSell * 0.6 && r[2] < prevSell * 1.5 && r[1] > 0 && r[1] <= r[2]);
      live.vn = live.vn || {};
      live.vn[t] = merge(live.vn[t] || [], add);
      okCount++;
    });
    const fxRes = results[results.length - 1];
    if (fxRes.status === 'fulfilled' && fxRes.value.rates && fxRes.value.rates.VND > 15000 && fxRes.value.rates.VND < 40000) {
      live.fx = merge(live.fx || [], [[today(), Math.round(fxRes.value.rates.VND)]]);
    }
    refreshing = false;
    btn.disabled = false;
    btn.textContent = 'Làm mới';
    if (okCount === 0) { setNotice('error'); return; }
    live.at = Date.now();
    store.set(LIVE_KEY, live);
    rebuild();
    statusText = `lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    setNotice(E.daysBetween(ds.sourceDates.vn, today()) >= 3 ? 'stale' : null);
    requestRender();
  }

  // ---------- Khởi động ----------
  $('vn-type').innerHTML = Object.entries(VN_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  rebuild();
  render(false);
  if (STANDALONE) {
    const btn = $('refresh');
    btn.hidden = false;
    btn.addEventListener('click', () => refreshLive(true));
    refreshLive(false);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLive(false); });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  } else {
    setNotice('snapshot');
  }
})();
