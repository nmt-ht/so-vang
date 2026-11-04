// Ghép mã nguồn và dữ liệu thành: dist/so-vang.html (bản xem nhanh) và app tại thư mục gốc repo (GitHub Pages phục vụ từ đây).
// Chạy: node scripts/build.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('src/tokens.css') + read('src/app.css');
const body = read('src/body.html');
const engine = read('src/engine.js');
const app = read('src/app.js');
const snapshot = read('data/snapshot.json').replace(/<\//g, '<\\/');
const FONT = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Bitter:wght@600;700&display=swap&subset=vietnamese';

const scripts = (standalone) => `<script>window.__STANDALONE__=${standalone};window.__SNAPSHOT__=${snapshot};</script>
<script>${engine}</script>
<script>${app}</script>`;

const dist = path.join(root, 'dist');
const site = root;
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(site, '.nojekyll'), ''); // phục vụ nguyên trạng, không qua Jekyll

// Bản xem nhanh: nơi xuất bản tự bọc khung tài liệu. Phần đầu riêng của máy này (nếu có) nằm trong local/, không commit.
const localHeadPath = path.join(root, 'local', 'head.html');
const localHead = fs.existsSync(localHeadPath) ? fs.readFileSync(localHeadPath, 'utf8') : '';
fs.writeFileSync(path.join(dist, 'so-vang.html'), `<title>Sổ Vàng</title>
${localHead}<link rel="stylesheet" href="${FONT}">
<style>${css}</style>
${body}
${scripts(false)}
`);

// Bản web app độc lập.
fs.writeFileSync(path.join(site, 'index.html'), `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Sổ Vàng</title>
<meta name="description" content="Phân tích và dự báo giá vàng Việt Nam, thế giới">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Sổ Vàng">
<meta name="theme-color" content="#e9eee9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1412" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="manifest" href="manifest.webmanifest">
<link rel="stylesheet" href="${FONT}">
<style>:root{padding-top:env(safe-area-inset-top,0px)}[hidden]{display:none!important}${css}</style>
</head>
<body>
${body}
${scripts(true)}
</body>
</html>
`);

fs.writeFileSync(path.join(site, 'manifest.webmanifest'), JSON.stringify({
  name: 'Sổ Vàng', short_name: 'Sổ Vàng', lang: 'vi', start_url: './', scope: './', display: 'standalone',
  background_color: '#10352b', theme_color: '#10352b',
  icons: [{ src: 'icon-180.png', sizes: '180x180', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
}, null, 2));

// Phiên bản cache đổi theo nội dung để iPhone nhận bản mới.
const version = require('crypto').createHash('sha1').update(css + body + engine + app + snapshot).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(site, 'sw.js'), `const CACHE = 'sovang-${version}';
const SHELL = ['./', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API giá do app tự xử lý và tự lưu; ở đây chỉ phục vụ phần vỏ app và phông chữ khi offline.
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('./'))));
  } else if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com')) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((n) => { const c = n.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return n; })));
  }
});
`);

// Giữ địa chỉ cũ /docs/ hoạt động bằng cách chuyển sang địa chỉ mới.
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'index.html'), '<!doctype html><meta charset="utf-8"><title>Sổ Vàng</title><meta http-equiv="refresh" content="0; url=../"><a href="../">Mở Sổ Vàng</a>');

// Biểu tượng: thỏi vàng trên nền ngọc, vẽ trực tiếp ra PNG để không cần thư viện ngoài.
function png(size) {
  const SS = 3;
  const px = Buffer.alloc((size * 4 + 1) * size);
  const inPoly = (x, y, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const front = [[0.16, 0.72], [0.84, 0.72], [0.74, 0.46], [0.26, 0.46]];
  const top = [[0.26, 0.46], [0.74, 0.46], [0.66, 0.31], [0.34, 0.31]];
  const shade = (x, y) => {
    if (inPoly(x, y, top)) return [249, 221, 138];
    if (inPoly(x, y, front)) return [226, 174, 62];
    return [16, 53, 43];
  };
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    px[row] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < SS; i++) for (let j = 0; j < SS; j++) {
        const c = shade((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size);
        r += c[0]; g += c[1]; b += c[2];
      }
      const k = SS * SS, o = row + 1 + x * 4;
      px[o] = r / k; px[o + 1] = g / k; px[o + 2] = b / k; px[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(site, 'icon-180.png'), png(180));
fs.writeFileSync(path.join(site, 'icon-512.png'), png(512));

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log('dist/so-vang.html', kb(path.join(dist, 'so-vang.html')));
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'icon-180.png', 'icon-512.png']) console.log(f, kb(path.join(site, f)));
console.log('cache version', version);
