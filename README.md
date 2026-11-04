# Sổ Vàng

Web app phân tích và dự báo giá vàng Việt Nam, thế giới. Cài lên iPhone qua Safari, không cần App Store hay máy Mac.

## Cài lên iPhone

1. Mở https://nmt-ht.github.io/so-vang/ bằng **Safari** trên iPhone.
2. Bấm nút **Chia sẻ**, chọn **Thêm vào MH chính**.

App mở toàn màn hình như app thường, tự lấy giá mới mỗi lần mở, và vẫn xem được dữ liệu đã lưu khi không có mạng.

## Cập nhật mã nguồn

```bash
node scripts/fetch_data.js
```

```bash
node scripts/build.js
```

`fetch_data.js` làm mới dữ liệu lịch sử nhúng sẵn, `build.js` tạo lại app ở thư mục gốc và `dist/`. Commit và đẩy lên `main` thì GitHub Pages tự cập nhật. Chạy `node scripts/eval.js` để xem kết quả kiểm định ngược.

## Cấu trúc

- `src/engine.js`: chỉ báo, nhận diện đợt, dự báo, kiểm định ngược. Không phụ thuộc giao diện.
- `src/app.js`, `src/tokens.css`, `src/app.css`, `src/body.html`: giao diện.
- `data/snapshot.json`: dữ liệu lịch sử.
- `index.html`, `sw.js`, `manifest.webmanifest`, `icon-*.png` ở thư mục gốc: app do `build.js` tạo ra, GitHub Pages phục vụ từ đây. `dist/so-vang.html`: bản xem nhanh, không tự cập nhật giá, không đưa lên repo.

## Nguồn dữ liệu

- vang.today: giá vàng Việt Nam và XAU/USD, gọi trực tiếp từ trình duyệt, không cần khóa API. Lịch sử có từ 23/11/2025.
- Yahoo Finance: GC=F và VND=X, dùng khi tạo dữ liệu nhúng.
- open.er-api.com: tỷ giá USD/VND mới nhất trong app.

Đây là công cụ thống kê, không phải khuyến nghị đầu tư.
