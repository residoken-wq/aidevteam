# Release 0.1 — Checklist UAT (03/12/2026)

> **Người ký UAT:** `residoken-wq` (CLAUDE.md §4). Claude soạn checklist, **không** thực hiện hay ký UAT.
> **Môi trường:** staging chạy **đúng** `target_sha` + image digest ghi trong `RELEASE_MANIFEST.md` (chốt tại freeze 02/12). Staging hiện `CHƯA CẤU HÌNH` → chưa bắt đầu được.
> **Dữ liệu:** chỉ dữ liệu giả (`Học viên Test 01`, `@example.com`, GitHub ID `9000000xx` cho bản ghi giả). **Không** dùng dữ liệu khách hàng thật, không dán secret thật vào màn hình nào.
> Ghi kết quả từng dòng: `PASS` / `FAIL` / `N/A` + ghi chú. Dòng `FAIL` thuộc nhóm **Chặn** → UAT không đạt.

## 0. Điều kiện trước khi bắt đầu

| # | Kiểm tra | Kết quả | Ghi chú |
|---|---|---|---|
| U0-1 | Staging chạy đúng digest api/web như manifest (so `docker inspect` / `deploy.log` với manifest) | | |
| U0-2 | `/health/ready` api = 200, `/health` web = 200 | | |
| U0-3 | Migration staging ở bản 0010 (`migrate status`) | | |
| U0-4 | OAuth App staging trỏ đúng callback staging; client secret chỉ nằm trong secret manager | | |
| U0-5 | Chuẩn bị 4 tài khoản GitHub thử trong allowlist: org_admin, maintainer, viewer, không role (+ 1 platform admin nếu UAT S-12). Ghi **GitHub user ID số**, không ghi email | | |
| U0-6 | Có 1 tài khoản GitHub **không** nằm trong allowlist | | |
| U0-7 | CI `ci` + `e2e` xanh trên `target_sha` (link run trong manifest) | | |

## 1. Đăng nhập và phiên — ADR-005 (Chặn)

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U1-1 | Mở staging khi chưa đăng nhập | Chuyển về `/login` | |
| U1-2 | Đăng nhập bằng tài khoản trong allowlist | Về trang chủ; cookie session `HttpOnly`, `Secure`, `SameSite` (xem DevTools) | |
| U1-3 | Đăng nhập bằng tài khoản ngoài allowlist | Bị từ chối, thông báo cố định; có sự kiện audit | |
| U1-4 | Màn hình cấp quyền GitHub | Chỉ xin scope đọc định danh, **không** có `repo` hay scope ghi | |
| U1-5 | Đăng xuất rồi bấm Back / dùng lại tab cũ | Phải đăng nhập lại (session bị hủy phía server) | |
| U1-6 | Đăng nhập thành công nhưng chưa có role | Thông báo liên hệ quản trị, không thấy dữ liệu org | |

## 2. Phân quyền (RBAC default deny) (Chặn)

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U2-1 | Viewer mở `/projects`, `/agents`, `/workers`, `/provider-accounts`, Kanban, `/runs/<id>` | Xem được; **không** thấy nút/form tạo, sửa, lưu trữ, kéo thả, "Chạy mock", "Hủy" | |
| U2-2 | Maintainer làm các thao tác ghi ở §3–§5 | Được phép | |
| U2-3 | Dán URL trang của org khác (đổi slug/id) | 404 / không thấy dữ liệu | |
| U2-4 | Maintainer mở `/platform/orgs` | Không thấy link; bị từ chối | |

## 3. Thiết lập dự án — F-03

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U3-1 | Tạo project `uat-test-01`, đổi tên, tạo trùng slug | Lỗi trùng hiển thị dễ hiểu | |
| U3-2 | Tên project chứa `<b>x</b>` | Hiển thị đúng dạng chữ, không in đậm | |
| U3-3 | Tạo agent có cấp trên; thử tạo vòng lặp báo cáo | Vòng lặp bị từ chối | |
| U3-4 | Tạo provider account với tham chiếu `env:AIDEV_SECRET_UAT_01` | Lưu được | |
| U3-5 | (Chặn) Dán chuỗi **giả** trông như key: `Xk9mP2qR7sT4vW8yZ1aB3cD5eF6gH0jK` (cùng chuỗi unit test `secret-ref.test.ts` dùng) vào ô tham chiếu | Bị từ chối, có hướng dẫn, giá trị bị xóa khỏi ô, không xuất hiện lại ở đâu (kể cả log, audit) | |
| U3-6 | Tạo worker mock gắn project; thử đường dẫn lồng nhau / thư mục hệ thống | Bị từ chối | |

## 4. Task và Kanban — F-04

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U4-1 | Tạo 3 task, một task có mô tả chứa `<script>alert(1)</script>` | Không có hộp thoại alert; mô tả hiện dạng chữ | |
| U4-2 | Kéo thả BACKLOG → Cần làm (kéo nhanh và kéo chậm) | Thẻ chuyển cột, tải lại trang vẫn đúng | |
| U4-3 | Kéo Cần làm → Hoàn thành | Bị từ chối, thông báo "Không thể chuyển…", thẻ ở lại | |
| U4-4 | Chuyển tới Hoàn thành | Bắt buộc xác nhận đã đạt AC/test/review | |
| U4-5 | Hủy task | Bắt buộc nhập lý do; lý do hiện trên thẻ | |
| U4-6 | Mở 2 tab, chuyển thẻ ở tab 1 rồi thao tác ở tab 2 | Tab 2 báo xung đột, hoàn tác và tải lại | |

## 5. Mock dispatch và run — S-09

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U5-1 | Task ở Cần làm → "Chạy mock" | Chuyển tới trang run, trạng thái QUEUED | |
| U5-2 | Bật mock worker trên staging (`MOCK_WORKER_ENABLED=true`, nếu Owner đồng ý cho UAT) và chờ | QUEUED → RUNNING → SUCCEEDED; log hiển thị dạng chữ | |
| U5-3 | Bấm "Hủy" khi QUEUED | CANCELLED; nút Hủy biến mất | |
| U5-4 | Chạy mock lần 2 khi worker đang bận | Thông báo worker đang bận | |
| U5-5 | Mở `/runs/khong-phai-uuid` | 404 | |
| U5-6 | "Lịch sử chạy" của task | Liệt kê các lần chạy, mới nhất trước | |

## 6. Dashboard và Approval Center — F-05

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U6-1 | Dashboard org mới | Toàn số 0, "Chưa có dữ liệu" | |
| U6-2 | Sau §3–§5 | Số project/agent/worker/task/run khớp những gì đã tạo | |
| U6-3 | `/approvals` | Banner "Chỉ hiển thị. Quyết định được thực hiện bằng comment /approve-* trên PR."; **không** có nút/form; rỗng → "Chưa có bản ghi duyệt" | |
| U6-4 | (Chặn) Tìm mọi cách ghi quyết định duyệt từ giao diện | Không có cách nào (O-07) | |

## 7. Quản trị tổ chức — S-12 (chỉ khi Owner đã ký D-2026-11-26-13)

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U7-1 | Platform admin tạo org, đổi tên, lưu trữ, khôi phục | Có xác nhận; thành viên org lưu trữ mất truy cập, dữ liệu giữ nguyên | |
| U7-2 | Nếu D-2026-11-26-13 **chưa** ký | Ghi `N/A`, ghi rõ tính năng không dùng ở production 0.1 | |

## 8. Vận hành (Chặn)

| # | Bước | Kỳ vọng | Kết quả |
|---|---|---|---|
| U8-1 | Backup staging bằng `deploy/backup.sh`, restore vào DB rỗng bằng `deploy/restore.sh` | Restore thành công; app đọc được dữ liệu giả | |
| U8-2 | Chạy `deploy.sh --dry-run` với digest manifest + link approval giả định | Thông số đúng; script từ chối tag thay vì digest | |
| U8-3 | Diễn tập rollback (§7 manifest) trên staging | Quay về được, health check xanh | |
| U8-4 | Kiểm tra log api/web không chứa token, email, cookie session | Không có | |
| U8-5 | Audit có sự kiện cho đăng nhập bị từ chối, tạo/sửa project, dispatch, cancel | Có, metadata chỉ có tên trường/id | |

## 9. Kết luận và ký

| Trường | Giá trị |
|---|---|
| `target_sha` đã UAT | |
| Digest api / web | |
| Số dòng PASS / FAIL / N/A | |
| Dòng FAIL nhóm Chặn | |
| Lỗi không chặn được chấp nhận (link issue) | |
| Kết luận | `UAT PASS` / `UAT FAIL` |
| Người ký | `residoken-wq` — ký bằng comment `/approve-uat <release_manifest_digest>` trên PR manifest (§5.5) |
| Thời điểm (Asia/Ho_Chi_Minh) | |

Checklist này không phải bằng chứng cho tới khi có kết quả thật và chữ ký của Owner. Không điền `PASS` thay người thực hiện.
