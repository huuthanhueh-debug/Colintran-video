# PromptGate Video

App dựng video chạy hoàn toàn trên máy: nhập ý tưởng → storyboard → prompt đúng chuẩn cho 11 công cụ AI video → gắn ảnh/clip đã tạo → xuất video có phụ đề và nhạc. Không tài khoản, không gửi dữ liệu đi đâu.

Giao diện có hai ngôn ngữ: bấm **VI** hoặc **EN** ở góc trên bên phải; lựa chọn được nhớ cho lần mở sau. / The UI is bilingual: tap **VI** or **EN** at the top right.

## Bốn bước trong app

| Tab | Việc làm |
|---|---|
| Ý tưởng | Mỗi câu hoặc mỗi dòng là một cảnh. Chọn khung hình (9:16, 16:9, 1:1), tổng thời lượng, phong cách. |
| Cảnh | Sửa mô tả, phụ đề, số giây, cỡ cảnh, chuyển động máy, chuyển cảnh. Gắn ảnh hoặc clip cho từng cảnh. |
| Prompt | Chọn công cụ, sao chép prompt từng cảnh (hoặc cả video). App cảnh báo khi cảnh dài hơn một lần tạo hoặc công cụ không hỗ trợ khung hình. |
| Xuất | Xem thử, thêm nhạc nền, xuất MP4 (hoặc WebM nếu máy không mã hoá được MP4), lưu phụ đề .srt và dự án .json. |

## 11 công cụ (đối chiếu ngày 2026-11-10)

| Công cụ | Loại | Mỗi lần tạo | Khung hình | Âm thanh gốc |
|---|---|---|---|---|
| Google Veo 3 (3.1) | tạo clip | 4 / 6 / 8 giây | 16:9, 9:16 | có |
| Runway Gen-4 (4.5) | tạo clip | 5 / 10 giây | 6 tỉ lệ | có |
| Kling AI (4.0) | tạo clip | 3–30 giây | 16:9, 9:16, 1:1, 21:9 | có |
| HeyGen | người dẫn ảo | theo gói | 5 tỉ lệ | giọng đọc |
| Synthesia | người dẫn ảo | theo gói | 16:9 | giọng đọc |
| InVideo AI | dựng cả video | 15 giây – 20 phút | 16:9, 9:16, 1:1 | voiceover, nhạc |
| CapCut AI | dựng cả video | theo kịch bản | 9:16, 16:9 | voiceover, nhạc |
| Canva AI (Magic Media) | tạo clip (Veo 3) | 8 giây | 16:9 | có |
| Sora (OpenAI) | đã ngừng (app 04/2026, API 09/2026) | 4 / 8 / 12 giây | 16:9, 9:16 | có |
| Pika Labs (2.5) | tạo clip | 5 / 10 giây | 7 tỉ lệ | không |
| Luma Dream Machine (Ray3.2) | tạo clip | 5 / 10 giây | 6 tỉ lệ | không |

Thông số lấy từ trang của hãng và bài tổng hợp; các hãng đổi thường xuyên, mỗi công cụ trong app có link nguồn. Số liệu Runway (độ dài clip), Pika và Sora chỉ có nguồn bên thứ ba. Sửa ở `video/src/core.js` (mảng `TOOLS`).

## Chạy trên máy tính

```bash
npm run video          # http://127.0.0.1:4173
```

Cần Node.js 18+. Dùng Chrome hoặc Edge.

## Cài trên Android (APK)

- Tải `promptgate-video.apk` từ mục **Releases → video-latest** của repo (tự build mỗi lần nhánh main đổi), hoặc từ artifact của workflow `video-apk`.
- Mở file trên điện thoại, cho phép "cài từ nguồn này". Android 7.0 trở lên.
- App không xin quyền nào. Video lưu vào `Movies/PromptGateVideo`.

Tự build: cần JDK 17+ và Android SDK (build-tools + một platform).

```bash
ANDROID_HOME=/đường/dẫn/sdk npm run build:apk     # → video/dist/promptgate-video.apk
```

Mặc định ký bằng khoá debug tạo tại chỗ, nên bản build từ máy khác không cài đè lên được (phải gỡ bản cũ). Muốn cập nhật đè: tạo keystore riêng rồi đặt `PGV_KEYSTORE`, `PGV_KS_PASS`, `PGV_KEY_ALIAS` (trên GitHub: secrets `PGV_KEYSTORE_B64`, `PGV_KS_PASS`, `PGV_KEY_ALIAS`).

## Giới hạn

- App không tự sinh hình bằng AI: clip do các công cụ trên tạo, app lo prompt và khâu ghép.
- App không dịch: prompt giữ nguyên câu bạn viết, nên viết mô tả cảnh bằng tiếng Anh.
- Xuất chạy theo thời gian thực và phải giữ app mở.
- Chuyển cảnh hiện có mờ dần và cắt thẳng.

## Test

```bash
npm run test:video     # logic, server, đóng gói; có Playwright thì render video thật
```
