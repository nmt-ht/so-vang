// Tải dữ liệu lịch sử và ghi data/snapshot.json để nhúng vào app.
// Chạy: node scripts/fetch_data.js
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Mozilla/5.0 (gold-analysis personal app)' };
const VN_TYPES = ['SJL1L10', 'SJ9999', 'DOHNL', 'PQHN24NTT', 'BT9999NTT'];

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function yahoo(symbol) {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`);
  const r = j.chart.result[0];
  const close = r.indicators.quote[0].close;
  const out = new Map();
  r.timestamp.forEach((t, i) => {
    if (close[i] != null) out.set(new Date(t * 1000).toISOString().slice(0, 10), close[i]);
  });
  return out;
}

async function vangToday(type) {
  const j = await getJson(`https://www.vang.today/api/prices?type=${type}&days=5000`);
  if (!j.success) throw new Error(`vang.today ${type} failed`);
  return j.history
    .filter((h) => h.prices && h.prices[type])
    .map((h) => ({ date: h.date, buy: h.prices[type].buy, sell: h.prices[type].sell, updates: h.prices[type].updates }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

(async () => {
  const [gc, fx] = await Promise.all([yahoo('GC=F'), yahoo('VND=X')]);
  const spot = await vangToday('XAUUSD');

  const vn = {};
  for (const t of VN_TYPES) vn[t] = await vangToday(t);

  // Thế giới: hợp đồng tương lai GC=F cho giai đoạn cũ, giá giao ngay XAU/USD từ khi vang.today có dữ liệu.
  const spotStart = spot[0].date;
  const world = [...gc.entries()]
    .filter(([d]) => d < spotStart)
    .map(([d, v]) => [d, round(v, 1)])
    .concat(spot.filter((s) => s.buy > 0).map((s) => [s.date, round(s.buy, 1)]));

  // Đối chiếu giữa hai nguồn thế giới trên phần trùng nhau
  const diffs = spot.filter((s) => gc.has(s.date) && s.buy > 0).map((s) => (gc.get(s.date) / s.buy - 1) * 100);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;

  const snapshot = {
    generatedAt: new Date().toISOString(),
    spotStart,
    futuresVsSpotPct: round(mean, 3),
    world,
    fx: [...fx.entries()].filter(([, v]) => v > 15000 && v < 40000).map(([d, v]) => [d, Math.round(v)]),
    vn: Object.fromEntries(VN_TYPES.map((t) => [t, vn[t].map((r) => [r.date, r.buy, r.sell, r.updates])])),
  };

  const out = path.join(__dirname, '..', 'data', 'snapshot.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot));
  console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
  console.log('world', world.length, world[0], world.at(-1));
  console.log('fx', snapshot.fx.length, snapshot.fx[0], snapshot.fx.at(-1));
  console.log('spot start', spotStart, 'GC vs spot mean %', round(mean, 3), 'n', diffs.length, 'range', round(Math.min(...diffs), 2), round(Math.max(...diffs), 2));
  for (const t of VN_TYPES) console.log(t, vn[t].length, vn[t][0].date, vn[t].at(-1).date, vn[t].at(-1).buy, vn[t].at(-1).sell);
})().catch((e) => { console.error(e); process.exit(1); });
