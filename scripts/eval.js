// In kết quả kiểm định ngược và kiểm tra nhanh các hàm lõi.
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'snapshot.json')));
const ds = E.buildDataset(snap);
const f = (x, d = 2) => (x == null ? '-' : x.toFixed(d));

console.time('backtestWorld');
const bw = E.backtestWorld(ds.world);
console.timeEnd('backtestWorld');
console.log('WORLD walk-forward (MAE %, skill = cải thiện so với naive)');
for (const [k, r] of Object.entries(bw)) console.log(k, 'n', r.n, 'naive', f(r.maeNaive), 'drift', f(r.maeDrift), 'mom', f(r.maeMomentum), 'blend', f(r.maeBlend), 'skill', f(r.skill, 1) + '%', 'dir', f(r.dirHit, 0) + '%', 'baseUp', f(r.baseUp, 0) + '%', 'cov80', f(r.cover80, 0), 'cov95', f(r.cover95, 0));

console.time('backtestVN');
const bv = E.backtestVN(ds);
console.timeEnd('backtestVN');
console.log('SJC walk-forward');
for (const [k, r] of Object.entries(bv)) console.log(k, r.tooFew ? 'too few n='+r.n+' windows='+r.windows : `n ${r.n} win ${r.windows} naive ${f(r.maeNaive)} model ${f(r.maeModel)} skill ${f(r.skill, 1)}% dir ${f(r.dirHit, 0)}% (${r.calls} calls) cov80 ${f(r.cover80, 0)} cov95 ${f(r.cover95, 0)}`);

console.time('forecast');
const fw = E.forecastWorld(ds.world);
const fv = E.forecastVN(ds);
console.timeEnd('forecast');
console.log('world now', ds.world.at(-1));
console.log(fw.map((x) => `${x.key} ${x.date} point ${f(x.point, 0)} 80% [${f(x.lo80, 0)}, ${f(x.hi80, 0)}] 95% [${f(x.lo95, 0)}, ${f(x.hi95, 0)}]`).join('\n'));
console.log('SJC now', ds.vn.SJL1L10.at(-1));
console.log(fv.map((x) => `${x.key} ${x.date} point ${f(x.point / 1e6, 1)} k ${f(x.k, 2)} ret ${f(x.logReturn * 100, 2)}% 80% [${f(x.lo80 / 1e6, 1)}, ${f(x.hi80 / 1e6, 1)}] 95% [${f(x.lo95 / 1e6, 1)}, ${f(x.hi95 / 1e6, 1)}]`).join('\n'));

for (const th of [3, 5, 10]) {
  const w = E.detectWaves(ds.world, th);
  const s = E.waveSummary(w);
  console.log(`world waves th=${th}: ${w.length}`, 'up', s.up && [s.up.n, f(s.up.avgPct), f(s.up.avgDays, 0)], 'down', s.down && [s.down.n, f(s.down.avgPct), f(s.down.avgDays, 0)]);
}
const wj = E.detectWaves(ds.vn.SJL1L10, 5, 'sell');
console.log('SJC waves th=5', wj.map((w) => `${w.from}>${w.to} ${f(w.pct, 1)}%${w.ongoing ? ' *' : ''}`).join(' | '));
// Kiểm tra liên tục: mỗi đợt bắt đầu đúng nơi đợt trước kết thúc
const cont = wj.every((w, i) => i === 0 || w.from === wj[i - 1].to);
console.log('continuous', cont, 'last wave ends at last row', wj.at(-1).to === ds.vn.SJL1L10.at(-1).d, 'ongoing count', wj.filter((w) => w.ongoing).length);
