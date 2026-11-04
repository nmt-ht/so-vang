(function () {
  const E = window.GoldEngine;
  const RAW = window.__SNAPSHOT__;
  const STANDALONE = window.__STANDALONE__ === true;
  const $ = (id) => document.getElementById(id);
  const view = $('view');

  const VN_TYPES = { SJL1L10: 'SJC 9999 miếng', SJ9999: 'Nhẫn SJC', DOHNL: 'DOJI Hà Nội', PQHN24NTT: 'PNJ 24K', BT9999NTT: 'Bảo Tín 9999' };
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
    type: VN_TYPES[saved.type] ? saved.type : 'SJL1L10',
    range: { vn: 182, world: 365 },
    waveRange: { vn: 0, world: 1826 },
    th: 5,
    wave: null,
    waveLimit: 20,
    day: null,
    horizon: 30,
    rangeFrom: null,
    rangeTo: null,
    scn: null,
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

  // ---------- Biểu đồ SVG ----------
  function niceTicks(min, max, count) {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(8));
    return { ticks: out, step };
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
    if (spanDays <= 800) return `${d.slice(5, 7)}/${d.slice(2, 4)}`;
    return d.slice(0, 4);
  }

  // o: {series:[{label,color,pts:[[t,v]],width,dash,area,noDot}], bands:[{pts:[[t,lo,hi]],color,opacity}], segments:[{pts,color}],
  //     shade:{from,to}, marker:t, yFmt, tip(t)->{title,rows}, height, ariaLabel, zero}
  function drawChart(host, o) {
    const W = Math.max(260, host.clientWidth || 340), H = o.height || 230;
    const m = { l: 6, r: 48, t: 10, b: 22 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const all = [...o.series.flatMap((s) => s.pts)];
    const times = all.map((p) => p[0]);
    let vals = all.map((p) => p[1]);
    (o.bands || []).forEach((b) => b.pts.forEach((p) => { times.push(p[0]); vals.push(p[1], p[2]); }));
    if (o.zero) vals = vals.concat(0);
    if (!times.length) { host.innerHTML = '<p class="note">Không có dữ liệu trong khoảng này.</p>'; return; }
    const t0 = Math.min(...times), t1 = Math.max(...times);
    let y0 = Math.min(...vals), y1 = Math.max(...vals);
    const pad = (y1 - y0 || Math.abs(y1) * 0.02 || 1) * 0.08;
    y0 -= pad; y1 += pad;
    const { ticks } = niceTicks(y0, y1, 4);
    const X = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * pw;
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
    const P = (x) => x.toFixed(1);
    const line = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + P(X(p[0])) + ' ' + P(Y(p[1]))).join('');

    let g = '';
    ticks.forEach((v) => {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${P(Y(v))}" y2="${P(Y(v))}" stroke="var(--grid)"/>`;
      g += `<text x="${W - m.r + 6}" y="${P(Y(v) + 4)}">${esc(o.yFmt(v))}</text>`;
    });
    if (o.zero) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${P(Y(0))}" y2="${P(Y(0))}" stroke="var(--muted)"/>`;
    const spanDays = (t1 - t0) / 864e5;
    const nx = W < 380 ? 3 : 4;
    for (let i = 0; i <= nx; i++) {
      const t = t0 + ((t1 - t0) * i) / nx;
      const anchor = i === 0 ? 'start' : i === nx ? 'end' : 'middle';
      g += `<text x="${P(X(t))}" y="${H - 6}" text-anchor="${anchor}">${xLabel(t, spanDays)}</text>`;
    }
    if (o.shade) {
      const a = Math.max(o.shade.from, t0), b = Math.min(o.shade.to, t1);
      g += `<rect x="${P(X(a))}" y="${m.t}" width="${P(Math.max(1, X(b) - X(a)))}" height="${ph}" fill="var(--accent)" opacity="0.12"/>`;
    }
    (o.bands || []).forEach((b) => {
      const up = b.pts.map((p) => P(X(p[0])) + ' ' + P(Y(p[2])));
      const dn = [...b.pts].reverse().map((p) => P(X(p[0])) + ' ' + P(Y(p[1])));
      g += `<path d="M${up.join('L')}L${dn.join('L')}Z" fill="${b.color}" opacity="${b.opacity}"/>`;
    });
    const maxN = Math.round(pw * 1.2);
    o.series.forEach((s) => {
      const pts = thin(s.pts, maxN);
      if (s.area && pts.length) {
        g += `<path d="${line(pts)}L${P(X(pts[pts.length - 1][0]))} ${m.t + ph}L${P(X(pts[0][0]))} ${m.t + ph}Z" fill="${s.color}" opacity="0.1"/>`;
      }
      if (!s.hideLine) g += `<path d="${line(pts)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
    });
    (o.segments || []).forEach((s) => {
      g += `<path d="${line(thin(s.pts, maxN))}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    if (o.marker != null && o.marker >= t0 && o.marker <= t1) g += `<line x1="${P(X(o.marker))}" x2="${P(X(o.marker))}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--accent)" stroke-width="1.5"/>`;
    o.series.forEach((s) => {
      if (s.noDot || !s.pts.length) return;
      const e = s.pts[s.pts.length - 1];
      g += `<circle cx="${P(X(e[0]))}" cy="${P(Y(e[1]))}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    });
    (o.markers || []).forEach((mk) => {
      if (mk.t < t0 || mk.t > t1) return;
      g += `<circle cx="${P(X(mk.t))}" cy="${P(Y(mk.v))}" r="4.5" fill="${mk.color}" stroke="var(--surface)" stroke-width="2"/>`;
    });

    const axis = o.series[0].pts;
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" tabindex="0" aria-label="${esc(o.ariaLabel || '')}">${g}<g class="cross"></g></svg><div class="tip" hidden></div>`;
    const svg = host.firstChild, tip = host.lastChild, cross = svg.querySelector('.cross');
    let cursor = -1;
    function show(i) {
      if (!o.tip || !axis.length) return;
      cursor = Math.max(0, Math.min(axis.length - 1, i));
      const p = axis[cursor], x = X(p[0]);
      const info = o.tip(p[0], cursor);
      let dots = '';
      (info.dots || []).forEach((d) => { dots += `<circle cx="${P(x)}" cy="${P(Y(d.v))}" r="4.5" fill="${d.color}" stroke="var(--surface)" stroke-width="2"/>`; });
      cross.innerHTML = `<line x1="${P(x)}" x2="${P(x)}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--muted)" stroke-dasharray="3 3"/>${dots}`;
      tip.innerHTML = `<b>${esc(info.title)}</b>` + info.rows.map((r) => `<div><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('');
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, x < W / 2 ? x + 10 : x - tw - 10)) * (host.clientWidth / W) + 'px';
    }
    function nearest(clientX) {
      const r = svg.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * W;
      const t = t0 + ((x - m.l) / pw) * (t1 - t0);
      let lo = 0, hi = axis.length - 1;
      while (lo < hi) { const c = (lo + hi) >> 1; if (axis[c][0] < t) lo = c + 1; else hi = c; }
      if (lo > 0 && t - axis[lo - 1][0] < axis[lo][0] - t) lo--;
      return lo;
    }
    const hide = () => { cross.innerHTML = ''; tip.hidden = true; cursor = -1; };
    svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) show(nearest(e.clientX)); });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show((cursor < 0 ? axis.length - 1 : cursor) + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') hide();
    });
  }

  const legend = (items) => `<div class="legend">${items.map((i) => `<span><i class="${i.dash ? 'dash' : ''}${i.swatch ? ' swatch' : ''}" style="background:${i.color};color:${i.color};${i.opacity ? `opacity:${i.opacity}` : ''}"></i>${esc(i.label)}</span>`).join('')}</div>`;
  const tP = (d) => E.toTime(d);

  function windowed(rows, days) {
    if (!days) return rows;
    const start = E.addDays(rows[rows.length - 1].d, -days);
    return rows.filter((r) => r.d >= start);
  }
  const rangeChips = (active, prefix) => `<div class="chips" role="group" aria-label="Khoảng thời gian">${RANGES[state.market].map(([lab, n]) => `<button id="${prefix}-${n}" class="chip" type="button" data-act="${prefix}:${n}" aria-pressed="${active === n}">${lab}</button>`).join('')}</div>`;

  // ---------- Tổng quan ----------
  function renderOverview() {
    const m = state.market;
    const rows = series();
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    const prem = premium(), lp = prem[prem.length - 1];
    const ch = last.v - prev.v, chp = (last.v / prev.v - 1) * 100;
    const conv = ds.world[ds.world.length - 1].p * ds.fx[ds.fx.length - 1].v * E.OZ_PER_LUONG;
    const board = m === 'vn' ? `
      <div class="board-label">${esc(vnName())} · giá bán ra · ${fmtDate(last.d)}</div>
      <div class="price">${tr(last.v)}<small>triệu đồng/lượng</small></div>
      <div class="delta ${dirClass(ch)}">${arrow(ch)} ${signed(tr(Math.abs(ch)), ch)} triệu (${pct(chp)}) so với hôm trước</div>
      <dl class="board-grid">
        <div><dt>Mua vào</dt><dd>${tr(last.buy)} <span>triệu</span></dd></div>
        <div><dt>Chênh mua, bán</dt><dd>${tr(last.sell - last.buy)} <span>triệu</span></dd></div>
        <div><dt>Thế giới quy đổi</dt><dd>${tr(lp.conv)} <span>triệu</span></dd></div>
        <div><dt>Cao hơn thế giới</dt><dd>${pct(lp.pct)} <span>${tr(lp.gap)} tr</span></dd></div>
      </dl>` : `
      <div class="board-label">Vàng thế giới XAU/USD · ${fmtDate(last.d)}</div>
      <div class="price">${usd(last.v)}<small>/oz</small></div>
      <div class="delta ${dirClass(ch)}">${arrow(ch)} ${signed(usd(Math.abs(ch)), ch)} (${pct(chp)}) so với phiên trước</div>
      <dl class="board-grid">
        <div><dt>Quy đổi ra VND</dt><dd>${tr(conv)} <span>triệu/lượng</span></dd></div>
        <div><dt>USD/VND</dt><dd>${num(ds.fx[ds.fx.length - 1].v, 0)}</dd></div>
      </dl>`;

    const staleNote = STANDALONE ? '' : `<p class="stale">Bản này hiển thị dữ liệu đã chốt đến ${fmtDate(ds.sourceDates.vn)}. Giá chỉ tự cập nhật ở bản cài lên iPhone.</p>`;

    view.innerHTML = `
      <section class="board">${board}</section>
      ${staleNote}
      <section class="block">
        <h2>${m === 'vn' ? `${esc(vnName())} so với giá thế giới` : 'Diễn biến giá thế giới'}</h2>
        ${rangeChips(state.range[m], 'range')}
        <div class="chart" id="ch-main"></div>
        <div id="lg-main"></div>
        ${m === 'vn' ? '<p class="note">Giá thế giới quy đổi theo tỷ giá USD/VND, 1 lượng = 37,5 g ≈ 1,2057 oz. Dữ liệu vàng Việt Nam có từ 23/11/2025.</p>' : ''}
      </section>
      <section class="block">
        <h2>Vàng trong nước cao hơn thế giới bao nhiêu</h2>
        <p class="lede">${esc(vnName())} đang cao hơn giá quy đổi <b>${pct(lp.pct)}</b>. Trong ${prem.length} ngày qua, mức này dao động từ ${pct(Math.min(...prem.map((p) => p.pct)))} đến ${pct(Math.max(...prem.map((p) => p.pct)))}, trung bình ${pct(E.mean(prem.map((p) => p.pct)))}.</p>
        <div class="chart" id="ch-prem"></div>
      </section>
      <section class="block">
        <h2>Chỉ số phân tích</h2>
        ${analysisHtml()}
      </section>
      ${sourcesHtml()}`;

    const vis = windowed(rows, state.range[m]);
    if (m === 'vn') {
      const pv = windowed(prem, state.range[m]);
      const sjc = css('--sjc'), wc = css('--world');
      drawChart($('ch-main'), {
        ariaLabel: `Biểu đồ ${vnName()} và thế giới quy đổi, triệu đồng mỗi lượng`,
        yFmt: (v) => num(v / 1e6, 0),
        series: [
          { label: vnName(), color: sjc, pts: pv.map((r) => [tP(r.d), r.sell]) },
          { label: 'Thế giới quy đổi', color: wc, pts: pv.map((r) => [tP(r.d), r.conv]) },
        ],
        tip: (t, i) => ({ title: fmtDate(pv[i].d), rows: [['Bán ra', tr(pv[i].sell) + ' tr'], ['Thế giới', tr(pv[i].conv) + ' tr'], ['Cao hơn', pct(pv[i].pct)]], dots: [{ v: pv[i].sell, color: sjc }, { v: pv[i].conv, color: wc }] }),
      });
      $('lg-main').innerHTML = legend([{ label: vnName() + ' bán ra', color: sjc }, { label: 'Thế giới quy đổi', color: wc }]);
    } else {
      const wc = css('--world');
      const allV = rows.map((r) => r.v);
      const ma50 = E.sma(allV, 50);
      const offset = rows.length - vis.length;
      const maPts = vis.map((r, i) => [tP(r.d), ma50[offset + i]]).filter((p) => p[1] != null);
      drawChart($('ch-main'), {
        ariaLabel: 'Biểu đồ giá vàng thế giới, USD mỗi ounce',
        yFmt: (v) => '$' + num(v, 0),
        series: [
          { label: 'XAU/USD', color: wc, pts: vis.map((r) => [tP(r.d), r.v]), area: true },
          { label: 'MA50', color: css('--muted'), pts: maPts, width: 1.5, dash: '4 3', noDot: true },
        ],
        tip: (t, i) => ({ title: fmtDate(vis[i].d), rows: [['Giá', usd(vis[i].v)]].concat(ma50[offset + i] != null ? [['MA50', usd(ma50[offset + i])]] : []), dots: [{ v: vis[i].v, color: wc }] }),
      });
      $('lg-main').innerHTML = legend([{ label: 'XAU/USD', color: wc }, { label: 'Trung bình 50 phiên (MA50)', color: css('--muted'), dash: true }]);
    }
    drawChart($('ch-prem'), {
      height: 160,
      ariaLabel: 'Biểu đồ phần trăm chênh lệch giữa giá trong nước và thế giới',
      yFmt: (v) => num(v, 0) + '%',
      series: [{ label: 'Chênh lệch', color: css('--sjc'), pts: prem.map((r) => [tP(r.d), r.pct]), area: true }],
      tip: (t, i) => ({ title: fmtDate(prem[i].d), rows: [['Cao hơn', pct(prem[i].pct)], ['Tương đương', tr(prem[i].gap) + ' tr/lượng']], dots: [{ v: prem[i].pct, color: css('--sjc') }] }),
    });
  }

  function analysisHtml() {
    const m = state.market, rows = series();
    const v = rows.map((r) => r.v), n = v.length, last = v[n - 1];
    const perYear = m === 'vn' ? 365 : 252;
    const sessions = m === 'vn' ? 'ngày' : 'phiên';
    const ma20 = E.sma(v, 20)[n - 1], ma50 = E.sma(v, 50)[n - 1], rsi = E.rsi(v)[n - 1];
    const vol = E.annualVol(v, 21, perYear);
    const peak = Math.max(...v), peakD = rows[v.lastIndexOf(peak)].d;
    const y = windowed(rows, 365).map((r) => r.v);
    const waves = E.detectWaves(rows.map((r) => ({ d: r.d, p: r.v })), 5);
    const cw = waves[waves.length - 1];
    const rsiText = rsi >= 70 ? 'Vùng quá mua, giá đã tăng nhanh trong ngắn hạn' : rsi <= 30 ? 'Vùng quá bán, giá đã giảm nhanh trong ngắn hạn' : 'Vùng trung tính';
    const posText = (a, name) => `${last >= a ? 'trên' : 'dưới'} ${name}`;
    const row = (k, val, sub) => `<div><dt>${esc(k)}</dt><dd>${val}</dd>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
    return `<dl class="rows">
      ${row(`Trung bình 20 ${sessions}`, valFmt(ma20), `Giá hiện ${posText(ma20, 'đường này')}, lệch ${pct((last / ma20 - 1) * 100)}`)}
      ${row(`Trung bình 50 ${sessions}`, valFmt(ma50), `Giá hiện ${posText(ma50, 'đường này')}, lệch ${pct((last / ma50 - 1) * 100)}`)}
      ${row('RSI 14', num(rsi, 0), rsiText)}
      ${row(`Biến động 21 ${sessions}`, num(vol, 1) + '%/năm', 'Càng cao thì giá dao động càng mạnh')}
      ${row(m === 'vn' ? 'Đỉnh trong dữ liệu' : 'Đỉnh 10 năm', valFmt(peak), `Đạt ngày ${fmtDate(peakD)}, giá hiện cách đỉnh ${pct((last / peak - 1) * 100)}`)}
      ${row('Cao, thấp 12 tháng', `${valFmt(Math.max(...y))} · ${valFmt(Math.min(...y))}`, '')}
      ${cw ? row('Đợt hiện tại', `<span class="pill ${dirClass(cw.dir)}">${arrow(cw.dir)} ${pct(cw.pct)}</span>`, `Từ ${fmtDate(cw.from)}, được ${cw.days} ngày, tính theo ngưỡng đảo chiều 5%`) : ''}
    </dl>`;
  }

  function sourcesHtml() {
    return `<section class="block fine">
      <details>
        <summary>Nguồn dữ liệu và cách tính</summary>
        <p>Giá vàng Việt Nam và giá giao ngay XAU/USD từ 23/11/2025: <a href="https://www.vang.today/en/api" target="_blank" rel="noopener">vang.today</a>. Giá thế giới trước đó: hợp đồng tương lai vàng GC=F trên Yahoo Finance, lệch khoảng ${num(RAW.futuresVsSpotPct || 0.4, 1)}% so với giá giao ngay ở phần trùng nhau. Tỷ giá USD/VND: Yahoo Finance, làm mượt bằng trung vị 5 phiên; bản cài lên iPhone lấy thêm từ open.er-api.com.</p>
        <p>Giá thế giới không tính thứ bảy, chủ nhật vì thị trường nghỉ. Giá Việt Nam giữ nguyên mọi ngày trong tuần như nguồn công bố. Mỗi ngày lấy mức giá cuối cùng mà nguồn ghi nhận, nên giá trong ngày có thể khác giá bạn thấy ở tiệm.</p>
      </details>
    </section>`;
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
        <p class="note">${state.market === 'vn' ? `Có dữ liệu từ ${fmtDate(first)} đến ${fmtDate(lastD)}. Muốn xem xa hơn, chuyển sang Thế giới (từ ${fmtDate(ds.world[0].d)}).` : `Có dữ liệu từ ${fmtDate(first)} đến ${fmtDate(lastD)}.`}</p>
      </section>
      <div id="day-body" style="display:grid;gap:14px"></div>
      <section class="block">
        <h2>30 ngày gần nhất</h2>
        <div id="day-list"></div>
      </section>`;
    renderDayBody();
  }

  function renderDayBody() {
    const m = state.market, rows = series(), d = state.day;
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

    $('day-body').innerHTML = `
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
        <div class="chart" id="ch-day"></div>
        <p class="note">Vạch dọc đánh dấu ngày đang xem. Giá ${unit()}.</p>
      </section>
      ${inVn && vnRows ? `<section class="block"><h2>Bảng giá trong nước ngày ${fmtShort(d)}</h2><div class="table-scroll"><table><thead><tr><th scope="col">Triệu đồng/lượng</th><th scope="col">Mua</th><th scope="col">Bán</th><th scope="col">Đổi</th></tr></thead><tbody>${vnRows}</tbody></table></div></section>`
        : '<p class="stale">Nguồn dữ liệu chưa có giá vàng Việt Nam cho ngày này.</p>'}`;

    const from = Math.max(0, idx - 30), to = Math.min(rows.length, idx + 31);
    const win = rows.slice(from, to);
    const color = m === 'vn' ? css('--sjc') : css('--world');
    drawChart($('ch-day'), {
      height: 180,
      marker: tP(r.d),
      ariaLabel: `Biểu đồ giá quanh ngày ${fmtDate(d)}`,
      yFmt: (v) => (m === 'vn' ? num(v / 1e6, 0) : '$' + num(v, 0)),
      series: [{ label: mktName(), color, pts: win.map((x) => [tP(x.d), x.v]), noDot: true }],
      markers: [{ t: tP(r.d), v: r.v, color }],
      tip: (t, i) => ({ title: fmtDate(win[i].d), rows: [['Giá', valFmt(win[i].v)]], dots: [{ v: win[i].v, color }] }),
    });

    $('day-prev').disabled = idx === 0 && rows[0].d >= d;
    $('day-next').disabled = d >= rows[rows.length - 1].d;

    const recent = rows.slice(-30).map((x, i, a) => {
      const q = i > 0 ? a[i - 1] : rows[rows.length - 31];
      return { ...x, c: q ? (x.v / q.v - 1) * 100 : 0 };
    }).reverse();
    $('day-list').innerHTML = recent.map((x) => `<button class="list-btn" type="button" data-act="day:${x.d}" aria-current="${x.d === d}"><span class="ld">${fmtDate(x.d)}</span><span class="lv">${valFmt(x.v)}</span><span class="pill ${dirClass(x.c)}">${arrow(x.c)} ${pct(x.c)}</span></button>`).join('');
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
    if (prem.length >= 2) out.push(['Chênh so với thế giới', `${pct(prem[0].pct)} → ${pct(prem[prem.length - 1].pct)}`]);
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

  function renderWaves() {
    const m = state.market, rows = series();
    const pts = rows.map((r) => ({ d: r.d, p: r.v }));
    const waves = E.detectWaves(pts, state.th);
    const days = state.waveRange[m];
    const startD = days ? E.addDays(rows[rows.length - 1].d, -days) : rows[0].d;
    const shown = waves.filter((w) => w.to >= startD);
    const sum = E.waveSummary(shown);
    const sel = state.wave && shown.find((w) => w.from === state.wave) || null;

    const stat = (s, lab, cls) => s ? `<div><span class="k ${cls}">${arrow(cls === 'up' ? 1 : -1)} ${lab}</span><span class="v">${pct(s.avgPct)}</span><span class="s">Trung bình ${num(s.avgDays, 0)} ngày, ${s.n} đợt đã kết thúc</span></div>`
      : `<div><span class="k ${cls}">${arrow(cls === 'up' ? 1 : -1)} ${lab}</span><span class="s">Chưa có đợt nào đã kết thúc</span></div>`;

    const list = [...shown].reverse().slice(0, state.waveLimit);
    view.innerHTML = `
      <section class="block">
        <h2>Các đợt tăng, giảm của ${esc(mktName())}</h2>
        <p class="note">Một đợt kết thúc khi giá quay đầu từ đỉnh hoặc đáy vượt ngưỡng bạn chọn. Ngưỡng càng lớn thì càng ít đợt, mỗi đợt càng dài.</p>
        <div class="chips" role="group" aria-label="Ngưỡng đảo chiều">
          ${[3, 5, 10].map((t) => `<button id="th-${t}" class="chip" type="button" data-act="th:${t}" aria-pressed="${state.th === t}">${t === 3 ? 'Đợt nhỏ' : t === 5 ? 'Đợt vừa' : 'Đợt lớn'} ≥${t}%</button>`).join('')}
        </div>
        ${m === 'world' ? rangeChips(days, 'wrange') : ''}
        <div class="chart" id="ch-wave"></div>
        ${legend([{ label: 'Đợt tăng', color: css('--up') }, { label: 'Đợt giảm', color: css('--down') }])}
      </section>
      ${sel ? `<section class="block">
        <h2>Đợt ${sel.dir > 0 ? 'tăng' : 'giảm'} ${fmtDate(sel.from)} đến ${fmtDate(sel.to)}${sel.ongoing ? ' (đang diễn ra)' : ''}</h2>
        ${periodHtml(periodRows(rows, sel.from, sel.to))}
        <button id="wave-clear" class="link-btn" type="button" data-act="wave:">Xem lại toàn bộ</button>
      </section>` : ''}
      <section class="stat-pair">${stat(sum.up, 'Đợt tăng', 'up')}${stat(sum.down, 'Đợt giảm', 'down')}</section>
      <section class="block">
        <h2>${shown.length} đợt, mới nhất trước</h2>
        <div>${list.map((w) => `<button class="wave-btn" type="button" data-act="wave:${w.from}" aria-current="${!!sel && sel.from === w.from}">
          <span class="pill ${dirClass(w.dir)}">${arrow(w.dir)}</span>
          <span class="wd">${fmtShort(w.from)}/${w.from.slice(2, 4)} → ${fmtShort(w.to)}/${w.to.slice(2, 4)}</span>
          <span class="wp ${dirClass(w.dir)}">${pct(w.pct)}</span>
          <span class="wm">${w.days} ngày · ${valFmt(w.startP)} → ${valFmt(w.endP)}${w.ongoing ? ' · đang diễn ra' : ''}</span>
        </button>`).join('') || '<p class="note">Giá chưa đảo chiều đủ ngưỡng này trong khoảng đang xem.</p>'}</div>
        ${shown.length > state.waveLimit ? `<button id="wave-more" class="link-btn" type="button" data-act="wavemore:1">Xem thêm ${Math.min(20, shown.length - state.waveLimit)} đợt</button>` : ''}
      </section>
      <section class="block">
        <h2>Tự chọn một đợt</h2>
        <div class="date-pair">
          <label for="range-from">Từ ngày<input id="range-from" type="date" min="${rows[0].d}" max="${rows[rows.length - 1].d}" value="${state.rangeFrom || E.addDays(rows[rows.length - 1].d, -90)}"></label>
          <label for="range-to">Đến ngày<input id="range-to" type="date" min="${rows[0].d}" max="${rows[rows.length - 1].d}" value="${state.rangeTo || rows[rows.length - 1].d}"></label>
        </div>
        <div id="range-result"></div>
      </section>`;

    const up = css('--up'), dn = css('--down'), base = css('--muted');
    let vis = rows.filter((r) => r.d >= startD);
    let segs = shown;
    if (sel) {
      const pad = Math.max(5, Math.round(sel.days * 0.25));
      const a = E.addDays(sel.from, -pad), b = E.addDays(sel.to, pad);
      vis = rows.filter((r) => r.d >= a && r.d <= b);
      segs = waves.filter((w) => w.to >= a && w.from <= b);
    }
    const lo = vis[0].d, hi = vis[vis.length - 1].d;
    drawChart($('ch-wave'), {
      ariaLabel: 'Biểu đồ các đợt tăng giảm giá vàng',
      yFmt: (v) => (m === 'vn' ? num(v / 1e6, 0) : '$' + num(v, 0)),
      shade: sel ? { from: tP(sel.from), to: tP(sel.to) } : null,
      series: [{ label: mktName(), color: base, pts: vis.map((r) => [tP(r.d), r.v]), width: 1, noDot: true }],
      segments: segs.map((w) => ({
        color: w.dir > 0 ? up : dn,
        width: sel && sel.from === w.from ? 3 : 2,
        pts: rows.slice(w.i0, w.i1 + 1).filter((r) => r.d >= lo && r.d <= hi).map((r) => [tP(r.d), r.v]),
      })).filter((s) => s.pts.length > 1),
      tip: (t, i) => {
        const w = waves.find((x) => vis[i].d >= x.from && vis[i].d <= x.to);
        return { title: fmtDate(vis[i].d), rows: [['Giá', valFmt(vis[i].v)]].concat(w ? [[w.dir > 0 ? 'Trong đợt tăng' : 'Trong đợt giảm', pct(w.pct)]] : []), dots: [{ v: vis[i].v, color: base }] };
      },
    });
    renderRange();
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
    if (!r || r.tooFew) return '<span class="pill gold verdict">Chưa đủ dữ liệu</span>';
    if (r.skill >= 3) return '<span class="pill up verdict">Nhỉnh hơn</span>';
    if (r.skill <= -3) return '<span class="pill down verdict">Kém hơn</span>';
    return '<span class="pill gold verdict">Ngang nhau</span>';
  }

  function renderForecast() {
    const m = state.market, rows = series(), F = fc();
    const f = F.find((x) => x.cal === state.horizon) || F[1];
    const lastV = rows[rows.length - 1].v;
    const moneyV = (v) => (m === 'vn' ? tr(v) + ' triệu' : usd(v, 0));
    const when = f.cal === 1 ? 'ngày mai' : `sau ${f.cal} ngày (${fmtDate(f.date)})`;

    let lagLine = '';
    if (m === 'vn') {
      const pr = premium();
      const lastChange = (pr[pr.length - 1].conv / pr[pr.length - 2].conv - 1) * 100;
      const move = Math.abs(lastChange) < 0.05 ? 'gần như đứng giá' : `${lastChange > 0 ? 'tăng' : 'giảm'} ${num(Math.abs(lastChange), 2)}%`;
      lagLine = `<p class="note">Tín hiệu một ngày: giá thế giới quy đổi hôm nay ${move}. Lịch sử cho thấy ${esc(vnName())} thường đi theo khoảng ${num((F[0].k || 0) * 100, 0)}% mức thay đổi đó vào hôm sau.</p>`;
    }

    view.innerHTML = `
      <section class="board">
        <div class="board-label">${esc(mktName())} · dự báo ${when}</div>
        <div class="price" style="font-size:clamp(32px,10vw,44px)">${m === 'vn' ? `${tr(f.lo80)} – ${tr(f.hi80)}` : `${usd(f.lo80, 0)} – ${usd(f.hi80, 0)}`}${m === 'vn' ? '<small>triệu/lượng</small>' : ''}</div>
        <div class="delta flat">Khoảng có khả năng 80%, giá hiện tại ${moneyV(lastV)}</div>
        <dl class="board-grid">
          <div><dt>Giá giữa khoảng</dt><dd>${m === 'vn' ? tr(f.point) : usd(f.point, 0)} <span>${pct((f.point / lastV - 1) * 100)}</span></dd></div>
          <div><dt>Khoảng rộng hơn, 95%</dt><dd style="font-size:14px">${m === 'vn' ? `${tr(f.lo95)} – ${tr(f.hi95)}` : `${usd(f.lo95, 0)} – ${usd(f.hi95, 0)}`}</dd></div>
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
      <section class="block">
        <h2>Tất cả các kỳ</h2>
        <div class="table-scroll"><table class="compact">
          <thead><tr><th scope="col">Kỳ</th><th scope="col">Giữa</th><th scope="col">Khoảng 80%</th><th scope="col">Khoảng 95%</th></tr></thead>
          <tbody>${F.map((x) => { const q = (v) => (m === 'vn' ? tr(v) : num(v, 0)); return `<tr class="${x.cal === f.cal ? 'hl' : ''}"><td>${x.cal} ngày</td><td>${q(x.point)}</td><td>${q(x.lo80)}–${q(x.hi80)}</td><td>${q(x.lo95)}–${q(x.hi95)}</td></tr>`; }).join('')}</tbody>
        </table></div>
        <p class="note">Đơn vị: ${unit()}.</p>
      </section>
      <section class="block" id="bt-block">
        <h2>Mô hình này đáng tin đến đâu</h2>
        <p class="note">Đang kiểm định trên dữ liệu quá khứ…</p>
      </section>
      <section class="block">
        <h2>Tính thử theo kịch bản</h2>
        <p class="note">Tự đặt giá thế giới, tỷ giá và mức chênh để xem giá trong nước tương ứng.</p>
        <div id="scn"></div>
      </section>
      <p class="note">Đây là thống kê từ dữ liệu quá khứ, không phải khuyến nghị mua bán. Tin tức, chính sách và nguồn cung vàng trong nước có thể làm giá đi ra ngoài các khoảng trên.</p>`;

    drawForecastChart(f, F);
    renderScenario();
    setTimeout(() => { if (state.tab === 'du-bao' && $('bt-block')) renderBacktest(); }, 30);
  }

  function drawForecastChart(f, F) {
    const m = state.market, rows = series();
    const color = m === 'vn' ? css('--sjc') : css('--world');
    const hist = rows.slice(-Math.max(45, m === 'vn' ? f.cal * 2 : Math.round(f.cal * 1.4)));
    const last = rows[rows.length - 1];
    const anchors = F.filter((x) => x.cal <= f.cal);
    const t = (d) => tP(d);
    const b80 = [[t(last.d), last.v, last.v], ...anchors.map((x) => [t(x.date), x.lo80, x.hi80])];
    const b95 = [[t(last.d), last.v, last.v], ...anchors.map((x) => [t(x.date), x.lo95, x.hi95])];
    const mid = [[t(last.d), last.v], ...anchors.map((x) => [t(x.date), x.point])];
    drawChart($('ch-fc'), {
      ariaLabel: `Biểu đồ giá lịch sử và khoảng dự báo ${f.cal} ngày`,
      yFmt: (v) => (m === 'vn' ? num(v / 1e6, 0) : '$' + num(v, 0)),
      bands: [{ pts: b95, color, opacity: 0.14 }, { pts: b80, color, opacity: 0.24 }],
      series: [
        { label: 'Lịch sử', color, pts: hist.map((r) => [t(r.d), r.v]), noDot: true },
        { label: 'Giữa khoảng', color, pts: mid, dash: '4 3', width: 1.5 },
      ],
      markers: [{ t: t(last.d), v: last.v, color }],
      tip: (tt, i) => ({ title: fmtDate(hist[i].d), rows: [['Giá', valFmt(hist[i].v)]], dots: [{ v: hist[i].v, color }] }),
    });
    $('lg-fc').innerHTML = legend([{ label: 'Giá đã có', color }, { label: 'Giữa khoảng', color, dash: true }, { label: 'Khoảng 80%', color, swatch: true, opacity: 0.45 }, { label: 'Khoảng 95%', color, swatch: true, opacity: 0.2 }]);
  }

  function renderBacktest() {
    const m = state.market, R = bt();
    const keys = Object.keys(R);
    const rowsHtml = keys.map((k) => {
      const r = R[k];
      if (r.tooFew) return `<tr><td>${parseInt(k, 10)} ngày</td><td>–</td><td>–</td><td>–</td><td>${verdict(r)}</td></tr>`;
      const model = m === 'vn' ? r.maeModel : r.maeBlend;
      return `<tr><td>${parseInt(k, 10)} ngày</td><td>${num(model, 2)}%</td><td>${num(r.maeNaive, 2)}%</td><td>${num(r.cover80, 0)}%</td><td>${verdict(r)}</td></tr>`;
    }).join('');
    const d1 = R['1d'], d30 = R['30d'];
    const lede = m === 'vn'
      ? `Kiểm định trên ${series().length} ngày dữ liệu. Với kỳ dài, mô hình không dự báo hướng tốt hơn giả định giá giữ nguyên, nên hãy dùng khoảng giá thay vì con số giữa. Tín hiệu đáng kể duy nhất là kỳ 1 ngày: ${d1 && d1.dirHit != null ? `đúng hướng <b>${num(d1.dirHit, 0)}%</b> trong ${d1.calls} lần giá thực sự đổi` : 'chưa đủ dữ liệu'}.`
      : `Kiểm định trên 5 năm gần nhất. Mô hình gần như không thắng giả định giá giữ nguyên. Ở kỳ 30 ngày, nó đúng hướng ${num(d30.dirHit, 0)}%, trong khi giá vốn đã tăng ở ${num(d30.baseUp, 0)}% số lần, nghĩa là chưa có năng lực đoán hướng thực sự. Phần đáng tin hơn là độ rộng của khoảng giá.`;
    $('bt-block').innerHTML = `
      <h2>Mô hình này đáng tin đến đâu</h2>
      <p class="lede">${lede}</p>
      <div class="table-scroll"><table class="compact">
        <thead><tr><th scope="col">Kỳ</th><th scope="col">Mô hình</th><th scope="col">Giữ giá</th><th scope="col">Lọt 80%</th><th scope="col">So sánh</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <p class="note">Cột Mô hình và Giữ giá là sai số trung bình của mô hình và của giả định giá không đổi. Cột Lọt 80% là tỷ lệ giá thật nằm trong khoảng 80%, càng gần 80% càng sát thực tế. Mỗi lần thử, mô hình chỉ được biết dữ liệu đến thời điểm đó.${m === 'vn' ? ' Dữ liệu trong nước mới khoảng một năm, nên kết quả này còn có thể thay đổi nhiều.' : ''}</p>`;
  }

  function renderScenario() {
    const w = ds.world[ds.world.length - 1].p, fx = ds.fx[ds.fx.length - 1].v;
    const prem = premium(), base = prem[prem.length - 1];
    const key = ds.sourceDates.vn + state.type;
    if (!state.scn || state.scn.key !== key) state.scn = { key, w: Math.round(w), fx: Math.round(fx / 10) * 10, p: Math.round(base.pct * 2) / 2 };
    const s = state.scn;
    const wMin = Math.round(w * 0.7 / 10) * 10, wMax = Math.round(w * 1.3 / 10) * 10;
    $('scn').innerHTML = `<div class="scn">
      <label for="scn-w">Giá thế giới <output id="o-w"></output><input id="scn-w" type="range" min="${wMin}" max="${wMax}" step="10" value="${s.w}"></label>
      <label for="scn-fx">USD/VND <output id="o-fx"></output><input id="scn-fx" type="range" min="${Math.round(fx * 0.92 / 10) * 10}" max="${Math.round(fx * 1.08 / 10) * 10}" step="10" value="${s.fx}"></label>
      <label for="scn-p">Trong nước cao hơn thế giới <output id="o-p"></output><input id="scn-p" type="range" min="0" max="30" step="0.5" value="${s.p}"></label>
      <div class="scn-result" aria-live="polite"><span class="s">${esc(vnName())} bán ra ước tính</span><span class="v" id="o-res"></span><span class="s" id="o-diff"></span></div>
    </div>`;
    updateScenario();
  }
  function updateScenario() {
    const s = state.scn;
    s.w = +$('scn-w').value; s.fx = +$('scn-fx').value; s.p = +$('scn-p').value;
    const res = s.w * s.fx * E.OZ_PER_LUONG * (1 + s.p / 100);
    const prem = premium(), cur = prem[prem.length - 1].sell;
    $('o-w').textContent = '$' + num(s.w, 0);
    $('o-fx').textContent = num(s.fx, 0);
    $('o-p').textContent = num(s.p, 1) + '%';
    $('o-res').textContent = tr(res) + ' triệu/lượng';
    const d = res - cur;
    $('o-diff').textContent = `${d >= 0 ? 'Cao' : 'Thấp'} hơn giá hiện tại ${tr(Math.abs(d))} triệu (${pct((res / cur - 1) * 100)})`;
  }

  // ---------- Điều phối ----------
  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    $('mkt-vn').setAttribute('aria-pressed', state.market === 'vn');
    $('mkt-world').setAttribute('aria-pressed', state.market === 'world');
    const sel = $('vn-type');
    sel.hidden = state.market !== 'vn';
    sel.value = state.type;
    TABS.forEach((t) => { const b = $('tab-' + t); if (t === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    ({ 'tong-quan': renderOverview, ngay: renderDay, dot: renderWaves, 'du-bao': renderForecast })[state.tab]();
    updateStatus();
    const again = focusId && $(focusId);
    if (again && again !== document.activeElement && again.tagName !== 'INPUT') again.focus({ preventScroll: true });
  }

  function persist() { store.set(UI_KEY, { market: state.market, type: state.type }); }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = b.dataset.act.indexOf(':');
    const act = b.dataset.act.slice(0, i), arg = b.dataset.act.slice(i + 1);
    if (act === 'tab') {
      state.tab = arg;
      if (location.hash.slice(1) !== arg) { try { history.replaceState(null, '', '#' + arg); } catch (err) { location.hash = arg; } }
      window.scrollTo(0, 0);
      render();
    } else if (act === 'market') {
      state.market = arg; state.wave = null; state.waveLimit = 20; state.day = null; state.rangeFrom = state.rangeTo = null;
      persist(); render();
    } else if (act === 'range') { state.range[state.market] = +arg; render(); }
    else if (act === 'wrange') { state.waveRange[state.market] = +arg; state.wave = null; state.waveLimit = 20; render(); }
    else if (act === 'th') { state.th = +arg; state.wave = null; state.waveLimit = 20; render(); }
    else if (act === 'wave') {
      state.wave = state.wave === arg ? null : arg || null;
      render();
      if (state.wave) window.scrollTo({ top: 0 });
    } else if (act === 'wavemore') { state.waveLimit += 20; render(); }
    else if (act === 'hz') { state.horizon = +arg; render(); }
    else if (act === 'day') { state.day = arg; $('day-input').value = arg; renderDayBody(); window.scrollTo({ top: 0 }); }
    else if (act === 'daystep') stepDay(+arg);
  });

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
    renderDayBody();
  }

  // Ô chọn ngày không bị vẽ lại khi đổi giá trị, để bánh xe chọn ngày trên iPhone không tự đóng.
  document.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'vn-type') { state.type = e.target.value; state.wave = null; state.waveLimit = 20; persist(); render(); }
    else if (id === 'day-input') { if (e.target.value) { state.day = e.target.value; renderDayBody(); } }
    else if (id === 'range-from' || id === 'range-to') renderRange();
  });
  document.addEventListener('input', (e) => { if (e.target.id && e.target.id.startsWith('scn-')) updateScenario(); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== state.tab) { state.tab = h; render(); } });

  let resizeTimer, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return; // cuộn trên iOS làm đổi chiều cao thanh địa chỉ, không cần vẽ lại
    lastW = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());

  // ---------- Cập nhật trực tuyến (chỉ bản cài riêng) ----------
  let statusText = '';
  function updateStatus(msg) {
    if (msg) statusText = msg;
    const base = `Dữ liệu đến ${fmtShort(state.market === 'vn' ? ds.sourceDates.vn : ds.sourceDates.world)}`;
    $('status').textContent = statusText ? `${statusText} · ${base}` : base;
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
    if (!manual && live.at && Date.now() - live.at < 5 * 60e3) { updateStatus(); return; }
    refreshing = true;
    updateStatus('Đang cập nhật');
    $('refresh').disabled = true;
    const lastVn = ds.sourceDates.vn;
    const days = Math.max(3, Math.min(400, E.daysBetween(lastVn, today()) + 3));
    const api = (t) => getJson(`https://www.vang.today/api/prices?type=${t}&days=${days}`);
    const types = Object.keys(RAW.vn);
    const results = await Promise.allSettled([api('XAUUSD'), ...types.map(api), getJson('https://open.er-api.com/v6/latest/USD')]);
    let okCount = 0;
    const lastW = ds.world[ds.world.length - 1].p;
    if (results[0].status === 'fulfilled' && results[0].value.success) {
      const add = results[0].value.history
        .map((h) => [h.date, h.prices && h.prices.XAUUSD && h.prices.XAUUSD.buy])
        .filter((r) => r[1] > lastW * 0.6 && r[1] < lastW * 1.5);
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
    $('refresh').disabled = false;
    if (okCount === 0) { updateStatus('Không kết nối được'); return; }
    live.at = Date.now();
    store.set(LIVE_KEY, live);
    rebuild();
    const clock = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    statusText = `Cập nhật ${clock}`;
    if (document.activeElement && document.activeElement.type === 'date') updateStatus(); else render();
  }

  // ---------- Khởi động ----------
  $('vn-type').innerHTML = Object.entries(VN_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  rebuild();
  render();
  if (STANDALONE) {
    const btn = $('refresh');
    btn.hidden = false;
    btn.addEventListener('click', () => refreshLive(true));
    refreshLive(false);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLive(false); });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
