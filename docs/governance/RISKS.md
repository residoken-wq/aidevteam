# Risk register — Release 0.1

> Cập nhật: 26/11/2026 · Mức: Cao / Trung bình / Thấp (đánh giá của Claude, chưa được Owner duyệt).
> **R-01..R-10** được định nghĩa trong Master Plan v1.0.0 — file `SOURCE_MISSING`, nên chưa thể chép lại; khi có Master Plan, nhập vào đây và giữ nguyên số. Các rủi ro mới dùng số từ R-12.

| ID | Rủi ro | Khả năng | Ảnh hưởng | Mức | Biện pháp / chủ sở hữu | Trạng thái |
|---|---|---|---|---|---|---|
| R-01..R-10 | Theo Master Plan | — | — | — | — | `SOURCE_MISSING` |
| **R-11** | Tài khoản Owner `residoken-wq` **chưa bật 2FA** → chiếm tài khoản = giả mạo approval `/approve-*`, merge, đổi cấu hình repo (O-08) | TB | Rất cao | **Cao** | Bật 2FA; notification cho mọi lệnh `/approve-*` **trước khi** dùng approval service thật; 0.1 duyệt thủ công có đối chiếu digest. Chủ: Owner | Mở — rủi ro chấp nhận tạm thời (D-OWN-18) |
| R-12 | **Không kịp phạm vi 0.1 trước feature freeze 02/12**: còn 14 task (P2 CRUD ×5, P3 ×2, P4 ×3, P2-02, P6-06, P1-10, P1-11) + phần còn lại của P1-09 | Cao | Cao | **Cao** | Ưu tiên theo phụ thuộc (PHASE_0_REPORT §4); cắt phạm vi sớm nếu 30/11 chưa xong P2; quy tắc cứng 12: không cắt gate bảo mật → báo `NO_GO` nếu cần | Mở |
| R-13 | **Policy v1.0.1/v1.0.2 không có trong repo** và v1.0.2 chưa được xác nhận → theo §5.5 thiếu cả v1.0.2 lẫn ngoại lệ bằng văn bản là `NO_GO` 05/12 | TB | Rất cao | **Cao** | Owner đưa policy vào repo và xác nhận v1.0.2 (hoặc ký ngoại lệ) trước 04/12 | Mở |
| R-14 | Code chạy trước khi Owner ký baseline (D-2026-11-25-01); nhiều quyết định mới có xác nhận của người dùng phiên, chưa có `residoken-wq` | TB | Cao | **Cao** | Owner rà DECISION_LOG mục B và xác nhận/đảo quyết định ở checkpoint 27/11 | Mở |
| R-15 | **Thiếu thông tin hạ tầng**: domain prod/staging, phiên bản DB, OAuth App, tài khoản máy ghcr.io → không dựng được staging 03/12 | Cao | Cao | **Cao** | Owner cung cấp trước 27/11 (checkpoint đầu vào hạ tầng) | Mở |
| R-16 | Trigger append-only không chặn được chủ sở hữu bảng (`DROP TRIGGER`) | TB | Cao | TB | Tách role DB migrate/ứng dụng trên production | Mở — `CHƯA CẤU HÌNH` |
| R-17 | Giới hạn đăng nhập theo IP sai nếu NPM không đặt `X-Forwarded-For` → mọi người dùng chung bộ đếm | TB | TB | TB | Kiểm tra trên staging (`AUTH_SETUP.md` §4 bước 5) | Mở |
| R-18 | Cổng `3301` mở cho cả LAN nếu chưa có rule `DOCKER-USER` → giả `X-Forwarded-For`, bỏ qua TLS | TB | Cao | TB | Chạy rule (CICD.md §3.4) trước UAT | Mở |
| R-19 | Chưa có branch protection (gói Free) → có thể merge khi CI đỏ hoặc push thẳng `main` | TB | Cao | TB | Nâng Pro + bật protection trước 04/12 (O-02); hiện dựa vào quy trình hỏi-đồng ý (D-2026-11-25-03) | Mở |
| R-20 | Thiếu SCA / secret scan trong CI | TB | TB | TB | Hoàn thành P1-09 trước feature freeze | Mở |
| R-21 | Một người (người dùng phiên) vừa review vừa đồng ý merge mọi PR; review của Claude không được tính (§2.6) | TB | TB | TB | Owner hoặc người thứ hai review các PR bảo mật (P1-05G, P1-06) | Mở |
| R-22 | Môi trường làm việc của Claude bị chặn một số trang tài liệu (docs.github.com, rfc-editor.org) → dữ kiện phải lấy gián tiếp | Thấp | TB | Thấp | Ghi rõ nguồn/`UNVERIFIED` trong ADR; mở mạng nếu cần | Mở |

## Owner cần kiểm tra
- [ ] Bổ sung R-01..R-10 từ Master Plan.
- [ ] Đánh giá lại mức của R-11..R-15 và chấp nhận/giảm thiểu.
