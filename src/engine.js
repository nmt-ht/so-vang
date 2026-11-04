// Lõi tính toán: dữ liệu, chỉ báo, nhận diện đợt, dự báo, kiểm định ngược.
// Không đụng DOM, nên chạy được cả trong trình duyệt lẫn Node (để kiểm thử).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoldEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const OZ_PER_LUONG = 37.5 / 31.1034768; // 1 lượng = 37,5 g; 1 oz troy = 31,1034768 g
  const DAY = 864e5;

  const toTime = (d) => Date.parse(d + 'T00:00:00Z');
  const toDate = (t) => new Date(t).toISOString().slice(0, 10);
  const isWeekend = (d) => { const w = new Date(toTime(d)).getUTCDay(); return w === 0 || w === 6; };
  const addDays = (d, n) => toDate(toTime(d) + n * DAY);
  const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY);

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
  const median = (a) => quantile(a, 0.5);
  function quantile(a, q) {
    const s = [...a].sort((x, y) => x - y);
    const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }

  // ---------- Dữ liệu ----------

  // Trung vị trượt 5 phiên để khử nhiễu của tỷ giá USD/VND từ Yahoo (có ngày lệch 1-2% rồi quay lại).
  function smoothFx(rows) {
    return rows.map((r, i) => {
      const w = rows.slice(Math.max(0, i - 2), Math.min(rows.length, i + 3)).map((x) => x[1]);
      return [r[0], median(w)];
    });
  }

  // Tạo bộ dữ liệu thống nhất từ snapshot đã nhúng (có thể đã trộn dữ liệu trực tuyến).
  function buildDataset(snap) {
    const world = snap.world.filter((r) => !isWeekend(r[0])).map((r) => ({ d: r[0], p: r[1] }));
    const fx = smoothFx(snap.fx).map((r) => ({ d: r[0], v: r[1] }));
    const vn = {};
    for (const k of Object.keys(snap.vn)) vn[k] = snap.vn[k].map((r) => ({ d: r[0], buy: r[1], sell: r[2], u: r[3] }));
    return { world, fx, vn, sourceDates: { world: world.at(-1).d, vn: vn.SJL1L10.at(-1).d, fx: fx.at(-1).d } };
  }

  // Tra giá trị gần nhất tại hoặc trước một ngày.
  function asOfLookup(rows, field) {
    const dates = rows.map((r) => r.d);
    return (d) => {
      let lo = 0, hi = dates.length - 1, ans = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
      return ans < 0 ? null : rows[ans][field];
    };
  }

  // Chuỗi chênh lệch: giá SJC bán so với giá thế giới quy đổi sang VND/lượng.
  function premiumSeries(ds, type = 'SJL1L10') {
    const w = asOfLookup(ds.world, 'p'), f = asOfLookup(ds.fx, 'v');
    return ds.vn[type].map((r) => {
      const wp = w(r.d), fxv = f(r.d);
      const conv = wp * fxv * OZ_PER_LUONG;
      return { d: r.d, sell: r.sell, buy: r.buy, world: wp, fx: fxv, conv, gap: r.sell - conv, pct: (r.sell / conv - 1) * 100, spread: r.sell - r.buy };
    });
  }

  // ---------- Chỉ báo ----------

  function sma(v, n) {
    const out = new Array(v.length).fill(null);
    let s = 0;
    for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }

  function rsi(v, n = 14) {
    const out = new Array(v.length).fill(null);
    let g = 0, l = 0;
    for (let i = 1; i < v.length; i++) {
      const c = v[i] - v[i - 1], up = Math.max(c, 0), dn = Math.max(-c, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    return out;
  }

  // Độ biến động năm hóa từ lợi suất ngày, tính trên n phiên gần nhất.
  function annualVol(v, n = 21, perYear = 252) {
    const r = [];
    for (let i = Math.max(1, v.length - n); i < v.length; i++) r.push(Math.log(v[i] / v[i - 1]));
    return r.length > 1 ? std(r) * Math.sqrt(perYear) * 100 : null;
  }

  function maxDrawdown(v) {
    let peak = v[0], dd = 0;
    for (const x of v) { peak = Math.max(peak, x); dd = Math.min(dd, x / peak - 1); }
    return dd * 100;
  }

  // ---------- Nhận diện đợt tăng/giảm (zigzag) ----------

  // Một đợt kết thúc khi giá đảo chiều từ đỉnh/đáy tạm thời vượt quá ngưỡng thresholdPct.
  function detectWaves(rows, thresholdPct, field = 'p') {
    if (rows.length < 2) return [];
    const th = thresholdPct / 100;
    const pivots = [];
    let dir = 0, hi = 0, lo = 0;
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i][field];
      if (dir === 0) {
        if (p > rows[hi][field]) hi = i;
        if (p < rows[lo][field]) lo = i;
        if (p >= rows[lo][field] * (1 + th)) { dir = 1; pivots.push(lo); hi = i; }
        else if (p <= rows[hi][field] * (1 - th)) { dir = -1; pivots.push(hi); lo = i; }
      } else if (dir === 1) {
        if (p > rows[hi][field]) hi = i;
        else if (p <= rows[hi][field] * (1 - th)) { pivots.push(hi); dir = -1; lo = i; }
      } else {
        if (p < rows[lo][field]) lo = i;
        else if (p >= rows[lo][field] * (1 + th)) { pivots.push(lo); dir = 1; hi = i; }
      }
    }
    if (!pivots.length) return [];
    const last = rows.length - 1;
    const endpoints = dir === 1 ? hi : lo;
    const points = [...pivots, endpoints];
    if (endpoints !== last) points.push(last);

    const waves = [];
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k], b = points[k + 1];
      const startP = rows[a][field], endP = rows[b][field];
      const closes = rows.slice(a, b + 1).map((r) => r[field]);
      waves.push({
        i0: a, i1: b, from: rows[a].d, to: rows[b].d,
        startP, endP, pct: (endP / startP - 1) * 100,
        days: daysBetween(rows[a].d, rows[b].d),
        dir: endP >= startP ? 1 : -1,
        high: Math.max(...closes), low: Math.min(...closes),
        vol: annualVol(closes, closes.length),
        // Đoạn cuối chưa xác nhận đảo chiều nên vẫn đang diễn ra.
        ongoing: b === last && (k === points.length - 2),
      });
    }
    return waves;
  }

  function waveSummary(waves) {
    const done = waves.filter((w) => !w.ongoing);
    const pick = (dir) => {
      const g = done.filter((w) => w.dir === dir);
      if (!g.length) return null;
      return { n: g.length, avgPct: mean(g.map((w) => w.pct)), avgDays: mean(g.map((w) => w.days)), medDays: median(g.map((w) => w.days)), best: g.reduce((b, w) => (Math.abs(w.pct) > Math.abs(b.pct) ? w : b)) };
    };
    return { up: pick(1), down: pick(-1) };
  }

  // ---------- Dự báo ----------

  // Ridge giải bằng phương trình chuẩn với khử Gauss.
  function ridgeFit(X, y, lambda) {
    const p = X[0].length;
    const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
    for (let n = 0; n < X.length; n++) {
      const row = X[n];
      for (let i = 0; i < p; i++) {
        for (let j = i; j < p; j++) A[i][j] += row[i] * row[j];
        A[i][p] += row[i] * y[n];
      }
    }
    for (let i = 0; i < p; i++) { for (let j = 0; j < i; j++) A[i][j] = A[j][i]; A[i][i] += lambda; }
    for (let c = 0; c < p; c++) {
      let m = c;
      for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
      [A[c], A[m]] = [A[m], A[c]];
      const pv = A[c][c] || 1e-9;
      for (let r = 0; r < p; r++) {
        if (r === c) continue;
        const f = A[r][c] / pv;
        if (f) for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
      }
    }
    return A.map((row, i) => row[p] / (row[i] || 1e-9));
  }

  // Đặc trưng kỹ thuật, chỉ dùng dữ liệu đến thời điểm t (không nhìn trước).
  function featureAt(logp, t) {
    const r = (n) => logp[t] - logp[t - n];
    let s = 0;
    for (let i = t - 49; i <= t; i++) s += logp[i];
    let v = 0;
    for (let i = t - 20; i <= t; i++) { const d = logp[i] - logp[i - 1]; v += d * d; }
    const vol = Math.sqrt(v / 21);
    return [1, r(5) / (vol * 2.24), r(21) / (vol * 4.58), r(63) / (vol * 7.94), r(252) / (vol * 15.87), (logp[t] - s / 50) / (vol * 7)];
  }

  const MIN_HIST = 260;

  // Tạo các dự báo log-return h bước tại thời điểm t, chỉ từ dữ liệu <= t.
  function worldModels(logp, t, h, cache) {
    const vol = trailingVol(logp, t, 63);
    const drift = (logp[t] - logp[Math.max(0, t - 756)]) / Math.min(t, 756);

    // Ridge động lượng, huấn luyện lại định kỳ để giảm chi phí.
    let beta = cache && cache.beta;
    if (!beta || !cache || t - cache.t >= 21) {
      const X = [], y = [];
      const start = Math.max(MIN_HIST, t - 1260);
      for (let i = start; i + h <= t; i += Math.max(1, Math.floor(h / 3))) {
        X.push(featureAt(logp, i));
        y.push((logp[i + h] - logp[i]) / (trailingVol(logp, i, 63) * Math.sqrt(h)));
      }
      beta = X.length > 30 ? ridgeFit(X, y, X.length * 0.5) : null;
      if (cache) { cache.beta = beta; cache.t = t; }
    }
    let mom = 0;
    if (beta) {
      const f = featureAt(logp, t);
      mom = f.reduce((s, x, i) => s + x * beta[i], 0) * vol * Math.sqrt(h);
    }
    return {
      naive: 0,
      drift: drift * h * 0.5, // co một nửa để tránh ngoại suy quá mức xu hướng gần đây
      momentum: mom,
    };
  }

  function trailingVol(logp, t, n) {
    let v = 0, c = 0;
    for (let i = Math.max(1, t - n + 1); i <= t; i++) { const d = logp[i] - logp[i - 1]; v += d * d; c++; }
    return Math.sqrt(v / Math.max(1, c)) || 0.008;
  }

  // Kết hợp: trung bình giữa drift đã co và ridge động lượng, rồi co thêm về 0.
  const combine = (m) => 0.5 * (m.drift + m.momentum) * 0.7;

  const WORLD_HORIZONS = [{ key: '1d', cal: 1, h: 1 }, { key: '7d', cal: 7, h: 5 }, { key: '30d', cal: 30, h: 21 }, { key: '90d', cal: 90, h: 63 }];

  // Kiểm định ngược walk-forward: tại mỗi t chỉ biết dữ liệu tới t rồi so với giá thật sau h phiên.
  function backtestWorld(series, opts = {}) {
    const logp = series.map((r) => Math.log(r.p));
    const n = logp.length;
    const lookback = opts.lookback || 1260;
    const out = {};
    for (const hz of WORLD_HORIZONS) {
      const h = hz.h, step = opts.step || (h === 1 ? 5 : Math.max(1, Math.round(h / 2)));
      const cache = {};
      const start = Math.max(MIN_HIST + 260, n - lookback - h);
      const errs = { naive: [], drift: [], momentum: [], blend: [] };
      let dirHit = 0, dirN = 0, naiveDirHit = 0;
      const zs = [];
      let cover80 = 0, cover95 = 0, cn = 0;
      for (let t = start; t + h < n; t += step) {
        const real = logp[t + h] - logp[t];
        const m = worldModels(logp, t, h, cache);
        const blend = combine(m);
        errs.naive.push(Math.abs(real));
        errs.drift.push(Math.abs(real - m.drift));
        errs.momentum.push(Math.abs(real - m.momentum));
        errs.blend.push(Math.abs(real - blend));
        if (real !== 0) {
          dirN++;
          if (Math.sign(blend) === Math.sign(real)) dirHit++;
          if (real > 0) naiveDirHit++;
        }
        const band = bands(logp, t, h, blend);
        cn++;
        if (real >= band.q10 && real <= band.q90) cover80++;
        if (real >= band.q025 && real <= band.q975) cover95++;
        zs.push(real);
      }
      const mae = (a) => mean(a) * 100;
      out[hz.key] = {
        n: errs.naive.length,
        maeNaive: mae(errs.naive), maeDrift: mae(errs.drift), maeMomentum: mae(errs.momentum), maeBlend: mae(errs.blend),
        skill: (1 - mean(errs.blend) / mean(errs.naive)) * 100,
        dirHit: (dirHit / dirN) * 100,
        baseUp: (naiveDirHit / dirN) * 100,
        cover80: (cover80 / cn) * 100, cover95: (cover95 / cn) * 100,
      };
    }
    return out;
  }

  // Khoảng dự báo: phân vị thực nghiệm của lợi suất h phiên đã chuẩn hóa theo biến động lúc đó.
  function bands(logp, t, h, center) {
    const vol = trailingVol(logp, t, 63);
    const zs = [];
    const from = Math.max(70, t - 1260);
    for (let i = from; i + h <= t; i += Math.max(1, Math.floor(h / 2))) {
      zs.push((logp[i + h] - logp[i]) / (trailingVol(logp, i, 63) * Math.sqrt(h)));
    }
    const m = zs.length ? mean(zs) : 0;
    const s = vol * Math.sqrt(h);
    const q = (p) => (zs.length > 20 ? (quantile(zs, p) - m) * s : ({ 0.025: -1.96, 0.1: -1.28, 0.9: 1.28, 0.975: 1.96 }[p]) * s) + center;
    return { q025: q(0.025), q10: q(0.1), q90: q(0.9), q975: q(0.975) };
  }

  // Dự báo thế giới tại điểm cuối chuỗi.
  function forecastWorld(series) {
    const logp = series.map((r) => Math.log(r.p));
    const t = logp.length - 1;
    const last = series[t];
    return WORLD_HORIZONS.map((hz) => {
      const m = worldModels(logp, t, hz.h, {});
      const c = combine(m);
      const b = bands(logp, t, hz.h, c);
      const conv = (x) => last.p * Math.exp(x);
      return { key: hz.key, cal: hz.cal, h: hz.h, date: addDays(last.d, hz.cal), logReturn: c, point: conv(c), lo80: conv(b.q10), hi80: conv(b.q90), lo95: conv(b.q025), hi95: conv(b.q975), models: m };
    });
  }

  const VN_HORIZONS = [1, 7, 30, 90];

  // Giá SJC thường phản ứng trễ một ngày với giá thế giới quy đổi.
  // Hệ số k ước lượng bằng hồi quy chỉ trên dữ liệu đã biết tại thời điểm t.
  function vnLagBeta(prem, t) {
    if (t < 40) return 0.25;
    let sxx = 0, sxy = 0;
    for (let i = 1; i < t; i++) {
      const x = Math.log(prem[i].conv / prem[i - 1].conv);
      sxx += x * x;
      sxy += x * Math.log(prem[i + 1].sell / prem[i].sell);
    }
    return Math.min(0.6, Math.max(0, sxx ? sxy / sxx : 0));
  }

  // Trung tâm dự báo SJC chỉ gồm hiệu ứng trễ một ngày. Kiểm định cho thấy cộng thêm xu hướng thế giới
  // hay giả định chênh lệch hồi về trung bình đều làm sai số lớn hơn so với giả định giá không đổi.
  function vnCenter(prem, t) {
    const k = vnLagBeta(prem, t);
    const lag = t > 0 ? k * Math.log(prem[t].conv / prem[t - 1].conv) : 0;
    return { logReturn: lag, k };
  }

  // Độ lệch chuẩn cho kỳ cal ngày: lấy số lớn hơn giữa thực nghiệm và quy tắc căn bậc hai thời gian.
  function vnSigma(prem, t, cal) {
    const d = [];
    for (let i = 1; i <= t; i++) d.push(Math.log(prem[i].sell / prem[i - 1].sell));
    const root = std(d) * Math.sqrt(cal);
    const r = [];
    for (let i = cal; i <= t; i++) r.push(Math.log(prem[i].sell / prem[i - cal].sell));
    return r.length >= 30 ? Math.max(std(r), root) : root;
  }

  function backtestVN(ds, type = 'SJL1L10') {
    const prem = premiumSeries(ds, type);
    const out = {};
    const start = 60;
    for (const cal of VN_HORIZONS) {
      const eN = [], eM = [];
      let hit = 0, calls = 0, c80 = 0, c95 = 0;
      for (let t = start; t + cal < prem.length; t++) {
        const real = Math.log(prem[t + cal].sell / prem[t].sell);
        const c = vnCenter(prem, t);
        const sd = vnSigma(prem, t, cal);
        eN.push(Math.abs(real));
        eM.push(Math.abs(real - c.logReturn));
        if (real !== 0 && c.logReturn !== 0) { calls++; if (Math.sign(c.logReturn) === Math.sign(real)) hit++; }
        if (Math.abs(real - c.logReturn) <= 1.28 * sd) c80++;
        if (Math.abs(real - c.logReturn) <= 1.96 * sd) c95++;
      }
      const n = eN.length;
      const windows = Math.floor(n / cal);
      // Dưới 6 cửa sổ độc lập thì con số không đủ tin cậy để công bố.
      out[cal + 'd'] = windows < 6 ? { n, windows, tooFew: true } : {
        n, windows,
        maeNaive: mean(eN) * 100, maeModel: mean(eM) * 100,
        skill: (1 - mean(eM) / mean(eN)) * 100,
        dirHit: calls ? (hit / calls) * 100 : null, calls,
        cover80: (c80 / n) * 100, cover95: (c95 / n) * 100,
      };
    }
    return out;
  }

  function forecastVN(ds, type = 'SJL1L10') {
    const prem = premiumSeries(ds, type);
    const t = prem.length - 1;
    const last = prem[t];
    return VN_HORIZONS.map((cal) => {
      const c = vnCenter(prem, t);
      const sd = vnSigma(prem, t, cal);
      const val = (z) => last.sell * Math.exp(c.logReturn + z * sd);
      return { key: cal + 'd', cal, date: addDays(last.d, cal), logReturn: c.logReturn, k: c.k, point: val(0), buy: val(0) - last.spread, lo80: val(-1.28), hi80: val(1.28), lo95: val(-1.96), hi95: val(1.96) };
    });
  }

  return {
    OZ_PER_LUONG, toTime, toDate, isWeekend, addDays, daysBetween, mean, std, median, quantile,
    buildDataset, asOfLookup, premiumSeries, sma, rsi, annualVol, maxDrawdown,
    detectWaves, waveSummary, backtestWorld, backtestVN, forecastWorld, forecastVN,
    WORLD_HORIZONS, VN_HORIZONS,
  };
});
